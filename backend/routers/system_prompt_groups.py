# knowledgepaper/backend/routers/system_prompt_groups.py
"""
システムプロンプトグループ管理API

DeepResearch/DeepRAGの5つのエージェント用プロンプトを
グループとして管理するためのCRUD API
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select, and_
from typing import Optional, List
import logging

from db import get_session
from models import SystemPromptGroup, User, SystemPrompt
from schemas import (
    SystemPromptGroupCreate,
    SystemPromptGroupUpdate, 
    SystemPromptGroupRead,
    SystemPromptGroupListResponse
)
from auth_utils import get_current_active_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system-prompt-groups", tags=["system-prompt-groups"])


@router.get("/", response_model=SystemPromptGroupListResponse)
def get_system_prompt_groups(
    category: Optional[str] = None,  # "deepresearch" or "deeprag"
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    ユーザーのシステムプロンプトグループ一覧を取得します。
    アクティブでないグループも含まれます。
    
    Args:
        category: カテゴリでフィルタ（"deepresearch" or "deeprag"）
        db: データベースセッション
        current_user: 現在のユーザー
        
    Returns:
        SystemPromptGroupListResponse: プロンプトグループ一覧
    """
    try:
        query = select(SystemPromptGroup).where(
            SystemPromptGroup.user_id == current_user.id
        )
        
        if category:
            if category not in ["deepresearch", "deeprag"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="カテゴリは 'deepresearch' または 'deeprag' である必要があります"
                )
            query = query.where(SystemPromptGroup.category == category)
            
        groups = db.exec(query.order_by(SystemPromptGroup.created_at.desc())).all()
        
        logger.info(f"プロンプトグループ一覧を取得しました（ユーザー: {current_user.id}, カテゴリ: {category}, 件数: {len(groups)}）")
        
        return SystemPromptGroupListResponse(
            groups=[SystemPromptGroupRead.model_validate(group) for group in groups],
            total=len(groups)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"プロンプトグループ一覧取得中にエラーが発生しました（ユーザー: {current_user.id}）: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロンプトグループ一覧の取得に失敗しました"
        )


@router.get("/{group_id}", response_model=SystemPromptGroupRead)
def get_system_prompt_group(
    group_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    指定されたIDのシステムプロンプトグループを取得します。
    
    Args:
        group_id: プロンプトグループID
        db: データベースセッション
        current_user: 現在のユーザー
        
    Returns:
        SystemPromptGroupRead: プロンプトグループ詳細
        
    Raises:
        HTTPException: グループが見つからない場合
    """
    try:
        group = db.exec(
            select(SystemPromptGroup).where(
                SystemPromptGroup.id == group_id,
                SystemPromptGroup.user_id == current_user.id
                # is_active == True の条件を削除し、非アクティブなものも取得可能にする
            )
        ).first()
        
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"プロンプトグループ（ID: {group_id}）が見つかりません"
            )
            
        logger.info(f"プロンプトグループを取得しました（ID: {group_id}, ユーザー: {current_user.id}）")
        return SystemPromptGroupRead.model_validate(group)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"プロンプトグループ取得中にエラーが発生しました（ID: {group_id}, ユーザー: {current_user.id}）: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロンプトグループの取得に失敗しました"
        )


@router.post("/", response_model=SystemPromptGroupRead, status_code=status.HTTP_201_CREATED)
def create_system_prompt_group(
    group_data: SystemPromptGroupCreate,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    新しいシステムプロンプトグループを作成します。
    
    Args:
        group_data: プロンプトグループ作成データ
        db: データベースセッション
        current_user: 現在のユーザー
        
    Returns:
        SystemPromptGroupRead: 作成されたプロンプトグループ
        
    Raises:
        HTTPException: 作成に失敗した場合
    """
    try:
        # カテゴリ検証
        if group_data.category not in ["deepresearch", "deeprag"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="カテゴリは 'deepresearch' または 'deeprag' である必要があります"
            )
        
        # 同名グループの重複チェック (is_activeに関わらず)
        existing_group = db.exec(
            select(SystemPromptGroup).where(
                SystemPromptGroup.name == group_data.name,
                SystemPromptGroup.user_id == current_user.id,
                SystemPromptGroup.category == group_data.category
            )
        ).first()
        
        if existing_group:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"同名のプロンプトグループ（{group_data.name}）が既に存在します"
            )
        
        # プロンプトIDの検証
        prompt_ids = [
            group_data.coordinator_prompt_id,
            group_data.planner_prompt_id,
            group_data.supervisor_prompt_id,
            group_data.agent_prompt_id,
            group_data.summary_prompt_id
        ]
        
        for prompt_id in prompt_ids:
            if prompt_id is not None:
                prompt = db.exec(
                    select(SystemPrompt).where(
                        SystemPrompt.id == prompt_id,
                        SystemPrompt.user_id == current_user.id,
                        SystemPrompt.is_active == True # 参照するプロンプトはアクティブである必要がある
                    )
                ).first()
                
                if not prompt:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"指定されたプロンプト（ID: {prompt_id}）が見つからないか、非アクティブです"
                    )
        
        # プロンプトグループ作成
        new_group = SystemPromptGroup(
            **group_data.model_dump(),
            user_id=current_user.id
        )
        
        db.add(new_group)
        db.commit()
        db.refresh(new_group)
        
        logger.info(f"プロンプトグループを作成しました（名前: {group_data.name}, ユーザー: {current_user.id}）")
        return SystemPromptGroupRead.model_validate(new_group)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"プロンプトグループ作成中にエラーが発生しました（ユーザー: {current_user.id}）: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロンプトグループの作成に失敗しました"
        )


@router.put("/{group_id}", response_model=SystemPromptGroupRead)
def update_system_prompt_group(
    group_id: int,
    group_data: SystemPromptGroupUpdate,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    システムプロンプトグループを更新します。
    
    Args:
        group_id: プロンプトグループID
        group_data: プロンプトグループ更新データ
        db: データベースセッション
        current_user: 現在のユーザー
        
    Returns:
        SystemPromptGroupRead: 更新されたプロンプトグループ
        
    Raises:
        HTTPException: 更新に失敗した場合
    """
    try:
        # 既存グループ取得 (is_activeに関わらず)
        group = db.exec(
            select(SystemPromptGroup).where(
                SystemPromptGroup.id == group_id,
                SystemPromptGroup.user_id == current_user.id
            )
        ).first()
        
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"プロンプトグループ（ID: {group_id}）が見つかりません"
            )
        
        # 同名グループの重複チェック（自分以外、is_activeに関わらず）
        if group_data.name is not None and group_data.name != group.name:
            existing_group_with_same_name = db.exec(
                select(SystemPromptGroup).where(
                    SystemPromptGroup.name == group_data.name,
                    SystemPromptGroup.user_id == current_user.id,
                    SystemPromptGroup.category == group.category, # カテゴリも考慮
                    SystemPromptGroup.id != group_id
                )
            ).first()
            
            if existing_group_with_same_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"同名のプロンプトグループ（{group_data.name}）が既に存在します"
                )
        
        # プロンプトIDの検証
        prompt_ids_to_check = [
            group_data.coordinator_prompt_id,
            group_data.planner_prompt_id,
            group_data.supervisor_prompt_id,
            group_data.agent_prompt_id,
            group_data.summary_prompt_id
        ]
        
        for prompt_id in prompt_ids_to_check:
            if prompt_id is not None: # Noneの場合はチェック不要
                prompt = db.exec(
                    select(SystemPrompt).where(
                        SystemPrompt.id == prompt_id,
                        SystemPrompt.user_id == current_user.id,
                        SystemPrompt.is_active == True # 参照するプロンプトはアクティブである必要がある
                    )
                ).first()
                
                if not prompt:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"指定されたプロンプト（ID: {prompt_id}）が見つからないか、非アクティブです"
                    )
        
        # 更新処理
        update_data = group_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(group, field, value)
        
        db.add(group)
        db.commit()
        db.refresh(group)
        
        logger.info(f"プロンプトグループを更新しました（ID: {group_id}, ユーザー: {current_user.id}）")
        return SystemPromptGroupRead.model_validate(group)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"プロンプトグループ更新中にエラーが発生しました（ID: {group_id}, ユーザー: {current_user.id}）: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロンプトグループの更新に失敗しました"
        )


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_system_prompt_group(
    group_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    システムプロンプトグループを削除（物理削除）します。
    
    Args:
        group_id: プロンプトグループID
        db: データベースセッション
        current_user: 現在のユーザー
        
    Raises:
        HTTPException: 削除に失敗した場合
    """
    try:
        # 既存グループ取得 (is_activeに関わらず)
        group = db.exec(
            select(SystemPromptGroup).where(
                SystemPromptGroup.id == group_id,
                SystemPromptGroup.user_id == current_user.id
            )
        ).first()
        
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"プロンプトグループ（ID: {group_id}）が見つかりません"
            )
        
        # 物理削除
        db.delete(group)
        db.commit()
        
        logger.info(f"プロンプトグループを物理削除しました（ID: {group_id}, ユーザー: {current_user.id}）")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"プロンプトグループ削除中にエラーが発生しました（ID: {group_id}, ユーザー: {current_user.id}）: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロンプトグループの削除に失敗しました"
        )


@router.get("/{group_id}/validate")
def validate_system_prompt_group(
    group_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    システムプロンプトグループの各プロンプトが適切な型かどうかを検証します。
    
    Args:
        group_id: プロンプトグループID
        db: データベースセッション
        current_user: 現在のユーザー
        
    Returns:
        dict: 検証結果
    """
    try:
        from routers.module.prompt_group_resolver import resolve_prompt_group, validate_prompt_group_prompts
        
        # グループ取得 (is_activeに関わらず)
        group = db.exec(
            select(SystemPromptGroup).where(
                SystemPromptGroup.id == group_id,
                SystemPromptGroup.user_id == current_user.id
            )
        ).first()
        
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"プロンプトグループ（ID: {group_id}）が見つかりません"
            )
        
        # プロンプトID解決
        # resolve_prompt_group は is_active=True のグループのみを対象とするため、
        # ここでは直接グループのプロンプトIDを使用する
        from routers.module.prompt_group_resolver import AgentPromptIds
        prompt_ids_for_validation = AgentPromptIds(
            coordinator=group.coordinator_prompt_id,
            planner=group.planner_prompt_id,
            supervisor=group.supervisor_prompt_id,
            agent=group.agent_prompt_id,
            summary=group.summary_prompt_id
        )
        
        # 検証実行
        is_valid = validate_prompt_group_prompts(db, prompt_ids_for_validation, current_user.id, group.category)
        
        logger.info(f"プロンプトグループを検証しました（ID: {group_id}, 結果: {is_valid}）")
        
        return {
            "group_id": group_id,
            "is_valid": is_valid,
            "prompt_ids": prompt_ids_for_validation._asdict(),
            "category": group.category
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"プロンプトグループ検証中にエラーが発生しました（ID: {group_id}）: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロンプトグループの検証に失敗しました"
        )