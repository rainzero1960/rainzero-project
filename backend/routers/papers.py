# backend/routers/papers.py
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.exc import NoResultFound
from sqlmodel import Session, select, col, func, delete # delete をインポート
from sqlalchemy.orm import selectinload
import math
from sqlalchemy import and_, or_, not_, exists
from sqlalchemy.sql.expression import BooleanClauseList
from pydantic import BaseModel # BaseModel をインポート

from db import get_session, engine
from schemas import (
    PaperResponse, UserPaperLinkUpdate, PaperImportResponse,
    PaperCreateAuto, HFImportRequest, ArxivMeta, FullTextResponse,
    ChatMessageCreate, ChatMessageRead, ChatMessageResponse, GeneratedSummaryRead, PaperMetadataRead, UserPaperLinkBase,
    RegenerateSummaryRequest, RegenerateSummaryResponse,
    PapersPageResponse, PaperSummaryItem,
    EditSummaryRequest, EditedSummaryRead, CustomGeneratedSummaryRead,
    VectorExistenceCheckRequest, VectorExistenceCheckResponse,
    DuplicationCheckRequest, DuplicationCheckResponse, SummaryDuplicationInfo, PromptSelection,
    MissingVectorCheckRequest, MissingVectorCheckResponse,
    ExistingSummaryCheckRequest, ExistingSummaryCheckResponse,
    PaperChatSessionCreate, PaperChatSessionRead, PaperChatSessionStatus, PaperChatStartResponse,
    SingleSummaryRequest, SingleSummaryResponse,
    MultipleSummaryRequest, MultipleSummaryResponse, SummaryResult, TagsExistenceRequest, TagsExistenceResponse
)
import yaml, pathlib, functools
import re
import arxiv
import json
import asyncio
import time
from datetime import datetime
from collections import Counter


from .summary_paper import ArxivIDCollector, SummarizerLLM

from models import (
    PaperMetadata, User, ChatMessage, GeneratedSummary, UserPaperLink, EditedSummary, SystemPrompt, CustomGeneratedSummary, PaperChatSession
)
from auth_utils import get_current_active_user

from .module.util import initialize_llm, CONFIG as GLOBAL_LLM_CONFIG
from .module.prompt_manager import (
    get_paper_chat_system_prompt,
    get_paper_chat_system_prompt_with_character, # キャラクタープロンプト付き関数を追加
    get_paper_tag_selection_system_prompt,
    get_paper_tag_selection_question_template,
    get_tag_categories_config
)
import operator
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

from vectorstore.manager import add_texts as manager_add_texts
from vectorstore.manager import delete_vectors_by_metadata, load_vector_cfg, get_vector_store, get_embeddings_by_metadata_filter, vector_exists_for_user_paper
import os

import numpy as np
from typing import List, Optional, Dict, Any, Tuple, Union, Literal
from routers.module.embeddings import EMBED
from sklearn.metrics.pairwise import cosine_similarity

from langchain_core.prompts import ChatPromptTemplate, HumanMessagePromptTemplate
# BaseModel は pydantic から直接インポートするので、Field は不要なら削除
# from pydantic import BaseModel, Field

from .paper_util import (
    _load_cfg,
    get_specialized_llm_config, 
    get_system_prompt, 
    extract_summary_section,
    remove_nul_chars,
    _extract_processing_number,
    _create_processing_placeholder,
    _wait_for_processing_completion,
    _execute_default_summary_generation,
    _execute_custom_summary_generation_new,
    _execute_custom_summary_generation,
    _create_and_store_summary,
    _create_and_store_dual_summaries,
    _add_summary_to_vectorstore,
    _prepare_paper_vector_data,
    _add_paper_to_vectorstore_unified_async,
    _add_paper_to_vectorstore_unified,
    _display_recommendation_details,
    _check_summary_duplications,
    _check_summary_duplication_for_default,
    _check_summary_duplication_for_custom,
    _ensure_empty_session_exists,
    run_paper_chat_async
        )

def _generate_tags_if_needed(
    paper_metadata_id: int,
    user_id: int,
    session: Session,
    current_user,
    force_generation: bool = False
) -> bool:
    """
    論文のタグ生成を実行する共通関数
    
    Args:
        paper_metadata_id: 論文メタデータID
        user_id: ユーザーID
        session: データベースセッション
        current_user: 現在のユーザー
        force_generation: 既存タグがあっても強制的に生成するフラグ
    
    Returns:
        bool: タグ生成が実行された場合True、スキップされた場合False
    """
    
    # ステップ1: UserPaperLinkの取得
    user_paper_link = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == user_id)
        .where(UserPaperLink.paper_metadata_id == paper_metadata_id)
    ).first()
    
    if not user_paper_link:
        print(f"[_generate_tags_if_needed] UserPaperLink not found for user_id: {user_id}, paper_metadata_id: {paper_metadata_id}")
        return False
    
    # ステップ2: 既存タグのチェック（force_generationがFalseの場合のみ）
    if not force_generation:
        has_tags = bool(user_paper_link.tags and user_paper_link.tags.strip())
        if has_tags:
            print(f"[_generate_tags_if_needed] Existing tags found for paper {paper_metadata_id}, user {user_id}. Skipping tag generation.")
            return False
    
    print(f"[_generate_tags_if_needed] Starting tag generation for paper {paper_metadata_id}, user {user_id}")
    
    # ステップ3: 優先順位に基づく要約取得
    summary_text = None
    summary_source = None
    
    # 優先度1: デフォルト・キャラクターなし要約
    default_summary_no_char = session.exec(
        select(GeneratedSummary)
        .where(GeneratedSummary.paper_metadata_id == paper_metadata_id)
        .where(GeneratedSummary.character_role.is_(None))
        .where(~GeneratedSummary.llm_abst.startswith("[PLACEHOLDER]"))
        .where(~GeneratedSummary.llm_abst.startswith("[PROCESSING"))
        .order_by(GeneratedSummary.created_at.desc())
    ).first()
    
    if default_summary_no_char and default_summary_no_char.llm_abst:
        summary_text = default_summary_no_char.llm_abst
        summary_source = f"デフォルト・キャラなし要約 (ID: {default_summary_no_char.id})"
        print(f"[_generate_tags_if_needed] Using default no-character summary for tag generation")
    
    # 優先度2: デフォルト・キャラクターあり要約
    if not summary_text:
        default_summary_with_char = session.exec(
            select(GeneratedSummary)
            .where(GeneratedSummary.paper_metadata_id == paper_metadata_id)
            .where(GeneratedSummary.character_role.is_not(None))
            .where(~GeneratedSummary.llm_abst.startswith("[PLACEHOLDER]"))
            .where(~GeneratedSummary.llm_abst.startswith("[PROCESSING"))
            .order_by(GeneratedSummary.created_at.desc())
        ).first()
        
        if default_summary_with_char and default_summary_with_char.llm_abst:
            summary_text = default_summary_with_char.llm_abst
            summary_source = f"デフォルト・キャラあり要約 (ID: {default_summary_with_char.id}, character: {default_summary_with_char.character_role})"
            print(f"[_generate_tags_if_needed] Using default character summary for tag generation (fallback)")
    
    # 優先度3: カスタム・キャラクターなし要約
    if not summary_text:
        custom_summary_no_char = session.exec(
            select(CustomGeneratedSummary)
            .where(CustomGeneratedSummary.paper_metadata_id == paper_metadata_id)
            .where(CustomGeneratedSummary.user_id == user_id)
            .where(CustomGeneratedSummary.character_role.is_(None))
            .where(~CustomGeneratedSummary.llm_abst.startswith("[PLACEHOLDER]"))
            .where(~CustomGeneratedSummary.llm_abst.startswith("[PROCESSING"))
            .order_by(CustomGeneratedSummary.created_at.desc())
        ).first()
        
        if custom_summary_no_char and custom_summary_no_char.llm_abst:
            summary_text = custom_summary_no_char.llm_abst
            summary_source = f"カスタム・キャラなし要約 (ID: {custom_summary_no_char.id})"
            print(f"[_generate_tags_if_needed] Using custom no-character summary for tag generation (fallback)")
    
    # 優先度4: カスタム・キャラクターあり要約
    if not summary_text:
        custom_summary_with_char = session.exec(
            select(CustomGeneratedSummary)
            .where(CustomGeneratedSummary.paper_metadata_id == paper_metadata_id)
            .where(CustomGeneratedSummary.user_id == user_id)
            .where(CustomGeneratedSummary.character_role.is_not(None))
            .where(~CustomGeneratedSummary.llm_abst.startswith("[PLACEHOLDER]"))
            .where(~CustomGeneratedSummary.llm_abst.startswith("[PROCESSING"))
            .order_by(CustomGeneratedSummary.created_at.desc())
        ).first()
        
        if custom_summary_with_char and custom_summary_with_char.llm_abst:
            summary_text = custom_summary_with_char.llm_abst
            summary_source = f"カスタム・キャラあり要約 (ID: {custom_summary_with_char.id}, character: {custom_summary_with_char.character_role})"
            print(f"[_generate_tags_if_needed] Using custom character summary for tag generation (final fallback)")
    
    # ステップ4: 要約が見つからない場合はスキップ
    if not summary_text:
        print(f"[_generate_tags_if_needed] No valid summary found for tag generation (paper {paper_metadata_id}, user {user_id})")
        return False
    
    print(f"[_generate_tags_if_needed] Selected summary source: {summary_source}")
    
    # ステップ5: タグ生成処理
    try:
        # タグ生成に必要なプロンプトとLLM設定を取得
        tag_system_prompt = get_paper_tag_selection_system_prompt(session, user_id)
        cats_text = get_tag_categories_config(session, user_id)
        tag_question = get_paper_tag_selection_question_template(
            session, user_id,
            cats_text=cats_text,
            summary=summary_text[:5000]
        )
        
        # LLMチェーンの準備
        tag_config = get_specialized_llm_config("tag_generation")
        tag_llm = initialize_llm(
            name=tag_config["provider"],
            model_name=tag_config["model_name"],
            temperature=tag_config["temperature"],
        )
        fallback_config = get_specialized_llm_config("tag_fallback")
        fallback_llm = initialize_llm(
            name=fallback_config["provider"],
            model_name=fallback_config["model_name"],
            temperature=fallback_config["temperature"],
        )
        
        tag_prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content=tag_system_prompt),
            HumanMessagePromptTemplate.from_template("{question}")
        ])
        tag_chain = tag_prompt | tag_llm
        fallback_chain = tag_prompt | fallback_llm
        
        # タグ生成実行（メイン試行）
        selected_tags_csv = ""
        error_cnt = 0
        fallback_error_cnt = 0
        fallback_flag = False
        
        for attempt in range(3):
            try:
                result = tag_chain.invoke({"question": tag_question})
                selected_tags_csv = result.content.strip()
                print(f"[_generate_tags_if_needed] Tag generation successful (attempt {attempt + 1}): {selected_tags_csv}")
                break
            except Exception as e:
                error_cnt += 1
                print(f"[_generate_tags_if_needed] Tag generation failed (attempt {attempt + 1}): {e}")
                if attempt == 2:  # 最後の試行でも失敗した場合
                    fallback_flag = True
        
        # フォールバック試行
        if fallback_flag and not selected_tags_csv:
            print(f"[_generate_tags_if_needed] Attempting fallback LLM for tag generation")
            for attempt in range(3):
                try:
                    result = fallback_chain.invoke({"question": tag_question})
                    selected_tags_csv = result.content.strip()
                    print(f"[_generate_tags_if_needed] Fallback tag generation successful (attempt {attempt + 1}): {selected_tags_csv}")
                    break
                except Exception as e:
                    fallback_error_cnt += 1
                    print(f"[_generate_tags_if_needed] Fallback tag generation failed (attempt {attempt + 1}): {e}")
        
        # ステップ6: 生成されたタグをUserPaperLinkに保存
        if selected_tags_csv:
            user_paper_link.tags = selected_tags_csv
            session.add(user_paper_link)
            session.commit()
            print(f"[_generate_tags_if_needed] Tags successfully generated and saved: {selected_tags_csv}")
            return True
        else:
            print(f"[_generate_tags_if_needed] Tag generation failed after all attempts")
            return False
    
    except Exception as e:
        print(f"[_generate_tags_if_needed] Tag generation error: {e}")
        return False


def select_best_summary_by_priority(
    generated_summaries: List[GeneratedSummary],
    custom_summaries: List[CustomGeneratedSummary],
    current_selection_type: Optional[Literal["default", "custom"]] = None,
    current_summary_id: Optional[int] = None,
    current_custom_summary_id: Optional[int] = None,
    selection_mode: Literal["initial", "regenerate_detail", "regenerate_add"] = "initial",
    user_selected_character: Optional[str] = None
) -> Tuple[Optional[GeneratedSummary], Optional[CustomGeneratedSummary]]:
    """
    要約選択の優先順位に基づいて最適な要約を選択する関数
    
    Args:
        generated_summaries: 利用可能なデフォルト要約のリスト
        custom_summaries: 利用可能なカスタム要約のリスト
        current_selection_type: 現在選択されている要約のタイプ ("default" または "custom")
        current_summary_id: 現在選択されているデフォルト要約のID
        current_custom_summary_id: 現在選択されているカスタム要約のID
        selection_mode: 選択モード
            - "initial": 最初の要約作成時
            - "regenerate_detail": 詳細画面からの再生成
            - "regenerate_add": addページからの再生成
    
    Returns:
        Tuple[選択されたデフォルト要約, 選択されたカスタム要約]
        どちらか一方のみが設定され、もう一方はNoneになる
    """
    
    def get_summary_priority_score(summary: Union[GeneratedSummary, CustomGeneratedSummary], is_custom: bool) -> int:
        """要約の優先順位スコアを計算（高いほど優先）"""
        base_score = 0
        
        # プロンプトタイプによる基本スコア
        if is_custom:
            base_score += 1000  # カスタムプロンプトを優先
        
        # キャラクターロールプレイによるボーナス
        character_role = getattr(summary, 'character_role', None)
        if character_role is not None:
            if user_selected_character and character_role == user_selected_character:
                base_score += 200  # ユーザー選択キャラクターと一致する場合は高優先度
            elif user_selected_character and character_role != user_selected_character:
                base_score -= 50   # ユーザー選択キャラクターと不一致の場合は低優先度
            elif not user_selected_character:
                base_score += 100  # ユーザーがキャラクター未選択の場合は従来通り
        
        print(f"[DEBUG] スコア計算: ID={summary.id}, is_custom={is_custom}, character_role={character_role}, user_selected={user_selected_character}, score={base_score}")
        return base_score
    
    # 各要約の優先順位スコアを計算
    scored_summaries = []
    
    # デフォルト要約のスコア計算
    for summary in generated_summaries:
        score = get_summary_priority_score(summary, False)
        scored_summaries.append({
            'summary': summary,
            'is_custom': False,
            'score': score,
            'created_at': summary.created_at
        })
    
    # カスタム要約のスコア計算
    for summary in custom_summaries:
        score = get_summary_priority_score(summary, True)
        scored_summaries.append({
            'summary': summary,
            'is_custom': True,
            'score': score,
            'created_at': summary.created_at
        })
    
    if not scored_summaries:
        return None, None
    
    # 選択モードに基づく処理
    if selection_mode == "regenerate_detail":
        # 詳細画面からの再生成：現在の選択タイプを維持しつつキャラクターを優先
        if current_selection_type == "custom":
            # カスタム要約の中から選択（キャラクターありを優先）
            custom_scored = [s for s in scored_summaries if s['is_custom']]
            if custom_scored:
                # スコア順、次に作成日時順でソート
                custom_scored.sort(key=lambda x: (-x['score'], -x['created_at'].timestamp()))
                best_custom = custom_scored[0]['summary']
                return None, best_custom
            # カスタム要約がない場合は全体から選択にフォールバック
        elif current_selection_type == "default":
            # デフォルト要約の中から選択（キャラクターありを優先）
            default_scored = [s for s in scored_summaries if not s['is_custom']]
            if default_scored:
                # スコア順、次に作成日時順でソート
                default_scored.sort(key=lambda x: (-x['score'], -x['created_at'].timestamp()))
                best_default = default_scored[0]['summary']
                return best_default, None
            # デフォルト要約がない場合は全体から選択にフォールバック
    
    # 初期作成時 または add再生成時 または 詳細再生成でフォールバック
    # 全体の優先順位: カスタム+キャラ > カスタム > デフォルト+キャラ > デフォルト
    print(f"[DEBUG] 全体から最優先要約を選択中 (selection_mode={selection_mode})")
    for i, s in enumerate(scored_summaries):
        summary = s['summary']
        character_role = getattr(summary, 'character_role', None)
        print(f"[DEBUG]   {i}: ID={summary.id}, is_custom={s['is_custom']}, character={character_role}, score={s['score']}, created={s['created_at']}")
    
    scored_summaries.sort(key=lambda x: (-x['score'], -x['created_at'].timestamp()))
    best_summary = scored_summaries[0]
    
    print(f"[DEBUG] 最優先要約決定: ID={best_summary['summary'].id}, is_custom={best_summary['is_custom']}, score={best_summary['score']}")
    
    if best_summary['is_custom']:
        return None, best_summary['summary']
    else:
        return best_summary['summary'], None


router = APIRouter(prefix="/papers", tags=["papers"])

@router.get("/config/models")
def get_model_config():
    cfg = _load_cfg().get("model_settings", {})
    common = cfg.get("common", {})
    page   = cfg.get("paper_page", {})
    merged_models    = { **common.get("models", {}), **page.get("models", {}) }
    merged_defaults  = { **common.get("default_models_by_provider", {}), **page.get("default_models_by_provider", {}) }
    merged_default   = page.get("default_model", common.get("default_model"))

    return {
        **common,
        **page,
        "models": merged_models,
        "default_models_by_provider": merged_defaults,
        "default_model": merged_default,
    }

@router.get("/config/detail-models")
def get_detail_model_config():
    cfg = _load_cfg().get("model_settings", {})
    common = cfg.get("common", {})
    page   = cfg.get("paper_detail_page", {})
    merged_models    = { **common.get("models", {}), **page.get("models", {}) }
    merged_defaults  = { **common.get("default_models_by_provider", {}), **page.get("default_models_by_provider", {}) }
    merged_default   = page.get("default_model", common.get("default_model"))

    return {
        **common,
        **page,
        "models": merged_models,
        "default_models_by_provider": merged_defaults,
        "default_model": merged_default,
    }

@router.get("/config/custom-prompt-status")
def get_custom_prompt_status(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """カスタムプロンプトの設定状況を取得"""
    from routers.module.default_prompts import PromptType
    
    # 初期要約プロンプトの設定状況をチェック
    custom_initial_prompt = session.exec(
        select(SystemPrompt)
        .where(SystemPrompt.user_id == current_user.id)
        .where(SystemPrompt.prompt_type == PromptType.PAPER_SUMMARY_INITIAL.value)
        .where(SystemPrompt.is_active == True)
    ).first()
    
    return {
        "has_custom_initial_summary": custom_initial_prompt is not None,
        "initial_summary_prompt_name": custom_initial_prompt.name if custom_initial_prompt else None
    }



LEVEL_TAGS_FROM_FRONTEND = ['お気に入り', '理解した', 'サラッと読んだ', '後で読む', '理解度タグなし', 'Recommended', '興味なし']
ACTUAL_LEVEL_TAGS_FOR_DB_QUERY = [tag for tag in LEVEL_TAGS_FROM_FRONTEND if tag not in ['理解度タグなし', 'Recommended', '興味なし']]


@router.get("/tags_summary", response_model=Dict[str, int])
def get_user_tags_summary(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    user_paper_links = session.exec(
        select(UserPaperLink.tags).where(UserPaperLink.user_id == current_user.id)
    ).all()

    tag_counts = Counter()
    num_papers_without_actual_level_tag = 0
    
    all_paper_tags_list = []
    for tags_str in user_paper_links:
        if tags_str:
            current_paper_tags = [t.strip() for t in tags_str.split(",") if t.strip()]
            all_paper_tags_list.append(current_paper_tags)
            tag_counts.update(current_paper_tags)
    
    for paper_tags_list_item in all_paper_tags_list:
        has_actual_level_tag = any(tag in ACTUAL_LEVEL_TAGS_FOR_DB_QUERY for tag in paper_tags_list_item)
        if not has_actual_level_tag:
            num_papers_without_actual_level_tag +=1
            
    tag_counts["理解度タグなし"] = num_papers_without_actual_level_tag
    
    return dict(tag_counts)


@router.get("/tag_categories", response_model=Dict[str, List[str]])
def get_tag_categories(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """タグカテゴリー設定を取得"""
    try:
        tag_categories_json = get_tag_categories_config(session, current_user.id)
        tag_categories = json.loads(tag_categories_json)
        return tag_categories
    except Exception as e:
        print(f"タグカテゴリー設定の取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
        # フォールバック：ハードコードされたTAG_CATEGORIESを使用
        from .module.util import TAG_CATEGORIES
        return TAG_CATEGORIES


@router.get("", response_model=PapersPageResponse)
def list_user_papers(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=100),
    level_tags: Optional[List[str]] = Query(None),
    domain_tags: Optional[List[str]] = Query(None),
    filter_mode: str = Query("OR", enum=["OR", "AND"]),
    show_interest_none: bool = Query(True),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc", enum=["asc", "desc"]),
    search_keyword: Optional[str] = Query(None, description="検索キーワード（スペース区切りでAND検索）")
):
    offset = (page - 1) * size

    conditions = [UserPaperLink.user_id == current_user.id]

    if not show_interest_none:
        conditions.append(not_(UserPaperLink.tags.contains("興味なし")))

    
    active_level_tags_from_query = [tag for tag in (level_tags or []) if tag != "理解度タグなし"]
    apply_no_level_tag_filter = "理解度タグなし" in (level_tags or [])
    
    level_tag_sub_conditions = []
    if active_level_tags_from_query:
        if filter_mode == "AND":
            level_tag_sub_conditions.extend([UserPaperLink.tags.contains(tag) for tag in active_level_tags_from_query])
        else: 
            level_tag_sub_conditions.append(or_(*[UserPaperLink.tags.contains(tag) for tag in active_level_tags_from_query]))

    if apply_no_level_tag_filter:
        no_actual_level_tag_cond = not_(or_(*[UserPaperLink.tags.contains(lt) for lt in ACTUAL_LEVEL_TAGS_FOR_DB_QUERY]))
        if filter_mode == "AND" and active_level_tags_from_query:
             level_tag_sub_conditions.append(no_actual_level_tag_cond)
        elif filter_mode == "OR" or not active_level_tags_from_query:
             level_tag_sub_conditions.append(no_actual_level_tag_cond)
        elif filter_mode == "AND" and not active_level_tags_from_query : 
            level_tag_sub_conditions.append(no_actual_level_tag_cond)


    domain_tag_sub_conditions = []
    if domain_tags:
        if filter_mode == "AND":
            domain_tag_sub_conditions.extend([UserPaperLink.tags.contains(tag) for tag in domain_tags])
        else: 
            domain_tag_sub_conditions.append(or_(*[UserPaperLink.tags.contains(tag) for tag in domain_tags]))

    
    if level_tag_sub_conditions and domain_tag_sub_conditions:
        if filter_mode == "AND":
            
            all_sub_conds_for_and = []
            if any(isinstance(c, BooleanClauseList) for c in level_tag_sub_conditions): 
                all_sub_conds_for_and.append(or_(*[c for c in level_tag_sub_conditions if not isinstance(c, BooleanClauseList)], *[item for sublist in [c.clauses for c in level_tag_sub_conditions if isinstance(c, BooleanClauseList)] for item in sublist]))
            else:
                all_sub_conds_for_and.extend(level_tag_sub_conditions)

            if any(isinstance(c, BooleanClauseList) for c in domain_tag_sub_conditions): 
                all_sub_conds_for_and.append(or_(*[c for c in domain_tag_sub_conditions if not isinstance(c, BooleanClauseList)], *[item for sublist in [c.clauses for c in domain_tag_sub_conditions if isinstance(c, BooleanClauseList)] for item in sublist]))
            else:
                all_sub_conds_for_and.extend(domain_tag_sub_conditions)
            
            conditions.append(and_(*all_sub_conds_for_and))

        else: 
            
            or_groups = []
            if level_tag_sub_conditions:
                or_groups.append(or_(*level_tag_sub_conditions) if not (len(level_tag_sub_conditions)==1 and not isinstance(level_tag_sub_conditions[0], BooleanClauseList)) else level_tag_sub_conditions[0])
            if domain_tag_sub_conditions:
                or_groups.append(or_(*domain_tag_sub_conditions) if not (len(domain_tag_sub_conditions)==1 and not isinstance(domain_tag_sub_conditions[0], BooleanClauseList)) else domain_tag_sub_conditions[0])
            if or_groups:
                conditions.append(or_(*or_groups))

    elif level_tag_sub_conditions: 
        conditions.append(and_(*level_tag_sub_conditions) if filter_mode == "AND" and not any(isinstance(c, BooleanClauseList) for c in level_tag_sub_conditions) else or_(*level_tag_sub_conditions))
    elif domain_tag_sub_conditions: 
        conditions.append(and_(*domain_tag_sub_conditions) if filter_mode == "AND" and not any(isinstance(c, BooleanClauseList) for c in domain_tag_sub_conditions) else or_(*domain_tag_sub_conditions))

    # キーワード検索条件の追加（サブクエリ方式）
    if search_keyword and search_keyword.strip():
        # 全角・半角スペースで分割し、空文字を除外
        keywords = re.split(r'[\s\u3000]+', search_keyword.strip())
        keywords = [k for k in keywords if k]
        
        if keywords:
            keyword_conditions = []
            for keyword in keywords:
                # タイトル検索のサブクエリ
                title_condition = exists().where(
                    and_(
                        PaperMetadata.id == UserPaperLink.paper_metadata_id,
                        PaperMetadata.title.contains(keyword)
                    )
                )
                
                # デフォルト要約検索のサブクエリ
                default_summary_condition = exists().where(
                    and_(
                        GeneratedSummary.paper_metadata_id == UserPaperLink.paper_metadata_id,
                        GeneratedSummary.llm_abst.contains(keyword)
                    )
                )
                
                # カスタム要約検索のサブクエリ
                custom_summary_condition = exists().where(
                    and_(
                        CustomGeneratedSummary.paper_metadata_id == UserPaperLink.paper_metadata_id,
                        CustomGeneratedSummary.user_id == current_user.id,
                        CustomGeneratedSummary.llm_abst.contains(keyword)
                    )
                )
                
                # 各キーワードに対して：タイトル OR デフォルト要約 OR カスタム要約
                keyword_conditions.append(
                    or_(
                        title_condition,
                        default_summary_condition,
                        custom_summary_condition
                    )
                )
            
            # 全キーワードをAND条件で結合
            conditions.append(and_(*keyword_conditions))

    final_conditions = and_(*conditions)

    # カウント用クエリ（サブクエリ方式のためJOIN不要）
    total_count_query = select(func.count(UserPaperLink.id)).where(final_conditions)
    total_count = session.exec(total_count_query).one()

    # データ取得用クエリ（サブクエリ方式のためJOIN不要）
    user_paper_links_query = (
        select(UserPaperLink)
        .where(final_conditions)
        .options(
            selectinload(UserPaperLink.paper_metadata),
            selectinload(UserPaperLink.selected_summary)
        )
    )

    
    sort_column_obj = None
    needs_join_for_sort = False

    if sort_by == "title":
        sort_column_obj = PaperMetadata.title
        needs_join_for_sort = True
    elif sort_by == "published_date":
        sort_column_obj = PaperMetadata.published_date
        needs_join_for_sort = True
    elif sort_by == "arxiv_id": 
        sort_column_obj = PaperMetadata.arxiv_id
        needs_join_for_sort = True
    elif sort_by == "created_at":
        sort_column_obj = UserPaperLink.created_at
    elif sort_by == "last_accessed_at":
        sort_column_obj = UserPaperLink.last_accessed_at
    elif sort_by == "user_paper_link_id":
        sort_column_obj = UserPaperLink.id
    else: 
        sort_column_obj = UserPaperLink.created_at
        sort_dir = "desc" 

    if needs_join_for_sort:
        # ソート用にPaperMetadataをJOIN
        user_paper_links_query = user_paper_links_query.join(PaperMetadata, UserPaperLink.paper_metadata_id == PaperMetadata.id)

    if sort_column_obj is not None:
        if sort_dir == "desc":
            user_paper_links_query = user_paper_links_query.order_by(col(sort_column_obj).desc().nullslast())
        else:
            user_paper_links_query = user_paper_links_query.order_by(col(sort_column_obj).asc().nullsfirst())
    
    user_paper_links_query = user_paper_links_query.offset(offset).limit(size)
    user_paper_links_with_meta = session.exec(user_paper_links_query).all()


    if not user_paper_links_with_meta:
        return PapersPageResponse(items=[], total=0, page=page, size=size, pages=0)

    # 一括でEditedSummaryを取得してパフォーマンスを向上（デフォルト要約とカスタム要約の両方）
    summary_ids = []
    custom_summary_ids = []
    for link in user_paper_links_with_meta:
        if link.selected_generated_summary_id:
            summary_ids.append(link.selected_generated_summary_id)
        elif link.selected_custom_generated_summary_id:
            custom_summary_ids.append(link.selected_custom_generated_summary_id)
        elif link.paper_metadata and not link.selected_custom_generated_summary_id:
            # カスタム要約が選択されていない場合のみ、デフォルト要約を自動選択
            latest_summary = session.exec(
                select(GeneratedSummary.id)
                .where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
                .order_by(GeneratedSummary.created_at.desc())
            ).first()
            if latest_summary:
                summary_ids.append(latest_summary)

    # デフォルト要約のEditedSummaryを取得
    edited_summaries = {}
    if summary_ids:
        edited_summaries_list = session.exec(
            select(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.generated_summary_id.in_(summary_ids))
        ).all()
        edited_summaries = {es.generated_summary_id: es for es in edited_summaries_list}

    # カスタム要約のEditedSummaryを取得
    custom_edited_summaries = {}
    if custom_summary_ids:
        custom_edited_summaries_list = session.exec(
            select(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.custom_generated_summary_id.in_(custom_summary_ids))
        ).all()
        custom_edited_summaries = {es.custom_generated_summary_id: es for es in custom_edited_summaries_list}

    response_list = []
    for link in user_paper_links_with_meta:
        if not link.paper_metadata:
            continue

        # カスタム要約とデフォルト要約の処理（キャラクター整合性チェック付き）
        selected_custom_summary_orm: Optional[CustomGeneratedSummary] = None
        selected_summary_orm: Optional[GeneratedSummary] = None
        
        
        # DBに保存された選択状態をそのまま信頼して要約を取得
        if link.selected_custom_generated_summary_id:
            selected_custom_summary_orm = session.get(CustomGeneratedSummary, link.selected_custom_generated_summary_id)
        elif link.selected_generated_summary_id:
            selected_summary_orm = session.get(GeneratedSummary, link.selected_generated_summary_id)

        # 「一言でいうと」と LLM 情報の取得（カスタム要約を優先）
        one_point = None
        llm_info = None
        
        if selected_custom_summary_orm:
            # カスタム要約が選択されている場合
            user_edited_summary = custom_edited_summaries.get(selected_custom_summary_orm.id)
            
            if user_edited_summary:
                # EditedSummaryから「一言でいうと」を抽出
                one_point = extract_summary_section(user_edited_summary.edited_llm_abst)
            else:
                # CustomGeneratedSummaryの一言要約をそのまま使用
                one_point = selected_custom_summary_orm.one_point
            
            llm_info = f"{selected_custom_summary_orm.llm_provider}/{selected_custom_summary_orm.llm_model_name}"
            
        elif selected_summary_orm:
            # デフォルト要約が選択されている場合
            user_edited_summary = edited_summaries.get(selected_summary_orm.id)
            
            if user_edited_summary:
                # EditedSummaryから「一言でいうと」を抽出
                one_point = extract_summary_section(user_edited_summary.edited_llm_abst)
            else:
                # GeneratedSummaryの一言要約をそのまま使用
                one_point = selected_summary_orm.one_point
            
            llm_info = f"{selected_summary_orm.llm_provider}/{selected_summary_orm.llm_model_name}"

        paper_meta_read = PaperMetadataRead.model_validate(link.paper_metadata)
        
        response_list.append(
            PaperSummaryItem(
                user_paper_link_id=link.id,
                paper_metadata=paper_meta_read,
                selected_generated_summary_one_point=one_point,
                selected_generated_summary_llm_info=llm_info,
                user_specific_data=UserPaperLinkBase(tags=link.tags, memo=link.memo),
                created_at=link.created_at,
                last_accessed_at=link.last_accessed_at
            )
        )
    
    return PapersPageResponse(
        items=response_list,
        total=total_count,
        page=page,
        size=size,
        pages=math.ceil(total_count / size) if total_count > 0 else 0
    )

@router.get("/{user_paper_link_id}", response_model=PaperResponse)
def get_user_paper(
    user_paper_link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access this paper link")

    if not link.paper_metadata:
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Paper metadata not found for this link")

    # ========== GeneratedSummary (デフォルト要約) の処理 ==========
    selected_summary_orm: Optional[GeneratedSummary] = None
    if link.selected_generated_summary_id:
        selected_summary_orm = session.get(GeneratedSummary, link.selected_generated_summary_id)
    
    # カスタム要約が選択されていない場合のみ、デフォルト要約を自動選択
    if not selected_summary_orm and not link.selected_custom_generated_summary_id:
        selected_summary_orm = session.exec(
            select(GeneratedSummary)
            .where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
            .order_by(GeneratedSummary.created_at.desc())
        ).first()

    all_summaries_orm = session.exec(
        select(GeneratedSummary)
        .where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
        .order_by(GeneratedSummary.created_at.desc())
    ).all()

    # ========== CustomGeneratedSummary (カスタム要約) の処理 ==========
    selected_custom_summary_orm: Optional[CustomGeneratedSummary] = None
    if link.selected_custom_generated_summary_id:
        selected_custom_summary_orm = session.get(CustomGeneratedSummary, link.selected_custom_generated_summary_id)

    # このユーザーの全てのカスタム要約を取得
    all_custom_summaries_orm = session.exec(
        select(CustomGeneratedSummary)
        .where(CustomGeneratedSummary.user_id == current_user.id)
        .where(CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id)
        .order_by(CustomGeneratedSummary.created_at.desc())
    ).all()

    # ========== EditedSummary (編集要約) の処理 ==========
    user_edited_summary_orm: Optional[EditedSummary] = None
    
    # 現在選択中の要約に対する編集がある場合を取得
    # フロントエンドの表示優先順位に合わせて、カスタム要約を優先してチェック
    if selected_custom_summary_orm:
        user_edited_summary_orm = session.exec(
            select(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.custom_generated_summary_id == selected_custom_summary_orm.id)
        ).first()
    elif selected_summary_orm:
        user_edited_summary_orm = session.exec(
            select(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.generated_summary_id == selected_summary_orm.id)
        ).first()

    # ========== has_user_edited_summary フラグの計算 ==========
    # 各GeneratedSummaryに対してユーザーのEditedSummaryが存在するかを一括チェック
    edited_summary_exists = {}
    if all_summaries_orm:
        summary_ids = [s.id for s in all_summaries_orm]
        existing_edited_summaries = session.exec(
            select(EditedSummary.generated_summary_id)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.generated_summary_id.in_(summary_ids))
        ).all()
        edited_summary_exists = {sid: True for sid in existing_edited_summaries}

    # 各CustomGeneratedSummaryに対してユーザーのEditedSummaryが存在するかを一括チェック
    custom_edited_summary_exists = {}
    if all_custom_summaries_orm:
        custom_summary_ids = [s.id for s in all_custom_summaries_orm]
        existing_custom_edited_summaries = session.exec(
            select(EditedSummary.custom_generated_summary_id)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.custom_generated_summary_id.in_(custom_summary_ids))
        ).all()
        custom_edited_summary_exists = {sid: True for sid in existing_custom_edited_summaries}

    # ========== SystemPromptの取得（カスタム要約の表示名用） ==========
    prompt_name_map = {}
    if all_custom_summaries_orm:
        prompt_ids = [s.system_prompt_id for s in all_custom_summaries_orm]
        system_prompts = session.exec(
            select(SystemPrompt)
            .where(SystemPrompt.id.in_(prompt_ids))
        ).all()
        prompt_name_map = {sp.id: sp.name for sp in system_prompts}

    link.last_accessed_at = datetime.utcnow()
    session.add(link)
    session.commit()
    session.refresh(link)

    # ========== レスポンス用データの構築 ==========
    # available_summariesにhas_user_edited_summary情報を付与
    available_summaries = []
    for s in all_summaries_orm:
        summary_read = GeneratedSummaryRead.model_validate(s)
        summary_read.has_user_edited_summary = edited_summary_exists.get(s.id, False)
        available_summaries.append(summary_read)

    # available_custom_summariesにhas_user_edited_summary情報を付与
    available_custom_summaries = []
    for s in all_custom_summaries_orm:
        custom_summary_read = CustomGeneratedSummaryRead.model_validate(s)
        custom_summary_read.has_user_edited_summary = custom_edited_summary_exists.get(s.id, False)
        custom_summary_read.system_prompt_name = prompt_name_map.get(s.system_prompt_id)
        available_custom_summaries.append(custom_summary_read)

    # selected_summaryにもhas_user_edited_summary情報を付与
    selected_summary_read = None
    if selected_summary_orm:
        selected_summary_read = GeneratedSummaryRead.model_validate(selected_summary_orm)
        selected_summary_read.has_user_edited_summary = edited_summary_exists.get(selected_summary_orm.id, False)

    # selected_custom_summaryにもhas_user_edited_summary情報を付与
    selected_custom_summary_read = None
    if selected_custom_summary_orm:
        selected_custom_summary_read = CustomGeneratedSummaryRead.model_validate(selected_custom_summary_orm)
        selected_custom_summary_read.has_user_edited_summary = custom_edited_summary_exists.get(selected_custom_summary_orm.id, False)
        selected_custom_summary_read.system_prompt_name = prompt_name_map.get(selected_custom_summary_orm.system_prompt_id)

    return PaperResponse(
        user_paper_link_id=link.id,
        paper_metadata=PaperMetadataRead.model_validate(link.paper_metadata),
        selected_generated_summary=selected_summary_read,
        selected_custom_generated_summary=selected_custom_summary_read,
        user_edited_summary=EditedSummaryRead.model_validate(user_edited_summary_orm) if user_edited_summary_orm else None,
        selected_generated_summary_id=link.selected_generated_summary_id,
        selected_custom_generated_summary_id=link.selected_custom_generated_summary_id,
        available_summaries=available_summaries,
        available_custom_summaries=available_custom_summaries,
        user_specific_data=UserPaperLinkBase(tags=link.tags, memo=link.memo),
        created_at=link.created_at,
        last_accessed_at=link.last_accessed_at
    )

@router.put("/{user_paper_link_id}", response_model=PaperResponse)
def update_user_paper_link(
    user_paper_link_id: int,
    payload: UserPaperLinkUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to update this paper link")

    payload_data = payload.model_dump(exclude_unset=True)
    for key, value in payload_data.items():
        setattr(link, key, value)
    
    link.updated_at = datetime.utcnow()
    session.add(link)
    session.commit()
    session.refresh(link)
    
    if not link.paper_metadata:
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Paper metadata not found for this link after update")

    selected_summary_orm: Optional[GeneratedSummary] = None
    if link.selected_generated_summary_id:
        selected_summary_orm = session.get(GeneratedSummary, link.selected_generated_summary_id)
    if not selected_summary_orm:
        selected_summary_orm = session.exec(
            select(GeneratedSummary)
            .where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
            .order_by(GeneratedSummary.created_at.desc())
        ).first()
    
    user_edited_summary_orm: Optional[EditedSummary] = None
    if selected_summary_orm:
        user_edited_summary_orm = session.exec(
            select(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.generated_summary_id == selected_summary_orm.id)
        ).first()

    all_summaries_orm = session.exec(
        select(GeneratedSummary)
        .where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
        .order_by(GeneratedSummary.created_at.desc())
    ).all()

    # 各GeneratedSummaryに対してユーザーのEditedSummaryが存在するかを一括チェック
    edited_summary_exists = {}
    if all_summaries_orm:
        summary_ids = [s.id for s in all_summaries_orm]
        existing_edited_summaries = session.exec(
            select(EditedSummary.generated_summary_id)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.generated_summary_id.in_(summary_ids))
        ).all()
        edited_summary_exists = {sid: True for sid in existing_edited_summaries}

    # available_summariesにhas_user_edited_summary情報を付与
    available_summaries = []
    for s in all_summaries_orm:
        summary_read = GeneratedSummaryRead.model_validate(s)
        summary_read.has_user_edited_summary = edited_summary_exists.get(s.id, False)
        available_summaries.append(summary_read)

    # selected_summaryにもhas_user_edited_summary情報を付与
    selected_summary_read = None
    if selected_summary_orm:
        selected_summary_read = GeneratedSummaryRead.model_validate(selected_summary_orm)
        selected_summary_read.has_user_edited_summary = edited_summary_exists.get(selected_summary_orm.id, False)

    return PaperResponse(
        user_paper_link_id=link.id,
        paper_metadata=PaperMetadataRead.model_validate(link.paper_metadata),
        selected_generated_summary=selected_summary_read,
        user_edited_summary=EditedSummaryRead.model_validate(user_edited_summary_orm) if user_edited_summary_orm else None,
        selected_generated_summary_id=link.selected_generated_summary_id,
        available_summaries=available_summaries,
        user_specific_data=UserPaperLinkBase(tags=link.tags, memo=link.memo),
        created_at=link.created_at,
        last_accessed_at=link.last_accessed_at,
    )


@router.delete(
    "/{user_paper_link_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT
)
def delete_user_paper_link(
    user_paper_link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete this paper link")

    # このユーザーのこの論文に関連するCustomGeneratedSummaryを取得
    custom_summaries_for_user_paper = session.exec(
        select(CustomGeneratedSummary)
        .where(CustomGeneratedSummary.user_id == current_user.id)
        .where(CustomGeneratedSummary.paper_metadata_id == link.paper_metadata_id)
    ).all()
    
    # ユーザーが編集した要約 (EditedSummary) を削除
    # このUserPaperLinkに関連する全てのGeneratedSummaryを取得
    generated_summaries_for_paper = session.exec(
        select(GeneratedSummary).where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
    ).all()
    
    for gen_summary in generated_summaries_for_paper:
        session.exec(
            delete(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.generated_summary_id == gen_summary.id)
        )
    
    # CustomGeneratedSummary関連のEditedSummaryを削除
    for custom_summary in custom_summaries_for_user_paper:
        session.exec(
            delete(EditedSummary)
            .where(EditedSummary.user_id == current_user.id)
            .where(EditedSummary.custom_generated_summary_id == custom_summary.id)
        )
    
    # ベクトルストアから関連ベクトルを削除 (既存ロジック)
    if link.paper_metadata: 
        cfg_vector = load_vector_cfg()
        store_type = cfg_vector.get("type")

        summaries_for_paper_ids = session.exec( # IDのみ取得で十分
            select(GeneratedSummary.id) 
            .where(GeneratedSummary.paper_metadata_id == link.paper_metadata_id)
        ).all()

        if summaries_for_paper_ids:
            for summary_id_val in summaries_for_paper_ids: 
                metadata_filter_for_delete = {
                    "user_id": str(current_user.id),
                    "paper_metadata_id": str(link.paper_metadata_id),
                    "generated_summary_id": str(summary_id_val) 
                }
                
                try:
                    delete_vectors_by_metadata(metadata_filter=metadata_filter_for_delete)
                    print(f"Vector deletion call executed for filter: {metadata_filter_for_delete} (Store: {store_type})")
                except Exception as e:
                    print(f"Error deleting vectors for filter {metadata_filter_for_delete} from {store_type}: {e}")
        else:
            print(f"No generated summaries found for paper_metadata_id {link.paper_metadata_id}. "
                  f"Skipping vector deletion specific to generated summaries for user {current_user.id}.")
        
        # CustomGeneratedSummary関連のベクトルを削除
        if custom_summaries_for_user_paper:
            for custom_summary in custom_summaries_for_user_paper:
                metadata_filter_for_delete = {
                    "user_id": str(current_user.id),
                    "paper_metadata_id": str(link.paper_metadata_id),
                    "custom_generated_summary_id": str(custom_summary.id)
                }
                
                try:
                    delete_vectors_by_metadata(metadata_filter=metadata_filter_for_delete)
                    print(f"Custom vector deletion call executed for filter: {metadata_filter_for_delete} (Store: {store_type})")
                except Exception as e:
                    print(f"Error deleting custom vectors for filter {metadata_filter_for_delete} from {store_type}: {e}")
        else:
            print(f"No custom generated summaries found for user {current_user.id} and paper_metadata_id {link.paper_metadata_id}. "
                  f"Skipping custom vector deletion.")
    else:
        print(f"UserPaperLink {link.id} (user_id: {current_user.id}) has no associated paper_metadata. "
              "Cannot determine specific vectors to delete.")

    # 他UserPaperLinkからのselected_custom_generated_summary_id参照をクリア
    if custom_summaries_for_user_paper:
        for custom_summary in custom_summaries_for_user_paper:
            # この CustomGeneratedSummary を参照している他の UserPaperLink の参照をクリア
            other_links_referencing = session.exec(
                select(UserPaperLink)
                .where(UserPaperLink.selected_custom_generated_summary_id == custom_summary.id)
            ).all()
            
            for other_link in other_links_referencing:
                other_link.selected_custom_generated_summary_id = None
                session.add(other_link)
                print(f"Cleared reference to custom summary {custom_summary.id} from UserPaperLink {other_link.id}")

    # CustomGeneratedSummaryを削除
    for custom_summary in custom_summaries_for_user_paper:
        session.delete(custom_summary)
        print(f"Deleted CustomGeneratedSummary {custom_summary.id} for user {current_user.id}")

    # PaperChatSessionを削除 (関連するChatMessageも含む)
    paper_chat_sessions_to_delete = session.exec(select(PaperChatSession).where(PaperChatSession.user_paper_link_id == link.id)).all()
    for chat_session in paper_chat_sessions_to_delete:
        # PaperChatSessionに関連するChatMessageを削除
        chat_messages_for_session = session.exec(select(ChatMessage).where(ChatMessage.paper_chat_session_id == chat_session.id)).all()
        for msg in chat_messages_for_session:
            session.delete(msg)
        session.delete(chat_session)
    
    # チャットメッセージを削除 (既存ロジック - paper_chat_session_idがNullの古いメッセージ用)
    chat_messages_to_delete = session.exec(select(ChatMessage).where(ChatMessage.user_paper_link_id == link.id)).all()
    for msg in chat_messages_to_delete:
        session.delete(msg)
    
    # UserPaperLink を削除 (既存ロジック)
    session.delete(link)
    session.commit()


ARXIV_ABS_RE = re.compile(r"https?://arxiv\.org/abs/(?P<id>\d{4}\.\d{5}(v\d)?)")

from utils.fulltext import get_arxiv_fulltext, _extract_arxiv_id, get_arxiv_metadata_with_fulltext, get_arxiv_metadata_with_fulltext_async

@router.post("/import_from_arxiv", response_model=PaperImportResponse, status_code=status.HTTP_201_CREATED)
async def import_from_arxiv(
    payload: PaperCreateAuto,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    print(f"[import_from_arxiv] Starting import for user_id: {current_user.id}, username: {current_user.username}, url: {payload.url}")
    print("Importing paper from arXiv...")
    llm_config_to_use = {**GLOBAL_LLM_CONFIG}
    if payload.config_overrides:
        llm_config_to_use.update(payload.config_overrides)
    
    try:
        arxiv_id_from_url, full_text_content = get_arxiv_fulltext(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid arXiv URL: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch full text: {e}")
    
    

    paper_meta = session.exec(select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id_from_url)).first()
    is_new_paper_metadata = False 
    is_new_user_paper_link = False 

    if not paper_meta:
        is_new_paper_metadata = True
        try:
            search = arxiv.Search(id_list=[arxiv_id_from_url])
            result = next(arxiv.Client().results(search))
        except StopIteration:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"arXiv ID {arxiv_id_from_url} not found on arXiv.")
        
        paper_meta = PaperMetadata(
            arxiv_id=remove_nul_chars(arxiv_id_from_url),
            arxiv_url=remove_nul_chars(f"https://arxiv.org/abs/{arxiv_id_from_url}"),
            title=remove_nul_chars(result.title),
            authors=remove_nul_chars(", ".join(a.name for a in result.authors)),
            published_date=result.published.date() if result.published else None,
            abstract=remove_nul_chars(result.summary.strip()),
            full_text=remove_nul_chars(full_text_content)
        )
        session.add(paper_meta)
        try:
            session.commit()
            session.refresh(paper_meta)
            print(f"新しい論文メタデータを作成しました: {paper_meta.arxiv_id}")
        except Exception as e:
            # 重複エラーの場合、他のユーザーが既に作成している可能性
            session.rollback()
            print(f"論文メタデータ作成時にエラー（おそらく重複）: {e}")
            # 再度DBから取得を試行
            paper_meta = session.exec(select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id_from_url)).first()
            if not paper_meta:
                # それでも見つからない場合は他のエラー
                raise HTTPException(status_code=500, detail=f"論文メタデータの作成に失敗しました: {e}")
            print(f"既存の論文メタデータを取得しました: {paper_meta.arxiv_id}")
            is_new_paper_metadata = False
    elif not paper_meta.full_text and full_text_content:
        is_new_paper_metadata = True
        paper_meta.full_text = remove_nul_chars(full_text_content)
        paper_meta.updated_at = datetime.utcnow()
        session.add(paper_meta)
        session.commit()
        session.refresh(paper_meta)

    print(f"Paper id: {paper_meta.arxiv_id}")
    print(f"Paper title: {paper_meta.title}")
    # 新しいスキーマに対応した要約生成処理
    generated_summary = None
    edit_generate_summary = None
    custom_summaries = []
    validated_summary = None
    
    if payload.prompt_mode == "default":
        # デフォルトモード：デュアル要約生成
        summary_result = await _create_and_store_dual_summaries(paper_meta, llm_config_to_use, session, current_user.id, None, 0, True)
        generated_summary, edit_generate_summary = summary_result
        validated_summary = generated_summary
        if edit_generate_summary:
            from types import SimpleNamespace
            tmp = SimpleNamespace(**vars(edit_generate_summary))
            tmp.llm_abst = edit_generate_summary.edited_llm_abst
            validated_summary = tmp
        print(f"Generated default summary: {validated_summary.llm_abst[:20]}...")
    
    elif payload.prompt_mode == "prompt_selection":
        # プロンプト選択モード：選択されたプロンプトを順次処理
        if not payload.selected_prompts:
            raise HTTPException(
                status_code=400, 
                detail="prompt_selection モードではselected_promptsが必要です。"
            )
        
        for prompt_selection in payload.selected_prompts:
            if prompt_selection.type == "default":
                # デフォルトプロンプト処理
                if not generated_summary:  # 重複処理を避ける
                    summary_result = await _create_and_store_dual_summaries(paper_meta, llm_config_to_use, session, current_user.id, None, 0, True)
                    generated_summary, edit_generate_summary = summary_result
                    if not validated_summary:  # 最初の要約を表示用に設定
                        validated_summary = generated_summary
                        if edit_generate_summary:
                            from types import SimpleNamespace
                            tmp = SimpleNamespace(**vars(edit_generate_summary))
                            tmp.llm_abst = edit_generate_summary.edited_llm_abst
                            validated_summary = tmp
                    print(f"Generated default summary: {generated_summary.llm_abst[:20]}...")
            
            elif prompt_selection.type == "custom":
                # カスタムプロンプト処理
                if not prompt_selection.system_prompt_id:
                    raise HTTPException(
                        status_code=400, 
                        detail="カスタムプロンプト選択時はsystem_prompt_idが必要です。"
                    )
                summary_result = await _create_and_store_dual_summaries(paper_meta, llm_config_to_use, session, current_user.id, prompt_selection.system_prompt_id, 0, False)
                _, custom_summary = summary_result
                custom_summaries.append(custom_summary)
                if not validated_summary:  # 最初の要約を表示用に設定
                    validated_summary = custom_summary
                print(f"Generated custom summary (prompt_id: {prompt_selection.system_prompt_id}): {custom_summary.llm_abst[:20]}...")
    
    else:
        raise HTTPException(status_code=400, detail=f"Invalid prompt_mode: {payload.prompt_mode}")
    
    if not validated_summary:
        raise HTTPException(status_code=500, detail="要約の生成に失敗しました。") 



    print(f"[import_from_arxiv] Searching UserPaperLink for user_id: {current_user.id}, paper_metadata_id: {paper_meta.id}")
    user_paper_link = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == current_user.id)
        .where(UserPaperLink.paper_metadata_id == paper_meta.id)
    ).first()
    
    if user_paper_link:
        print(f"[import_from_arxiv] Found existing UserPaperLink: {user_paper_link.id} for user_id: {user_paper_link.user_id}")
    else:
        print(f"[import_from_arxiv] UserPaperLink not found for user_id: {current_user.id}, paper_metadata_id: {paper_meta.id}")

    selected_tags_csv = ""
    error_cnt = 0
    fallback_error_cnt = 0
    fallback_Flag = False   

    # タグ生成処理（共通関数を使用）
    if (not user_paper_link) or (not user_paper_link.tags):
        print(f"[import_from_arxiv] Starting tag generation using common function for paper {paper_meta.id}, user {current_user.id}")
        tag_generated = _generate_tags_if_needed(
            paper_metadata_id=paper_meta.id,
            user_id=current_user.id,
            session=session,
            current_user=current_user,
            force_generation=False
        )
        if tag_generated:
            print(f"[import_from_arxiv] Tag generation completed successfully")
            # UserPaperLinkを再取得してタグ情報を更新
            session.refresh(user_paper_link)
            selected_tags_csv = user_paper_link.tags
        else:
            print(f"[import_from_arxiv] Tag generation failed or skipped")
            selected_tags_csv = ""
    else:
        selected_tags_csv = user_paper_link.tags
        print(f"[import_from_arxiv] Using existing tags: {selected_tags_csv}")
    
    # 古いタグ生成処理はここから削除済み（共通関数を使用）

    # 以下は古いタグ生成処理のため無効化
    if False:
        # タグ選択システムプロンプトを動的取得
        try:
            tag_system_prompt = get_paper_tag_selection_system_prompt(session, current_user.id)
        except Exception as e:
            print(f"タグ選択システムプロンプトの取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
            tag_system_prompt = """
あなたは与えられた論文情報に対し、以下の“カテゴリ別タグ候補”から **2個以上**選択してください。
選択ルール:
1. 「モダリティ／タスク」から **1-2 個必須**
2. 「モデルアーキテクチャ」から **1-2 個必須**
3. 「技術トピック」から **1〜2 個推奨**（主に該当するタグは全て）
4.  そのほかのトピックからは該当するものがあれば該当するものを全て選ぶこと
5. 合計 **2個以上**のタグを選ぶこと
6. 類似・冗長なタグを同時に選ばないこと

出力フォーマット:
選んだタグのみを **半角カンマ区切り 1 行**で出力してください。タグ以外の不要な文字列の出力は禁止します。
"""
        tag_prompt = ChatPromptTemplate.from_messages(
            [
                SystemMessage(content=tag_system_prompt),
                HumanMessagePromptTemplate.from_template("{question}")
            ]
        )
        # ★ メインLLMとフォールバックLLM設定（config.yamlから読み込み）
        tag_config = get_specialized_llm_config("tag_generation")
        tag_llm = initialize_llm(
            name=tag_config["provider"],
            model_name=tag_config["model_name"],
            temperature=tag_config["temperature"],
        )
        tag_chain = tag_prompt | tag_llm

        fallback_config = get_specialized_llm_config("tag_fallback")
        fallback_llm = initialize_llm(
            name=fallback_config["provider"],
            model_name=fallback_config["model_name"],
            temperature=fallback_config["temperature"],
        )
        fallback_chain = tag_prompt | fallback_llm
        
        # タグカテゴリー設定とクエリテンプレートを動的取得
        try:
            tag_categories_json = get_tag_categories_config(session, current_user.id)
            tag_categories = json.loads(tag_categories_json)
            cats_text = "\n".join(
                f"[{cat}] {', '.join(tags)}" for cat, tags in tag_categories.items()
            )
        except Exception as e:
            print(f"タグカテゴリー設定の取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
            # フォールバック：ハードコードされたTAG_CATEGORIESを使用
            from .module.util import TAG_CATEGORIES
            cats_text = "\n".join(
                f"[{cat}] {', '.join(tags)}" for cat, tags in TAG_CATEGORIES.items()
            )

        try:
            tag_question = get_paper_tag_selection_question_template(
                session, 
                current_user.id, 
                cats_text=cats_text,
                summary=validated_summary.llm_abst[:5000]
            )
        except Exception as e:
            print(f"タグ選択クエリテンプレートの取得に失敗しました（ユーザーID: {current_user.id}）: {e}")
            tag_question = f"""カテゴリ別タグ候補:
{cats_text}

要約:「{validated_summary.llm_abst[:5000]}」

では、上記をもとに必要なタグを検討してください。"""
    
        async def _get_tags_from_chain(chain, question):
            try:
                result = await chain.ainvoke({"question": question})
                selected_tags_csv = result.content.strip()
                print(f"結果: {result}")
                print(f"選択されたタグ: {selected_tags_csv}")
                return selected_tags_csv
            except Exception as e:
                print(f"Error during tag selection: {e}")
                return None
            

        while True:
            selected_tags_csv = await _get_tags_from_chain(tag_chain, tag_question)
            if selected_tags_csv: break
            else: 
                print(f"タグの選定に失敗しました。再試行します。")
                if error_cnt > 5: 
                    print(f"タグの選定に失敗しました。フォールバックします。")
                    fallback_Flag = True
                    break
                error_cnt += 1

        if fallback_Flag:
            while True:
                selected_tags_csv = await _get_tags_from_chain(fallback_chain, tag_question)
                if selected_tags_csv: break
                else: 
                    print(f"タグの選定に失敗しました。再試行します。")
                    if fallback_error_cnt > 5: 
                        print(f"タグの選定に失敗しました。")
                        selected_tags_csv = ""
                        break

                    fallback_error_cnt += 1




    # UserPaperLinkの設定：新しい優先順位ロジックを使用した選択
    selected_summary_for_link = None
    selected_custom_summary_for_link = None
    
    # 今回の処理で新しく生成されたすべてのデフォルト要約を取得
    # 今回の実行で生成された要約のみから優先度チェックを行う
    # 既存の要約ではなく、今回生成された要約が確実に選択されるようにする
    print(f"[DEBUG] 要約選択処理開始: generated_summary={generated_summary.id if generated_summary else None}, custom_summaries_count={len(custom_summaries)}")
    
    # 今回使用したプロンプト条件でDBから全要約を取得
    # 今回生成された全要約（キャラクターなし+キャラクターあり）を対象とする
    if payload.prompt_mode == "default" or any(p.type == "default" for p in payload.selected_prompts):
        # デフォルトプロンプトが使用された場合
        current_generated_summaries = session.exec(
            select(GeneratedSummary)
            .where(GeneratedSummary.paper_metadata_id == paper_meta.id)
            .order_by(GeneratedSummary.created_at.desc())
        ).all()
    else:
        current_generated_summaries = []
    
    print(f"[DEBUG] 今回生成されたGeneratedSummary数: {len(current_generated_summaries)}")
    for summary in current_generated_summaries:
        print(f"[DEBUG]   - ID: {summary.id}, Character: {summary.character_role}, Created: {summary.created_at}")
    
    print(f"[DEBUG] 今回生成されたCustomGeneratedSummary数: {len(custom_summaries)}")
    for summary in custom_summaries:
        print(f"[DEBUG]   - ID: {summary.id}, Character: {summary.character_role}, Created: {summary.created_at}")
    
    # 今回生成された要約の中から優先順位ロジックを使用：カスタム+キャラ > カスタム > デフォルト+キャラ > デフォルト
    selected_summary_for_link, selected_custom_summary_for_link = select_best_summary_by_priority(
        generated_summaries=current_generated_summaries,
        custom_summaries=custom_summaries,
        selection_mode="initial",
        user_selected_character=current_user.selected_character
    )
    
    print(f"[DEBUG] 優先順位選択結果:")
    print(f"[DEBUG]   - selected_summary_for_link: {selected_summary_for_link.id if selected_summary_for_link else None}")
    print(f"[DEBUG]   - selected_custom_summary_for_link: {selected_custom_summary_for_link.id if selected_custom_summary_for_link else None}")
    
    if user_paper_link:
        is_new_user_paper_link = False
        user_paper_link.updated_at = datetime.utcnow()
        user_paper_link.last_accessed_at = datetime.utcnow()
        
        # 要約選択を強制的に更新（他のエンドポイントによる事前作成に対応）
        print(f"[DEBUG] 既存UserPaperLink更新: 現在の選択 default={user_paper_link.selected_generated_summary_id}, custom={user_paper_link.selected_custom_generated_summary_id}")
        
        if selected_custom_summary_for_link:
            user_paper_link.selected_custom_generated_summary_id = selected_custom_summary_for_link.id
            user_paper_link.selected_generated_summary_id = None  # カスタム選択時はデフォルトをクリア
            print(f"[DEBUG] カスタム要約に更新: {selected_custom_summary_for_link.id}")
        elif selected_summary_for_link:
            user_paper_link.selected_generated_summary_id = selected_summary_for_link.id
            user_paper_link.selected_custom_generated_summary_id = None  # デフォルト選択時はカスタムをクリア
            print(f"[DEBUG] デフォルト要約に更新: {selected_summary_for_link.id}")
        
        session.add(user_paper_link)  # 明示的にセッションに追加して更新を確実にする
    else:
        is_new_user_paper_link = True
        print(f"[import_from_arxiv] Creating new UserPaperLink for user_id: {current_user.id}, paper_metadata_id: {paper_meta.id}")
        if selected_custom_summary_for_link:
            # カスタム要約を選択した場合
            user_paper_link = UserPaperLink(
                user_id=current_user.id,
                paper_metadata_id=paper_meta.id,
                tags=selected_tags_csv,
                selected_custom_generated_summary_id=selected_custom_summary_for_link.id
            )
            print(f"[import_from_arxiv] Created UserPaperLink with custom summary for user_id: {current_user.id}")
        elif selected_summary_for_link:
            # デフォルト要約を選択した場合
            user_paper_link = UserPaperLink(
                user_id=current_user.id,
                paper_metadata_id=paper_meta.id,
                tags=selected_tags_csv,
                selected_generated_summary_id=selected_summary_for_link.id 
            )
            print(f"[import_from_arxiv] Created UserPaperLink with default summary for user_id: {current_user.id}")
        else:
            # 要約がない場合（エラー状態）
            user_paper_link = UserPaperLink(
                user_id=current_user.id,
                paper_metadata_id=paper_meta.id,
                tags=selected_tags_csv
            )
            print(f"[import_from_arxiv] Created UserPaperLink without summary for user_id: {current_user.id}")
        session.add(user_paper_link)
    
    if not user_paper_link.tags and selected_tags_csv:
        user_paper_link.tags = selected_tags_csv

    # コミット前の最終確認
    print(f"[import_from_arxiv] コミット前最終確認:")
    print(f"[import_from_arxiv]   UserPaperLink ID: {user_paper_link.id}")
    print(f"[import_from_arxiv]   user_id: {user_paper_link.user_id}")
    print(f"[import_from_arxiv]   paper_metadata_id: {user_paper_link.paper_metadata_id}")
    print(f"[import_from_arxiv]   selected_generated_summary_id: {user_paper_link.selected_generated_summary_id}")
    print(f"[import_from_arxiv]   selected_custom_generated_summary_id: {user_paper_link.selected_custom_generated_summary_id}")
    print(f"[import_from_arxiv]   current_user.id: {current_user.id}")

    session.commit()
    session.refresh(user_paper_link)
    
    # コミット後の最終確認
    print(f"[import_from_arxiv] コミット後最終確認:")
    print(f"[import_from_arxiv]   UserPaperLink ID: {user_paper_link.id}")
    print(f"[import_from_arxiv]   user_id: {user_paper_link.user_id}")
    print(f"[import_from_arxiv]   paper_metadata_id: {user_paper_link.paper_metadata_id}")
    print(f"[import_from_arxiv]   current_user.id: {current_user.id}")
    session.refresh(paper_meta)
    if generated_summary:
        session.refresh(generated_summary)
    if edit_generate_summary:
        session.refresh(edit_generate_summary)
    for custom_summary in custom_summaries:
        session.refresh(custom_summary)

    # 埋め込みベクトル作成処理（create_embeddingsフラグで制御）- 統一設計
    if payload.create_embeddings:
        vector_exists = vector_exists_for_user_paper(str(current_user.id), str(paper_meta.id))
        print(f"Vector exists for user {current_user.id} and paper {paper_meta.arxiv_id}: {vector_exists}")
        
        # 1論文1ベクトル設計のため、既存ベクトルがあっても新しく作成（優先度が変更された可能性があるため）
        print(f"ユーザー {current_user.id} の論文 {paper_meta.arxiv_id} のベクトルを統一設計で作成します")
        
        # 統一ベクトル作成（1論文1ベクトル、優先度ベース）
        # embedding_targetに基づいて優先設定を適用
        preferred_summary_type = None
        preferred_system_prompt_id = None
        
        if payload.embedding_target == "default_only":
            preferred_summary_type = "default"
            print(f"embedding_target=default_only: デフォルト要約を優先してベクトル作成")
        elif payload.embedding_target == "custom_only":
            preferred_summary_type = "custom"
            # 明示的に指定されたsystem_prompt_idを使用
            if payload.embedding_target_system_prompt_id:
                preferred_system_prompt_id = payload.embedding_target_system_prompt_id
                print(f"embedding_target=custom_only: カスタム要約(prompt_id: {preferred_system_prompt_id})を優先してベクトル作成")
            else:
                print(f"embedding_target=custom_only: system_prompt_idが指定されていません")
        else:
            print(f"embedding_target={payload.embedding_target}: 標準の優先度ロジックでベクトル作成")
        
        await _add_paper_to_vectorstore_unified_async(
            paper_meta, current_user.id, user_paper_link.id, session,
            preferred_summary_type, preferred_system_prompt_id
        )
        print(f"統一ベクトルを作成しました (論文ID: {paper_meta.id})")
    else:
        print(f"create_embeddings=Falseのため、ベクトルストアへの追加をスキップします")
    
    # レスポンス作成（複数要約対応）
    response_generated_summary_id = None
    if selected_summary_for_link:
        # デフォルト要約が選択されている場合
        response_generated_summary_id = selected_summary_for_link.id
    elif selected_custom_summary_for_link:
        # カスタム要約が選択されている場合はNone（従来の仕様に合わせる）
        response_generated_summary_id = None
    
    return PaperImportResponse(
        user_paper_link_id=user_paper_link.id,
        paper_metadata_id=paper_meta.id,
        generated_summary_id=response_generated_summary_id,
        message=f"論文が正常にインポートされました。生成された要約数: デフォルト{1 if generated_summary else 0}個、カスタム{len(custom_summaries)}個"
    )


@router.post("/fetch_huggingface_arxiv_ids", response_model=List[str])
def fetch_huggingface_arxiv_ids(
    payload: HFImportRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    llm_config_to_use = {**GLOBAL_LLM_CONFIG}
    if payload.config_overrides:
        llm_config_to_use.update(payload.config_overrides)
    
    collector = ArxivIDCollector(config_override=llm_config_to_use)
    arxiv_ids_from_hf = collector.gather_hf_arxiv_ids()
    
    if not arxiv_ids_from_hf:
        print(f"[INFO] No arXiv IDs gathered from Hugging Face for user {current_user.id} with current settings.")
        return []
    
    print(f"[INFO] fetch_huggingface_arxiv_ids: 最終的に返される論文ID数 => {len(arxiv_ids_from_hf)}")
    return arxiv_ids_from_hf


@router.post("/{user_paper_link_id}/regenerate_summary", response_model=RegenerateSummaryResponse)
async def regenerate_summary_for_paper(
    user_paper_link_id: int,
    payload: RegenerateSummaryRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this paper link")
    if not link.paper_metadata:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Paper metadata not found for this link")

    llm_config_to_use = {**GLOBAL_LLM_CONFIG}
    if payload.config_overrides:
        llm_config_to_use.update(payload.config_overrides)
    
    # デフォルト設定をconfig.yamlから取得
    default_config = get_specialized_llm_config("summary_default")

    print(f"Regenerating summary for user_paper_link_id {user_paper_link_id} with payload {payload}")

    # 現在の選択状態を判定
    current_selection_type = None
    current_summary_id = None
    current_custom_summary_id = None
    
    if link.selected_custom_generated_summary_id:
        current_selection_type = "custom"
        current_custom_summary_id = link.selected_custom_generated_summary_id
    elif link.selected_generated_summary_id:
        current_selection_type = "default"
        current_summary_id = link.selected_generated_summary_id

    try:
        # 新しいAPIスキーマに対応
        if payload.prompt_mode == "prompt_selection":
            # プロンプト選択モード：selected_promptsから一つを選択して実行
            if not payload.selected_prompts or len(payload.selected_prompts) == 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="selected_prompts is required for prompt_selection mode")
            
            print(f"Selected prompts: {payload.selected_prompts}")
            
            # 最初のプロンプトを使用（詳細ページでは通常1個のみ）
            first_prompt = payload.selected_prompts[0]

            print(f"Using prompt: {first_prompt}")
            
            if first_prompt.type == "custom":
                # カスタムプロンプト使用時
                if not first_prompt.system_prompt_id:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="system_prompt_id is required for custom prompt")
                
                # カスタムデュアル要約を生成
                custom_neutral, custom_with_char = await _execute_custom_summary_generation_new(
                    link.paper_metadata,
                    llm_config_to_use,
                    session,
                    current_user.id,
                    first_prompt.system_prompt_id,
                    llm_config_to_use.get("llm_name", default_config["provider"]),
                    llm_config_to_use.get("llm_model_name", default_config["model_name"])
                )
                
                # 新しい優先順位ロジックを使用してカスタム要約を選択
                custom_summaries_list = [summary for summary in [custom_neutral, custom_with_char] if summary]
                _, new_custom_summary = select_best_summary_by_priority(
                    generated_summaries=[],
                    custom_summaries=custom_summaries_list,
                    current_selection_type=current_selection_type,
                    current_summary_id=current_summary_id,
                    current_custom_summary_id=current_custom_summary_id,
                    selection_mode="regenerate_detail",
                    user_selected_character=current_user.selected_character
                )
                
                # 選択状態を更新（カスタム要約を選択）
                if new_custom_summary:
                    link.selected_custom_generated_summary_id = new_custom_summary.id
                    link.selected_generated_summary_id = None  # デフォルト選択をクリア
                else:
                    raise HTTPException(status_code=500, detail="カスタム要約の選択に失敗しました")
                link.updated_at = datetime.utcnow()
                session.add(link)
                session.commit()
                session.refresh(link)
                session.refresh(new_custom_summary)

                return RegenerateSummaryResponse(
                    custom_generated_summary=CustomGeneratedSummaryRead.model_validate(new_custom_summary)
                )
            else:
                # デフォルトプロンプト使用時：デュアル要約生成
                dual_result = await _create_and_store_dual_summaries(link.paper_metadata, llm_config_to_use, session, current_user.id, None, 0, True)
                new_summary, new_summary_with_char = dual_result
                
                # 新しい優先順位ロジックを使用してデフォルト要約を選択
                generated_summaries_list = [summary for summary in [new_summary, new_summary_with_char] if summary]
                new_default_summary, _ = select_best_summary_by_priority(
                    generated_summaries=generated_summaries_list,
                    custom_summaries=[],
                    current_selection_type=current_selection_type,
                    current_summary_id=current_summary_id,
                    current_custom_summary_id=current_custom_summary_id,
                    selection_mode="regenerate_detail",
                    user_selected_character=current_user.selected_character
                )
                
                # 選択状態を更新（デフォルト要約を選択）
                if new_default_summary:
                    link.selected_generated_summary_id = new_default_summary.id
                    link.selected_custom_generated_summary_id = None  # カスタム選択をクリア
                else:
                    raise HTTPException(status_code=500, detail="デフォルト要約の選択に失敗しました")
                link.updated_at = datetime.utcnow()
                session.add(link)
                session.commit()
                session.refresh(link)
                session.refresh(new_default_summary)

                return RegenerateSummaryResponse(
                    generated_summary=GeneratedSummaryRead.model_validate(new_default_summary)
                )
        else:
            # デフォルトモード：デュアル要約生成
            dual_result = await _create_and_store_dual_summaries(link.paper_metadata, llm_config_to_use, session, current_user.id, None, 0, True)
            new_summary, new_summary_with_char = dual_result
            
            # 新しい優先順位ロジックを使用してデフォルト要約を選択
            generated_summaries_list = [summary for summary in [new_summary, new_summary_with_char] if summary]
            new_default_summary, _ = select_best_summary_by_priority(
                generated_summaries=generated_summaries_list,
                custom_summaries=[],
                current_selection_type=current_selection_type,
                current_summary_id=current_summary_id,
                current_custom_summary_id=current_custom_summary_id,
                selection_mode="regenerate_detail",
                user_selected_character=current_user.selected_character
            )
            
            # 選択状態を更新（デフォルト要約を選択）
            if new_default_summary:
                link.selected_generated_summary_id = new_default_summary.id
                link.selected_custom_generated_summary_id = None  # カスタム選択をクリア
            else:
                raise HTTPException(status_code=500, detail="デフォルト要約の選択に失敗しました")
            link.updated_at = datetime.utcnow()
            session.add(link)
            session.commit()
            session.refresh(link)
            session.refresh(new_default_summary)

            return RegenerateSummaryResponse(
                generated_summary=GeneratedSummaryRead.model_validate(new_default_summary)
            )
    except HTTPException as e: 
        raise e
    except Exception as e:
        print(f"Error regenerating summary for user_paper_link_id {user_paper_link_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to regenerate summary: {e}")




@router.post("/recommend", response_model=List[int])
def recommend_papers(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    deploy_env = os.getenv("DEPLOY", "cloud") 
    print(f"Recommendation process started for user {current_user.id} (using {deploy_env} mode)...")

    fav_links = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == current_user.id)
        .where(UserPaperLink.tags.contains("お気に入り"))
        .order_by(UserPaperLink.created_at.desc())
        .limit(10)
    ).all()
    dislike_links = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == current_user.id)
        .where(UserPaperLink.tags.contains("興味なし"))
        .order_by(UserPaperLink.created_at.desc())
        .limit(10)
    ).all()

    print(f"User {current_user.id}: Found {len(fav_links)} favorite links and {len(dislike_links)} disliked links.")

    fav_metadata_conditions = []
    for link in fav_links:
        if link.paper_metadata_id:
            # 1論文1ベクトル設計に合わせて、user_id + paper_metadata_idで検索
            fav_metadata_conditions.append({
                "user_id": str(current_user.id),
                "paper_metadata_id": str(link.paper_metadata_id),
            })

    dislike_metadata_conditions = []
    for link in dislike_links:
        if link.paper_metadata_id:
            # 1論文1ベクトル設計に合わせて、user_id + paper_metadata_idで検索
            dislike_metadata_conditions.append({
                "user_id": str(current_user.id),
                "paper_metadata_id": str(link.paper_metadata_id),
            })

    if not fav_metadata_conditions:
        if fav_links:
             raise HTTPException(status_code=400, detail="「お気に入り」論文に紐づく有効な要約ベクトルが見つかりません。")
        else:
             raise HTTPException(status_code=400, detail="推薦に必要な「お気に入り」論文がありません。")

    print(f"User {current_user.id}: Found {len(fav_metadata_conditions)} favorite metadata conditions and {len(dislike_metadata_conditions)} disliked metadata conditions.")
    print(f"[DEBUG] Sample favorite metadata condition: {fav_metadata_conditions[0] if fav_metadata_conditions else 'None'}")
    print(f"[DEBUG] Sample dislike metadata condition: {dislike_metadata_conditions[0] if dislike_metadata_conditions else 'None'}")
    
    fav_embedding_results = get_embeddings_by_metadata_filter(fav_metadata_conditions)
    dislike_embedding_results = get_embeddings_by_metadata_filter(dislike_metadata_conditions)
    
    print(f"[DEBUG] Retrieved {len(fav_embedding_results)} favorite embeddings and {len(dislike_embedding_results)} dislike embeddings")

    fav_embeddings = [emb for _, emb in fav_embedding_results]
    dislike_embeddings = [emb for _, emb in dislike_embedding_results]
    
    if not fav_embeddings:
        raise HTTPException(status_code=400, detail="「お気に入り」論文のベクトルを取得できませんでした。")

    fav_vector = np.mean(np.array(fav_embeddings), axis=0)
    dislike_vector = None
    if dislike_embeddings:
        dislike_vector = np.mean(np.array(dislike_embeddings), axis=0)
    
    # ベクトル情報を保存（後で表示用）
    vector_info = {
        "fav_vector_first_10": fav_vector[:10].tolist(),
        "dislike_vector_first_10": dislike_vector[:10].tolist() if dislike_vector is not None else None,
        "fav_count": len(fav_embeddings),
        "dislike_count": len(dislike_embeddings)
    }
    
    target_links_query = select(UserPaperLink).where(
        UserPaperLink.user_id == current_user.id,
        ~UserPaperLink.tags.contains("お気に入り"),
        ~UserPaperLink.tags.contains("理解した"),
        ~UserPaperLink.tags.contains("サラッと読んだ"),
        ~UserPaperLink.tags.contains("後で読む"),
        ~UserPaperLink.tags.contains("興味なし"),
        ~UserPaperLink.tags.contains("Recommended")
    )
    target_links = session.exec(target_links_query).all()

    if not target_links:
        print(f"User {current_user.id}: No target papers found for recommendation.")
        return []

    target_metadata_conditions_for_fetch = []
    target_uplid_map_by_condition_key = {} 

    for link in target_links:
        if link.paper_metadata_id:
            # 1論文1ベクトル設計に合わせて、user_id + paper_metadata_idで検索
            condition_key = (str(current_user.id), str(link.paper_metadata_id))
            target_uplid_map_by_condition_key[condition_key] = link.id
            target_metadata_conditions_for_fetch.append({
                "user_id": str(current_user.id),
                "paper_metadata_id": str(link.paper_metadata_id),
            })
    
    if not target_metadata_conditions_for_fetch:
        print(f"User {current_user.id}: No valid metadata conditions for target papers.")
        return []

    target_embedding_results = get_embeddings_by_metadata_filter(target_metadata_conditions_for_fetch)

    target_embeddings_list = []
    fetched_user_paper_link_ids_for_scoring = []

    for original_cond, embedding in target_embedding_results:
        condition_key_lookup = (original_cond.get("user_id"), original_cond.get("paper_metadata_id"))
        user_paper_link_id = target_uplid_map_by_condition_key.get(condition_key_lookup)
        if user_paper_link_id:
            target_embeddings_list.append(embedding)
            fetched_user_paper_link_ids_for_scoring.append(user_paper_link_id)
        else:
            print(f"Warning: Could not map fetched embedding with condition {original_cond} back to a user_paper_link_id.")

    if not target_embeddings_list:
        print(f"User {current_user.id}: Could not fetch embeddings for target papers.")
        return []

    scores = []
    target_vectors_np_array = np.array(target_embeddings_list)
    fav_similarities = cosine_similarity(fav_vector.reshape(1, -1), target_vectors_np_array)[0]
    
    dislike_similarities = np.zeros(len(target_vectors_np_array))
    if dislike_vector is not None and dislike_embeddings:
        dislike_similarities = cosine_similarity(dislike_vector.reshape(1, -1), target_vectors_np_array)[0]

    
    print(f"target_vectors_np_array.shape: {target_vectors_np_array.shape}")
    print(f"fav_similarities.shape: {fav_similarities.shape}")
    print(f"fav_similarities: {len(fav_similarities)}")
    print(f"dislike_similarities: {len(dislike_similarities)}")

    for i, user_paper_link_id_for_score in enumerate(fetched_user_paper_link_ids_for_scoring):
        print(f"User {current_user.id}: Scoring paper link ID {user_paper_link_id_for_score} with index {i}.")
        score = fav_similarities[i] - dislike_similarities[i]
        scores.append({"user_paper_link_id": user_paper_link_id_for_score, "score": score})

    existing_recs_count = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == current_user.id)
        .where(UserPaperLink.tags.contains("Recommended"))
    ).all()
    to_add = 5 - len(existing_recs_count)
    if to_add <= 0:
        return []

    scores.sort(key=lambda x: x["score"], reverse=True)
    recommended_link_ids: List[int] = []
    papers_updated_count = 0

    for item in scores[:to_add]:
        link_to_update = session.get(UserPaperLink, item["user_paper_link_id"])
        if link_to_update:
            current_tags_set = set(t.strip() for t in (link_to_update.tags or "").split(",") if t.strip())
            if "Recommended" not in current_tags_set:
                current_tags_set.add("Recommended")
                link_to_update.tags = ",".join(sorted(list(current_tags_set)))
                link_to_update.updated_at = datetime.utcnow()
                session.add(link_to_update)
                recommended_link_ids.append(link_to_update.id)
                papers_updated_count += 1
            else:
                recommended_link_ids.append(link_to_update.id)
    
    if papers_updated_count > 0:
        session.commit()
    
    # 推薦計算の詳細情報を表示
    _display_recommendation_details(
        vector_info=vector_info,
        scores=scores,
        target_embeddings_list=target_embeddings_list,
        fetched_user_paper_link_ids_for_scoring=fetched_user_paper_link_ids_for_scoring
    )
    
    return recommended_link_ids

class FindByArxivResponse(BaseModel):
    user_paper_link_id: Optional[int] = None
    paper_metadata_id: Optional[int] = None
    message: str

@router.get("/find_by_arxiv_id/{arxiv_id_str}", response_model=FindByArxivResponse)
async def find_paper_by_arxiv_id(
    arxiv_id_str: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    # arxiv_id_str can be "2505.21070" or "2505.21070v1".
    # We should search for the base ID.
    base_arxiv_id = arxiv_id_str.split('v')[0]

    paper_meta = session.exec(
        select(PaperMetadata).where(PaperMetadata.arxiv_id == base_arxiv_id)
    ).first()

    if not paper_meta:
        # Try again with the original string in case it was stored with version
        paper_meta = session.exec(
            select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id_str)
        ).first()
        if not paper_meta:
            return FindByArxivResponse(message="Paper metadata not found in the system.")

    user_paper_link = session.exec(
        select(UserPaperLink)
        .where(UserPaperLink.user_id == current_user.id)
        .where(UserPaperLink.paper_metadata_id == paper_meta.id)
    ).first()

    if user_paper_link:
        return FindByArxivResponse(
            user_paper_link_id=user_paper_link.id,
            paper_metadata_id=paper_meta.id,
            message="Paper found in user library."
        )
    else:
        return FindByArxivResponse(
            paper_metadata_id=paper_meta.id,
            message="Paper metadata found, but not linked to the current user."
        )

@router.put(
    "/{user_paper_link_id}/summaries/{generated_summary_id}/edit",
    response_model=EditedSummaryRead,
    status_code=status.HTTP_200_OK
)
def edit_summary(
    user_paper_link_id: int, 
    generated_summary_id: int,
    payload: EditSummaryRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this paper link")

    generated_summary = session.get(GeneratedSummary, generated_summary_id)
    if not generated_summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generated summary not found")
    if generated_summary.paper_metadata_id != link.paper_metadata_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Generated summary does not belong to the specified paper")
    
    edited_summary = session.exec(
        select(EditedSummary)
        .where(EditedSummary.user_id == current_user.id)
        .where(EditedSummary.generated_summary_id == generated_summary_id)
    ).first()

    if edited_summary:
        edited_summary.edited_llm_abst = payload.edited_llm_abst
        # updated_at はトリガーで自動更新されるはず
        session.add(edited_summary)
    else:
        edited_summary = EditedSummary(
            user_id=current_user.id,
            generated_summary_id=generated_summary_id,
            edited_llm_abst=payload.edited_llm_abst
        )
        session.add(edited_summary)
    
    session.commit()
    session.refresh(edited_summary)
    
    return edited_summary


@router.put(
    "/{user_paper_link_id}/custom-summaries/{custom_generated_summary_id}/edit",
    response_model=EditedSummaryRead,
    status_code=status.HTTP_200_OK
)
def edit_custom_summary(
    user_paper_link_id: int, 
    custom_generated_summary_id: int,
    payload: EditSummaryRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """カスタム要約の編集"""
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this paper link")

    custom_generated_summary = session.get(CustomGeneratedSummary, custom_generated_summary_id)
    if not custom_generated_summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom generated summary not found")
    if custom_generated_summary.paper_metadata_id != link.paper_metadata_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Custom generated summary does not belong to the specified paper")
    if custom_generated_summary.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this custom summary")
    
    # 既存のEditedSummaryをチェック
    edited_summary = session.exec(
        select(EditedSummary)
        .where(EditedSummary.user_id == current_user.id)
        .where(EditedSummary.custom_generated_summary_id == custom_generated_summary_id)
    ).first()

    if edited_summary:
        # 既存の編集要約を更新
        edited_summary.edited_llm_abst = payload.edited_llm_abst
        session.add(edited_summary)
    else:
        # 新しい編集要約を作成
        edited_summary = EditedSummary(
            user_id=current_user.id,
            custom_generated_summary_id=custom_generated_summary_id,
            edited_llm_abst=payload.edited_llm_abst
        )
        session.add(edited_summary)
    
    session.commit()
    session.refresh(edited_summary)
    
    return edited_summary

@router.post("/check_duplications", response_model=DuplicationCheckResponse)
def check_duplications(
    payload: DuplicationCheckRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    指定されたURL一覧について、ベクトルと要約の重複を統合チェックする
    """
    from utils.fulltext import ARXIV_ID_RE
    from vectorstore.manager import batch_check_vector_existence
    
    # URLからarXiv ID、そしてpaper_metadata_idを一括取得
    url_to_arxiv_id = {}
    arxiv_ids = []
    
    for url in payload.urls:
        url = url.strip()
        if not url:
            continue
            
        # arXiv URLからarXiv IDを抽出
        m = ARXIV_ID_RE.match(url)
        if not m:
            continue  # 無効なURLはスキップ
            
        arxiv_id = m.group("id")
        url_to_arxiv_id[url] = arxiv_id
        arxiv_ids.append(arxiv_id)
    
    if not arxiv_ids:
        return DuplicationCheckResponse(
            existing_vector_urls=[],
            existing_summary_info=[]
        )
    
    # 一括でPaperMetadataを取得
    paper_metas = session.exec(
        select(PaperMetadata).where(PaperMetadata.arxiv_id.in_(arxiv_ids))
    ).all()
    
    # arXiv ID -> paper_metadata_id のマップを作成
    arxiv_to_paper_id = {paper.arxiv_id: paper.id for paper in paper_metas}
    url_to_paper_id = {}
    
    for url, arxiv_id in url_to_arxiv_id.items():
        if arxiv_id in arxiv_to_paper_id:
            url_to_paper_id[url] = arxiv_to_paper_id[arxiv_id]
    
    # 1. ベクトル存在チェック
    existing_vector_urls = []
    if url_to_paper_id:
        paper_metadata_ids = [str(pid) for pid in url_to_paper_id.values()]
        vector_existence_map = batch_check_vector_existence(str(current_user.id), paper_metadata_ids)
        
        for url, paper_id in url_to_paper_id.items():
            if vector_existence_map.get(str(paper_id), False):
                existing_vector_urls.append(url)
    
    # 2. 要約重複チェック
    existing_summary_info = _check_summary_duplications(
        session,
        current_user.id,
        url_to_paper_id,
        payload.prompt_mode,
        payload.selected_prompts
    )
    
    return DuplicationCheckResponse(
        existing_vector_urls=existing_vector_urls,
        existing_summary_info=existing_summary_info
    )


@router.post("/check_missing_vectors", response_model=MissingVectorCheckResponse)
def check_missing_vectors(
    payload: MissingVectorCheckRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    指定されたURL一覧について、埋め込みベクトルが存在しない論文をチェックする
    """
    from utils.fulltext import ARXIV_ID_RE
    from vectorstore.manager import batch_check_vector_existence
    
    # URLからarXiv ID、そしてpaper_metadata_idを一括取得
    url_to_arxiv_id = {}
    arxiv_ids = []
    
    for url in payload.urls:
        url = url.strip()
        if not url:
            continue
            
        # arXiv URLからarXiv IDを抽出
        m = ARXIV_ID_RE.match(url)
        if not m:
            continue  # 無効なURLはスキップ
            
        arxiv_id = m.group("id")
        url_to_arxiv_id[url] = arxiv_id
        arxiv_ids.append(arxiv_id)
    
    if not arxiv_ids:
        return MissingVectorCheckResponse(
            missing_vector_urls=[],
            total_urls=len(payload.urls),
            missing_count=0
        )
    
    # 一括でPaperMetadataを取得
    paper_metas = session.exec(
        select(PaperMetadata).where(PaperMetadata.arxiv_id.in_(arxiv_ids))
    ).all()
    
    # arXiv ID -> paper_metadata_id のマップを作成
    arxiv_to_paper_id = {paper.arxiv_id: paper.id for paper in paper_metas}
    url_to_paper_id = {}
    missing_vector_urls = []
    
    for url, arxiv_id in url_to_arxiv_id.items():
        if arxiv_id in arxiv_to_paper_id:
            url_to_paper_id[url] = arxiv_to_paper_id[arxiv_id]
        else:
            # 論文メタデータが存在しない場合は、ベクトルも存在しないとみなす
            missing_vector_urls.append(url)
    
    # ベクトル存在チェック
    if url_to_paper_id:
        paper_metadata_ids = [str(pid) for pid in url_to_paper_id.values()]
        vector_existence_map = batch_check_vector_existence(str(current_user.id), paper_metadata_ids)
        
        for url, paper_id in url_to_paper_id.items():
            if not vector_existence_map.get(str(paper_id), False):
                missing_vector_urls.append(url)
    
    return MissingVectorCheckResponse(
        missing_vector_urls=missing_vector_urls,
        total_urls=len(payload.urls),
        missing_count=len(missing_vector_urls)
    )


@router.post("/check_existing_summary", response_model=ExistingSummaryCheckResponse)
def check_existing_summary(
    payload: ExistingSummaryCheckRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """
    指定されたURL・プロンプト・モデルの組み合わせで要約が既に存在するかチェックする（重複処理防止用）
    プロンプト更新やモデル変更も考慮した精密な判定を行う
    """
    from utils.fulltext import ARXIV_ID_RE
    
    url = payload.url.strip()
    system_prompt_id = payload.system_prompt_id
    llm_provider = payload.llm_provider
    llm_model_name = payload.llm_model_name
    
    # URLからarXiv IDを抽出
    m = ARXIV_ID_RE.match(url)
    if not m:
        # 無効なURLの場合は存在しないとみなす
        return ExistingSummaryCheckResponse(exists=False)
    
    arxiv_id = m.group("id")
    
    # PaperMetadataを取得
    paper_meta = session.exec(
        select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id)
    ).first()
    
    if not paper_meta:
        # 論文メタデータが存在しない場合は要約も存在しない
        return ExistingSummaryCheckResponse(exists=False)
    
    # デフォルトプロンプトかカスタムプロンプトかで分岐
    if system_prompt_id is None:
        # デフォルトプロンプトの場合：デュアル要約システム対応
        # キャラクター無し要約をチェック
        character_neutral_summary = session.exec(
            select(GeneratedSummary)
            .where(GeneratedSummary.paper_metadata_id == paper_meta.id)
            .where(GeneratedSummary.llm_provider == llm_provider)
            .where(GeneratedSummary.llm_model_name == llm_model_name)
            .where(GeneratedSummary.character_role.is_(None))  # キャラクター中立のみ
            .where(not_(GeneratedSummary.llm_abst.like("[PROCESSING%")))  # PROCESSING状態は除外
        ).first()
        
        # キャラクター付き要約をチェック（ユーザーの選択キャラクターで）
        user_character = current_user.selected_character
        character_summary = None
        if user_character:
            character_summary = session.exec(
                select(GeneratedSummary)
                .where(GeneratedSummary.paper_metadata_id == paper_meta.id)
                .where(GeneratedSummary.llm_provider == llm_provider)
                .where(GeneratedSummary.llm_model_name == llm_model_name)
                .where(GeneratedSummary.character_role == user_character)  # ユーザーのキャラクター
                .where(not_(GeneratedSummary.llm_abst.like("[PROCESSING%")))  # PROCESSING状態は除外
            ).first()
        
        # デュアル要約システム：両方存在する場合のみ「既存」と判定
        if character_neutral_summary and (not user_character or character_summary):
            return ExistingSummaryCheckResponse(
                exists=True,
                requires_regeneration=False,  # デフォルトプロンプトは更新されないため常にfalse
                summary_type="default",
                summary_id=character_neutral_summary.id
            )
    else:
        # カスタムプロンプトの場合：デュアル要約システム対応
        # キャラクター無しカスタム要約をチェック
        character_neutral_custom = session.exec(
            select(CustomGeneratedSummary)
            .where(CustomGeneratedSummary.user_id == current_user.id)
            .where(CustomGeneratedSummary.paper_metadata_id == paper_meta.id)
            .where(CustomGeneratedSummary.system_prompt_id == system_prompt_id)
            .where(CustomGeneratedSummary.llm_provider == llm_provider)
            .where(CustomGeneratedSummary.llm_model_name == llm_model_name)
            .where(CustomGeneratedSummary.character_role.is_(None))  # キャラクター中立のみ
        ).first()
        
        # キャラクター付きカスタム要約をチェック（ユーザーの選択キャラクターで）
        user_character = current_user.selected_character
        character_custom = None
        if user_character:
            character_custom = session.exec(
                select(CustomGeneratedSummary)
                .where(CustomGeneratedSummary.user_id == current_user.id)
                .where(CustomGeneratedSummary.paper_metadata_id == paper_meta.id)
                .where(CustomGeneratedSummary.system_prompt_id == system_prompt_id)
                .where(CustomGeneratedSummary.llm_provider == llm_provider)
                .where(CustomGeneratedSummary.llm_model_name == llm_model_name)
                .where(CustomGeneratedSummary.character_role == user_character)  # ユーザーのキャラクター
            ).first()
        
        # デュアル要約システム：両方存在する場合のみ「既存」と判定
        if character_neutral_custom and (not user_character or character_custom):
            # プロンプト更新時間をチェック
            system_prompt = session.exec(
                select(SystemPrompt).where(SystemPrompt.id == system_prompt_id)
            ).first()
            
            requires_regeneration = False
            if system_prompt:
                # プロンプトが要約作成後に更新されているかチェック
                prompt_updated_at = system_prompt.updated_at
                summary_created_at = character_neutral_custom.created_at
                
                if prompt_updated_at > summary_created_at:
                    requires_regeneration = True
                    print(f"[check_existing_summary] プロンプト更新検出: prompt_updated={prompt_updated_at}, summary_created={summary_created_at}")
            
            return ExistingSummaryCheckResponse(
                exists=True,
                requires_regeneration=requires_regeneration,
                summary_type="custom",
                summary_id=character_neutral_custom.id
            )
    
    # どちらのテーブルにも存在しない場合
    return ExistingSummaryCheckResponse(exists=False)


# ========= 論文チャットセッション管理API ===============

@router.get("/{user_paper_link_id}/chat-sessions", response_model=List[PaperChatSessionRead])
def list_chat_sessions(
    user_paper_link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """指定された論文のチャットセッション一覧を取得"""
    # 権限チェック
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    chat_sessions = session.exec(
        select(PaperChatSession)
        .where(PaperChatSession.user_paper_link_id == user_paper_link_id)
        .order_by(PaperChatSession.created_at.asc())
    ).all()
    
    return [PaperChatSessionRead.model_validate(cs) for cs in chat_sessions]


@router.post("/{user_paper_link_id}/chat-sessions", response_model=PaperChatSessionRead)
def create_chat_session(
    user_paper_link_id: int,
    payload: PaperChatSessionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """新しいチャットセッションを作成"""
    # 権限チェック
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    # 同一論文の既存セッション数を確認して連番を決定
    existing_count = session.exec(
        select(func.count(PaperChatSession.id))
        .where(PaperChatSession.user_paper_link_id == user_paper_link_id)
    ).first()
    
    next_number = (existing_count or 0) + 1
    auto_title = f"会話{next_number}"
    
    new_session = PaperChatSession(
        user_paper_link_id=user_paper_link_id,
        title=payload.title if payload.title.strip() else auto_title
    )
    session.add(new_session)
    session.commit()
    session.refresh(new_session)
    
    return PaperChatSessionRead.model_validate(new_session)


@router.delete("/chat-sessions/{session_id}")
def delete_chat_session(
    session_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """チャットセッションを削除（関連するメッセージも削除される）"""
    chat_session = session.get(PaperChatSession, session_id)
    if not chat_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    
    # 権限チェック：セッションが属する論文のユーザーIDを確認
    link = session.get(UserPaperLink, chat_session.user_paper_link_id)
    if not link or link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    # セッションを削除（CASCADE設定により関連メッセージも自動削除される）
    session.delete(chat_session)
    session.commit()
    
    return {"message": "Chat session deleted successfully"}


@router.get("/chat-sessions/{session_id}/messages", response_model=List[ChatMessageRead])
def list_chat_messages_by_session(
    session_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """指定されたセッションのチャットメッセージ一覧を取得"""
    chat_session = session.get(PaperChatSession, session_id)
    if not chat_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    
    # 権限チェック
    link = session.get(UserPaperLink, chat_session.user_paper_link_id)
    if not link or link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    messages = session.exec(
        select(ChatMessage)
        .where(ChatMessage.paper_chat_session_id == session_id)
        .order_by(ChatMessage.id)
    ).all()
    
    return [ChatMessageRead.model_validate(m) for m in messages]


@router.delete("/chat-sessions/{session_id}/messages/index/{reverse_index}", status_code=204)
def delete_session_message_by_reverse_index(
    session_id: int,
    reverse_index: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """セッション内のメッセージを逆順インデックスで削除"""
    chat_session = session.get(PaperChatSession, session_id)
    if not chat_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    
    # 権限チェック
    link = session.get(UserPaperLink, chat_session.user_paper_link_id)
    if not link or link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    # セッション内のメッセージを取得
    messages = session.exec(
        select(ChatMessage)
        .where(ChatMessage.paper_chat_session_id == session_id)
        .order_by(ChatMessage.id)
    ).all()
    
    if reverse_index < 0 or reverse_index >= len(messages):
        raise HTTPException(status_code=404, detail="Invalid message index")

    target = messages[-(reverse_index + 1)]
    session.delete(target)
    
    # セッションのlast_updatedを更新
    chat_session.last_updated = datetime.utcnow()
    
    session.commit()


@router.get("/{user_paper_link_id}/ensure-empty-session", response_model=PaperChatSessionRead)
def ensure_empty_session(
    user_paper_link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """空白セッションの存在を確保し、そのセッションを返す（ページ初期表示用）"""
    # 権限チェック
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    empty_session_id = _ensure_empty_session_exists(session, user_paper_link_id)
    empty_session = session.get(PaperChatSession, empty_session_id)
    
    return PaperChatSessionRead.model_validate(empty_session)



@router.post("/{user_paper_link_id}/messages/async", response_model=PaperChatStartResponse)
def post_chat_message_async(
    user_paper_link_id: int,
    payload: ChatMessageCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """非同期チャットメッセージ処理を開始"""
    link = session.get(UserPaperLink, user_paper_link_id)
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User paper link not found")
    if link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    # セッションIDの決定
    target_session_id = payload.paper_chat_session_id
    if target_session_id is None:
        target_session_id = _ensure_empty_session_exists(session, user_paper_link_id)
    else:
        # セッション存在確認
        chat_session = session.get(PaperChatSession, target_session_id)
        if not chat_session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
        if chat_session.user_paper_link_id != user_paper_link_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session does not belong to this paper")
    
    # セッション内の履歴を取得（空白セッション判定用）
    history = session.exec(
        select(ChatMessage)
        .where(ChatMessage.paper_chat_session_id == target_session_id)
        .order_by(ChatMessage.id)
    ).all()
    was_empty_session = len(history) == 0
    
    # ユーザーメッセージを保存
    user_msg = ChatMessage(
        user_paper_link_id=user_paper_link_id,
        paper_chat_session_id=target_session_id,
        role="user",
        content=payload.content
    )
    session.add(user_msg)
    
    # セッションステータスを pending に設定
    chat_session = session.get(PaperChatSession, target_session_id)
    if chat_session:
        chat_session.processing_status = "pending"
        chat_session.last_updated = datetime.utcnow()
    
    session.commit()
    session.refresh(user_msg)
    
    # 空白セッションから会話が開始された場合、新しい空白セッションを作成
    if was_empty_session:
        _ensure_empty_session_exists(session, user_paper_link_id)
    
    # バックグラウンドタスクを開始
    background_tasks.add_task(
        run_paper_chat_async,
        user_paper_link_id,
        target_session_id,
        payload,
        current_user.id
    )
    
    return PaperChatStartResponse(
        session_id=target_session_id,
        message="Paper chat processing started in background"
    )


@router.get("/chat-sessions/{session_id}/status", response_model=PaperChatSessionStatus)
def get_chat_session_status(
    session_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """チャットセッションのステータスとメッセージを取得"""
    chat_session = session.get(PaperChatSession, session_id)
    if not chat_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    
    # 権限チェック
    link = session.get(UserPaperLink, chat_session.user_paper_link_id)
    if not link or link.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    
    # セッション内のメッセージを取得
    messages = session.exec(
        select(ChatMessage)
        .where(ChatMessage.paper_chat_session_id == session_id)
        .order_by(ChatMessage.id)
    ).all()
    
    return PaperChatSessionStatus(
        session_id=session_id,
        status=chat_session.processing_status,
        messages=[ChatMessageRead.model_validate(m) for m in messages],
        last_updated=chat_session.last_updated
    )


# ★ 新しい単一要約生成API
@router.post("/generate_single_summary", response_model=SingleSummaryResponse)
async def generate_single_summary(
    payload: SingleSummaryRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """単一の要約を生成するAPIエンドポイント
    
    1論文1APIから1要約1APIへの改善により、以下を実現：
    - 処理時間の短縮（1-2分/API）
    - 詳細な進捗管理
    - エラー回復の容易性
    """
    import time
    start_time = time.time()
    
    print(f"[generate_single_summary] Starting for user_id: {current_user.id}, username: {current_user.username}")
    print(f"[generate_single_summary] Processing URL: {payload.url}")
    print(f"[generate_single_summary]{payload.url} System prompt ID: {payload.system_prompt_id}")
    print(f"[generate_single_summary]{payload.url} Create embedding: {payload.create_embedding}")
    
    # LLM設定の準備
    llm_config_to_use = {**GLOBAL_LLM_CONFIG}
    if payload.config_overrides:
        llm_config_to_use.update(payload.config_overrides)
    
    try:
        # ステップ1: 論文メタデータの取得・保存
        arxiv_id = _extract_arxiv_id(payload.url)
        if not arxiv_id:
            raise HTTPException(status_code=400, detail="有効なarXiv URLではありません")
        
        # ★★★ ここから修正 ★★★
        # 既存の論文をチェック
        paper_meta = session.exec(
            select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id)
        ).first()
        
        if not paper_meta:
            # 新規論文の場合、arXivから情報取得
            #full_text_dict = get_arxiv_metadata_with_fulltext(payload.url)
            # --- 失敗時に 2 回だけリトライ ---
            for _attempt in range(3):
                try:
                    full_text_dict = get_arxiv_metadata_with_fulltext(payload.url)
                    break                  # 成功したら脱出
                except Exception as fetch_e:
                    if _attempt < 2:      # 1-2 回目の失敗だけメッセージを出してリトライ
                        print(f"[generate_multiple_summaries] Fetch failed for {arxiv_id}, retrying once: {fetch_e}")
                        await asyncio.sleep(3)      # 少し待ってから再試行
                    else:
                        raise              # 3 回目も失敗したら従来どおり例外を伝搬

            
            paper_meta = PaperMetadata(
                arxiv_id=remove_nul_chars(arxiv_id),
                arxiv_url=remove_nul_chars(payload.url),
                title=remove_nul_chars(full_text_dict["title"]),
                authors=remove_nul_chars(full_text_dict["authors"]),
                published_date=full_text_dict.get("published_date"),
                abstract=remove_nul_chars(full_text_dict["abstract"]),
                full_text=remove_nul_chars(full_text_dict.get("full_text", ""))
            )
            session.add(paper_meta)
            try:
                session.commit()
                session.refresh(paper_meta)
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Created new paper metadata: {paper_meta.id}")
            except Exception as e:
                # 一意性制約違反などでコミットに失敗した場合
                session.rollback()
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Commit failed (likely due to race condition): {e}")
                # もう一度DBから取得を試行
                paper_meta = session.exec(select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id)).first()
                if not paper_meta:
                    # それでも見つからない場合は他の致命的なエラー
                    print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} CRITICAL: Failed to get paper_meta after race condition for arxiv_id: {arxiv_id}")
                    raise HTTPException(status_code=500, detail="論文メタデータの取得に失敗しました。")
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Fetched existing paper_meta after race condition: {paper_meta.id}")
        # ★★★ ここまで修正 ★★★
        else:
            # 既存論文でfull_textが空の場合は更新
            if not paper_meta.full_text:
                try:
                    #full_text_dict = get_arxiv_metadata_with_fulltext(payload.url)
                    # --- 失敗時に 2 回だけリトライ ---
                    for _attempt in range(3):
                        try:
                            full_text_dict = get_arxiv_metadata_with_fulltext(payload.url)
                            break                  # 成功したら脱出
                        except Exception as fetch_e:
                            if _attempt < 2:      # 1-2 回目の失敗だけメッセージを出してリトライ
                                print(f"[generate_multiple_summaries] Fetch failed for {arxiv_id}, retrying once: {fetch_e}")
                                await asyncio.sleep(3)      # 少し待ってから再試行
                            else:
                                raise              # 3 回目も失敗したら従来どおり例外を伝搬
                    paper_meta.full_text = remove_nul_chars(full_text_dict.get("full_text", ""))
                    session.add(paper_meta)
                    session.commit()
                    print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Updated full_text for existing paper: {paper_meta.id}")
                except Exception as e:
                    print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Failed to update full_text: {e}")
        
        # ステップ2: UserPaperLinkの取得・作成
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Searching UserPaperLink for user_id: {current_user.id}, paper_metadata_id: {paper_meta.id}")
        user_paper_link = session.exec(
            select(UserPaperLink)
            .where(UserPaperLink.user_id == current_user.id)
            .where(UserPaperLink.paper_metadata_id == paper_meta.id)
        ).first()
        
        if not user_paper_link:
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} UserPaperLink not found, creating new one for user_id: {current_user.id}")
            user_paper_link = UserPaperLink(
                user_id=current_user.id,
                paper_metadata_id=paper_meta.id,
                tags="",
                memo=""
            )
            session.add(user_paper_link)
            session.commit()
            session.refresh(user_paper_link)
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Created new UserPaperLink: {user_paper_link.id} for user_id: {user_paper_link.user_id}")
        else:
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Found existing UserPaperLink: {user_paper_link.id} for user_id: {user_paper_link.user_id}")
        
        # ステップ2.5: タグ生成・埋め込みベクトル作成フラグの設定
        # 1. 最初のデフォルト要約時は必ず実行
        # 2. 2回目以降では、タグまたはベクトルが存在しない場合のみ実行
        has_tags = bool(user_paper_link.tags)
        has_vector = vector_exists_for_user_paper(current_user.id, str(paper_meta.id))

        create_vector_flag = payload.create_embedding and (payload.is_first_summary_for_paper or not has_vector)
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} create_vector_flag: {create_vector_flag}, has_tags: {has_tags}, has_vector: {has_vector}")
        
        if payload.is_first_summary_for_paper:
            # 最初のデフォルト要約時は必ず実行
            needs_tag_generation = True
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} First default summary for paper - forcing tag generation")
        else:
            # 2回目以降はタグまたはベクトルが存在しない場合のみ実行
            needs_tag_generation = not has_tags
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Subsequent summary - has_tags: {has_tags}, has_vector: {has_vector}, needs_tag_generation: {needs_tag_generation}")
        
        # ステップ3: 既存要約チェックと要約生成
        prompt_name = "デフォルトプロンプト"
        
        # カスタムプロンプトの場合はプロンプト名を取得
        if payload.system_prompt_id:
            system_prompt = session.get(SystemPrompt, payload.system_prompt_id)
            if system_prompt:
                prompt_name = system_prompt.name
            else:
                prompt_name = f"カスタムプロンプト (ID: {payload.system_prompt_id})"
        
        # 既存要約チェック
        generated_summary = None
        custom_summary = None
        using_existing_summaries = False
        existing_character_summary = None
        existing_custom_character = None
        
        # デフォルトプロンプトの場合
        if payload.system_prompt_id is None:
            # キャラクター無し要約をチェック
            existing_character_neutral = session.exec(
                select(GeneratedSummary)
                .where(GeneratedSummary.paper_metadata_id == paper_meta.id)
                .where(GeneratedSummary.llm_provider == llm_config_to_use.get("llm_name", "Unknown"))
                .where(GeneratedSummary.llm_model_name == llm_config_to_use.get("llm_model_name", "Unknown"))
                .where(GeneratedSummary.character_role.is_(None))  # キャラクター中立のみ
                .where(not_(GeneratedSummary.llm_abst.like("[PROCESSING%")))  # PROCESSING状態は除外
            ).first()
            
            # キャラクター付き要約をチェック
            user_character = current_user.selected_character
            if user_character:
                existing_character_summary = session.exec(
                    select(GeneratedSummary)
                    .where(GeneratedSummary.paper_metadata_id == paper_meta.id)
                    .where(GeneratedSummary.llm_provider == llm_config_to_use.get("llm_name", "Unknown"))
                    .where(GeneratedSummary.llm_model_name == llm_config_to_use.get("llm_model_name", "Unknown"))
                    .where(GeneratedSummary.character_role == user_character)
                    .where(not_(GeneratedSummary.llm_abst.like("[PROCESSING%")))  # PROCESSING状態は除外
                ).first()
            
            # 両方存在する場合は既存要約を使用
            if existing_character_neutral and (not user_character or existing_character_summary):
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Using existing default summaries - neutral: {existing_character_neutral.id}, character: {existing_character_summary.id if existing_character_summary else 'None'}")
                generated_summary = existing_character_neutral
                custom_summary = None  # デフォルトプロンプトではcustom_summaryは使用しない
                using_existing_summaries = True
            else:
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Generating new default summaries")
                # 新しい要約を生成
                generated_summary, custom_summary = await _create_and_store_dual_summaries(
                    paper_meta, llm_config_to_use, session,
                    user_id=current_user.id,
                    system_prompt_id=payload.system_prompt_id,
                    affinity_level=0,
                    force_default_prompt=True
                )
                
        else:
            # カスタムプロンプトの場合
            # キャラクター無しカスタム要約をチェック
            existing_custom_neutral = session.exec(
                select(CustomGeneratedSummary)
                .where(CustomGeneratedSummary.user_id == current_user.id)
                .where(CustomGeneratedSummary.paper_metadata_id == paper_meta.id)
                .where(CustomGeneratedSummary.system_prompt_id == payload.system_prompt_id)
                .where(CustomGeneratedSummary.llm_provider == llm_config_to_use.get("llm_name", "Unknown"))
                .where(CustomGeneratedSummary.llm_model_name == llm_config_to_use.get("llm_model_name", "Unknown"))
                .where(CustomGeneratedSummary.character_role.is_(None))
            ).first()
            
            # キャラクター付きカスタム要約をチェック
            user_character = current_user.selected_character
            if user_character:
                existing_custom_character = session.exec(
                    select(CustomGeneratedSummary)
                    .where(CustomGeneratedSummary.user_id == current_user.id)
                    .where(CustomGeneratedSummary.paper_metadata_id == paper_meta.id)
                    .where(CustomGeneratedSummary.system_prompt_id == payload.system_prompt_id)
                    .where(CustomGeneratedSummary.llm_provider == llm_config_to_use.get("llm_name", "Unknown"))
                    .where(CustomGeneratedSummary.llm_model_name == llm_config_to_use.get("llm_model_name", "Unknown"))
                    .where(CustomGeneratedSummary.character_role == user_character)
                ).first()
            
            # 両方存在する場合は既存要約を使用
            if existing_custom_neutral and (not user_character or existing_custom_character):
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Using existing custom summaries - neutral: {existing_custom_neutral.id}, character: {existing_custom_character.id if existing_custom_character else 'None'}")
                generated_summary = None  # カスタムプロンプトではgenerated_summaryは使用しない
                custom_summary = existing_custom_neutral
                using_existing_summaries = True
            else:
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Generating new custom summaries")
                # 新しい要約を生成
                generated_summary, custom_summary = await _create_and_store_dual_summaries(
                    paper_meta, llm_config_to_use, session,
                    user_id=current_user.id,
                    system_prompt_id=payload.system_prompt_id,
                    affinity_level=0,
                    force_default_prompt=False
                )
        
        
        # UserPaperLinkの選択状態を更新（キャラクター要約を優先選択）
        # セッションキャッシュをクリアして最新状態を取得
        session.expire_all()
        
        # 既存要約を使用している場合は直接キャラクター要約を設定
        if using_existing_summaries:
            if payload.system_prompt_id is None:
                # デフォルトプロンプト：キャラクター要約を優先
                selected_default = existing_character_summary if existing_character_summary else generated_summary
                selected_custom = None
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Using existing summaries - selected default: {selected_default.id if selected_default else None}")
            else:
                # カスタムプロンプト：キャラクター要約を優先
                selected_default = None
                selected_custom = existing_custom_character if existing_custom_character else custom_summary
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Using existing summaries - selected custom: {selected_custom.id if selected_custom else None}")
        else:
            # 新しく生成した場合は今回使用したプロンプト条件でDBから全要約を取得
            # 今回生成された全要約（キャラクターなし+キャラクターあり）を対象とする
            if payload.system_prompt_id:
                # カスタムプロンプトの場合
                current_custom_summaries = session.exec(
                    select(CustomGeneratedSummary)
                    .where(CustomGeneratedSummary.paper_metadata_id == paper_meta.id)
                    .where(CustomGeneratedSummary.system_prompt_id == payload.system_prompt_id)
                    .order_by(CustomGeneratedSummary.created_at.desc())
                ).all()
                current_generated_summaries = []
            else:
                # デフォルトプロンプトの場合
                current_generated_summaries = session.exec(
                    select(GeneratedSummary)
                    .where(GeneratedSummary.paper_metadata_id == paper_meta.id)
                    .order_by(GeneratedSummary.created_at.desc())
                ).all()
                current_custom_summaries = []
            
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Current generated summaries: {len(current_generated_summaries)}, current custom summaries: {len(current_custom_summaries)}")
            
            # 今回使用したプロンプト条件の全要約からキャラクター要約を優先して選択
            selected_default, selected_custom = select_best_summary_by_priority(
                current_generated_summaries, current_custom_summaries, selection_mode="initial",
                user_selected_character=current_user.selected_character
            )
        
        # UserPaperLinkに選択結果を設定 - セキュリティ強化
        # session.expire_all()後にuser_paper_linkオブジェクトが正しいレコードを参照しているか確認
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} SECURITY CHECK: user_paper_link.user_id={user_paper_link.user_id}, current_user.id={current_user.id}")
        
        # セキュリティチェック：user_idが一致しない場合は再取得
        if user_paper_link.user_id != current_user.id:
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} SECURITY ALERT: UserPaperLink user_id mismatch! Re-fetching correct record...")
            user_paper_link = session.exec(
                select(UserPaperLink)
                .where(UserPaperLink.user_id == current_user.id)
                .where(UserPaperLink.paper_metadata_id == paper_meta.id)
            ).first()
            
            if not user_paper_link:
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} CRITICAL ERROR: UserPaperLink not found after security check!")
                raise HTTPException(status_code=500, detail="UserPaperLink security check failed")
            
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} SECURITY RECOVERED: Correct UserPaperLink {user_paper_link.id} for user_id {user_paper_link.user_id}")
        
        user_paper_link.selected_generated_summary_id = selected_default.id if selected_default else None
        user_paper_link.selected_custom_generated_summary_id = selected_custom.id if selected_custom else None
        
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Selected summary - default: {user_paper_link.selected_generated_summary_id}, custom: {user_paper_link.selected_custom_generated_summary_id}")
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Final confirmation: UserPaperLink {user_paper_link.id} belongs to user_id {user_paper_link.user_id}")
        
        session.add(user_paper_link)
        session.commit()
        
        # ステップ4: ベクトル作成（必要な場合のみ）
        # ベクトル化にはキャラクターなしの要約（generated_summary）を常に使用
        vector_created = False
        if create_vector_flag:
            try:
                # 統一ベクトル作成システム使用
                # キャラクターなしの要約を優先使用（タグ・埋め込みベクトル生成用）
                preferred_summary_type = "default"
                preferred_system_prompt_id = None
                
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Starting vector creation with user_id={current_user.id}, user_paper_link_id={user_paper_link.id}")
                await _add_paper_to_vectorstore_unified_async(
                    paper_meta, current_user.id, user_paper_link.id, session,
                    preferred_summary_type, preferred_system_prompt_id
                )
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Vector creation completed successfully")
                vector_created = True
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Vector created successfully (using character-neutral summary)")
            except Exception as e:
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Vector creation failed: {e}")
                # ベクトル作成失敗はエラーとしない（要約は作成済み）
        
        # ステップ5: タグ生成（共通関数を使用）
        if needs_tag_generation and paper_meta.id is not None:
            print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Starting tag generation using common function")
            tag_generated = _generate_tags_if_needed(
                paper_metadata_id=paper_meta.id,
                user_id=current_user.id,
                session=session,
                current_user=current_user,
                force_generation=False
            )
            if tag_generated:
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Tag generation completed successfully")
            else:
                print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Tag generation failed or skipped")
        
        # 処理時間計算
        processing_time = time.time() - start_time
        
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Summary generation completed in {processing_time:.2f}s")
        
        # プロンプトタイプの判定（system_prompt_idの有無で判断）
        response_prompt_type = "custom" if payload.system_prompt_id is not None else "default"
        
        return SingleSummaryResponse(
            user_paper_link_id=user_paper_link.id,
            paper_metadata_id=paper_meta.id,
            summary_id=generated_summary.id if generated_summary else None,
            custom_summary_id=custom_summary.id if custom_summary else None,
            vector_created=vector_created,
            processing_time=processing_time,
            prompt_name=prompt_name,
            prompt_type=response_prompt_type,
            message="Summary generated successfully"
        )
        
    except HTTPException:
        # HTTPExceptionはそのまま再発生
        raise
    except Exception as e:
        print(f"[generate_single_summary]{arxiv_id}:{payload.system_prompt_id} Error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"要約生成中にエラーが発生しました: {str(e)}"
        )


@router.post("/generate_multiple_summaries_parallel", response_model=MultipleSummaryResponse)
async def generate_multiple_summaries_parallel(
    payload: MultipleSummaryRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_active_user)
):
    """並列要約生成APIエンドポイント
    
    1論文に対して複数プロンプトの要約を並列で生成：
    - プロンプト数分の並列処理
    - 自動タグ生成（デフォルト要約優先、カスタムのみの場合は1つ選択）
    - エラーハンドリング
    """
    import time
    start_time = time.time()
    
    print(f"[generate_multiple_summaries_parallel] Starting for user_id: {current_user.id}, username: {current_user.username}")
    
    arxiv_id = _extract_arxiv_id(payload.url)
    if not arxiv_id:
        raise HTTPException(status_code=400, detail="有効なarXiv URLではありません")
    
    print(f"[generate_multiple_summaries_parallel] Processing URL: {payload.url}")
    print(f"[generate_multiple_summaries_parallel] Selected prompts: {len(payload.selected_prompts)}")
    print(f"[generate_multiple_summaries_parallel] Create embeddings: {payload.create_embeddings}")
    
    # LLM設定の準備
    llm_config_to_use = {**GLOBAL_LLM_CONFIG}
    if payload.config_overrides:
        llm_config_to_use.update(payload.config_overrides)
    
    try:
        # ステップ1: 論文メタデータの取得・保存（単一要約と同じロジック）
        paper_meta = session.exec(
            select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id)
        ).first()
        
        if not paper_meta:
            # 新規論文の場合、arXivから情報取得
            for _attempt in range(3):
                try:
                    full_text_dict = await get_arxiv_metadata_with_fulltext_async(payload.url)
                    print(f"[generate_multiple_summaries_parallel]{arxiv_id} Fetched full_text {_attempt=}")

                    break
                except Exception as fetch_e:
                    if _attempt < 2:
                        print(f"[generate_multiple_summaries_parallel]{_attempt=} Fetch failed for {arxiv_id}, retrying: {fetch_e}")
                        await asyncio.sleep(3)  # 非同期待機
                    else:
                        raise
            
            paper_meta = PaperMetadata(
                arxiv_id=remove_nul_chars(arxiv_id),
                arxiv_url=remove_nul_chars(payload.url),
                title=remove_nul_chars(full_text_dict["title"]),
                authors=remove_nul_chars(full_text_dict["authors"]),
                published_date=full_text_dict.get("published_date"),
                abstract=remove_nul_chars(full_text_dict["abstract"]),
                full_text=remove_nul_chars(full_text_dict.get("full_text", ""))
            )
            session.add(paper_meta)
            try:
                session.commit()
                session.refresh(paper_meta)
                print(f"[generate_multiple_summaries_parallel] Created new paper metadata: {paper_meta.id}")
            except Exception as e:
                session.rollback()
                print(f"[generate_multiple_summaries_parallel] Commit failed, fetching existing: {e}")
                paper_meta = session.exec(select(PaperMetadata).where(PaperMetadata.arxiv_id == arxiv_id)).first()
                if not paper_meta:
                    raise HTTPException(status_code=500, detail="論文メタデータの取得に失敗しました。")
        else:
            # 既存論文でfull_textが空の場合は更新
            if not paper_meta.full_text:
                try:
                    for _attempt in range(3):
                        try:
                            full_text_dict = await get_arxiv_metadata_with_fulltext_async(payload.url)
                            print(f"[generate_multiple_summaries_parallel]{arxiv_id} Fetched full_text {_attempt=}")
                            break
                        except Exception as fetch_e:
                            if _attempt < 2:
                                print(f"[generate_multiple_summaries_parallel]{_attempt=} Fetch failed for {arxiv_id}, retrying: {fetch_e}")
                                await asyncio.sleep(3)  # 非同期待機
                            else:
                                raise
                    paper_meta.full_text = remove_nul_chars(full_text_dict.get("full_text", ""))
                    session.add(paper_meta)
                    session.commit()
                    print(f"[generate_multiple_summaries_parallel] Updated full_text for existing paper: {paper_meta.id}")
                except Exception as e:
                    print(f"[generate_multiple_summaries_parallel] Failed to update full_text: {e}")
        
        # ステップ2: UserPaperLinkの取得・作成
        print(f"[generate_multiple_summaries_parallel] Searching UserPaperLink for user_id: {current_user.id}, paper_metadata_id: {paper_meta.id}")
        user_paper_link = session.exec(
            select(UserPaperLink).where(
                and_(
                    UserPaperLink.user_id == current_user.id,
                    UserPaperLink.paper_metadata_id == paper_meta.id
                )
            )
        ).first()
        
        if not user_paper_link:
            print(f"[generate_multiple_summaries_parallel] UserPaperLink not found, creating new one for user_id: {current_user.id}")
            user_paper_link = UserPaperLink(
                user_id=current_user.id,
                paper_metadata_id=paper_meta.id,
                tags="",
                memo=""
            )
            session.add(user_paper_link)
            session.commit()
            session.refresh(user_paper_link)
            print(f"[generate_multiple_summaries_parallel] Created new UserPaperLink: {user_paper_link.id} for user_id: {user_paper_link.user_id}")
        else:
            print(f"[generate_multiple_summaries_parallel] Found existing UserPaperLink: {user_paper_link.id} for user_id: {user_paper_link.user_id}")
        
        # タグ・ベクトル存在チェック
        has_tags = bool(user_paper_link.tags and user_paper_link.tags.strip())
        
        # ステップ3: 並列要約生成
        async def generate_single_summary_task(prompt_info):
            """単一要約生成タスク（非同期I/O用）"""
            from db import engine
            task_start_time = time.time()
            prompt_type = prompt_info.type
            system_prompt_id = prompt_info.system_prompt_id
            prompt_name = "デフォルトプロンプト" if prompt_type == "default" else f"カスタムプロンプト"
            
            # 各スレッド専用の新しいセッションを作成
            with Session(engine) as task_session:
                try:
                    # セッションエラー時のリトライロジック
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            # デュアル要約生成（キャラクター無し + キャラクター有り）
                            result = await _create_and_store_dual_summaries(
                                paper_meta, llm_config_to_use, task_session,
                                user_id=current_user.id,
                                system_prompt_id=system_prompt_id,
                                affinity_level=0,
                                force_default_prompt=(prompt_type == "default")
                            )
                            break  # 成功した場合はリトライループを抜ける
                        
                        except Exception as session_error:
                            error_message = str(session_error)
                            print(f"[generate_multiple_summaries_parallel] Session error attempt {attempt + 1}/{max_retries}: {error_message}")
                            
                            # セッション関連エラーの場合はリトライ
                            if "prepared state" in error_message or "commit" in error_message or "rollback" in error_message:
                                if attempt < max_retries - 1:
                                    await asyncio.sleep(1)  # 1秒待機してからリトライ
                                    task_session.rollback()  # セッションをクリーンアップ
                                    continue
                            raise  # リトライ対象外またはリトライ回数上限の場合は例外を再発生
                    
                    # デュアル要約生成の結果処理
                    generated_summary, custom_summary = result
                    
                    if prompt_type == "default":
                        # デフォルトプロンプト使用時：キャラクターありの要約を優先、なければキャラクターなしを使用
                        if custom_summary:
                            summary_id = custom_summary.id  # キャラクターありの要約のIDを使用
                        else:
                            summary_id = generated_summary.id if generated_summary else None
                        custom_summary_id = None
                    else:
                        # カスタムプロンプト使用時：キャラクターありの要約を優先、なければキャラクターなしを使用
                        summary_id = None
                        if custom_summary:
                            custom_summary_id = custom_summary.id  # キャラクターありの要約のIDを使用
                        else:
                            custom_summary_id = generated_summary.id if generated_summary else None
                        
                        # カスタムプロンプト名を取得
                        if system_prompt_id:
                            try:
                                system_prompt = task_session.get(SystemPrompt, system_prompt_id)
                                if system_prompt:
                                    prompt_name = system_prompt.name
                                else:
                                    prompt_name = f"カスタムプロンプト (ID: {system_prompt_id})"
                            except Exception as prompt_error:
                                print(f"[generate_multiple_summaries_parallel] Failed to get prompt name: {prompt_error}")
                                prompt_name = f"カスタムプロンプト (ID: {system_prompt_id})"
                    
                    task_processing_time = time.time() - task_start_time
                    
                    return SummaryResult(
                        summary_id=summary_id,
                        custom_summary_id=custom_summary_id,
                        prompt_name=prompt_name,
                        prompt_type=prompt_type,
                        vector_created=False,  # ベクトル作成は後で一括実行
                        processing_time=task_processing_time
                    )
                    
                except Exception as e:
                    error_message = f"要約生成失敗: {str(e)}"
                    print(f"[generate_multiple_summaries_parallel] {prompt_name} failed: {error_message}")
                    task_processing_time = time.time() - task_start_time
                    
                    return SummaryResult(
                        prompt_name=prompt_name,
                        prompt_type=prompt_type,
                        vector_created=False,
                        processing_time=task_processing_time,
                        error=error_message
                    )
        
        # ★★★ 完全非同期並列実行（ブロッキング解消） ★★★
        print(f"[generate_multiple_summaries_parallel] Starting NON-BLOCKING async execution for {len(payload.selected_prompts)} prompts")
        
        # 純粋な非同期並列実行（ThreadPoolExecutor削除）
        print(f"[generate_multiple_summaries_parallel] Starting pure async execution for {len(payload.selected_prompts)} prompts")
        summary_results = await asyncio.gather(
            *[generate_single_summary_task(prompt_info) for prompt_info in payload.selected_prompts],
            return_exceptions=True
        )
        
        # 例外が返された場合のハンドリング
        for i, result in enumerate(summary_results):
            if isinstance(result, Exception):
                print(f"[generate_multiple_summaries_parallel] Task {i} exception: {result}")
                summary_results[i] = SummaryResult(
                    prompt_name="例外エラー",
                    prompt_type="default",
                    vector_created=False, 
                    processing_time=0,
                    error=f"並列処理例外: {str(result)}"
                )
        
        # 成功・失敗の集計
        successful_results = [r for r in summary_results if r.error is None]
        failed_results = [r for r in summary_results if r.error is not None]
        
        print(f"[generate_multiple_summaries_parallel] Parallel execution completed: {len(successful_results)} success, {len(failed_results)} failed")
        
        # ステップ4: UserPaperLinkの選択要約設定（新規作成要約から選択）
        if successful_results:
            # セッションキャッシュをクリアして最新状態を取得
            session.expire_all()
            
            # 新規作成された要約IDリストを抽出
            newly_created_default_ids = [r.summary_id for r in successful_results if r.summary_id]
            newly_created_custom_ids = [r.custom_summary_id for r in successful_results if r.custom_summary_id]
            
            print(f"[generate_multiple_summaries_parallel] Newly created summary IDs - default: {newly_created_default_ids}, custom: {newly_created_custom_ids}")
            
            # 新規作成された要約のみを取得
            newly_created_generated_summaries = []
            if newly_created_default_ids:
                newly_created_generated_summaries = session.exec(
                    select(GeneratedSummary)
                    .where(GeneratedSummary.id.in_(newly_created_default_ids))
                    .order_by(GeneratedSummary.created_at.desc())
                ).all()
            
            newly_created_custom_summaries = []
            if newly_created_custom_ids:
                newly_created_custom_summaries = session.exec(
                    select(CustomGeneratedSummary)
                    .where(CustomGeneratedSummary.id.in_(newly_created_custom_ids))
                    .order_by(CustomGeneratedSummary.created_at.desc())
                ).all()
            
            print(f"[generate_multiple_summaries_parallel] Found {len(newly_created_generated_summaries)} newly created default summaries, {len(newly_created_custom_summaries)} newly created custom summaries")
            
            # 新規作成要約の中からキャラクター要約を優先して選択
            selected_default_summary, selected_custom_summary = select_best_summary_by_priority(
                generated_summaries=newly_created_generated_summaries,
                custom_summaries=newly_created_custom_summaries,
                selection_mode="initial",
                user_selected_character=current_user.selected_character
            )
            
            # 選択結果を設定
            user_paper_link.selected_generated_summary_id = selected_default_summary.id if selected_default_summary else None
            user_paper_link.selected_custom_generated_summary_id = selected_custom_summary.id if selected_custom_summary else None
            
            print(f"[generate_multiple_summaries_parallel] Selected summary - default: {user_paper_link.selected_generated_summary_id}, custom: {user_paper_link.selected_custom_generated_summary_id}")
            
            session.add(user_paper_link)
            session.commit()
        
        # ステップ5: ベクトル作成（embedding_targetに基づいて）
        vector_created = False
        if payload.create_embeddings and payload.embedding_target != "none" and successful_results:
            try:
                # 埋め込み対象の決定
                if payload.embedding_target == "default_only":
                    # デフォルトプロンプトを探す
                    default_result = next((r for r in successful_results if r.prompt_type == "default"), None)
                    if default_result:
                        await _add_paper_to_vectorstore_unified_async(
                            paper_meta, current_user.id, user_paper_link.id, session,
                            "default", None
                        )
                        vector_created = True
                        print(f"[generate_multiple_summaries_parallel] Vector created with default prompt")
                elif payload.embedding_target == "custom_only":
                    # カスタムプロンプトを探す（最初の成功したもの）
                    custom_result = next((r for r in successful_results if r.prompt_type == "custom"), None)
                    if custom_result:
                        # system_prompt_idの取得
                        custom_prompt_info = next((p for p in payload.selected_prompts if p.type == "custom"), None)
                        system_prompt_id = custom_prompt_info.system_prompt_id if custom_prompt_info else None
                        
                        await _add_paper_to_vectorstore_unified_async(
                            paper_meta, current_user.id, user_paper_link.id, session,
                            "custom", system_prompt_id
                        )
                        vector_created = True
                        print(f"[generate_multiple_summaries_parallel] Vector created with custom prompt")
                        
            except Exception as e:
                print(f"[generate_multiple_summaries_parallel] Vector creation failed: {e}")
        
        # ベクトル作成フラグを結果に反映
        for result in successful_results:
            result.vector_created = vector_created
        
        # ステップ6: タグ生成（共通関数を使用）
        tags_created = False
        if not has_tags and paper_meta.id is not None:
            print(f"[generate_multiple_summaries_parallel] Starting tag generation using common function")
            tags_created = _generate_tags_if_needed(
                paper_metadata_id=paper_meta.id,
                user_id=current_user.id,
                session=session,
                current_user=current_user,
                force_generation=False
            )
            if tags_created:
                print(f"[generate_multiple_summaries_parallel] Tag generation completed successfully")
            else:
                print(f"[generate_multiple_summaries_parallel] Tag generation failed or skipped")
        
        # 処理時間計算
        total_processing_time = time.time() - start_time
        
        print(f"[generate_multiple_summaries_parallel] All processing completed in {total_processing_time:.2f}s")
        
        return MultipleSummaryResponse(
            user_paper_link_id=user_paper_link.id,
            paper_metadata_id=paper_meta.id,
            summary_results=summary_results,
            tags_created=tags_created,
            total_processing_time=total_processing_time,
            successful_summaries=len(successful_results),
            failed_summaries=len(failed_results),
            message=f"並列要約生成完了: 成功 {len(successful_results)} 件, 失敗 {len(failed_results)} 件"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[generate_multiple_summaries_parallel] Error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"並列要約生成中にエラーが発生しました: {str(e)}"
        )

