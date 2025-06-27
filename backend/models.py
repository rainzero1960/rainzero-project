# backend/models.py
from datetime import date as Date, datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship # Relationship をインポート
from sqlalchemy import UniqueConstraint # UniqueConstraint をインポート

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(sa_column_kwargs={"unique": True}, index=True, max_length=50)
    email: Optional[str] = Field(default=None, unique=True, index=True, max_length=100, nullable=True)
    hashed_password: Optional[str] = Field(default=None, nullable=True)
    provider: Optional[str] = Field(default=None, nullable=True, description="e.g., 'credentials', 'google'")
    provider_account_id: Optional[str] = Field(default=None, nullable=True, description="Google User ID from provider")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: Optional[datetime] = Field(default=None, nullable=True)
    color_theme_light: Optional[str] = Field(default="white", nullable=True, description="Light mode background color")
    color_theme_dark: Optional[str] = Field(default="black", nullable=True, description="Dark mode background color")
    display_name: Optional[str] = Field(default=None, nullable=True, max_length=100, description="User display name for prompt variables")
    points: int = Field(default=0, description="User points for unlocking premium background images")
    chat_background_dark_set: Optional[str] = Field(default="01-01", nullable=True, max_length=10, description="Chat dark background image set (e.g., '01-01')")
    chat_background_light_set: Optional[str] = Field(default="01-01", nullable=True, max_length=10, description="Chat light background image set (e.g., '01-01')")
    rag_background_dark_set: Optional[str] = Field(default="01-01", nullable=True, max_length=10, description="RAG dark background image set (e.g., '01-01')")
    rag_background_light_set: Optional[str] = Field(default="01-01", nullable=True, max_length=10, description="RAG light background image set (e.g., '01-01')")
    selected_character: Optional[str] = Field(default=None, nullable=True, max_length=20, description="Selected character for roleplay prompts ('sakura', 'miyuki', or None)")
    sakura_affinity_level: int = Field(default=0, description="User's affinity level with Sakura character (0-4)")
    miyuki_affinity_level: int = Field(default=0, description="User's affinity level with Miyuki character (0-4)")
    sakura_affinity_points: int = Field(default=0, description="User's affinity points with Sakura character")
    miyuki_affinity_points: int = Field(default=0, description="User's affinity points with Miyuki character")

    # Relationships
    user_paper_links: List["UserPaperLink"] = Relationship(back_populates="user")
    rag_sessions: List["RagSession"] = Relationship(back_populates="user")
    edited_summaries: List["EditedSummary"] = Relationship(back_populates="user")
    system_prompts: List["SystemPrompt"] = Relationship(back_populates="user")
    system_prompt_groups: List["SystemPromptGroup"] = Relationship(back_populates="user")
    custom_generated_summaries: List["CustomGeneratedSummary"] = Relationship(back_populates="user")


class PaperMetadata(SQLModel, table=True):
    __tablename__ = "papermetadata" # 明示的にテーブル名を指定
    id: Optional[int] = Field(default=None, primary_key=True)
    arxiv_id: str = Field(sa_column_kwargs={"unique": True}, index=True)
    arxiv_url: Optional[str] = Field(default=None, nullable=True)
    title: str
    authors: str
    published_date: Optional[Date] = Field(default=None, nullable=True)
    abstract: str
    full_text: Optional[str] = Field(default=None, nullable=True) # 初回取得時に格納
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationships
    generated_summaries: List["GeneratedSummary"] = Relationship(back_populates="paper_metadata")
    user_paper_links: List["UserPaperLink"] = Relationship(back_populates="paper_metadata")
    custom_generated_summaries: List["CustomGeneratedSummary"] = Relationship(back_populates="paper_metadata")


class GeneratedSummary(SQLModel, table=True):
    __tablename__ = "generatedsummary" # 明示的にテーブル名を指定
    id: Optional[int] = Field(default=None, primary_key=True)
    paper_metadata_id: int = Field(foreign_key="papermetadata.id", index=True)
    llm_provider: str
    llm_model_name: str
    llm_abst: str
    one_point: Optional[str] = Field(default=None, nullable=True)
    character_role: Optional[str] = Field(default=None, nullable=True, max_length=20, description="Character role for roleplay prompts ('sakura', 'miyuki', or None for default)")
    affinity_level: int = Field(default=0, description="Affinity level for character roleplay (0=default, 1-4=higher levels)")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationships
    paper_metadata: Optional[PaperMetadata] = Relationship(back_populates="generated_summaries")
    user_paper_links_selected: List["UserPaperLink"] = Relationship(back_populates="selected_summary") # ★ 追加: UserPaperLinkからの参照
    edited_summaries: List["EditedSummary"] = Relationship(back_populates="generated_summary")


    # Unique constraint
    __table_args__ = (UniqueConstraint("paper_metadata_id", "llm_provider", "llm_model_name", "character_role", "affinity_level", name="uq_summary_paper_llm_character_affinity"),)

class SystemPrompt(SQLModel, table=True):
    """
    システムプロンプトのカスタマイズを管理するテーブル
    
    デフォルトプロンプトはdefault_prompts.pyで管理され、
    ユーザーがカスタマイズした場合にこのテーブルに保存される。
    """
    __tablename__ = "systemprompt"
    id: Optional[int] = Field(default=None, primary_key=True)
    prompt_type: str = Field(index=True, description="プロンプトタイプ（PromptType.valueと対応）")
    name: str = Field(description="プロンプト名")
    description: str = Field(description="プロンプトの説明")
    prompt: str = Field(description="プロンプト本文")
    category: str = Field(index=True, description="プロンプトカテゴリ")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True, nullable=True, description="カスタマイズしたユーザーID（Nullの場合はグローバル設定）")
    is_active: bool = Field(default=True, description="有効/無効フラグ")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationships
    user: Optional[User] = Relationship(back_populates="system_prompts")
    custom_generated_summaries: List["CustomGeneratedSummary"] = Relationship(back_populates="system_prompt")

    # Unique constraint: 同一ユーザーで同一プロンプト名は一つまで（複数プロンプトタイプ対応）
    __table_args__ = (UniqueConstraint("name", "user_id", name="uq_prompt_name_user"),)


class SystemPromptGroup(SQLModel, table=True):
    """
    システムプロンプトグループ管理テーブル
    
    DeepResearch/DeepRAGの5つのエージェント用プロンプトを
    1つのグループとして管理する。
    例：「女の子ロールプレイグループ」として5つのプロンプトをセット
    """
    __tablename__ = "system_prompt_group"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(description="プロンプトグループ名（例：女の子ロールプレイグループ）")
    description: str = Field(description="グループの説明")
    category: str = Field(index=True, description="'deepresearch' or 'deeprag'")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True, nullable=True, description="カスタムグループのユーザーID（Nullの場合はデフォルトグループ）")
    
    # 各エージェント用のプロンプトID（Nullの場合はデフォルトプロンプト使用）
    coordinator_prompt_id: Optional[int] = Field(default=None, foreign_key="systemprompt.id", nullable=True)
    planner_prompt_id: Optional[int] = Field(default=None, foreign_key="systemprompt.id", nullable=True)
    supervisor_prompt_id: Optional[int] = Field(default=None, foreign_key="systemprompt.id", nullable=True)
    agent_prompt_id: Optional[int] = Field(default=None, foreign_key="systemprompt.id", nullable=True)
    summary_prompt_id: Optional[int] = Field(default=None, foreign_key="systemprompt.id", nullable=True)
    
    is_active: bool = Field(default=True, description="有効/無効フラグ")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationships
    user: Optional[User] = Relationship(back_populates="system_prompt_groups")
    
    # Unique constraint: 同一ユーザーで同一グループ名は一つまで
    __table_args__ = (UniqueConstraint("name", "user_id", "category", name="uq_prompt_group_name_user_category"),)

class CustomGeneratedSummary(SQLModel, table=True):
    """
    カスタムプロンプトで生成された要約を管理するテーブル
    ユーザーごと、論文ごと、プロンプトごとに個別保存
    """
    __tablename__ = "custom_generated_summary"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    paper_metadata_id: int = Field(foreign_key="papermetadata.id", index=True)
    system_prompt_id: int = Field(foreign_key="systemprompt.id", index=True)
    llm_provider: str = Field(max_length=50)
    llm_model_name: str = Field(max_length=100)
    llm_abst: str
    one_point: Optional[str] = Field(default=None, nullable=True)
    character_role: Optional[str] = Field(default=None, nullable=True, max_length=20, description="Character role for roleplay prompts ('sakura', 'miyuki', or None for default)")
    affinity_level: int = Field(default=0, description="Affinity level for character roleplay (0=default, 1-4=higher levels)")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationships
    user: Optional[User] = Relationship(back_populates="custom_generated_summaries")
    paper_metadata: Optional[PaperMetadata] = Relationship(back_populates="custom_generated_summaries")
    system_prompt: Optional[SystemPrompt] = Relationship(back_populates="custom_generated_summaries")
    user_paper_links_selected: List["UserPaperLink"] = Relationship(back_populates="selected_custom_summary")
    edited_summaries: List["EditedSummary"] = Relationship(back_populates="custom_generated_summary")

    # Unique constraint: 同一ユーザー・論文・プロンプト・モデル・キャラクター・好感度レベルで1つまで
    __table_args__ = (UniqueConstraint("user_id", "paper_metadata_id", "system_prompt_id", "llm_provider", "llm_model_name", "character_role", "affinity_level", name="uq_custom_summary_user_paper_prompt_llm_character_affinity"),)

class UserPaperLink(SQLModel, table=True):
    __tablename__ = "userpaperlink" # 明示的にテーブル名を指定
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    paper_metadata_id: int = Field(foreign_key="papermetadata.id", index=True)
    tags: str = Field(default="")
    memo: str = Field(default="")
    selected_generated_summary_id: Optional[int] = Field(default=None, foreign_key="generatedsummary.id", nullable=True) # ★ 追加
    selected_custom_generated_summary_id: Optional[int] = Field(default=None, foreign_key="custom_generated_summary.id", nullable=True) # ★ 新追加
    created_at: datetime = Field(default_factory=datetime.utcnow) # ユーザーがライブラリに追加した日時
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})
    last_accessed_at: Optional[datetime] = Field(default=None, nullable=True)

    # Relationships
    user: Optional[User] = Relationship(back_populates="user_paper_links")
    paper_metadata: Optional[PaperMetadata] = Relationship(back_populates="user_paper_links")
    selected_summary: Optional[GeneratedSummary] = Relationship( # ★ 追加
        back_populates="user_paper_links_selected",
        sa_relationship_kwargs={
            "primaryjoin": "UserPaperLink.selected_generated_summary_id == GeneratedSummary.id",
            "lazy": "joined" # Eager load the selected summary
        }
    )
    selected_custom_summary: Optional[CustomGeneratedSummary] = Relationship( # ★ 新追加
        back_populates="user_paper_links_selected",
        sa_relationship_kwargs={
            "primaryjoin": "UserPaperLink.selected_custom_generated_summary_id == CustomGeneratedSummary.id",
            "lazy": "joined" # Eager load the selected custom summary
        }
    )
    chat_messages: List["ChatMessage"] = Relationship(back_populates="user_paper_link")
    paper_chat_sessions: List["PaperChatSession"] = Relationship(back_populates="user_paper_link")


    # Unique constraint
    __table_args__ = (UniqueConstraint("user_id", "paper_metadata_id", name="uq_user_paper"),)


class PaperChatSession(SQLModel, table=True):
    __tablename__ = "paperchat_session"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_paper_link_id: int = Field(foreign_key="userpaperlink.id", index=True)
    title: str = Field(description="セッションタイトル（例：会話1、会話2...）")
    processing_status: Optional[str] = Field(default=None, nullable=True, description="例: pending, processing, completed, failed")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_updated: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})
    
    # Relationship
    user_paper_link: Optional[UserPaperLink] = Relationship(back_populates="paper_chat_sessions")
    chat_messages: List["ChatMessage"] = Relationship(back_populates="paper_chat_session")


class ChatMessage(SQLModel, table=True): # 旧 Message モデル
    __tablename__ = "chatmessage" # 明示的にテーブル名を指定
    id: Optional[int] = Field(default=None, primary_key=True)
    user_paper_link_id: int = Field(foreign_key="userpaperlink.id", index=True) # ★ FK変更 (後方互換性のため残す)
    paper_chat_session_id: Optional[int] = Field(default=None, foreign_key="paperchat_session.id", index=True, nullable=True) # ★ 新しいFK追加
    role: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationship
    user_paper_link: Optional[UserPaperLink] = Relationship(back_populates="chat_messages")
    paper_chat_session: Optional[PaperChatSession] = Relationship(back_populates="chat_messages")


# ========= RAG / DeepResearch 用履歴 (user_id への紐付け強化) ===============
class RagSession(SQLModel, table=True):
    __tablename__ = "ragsession"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True) # ★ Nullableを解除、必須項目に
    created_at: datetime = Field(default_factory=datetime.utcnow)
    title: str = Field(default="", description="会話履歴の自動生成タイトル")
    processing_status: Optional[str] = Field(default=None, description="例: pending, planning, agent_running, summarizing, completed, failed")
    last_updated: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationship
    user: Optional[User] = Relationship(back_populates="rag_sessions")
    messages: List["RagMessage"] = Relationship(back_populates="session")


class RagMessage(SQLModel, table=True):
    __tablename__ = "ragmessage"
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="ragsession.id", index=True)
    role: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata_json: Optional[str] = Field(default=None, description="JSON string for additional metadata")
    is_deep_research_step: bool = Field(default=False, description="True if this is an intermediate step of DeepResearch")

    # Relationship
    session: Optional[RagSession] = Relationship(back_populates="messages")




class EditedSummary(SQLModel, table=True):
    __tablename__ = "editedsummary"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    generated_summary_id: Optional[int] = Field(default=None, foreign_key="generatedsummary.id", index=True, nullable=True)
    custom_generated_summary_id: Optional[int] = Field(default=None, foreign_key="custom_generated_summary.id", index=True, nullable=True)
    edited_llm_abst: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})

    # Relationships
    user: Optional[User] = Relationship(back_populates="edited_summaries")
    generated_summary: Optional[GeneratedSummary] = Relationship(back_populates="edited_summaries")
    custom_generated_summary: Optional[CustomGeneratedSummary] = Relationship(back_populates="edited_summaries")

    __table_args__ = (
        UniqueConstraint("user_id", "generated_summary_id", name="uq_user_edited_summary"),
        UniqueConstraint("user_id", "custom_generated_summary_id", name="uq_user_edited_custom_summary"),
    )