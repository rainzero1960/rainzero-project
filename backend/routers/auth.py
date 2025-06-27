# backend/routers/auth.py
from datetime import timedelta, datetime
import threading
import time
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select, delete

from auth_utils import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_password_hash,
    verify_password,
    get_current_active_user,
)
from db import get_session
# ★ 削除に必要なすべてのモデルをインポート
from models import (
    User, UserPaperLink, RagSession, ChatMessage, RagMessage, PaperChatSession,
    CustomGeneratedSummary, EditedSummary, SystemPrompt, SystemPromptGroup
)
from schemas import Token, UserCreate, UserRead, PasswordChangeRequest, ColorThemeUpdateRequest, DisplayNameUpdateRequest, BackgroundImagesUpdateRequest, AvailableBackgroundImagesResponse, CharacterSelectionUpdateRequest, AffinityLevelUpdateRequest
from vectorstore.manager import delete_vectors_by_metadata

router = APIRouter(prefix="/auth", tags=["auth"])

# 一括更新の進捗管理用データ構造
class BulkUpdateProgress:
    def __init__(self):
        self.is_running = False
        self.total_papers = 0
        self.processed_papers = 0
        self.start_time = None
        self.error_message = None
        self.user_id = None
    
    def reset(self, user_id: int, total_papers: int):
        self.is_running = True
        self.total_papers = total_papers
        self.processed_papers = 0
        self.start_time = time.time()
        self.error_message = None
        self.user_id = user_id
    
    def increment(self):
        self.processed_papers += 1
    
    def complete(self):
        self.is_running = False
    
    def set_error(self, error_message: str):
        self.error_message = error_message
        self.is_running = False
    
    def get_estimated_remaining_seconds(self) -> Optional[float]:
        if not self.is_running or self.processed_papers == 0:
            return None
        
        elapsed_time = time.time() - self.start_time
        rate = self.processed_papers / elapsed_time
        remaining_papers = self.total_papers - self.processed_papers
        
        if rate > 0:
            return remaining_papers / rate
        return None

# ユーザーごとの進捗状況を管理するグローバル辞書
bulk_update_progress: Dict[int, BulkUpdateProgress] = {}
progress_lock = threading.Lock()

@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, session: Session = Depends(get_session)):
    existing_user = session.exec(select(User).where(User.username == payload.username)).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    
    # ★ emailが空文字列の場合、Noneに変換
    email_to_save = payload.email if payload.email and payload.email.strip() else None

    if email_to_save: # ★ email_to_save が None でない場合のみ重複チェック
        existing_email = session.exec(select(User).where(User.email == email_to_save)).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

    hashed_password = get_password_hash(payload.password)
    user = User(
        username=payload.username,
        email=email_to_save,
        hashed_password=hashed_password,
        color_theme_light=payload.color_theme_light or "white",
        color_theme_dark=payload.color_theme_dark or "black"
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    user = session.exec(select(User).where(User.username == form_data.username)).first()
    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # ★ last_login を更新
    user.last_login = datetime.utcnow()
    session.add(user)
    session.commit()
    session.refresh(user) # 更新後の情報を反映（トークン生成には直接影響しないが念のため）

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "user_id": user.id}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    if not current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change password for users without a set password (e.g., OAuth users).",
        )
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password"
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="New password cannot be the same as the current password."
        )
    
    current_user.hashed_password = get_password_hash(payload.new_password)
    # current_user.updated_at = datetime.utcnow() # ★ この行を削除
    session.add(current_user)
    session.commit()
    return

@router.delete("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    user_id_to_delete = current_user.id
    print(f"--- Starting account deletion for user_id: {user_id_to_delete} ---")

    # 1. ベクトルストアから当該ユーザーのベクトルを削除
    try:
        print(f"Step 1: Deleting vectors for user_id: {user_id_to_delete}")
        delete_vectors_by_metadata(metadata_filter={"user_id": str(user_id_to_delete)})
        print(f"-> Vector deletion call executed for user_id: {user_id_to_delete}")
    except Exception as e:
        print(f"Warning: Failed to delete vectors for user_id {user_id_to_delete}: {e}")

    # 2. データベースから関連データを削除 (依存関係の末端から順に)
    
    # 2-1. EditedSummary (Userに直接紐づく)
    print("Step 2-1: Deleting EditedSummary records...")
    session.exec(delete(EditedSummary).where(EditedSummary.user_id == user_id_to_delete))
    
    # 2-2. CustomGeneratedSummary (Userに直接紐づく)
    print("Step 2-2: Deleting CustomGeneratedSummary records...")
    session.exec(delete(CustomGeneratedSummary).where(CustomGeneratedSummary.user_id == user_id_to_delete))

    # 2-3. SystemPromptGroup (Userに直接紐づく)
    print("Step 2-3: Deleting SystemPromptGroup records...")
    session.exec(delete(SystemPromptGroup).where(SystemPromptGroup.user_id == user_id_to_delete))

    # 2-4. SystemPrompt (Userに直接紐づく)
    print("Step 2-4: Deleting SystemPrompt records...")
    session.exec(delete(SystemPrompt).where(SystemPrompt.user_id == user_id_to_delete))

    # 2-5. RagSession とそれに紐づく RagMessage
    print("Step 2-5: Deleting RagSession and RagMessage records...")
    rag_sessions_to_delete = session.exec(select(RagSession).where(RagSession.user_id == user_id_to_delete)).all()
    for rag_sess in rag_sessions_to_delete:
        session.exec(delete(RagMessage).where(RagMessage.session_id == rag_sess.id))
        session.delete(rag_sess)

    # 2-6. UserPaperLink とそれに紐づく PaperChatSession, ChatMessage
    print("Step 2-6: Deleting UserPaperLink and related chat records...")
    user_paper_links_to_delete = session.exec(
        select(UserPaperLink).where(UserPaperLink.user_id == user_id_to_delete)
    ).all()
    
    for link in user_paper_links_to_delete:
        # PaperChatSession に紐づく ChatMessage はカスケード削除されるので、PaperChatSession の削除だけでOK
        session.exec(delete(PaperChatSession).where(PaperChatSession.user_paper_link_id == link.id))
        
        # PaperChatSession に紐づかない古い ChatMessage も削除
        session.exec(delete(ChatMessage).where(ChatMessage.user_paper_link_id == link.id))
        
        # 最後に UserPaperLink を削除
        session.delete(link)

    # 3. User レコードを削除
    print(f"Step 3: Deleting User record for user_id: {user_id_to_delete}")
    session.delete(current_user)
    
    # 4. 変更をコミット
    try:
        session.commit()
        print(f"--- Account deletion successful for user_id: {user_id_to_delete} ---")
    except Exception as e:
        print(f"--- CRITICAL: Final commit failed during account deletion for user_id: {user_id_to_delete} ---")
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"アカウント削除の最終処理に失敗しました: {e}"
        )

    return

@router.get("/me", response_model=UserRead)
async def get_current_user_info(current_user: User = Depends(get_current_active_user)):
    """現在のユーザー情報を取得"""
    return current_user

@router.put("/color-theme", response_model=UserRead)
async def update_color_theme(
    payload: ColorThemeUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    """ユーザーのカラーテーマを更新"""
    if payload.color_theme_light is not None:
        current_user.color_theme_light = payload.color_theme_light
    if payload.color_theme_dark is not None:
        current_user.color_theme_dark = payload.color_theme_dark
    
    """ユーザーの画像表示を01-01にリセット（必ず存在するものに戻さないといけない）"""
    current_user.chat_background_dark_set = "01-01"
    current_user.chat_background_light_set = "01-01"
    current_user.rag_background_dark_set = "01-01"
    current_user.rag_background_light_set = "01-01"
    
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@router.put("/display-name", response_model=UserRead)
async def update_display_name(
    payload: DisplayNameUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    """ユーザーの表示名を更新"""
    # display_nameが空文字列の場合はNoneに変換
    display_name_to_save = payload.display_name if payload.display_name and payload.display_name.strip() else None
    current_user.display_name = display_name_to_save
    
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@router.put("/character-selection", response_model=UserRead)
async def update_character_selection(
    payload: CharacterSelectionUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    """ユーザーの選択キャラクターを更新"""
    # selected_characterの値を検証
    valid_characters = ["sakura", "miyuki", None]
    selected_character_to_save = payload.selected_character
    
    if selected_character_to_save is not None and selected_character_to_save not in ["sakura", "miyuki"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid character selection. Must be 'sakura', 'miyuki', or null."
        )
    
    # selected_characterが空文字列の場合はNoneに変換
    if selected_character_to_save == "":
        selected_character_to_save = None
    
    current_user.selected_character = selected_character_to_save
    
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@router.put("/affinity-level", response_model=UserRead)
async def update_affinity_level(
    payload: AffinityLevelUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    """ユーザーのキャラクター好感度レベルを更新"""
    
    # 好感度レベルの値を検証（0-4の範囲）
    if payload.sakura_affinity_level is not None:
        if not (0 <= payload.sakura_affinity_level <= 4):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sakura affinity level must be between 0 and 4."
            )
        current_user.sakura_affinity_level = payload.sakura_affinity_level
    
    if payload.miyuki_affinity_level is not None:
        if not (0 <= payload.miyuki_affinity_level <= 4):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Miyuki affinity level must be between 0 and 4."
            )
        current_user.miyuki_affinity_level = payload.miyuki_affinity_level
    
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@router.put("/background-images", response_model=UserRead)
async def update_background_images(
    payload: BackgroundImagesUpdateRequest,
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    """ユーザーの背景画像設定を更新"""
    from utils.backend_image_manager import validate_user_image_selection
    
    # 更新するフィールドを構築
    selected_sets = {}
    if payload.chat_background_dark_set is not None:
        selected_sets["chat-background-dark"] = payload.chat_background_dark_set
    if payload.chat_background_light_set is not None:
        selected_sets["chat-background-light"] = payload.chat_background_light_set
    if payload.rag_background_dark_set is not None:
        selected_sets["rag-background-dark"] = payload.rag_background_dark_set
    if payload.rag_background_light_set is not None:
        selected_sets["rag-background-light"] = payload.rag_background_light_set
    
    # ポイント要件のバリデーション
    validation_result = validate_user_image_selection(current_user.points, selected_sets)
    
    invalid_selections = [img_type for img_type, is_valid in validation_result.items() if not is_valid]
    if invalid_selections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"ポイント不足により選択できない画像があります: {', '.join(invalid_selections)}"
        )
    
    # 各フィールドを更新
    if payload.chat_background_dark_set is not None:
        current_user.chat_background_dark_set = payload.chat_background_dark_set
    if payload.chat_background_light_set is not None:
        current_user.chat_background_light_set = payload.chat_background_light_set
    if payload.rag_background_dark_set is not None:
        current_user.rag_background_dark_set = payload.rag_background_dark_set
    if payload.rag_background_light_set is not None:
        current_user.rag_background_light_set = payload.rag_background_light_set
    
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user

@router.get("/available-background-images", response_model=AvailableBackgroundImagesResponse)
async def get_available_background_images(
    current_user: User = Depends(get_current_active_user),
):
    """現在のユーザーのテーマ設定とポイントで利用可能な背景画像を取得"""
    from utils.backend_image_manager import get_available_images_for_user
    
    # ユーザーのテーマ設定を取得
    light_theme = current_user.color_theme_light or "white"
    dark_theme = current_user.color_theme_dark or "white"
    user_points = current_user.points
    
    # 利用可能な画像情報を取得
    result = get_available_images_for_user(light_theme, dark_theme, user_points)
    
    return result

@router.get("/backend/image/{theme_folder}/{filename}")
async def serve_backend_image(
    theme_folder: str, 
    filename: str,
    current_user: User = Depends(get_current_active_user),
):
    """バックエンド画像ファイルを配信（認証必須）"""
    from utils.backend_image_manager import get_backend_image_root
    
    # セキュリティ: パス traversal 攻撃を防ぐ
    if ".." in theme_folder or ".." in filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    
    # テーマフォルダの検証（themaX形式）
    if not theme_folder.startswith("thema") or not theme_folder[5:].isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid theme folder")
    
    image_root = get_backend_image_root()
    file_path = image_root / theme_folder / filename
    
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    
    # MIME typeの設定
    media_type = "image/jpeg"
    if filename.lower().endswith(".png"):
        media_type = "image/png"
    elif filename.lower().endswith(".webp"):
        media_type = "image/webp"
    elif filename.lower().endswith(".jpg") or filename.lower().endswith(".jpeg"):
        media_type = "image/jpeg"
    
    # CORS ヘッダーを追加してブラウザからのアクセスを許可
    from fastapi.responses import Response
    
    with open(file_path, "rb") as f:
        content = f.read()
    
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=3600",  # 1時間キャッシュ
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "*"
        }
    )

def bulk_update_character_selections_background(user_id: int, selected_character: Optional[str]):
    """バックグラウンドで一括更新を実行する関数"""
    from models import UserPaperLink, GeneratedSummary, CustomGeneratedSummary
    from db import get_session
    
    # 進捗状況を初期化
    with progress_lock:
        if user_id not in bulk_update_progress:
            bulk_update_progress[user_id] = BulkUpdateProgress()
        progress = bulk_update_progress[user_id]
    
    try:
        # 新しいセッションを作成（スレッドセーフ）
        with next(get_session()) as session:
            # ユーザーの全UserPaperLinkを取得
            user_paper_links = session.exec(
                select(UserPaperLink).where(UserPaperLink.user_id == user_id)
            ).all()
            
            # 進捗状況を設定
            progress.reset(user_id, len(user_paper_links))
            
            updated_count = 0
            
            for link in user_paper_links:
                try:
                    needs_update = False
                    new_selected_generated_summary_id = link.selected_generated_summary_id
                    new_selected_custom_generated_summary_id = link.selected_custom_generated_summary_id
                    
                    # 現在選択されている要約を取得
                    current_selected_summary = None
                    if link.selected_custom_generated_summary_id:
                        current_selected_summary = session.exec(
                            select(CustomGeneratedSummary).where(
                                CustomGeneratedSummary.id == link.selected_custom_generated_summary_id
                            )
                        ).first()
                    elif link.selected_generated_summary_id:
                        current_selected_summary = session.exec(
                            select(GeneratedSummary).where(
                                GeneratedSummary.id == link.selected_generated_summary_id
                            )
                        ).first()
                    
                    # 整合性チェック
                    if current_selected_summary and selected_character:
                        character_role = getattr(current_selected_summary, 'character_role', None)
                        if character_role != selected_character:
                            needs_update = True
                            
                            # 選択キャラクターの最適な要約を探す
                            best_summary = None
                            best_type = None
                            
                            # 1. 選択キャラクターのカスタム要約を探す
                            custom_summaries = session.exec(
                                select(CustomGeneratedSummary).where(
                                    CustomGeneratedSummary.user_id == user_id,
                                    CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                    CustomGeneratedSummary.character_role == selected_character
                                ).order_by(CustomGeneratedSummary.id.desc())
                            ).all()
                            
                            if custom_summaries:
                                for summary in custom_summaries:
                                    if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                        not summary.llm_abst.startswith("[PROCESSING")):
                                        best_summary = summary
                                        best_type = 'custom'
                                        break
                            
                            # 2. カスタム要約がない場合、デフォルト要約を探す
                            if not best_summary:
                                default_summaries = session.exec(
                                    select(GeneratedSummary).where(
                                        GeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                        GeneratedSummary.character_role == selected_character
                                    ).order_by(GeneratedSummary.id.desc())
                                ).all()
                                
                                if default_summaries:
                                    for summary in default_summaries:
                                        if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                            not summary.llm_abst.startswith("[PROCESSING")):
                                            best_summary = summary
                                            best_type = 'default'
                                            break
                            
                            # 3. 選択キャラクターの要約がない場合、キャラクターなしの要約を優先選択
                            if not best_summary:
                                # キャラクターなしのカスタム要約から探す
                                characterless_custom_summaries = session.exec(
                                    select(CustomGeneratedSummary).where(
                                        CustomGeneratedSummary.user_id == user_id,
                                        CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                        CustomGeneratedSummary.character_role.is_(None)
                                    ).order_by(CustomGeneratedSummary.id.desc())
                                ).all()
                                
                                for summary in characterless_custom_summaries:
                                    if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                        not summary.llm_abst.startswith("[PROCESSING")):
                                        best_summary = summary
                                        best_type = 'custom'
                                        break
                                
                                # キャラクターなしのデフォルト要約から探す
                                if not best_summary:
                                    characterless_default_summaries = session.exec(
                                        select(GeneratedSummary).where(
                                            GeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                            GeneratedSummary.character_role.is_(None)
                                        ).order_by(GeneratedSummary.id.desc())
                                    ).all()
                                    
                                    for summary in characterless_default_summaries:
                                        if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                            not summary.llm_abst.startswith("[PROCESSING")):
                                            best_summary = summary
                                            best_type = 'default'
                                            break
                                
                                # 4. 最後の手段：選択キャラクター以外の任意のキャラクターの要約を選択
                                if not best_summary:
                                    # 他のキャラクターのカスタム要約から探す
                                    other_character_custom_summaries = session.exec(
                                        select(CustomGeneratedSummary).where(
                                            CustomGeneratedSummary.user_id == user_id,
                                            CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                            CustomGeneratedSummary.character_role.is_not(None),
                                            CustomGeneratedSummary.character_role != selected_character
                                        ).order_by(CustomGeneratedSummary.id.desc())
                                    ).all()
                                    
                                    for summary in other_character_custom_summaries:
                                        if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                            not summary.llm_abst.startswith("[PROCESSING")):
                                            best_summary = summary
                                            best_type = 'custom'
                                            break
                                    
                                    # 他のキャラクターのデフォルト要約から探す
                                    if not best_summary:
                                        other_character_default_summaries = session.exec(
                                            select(GeneratedSummary).where(
                                                GeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                                GeneratedSummary.character_role.is_not(None),
                                                GeneratedSummary.character_role != selected_character
                                            ).order_by(GeneratedSummary.id.desc())
                                        ).all()
                                        
                                        for summary in other_character_default_summaries:
                                            if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                                not summary.llm_abst.startswith("[PROCESSING")):
                                                best_summary = summary
                                                best_type = 'default'
                                                break
                            
                            # 要約選択を更新
                            if best_summary:
                                if best_type == 'custom':
                                    new_selected_custom_generated_summary_id = best_summary.id
                                    new_selected_generated_summary_id = None
                                else:
                                    new_selected_generated_summary_id = best_summary.id
                                    new_selected_custom_generated_summary_id = None
                    
                    # 更新が必要な場合のみ実行
                    if needs_update:
                        link.selected_generated_summary_id = new_selected_generated_summary_id
                        link.selected_custom_generated_summary_id = new_selected_custom_generated_summary_id
                        session.add(link)
                        updated_count += 1
                    
                    # 進捗を更新
                    progress.increment()
                    
                except Exception as e:
                    print(f"Error processing paper link {link.id}: {str(e)}")
                    progress.increment()  # エラーでも進捗は進める
                    continue
            
            # 変更をコミット
            if updated_count > 0:
                session.commit()
            
            print(f"Background bulk update completed: Updated {updated_count} UserPaperLink records")
            progress.complete()
            
    except Exception as e:
        print(f"Background bulk update failed: {str(e)}")
        progress.set_error(str(e))

@router.put("/character-selection-bulk-update", response_model=UserRead)
async def bulk_update_character_selections(
    current_user: User = Depends(get_current_active_user),
    session: Session = Depends(get_session),
):
    """キャラクター変更時に関連するUserPaperLinkの選択要約を一括更新"""
    from models import UserPaperLink, GeneratedSummary, CustomGeneratedSummary
    
    selected_character = current_user.selected_character
    updated_count = 0
    
    # ユーザーの全UserPaperLinkを取得
    user_paper_links = session.exec(
        select(UserPaperLink).where(UserPaperLink.user_id == current_user.id)
    ).all()
    
    for link in user_paper_links:
        needs_update = False
        new_selected_generated_summary_id = link.selected_generated_summary_id
        new_selected_custom_generated_summary_id = link.selected_custom_generated_summary_id
        
        # 現在選択されている要約を取得
        current_selected_summary = None
        if link.selected_custom_generated_summary_id:
            current_selected_summary = session.exec(
                select(CustomGeneratedSummary).where(
                    CustomGeneratedSummary.id == link.selected_custom_generated_summary_id
                )
            ).first()
        elif link.selected_generated_summary_id:
            current_selected_summary = session.exec(
                select(GeneratedSummary).where(
                    GeneratedSummary.id == link.selected_generated_summary_id
                )
            ).first()
        
        # 整合性チェック
        if current_selected_summary and selected_character:
            character_role = getattr(current_selected_summary, 'character_role', None)
            if character_role and character_role != selected_character:
                needs_update = True
                
                # 選択キャラクターの最適な要約を探す
                best_summary = None
                best_type = None
                
                # 1. 選択キャラクターのカスタム要約を探す
                custom_summaries = session.exec(
                    select(CustomGeneratedSummary).where(
                        CustomGeneratedSummary.user_id == current_user.id,
                        CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                        CustomGeneratedSummary.character_role == selected_character
                    ).order_by(CustomGeneratedSummary.id.desc())
                ).all()
                
                if custom_summaries:
                    # PLACEHOLDERやPROCESSINGでない最新のものを選択
                    for summary in custom_summaries:
                        if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                            not summary.llm_abst.startswith("[PROCESSING")):
                            best_summary = summary
                            best_type = 'custom'
                            break
                
                # 2. カスタム要約がない場合、デフォルト要約を探す
                if not best_summary:
                    default_summaries = session.exec(
                        select(GeneratedSummary).where(
                            GeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                            GeneratedSummary.character_role == selected_character
                        ).order_by(GeneratedSummary.id.desc())
                    ).all()
                    
                    if default_summaries:
                        for summary in default_summaries:
                            if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                not summary.llm_abst.startswith("[PROCESSING")):
                                best_summary = summary
                                best_type = 'default'
                                break
                
                # 3. 選択キャラクターの要約がない場合、キャラクターなしの要約を優先選択
                if not best_summary:
                    # キャラクターなしのカスタム要約から探す
                    characterless_custom_summaries = session.exec(
                        select(CustomGeneratedSummary).where(
                            CustomGeneratedSummary.user_id == current_user.id,
                            CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                            CustomGeneratedSummary.character_role.is_(None)  # character_roleがNullの要約
                        ).order_by(CustomGeneratedSummary.id.desc())
                    ).all()
                    
                    for summary in characterless_custom_summaries:
                        if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                            not summary.llm_abst.startswith("[PROCESSING")):
                            best_summary = summary
                            best_type = 'custom'
                            break
                    
                    # キャラクターなしのデフォルト要約から探す
                    if not best_summary:
                        characterless_default_summaries = session.exec(
                            select(GeneratedSummary).where(
                                GeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                GeneratedSummary.character_role.is_(None)  # character_roleがNullの要約
                            ).order_by(GeneratedSummary.id.desc())
                        ).all()
                        
                        for summary in characterless_default_summaries:
                            if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                not summary.llm_abst.startswith("[PROCESSING")):
                                best_summary = summary
                                best_type = 'default'
                                break
                    
                    # 4. 最後の手段：選択キャラクター以外の任意のキャラクターの要約を選択
                    if not best_summary:
                        # 他のキャラクターのカスタム要約から探す
                        other_character_custom_summaries = session.exec(
                            select(CustomGeneratedSummary).where(
                                CustomGeneratedSummary.user_id == current_user.id,
                                CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                CustomGeneratedSummary.character_role.is_not(None),  # character_roleがある
                                CustomGeneratedSummary.character_role != selected_character  # 選択キャラクター以外
                            ).order_by(CustomGeneratedSummary.id.desc())
                        ).all()
                        
                        for summary in other_character_custom_summaries:
                            if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                not summary.llm_abst.startswith("[PROCESSING")):
                                best_summary = summary
                                best_type = 'custom'
                                break
                        
                        # 他のキャラクターのデフォルト要約から探す
                        if not best_summary:
                            other_character_default_summaries = session.exec(
                                select(GeneratedSummary).where(
                                    GeneratedSummary.paper_metadata_id == link.paper_metadata_id,
                                    GeneratedSummary.character_role.is_not(None),  # character_roleがある
                                    GeneratedSummary.character_role != selected_character  # 選択キャラクター以外
                                ).order_by(GeneratedSummary.id.desc())
                            ).all()
                            
                            for summary in other_character_default_summaries:
                                if (not summary.llm_abst.startswith("[PLACEHOLDER]") and 
                                    not summary.llm_abst.startswith("[PROCESSING")):
                                    best_summary = summary
                                    best_type = 'default'
                                    break
                
                # 要約選択を更新
                if best_summary:
                    if best_type == 'custom':
                        new_selected_custom_generated_summary_id = best_summary.id
                        new_selected_generated_summary_id = None
                    else:
                        new_selected_generated_summary_id = best_summary.id
                        new_selected_custom_generated_summary_id = None
        
        # 更新が必要な場合のみ実行
        if needs_update:
            link.selected_generated_summary_id = new_selected_generated_summary_id
            link.selected_custom_generated_summary_id = new_selected_custom_generated_summary_id
            session.add(link)
            updated_count += 1
    
    # 変更をコミット
    if updated_count > 0:
        session.commit()
    
    print(f"Updated {updated_count} UserPaperLink records for character consistency")
    return current_user

@router.put("/character-selection-bulk-update-async")
async def bulk_update_character_selections_async(
    current_user: User = Depends(get_current_active_user),
):
    """キャラクター変更時の一括更新をバックグラウンドで開始"""
    
    # 既に進行中の処理があるかチェック
    with progress_lock:
        if current_user.id in bulk_update_progress:
            existing_progress = bulk_update_progress[current_user.id]
            if existing_progress.is_running:
                return {
                    "message": "Bulk update is already running",
                    "is_running": True,
                    "total_papers": existing_progress.total_papers,
                    "processed_papers": existing_progress.processed_papers
                }
    
    # バックグラウンドで一括更新を開始
    thread = threading.Thread(
        target=bulk_update_character_selections_background,
        args=(current_user.id, current_user.selected_character)
    )
    thread.daemon = True
    thread.start()
    
    return {
        "message": "Bulk update started in background",
        "is_running": True
    }

@router.get("/character-selection-bulk-update-progress")
async def get_bulk_update_progress(
    current_user: User = Depends(get_current_active_user),
):
    """一括更新の進捗状況を取得"""
    
    with progress_lock:
        if current_user.id not in bulk_update_progress:
            return {
                "is_running": False,
                "total_papers": 0,
                "processed_papers": 0,
                "estimated_remaining_seconds": None,
                "error_message": None
            }
        
        progress = bulk_update_progress[current_user.id]
        
        return {
            "is_running": progress.is_running,
            "total_papers": progress.total_papers,
            "processed_papers": progress.processed_papers,
            "estimated_remaining_seconds": progress.get_estimated_remaining_seconds(),
            "error_message": progress.error_message
        }