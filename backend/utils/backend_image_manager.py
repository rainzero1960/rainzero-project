# backend/utils/backend_image_manager.py
import os
import re
from typing import Dict, List, Set, Optional
from pathlib import Path

# テーマフォルダと色設定の対応関係
THEME_FOLDER_MAP = {
    "white": 1,
    "lightblue": 2, 
    "pink": 3,
    "orange": 4,
    "lightpurple": 5,
    "lightgreen": 6,
    "lightyellow": 7
}

# 画像タイプ定義
IMAGE_TYPES = [
    "chat-background-dark",
    "chat-background-light", 
    "rag-background-dark",
    "rag-background-light"
]

# サポートする画像拡張子
SUPPORTED_EXTENSIONS = [".webp", ".png", ".jpg", ".jpeg"]

# ポイント要件設定（カスタマイズ可能）
POINT_REQUIREMENTS = {
    "01-01": 0,    # 基本セット
    "01-02": 0,  # 100pt以上
    "01-03": 0,  # 200pt以上
    "01-04": 0,  # 300pt以上
    "01-05": 0,  # 500pt以上
    # 必要に応じて追加
}

def get_backend_image_root() -> Path:
    """バックエンド画像フォルダのルートパスを取得"""
    current_dir = Path(__file__).parent.parent  # backend/
    return current_dir / "image"

def extract_set_number_from_filename(filename: str) -> Optional[str]:
    """ファイル名からセット番号を抽出 (例: chat-background-dark01-01.png -> 01-01)"""
    # パターン: [prefix]01-01.[extension]
    pattern = r'(?:chat-background-(?:dark|light)|rag-background-(?:dark|light))(\d{2}-\d{2})\.'
    match = re.search(pattern, filename)
    return match.group(1) if match else None

def scan_available_image_sets_in_theme(theme_number: int) -> Set[str]:
    """指定されたテーマフォルダで利用可能なセット番号を取得"""
    image_root = get_backend_image_root()
    theme_folder = image_root / f"thema{theme_number}"
    
    if not theme_folder.exists():
        return set()
    
    available_sets = set()
    
    for file_path in theme_folder.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_EXTENSIONS:
            set_number = extract_set_number_from_filename(file_path.name)
            if set_number:
                available_sets.add(set_number)
    
    return available_sets

def get_image_path_for_set_and_type(theme_number: int, set_number: str, image_type: str) -> Optional[str]:
    """指定されたテーマ・セット・タイプの画像パスを取得"""
    image_root = get_backend_image_root()
    theme_folder = image_root / f"thema{theme_number}"
    
    if not theme_folder.exists():
        return None
    
    # ファイル名パターン: {image_type}{set_number}.{extension}
    base_filename = f"{image_type}{set_number}"
    
    for extension in SUPPORTED_EXTENSIONS:
        potential_path = theme_folder / f"{base_filename}{extension}"
        if potential_path.exists():
            # バックエンドAPIでアクセス可能なパスを返す
            # .webpで統一してフロントエンドに返し、バックエンド側で実際の拡張子を判定
            return f"/backend/image/thema{theme_number}/{base_filename}.webp"
    
    return None

def get_all_available_sets_with_points_filter(user_points: int) -> List[str]:
    """ユーザーのポイントに基づいて利用可能なセット番号一覧を取得"""
    available_sets = []
    
    for set_number, required_points in POINT_REQUIREMENTS.items():
        if user_points >= required_points:
            available_sets.append(set_number)
    
    # セット番号順にソート
    available_sets.sort()
    return available_sets

def get_available_images_for_user(user_light_theme: str, user_dark_theme: str, user_points: int) -> Dict:
    """ユーザーの設定とポイントに基づいて利用可能な画像情報を取得"""
    
    # テーマ番号を取得
    light_theme_number = THEME_FOLDER_MAP.get(user_light_theme, 1)
    dark_theme_number = THEME_FOLDER_MAP.get(user_dark_theme, 1)
    
    # ポイントに基づいて利用可能なセットを取得
    point_allowed_sets = set(get_all_available_sets_with_points_filter(user_points))
    
    # 各テーマで実際に存在するセットを取得
    light_existing_sets = scan_available_image_sets_in_theme(light_theme_number)
    dark_existing_sets = scan_available_image_sets_in_theme(dark_theme_number)
    
    # ポイント要件と実際の存在を両方満たすセットのみを対象
    light_available_sets = point_allowed_sets.intersection(light_existing_sets)
    dark_available_sets = point_allowed_sets.intersection(dark_existing_sets)
    
    # 各画像タイプで利用可能な画像情報を構築
    available_images = {
        "chat-background-dark": [],
        "chat-background-light": [],
        "rag-background-dark": [],
        "rag-background-light": []
    }
    
    # チャットダーク画像 (ダークテーマを使用)
    for set_number in sorted(dark_available_sets):
        image_path = get_image_path_for_set_and_type(dark_theme_number, set_number, "chat-background-dark")
        if image_path:
            available_images["chat-background-dark"].append({
                "set_number": set_number,
                "image_path": image_path,
                "required_points": POINT_REQUIREMENTS.get(set_number, 0)
            })
    
    # チャットライト画像 (ライトテーマを使用)
    for set_number in sorted(light_available_sets):
        image_path = get_image_path_for_set_and_type(light_theme_number, set_number, "chat-background-light")
        if image_path:
            available_images["chat-background-light"].append({
                "set_number": set_number,
                "image_path": image_path,
                "required_points": POINT_REQUIREMENTS.get(set_number, 0)
            })
    
    # RAGダーク画像 (ダークテーマを使用)
    for set_number in sorted(dark_available_sets):
        image_path = get_image_path_for_set_and_type(dark_theme_number, set_number, "rag-background-dark")
        if image_path:
            available_images["rag-background-dark"].append({
                "set_number": set_number,
                "image_path": image_path,
                "required_points": POINT_REQUIREMENTS.get(set_number, 0)
            })
    
    # RAGライト画像 (ライトテーマを使用)
    for set_number in sorted(light_available_sets):
        image_path = get_image_path_for_set_and_type(light_theme_number, set_number, "rag-background-light")
        if image_path:
            available_images["rag-background-light"].append({
                "set_number": set_number,
                "image_path": image_path,
                "required_points": POINT_REQUIREMENTS.get(set_number, 0)
            })
    
    return {
        "light_theme": {
            "theme_name": user_light_theme,
            "theme_number": light_theme_number
        },
        "dark_theme": {
            "theme_name": user_dark_theme,
            "theme_number": dark_theme_number
        },
        "user_points": user_points,
        "available_images": available_images
    }

def get_image_url_for_user_selection(
    user_light_theme: str,
    user_dark_theme: str,
    image_type: str,
    set_number: str
) -> Optional[str]:
    """ユーザーの選択に基づいて画像URLを取得"""
    
    # 画像タイプに応じてテーマを選択
    if image_type in ["chat-background-light", "rag-background-light"]:
        theme_number = THEME_FOLDER_MAP.get(user_light_theme, 1)
    else:  # dark系
        theme_number = THEME_FOLDER_MAP.get(user_dark_theme, 1)
    
    return get_image_path_for_set_and_type(theme_number, set_number, image_type)

def validate_user_image_selection(
    user_points: int,
    selected_sets: Dict[str, str]
) -> Dict[str, bool]:
    """ユーザーの画像選択がポイント要件を満たしているかバリデート"""
    
    validation_result = {}
    
    for image_type, set_number in selected_sets.items():
        if image_type not in IMAGE_TYPES:
            validation_result[image_type] = False
            continue
            
        required_points = POINT_REQUIREMENTS.get(set_number, 0)
        validation_result[image_type] = user_points >= required_points
    
    return validation_result