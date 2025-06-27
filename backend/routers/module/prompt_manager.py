# backend/routers/module/prompt_manager.py
"""
プロンプト管理ヘルパー関数

このモジュールは、既存のコードでプロンプトを動的に取得・利用するためのヘルパー関数を提供します。
カスタムプロンプトがあればそれを使用し、なければデフォルトプロンプトを使用します。
TODO:さまざまなプロンプトにて、system_prompt_idを利用してカスタムプロンプトを取得するように変更
"""

from typing import Optional, Dict, Any
from sqlmodel import Session, select, and_
from functools import lru_cache
import logging
import re
from datetime import datetime

from models import SystemPrompt, User
from routers.module.default_prompts import (
    PromptType, get_default_prompt, format_prompt as original_format_prompt # format_promptをリネームしてインポート
)
from routers.module.roleplay_prompts import RoleplayTaskType, get_task_instruction

logger = logging.getLogger(__name__)


def _get_automatic_variables(db: Session, user_id: Optional[int] = None) -> Dict[str, str]:
    """
    プロンプトで自動的に利用可能な変数を取得します。
    
    Args:
        db (Session): データベースセッション
        user_id (Optional[int]): ユーザーID
        
    Returns:
        Dict[str, str]: 自動変数の辞書
    """
    variables = {}
    
    # {today} 変数: 現在の日付
    variables['today'] = datetime.now().strftime('%Y年%m月%d日')
    print(f"DEBUG: USER ID: {user_id}, 今日の日付: {variables['today']}")
    
    # {name} 変数: ユーザーの表示名またはユーザーID
    if user_id:
        try:
            user = db.exec(select(User).where(User.id == user_id)).first()
            if user:
                variables['name'] = user.display_name or str(user.username)
            else:
                variables['name'] = str(user_id)
        except Exception as e:
            logger.warning(f"ユーザー情報の取得に失敗しました (user_id: {user_id}): {e}")
            variables['name'] = str(user_id)
    else:
        variables['name'] = "Unknown"
    
    return variables


def _apply_automatic_variables(prompt_content: str, db: Session, user_id: Optional[int] = None) -> str:
    """
    プロンプト内容に自動変数を適用します。
    変数が存在しない場合はエラーを出さずにそのまま返します。
    
    Args:
        prompt_content (str): プロンプト内容
        db (Session): データベースセッション
        user_id (Optional[int]): ユーザーID
        
    Returns:
        str: 変数が置換されたプロンプト内容
    """
    if not prompt_content:
        return prompt_content
    
    # 自動変数を取得
    auto_vars = _get_automatic_variables(db, user_id)
    
    # {today} と {name} を安全に置換（存在しない場合はそのまま）
    result = prompt_content
    for var_name, var_value in auto_vars.items():
        print(f"DEBUG: 変数 {var_name} の値: {var_value}")
        pattern = f"{{{var_name}}}"
        if pattern in result:
            result = result.replace(pattern, var_value)
            logger.debug(f"変数 {pattern} を '{var_value}' に置換しました")
    
    #print(f"DEBUG: プロンプト内容に自動変数を適用後の結果: {result}")
    
    return result


def get_effective_prompt_content(
    db: Session,
    prompt_type: PromptType,
    user_id: Optional[int] = None,
    system_prompt_id: Optional[int] = None,
    **format_kwargs
) -> str:
    """
    有効なプロンプト内容を取得し、必要に応じて変数置換を行います。
    
    Args:
        db (Session): データベースセッション
        prompt_type (PromptType): プロンプトタイプ
        user_id (Optional[int]): ユーザーID（None の場合はデフォルトのみ）
        **format_kwargs: プロンプト内の変数を置換するためのキーワード引数
        
    Returns:
        str: フォーマット済みのプロンプト文字列（または未フォーマットの文字列）
        
    Raises:
        ValueError: プロンプトタイプが無効な場合
        KeyError: 必要な変数が提供されていない場合（フォーマット時）
    """
    prompt_to_process = ""
    is_custom = False
    
    try:
        if user_id and system_prompt_id:
            # ユーザーのカスタムプロンプトをIDで検索
            custom_prompt_model = db.exec(
                select(SystemPrompt).where(
                    and_(
                        SystemPrompt.id == system_prompt_id,
                        SystemPrompt.user_id == user_id,
                        SystemPrompt.is_active == True
                    )
                )
            ).first()

            if custom_prompt_model:
                prompt_to_process = custom_prompt_model.prompt
                is_custom = True

        
        if not is_custom:
            default_data = get_default_prompt(prompt_type)
            prompt_to_process = default_data["prompt"]

        print(f"DEBUG: 有効なプロンプトを取得しました（タイプ: {prompt_type.value}, ユーザー: {user_id if user_id else 'N/A'}, カスタム: {is_custom}, プロンプトid: {system_prompt_id if system_prompt_id else 'N/A'}）")

        # 1. まず自動変数（{today}, {name}）を適用
        prompt_to_process = _apply_automatic_variables(prompt_to_process, db, user_id)

        # 2. format_kwargs が提供されている場合のみ追加フォーマットを試みる
        if format_kwargs:
            try:
                return prompt_to_process.format(**format_kwargs)
            except KeyError as e:
                logger.warning(
                    f"{'カスタム' if is_custom else 'デフォルト'}プロンプト（タイプ: {prompt_type.value}, ユーザー: {user_id if user_id else 'N/A'}）で変数 {e} が見つかりません。"
                    f"{'デフォルトプロンプトのフォーマットを試みます。' if is_custom else ''}"
                )
                if is_custom: # カスタムプロンプトのフォーマットでエラーが発生した場合、デフォルトプロンプトを試す
                    default_data_fallback = get_default_prompt(prompt_type)
                    prompt_to_process_fallback = default_data_fallback["prompt"]
                    # デフォルトプロンプトにも自動変数を適用
                    prompt_to_process_fallback = _apply_automatic_variables(prompt_to_process_fallback, db, user_id)
                    try:
                        return prompt_to_process_fallback.format(**format_kwargs)
                    except KeyError as e_default:
                        logger.error(f"デフォルトプロンプトのフォーマットでもKeyErrorが発生しました（タイプ: {prompt_type.value}）: {e_default}")
                        raise # エラーを再raiseして呼び出し元で処理
                raise # カスタムプロンプトがなく、デフォルトプロンプトのフォーマットでエラーが発生した場合
            except Exception as e_format:
                logger.error(
                    f"{'カスタム' if is_custom else 'デフォルト'}プロンプトのフォーマット中に予期せぬエラーが発生しました（タイプ: {prompt_type.value}）: {e_format}"
                )
                raise
        else:
            # format_kwargs が空の場合、自動変数適用済みのプロンプトを返す
            print(f"プロンプトをフォーマットせずに返します（タイプ: {prompt_type.value}, ユーザー: {user_id if user_id else 'N/A'}, プロンプトid: {system_prompt_id if system_prompt_id else 'N/A'}）")
            return prompt_to_process
            
    except Exception as e:
        logger.error(f"プロンプト取得または処理中にエラーが発生しました（タイプ: {prompt_type.value}）: {e}")
        raise


def get_effective_prompt_raw(
    db: Session,
    prompt_type: PromptType,
    user_id: Optional[int] = None,
    system_prompt_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    有効なプロンプトの生データを取得します（フォーマットなし）。
    
    Args:
        db (Session): データベースセッション
        prompt_type (PromptType): プロンプトタイプ
        user_id (Optional[int]): ユーザーID（None の場合はデフォルトのみ）
        
    Returns:
        Dict[str, Any]: プロンプト情報
            - content: プロンプト内容（未フォーマット）
            - is_custom: カスタムプロンプトかどうか
            - metadata: その他のメタデータ
    """

    print(f"get_effective_prompt_raw called with prompt_type: {prompt_type}, user_id: {user_id}, system_prompt_id: {system_prompt_id}")
    try:
        # ユーザーのカスタムプロンプトを検索
        if user_id and system_prompt_id:
            custom_prompt = db.exec(
                select(SystemPrompt).where(
                    and_(
                        SystemPrompt.id == system_prompt_id,
                        SystemPrompt.user_id == user_id,
                        SystemPrompt.is_active == True
                    )
                )
            ).first()

            if custom_prompt:
                return {
                    "content": custom_prompt.prompt,
                    "is_custom": True,
                    "metadata": {
                        "id": custom_prompt.id,
                        "name": custom_prompt.name,
                        "description": custom_prompt.description,
                        "category": custom_prompt.category,
                        "created_at": custom_prompt.created_at,
                        "updated_at": custom_prompt.updated_at,
                    }
                }
            

        
        # デフォルトプロンプトを取得
        default_data = get_default_prompt(prompt_type)
        return {
            "content": default_data["prompt"],
            "is_custom": False,
            "metadata": {
                "id": None,
                "name": default_data["name"],
                "description": default_data["description"],
                "category": default_data["category"],
                "created_at": None,
                "updated_at": None,
            }
        }
        
    except Exception as e:
        logger.error(f"プロンプト生データ取得中にエラーが発生しました（タイプ: {prompt_type.value}）: {e}")
        raise


@lru_cache(maxsize=128)
def get_cached_default_prompt(prompt_type_value: str) -> str:
    """
    デフォルトプロンプトをキャッシュして取得します。
    
    Args:
        prompt_type_value (str): プロンプトタイプの値
        
    Returns:
        str: デフォルトプロンプト内容
        
    Note:
        この関数はデフォルトプロンプトのみをキャッシュします。
        カスタムプロンプトは動的に変更される可能性があるためキャッシュしません。
    """
    try:
        prompt_type = PromptType(prompt_type_value)
        default_data = get_default_prompt(prompt_type)
        return default_data["prompt"]
    except Exception as e:
        logger.error(f"キャッシュされたデフォルトプロンプト取得中にエラーが発生しました（タイプ: {prompt_type_value}）: {e}")
        raise


def create_formatted_prompt(
    db: Session,
    prompt_type: PromptType,
    user_id: Optional[int] = None,
    fallback_to_default: bool = True,
    **format_kwargs
) -> str:
    """
    フォーマット済みプロンプトを作成します。
    
    Args:
        db (Session): データベースセッション
        prompt_type (PromptType): プロンプトタイプ
        user_id (Optional[int]): ユーザーID
        fallback_to_default (bool): エラー時にデフォルトプロンプトにフォールバックするかどうか
        **format_kwargs: プロンプト内の変数を置換するためのキーワード引数
        
    Returns:
        str: フォーマット済みのプロンプト文字列
        
    Raises:
        ValueError: プロンプト取得に失敗し、フォールバックが無効な場合
    """
    try:
        return get_effective_prompt_content(
            db=db,
            prompt_type=prompt_type,
            user_id=user_id,
            **format_kwargs
        )
    except Exception as e:
        if fallback_to_default:
            logger.warning(f"プロンプト取得エラー、デフォルトにフォールバック: {e}")
            try:
                # デフォルトプロンプトを取得し、必要ならフォーマット
                default_data = get_default_prompt(prompt_type)
                prompt_to_format = default_data["prompt"]
                if format_kwargs:
                    return prompt_to_format.format(**format_kwargs)
                return prompt_to_format
            except Exception as fallback_error:
                logger.error(f"デフォルトプロンプトでもエラーが発生しました: {fallback_error}")
                raise ValueError(f"プロンプト取得に失敗しました: {e}")
        else:
            raise


def validate_prompt_variables(prompt_content: str, required_vars: list) -> bool:
    """
    プロンプト内容に必要な変数が含まれているかを検証します。
    
    Args:
        prompt_content (str): プロンプト内容
        required_vars (list): 必要な変数のリスト
        
    Returns:
        bool: すべての必要な変数が含まれている場合True
    """
    try:
        # 簡単な検証: 必要な変数がプロンプト内に存在するかチェック
        for var in required_vars:
            if f"{{{var}}}" not in prompt_content and f"{{{var}:" not in prompt_content:
                logger.warning(f"必要な変数 '{var}' がプロンプト内に見つかりません")
                return False
        return True
    except Exception as e:
        logger.error(f"プロンプト変数検証中にエラーが発生しました: {e}")
        return False


# 既存コード用の便利関数群

def get_deepresearch_title_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepResearchのタイトル生成プロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_rag_no_tool_system_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.DEEPRESEARCH_TITLE_GENERATION, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRESEARCH_TITLE_GENERATION, user_id, **kwargs
    )


def get_deepresearch_coordinator_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepResearchのCoordinatorプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRESEARCH_COORDINATOR, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRESEARCH_COORDINATOR, user_id, **kwargs
    )


def get_deepresearch_planner_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepResearchのPlannerプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRESEARCH_PLANNER, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRESEARCH_PLANNER, user_id, **kwargs
    )


def get_deepresearch_supervisor_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepResearchのSupervisorプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRESEARCH_SUPERVISOR, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRESEARCH_SUPERVISOR, user_id, **kwargs
    )


def get_deepresearch_agent_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepResearchのAgentプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRESEARCH_AGENT, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRESEARCH_AGENT, user_id, **kwargs
    )


def get_deepresearch_summary_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepResearchのSummaryプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRESEARCH_SUMMARY, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRESEARCH_SUMMARY, user_id, **kwargs
    )


def get_deeprag_title_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepRAGのタイトル生成プロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_deeprag_title_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.DEEPRAG_TITLE_GENERATION, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRAG_TITLE_GENERATION, user_id, **kwargs
    )


def get_deeprag_coordinator_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepRAGのCoordinatorプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRAG_COORDINATOR, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRAG_COORDINATOR, user_id, **kwargs
    )


def get_deeprag_planner_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepRAGのPlannerプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRAG_PLANNER, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRAG_PLANNER, user_id, **kwargs
    )


def get_deeprag_supervisor_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepRAGのSupervisorプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRAG_SUPERVISOR, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRAG_SUPERVISOR, user_id, **kwargs
    )


def get_deeprag_agent_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepRAGのAgentプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRAG_AGENT, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRAG_AGENT, user_id, **kwargs
    )


def get_deeprag_summary_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """DeepRAGのSummaryプロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        return get_effective_prompt_content(
            db, PromptType.DEEPRAG_SUMMARY, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.DEEPRAG_SUMMARY, user_id, **kwargs
    )


def get_paper_summary_initial_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """論文要約初期版プロンプトを取得"""
    # このプロンプトは変数置換が不要なので、kwargsを渡さない
    # kwargsにsystem_prompt_idが含まれているなら取得する
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_paper_summary_initial_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.PAPER_SUMMARY_INITIAL, user_id, system_prompt_id=system_prompt_id
        )
    return get_effective_prompt_content(
        db, PromptType.PAPER_SUMMARY_INITIAL, user_id,
    )


def get_paper_summary_refinement_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """論文要約修正版プロンプトを取得"""
    # このプロンプトは変数置換が不要なので、kwargsを渡さない
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_paper_summary_refinement_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.PAPER_SUMMARY_REFINEMENT, user_id, system_prompt_id=system_prompt_id
        )
    return get_effective_prompt_content(
        db, PromptType.PAPER_SUMMARY_REFINEMENT, user_id
    )


def get_paper_summary_second_stage_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """論文要約2段階目プロンプトを取得"""
    # このプロンプトは {documents} と {summary} を期待する
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_paper_summary_second_stage_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.PAPER_SUMMARY_SECOND_STAGE, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.PAPER_SUMMARY_SECOND_STAGE, user_id, **kwargs
    )


def get_rag_base_system_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """
    RAGベースシステムプロンプトを取得（変数置換なし）
    
    Note: このプロンプトは呼び出し元で手動でformat()されるため、ここでは変数置換を行わない
    """
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_rag_base_system_prompt called with system_prompt_id: {system_prompt_id}")
        prompt_data = get_effective_prompt_raw(
            db, PromptType.RAG_BASE_SYSTEM_TEMPLATE, user_id, system_prompt_id=system_prompt_id
        )
    else:
        prompt_data = get_effective_prompt_raw(db, PromptType.RAG_BASE_SYSTEM_TEMPLATE, user_id)
    return prompt_data["content"]


def get_rag_no_tool_system_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """RAGノーツールシステムプロンプトを取得"""
    # このプロンプトは変数置換が不要なので、kwargsを渡さない
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_rag_no_tool_system_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.RAG_NO_TOOL_SYSTEM_TEMPLATE, user_id, system_prompt_id=system_prompt_id
        )
    return get_effective_prompt_content(
        db, PromptType.RAG_NO_TOOL_SYSTEM_TEMPLATE, user_id
    )


def get_rag_tool_prompt_parts(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """RAGツールプロンプト部品を取得"""
    # このプロンプトは {base_url_origin} を期待する
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_rag_tool_prompt_parts called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.RAG_TOOL_PROMPT_PARTS, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.RAG_TOOL_PROMPT_PARTS, user_id, **kwargs
    )


def get_rag_title_generation_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """RAGタイトル生成プロンプトを取得"""
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_rag_title_generation_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.RAG_TITLE_GENERATION, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.RAG_TITLE_GENERATION, user_id, **kwargs
    )


# 論文関連プロンプト取得関数
def get_paper_chat_system_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """論文チャットシステムプロンプトを取得"""
    # このプロンプトは変数置換が不要なので、kwargsを渡さない
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_paper_chat_system_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.PAPER_CHAT_SYSTEM_PROMPT, user_id, system_prompt_id=system_prompt_id
        )
    print(f"get_paper_chat_system_prompt called with user_id: {user_id}")
    return get_effective_prompt_content(
        db, PromptType.PAPER_CHAT_SYSTEM_PROMPT, user_id
    )


def get_paper_tag_selection_system_prompt(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """論文タグ選択システムプロンプトを取得"""
    # このプロンプトは変数置換が不要なので、kwargsを渡さない
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_paper_tag_selection_system_prompt called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.PAPER_TAG_SELECTION_SYSTEM_PROMPT, user_id, system_prompt_id=system_prompt_id
        )
    return get_effective_prompt_content(
        db, PromptType.PAPER_TAG_SELECTION_SYSTEM_PROMPT, user_id
    )


def get_paper_tag_selection_question_template(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """論文タグ選択クエリテンプレートを取得"""
    # このプロンプトは {cats_text} と {summary} を期待する
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_paper_tag_selection_question_template called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.PAPER_TAG_SELECTION_QUESTION_TEMPLATE, user_id, system_prompt_id=system_prompt_id, **kwargs
        )
    return get_effective_prompt_content(
        db, PromptType.PAPER_TAG_SELECTION_QUESTION_TEMPLATE, user_id, **kwargs
    )


def get_tag_categories_config(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """タグカテゴリー設定を取得"""
    # このプロンプトは変数置換が不要
    if "system_prompt_id" in kwargs:
        system_prompt_id = kwargs.pop("system_prompt_id")
        print(f"get_tag_categories_config called with system_prompt_id: {system_prompt_id}")
        return get_effective_prompt_content(
            db, PromptType.TAG_CATEGORIES_CONFIG, user_id, system_prompt_id=system_prompt_id
        )
    return get_effective_prompt_content(
        db, PromptType.TAG_CATEGORIES_CONFIG, user_id
    )


# キャラクターロールプレイ関連機能

def get_character_prompt(db: Session, user_id: Optional[int] = None, affinity_level: int = 0, character_override: Optional[str] = None) -> Optional[str]:
    """
    ユーザーの選択されたキャラクターに基づいてキャラクタープロンプトを取得します。
    
    Args:
        db (Session): データベースセッション
        user_id (Optional[int]): ユーザーID
        affinity_level (int): 好感度レベル（0=デフォルト、1-4=高いレベル）
        character_override (Optional[str]): キャラクター指定の上書き（None=ユーザー設定を使用）
        
    Returns:
        Optional[str]: キャラクタープロンプト文字列（キャラクターが選択されていない場合はNone）
    """
    print(f"[DEBUG] get_character_prompt called with user_id={user_id}, character_override={character_override}")
    selected_character = character_override
    
    # キャラクター上書きがない場合、ユーザー設定を確認
    if selected_character is None and user_id:
        try:
            user = db.exec(select(User).where(User.id == user_id)).first()
            print(f"[DEBUG] User found: {user}")
            if user and user.selected_character:
                selected_character = user.selected_character
                print(f"[DEBUG] Selected character from user: {selected_character}")
            else:
                print(f"[DEBUG] No user found or no selected_character set")
        except Exception as e:
            logger.error(f"ユーザー情報取得中にエラーが発生しました (user_id: {user_id}): {e}")
            return None
    
    print(f"[DEBUG] Final selected_character: {selected_character}")
    if not selected_character:
        print(f"[DEBUG] No character selected, returning None")
        return None
        
    try:
        # キャラクターに応じたプロンプトタイプを決定
        character_prompt_type = None
        if selected_character == "sakura":
            character_prompt_type = PromptType.CHARACTER_SAKURA
            print(f"[DEBUG] Set character_prompt_type to CHARACTER_SAKURA")
        elif selected_character == "miyuki":
            character_prompt_type = PromptType.CHARACTER_MIYUKI
            print(f"[DEBUG] Set character_prompt_type to CHARACTER_MIYUKI")
        else:
            print(f"[DEBUG] Unknown character: {selected_character}")
            logger.warning(f"未知のキャラクター選択: {selected_character}")
            return None
            
        # 現在は好感度レベル0のみサポート（将来の拡張用）
        if affinity_level != 0:
            logger.info(f"好感度レベル {affinity_level} が指定されましたが、現在はレベル0のみサポートしています")
            
        # キャラクタープロンプトを取得
        print(f"[DEBUG] Getting effective prompt content for {character_prompt_type}")
        character_prompt = get_effective_prompt_content(
            db=db,
            prompt_type=character_prompt_type,
            user_id=user_id
        )
        
        print(f"[DEBUG] Retrieved character_prompt: {character_prompt[:100] if character_prompt else 'None'}...")
        return character_prompt
        
    except Exception as e:
        logger.error(f"キャラクタープロンプト取得中にエラーが発生しました (user_id: {user_id}, character: {selected_character}): {e}")
        return None


def combine_prompts_with_character(db: Session, base_prompt: str, user_id: Optional[int] = None, affinity_level: int = 0, character_override: Optional[str] = None, task_type: Optional[RoleplayTaskType] = None) -> str:
    """
    ベースプロンプトとキャラクタープロンプトを結合します。
    
    Args:
        db (Session): データベースセッション
        base_prompt (str): ベースとなるプロンプト
        user_id (Optional[int]): ユーザーID
        affinity_level (int): 好感度レベル（0=デフォルト、1-4=高いレベル）
        character_override (Optional[str]): キャラクター指定の上書き（None=ユーザー設定を使用）
        task_type (Optional[RoleplayTaskType]): タスクタイプ（タスク別指示を挿入する場合）
        
    Returns:
        str: キャラクタープロンプトが結合されたプロンプト
    """
    print(f"[DEBUG] combine_prompts_with_character called with user_id={user_id}, task_type={task_type}")
    character_prompt = get_character_prompt(db, user_id, affinity_level, character_override)
    
    print(f"[DEBUG] Got character_prompt: {character_prompt[:100] if character_prompt else 'None'}...")
    if not character_prompt:
        print(f"[DEBUG] No character prompt, returning base prompt only")
        return base_prompt
    
    # タスク別指示を取得（task_typeが指定されている場合）
    if task_type:
        # まず選択されているキャラクターを特定
        selected_character = character_override
        if selected_character is None and user_id:
            try:
                user = db.exec(select(User).where(User.id == user_id)).first()
                if user and user.selected_character:
                    selected_character = user.selected_character
            except Exception as e:
                logger.error(f"ユーザー情報取得中にエラーが発生しました (user_id: {user_id}): {e}")
                selected_character = None
        
        if selected_character:
            task_instruction = get_task_instruction(task_type, selected_character)
            if task_instruction:
                # タスク別指示を追加（{name}変数を適用）
                task_instruction = _apply_automatic_variables(task_instruction, db, user_id)
                character_prompt = character_prompt + "\n\n" + task_instruction
                print(f"[DEBUG] Added task instruction for {task_type.value}")
        
    # キャラクタープロンプトをベースプロンプトの前に結合
    combined_prompt = character_prompt + "\n\nここまでがあなたの振る舞いを定義する内容です\n\n以降はあなたが実施しなければならないタスクです\n\n" + base_prompt
    
    print(f"[DEBUG] Combined prompt created (length: {len(combined_prompt)})")
    logger.debug(f"キャラクタープロンプトをベースプロンプトと結合しました (user_id: {user_id}, character: {character_override or 'user_setting'}, affinity_level: {affinity_level}, task_type: {task_type})")
    
    return combined_prompt


def get_paper_summary_initial_prompt_with_character(db: Session, user_id: Optional[int] = None, affinity_level: int = 0, character_override: Optional[str] = None, **kwargs) -> str:
    """キャラクタープロンプト付きの論文要約初期版プロンプトを取得"""
    base_prompt = get_paper_summary_initial_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, affinity_level, character_override, task_type=RoleplayTaskType.PAPER_SUMMARY)


def get_paper_summary_initial_prompt_with_default_character(db: Session, user_id: Optional[int] = None, force_default_prompt: bool = True, affinity_level: int = 0, character_override: Optional[str] = None, **kwargs) -> str:
    """
    デフォルトプロンプト+キャラクタープロンプトの論文要約初期版プロンプトを取得
    
    Args:
        db (Session): データベースセッション
        user_id (Optional[int]): ユーザーID
        force_default_prompt (bool): デフォルトプロンプトを強制使用するか
        affinity_level (int): 好感度レベル
        character_override (Optional[str]): キャラクター指定の上書き
        **kwargs: その他のパラメータ
        
    Returns:
        str: キャラクタープロンプトが結合されたプロンプト
    """
    if force_default_prompt:
        # system_prompt_idがkwargsにあっても無視してデフォルトプロンプトを取得
        kwargs.pop('system_prompt_id', None)
    
    base_prompt = get_paper_summary_initial_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, affinity_level, character_override, task_type=RoleplayTaskType.PAPER_SUMMARY)


def get_paper_chat_system_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きの論文チャットシステムプロンプトを取得"""
    base_prompt = get_paper_chat_system_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.PAPER_CHAT)


def get_rag_no_tool_system_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きのRAGノーツールシステムプロンプトを取得"""
    base_prompt = get_rag_no_tool_system_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.RAG_CHAT)


def get_rag_base_system_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きのRAGベースシステムプロンプトを取得（ツールあり）"""
    base_prompt = get_rag_base_system_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.RAG_CHAT)


def get_deepresearch_coordinator_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きのDeepResearch Coordinatorプロンプトを取得"""
    base_prompt = get_deepresearch_coordinator_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.DEEP_MODE)


def get_deepresearch_summary_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きのDeepResearch Summaryプロンプトを取得"""
    base_prompt = get_deepresearch_summary_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.DEEP_MODE)


def get_deeprag_coordinator_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きのDeepRAG Coordinatorプロンプトを取得"""
    base_prompt = get_deeprag_coordinator_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.DEEP_MODE)


def get_deeprag_summary_prompt_with_character(db: Session, user_id: Optional[int] = None, **kwargs) -> str:
    """キャラクタープロンプト付きのDeepRAG Summaryプロンプトを取得"""
    base_prompt = get_deeprag_summary_prompt(db, user_id, **kwargs)
    return combine_prompts_with_character(db, base_prompt, user_id, task_type=RoleplayTaskType.DEEP_MODE)