# backend/utils/image_sets.py
"""
背景画像セット検出ユーティリティ

publicフォルダ内の画像ファイルを動的に検出し、利用可能な画像セットを返します。
"""

import os
import re
from typing import List, Dict, Set
from pathlib import Path

# テーマキーからフォルダ番号へのマッピング
THEME_FOLDER_MAP = {
    "white": 1,
    "lightblue": 2,
    "pink": 3,
    "orange": 4,
    "lightpurple": 5,
    "lightgreen": 6,
    "lightyellow": 7,
}

# 対応する拡張子（優先順位順）
SUPPORTED_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg']

# 画像タイプ
IMAGE_TYPES = ['chat-background-light', 'chat-background-dark', 'rag-background-light', 'rag-background-dark']


def get_project_root() -> Path:
    """プロジェクトルートを取得"""
    # backend/utils/image_sets.py から見て、プロジェクトルートは ../../
    current_file = Path(__file__)
    return current_file.parent.parent.parent


def get_public_path() -> Path:
    """publicフォルダのパスを取得"""
    return get_project_root() / "public"


def extract_image_set_from_filename(filename: str) -> str | None:
    """
    ファイル名から画像セット番号を抽出
    
    例: chat-background-light01-02.webp -> "01-02"
    """
    pattern = r'(chat|rag)-background-(light|dark)(\d{2}-\d{2})\.'
    match = re.search(pattern, filename)
    return match.group(3) if match else None


def get_available_image_sets_for_theme(theme_number: int) -> List[Dict[str, any]]:
    """
    指定されたテーマの利用可能な画像セットを取得
    
    Args:
        theme_number (int): テーマ番号 (1-7)
        
    Returns:
        List[Dict]: 利用可能な画像セットのリスト
    """
    public_path = get_public_path()
    theme_folder = public_path / f"thema{theme_number}"
    
    if not theme_folder.exists():
        return []
    
    # 利用可能な画像セットを検出
    image_sets: Set[str] = set()
    
    # フォルダ内の全ファイルを走査
    for file_path in theme_folder.iterdir():
        if file_path.is_file():
            image_set = extract_image_set_from_filename(file_path.name)
            if image_set:
                image_sets.add(image_set)
    
    # 画像セットごとに完全性をチェックし、プレビュー画像パスを生成
    available_sets = []
    
    for image_set in sorted(image_sets):
        preview_images = {}
        set_complete = True
        
        # 各画像タイプの存在確認とプレビューパス生成
        for image_type in IMAGE_TYPES:
            found_image = None
            
            # 拡張子の優先順位で検索
            for ext in SUPPORTED_EXTENSIONS:
                image_path = theme_folder / f"{image_type}{image_set}.{ext}"
                if image_path.exists():
                    # 相対パス（/public からの相対パス）を生成
                    relative_path = f"/thema{theme_number}/{image_type}{image_set}.{ext}"
                    found_image = relative_path
                    break
            
            if found_image:
                preview_images[image_type] = found_image
            else:
                set_complete = False
                break
        
        # 完全なセットのみを追加
        if set_complete:
            available_sets.append({
                "image_set": image_set,
                "preview_images": preview_images
            })
    
    return available_sets


def get_available_image_sets_for_all_themes() -> Dict[str, Dict[str, any]]:
    """
    全テーマの利用可能な画像セットを取得
    
    Returns:
        Dict: テーマ名をキーとした画像セット情報
    """
    all_themes = {}
    
    for theme_name, theme_number in THEME_FOLDER_MAP.items():
        available_sets = get_available_image_sets_for_theme(theme_number)
        if available_sets:  # 利用可能なセットがある場合のみ追加
            all_themes[theme_name] = {
                "theme_name": theme_name,
                "theme_number": theme_number,
                "available_sets": available_sets
            }
    
    return all_themes


def validate_image_set_exists(theme_number: int, image_set: str) -> bool:
    """
    指定されたテーマと画像セットの組み合わせが存在するかを確認
    
    Args:
        theme_number (int): テーマ番号
        image_set (str): 画像セット（例: "01-02"）
        
    Returns:
        bool: 画像セットが存在する場合True
    """
    available_sets = get_available_image_sets_for_theme(theme_number)
    return any(s["image_set"] == image_set for s in available_sets)


if __name__ == "__main__":
    # テスト用コード
    print("=== 全テーマの利用可能画像セット ===")
    all_themes = get_available_image_sets_for_all_themes()
    
    for theme_name, theme_info in all_themes.items():
        print(f"\n{theme_name} (thema{theme_info['theme_number']}):")
        for image_set in theme_info['available_sets']:
            print(f"  - {image_set['image_set']}")
            for img_type, img_path in image_set['preview_images'].items():
                print(f"    {img_type}: {img_path}")