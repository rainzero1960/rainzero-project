# backend/routers/embeddings.py
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select, Session
from sqlalchemy.orm import selectinload # selectinload をインポート
from pydantic import BaseModel
from db import get_session
from models import UserPaperLink, GeneratedSummary, PaperMetadata, User, EditedSummary, CustomGeneratedSummary # CustomGeneratedSummaryを追加
from vectorstore.manager import (
    load_vector_cfg, get_vector_store,
    add_texts as manager_add_texts,
    delete_vectors_by_metadata # delete_all_vectors は使用しない
)
from auth_utils import get_current_active_user
from typing import Optional # Optional をインポート


router = APIRouter(prefix="/embeddings", tags=["embeddings"])

@router.get("/config") # 変更なし
def get_embedding_config():
    cfg = load_vector_cfg()
    return {"model_name": cfg.get("embedding_model")}

class RebuildEmbeddingsRequest(BaseModel):
    model_name: Optional[str] = None  # 情報表示用（実際には使用されない）
    preferred_summary_type: Optional[str] = None  # "default", "custom", または具体的なsystem_prompt_id
    preferred_system_prompt_id: Optional[int] = None  # カスタムプロンプト指定時のID

@router.post("/rebuild")
def rebuild_embeddings(
    payload: RebuildEmbeddingsRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user) # ★ 認証ユーザーを取得
):
    user_id_str = str(current_user.id)
    print(f"Rebuilding embeddings for user_id: {user_id_str}...")

    # 1. 現在のユーザーに関連する既存のベクトルデータを削除
    print(f"Deleting existing vector data for user_id: {user_id_str}...")
    delete_vectors_by_metadata(metadata_filter={"user_id": user_id_str})
    # 注意: delete_vectors_by_metadata が ChromaDB 以外のストアで未実装の場合、
    # ここでの削除は限定的になる可能性があります。
    # manager.py の delete_vectors_by_metadata の実装に依存します。

    # 2. 現在のユーザーの UserPaperLink を取得 (paper_metadata も eager load する)
    user_paper_links = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == current_user.id)
        .options(selectinload(UserPaperLink.paper_metadata))
    ).all()

    if not user_paper_links:
        print(f"No papers found in the library for user_id: {user_id_str}. Rebuild finished.")
        return {"message": "No papers found in your library to rebuild embeddings for."}

    # ベクトルデータ準備関数をインポート
    from routers.papers import _prepare_paper_vector_data

    # 3. 各論文のベクトルデータを準備（一括処理用）
    vector_data_list = []
    failed_rebuilds = 0
    
    for link in user_paper_links:
        if not link.paper_metadata_id or not link.paper_metadata:
            print(f"Skipping link id {link.id} for user {current_user.id}: PaperMetadata or its ID not found.")
            failed_rebuilds += 1
            continue
        
        arxiv_id_val = link.paper_metadata.arxiv_id
        if not arxiv_id_val:
            print(f"Skipping link id {link.id} for user {current_user.id}: Arxiv ID not found in PaperMetadata.")
            failed_rebuilds += 1
            continue

        try:
            # ベクトルデータを準備（既に一括削除済みなので個別削除は不要）
            vector_data = _prepare_paper_vector_data(
                link.paper_metadata, 
                current_user.id, 
                link.id, 
                session,
                preferred_summary_type=payload.preferred_summary_type,
                preferred_system_prompt_id=payload.preferred_system_prompt_id
            )
            
            if vector_data:
                vector_data_list.append(vector_data)
                print(f"Prepared vector data for paper {arxiv_id_val} (link_id: {link.id})")
            else:
                print(f"No valid summary found for paper {arxiv_id_val} (link_id: {link.id})")
                failed_rebuilds += 1
        except Exception as e:
            print(f"Failed to prepare vector data for paper {arxiv_id_val} (link_id: {link.id}): {e}")
            failed_rebuilds += 1
    
    # 4. 全ベクトルを一括追加（効率化）
    successful_rebuilds = 0
    if vector_data_list:
        try:
            cfg_vector = load_vector_cfg()
            store_type = cfg_vector.get("type")
            
            texts = [data["text"] for data in vector_data_list]
            metadatas = [data["metadata"] for data in vector_data_list]
            
            if store_type == "chroma":
                # ChromaDBの場合はIDも指定
                ids = [data["doc_id"] for data in vector_data_list if data["doc_id"]]
                if len(ids) == len(texts):
                    manager_add_texts(texts=texts, metadatas=metadatas, ids=ids)
                else:
                    manager_add_texts(texts=texts, metadatas=metadatas)
            else:
                # BigQueryの場合は一括追加
                manager_add_texts(texts=texts, metadatas=metadatas)
            
            successful_rebuilds = len(vector_data_list)
            print(f"Successfully added {successful_rebuilds} vectors in batch for user {current_user.id}")
            
        except Exception as e:
            print(f"Failed to add vectors in batch for user {current_user.id}: {e}")
            failed_rebuilds += len(vector_data_list)
            successful_rebuilds = 0

    print(f"Rebuild completed for user_id: {user_id_str}. Success: {successful_rebuilds}, Failed: {failed_rebuilds}")
    return {"message": f"Vector store rebuild process finished for user {current_user.username}. Successfully rebuilt {successful_rebuilds} papers, {failed_rebuilds} failed."}