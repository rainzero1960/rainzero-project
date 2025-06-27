# backend/routers/images.py
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from pathlib import Path
import os
from auth_utils import get_current_active_user
from models import User

router = APIRouter(prefix="/backend/image", tags=["images"])

def get_image_root() -> Path:
    """画像フォルダのルートパスを取得"""
    current_dir = Path(__file__).parent.parent  # backend/
    return current_dir / "image"

@router.get("/thema{theme_number}/{filename}")
@router.head("/thema{theme_number}/{filename}")
async def get_theme_image(
    theme_number: int,
    filename: str,
    current_user: User = Depends(get_current_active_user)
):

    # パラメータの妥当性チェック
    if not 1 <= theme_number <= 7:
        raise HTTPException(status_code=400, detail="無効なテーマ番号です")
    
    # ファイル名の安全性チェック（パストラバーサル攻撃防止）
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="無効なファイル名です")
    
    # 画像ファイルパスを構築
    image_root = get_image_root()
    theme_folder = image_root / f"thema{theme_number}"
    
    # 拡張子を複数試行して実際のファイルを見つける
    supported_extensions = ['.webp', '.png', '.jpg', '.jpeg']
    base_filename = Path(filename).stem  # 拡張子を除いたファイル名
    
    found_image_path = None
    for ext in supported_extensions:
        candidate_path = theme_folder / f"{base_filename}{ext}"
        if candidate_path.exists() and candidate_path.is_file():
            found_image_path = candidate_path
            break
    
    # ファイルが見つからない場合
    if not found_image_path:
        raise HTTPException(status_code=404, detail="画像が見つかりません")
    
    return FileResponse(found_image_path)