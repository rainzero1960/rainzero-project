# backend/routers/module/rag_tools.py
from typing import List, Dict, Any, Optional
from langchain_tavily import TavilySearch, TavilyExtract
# from langchain_core.tools import tool # @tool は rag.py で適用するため、ここでは不要
from sqlmodel import Session, select

# models, db, EMBED などを適切にインポートする
from models import UserPaperLink, PaperMetadata
# from db import get_session # rag.py から渡されるセッションを使う
from routers.module.embeddings import EMBED # EMBED をインポート
from vectorstore.manager import load_vector_cfg, search_by_vector # manager_search_by_vector を search_by_vector に修正
from fastapi import HTTPException, status
import re


# --- DeepResearchから持ってきたツール ---
# search_results の値はconfigなどから取得できるようにすると良い
tavily_web_search = TavilySearch(max_results=10, name="web_search_tool")
tavily_web_extract = TavilyExtract(name="web_extract_tool")

# --- 既存のRAG検索ツール ---
# 注意: この関数は rag.py のコンテキストで実行されるため、
# db_session や current_user は rag.py のリクエストスコープから渡される想定です。
# このファイル内では関数定義のみに留め、Toolとしての登録は rag.py で行います。

def local_rag_search_tool_impl(
    query: str,
    user_id: int,
    db_session: Session, # rag.py から渡される
    tags: Optional[str] = None,
    deep_agents: Optional[bool] = False
) -> List[Dict[str, Any]]:
    """
    ユーザーの知識ベース（登録された論文の要約）内を検索します。
    ユーザーの質問、タグ、ユーザーIDに基づいて関連する論文情報を取得します。
    """
    print(f"Tool 'local_rag_search_tool_impl' called with query: '{query}', user_id: {user_id}, tags: '{tags}'")
    
    # 1. Fetch UserPaperLinks based on user_id and optional tags
    user_paper_links_query = select(UserPaperLink).where(UserPaperLink.user_id == user_id)
    
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            for t_item in tag_list:
                user_paper_links_query = user_paper_links_query.where(UserPaperLink.tags.contains(t_item))
    
    relevant_user_paper_links = db_session.exec(user_paper_links_query).all()

    if not relevant_user_paper_links:
        if tags:
            print(f"User {user_id}: No UserPaperLinks found matching tags: {tags}")
        else:
            print(f"User {user_id}: No UserPaperLinks found.")
        return []

    # 2. Collect unique paper_metadata_ids from these links
    paper_metadata_ids = list(set(
        link.paper_metadata_id for link in relevant_user_paper_links if link.paper_metadata_id is not None
    ))

    if not paper_metadata_ids:
        print(f"User {user_id}: No valid paper_metadata_ids found from the user's paper links.")
        return []

    # 3. Build allowed_metadata_filters using user_id + paper_metadata_id (1論文1ベクトル設計)
    # GeneratedSummaryやCustomGeneratedSummaryを検索する必要なし（統一ベクトルに含まれている）
    allowed_metadata_filters = []
    for link in relevant_user_paper_links:
        if link.paper_metadata_id is None:
            continue
        
        allowed_metadata_filters.append({
            "user_id": str(user_id),
            "paper_metadata_id": str(link.paper_metadata_id)
        })

    if not allowed_metadata_filters:
        print(f"User {user_id}: No valid paper_metadata_ids found from the user's paper links.")
        return []
    
    vector_cfg = load_vector_cfg()
    store_type = vector_cfg.get("type")
    filter_for_vector_search = None

    print(f"allowed_metadata_filters: {allowed_metadata_filters}")

    if store_type == "chroma":
        if not allowed_metadata_filters: 
            print(f"User {user_id}: No valid metadata filters for ChromaDB") # Should be caught by earlier check
            return []
        
        chroma_or_conditions = []
        for cond_set in allowed_metadata_filters:
            and_clauses = []
            for field, value in cond_set.items():
               and_clauses.append({field: {"$eq": value}})
            if and_clauses: chroma_or_conditions.append({"$and": and_clauses})
        
        if not chroma_or_conditions:
             print(f"User {user_id}: No valid conditions derived for ChromaDB $or clause.")
             return []
        
        if len(chroma_or_conditions) == 1: 
            filter_for_vector_search = chroma_or_conditions[0]
        else: 
            filter_for_vector_search = {"$or": chroma_or_conditions}
        
    elif store_type == "bigquery_vector_search":
        if allowed_metadata_filters:
            conditions = []
            for f_item in allowed_metadata_filters:
                # 1論文1ベクトル設計: user_id + paper_metadata_id のみでフィルター
                # BigQueryスキーマに合わせて文字列として扱う
                cond = (f"user_id = '{f_item['user_id']}' AND "
                        f"paper_metadata_id = '{f_item['paper_metadata_id']}'")
                conditions.append(f"({cond})")
            filter_for_vector_search = " OR ".join(conditions)
        else:
            print(f"User {user_id}: No valid metadata filters for BigQuery") 
            return []
    else:
        if not allowed_metadata_filters:
            print(f"User {user_id}: No valid metadata filters for vector search (non-Chroma/BQ path)")
            return []
        filter_for_vector_search = {"user_id": str(user_id)}
        print(f"Warning: Vector store type '{store_type}' does not have specific multi-condition filter logic. Filtering by user_id only for vector search.")

    emb = EMBED.embed_query(query)
    hits_with_scores = search_by_vector(
        embedding=emb,
        k=10,
        filter_param=filter_for_vector_search
    )
    
    results_for_llm: List[Dict[str, Any]] = []
    
    pm_ids_from_hits = list(set(
        int(doc.metadata.get("paper_metadata_id")) 
        for doc, _ in hits_with_scores 
        if doc.metadata.get("paper_metadata_id") and doc.metadata.get("paper_metadata_id").isdigit()
    ))

    paper_metadata_map: Dict[int, PaperMetadata] = {}
    if pm_ids_from_hits:
        paper_metadata_objects = db_session.exec(
            select(PaperMetadata).where(PaperMetadata.id.in_(pm_ids_from_hits))
        ).all()
        paper_metadata_map = {pm.id: pm for pm in paper_metadata_objects}

    for doc, score in hits_with_scores:
        meta = doc.metadata
        pm_id_str = meta.get("paper_metadata_id")
        upl_id_str = meta.get("user_paper_link_id")
        
        title = "N/A"
        arxiv_id_res = None
        
        pm_id = int(pm_id_str) if pm_id_str and pm_id_str.isdigit() else None
        
        if pm_id and pm_id in paper_metadata_map:
            pm = paper_metadata_map[pm_id]
            title = pm.title
            arxiv_id_res = pm.arxiv_id

        returned_doc_chunk = doc.page_content.strip()
        if deep_agents:
            temp_chunk = returned_doc_chunk

            pattern_start = r"##\s*概要"                        # 開始見出し
            pattern_end   = r"##\s*次に読むべき論文は？"         # 終了見出し

            # 開始位置の決定（見出し行の直後を起点）
            m_start = re.search(pattern_start, temp_chunk)
            start_idx = m_start.end() if m_start else 0

            # 終了位置の決定（見出し行の直前で止める）
            m_end = re.search(pattern_end, temp_chunk[start_idx:])
            end_idx = (start_idx + m_end.start()) if m_end else len(temp_chunk)

            returned_doc_chunk = temp_chunk[start_idx:end_idx].strip()
        
        results_for_llm.append({
            "type": "paper",
            "user_paper_link_id": int(upl_id_str) if upl_id_str and upl_id_str.isdigit() else 0,
            "paper_metadata_id": pm_id if pm_id is not None else 0,
            "title": title,
            "arxiv_id": arxiv_id_res,
            "text_summary_chunk": returned_doc_chunk,
            "score": float(score)
        })
    print(f"User {user_id}: Found {len(results_for_llm)} results for query: '{query}'")
    return results_for_llm

# 利用可能なツールとその実装をマッピング
# キーはフロントエンド/バックエンドで一貫性のある識別子
AVAILABLE_TOOL_IMPLEMENTATIONS = {
    "local_rag_search_tool": local_rag_search_tool_impl, # 実装関数
    "web_search_tool": tavily_web_search,            # Langchainツールオブジェクト
    "web_extract_tool": tavily_web_extract,         # Langchainツールオブジェクト
}