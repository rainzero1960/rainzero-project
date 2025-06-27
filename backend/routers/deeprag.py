# backend/routers/deeprag.py
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status, Request
from sqlmodel import Session, select
from langchain_core.messages import AIMessage, HumanMessage, AnyMessage, SystemMessage
from google import genai
import os

from db import get_session, engine
from models import RagSession, RagMessage, User
from schemas import (
    DeepRagStartRequest,
    DeepResearchStartResponse as DeepRagStartResponse,
    DeepResearchStatusResponse as DeepRagStatusResponse,
    RagMessageRead
)
from .deeprag_core import run_deep_rag_graph_async # Changed from deepresearch_core
from auth_utils import get_current_active_user

from dotenv import load_dotenv, find_dotenv
from typing import Optional, List, Dict, Any, Union
import logging
from routers.module.prompt_manager import get_deeprag_title_prompt

logger = logging.getLogger(__name__)

_ = load_dotenv(find_dotenv())
genai_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

router = APIRouter(prefix="/deeprag", tags=["deeprag"]) # Changed prefix and tags

def make_title_from_query_deeprag(query: str, db: Session, user_id: int) -> str:
    """
    ユーザの質問からDeepRAGタイトルを生成する関数
    
    Args:
        query (str): ユーザーの質問
        db (Session): データベースセッション
        user_id (int): ユーザーID
        
    Returns:
        str: 生成されたタイトル
    """
    try:
        # カスタマイズされたプロンプト（またはデフォルト）を取得
        prompt = get_deeprag_title_prompt(db, user_id, query=query)
        logger.info(f"DeepRAGタイトル生成プロンプトを取得しました（ユーザーID: {user_id}）")
    except Exception as e:
        # プロンプト取得に失敗した場合は詳細ログを出力してフォールバック
        logger.error(f"DeepRAGタイトル生成プロンプトの取得に失敗しました（ユーザーID: {user_id}）: {e}")
        logger.warning("デフォルトのハードコードされたプロンプトにフォールバックします")
        
        prompt = f"""# 目的
以下のユーザ質問のテキストから、この会話全体のタイトルを日本語で簡潔に生成してください。タイトル以外のテキストは出力しないでください。

# ユーザ質問
{query}

# 注意事項
タイトル以外のテキストの出力は禁止です
"""
    
    try:
        response = genai_client.models.generate_content(
            model="gemma-3n-e4b-it", # Consider if a different model is needed for title
            contents=prompt,
        )
        title = response.text.strip()
    except Exception as e:
        logger.error(f"タイトル生成中にエラーが発生しました: {e}")
        title = query[0:15]
    return f"[DRAG]:{title}" # Changed prefix for title


@router.post("/start", response_model=DeepRagStartResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_deeprag_task(
    payload: DeepRagStartRequest, # ★ Use the specific DeepRagStartRequest
    request: Request,             # ★ FastAPI Request object
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    query = payload.query
    rag_session_id_payload = payload.session_id
    tags_for_graph = payload.tags # From DeepRagStartRequest

    print(f"Received query: {query}")
    print(f"Received tags: {tags_for_graph}")
    print(f"Received session_id: {rag_session_id_payload}")
    print(f"Current user: {current_user.username}")
    print(f"Request origin: {request.headers.get('origin', 'unknown')}") # ★ Log the request origin

    # ... (session creation/retrieval logic remains the same) ...
    if not query.strip():
        raise HTTPException(status_code=422, detail="Query cannot be empty.")

    rag_session_for_task: RagSession | None = None
    if rag_session_id_payload:
        rag_session_for_task = db.get(RagSession, rag_session_id_payload)
        if not rag_session_for_task or rag_session_for_task.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"RagSession with id {rag_session_id_payload} not found or not authorized.")
        rag_session_for_task.processing_status = "pending"
        if not rag_session_for_task.title or not rag_session_for_task.title.startswith("[DRAG]:"):
            rag_session_for_task.title = make_title_from_query_deeprag(query, db, current_user.id)
        db.add(rag_session_for_task); db.commit(); db.refresh(rag_session_for_task)
    else:
        rag_session_for_task = RagSession(user_id=current_user.id, processing_status="pending", title=make_title_from_query_deeprag(query, db, current_user.id))
        db.add(rag_session_for_task); db.commit(); db.refresh(rag_session_for_task)
    
    final_rag_session_id = rag_session_for_task.id

    user_msg_dr = RagMessage(session_id=final_rag_session_id, role="user", content=query, is_deep_research_step=False)
    db.add(user_msg_dr); db.commit()
    
    tags_str_for_graph = ",".join(tags_for_graph) if tags_for_graph else ""
    base_url_origin_for_graph = request.headers.get("origin", "http://localhost:3000") # ★ Get origin

    def run_graph_task_wrapper(session_id_for_task: int, initial_query: str, user_id_for_task: int, tags_for_task: str, base_url: str, system_prompt_group_id_for_task: int | None = None, use_character_prompt_for_task: bool = True): # Added base_url, system_prompt_group_id and use_character_prompt
        with Session(engine) as task_db_session:
            # ... (message fetching logic) ...
            msgs_stmt = (select(RagMessage).where(RagMessage.session_id == session_id_for_task).order_by(RagMessage.created_at))
            msgs_from_db = task_db_session.exec(msgs_stmt).all()
            lc_messages_dr: list[AnyMessage] = []
            for m_db in msgs_from_db:
                if m_db.role == "user": lc_messages_dr.append(HumanMessage(content=m_db.content))
                elif m_db.role == "assistant" or m_db.role == "system_step": lc_messages_dr.append(AIMessage(content=m_db.content))
                elif m_db.role == "system": lc_messages_dr.append(SystemMessage(content=m_db.content))

            run_deep_rag_graph_async(
                initial_messages=lc_messages_dr,
                db_session=task_db_session,
                rag_session_id=session_id_for_task,
                user_id=user_id_for_task,
                tags=tags_for_task,
                base_url_origin=base_url, # ★ Pass base_url_origin
                system_prompt_group_id=system_prompt_group_id_for_task,  # ★ Pass system_prompt_group_id
                use_character_prompt=use_character_prompt_for_task  # ★ Pass use_character_prompt
            )

    background_tasks.add_task(run_graph_task_wrapper, final_rag_session_id, query, current_user.id, tags_str_for_graph, base_url_origin_for_graph, payload.system_prompt_group_id, payload.use_character_prompt) # ★ Pass base_url_origin, system_prompt_group_id and use_character_prompt

    return DeepRagStartResponse(
        session_id=final_rag_session_id,
        message="DeepRAG task started in background."
    )


@router.get("/sessions/{session_id}/status", response_model=DeepRagStatusResponse)
def get_deeprag_session_status( # Renamed function
    session_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    rag_session_status = db.get(RagSession, session_id)
    if not rag_session_status or rag_session_status.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DeepRAG session not found or not authorized.") # Changed message

    messages_stmt_status = (
        select(RagMessage)
        .where(RagMessage.session_id == session_id)
        .order_by(RagMessage.created_at)
    )
    messages_from_db_status = db.exec(messages_stmt_status).all()
    
    messages_for_response_status = [RagMessageRead.model_validate(msg) for msg in messages_from_db_status]

    return DeepRagStatusResponse(
        session_id=rag_session_status.id,
        status=rag_session_status.processing_status,
        messages=messages_for_response_status,
        last_updated=rag_session_status.last_updated
    )