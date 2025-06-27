# backend/routers/deepresearch.py
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlmodel import Session, select
from langchain_core.messages import AIMessage, HumanMessage, AnyMessage, SystemMessage
from google import genai
import os

from db import get_session, engine
from models import RagSession, RagMessage, User # User をインポート
from schemas import (
    DeepResearchStartRequest, DeepResearchStartResponse,
    DeepResearchStatusResponse, RagMessageRead
)
from .deepresearch_core import run_deep_research_graph_async, tools # toolsもインポート
from auth_utils import get_current_active_user # 認証用

from dotenv import load_dotenv, find_dotenv
from typing import Optional, List, Dict, Any, Union
import logging
from routers.module.prompt_manager import get_deepresearch_title_prompt

logger = logging.getLogger(__name__)

_ = load_dotenv(find_dotenv())
genai_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

router = APIRouter(prefix="/deepresearch", tags=["deepresearch"])

def make_title_from_query(query: str, db: Session, user_id: int) -> str:
    """
    ユーザの質問からタイトルを生成する関数
    
    Args:
        query (str): ユーザーの質問
        db (Session): データベースセッション
        user_id (int): ユーザーID
        
    Returns:
        str: 生成されたタイトル
    """
    try:
        # カスタマイズされたプロンプト（またはデフォルト）を取得
        prompt = get_deepresearch_title_prompt(db, user_id, query=query)
        logger.info(f"DeepResearchタイトル生成プロンプトを取得しました（ユーザーID: {user_id}）")
    except Exception as e:
        # プロンプト取得に失敗した場合は詳細ログを出力してフォールバック
        logger.error(f"DeepResearchタイトル生成プロンプトの取得に失敗しました（ユーザーID: {user_id}）: {e}")
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
            model="gemma-3n-e4b-it",
            contents=prompt,
        )
        title = response.text.strip()
    except Exception as e:
        title = query[0:15]

    return f"[DR]:{title}"
    


@router.post("/start", response_model=DeepResearchStartResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_deepresearch_task(
    payload: DeepResearchStartRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user) # ★ 認証ユーザー
):
    query = payload.query
    rag_session_id_payload = payload.session_id # 変数名変更

    if not query.strip():
        raise HTTPException(status_code=422, detail="Query cannot be empty.")

    rag_session_for_task: Optional[RagSession] = None # 変数名変更
    if rag_session_id_payload:
        rag_session_for_task = db.get(RagSession, rag_session_id_payload)
        if not rag_session_for_task or rag_session_for_task.user_id != current_user.id: # ★ ユーザー所有確認
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"RagSession with id {rag_session_id_payload} not found or not authorized.")
        rag_session_for_task.processing_status = "pending" # ステータスリセット
        if not rag_session_for_task.title: # タイトルがなければ生成
            rag_session_for_task.title = make_title_from_query(query, db, current_user.id)
        db.add(rag_session_for_task) # 更新をDBに反映
        db.commit()
        db.refresh(rag_session_for_task)
    else:
        rag_session_for_task = RagSession(
            user_id=current_user.id, # ★ user_id を設定
            processing_status="pending",
            title=make_title_from_query(query, db, current_user.id) # 新規作成時は必ずタイトル生成
        )
        db.add(rag_session_for_task)
        db.commit()
        db.refresh(rag_session_for_task)
    
    # 確定したセッションIDを使用
    final_rag_session_id = rag_session_for_task.id

    user_msg_dr = RagMessage( # 変数名変更
        session_id=final_rag_session_id,
        role="user",
        content=query,
        is_deep_research_step=False
    )
    db.add(user_msg_dr)
    db.commit()
    # db.refresh(user_msg_dr) # run_graph_task_wrapper で再取得するので不要かも

    # バックグラウンドタスクのラッパー関数 (user_id と system_prompt_group_id と use_character_prompt を渡すように変更)
    def run_graph_task_wrapper(session_id_for_task: int, initial_query: str, user_id_for_task: int, system_prompt_group_id_for_task: int | None = None, use_character_prompt_for_task: bool = True):
        with Session(engine) as task_db_session:
            msgs_stmt = (
                select(RagMessage)
                .where(RagMessage.session_id == session_id_for_task)
                .order_by(RagMessage.created_at)
            )
            msgs_from_db = task_db_session.exec(msgs_stmt).all()

            lc_messages_dr: list[AnyMessage] = [] # 変数名変更
            for m_db in msgs_from_db: # 変数名変更
                if m_db.role == "user":
                    lc_messages_dr.append(HumanMessage(content=m_db.content))
                elif m_db.role == "assistant" or m_db.role == "system_step":
                    lc_messages_dr.append(AIMessage(content=m_db.content))
                elif m_db.role == "system":
                    lc_messages_dr.append(SystemMessage(content=m_db.content))
            
            # GraphState に user_id を含める
            # deepresearch_core.py の GraphState と run_deep_research_graph_async の修正が必要
            run_deep_research_graph_async(
                initial_messages=lc_messages_dr,
                db_session=task_db_session,
                rag_session_id=session_id_for_task,
                user_id=user_id_for_task, # ★ user_id を渡す
                system_prompt_group_id=system_prompt_group_id_for_task,  # ★ system_prompt_group_id を渡す
                use_character_prompt=use_character_prompt_for_task  # ★ use_character_prompt を渡す
            )

    background_tasks.add_task(run_graph_task_wrapper, final_rag_session_id, query, current_user.id, payload.system_prompt_group_id, payload.use_character_prompt) # ★ user_id と system_prompt_group_id と use_character_prompt を渡す

    return DeepResearchStartResponse(
        session_id=final_rag_session_id,
        message="DeepResearch task started in background."
    )


@router.get("/sessions/{session_id}/status", response_model=DeepResearchStatusResponse)
def get_deepresearch_session_status(
    session_id: int,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user) # ★ 認証ユーザー
):
    rag_session_status = db.get(RagSession, session_id) # 変数名変更
    if not rag_session_status or rag_session_status.user_id != current_user.id: # ★ ユーザー所有確認
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DeepResearch session not found or not authorized.")

    messages_stmt_status = ( # 変数名変更
        select(RagMessage)
        .where(RagMessage.session_id == session_id)
        .order_by(RagMessage.created_at)
    )
    messages_from_db_status = db.exec(messages_stmt_status).all() # 変数名変更
    
    messages_for_response_status = [RagMessageRead.model_validate(msg) for msg in messages_from_db_status] # 変数名変更

    return DeepResearchStatusResponse(
        session_id=rag_session_status.id,
        status=rag_session_status.processing_status,
        messages=messages_for_response_status,
        last_updated=rag_session_status.last_updated
    )