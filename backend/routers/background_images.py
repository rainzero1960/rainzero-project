# backend/routers/background_images.py
from fastapi import APIRouter, HTTPException, Depends
from auth_utils import get_current_active_user
from models import User
from typing import Dict, List
from utils.backend_image_manager import get_available_images_for_user, THEME_FOLDER_MAP, get_backend_image_root, SUPPORTED_EXTENSIONS
from pathlib import Path

router = APIRouter(prefix="/background-images", tags=["background-images"])

@router.get("/user-image-info")
async def get_user_background_image_info(
    current_user: User = Depends(get_current_active_user)
):
    """ユーザーの設定に基づいて実際の背景画像ファイル情報を取得"""
    
    # ユーザーのテーマとセット設定を取得
    light_theme = current_user.color_theme_light or "white"
    dark_theme = current_user.color_theme_dark or "white"
    
    light_theme_number = THEME_FOLDER_MAP.get(light_theme, 1)
    dark_theme_number = THEME_FOLDER_MAP.get(dark_theme, 1)
    
    # 背景画像設定を取得
    chat_dark_set = current_user.chat_background_dark_set or "01-01"
    chat_light_set = current_user.chat_background_light_set or "01-01"
    rag_dark_set = current_user.rag_background_dark_set or "01-01"
    rag_light_set = current_user.rag_background_light_set or "01-01"
    
    image_root = get_backend_image_root()
    
    def find_actual_image_file(theme_number: int, image_type: str, set_number: str) -> str | None:
        """実際に存在する画像ファイルを見つけて完全なファイル名を返す"""
        theme_folder = image_root / f"thema{theme_number}"
        if not theme_folder.exists():
            return None
            
        base_filename = f"{image_type}{set_number}"
        for ext in SUPPORTED_EXTENSIONS:
            candidate_path = theme_folder / f"{base_filename}{ext}"
            if candidate_path.exists() and candidate_path.is_file():
                return f"{base_filename}{ext}"
        return None
    
    # 各画像タイプの実際のファイル名を取得
    result = {
        "chat-background-dark": find_actual_image_file(dark_theme_number, "chat-background-dark", chat_dark_set),
        "chat-background-light": find_actual_image_file(light_theme_number, "chat-background-light", chat_light_set),
        "rag-background-dark": find_actual_image_file(dark_theme_number, "rag-background-dark", rag_dark_set),
        "rag-background-light": find_actual_image_file(light_theme_number, "rag-background-light", rag_light_set),
        "themes": {
            "light_theme": light_theme,
            "dark_theme": dark_theme,
            "light_theme_number": light_theme_number,
            "dark_theme_number": dark_theme_number,
        },
        "sets": {
            "chat_dark_set": chat_dark_set,
            "chat_light_set": chat_light_set,
            "rag_dark_set": rag_dark_set,
            "rag_light_set": rag_light_set,
        }
    }
    
    return result