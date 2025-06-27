# backend/routers/rag.py
from fastapi import APIRouter, Depends, HTTPException, status, Request, BackgroundTasks
from sqlmodel import Session, select, delete, col
from datetime import datetime
from typing import List, Optional, Dict, Any, Union
import json

from schemas import (
    RagQuery, RagAnswer, RagSessionRead, RagMessageRead, RagAnswerRef, WebSearchResultRef,
    SimpleRagStartRequest, SimpleRagStartResponse, SimpleRagStatusResponse
)
from models import (
    RagSession, RagMessage, UserPaperLink, PaperMetadata, GeneratedSummary, User
)
from db import get_session, engine
from routers.module.util import initialize_llm
from auth_utils import get_current_active_user

from langchain_core.tools import Tool
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder, HumanMessagePromptTemplate
from langchain_core.messages import AIMessage, HumanMessage, AnyMessage, SystemMessage, ToolMessage
from langgraph.types import Command
from langgraph.prebuilt import ToolNode
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

import operator
import time
import logging
from typing_extensions import TypedDict, Annotated

logger = logging.getLogger(__name__)



import os
from google import genai
from dotenv import load_dotenv, find_dotenv

from .module.rag_tools import AVAILABLE_TOOL_IMPLEMENTATIONS
from .module.rag_prompts import BASE_SYSTEM_PROMPT_TEMPLATE, NO_TOOL_SYSTEM_PROMPT_TEMPLATE, TOOL_PROMPT_PARTS
from .module.prompt_manager import (
    get_rag_base_system_prompt,
    get_rag_base_system_prompt_with_character, # キャラクタープロンプト付き関数を追加
    get_rag_no_tool_system_prompt,
    get_rag_no_tool_system_prompt_with_character, # キャラクタープロンプト付き関数を追加
    get_rag_tool_prompt_parts,
    get_rag_title_generation_prompt
)
import json as json_module

_ = load_dotenv(find_dotenv())
genai_client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

router = APIRouter(prefix="/rag", tags=["rag"])

class GraphState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    query: str
    tags: str
    user_id: int

def create_langgraph(chain, tools_for_graph: List[Tool]):

    def should_continue(state: GraphState):
        messages = state["messages"]
        last_message = messages[-1]
        if not isinstance(last_message, AIMessage):
            return END
        if last_message.tool_calls:
            return "tools"
        return END

    async def call_llm(state: GraphState):
        error_cnt = 0
        print("====Calling LLM in call_llm====")
        print(f"LLM call state: {state}")
        while True:
            try:
                response = await chain.ainvoke(
                    {"messages":state["messages"], "query": state["query"], "tags": state["tags"], "user_id": state["user_id"]})
                break
            except Exception as e:
                if error_cnt >= 3:
                    raise e
                print(f"LLM call failed: {e}")
                time.sleep(61)
                error_cnt += 1

        print("====LLM response in call_llm====")
        print(response)
        print(f"state for LLM call: {state}")
        return {"messages": [response]}

    tool_node = ToolNode(tools_for_graph)

    workflow = StateGraph(GraphState)
    workflow.add_node("agent", call_llm)
    workflow.add_node("tools", tool_node)

    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue)
    workflow.add_edge("tools", "agent")

    memory = MemorySaver()
    graph = workflow.compile(checkpointer=memory)
    return graph

@router.get("/config/models")
def get_rag_model_config():
    from pathlib import Path
    import yaml

    cfg_path = Path(__file__).parent.parent / "config.yaml"
    all_cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")).get("model_settings", {})
    common  = all_cfg.get("common", {})
    rag_page_cfg = all_cfg.get("rag_page", {})
    merged_models   = { **common.get("models", {}), **rag_page_cfg.get("models", {}) }
    merged_defaults = { **common.get("default_models_by_provider", {}), **rag_page_cfg.get("default_models_by_provider", {}) }
    merged_default  = rag_page_cfg.get("default_model", common.get("default_model"))
    return {
        **common,
        **rag_page_cfg,
        "models": merged_models,
        "default_models_by_provider": merged_defaults,
        "default_model": merged_default,
    }

@router.get("/sessions", response_model=list[RagSessionRead])
def list_rag_sessions(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    rag_sessions = session.exec(
        select(RagSession)
        .where(RagSession.user_id == current_user.id)
        .order_by(RagSession.id.desc())
    ).all()
    return [RagSessionRead.model_validate(s) for s in rag_sessions]

@router.post("/sessions", response_model=RagSessionRead, status_code=status.HTTP_201_CREATED)
def create_rag_session(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    new_sess = RagSession(user_id=current_user.id)
    session.add(new_sess)
    session.commit()
    session.refresh(new_sess)
    return RagSessionRead.model_validate(new_sess)

@router.get("/sessions/{sid}/messages", response_model=list[RagMessageRead])
def list_rag_messages(
    sid: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    rag_sess = session.get(RagSession, sid)
    if not rag_sess or rag_sess.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG session not found or not authorized")
    
    messages = session.exec(
        select(RagMessage).where(RagMessage.session_id == sid).order_by(RagMessage.id)
    ).all()
    print(f"Messages for session {sid}: {messages}")
    return [RagMessageRead.model_validate(m) for m in messages]


@router.post("/query", response_model=RagAnswer)
async def rag_query(
    payload: RagQuery,
    request: Request,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    
    print(f"rag query : payload: {payload}")
    thread_id_suffix = payload.session_id if payload.session_id is not None else f"new_{time.time_ns()}"
    graph_config = {"recursion_limit": 20000, "configurable": {"thread_id": f"user_{current_user.id}_rag_{thread_id_suffix}"}}
    
    if not payload.query.strip():
        raise HTTPException(status_code=422, detail="query is required")

    selected_tool_names = payload.selected_tools
    active_tools: List[Tool] = []
    tool_descriptions_for_prompt = []
    citation_instructions_for_prompt = []

    base_url_origin: str = request.headers.get("origin", "")

    try:
        tool_prompt_parts_json = get_rag_tool_prompt_parts(db_session, current_user.id, base_url_origin=base_url_origin)
        tool_prompt_parts = json_module.loads(tool_prompt_parts_json)
    except Exception as e:
        logger.error(f"ツールプロンプト部品の取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
        logger.warning("デフォルトのハードコードされたツールプロンプト部品にフォールバックします")
        tool_prompt_parts = TOOL_PROMPT_PARTS

    if "local_rag_search_tool" in selected_tool_names:
        local_rag_impl = AVAILABLE_TOOL_IMPLEMENTATIONS["local_rag_search_tool"]
        
        bound_local_rag_search_tool = Tool(
            name="local_rag_search_tool",
            func=lambda query, tags=",".join(payload.tags or []): local_rag_impl(query=query, user_id=current_user.id, db_session=db_session, tags=tags),
            description="""ユーザーの知識ベース（登録された論文の要約）内を検索します。ユーザーの質問に基づいて、関連する論文情報を取得します。""",
        )
        active_tools.append(bound_local_rag_search_tool)
        tool_descriptions_for_prompt.append(
            tool_prompt_parts["local_rag_search_tool"]["description"]
        )
        citation_instructions_for_prompt.append(
            tool_prompt_parts["local_rag_search_tool"]["citation_instruction"]
        )

    if "web_search_tool" in selected_tool_names:
        active_tools.append(AVAILABLE_TOOL_IMPLEMENTATIONS["web_search_tool"])
        tool_descriptions_for_prompt.append(tool_prompt_parts["web_search_tool"]["description"])
        citation_instructions_for_prompt.append(tool_prompt_parts["web_search_tool"]["citation_instruction"])
    
    if "web_extract_tool" in selected_tool_names:
        active_tools.append(AVAILABLE_TOOL_IMPLEMENTATIONS["web_extract_tool"])
        tool_descriptions_for_prompt.append(tool_prompt_parts["web_extract_tool"]["description"])
        citation_instructions_for_prompt.append(tool_prompt_parts["web_extract_tool"]["citation_instruction"])

    if not active_tools:
        pass


    unique_citation_instructions = "\n".join(list(set(citation_instructions_for_prompt)))

    if not active_tools:
        try:
            print(f"system_prompt_id: {payload.selected_prompts[0].system_prompt_id}")
            if payload.use_character_prompt:
                system_prompt_content = get_rag_no_tool_system_prompt_with_character(db_session, current_user.id,system_prompt_id=payload.selected_prompts[0].system_prompt_id)
                logger.info(f"RAGノーツールシステムプロンプト（キャラクター付き）を動的取得しました（ユーザーID: {current_user.id}）")
            else:
                system_prompt_content = get_rag_no_tool_system_prompt(db_session, current_user.id,system_prompt_id=payload.selected_prompts[0].system_prompt_id)
                logger.info(f"RAGノーツールシステムプロンプト（キャラクターなし）を動的取得しました（ユーザーID: {current_user.id}）")
        except Exception as e:
            logger.error(f"RAGノーツールシステムプロンプトの取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
            logger.warning("デフォルトのハードコードされたノーツールプロンプトにフォールバックします")
            system_prompt_content = NO_TOOL_SYSTEM_PROMPT_TEMPLATE
    else:
        try:
            if payload.use_character_prompt:
                system_prompt_template = get_rag_base_system_prompt_with_character(db_session, current_user.id, system_prompt_id=payload.selected_prompts[0].system_prompt_id)
                prompt_type_desc = "キャラクター付き"
            else:
                system_prompt_template = get_rag_base_system_prompt(db_session, current_user.id, system_prompt_id=payload.selected_prompts[0].system_prompt_id)
                prompt_type_desc = "キャラクターなし"
            
            system_prompt_content = system_prompt_template.format(
                tool_descriptions_section="\n".join(tool_descriptions_for_prompt),
                citation_instructions_section=unique_citation_instructions
            )
            print(f"system_prompt_content: {system_prompt_content}")
            logger.info(f"RAGベースシステムプロンプト（{prompt_type_desc}）を動的取得しました（ユーザーID: {current_user.id}）")
        except Exception as e:
            logger.error(f"RAGベースシステムプロンプトの取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
            logger.warning("デフォルトのハードコードされたベースプロンプトにフォールバックします")
            system_prompt_content = BASE_SYSTEM_PROMPT_TEMPLATE.format(
                tool_descriptions_section="\n".join(tool_descriptions_for_prompt),
                citation_instructions_section=unique_citation_instructions
            )
    
    rag_sess_obj: Optional[RagSession] = None
    if payload.session_id:
        rag_sess_obj = db_session.get(RagSession, payload.session_id)
        if not rag_sess_obj or rag_sess_obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG session not found or not authorized")
    else:
        rag_sess_obj = RagSession(user_id=current_user.id)
        try:
            prompt_title_new = get_rag_title_generation_prompt(db_session, current_user.id, query=payload.query)
            logger.info(f"RAGタイトル生成プロンプトを動的取得しました（ユーザーID: {current_user.id}）")
        except Exception as e:
            logger.error(f"RAGタイトル生成プロンプトの取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
            logger.warning("デフォルトのハードコードされたタイトル生成プロンプトにフォールバックします")
            prompt_title_new = f"""# 目的
以下のユーザ質問のテキストから、この会話全体のタイトルを日本語で簡潔に生成してください。タイトル以外のテキストは出力しないでください。
# ユーザ質問
{payload.query}
# 注意事項
タイトル以外のテキストの出力は禁止です"""
        
        try:
            response_title_new = genai_client.models.generate_content(model="gemma-3n-e4b-it", contents=prompt_title_new)
            title_gen_new = response_title_new.text.strip()
        except Exception:
            title_gen_new = payload.query[0:15]
        rag_sess_obj.title = title_gen_new
        
        db_session.add(rag_sess_obj)
        db_session.commit()
        db_session.refresh(rag_sess_obj)
        payload.session_id = rag_sess_obj.id 
        graph_config["configurable"]["thread_id"] = f"user_{current_user.id}_rag_{rag_sess_obj.id}"


    if not rag_sess_obj.title:
        try:
            prompt_title_existing = get_rag_title_generation_prompt(db_session, current_user.id, query=payload.query)
            logger.info(f"RAGタイトル生成プロンプトを動的取得しました（既存セッション、ユーザーID: {current_user.id}）")
        except Exception as e:
            logger.error(f"RAGタイトル生成プロンプトの取得に失敗しました（既存セッション、ユーザーID: {current_user.id}）: {e}")
            logger.warning("デフォルトのハードコードされたタイトル生成プロンプトにフォールバックします")
            prompt_title_existing = f"""# 目的
以下のユーザ質問のテキストから、この会話全体のタイトルを日本語で簡潔に生成してください。タイトル以外のテキストは出力しないでください。
# ユーザ質問
{payload.query}
# 注意事項
タイトル以外のテキストの出力は禁止です"""
        
        try:
            response_title_existing = genai_client.models.generate_content(model="gemma-3n-e4b-it", contents=prompt_title_existing)
            title_gen_existing = response_title_existing.text.strip()
        except Exception:
            title_gen_existing = payload.query[0:15]
        rag_sess_obj.title = title_gen_existing
        db_session.add(rag_sess_obj)
        db_session.commit()

    user_msg_db = RagMessage(
        session_id=rag_sess_obj.id, role="user", content=payload.query
    )
    db_session.add(user_msg_db)
    db_session.commit()

    llm_for_rag = initialize_llm(
        name=payload.provider,
        model_name=payload.model,
        temperature=payload.temperature or 0,
        top_p=payload.top_p or 1.0,
        llm_max_retries=3,
    )

    prompt_rag = ChatPromptTemplate.from_messages([
        SystemMessage(content=system_prompt_content),
        MessagesPlaceholder("messages"),
        HumanMessagePromptTemplate.from_template(
            "{query}"
        )
    ])

    chain_rag = prompt_rag | llm_for_rag.with_config({"run_name": "RAG_LLM_Chain"}).bind_tools(active_tools)

    agent_rag = create_langgraph(
        chain=chain_rag,
        tools_for_graph=active_tools,
    )

    db_msgs_rag = db_session.exec(
        select(RagMessage).where(RagMessage.session_id == rag_sess_obj.id).order_by(RagMessage.id)
    ).all()
    history_rag: list[AnyMessage] = []
    for m_hist in db_msgs_rag:
        if m_hist.role == "user": history_rag.append(HumanMessage(content=m_hist.content))
        elif m_hist.role == "assistant": 
            history_rag.append(AIMessage(content=m_hist.content))
        elif m_hist.role == "tool":
            if m_hist.metadata_json:
                try:
                    tool_meta = json.loads(m_hist.metadata_json)
                    history_rag.append(ToolMessage(content=m_hist.content, tool_call_id=tool_meta.get("tool_call_id", "")))
                except:
                    history_rag.append(ToolMessage(content=m_hist.content, tool_call_id="unknown"))
            else:
                history_rag.append(ToolMessage(content=m_hist.content, tool_call_id="unknown"))


    initial_graph_state = GraphState(
        messages=history_rag,
        query=payload.query,
        tags=",".join(payload.tags or []),
        user_id=current_user.id
    )
    
    print("--- Invoking LangGraph Agent ---")
    print(f"Initial graph state: {initial_graph_state}")
    result_rag = await agent_rag.ainvoke(initial_graph_state, graph_config)
    print("--- LangGraph Agent Invoked ---")
    
    final_answer_str: str = "回答を生成できませんでした。"
    
    raw_final_ai_content: Any = None
    for msg in reversed(result_rag.get("messages", [])):
        if isinstance(msg, AIMessage) and not msg.tool_calls:
            raw_final_ai_content = msg.content
            print(f"Final AI content found: {raw_final_ai_content}")
            break

    if raw_final_ai_content is not None:
        if isinstance(raw_final_ai_content, str):
            final_answer_str = raw_final_ai_content
        elif isinstance(raw_final_ai_content, list):
            if len(raw_final_ai_content) > 0:
                first_element = "\n\n".join(raw_final_ai_content).strip()
                if isinstance(first_element, str):
                    final_answer_str = first_element
                elif isinstance(first_element, dict) and "text" in first_element and isinstance(first_element["text"], str):
                    final_answer_str = first_element["text"]
                else:
                    final_answer_str = str(first_element)
    
    refs_response: List[Union[RagAnswerRef, WebSearchResultRef]] = []
    processed_tool_call_ids = set()

    for msg_item in result_rag.get("messages", []):
        if isinstance(msg_item, AIMessage) and msg_item.tool_calls:
            for tc in msg_item.tool_calls: 
                tool_name_called = tc.get('name')
                tool_call_id = tc.get('id')

                if not tool_name_called or not tool_call_id or tool_call_id in processed_tool_call_ids:
                    continue
                
                processed_tool_call_ids.add(tool_call_id)

                for tool_msg in result_rag.get("messages", []):
                    if isinstance(tool_msg, ToolMessage) and tool_msg.tool_call_id == tool_call_id:
                        try:
                            tool_output_data = json.loads(tool_msg.content)
                            
                            if tool_name_called == "local_rag_search_tool":
                                if isinstance(tool_output_data, list):
                                    for item_dict in tool_output_data:
                                        if isinstance(item_dict, dict) and item_dict.get("type") == "paper":
                                            refs_response.append(RagAnswerRef.model_validate(item_dict))
                            elif tool_name_called == "web_search_tool":
                                search_results_list = []
                                if isinstance(tool_output_data, list):
                                    search_results_list = tool_output_data
                                elif isinstance(tool_output_data, dict) and "results" in tool_output_data and isinstance(tool_output_data["results"], list):
                                    search_results_list = tool_output_data["results"]
                                
                                for res_item in search_results_list:
                                    if isinstance(res_item, dict) and "url" in res_item and "title" in res_item:
                                        refs_response.append(WebSearchResultRef(
                                            title=res_item.get("title", "N/A"),
                                            url=res_item["url"],
                                            snippet=res_item.get("content") or res_item.get("rawContent"),
                                            score=res_item.get("score")
                                        ))
                        except json.JSONDecodeError:
                            print(f"Warning: ToolMessage content for {tool_name_called} (id: {tool_call_id}) is not valid JSON: {tool_msg.content}")
                        except Exception as e:
                            print(f"Error processing tool output for {tool_name_called} (id: {tool_call_id}): {e}, content: {tool_msg.content}")
                        break 
    
    ai_msg_db = RagMessage(
        session_id=rag_sess_obj.id, 
        role="assistant", 
        content=final_answer_str
    )
    if refs_response:
        refs_for_db_serializable = [ref.model_dump() for ref in refs_response]
        ai_msg_db.metadata_json = json.dumps({"references": refs_for_db_serializable})

    db_session.add(ai_msg_db)
    db_session.commit()
    
    print(f"Constructed refs for response: {refs_response}")
    return RagAnswer(
        answer=final_answer_str,
        refs=refs_response,
        session_id=rag_sess_obj.id
    )

@router.delete("/sessions/{sid}", status_code=204)
def delete_rag_session(
    sid: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    sess_to_del = session.get(RagSession, sid)
    if not sess_to_del or sess_to_del.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG session not found or not authorized")
    
    session.exec(delete(RagMessage).where(RagMessage.session_id == sid))
    session.delete(sess_to_del)
    session.commit()

@router.delete("/sessions/{sid}/messages/{mid}", status_code=204)
def delete_rag_message(
    sid: int,
    mid: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    rag_sess_owner_check = session.get(RagSession, sid)
    if not rag_sess_owner_check or rag_sess_owner_check.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG session not found or not authorized for this message")

    msg_to_del = session.get(RagMessage, mid)
    if not msg_to_del or msg_to_del.session_id != sid:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG message not found in the specified session")
    
    session.delete(msg_to_del)
    session.commit()

async def run_simple_rag_async(
    payload: SimpleRagStartRequest,
    user_id: int,
    session_id: int,
    base_url_origin: str = ""
) -> None:
    from sqlmodel import Session
    from db import engine
    
    try:
        with Session(engine) as db_session:
            rag_sess = db_session.get(RagSession, session_id)
            if not rag_sess:
                logger.error(f"Session {session_id} not found for async processing")
                return
                
            rag_sess.processing_status = "processing"
            db_session.add(rag_sess)
            db_session.commit()
            
            selected_tool_names = payload.selected_tools
            active_tools: List[Tool] = []
            tool_descriptions_for_prompt = []
            citation_instructions_for_prompt = []
            
            try:
                tool_prompt_parts_json = get_rag_tool_prompt_parts(db_session, user_id, base_url_origin=base_url_origin)
                tool_prompt_parts = json_module.loads(tool_prompt_parts_json)
            except Exception as e:
                logger.error(f"ツールプロンプト部品の取得に失敗しました（ユーザーID: {user_id}）: {e}")
                tool_prompt_parts = TOOL_PROMPT_PARTS
            
            if "local_rag_search_tool" in selected_tool_names:
                local_rag_impl = AVAILABLE_TOOL_IMPLEMENTATIONS["local_rag_search_tool"]
                bound_local_rag_search_tool = Tool(
                    name="local_rag_search_tool",
                    func=lambda query, tags=",".join(payload.tags or []): local_rag_impl(query=query, user_id=user_id, db_session=db_session, tags=tags),
                    description="""ユーザーの知識ベース（登録された論文の要約）内を検索します。ユーザーの質問に基づいて、関連する論文情報を取得します。""",
                )
                active_tools.append(bound_local_rag_search_tool)
                tool_descriptions_for_prompt.append(tool_prompt_parts["local_rag_search_tool"]["description"])
                citation_instructions_for_prompt.append(tool_prompt_parts["local_rag_search_tool"]["citation_instruction"])
                
            if "web_search_tool" in selected_tool_names:
                active_tools.append(AVAILABLE_TOOL_IMPLEMENTATIONS["web_search_tool"])
                tool_descriptions_for_prompt.append(tool_prompt_parts["web_search_tool"]["description"])
                citation_instructions_for_prompt.append(tool_prompt_parts["web_search_tool"]["citation_instruction"])
                
            if "web_extract_tool" in selected_tool_names:
                active_tools.append(AVAILABLE_TOOL_IMPLEMENTATIONS["web_extract_tool"])
                tool_descriptions_for_prompt.append(tool_prompt_parts["web_extract_tool"]["description"])
                citation_instructions_for_prompt.append(tool_prompt_parts["web_extract_tool"]["citation_instruction"])
            
            unique_citation_instructions = "\n".join(list(set(citation_instructions_for_prompt)))
            
            if not active_tools:
                try:
                    if payload.use_character_prompt:
                        system_prompt_content = get_rag_no_tool_system_prompt_with_character(db_session, user_id, system_prompt_id=payload.selected_prompts[0].system_prompt_id if payload.selected_prompts else None)
                    else:
                        system_prompt_content = get_rag_no_tool_system_prompt(db_session, user_id, system_prompt_id=payload.selected_prompts[0].system_prompt_id if payload.selected_prompts else None)
                except Exception as e:
                    logger.error(f"RAGノーツールシステムプロンプトの取得に失敗: {e}")
                    system_prompt_content = NO_TOOL_SYSTEM_PROMPT_TEMPLATE
            else:
                try:
                    if payload.use_character_prompt:
                        system_prompt_template = get_rag_base_system_prompt_with_character(db_session, user_id, system_prompt_id=payload.selected_prompts[0].system_prompt_id if payload.selected_prompts else None)
                    else:
                        system_prompt_template = get_rag_base_system_prompt(db_session, user_id, system_prompt_id=payload.selected_prompts[0].system_prompt_id if payload.selected_prompts else None)
                    
                    system_prompt_content = system_prompt_template.format(
                        tool_descriptions_section="\n".join(tool_descriptions_for_prompt),
                        citation_instructions_section=unique_citation_instructions
                    )
                except Exception as e:
                    logger.error(f"RAGベースシステムプロンプトの取得に失敗: {e}")
                    system_prompt_content = BASE_SYSTEM_PROMPT_TEMPLATE.format(
                        tool_descriptions_section="\n".join(tool_descriptions_for_prompt),
                        citation_instructions_section=unique_citation_instructions
                    )
            
            llm_for_rag = initialize_llm(
                name=payload.provider or "openai",
                model_name=payload.model or "gpt-4o-mini",
                temperature=payload.temperature or 0,
                top_p=payload.top_p or 1.0,
                llm_max_retries=3,
            )
            
            prompt_rag = ChatPromptTemplate.from_messages([
                SystemMessage(content=system_prompt_content),
                MessagesPlaceholder("messages"),
                #HumanMessagePromptTemplate.from_template("{query}")
            ])
            
            chain_rag = prompt_rag | llm_for_rag.with_config({"run_name": "SimpleRAG_Async_Chain"}).bind_tools(active_tools)
            
            agent_rag = create_langgraph(chain=chain_rag, tools_for_graph=active_tools)
            
            db_msgs_rag = db_session.exec(
                select(RagMessage).where(RagMessage.session_id == session_id).order_by(RagMessage.id)
            ).all()
            history_rag: list[AnyMessage] = []
            for m_hist in db_msgs_rag:
                if m_hist.role == "user": 
                    history_rag.append(HumanMessage(content=m_hist.content))
                elif m_hist.role == "assistant": 
                    history_rag.append(AIMessage(content=m_hist.content))
                elif m_hist.role == "tool":
                    if m_hist.metadata_json:
                        try:
                            tool_meta = json.loads(m_hist.metadata_json)
                            history_rag.append(ToolMessage(content=m_hist.content, tool_call_id=tool_meta.get("tool_call_id", "")))
                        except:
                            history_rag.append(ToolMessage(content=m_hist.content, tool_call_id="unknown"))
                    else:
                        history_rag.append(ToolMessage(content=m_hist.content, tool_call_id="unknown"))
            
            graph_config = {"recursion_limit": 20000, "configurable": {"thread_id": f"user_{user_id}_simple_rag_{session_id}"}}
            initial_graph_state = GraphState(
                messages=history_rag,
                query=payload.query,
                tags=",".join(payload.tags or []),
                user_id=user_id
            )
            
            logger.info(f"SimpleRAG非同期処理開始: session_id={session_id}, user_id={user_id}")
            
            result_rag = await agent_rag.ainvoke(initial_graph_state, graph_config)
            
            final_answer_str: str = "回答を生成できませんでした。"
            raw_final_ai_content: Any = None
            for msg in reversed(result_rag.get("messages", [])):
                if isinstance(msg, AIMessage) and not msg.tool_calls:
                    raw_final_ai_content = msg.content
                    break
            
            if raw_final_ai_content is not None:
                if isinstance(raw_final_ai_content, str):
                    final_answer_str = raw_final_ai_content
                elif isinstance(raw_final_ai_content, list):
                    if len(raw_final_ai_content) > 0:
                        first_element = "\n\n".join(raw_final_ai_content).strip()
                        if isinstance(first_element, str):
                            final_answer_str = first_element
                        elif isinstance(first_element, dict) and "text" in first_element:
                            final_answer_str = first_element["text"]
                        else:
                            final_answer_str = str(first_element)
            
            refs_response: List[Union[RagAnswerRef, WebSearchResultRef]] = []
            processed_tool_call_ids = set()
            
            for msg_item in result_rag.get("messages", []):
                if isinstance(msg_item, AIMessage) and msg_item.tool_calls:
                    for tc in msg_item.tool_calls:
                        tool_name_called = tc.get('name')
                        tool_call_id = tc.get('id')
                        
                        if not tool_name_called or not tool_call_id or tool_call_id in processed_tool_call_ids:
                            continue
                            
                        processed_tool_call_ids.add(tool_call_id)
                        
                        for tool_msg in result_rag.get("messages", []):
                            if isinstance(tool_msg, ToolMessage) and tool_msg.tool_call_id == tool_call_id:
                                try:
                                    tool_output_data = json.loads(tool_msg.content)
                                    
                                    if tool_name_called == "local_rag_search_tool":
                                        if isinstance(tool_output_data, list):
                                            for item_dict in tool_output_data:
                                                if isinstance(item_dict, dict) and item_dict.get("type") == "paper":
                                                    refs_response.append(RagAnswerRef.model_validate(item_dict))
                                    elif tool_name_called == "web_search_tool":
                                        search_results_list = []
                                        if isinstance(tool_output_data, list):
                                            search_results_list = tool_output_data
                                        elif isinstance(tool_output_data, dict) and "results" in tool_output_data:
                                            search_results_list = tool_output_data["results"]
                                        
                                        for res_item in search_results_list:
                                            if isinstance(res_item, dict) and "url" in res_item and "title" in res_item:
                                                refs_response.append(WebSearchResultRef(
                                                    title=res_item.get("title", "N/A"),
                                                    url=res_item["url"],
                                                    snippet=res_item.get("content") or res_item.get("rawContent"),
                                                    score=res_item.get("score")
                                                ))
                                except (json.JSONDecodeError, Exception) as e:
                                    logger.warning(f"ツール出力処理エラー {tool_name_called}: {e}")
                                break
            
            ai_msg_db = RagMessage(
                session_id=session_id,
                role="assistant",
                content=final_answer_str
            )
            if refs_response:
                refs_for_db_serializable = [ref.model_dump() for ref in refs_response]
                ai_msg_db.metadata_json = json.dumps({"references": refs_for_db_serializable})
            
            db_session.add(ai_msg_db)
            
            rag_sess.processing_status = "completed"
            rag_sess.last_updated = datetime.utcnow()
            db_session.add(rag_sess)
            db_session.commit()
            
            logger.info(f"SimpleRAG非同期処理完了: session_id={session_id}")
            
    except Exception as e:
        logger.error(f"SimpleRAG非同期処理エラー: session_id={session_id}, error={e}")
        try:
            with Session(engine) as error_db_session:
                rag_sess = error_db_session.get(RagSession, session_id)
                if rag_sess:
                    rag_sess.processing_status = "failed"
                    rag_sess.last_updated = datetime.utcnow()
                    error_db_session.add(rag_sess)
                    error_db_session.commit()
        except:
            pass

@router.post("/start_async", response_model=SimpleRagStartResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_simple_rag_async(
    payload: SimpleRagStartRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    if not payload.query.strip():
        raise HTTPException(status_code=422, detail="Query cannot be empty.")
    
    base_url_origin: str = request.headers.get("origin", "")
    
    rag_session: Optional[RagSession] = None
    if payload.session_id:
        rag_session = db_session.get(RagSession, payload.session_id)
        if not rag_session or rag_session.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG session not found or not authorized")
        rag_session.processing_status = "pending"
        if not rag_session.title:
            try:
                prompt_title = get_rag_title_generation_prompt(db_session, current_user.id, query=payload.query)
                response_title = genai_client.models.generate_content(model="gemma-3n-e4b-it", contents=prompt_title)
                title_gen = response_title.text.strip()
            except Exception:
                title_gen = payload.query[:15]
            rag_session.title = f"[SR]:{title_gen}"
        db_session.add(rag_session)
        db_session.commit()
        db_session.refresh(rag_session)
    else:
        try:
            prompt_title = get_rag_title_generation_prompt(db_session, current_user.id, query=payload.query)
            response_title = genai_client.models.generate_content(model="gemma-3n-e4b-it", contents=prompt_title)
            title_gen = response_title.text.strip()
        except Exception:
            title_gen = payload.query[:15]
            
        rag_session = RagSession(
            user_id=current_user.id,
            processing_status="pending",
            title=f"[SR]:{title_gen}"
        )
        db_session.add(rag_session)
        db_session.commit()
        db_session.refresh(rag_session)
    
    user_msg_db = RagMessage(
        session_id=rag_session.id,
        role="user",
        content=payload.query
    )
    db_session.add(user_msg_db)
    db_session.commit()
    
    background_tasks.add_task(
        run_simple_rag_async,
        payload,
        current_user.id,
        rag_session.id,
        base_url_origin
    )
    
    return SimpleRagStartResponse(
        session_id=rag_session.id,
        message="Simple RAG processing started in background"
    )

@router.get("/sessions/{session_id}/status", response_model=SimpleRagStatusResponse)
def get_simple_rag_status(
    session_id: int,
    db_session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    rag_session = db_session.get(RagSession, session_id)
    if not rag_session or rag_session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RAG session not found or not authorized")
    
    messages = db_session.exec(
        select(RagMessage).where(RagMessage.session_id == session_id).order_by(RagMessage.id)
    ).all()
    
    refs = None
    for msg in reversed(messages):
        if msg.role == "assistant" and msg.metadata_json:
            try:
                metadata = json.loads(msg.metadata_json)
                if "references" in metadata:
                    refs_data = metadata["references"]
                    refs = []
                    for ref_item in refs_data:
                        if ref_item.get("type") == "paper":
                            refs.append(RagAnswerRef.model_validate(ref_item))
                        elif ref_item.get("type") == "web":
                            refs.append(WebSearchResultRef.model_validate(ref_item))
                break
            except:
                pass
    
    return SimpleRagStatusResponse(
        session_id=session_id,
        status=rag_session.processing_status,
        messages=[RagMessageRead.model_validate(m) for m in messages],
        last_updated=rag_session.last_updated,
        refs=refs
    )