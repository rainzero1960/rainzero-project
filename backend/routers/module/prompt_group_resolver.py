# backend/routers/module/prompt_group_resolver.py
"""
プロンプトグループ解決ユーティリティ

システムプロンプトグループIDから各エージェント用の
個別プロンプトIDを解決する機能を提供します。
"""

from typing import Optional, Dict, Any, NamedTuple
from sqlmodel import Session, select
from models import SystemPromptGroup
import logging

logger = logging.getLogger(__name__)


class AgentPromptIds(NamedTuple):
    """各エージェント用のプロンプトID"""
    coordinator: Optional[int] = None
    planner: Optional[int] = None
    supervisor: Optional[int] = None
    agent: Optional[int] = None
    summary: Optional[int] = None


def resolve_prompt_group(
    db: Session,
    system_prompt_group_id: Optional[int],
    user_id: int,
    category: str  # "deepresearch" or "deeprag"
) -> AgentPromptIds:
    """
    プロンプトグループIDから各エージェント用のプロンプトIDを解決します。
    
    Args:
        db (Session): データベースセッション
        system_prompt_group_id (Optional[int]): プロンプトグループID（Noneの場合はデフォルト）
        user_id (int): ユーザーID
        category (str): "deepresearch" or "deeprag"
        
    Returns:
        AgentPromptIds: 各エージェント用のプロンプトID（Noneの場合はデフォルトプロンプト使用）
        
    Raises:
        ValueError: プロンプトグループが見つからない場合、またはカテゴリが一致しない場合
    """
    if system_prompt_group_id is None:
        # グループIDが指定されていない場合はすべてデフォルト
        logger.info(f"プロンプトグループIDが指定されていないため、すべてデフォルトプロンプトを使用します（ユーザー: {user_id}, カテゴリ: {category}）")
        return AgentPromptIds()
    
    try:
        # プロンプトグループを取得
        group = db.exec(
            select(SystemPromptGroup).where(
                SystemPromptGroup.id == system_prompt_group_id,
                SystemPromptGroup.user_id == user_id,
                SystemPromptGroup.category == category,
                SystemPromptGroup.is_active == True
            )
        ).first()
        
        if not group:
            logger.warning(f"プロンプトグループが見つかりません（ID: {system_prompt_group_id}, ユーザー: {user_id}, カテゴリ: {category}）。デフォルトプロンプトを使用します。")
            return AgentPromptIds()
        
        logger.info(f"プロンプトグループを解決しました（グループ名: {group.name}, ユーザー: {user_id}, カテゴリ: {category}）")
        
        return AgentPromptIds(
            coordinator=group.coordinator_prompt_id,
            planner=group.planner_prompt_id,
            supervisor=group.supervisor_prompt_id,
            agent=group.agent_prompt_id,
            summary=group.summary_prompt_id
        )
        
    except Exception as e:
        logger.error(f"プロンプトグループ解決中にエラーが発生しました（ID: {system_prompt_group_id}, ユーザー: {user_id}）: {e}")
        logger.warning("デフォルトプロンプトにフォールバックします")
        return AgentPromptIds()


def get_user_prompt_groups(
    db: Session,
    user_id: int,
    category: Optional[str] = None
) -> list[SystemPromptGroup]:
    """
    ユーザーのプロンプトグループ一覧を取得します。
    
    Args:
        db (Session): データベースセッション
        user_id (int): ユーザーID
        category (Optional[str]): カテゴリでフィルタ（"deepresearch" or "deeprag"）
        
    Returns:
        list[SystemPromptGroup]: プロンプトグループのリスト
    """
    try:
        query = select(SystemPromptGroup).where(
            SystemPromptGroup.user_id == user_id,
            SystemPromptGroup.is_active == True
        )
        
        if category:
            query = query.where(SystemPromptGroup.category == category)
            
        groups = db.exec(query.order_by(SystemPromptGroup.created_at.desc())).all()
        
        logger.info(f"ユーザーのプロンプトグループを取得しました（ユーザー: {user_id}, カテゴリ: {category}, 件数: {len(groups)}）")
        return list(groups)
        
    except Exception as e:
        logger.error(f"プロンプトグループ取得中にエラーが発生しました（ユーザー: {user_id}）: {e}")
        return []


def validate_prompt_group_prompts(
    db: Session,
    prompt_ids: AgentPromptIds,
    user_id: int,
    category: str
) -> bool:
    """
    プロンプトグループ内の各プロンプトIDが適切なタイプかどうかを検証します。
    
    Args:
        db (Session): データベースセッション
        prompt_ids (AgentPromptIds): 検証するプロンプトID群
        user_id (int): ユーザーID
        category (str): "deepresearch" or "deeprag"
        
    Returns:
        bool: すべてのプロンプトが適切な場合True
    """
    from models import SystemPrompt
    
    expected_types = {
        'coordinator': f"{category}_coordinator",
        'planner': f"{category}_planner", 
        'supervisor': f"{category}_supervisor",
        'agent': f"{category}_agent",
        'summary': f"{category}_summary"
    }
    
    try:
        for agent_name, prompt_id in prompt_ids._asdict().items():
            if prompt_id is not None:
                prompt = db.exec(
                    select(SystemPrompt).where(
                        SystemPrompt.id == prompt_id,
                        SystemPrompt.user_id == user_id,
                        SystemPrompt.is_active == True
                    )
                ).first()
                
                if not prompt:
                    logger.warning(f"プロンプトが見つかりません（ID: {prompt_id}, エージェント: {agent_name}）")
                    return False
                    
                expected_type = expected_types[agent_name]
                if prompt.prompt_type != expected_type:
                    logger.warning(f"プロンプトタイプが一致しません（ID: {prompt_id}, 期待: {expected_type}, 実際: {prompt.prompt_type}）")
                    return False
        
        return True
        
    except Exception as e:
        logger.error(f"プロンプトグループ検証中にエラーが発生しました: {e}")
        return False