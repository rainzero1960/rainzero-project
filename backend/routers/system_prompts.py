# backend/routers/system_prompts.py
"""
システムプロンプト管理API

このモジュールはシステムプロンプトのCRUD操作を提供します。
デフォルトプロンプトはdefault_prompts.pyで管理され、
ユーザーのカスタマイズはデータベースに保存されます。
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session, select, and_
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

from db import get_session
from models import SystemPrompt, User, CustomGeneratedSummary
from auth_utils import get_current_active_user
from schemas import (
    SystemPromptCreate, SystemPromptUpdate, SystemPromptRead,
    SystemPromptListResponse, PromptTypeInfo, PromptTypesResponse
)
from routers.module.default_prompts import (
    PromptType, PromptCategory, get_default_prompt, get_all_prompt_types,
    get_prompts_by_category, DEFAULT_PROMPTS
)

router = APIRouter(prefix="/system_prompts", tags=["system_prompts"])
logger = logging.getLogger(__name__)

# テスト用エンドポイント
@router.get("/test")
async def test_endpoint():
    """
    system_prompts routerのテスト用エンドポイント
    """
    return {"message": "system_prompts router is working", "status": "ok"}


def get_effective_prompt(
    db: Session, 
    prompt_type: str, 
    user_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    有効なプロンプトを取得します（カスタム > デフォルト の優先順）
    
    Args:
        db (Session): データベースセッション
        prompt_type (str): プロンプトタイプ
        user_id (Optional[int]): ユーザーID
        
    Returns:
        Dict[str, Any]: プロンプト情報
        
    Raises:
        HTTPException: プロンプトタイプが存在しない場合
    """
    print(f"[DEBUG] get_effective_prompt called with type={prompt_type}, user_id={user_id}")
    # プロンプトタイプの検証
    try:
        prompt_type_enum = PromptType(prompt_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効なプロンプトタイプです: {prompt_type}"
        )
    
    # ユーザーのカスタムプロンプトを検索
    if user_id:
        custom_prompt = db.exec(
            select(SystemPrompt).where(
                and_(
                    SystemPrompt.prompt_type == prompt_type,
                    SystemPrompt.user_id == user_id,
                    SystemPrompt.is_active == True
                )
            )
        ).first()
        
        if custom_prompt:
            return {
                "id": custom_prompt.id,
                "prompt_type": custom_prompt.prompt_type,
                "name": custom_prompt.name,
                "description": custom_prompt.description,
                "prompt": custom_prompt.prompt,
                "category": custom_prompt.category,
                "user_id": custom_prompt.user_id,
                "is_active": custom_prompt.is_active,
                "is_custom": True,
                "created_at": custom_prompt.created_at,
                "updated_at": custom_prompt.updated_at,
            }
    
    # デフォルトプロンプトを取得
    default_prompt = get_default_prompt(prompt_type_enum)
    print(f"[DEBUG] Default prompt for type {prompt_type}: {default_prompt}")
    return {
        "id": None,
        "prompt_type": prompt_type,
        "name": default_prompt["name"],
        "description": default_prompt["description"],
        "prompt": default_prompt["prompt"],
        "category": default_prompt["category"],
        "user_id": None,
        "is_active": True,
        "is_custom": False,
        "created_at": None,
        "updated_at": None,
    }


@router.get("/types", response_model=PromptTypesResponse)
async def get_prompt_types(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> PromptTypesResponse:
    """
    利用可能なプロンプトタイプ一覧を取得します。
    
    Returns:
        PromptTypesResponse: プロンプトタイプ一覧とカテゴリリスト
    """
    # ユーザーのカスタムプロンプトを取得
    user_customs = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.user_id == current_user.id,
                SystemPrompt.is_active == True
            )
        )
    ).all()
    custom_types = {custom.prompt_type for custom in user_customs}
    
    # プロンプトタイプ情報を構築
    prompt_types = []
    for prompt_type in get_all_prompt_types():
        default_data = get_default_prompt(prompt_type)
        has_custom = prompt_type.value in custom_types
        
        prompt_types.append(PromptTypeInfo(
            type=prompt_type.value,
            name=default_data["name"],
            description=default_data["description"],
            category=default_data["category"],
            has_custom=has_custom,
            is_active=True
        ))
    
    # カテゴリ一覧を取得
    categories = [category.value for category in PromptCategory]
    
    return PromptTypesResponse(
        prompt_types=prompt_types,
        categories=categories
    )


@router.get("/available-by-types", response_model=Dict[str, List[Dict[str, Any]]])
async def get_available_prompts_by_multiple_types(
    types: str = Query(..., description="カンマ区切りのプロンプトタイプリスト"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> Dict[str, List[Dict[str, Any]]]:
    """
    複数のプロンプトタイプで利用可能なプロンプト一覧を一括で取得します。
    """
    prompt_type_list = [t.strip() for t in types.split(',') if t.strip()]
    
    if not prompt_type_list:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="typesパラメータが空です"
        )

    results: Dict[str, List[Dict[str, Any]]] = {}

    # ユーザーのカスタムプロンプトを一度に取得して効率化
    user_custom_prompts = db.exec(
        select(SystemPrompt).where(
            SystemPrompt.user_id == current_user.id,
            SystemPrompt.prompt_type.in_(prompt_type_list),
            SystemPrompt.is_active == True
        )
    ).all()

    # カスタムプロンプトをタイプ別にグループ化
    custom_prompts_by_type: Dict[str, List[SystemPrompt]] = {}
    for p in user_custom_prompts:
        if p.prompt_type not in custom_prompts_by_type:
            custom_prompts_by_type[p.prompt_type] = []
        custom_prompts_by_type[p.prompt_type].append(p)

    for prompt_type in prompt_type_list:
        available_prompts = []
        
        # 1. デフォルトプロンプトを追加
        try:
            prompt_type_enum = PromptType(prompt_type)
            default_prompt = get_default_prompt(prompt_type_enum)
            
            available_prompts.append({
                "id": None,
                "name": f"デフォルト - {default_prompt['name']}",
                "description": default_prompt["description"],
                "type": "default",
                "prompt_type": prompt_type,
                "category": default_prompt["category"],
                "is_custom": False
            })
        except (ValueError, KeyError):
            # 無効なプロンプトタイプやデフォルトが存在しない場合
            pass
        
        # 2. 該当タイプのカスタムプロンプトを追加
        if prompt_type in custom_prompts_by_type:
            for prompt in sorted(custom_prompts_by_type[prompt_type], key=lambda p: p.name):
                available_prompts.append({
                    "id": prompt.id,
                    "name": prompt.name,
                    "description": prompt.description,
                    "type": "custom",
                    "prompt_type": prompt.prompt_type,
                    "category": prompt.category,
                    "is_custom": True,
                    "created_at": prompt.created_at.isoformat(),
                    "updated_at": prompt.updated_at.isoformat()
                })
        
        results[prompt_type] = available_prompts

    return results


@router.get("/available-for-summary", response_model=List[Dict[str, Any]])
async def get_available_prompts_for_summary(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> List[Dict[str, Any]]:
    """
    論文要約生成で利用可能なプロンプト一覧を取得します（複数カスタムプロンプト対応）。
    デフォルトプロンプトとユーザーの全カスタムプロンプトを含みます。
    
    Returns:
        List[Dict[str, Any]]: 利用可能なプロンプト一覧
    """
    print(f"[DEBUG] get_available_prompts_for_summary called for user {current_user.id}")
    available_prompts = []
    
    # 1. デフォルトプロンプトを追加
    available_prompts.append({
        "id": None,
        "name": "デフォルトプロンプト",
        "description": "システム標準の要約プロンプト",
        "type": "default",
        "prompt_type": "paper_summary_initial",
        "is_custom": False
    })
    
    # 2. ユーザーの全カスタムプロンプト（要約用）を取得
    custom_prompts = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.user_id == current_user.id,
                SystemPrompt.prompt_type == "paper_summary_initial",
                SystemPrompt.is_active == True
            )
        ).order_by(SystemPrompt.name)
    ).all()
    
    for prompt in custom_prompts:
        available_prompts.append({
            "id": prompt.id,
            "name": prompt.name,
            "description": prompt.description,
            "type": "custom",
            "prompt_type": prompt.prompt_type,
            "is_custom": True,
            "created_at": prompt.created_at.isoformat(),
            "updated_at": prompt.updated_at.isoformat()
        })
    
    return available_prompts


@router.get("/available-by-category/{category}", response_model=List[Dict[str, Any]])
async def get_available_prompts_by_category(
    category: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> List[Dict[str, Any]]:
    """
    特定カテゴリで利用可能なプロンプト一覧を取得します（RAGページのモード別選択用）。
    
    Args:
        category (str): プロンプトカテゴリ (DeepResearch, RAG, Paper 等)
        
    Returns:
        List[Dict[str, Any]]: 利用可能なプロンプト一覧
    """
    available_prompts = []
    
    # 1. 該当カテゴリのデフォルトプロンプトを取得
    try:
        category_enum = PromptCategory(category)
        default_prompts_in_category = get_prompts_by_category(category_enum)
        
        for prompt_type, prompt_data in default_prompts_in_category.items():
            available_prompts.append({
                "id": None,
                "name": f"デフォルト - {prompt_data['name']}",
                "description": prompt_data["description"],
                "type": "default",
                "prompt_type": prompt_type.value,
                "category": category,
                "is_custom": False
            })
    except ValueError:
        # 無効なカテゴリの場合は空リストを返す
        pass
    
    # 2. ユーザーの該当カテゴリのカスタムプロンプトを取得
    custom_prompts = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.user_id == current_user.id,
                SystemPrompt.category == category,
                SystemPrompt.is_active == True
            )
        ).order_by(SystemPrompt.prompt_type, SystemPrompt.name)
    ).all()
    
    for prompt in custom_prompts:
        available_prompts.append({
            "id": prompt.id,
            "name": prompt.name,
            "description": prompt.description,
            "type": "custom",
            "prompt_type": prompt.prompt_type,
            "category": prompt.category,
            "is_custom": True,
            "created_at": prompt.created_at.isoformat(),
            "updated_at": prompt.updated_at.isoformat()
        })
    
    return available_prompts


@router.get("/available-by-type/{prompt_type}", response_model=List[Dict[str, Any]])
async def get_available_prompts_by_type(
    prompt_type: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> List[Dict[str, Any]]:
    """
    特定プロンプトタイプで利用可能なプロンプト一覧を取得します。
    
    Args:
        prompt_type (str): プロンプトタイプ
        
    Returns:
        List[Dict[str, Any]]: 利用可能なプロンプト一覧
    """
    available_prompts = []
    
    # 1. デフォルトプロンプトを追加
    try:
        prompt_type_enum = PromptType(prompt_type)
        default_prompt = get_default_prompt(prompt_type_enum)
        
        available_prompts.append({
            "id": None,
            "name": f"デフォルト - {default_prompt['name']}",
            "description": default_prompt["description"],
            "type": "default",
            "prompt_type": prompt_type,
            "category": default_prompt["category"],
            "is_custom": False
        })
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効なプロンプトタイプです: {prompt_type}"
        )
    
    # 2. ユーザーの該当プロンプトタイプのカスタムプロンプトを取得
    custom_prompts = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.user_id == current_user.id,
                SystemPrompt.prompt_type == prompt_type,
                SystemPrompt.is_active == True
            )
        ).order_by(SystemPrompt.name)
    ).all()
    
    for prompt in custom_prompts:
        available_prompts.append({
            "id": prompt.id,
            "name": prompt.name,
            "description": prompt.description,
            "type": "custom",
            "prompt_type": prompt.prompt_type,
            "category": prompt.category,
            "is_custom": True,
            "created_at": prompt.created_at.isoformat(),
            "updated_at": prompt.updated_at.isoformat()
        })
    
    return available_prompts

# === 複数カスタムプロンプト管理API (新機能) ===

@router.post("/custom", response_model=SystemPromptRead)
async def create_multiple_custom_prompt(
    prompt_data: SystemPromptCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> SystemPromptRead:
    """
    複数カスタムプロンプトに対応した新しいプロンプト作成エンドポイント。
    同じプロンプトタイプでも名前が異なれば複数作成可能。
    
    Args:
        prompt_data (SystemPromptCreate): カスタムプロンプトデータ
        
    Returns:
        SystemPromptRead: 作成されたカスタムプロンプト
        
    Raises:
        HTTPException: プロンプトタイプが無効、または同名プロンプトが存在する場合
    """
    # プロンプトタイプの検証
    try:
        prompt_type_enum = PromptType(prompt_data.prompt_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効なプロンプトタイプです: {prompt_data.prompt_type}"
        )
    
    # 同名のカスタムプロンプトをチェック
    existing = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.name == prompt_data.name,
                SystemPrompt.user_id == current_user.id
            )
        )
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"プロンプト名 '{prompt_data.name}' は既に存在します。別の名前を使用してください。"
        )
    
    # カスタムプロンプトを作成
    custom_prompt = SystemPrompt(
        prompt_type=prompt_data.prompt_type,
        name=prompt_data.name,
        description=prompt_data.description,
        prompt=prompt_data.prompt,
        category=prompt_data.category,
        user_id=current_user.id,
        is_active=prompt_data.is_active
    )
    
    db.add(custom_prompt)
    db.commit()
    db.refresh(custom_prompt)
    
    return SystemPromptRead.model_validate(custom_prompt)


@router.get("/custom", response_model=SystemPromptListResponse)
async def get_all_custom_prompts(
    prompt_type: Optional[str] = Query(None, description="プロンプトタイプでフィルタリング"),
    category: Optional[str] = Query(None, description="カテゴリでフィルタリング"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> SystemPromptListResponse:
    """
    ユーザーの全カスタムプロンプト一覧を取得します（複数プロンプト対応）。
    
    Args:
        prompt_type (Optional[str]): プロンプトタイプフィルター
        category (Optional[str]): カテゴリフィルター
        
    Returns:
        SystemPromptListResponse: カスタムプロンプト一覧
    """
    # プロンプトタイプの検証（提供された場合のみ）
    if prompt_type:
        try:
            PromptType(prompt_type)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"無効なプロンプトタイプです: {prompt_type}. 有効な値: {[pt.value for pt in PromptType]}"
            )
    
    # カテゴリの検証（提供された場合のみ）
    if category:
        try:
            PromptCategory(category)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"無効なカテゴリです: {category}. 有効な値: {[cat.value for cat in PromptCategory]}"
            )
    
    # クエリを構築
    query = select(SystemPrompt).where(SystemPrompt.user_id == current_user.id)
    
    if prompt_type:
        query = query.where(SystemPrompt.prompt_type == prompt_type)
    
    if category:
        query = query.where(SystemPrompt.category == category)
    
    query = query.order_by(SystemPrompt.category, SystemPrompt.prompt_type, SystemPrompt.name)
    
    # プロンプトを取得
    custom_prompts = db.exec(query).all()
    
    # レスポンスを構築
    prompt_reads = [SystemPromptRead.model_validate(prompt) for prompt in custom_prompts]
    
    return SystemPromptListResponse(
        prompts=prompt_reads,
        total=len(prompt_reads)
    )


@router.get("/custom/{prompt_id}", response_model=SystemPromptRead)
async def get_custom_prompt_by_id(
    prompt_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> SystemPromptRead:
    """
    IDを指定してカスタムプロンプトを取得します。
    
    Args:
        prompt_id (int): プロンプトID
        
    Returns:
        SystemPromptRead: カスタムプロンプト
        
    Raises:
        HTTPException: プロンプトが見つからない場合
    """
    prompt = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.id == prompt_id,
                SystemPrompt.user_id == current_user.id
            )
        )
    ).first()
    
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID {prompt_id} のカスタムプロンプトが見つかりません。"
        )
    
    return SystemPromptRead.model_validate(prompt)


@router.put("/custom/{prompt_id}", response_model=SystemPromptRead)
async def update_custom_prompt_by_id(
    prompt_id: int,
    prompt_data: SystemPromptUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> SystemPromptRead:
    """
    IDを指定してカスタムプロンプトを更新します。
    
    Args:
        prompt_id (int): プロンプトID
        prompt_data (SystemPromptUpdate): 更新データ
        
    Returns:
        SystemPromptRead: 更新されたカスタムプロンプト
        
    Raises:
        HTTPException: プロンプトが見つからない、または名前が重複する場合
    """
    # 既存のカスタムプロンプトを取得
    existing = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.id == prompt_id,
                SystemPrompt.user_id == current_user.id
            )
        )
    ).first()
    
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID {prompt_id} のカスタムプロンプトが見つかりません。"
        )
    
    # 名前の重複チェック（名前が更新される場合のみ）
    if prompt_data.name and prompt_data.name != existing.name:
        name_conflict = db.exec(
            select(SystemPrompt).where(
                and_(
                    SystemPrompt.name == prompt_data.name,
                    SystemPrompt.user_id == current_user.id,
                    SystemPrompt.id != prompt_id
                )
            )
        ).first()
        
        if name_conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"プロンプト名 '{prompt_data.name}' は既に存在します。別の名前を使用してください。"
            )
    
    # 更新データを適用
    update_data = prompt_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(existing, field, value)
    
    existing.updated_at = datetime.utcnow()
    
    db.add(existing)
    db.commit()
    db.refresh(existing)
    
    return SystemPromptRead.model_validate(existing)


@router.get("/custom/{prompt_id}/related-summaries")
async def get_related_summaries_count(
    prompt_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> Dict[str, int]:
    """
    カスタムプロンプトに関連する要約の数を取得します。
    
    Args:
        prompt_id (int): プロンプトID
        
    Returns:
        Dict[str, int]: 関連する要約の数
        
    Raises:
        HTTPException: プロンプトが見つからない場合
    """
    # 既存のカスタムプロンプトを確認
    existing = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.id == prompt_id,
                SystemPrompt.user_id == current_user.id
            )
        )
    ).first()
    
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID {prompt_id} のカスタムプロンプトが見つかりません。"
        )
    
    # 関連するCustomGeneratedSummaryレコードを確認
    related_summaries_count = len(db.exec(
        select(CustomGeneratedSummary).where(
            and_(
                CustomGeneratedSummary.system_prompt_id == prompt_id,
                CustomGeneratedSummary.user_id == current_user.id
            )
        )
    ).all())
    
    return {"related_summaries_count": related_summaries_count}


@router.delete("/custom/{prompt_id}")
async def delete_custom_prompt_by_id(
    prompt_id: int,
    confirm: bool = Query(False, description="削除を確認済みかどうか"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> Dict[str, str]:
    """
    IDを指定してカスタムプロンプトを削除します。
    
    Args:
        prompt_id (int): プロンプトID
        confirm (bool): 削除を確認済みかどうか
        
    Returns:
        Dict[str, str]: 削除結果メッセージ
        
    Raises:
        HTTPException: プロンプトが見つからない場合、または確認されていない場合
    """
    # 既存のカスタムプロンプトを取得
    existing = db.exec(
        select(SystemPrompt).where(
            and_(
                SystemPrompt.id == prompt_id,
                SystemPrompt.user_id == current_user.id
            )
        )
    ).first()
    
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID {prompt_id} のカスタムプロンプトが見つかりません。"
        )
    
    # 削除確認のチェック
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="削除を実行するには confirm=true パラメータが必要です。"
        )
    
    # 関連するCustomGeneratedSummaryレコードを確認
    related_summaries = db.exec(
        select(CustomGeneratedSummary).where(
            and_(
                CustomGeneratedSummary.system_prompt_id == prompt_id,
                CustomGeneratedSummary.user_id == current_user.id
            )
        )
    ).all()
    
    # 関連する要約を削除
    for summary in related_summaries:
        db.delete(summary)
    
    # カスタムプロンプトを削除
    db.delete(existing)
    db.commit()
    
    deleted_summaries_count = len(related_summaries)
    if deleted_summaries_count > 0:
        return {
            "message": f"カスタムプロンプト '{existing.name}' と関連する{deleted_summaries_count}件の要約を削除しました。"
        }
    else:
        return {"message": f"カスタムプロンプト '{existing.name}' を削除しました。"}

@router.get("/{prompt_type}")
async def get_prompt(
    prompt_type: str,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_session)
) -> Dict[str, Any]:
    """
    特定のプロンプトタイプの設定を取得します
    ユーザIDを指定するとカスタムプロンプトが、指定しないとデフォルトプロンプトが取得されます。。
    
    Args:
        prompt_type (str): プロンプトタイプ
        
    Returns:
        Dict[str, Any]: プロンプト情報
    """

    return get_default_prompt(PromptType(prompt_type))
    
    #return get_effective_prompt(db, prompt_type, current_user.id)




# === 従来の単一カスタムプロンプトAPI（互換性維持） ===

# @router.post("/{prompt_type}", response_model=SystemPromptRead)
# async def create_custom_prompt(
#     prompt_type: str,
#     prompt_data: SystemPromptCreate,
#     current_user: User = Depends(get_current_active_user),
#     db: Session = Depends(get_session)
# ) -> SystemPromptRead:
#     """
#     特定のプロンプトタイプをカスタマイズします（従来API、互換性維持）。
    
#     Args:
#         prompt_type (str): プロンプトタイプ
#         prompt_data (SystemPromptCreate): カスタムプロンプトデータ
        
#     Returns:
#         SystemPromptRead: 作成されたカスタムプロンプト
        
#     Raises:
#         HTTPException: プロンプトタイプが無効、または既に存在する場合
#     """
#     # プロンプトタイプの検証
#     try:
#         prompt_type_enum = PromptType(prompt_type)
#     except ValueError:
#         raise HTTPException(
#             status_code=status.HTTP_400_BAD_REQUEST,
#             detail=f"無効なプロンプトタイプです: {prompt_type}"
#         )
    
#     # 既存のカスタムプロンプトをチェック
#     existing = db.exec(
#         select(SystemPrompt).where(
#             and_(
#                 SystemPrompt.prompt_type == prompt_type,
#                 SystemPrompt.user_id == current_user.id
#             )
#         )
#     ).first()
    
#     if existing:
#         raise HTTPException(
#             status_code=status.HTTP_409_CONFLICT,
#             detail=f"プロンプトタイプ '{prompt_type}' は既にカスタマイズされています。更新する場合はPUTを使用してください。"
#         )
    
#     # カスタムプロンプトを作成
#     custom_prompt = SystemPrompt(
#         prompt_type=prompt_type,
#         name=prompt_data.name,
#         description=prompt_data.description,
#         prompt=prompt_data.prompt,
#         category=prompt_data.category,
#         user_id=current_user.id,
#         is_active=prompt_data.is_active
#     )
    
#     db.add(custom_prompt)
#     db.commit()
#     db.refresh(custom_prompt)
    
#     return SystemPromptRead.model_validate(custom_prompt)


# @router.put("/{prompt_type}", response_model=SystemPromptRead)
# async def update_custom_prompt(
#     prompt_type: str,
#     prompt_data: SystemPromptUpdate,
#     current_user: User = Depends(get_current_active_user),
#     db: Session = Depends(get_session)
# ) -> SystemPromptRead:
#     """
#     特定のプロンプトタイプの設定を更新します。
    
#     Args:
#         prompt_type (str): プロンプトタイプ
#         prompt_data (SystemPromptUpdate): 更新データ
        
#     Returns:
#         SystemPromptRead: 更新されたカスタムプロンプト
        
#     Raises:
#         HTTPException: プロンプトタイプが無効、またはカスタムプロンプトが存在しない場合
#     """
#     # プロンプトタイプの検証
#     try:
#         prompt_type_enum = PromptType(prompt_type)
#     except ValueError:
#         raise HTTPException(
#             status_code=status.HTTP_400_BAD_REQUEST,
#             detail=f"無効なプロンプトタイプです: {prompt_type}"
#         )
    
#     # 既存のカスタムプロンプトを取得
#     existing = db.exec(
#         select(SystemPrompt).where(
#             and_(
#                 SystemPrompt.prompt_type == prompt_type,
#                 SystemPrompt.user_id == current_user.id
#             )
#         )
#     ).first()
    
#     if not existing:
#         raise HTTPException(
#             status_code=status.HTTP_404_NOT_FOUND,
#             detail=f"プロンプトタイプ '{prompt_type}' のカスタマイズが見つかりません。作成する場合はPOSTを使用してください。"
#         )
    
#     # 更新データを適用
#     update_data = prompt_data.model_dump(exclude_unset=True)
#     for field, value in update_data.items():
#         setattr(existing, field, value)
    
#     existing.updated_at = datetime.utcnow()
    
#     db.add(existing)
#     db.commit()
#     db.refresh(existing)
    
#     return SystemPromptRead.model_validate(existing)


# @router.delete("/{prompt_type}")
# async def delete_custom_prompt(
#     prompt_type: str,
#     current_user: User = Depends(get_current_active_user),
#     db: Session = Depends(get_session)
# ) -> Dict[str, str]:
#     """
#     特定のプロンプトタイプのカスタマイズを削除します（デフォルトに戻す）。
    
#     Args:
#         prompt_type (str): プロンプトタイプ
        
#     Returns:
#         Dict[str, str]: 削除結果メッセージ
        
#     Raises:
#         HTTPException: プロンプトタイプが無効、またはカスタムプロンプトが存在しない場合
#     """
#     # プロンプトタイプの検証
#     try:
#         prompt_type_enum = PromptType(prompt_type)
#     except ValueError:
#         raise HTTPException(
#             status_code=status.HTTP_400_BAD_REQUEST,
#             detail=f"無効なプロンプトタイプです: {prompt_type}"
#         )
    
#     # 既存のカスタムプロンプトを取得
#     existing = db.exec(
#         select(SystemPrompt).where(
#             and_(
#                 SystemPrompt.prompt_type == prompt_type,
#                 SystemPrompt.user_id == current_user.id
#             )
#         )
#     ).first()
    
#     if not existing:
#         raise HTTPException(
#             status_code=status.HTTP_404_NOT_FOUND,
#             detail=f"プロンプトタイプ '{prompt_type}' のカスタマイズが見つかりません。"
#         )
    
#     # カスタムプロンプトを削除
#     db.delete(existing)
#     db.commit()
    
#     return {"message": f"プロンプトタイプ '{prompt_type}' のカスタマイズを削除しました。デフォルト設定に戻ります。"}


# @router.get("", response_model=SystemPromptListResponse)
# async def get_custom_prompts(
#     category: Optional[str] = Query(None, description="カテゴリでフィルタリング"),
#     current_user: User = Depends(get_current_active_user),
#     db: Session = Depends(get_session)
# ) -> SystemPromptListResponse:
#     """
#     ユーザーのカスタマイズされたプロンプト一覧を取得します。
    
#     Args:
#         category (Optional[str]): カテゴリフィルター
        
#     Returns:
#         SystemPromptListResponse: カスタムプロンプト一覧
#     """
#     # クエリを構築
#     query = select(SystemPrompt).where(SystemPrompt.user_id == current_user.id)
    
#     if category:
#         query = query.where(SystemPrompt.category == category)
    
#     query = query.order_by(SystemPrompt.category, SystemPrompt.prompt_type)
    
#     # プロンプトを取得
#     custom_prompts = db.exec(query).all()
    
#     # レスポンスを構築
#     prompt_reads = [SystemPromptRead.model_validate(prompt) for prompt in custom_prompts]
    
#     return SystemPromptListResponse(
#         prompts=prompt_reads,
#         total=len(prompt_reads)
#     )


# @router.post("/{prompt_type}/reset")
# async def reset_to_default(
#     prompt_type: str,
#     current_user: User = Depends(get_current_active_user),
#     db: Session = Depends(get_session)
# ) -> Dict[str, Any]:
#     """
#     特定のプロンプトタイプをデフォルト設定にリセットします。
    
#     Args:
#         prompt_type (str): プロンプトタイプ
        
#     Returns:
#         Dict[str, Any]: リセット後のデフォルトプロンプト情報
        
#     Raises:
#         HTTPException: プロンプトタイプが無効な場合
#     """
#     # プロンプトタイプの検証
#     try:
#         prompt_type_enum = PromptType(prompt_type)
#     except ValueError:
#         raise HTTPException(
#             status_code=status.HTTP_400_BAD_REQUEST,
#             detail=f"無効なプロンプトタイプです: {prompt_type}"
#         )
    
#     # 既存のカスタムプロンプトがあれば削除
#     existing = db.exec(
#         select(SystemPrompt).where(
#             and_(
#                 SystemPrompt.prompt_type == prompt_type,
#                 SystemPrompt.user_id == current_user.id
#             )
#         )
#     ).first()
    
#     if existing:
#         db.delete(existing)
#         db.commit()
    
#     # デフォルトプロンプトを返す
#     return get_effective_prompt(db, prompt_type, None)