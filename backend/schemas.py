# backend/schemas.py
from datetime import date as Date, datetime
from typing import Optional, Dict, Any, List, Union, Literal
from pydantic import BaseModel, Field, validator, ConfigDict

class PaperMetadataBase(BaseModel):
    arxiv_id: str
    arxiv_url: Optional[str] = None
    title: str
    authors: str
    published_date: Optional[Date] = None
    abstract: str

class PaperMetadataRead(PaperMetadataBase):
    id: int
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class GeneratedSummaryBase(BaseModel):
    llm_provider: str
    llm_model_name: str
    llm_abst: str
    one_point: Optional[str] = None
    character_role: Optional[str] = None
    affinity_level: int = 0

class GeneratedSummaryRead(GeneratedSummaryBase):
    id: int
    paper_metadata_id: int
    created_at: datetime
    updated_at: datetime
    has_user_edited_summary: Optional[bool] = None  # ユーザーのEditedSummaryが存在するか
    model_config = ConfigDict(from_attributes=True)

class CustomGeneratedSummaryBase(BaseModel):
    user_id: int
    paper_metadata_id: int
    system_prompt_id: int
    llm_provider: str
    llm_model_name: str
    llm_abst: str
    one_point: Optional[str] = None
    character_role: Optional[str] = None
    affinity_level: int = 0

class CustomGeneratedSummaryRead(CustomGeneratedSummaryBase):
    id: int
    created_at: datetime
    updated_at: datetime
    has_user_edited_summary: Optional[bool] = None  # ユーザーのEditedSummaryが存在するか
    system_prompt_name: Optional[str] = None  # プロンプト名を表示用に含める
    model_config = ConfigDict(from_attributes=True)

class EditedSummaryBase(BaseModel):
    edited_llm_abst: str

# EditedSummaryCreate は EditSummaryRequest で代替するため削除
# class EditedSummaryCreate(EditedSummaryBase):
#     pass

class EditSummaryRequest(EditedSummaryBase): # これが実質的なCreate/Updateのペイロード
    pass

class EditedSummaryRead(EditedSummaryBase):
    id: int
    user_id: int
    generated_summary_id: Optional[int] = None
    custom_generated_summary_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class UserPaperLinkBase(BaseModel):
    tags: str = ""
    memo: str = ""

    @validator("tags")
    def strip_spaces_tags(cls, v: str):
        return ",".join(t.strip() for t in v.split(",")) if v else v

class UserPaperLinkCreate(UserPaperLinkBase):
    pass

class UserPaperLinkUpdate(BaseModel):
    tags: Optional[str] = None
    memo: Optional[str] = None
    selected_generated_summary_id: Optional[int] = None
    selected_custom_generated_summary_id: Optional[int] = None

    @validator("tags", pre=True, always=True)
    def strip_spaces_tags_update(cls, v: Optional[str]):
        return ",".join(t.strip() for t in v.split(",")) if v else v

class PaperResponse(BaseModel):
    user_paper_link_id: int
    paper_metadata: PaperMetadataRead
    selected_generated_summary: Optional[GeneratedSummaryRead] = None
    selected_custom_generated_summary: Optional[CustomGeneratedSummaryRead] = None
    user_edited_summary: Optional[EditedSummaryRead] = None
    selected_generated_summary_id: Optional[int] = None
    selected_custom_generated_summary_id: Optional[int] = None
    available_summaries: List[GeneratedSummaryRead] = []
    available_custom_summaries: List[CustomGeneratedSummaryRead] = []
    user_specific_data: UserPaperLinkBase
    created_at: datetime
    last_accessed_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)

class ArxivMeta(BaseModel):
    title: str
    authors: str
    abstract: str

class FullTextResponse(BaseModel):
    id: int
    message: str = "saved"

class PromptSelection(BaseModel):
    """プロンプト選択情報"""
    type: Literal["default", "custom"]
    system_prompt_id: Optional[int] = None  # カスタムプロンプト使用時のプロンプトID

class PaperCreateAuto(BaseModel):
    url: str
    config_overrides: Optional[Dict[str, Any]] = None
    prompt_mode: Literal["default", "prompt_selection"] = "default"
    selected_prompts: List[PromptSelection] = Field(default_factory=list)  # プロンプト選択モード時の選択プロンプト一覧
    create_embeddings: bool = True  # 埋め込みベクトルを作成するかどうか
    embedding_target: Literal["default_only", "custom_only", "both"] = "default_only"  # 埋め込みベクトル作成対象
    embedding_target_system_prompt_id: Optional[int] = None  # カスタム埋め込み対象の場合のsystem_prompt_id

class HFImportRequest(BaseModel):
    config_overrides: Optional[Dict[str, Any]] = None
    prompt_mode: Literal["default", "prompt_selection"] = "default"
    selected_prompts: List[PromptSelection] = Field(default_factory=list)  # プロンプト選択モード時の選択プロンプト一覧
    create_embeddings: bool = True  # 埋め込みベクトルを作成するかどうか
    embedding_target: Literal["default_only", "custom_only", "both"] = "default_only"  # 埋め込みベクトル作成対象
    embedding_target_system_prompt_id: Optional[int] = None  # カスタム埋め込み対象の場合のsystem_prompt_id

class PaperImportResponse(BaseModel):
    user_paper_link_id: int
    paper_metadata_id: int
    generated_summary_id: Optional[int] = None
    message: str = "imported"

class RegenerateSummaryRequest(BaseModel):
    config_overrides: Optional[Dict[str, Any]] = None
    prompt_mode: Literal["default", "prompt_selection"] = "default"
    selected_prompts: List[PromptSelection] = Field(default_factory=list)  # プロンプト選択モード時の選択プロンプト一覧
    create_embeddings: bool = False  # 再生成時は基本的に埋め込みベクトル作成しない
    embedding_target: Literal["default_only", "custom_only", "both"] = "default_only"  # 埋め込みベクトル作成対象

class RegenerateSummaryResponse(BaseModel):
    generated_summary: Optional[GeneratedSummaryRead] = None
    custom_generated_summary: Optional[CustomGeneratedSummaryRead] = None
    message: str = "Summary regenerated successfully"

class RagQuery(BaseModel):
    query: str
    tags: list[str] | None = None
    session_id: int | None = None
    provider: str | None = None
    model: str | None = None
    temperature: float | None = None
    top_p: float | None = None
    selected_tools: List[str] = Field(default_factory=lambda: ["local_rag_search_tool"])
    prompt_mode: Literal["default", "prompt_selection"] = "default"
    selected_prompts: List[PromptSelection] = Field(default_factory=list)  # プロンプト選択モード時の選択プロンプト一覧
    use_character_prompt: bool = True  # キャラクタープロンプトを使用するか

class WebSearchResultRef(BaseModel):
    type: str = Field(default="web", Literal="web")
    title: str
    url: str
    snippet: Optional[str] = None
    score: Optional[float] = None

class RagAnswerRef(BaseModel):
    type: str = Field(default="paper", Literal="paper")
    user_paper_link_id: int
    paper_metadata_id: int
    title: str
    arxiv_id: Optional[str] = None
    score: Optional[float] = None

class RagAnswer(BaseModel):
    answer: str
    refs: List[Union[RagAnswerRef, WebSearchResultRef]]
    session_id: int

class RagMessageRead(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    created_at: datetime
    metadata_json: Optional[Union[str, Dict[str, Any]]] = None
    is_deep_research_step: bool = False
    model_config = ConfigDict(from_attributes=True)

class RagSessionRead(BaseModel):
    id: int
    user_id: int
    created_at: datetime
    title: str
    processing_status: Optional[str] = None
    last_updated: datetime
    model_config = ConfigDict(from_attributes=True)

class DeepRagStartRequest(BaseModel):
    query: str
    tags: Optional[List[str]] = None
    session_id: Optional[int] = None
    system_prompt_group_id: Optional[int] = None  # プロンプトグループ選択用
    use_character_prompt: bool = True  # キャラクタープロンプトを使用するか

class DeepResearchStartRequest(BaseModel):
    query: str
    session_id: Optional[int] = None
    system_prompt_group_id: Optional[int] = None  # プロンプトグループ選択用
    use_character_prompt: bool = True  # キャラクタープロンプトを使用するか

class DeepResearchStartResponse(BaseModel):
    session_id: int
    message: str

class DeepResearchStatusResponse(BaseModel):
    session_id: int
    status: Optional[str]
    messages: List[RagMessageRead]
    last_updated: datetime

# Simple RAG バックグラウンド処理用スキーマ
class SimpleRagStartRequest(BaseModel):
    query: str
    tags: Optional[List[str]] = None
    session_id: Optional[int] = None
    selected_tools: List[str] = Field(default_factory=lambda: ["local_rag_search_tool"])
    provider: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    prompt_mode: Literal["default", "prompt_selection"] = "default"
    selected_prompts: List[PromptSelection] = Field(default_factory=list)
    use_character_prompt: bool = True  # キャラクタープロンプトを使用するか

class SimpleRagStartResponse(BaseModel):
    session_id: int
    message: str

class SimpleRagStatusResponse(BaseModel):
    session_id: int
    status: Optional[str]
    messages: List[RagMessageRead]
    last_updated: datetime
    refs: Optional[List[Union[RagAnswerRef, WebSearchResultRef]]] = None

class PaperChatSessionBase(BaseModel):
    title: str
    
class PaperChatSessionCreate(PaperChatSessionBase):
    user_paper_link_id: int

class PaperChatSessionRead(PaperChatSessionBase):
    id: int
    user_paper_link_id: int
    processing_status: Optional[str] = None
    created_at: datetime
    last_updated: datetime
    model_config = ConfigDict(from_attributes=True)

class PaperChatSessionStatus(BaseModel):
    session_id: int
    status: Optional[str] = None
    messages: List["ChatMessageRead"] = []
    last_updated: datetime

class PaperChatStartResponse(BaseModel):
    session_id: int
    message: str = "Paper chat processing started in background"

class ChatMessageCreate(BaseModel):
    role: str
    content: str
    provider: str | None = None
    model: str | None = None
    temperature: float | None = None
    top_p: float | None = None
    system_prompt_id: int | None = None  # カスタムプロンプトID（Noneの場合はデフォルト）
    paper_chat_session_id: int | None = None  # セッションID（Noneの場合は新規セッション作成）
    use_character_prompt: bool = True  # キャラクタープロンプトを使用するか

class ChatMessageRead(ChatMessageCreate):
    id: int
    user_paper_link_id: int
    paper_chat_session_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ChatMessageResponse(BaseModel):
    messages: List[ChatMessageRead]
    new_empty_session_id: Optional[int] = None  # 新しく作成された空白セッションID

class UserBase(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: Optional[str] = Field(default=None, max_length=100)
    color_theme_light: Optional[str] = Field(default="white", description="Light mode background color")
    color_theme_dark: Optional[str] = Field(default="black", description="Dark mode background color")
    display_name: Optional[str] = Field(default=None, max_length=100, description="User display name for prompt variables")
    points: int = Field(default=0, description="User points for unlocking premium background images")
    chat_background_dark_set: Optional[str] = Field(default="01-01", max_length=10, description="Chat dark background image set (e.g., '01-01')")
    chat_background_light_set: Optional[str] = Field(default="01-01", max_length=10, description="Chat light background image set (e.g., '01-01')")
    rag_background_dark_set: Optional[str] = Field(default="01-01", max_length=10, description="RAG dark background image set (e.g., '01-01')")
    rag_background_light_set: Optional[str] = Field(default="01-01", max_length=10, description="RAG light background image set (e.g., '01-01')")
    selected_character: Optional[str] = Field(default=None, max_length=20, description="Selected character for roleplay prompts ('sakura', 'miyuki', or None)")
    sakura_affinity_level: int = Field(default=0, description="User's affinity level with Sakura character (0-4)")
    miyuki_affinity_level: int = Field(default=0, description="User's affinity level with Miyuki character (0-4)")

class UserCreate(UserBase):
    password: str = Field(min_length=6)

class UserRead(UserBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
    user_id: Optional[int] = None

class ColorThemeUpdateRequest(BaseModel):
    color_theme_light: Optional[str] = None
    color_theme_dark: Optional[str] = None

class DisplayNameUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=100, description="User display name for prompt variables")

class CharacterSelectionUpdateRequest(BaseModel):
    selected_character: Optional[str] = Field(default=None, max_length=20, description="Selected character for roleplay prompts ('sakura', 'miyuki', or None)")

class AffinityLevelUpdateRequest(BaseModel):
    sakura_affinity_level: Optional[int] = Field(default=None, ge=0, le=4, description="User's affinity level with Sakura character (0-4)")
    miyuki_affinity_level: Optional[int] = Field(default=None, ge=0, le=4, description="User's affinity level with Miyuki character (0-4)")

class BackgroundImagesUpdateRequest(BaseModel):
    chat_background_dark_set: Optional[str] = Field(default=None, max_length=10, description="Chat dark background image set (e.g., '01-01')")
    chat_background_light_set: Optional[str] = Field(default=None, max_length=10, description="Chat light background image set (e.g., '01-01')")
    rag_background_dark_set: Optional[str] = Field(default=None, max_length=10, description="RAG dark background image set (e.g., '01-01')")
    rag_background_light_set: Optional[str] = Field(default=None, max_length=10, description="RAG light background image set (e.g., '01-01')")

class BackgroundImageInfo(BaseModel):
    set_number: str = Field(description="Image set number (e.g., '01-01')")
    image_path: str = Field(description="Backend image path")
    required_points: int = Field(description="Points required to unlock this image")

class AvailableBackgroundImagesResponse(BaseModel):
    light_theme: Dict[str, Union[str, int]] = Field(description="Light theme information")
    dark_theme: Dict[str, Union[str, int]] = Field(description="Dark theme information")
    user_points: int = Field(description="User's current points")
    available_images: Dict[str, List[BackgroundImageInfo]] = Field(description="Available images by type")

class PaperSummaryItem(BaseModel):
    user_paper_link_id: int
    paper_metadata: PaperMetadataRead
    selected_generated_summary_one_point: Optional[str] = None
    selected_generated_summary_llm_info: Optional[str] = None
    user_specific_data: UserPaperLinkBase
    created_at: datetime
    last_accessed_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)

class PapersPageResponse(BaseModel):
    items: List[PaperSummaryItem]
    total: int
    page: int
    size: int
    pages: int

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


# SystemPrompt関連のスキーマ
class SystemPromptBase(BaseModel):
    """システムプロンプトの基本スキーマ"""
    prompt_type: str = Field(description="プロンプトタイプ")
    name: str = Field(description="プロンプト名")
    description: str = Field(description="プロンプトの説明")
    prompt: str = Field(description="プロンプト本文")
    category: str = Field(description="プロンプトカテゴリ")
    is_active: bool = Field(default=True, description="有効/無効フラグ")


class SystemPromptCreate(SystemPromptBase):
    """システムプロンプト作成用スキーマ"""
    pass


class SystemPromptUpdate(BaseModel):
    """システムプロンプト更新用スキーマ（部分更新対応）"""
    name: Optional[str] = Field(default=None, description="プロンプト名")
    description: Optional[str] = Field(default=None, description="プロンプトの説明")
    prompt: Optional[str] = Field(default=None, description="プロンプト本文")
    is_active: Optional[bool] = Field(default=None, description="有効/無効フラグ")


class SystemPromptRead(SystemPromptBase):
    """システムプロンプト取得用スキーマ"""
    id: int
    user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SystemPromptListResponse(BaseModel):
    """システムプロンプト一覧取得レスポンス"""
    prompts: List[SystemPromptRead]
    total: int


class PromptTypeInfo(BaseModel):
    """プロンプトタイプ情報"""
    type: str
    name: str
    description: str
    category: str
    has_custom: bool = Field(description="ユーザーがカスタマイズしているかどうか")
    is_active: bool = Field(description="有効/無効フラグ")


class PromptTypesResponse(BaseModel):
    """プロンプトタイプ一覧レスポンス"""
    prompt_types: List[PromptTypeInfo]
    categories: List[str]


# SystemPromptGroup関連のスキーマ
class SystemPromptGroupBase(BaseModel):
    """システムプロンプトグループの基本スキーマ"""
    name: str = Field(description="プロンプトグループ名")
    description: str = Field(description="グループの説明")
    category: str = Field(description="'deepresearch' or 'deeprag'")
    coordinator_prompt_id: Optional[int] = Field(default=None, description="Coordinatorプロンプト")
    planner_prompt_id: Optional[int] = Field(default=None, description="Plannerプロンプト")
    supervisor_prompt_id: Optional[int] = Field(default=None, description="Supervisorプロンプト")
    agent_prompt_id: Optional[int] = Field(default=None, description="Agentプロンプト")
    summary_prompt_id: Optional[int] = Field(default=None, description="Summaryプロンプト")
    is_active: bool = Field(default=True, description="有効/無効フラグ")


class SystemPromptGroupCreate(SystemPromptGroupBase):
    """システムプロンプトグループ作成用スキーマ"""
    pass


class SystemPromptGroupUpdate(BaseModel):
    """システムプロンプトグループ更新用スキーマ（部分更新対応）"""
    name: Optional[str] = Field(default=None, description="プロンプトグループ名")
    description: Optional[str] = Field(default=None, description="グループの説明")
    coordinator_prompt_id: Optional[int] = Field(default=None, description="Coordinatorプロンプト")
    planner_prompt_id: Optional[int] = Field(default=None, description="Plannerプロンプト")
    supervisor_prompt_id: Optional[int] = Field(default=None, description="Supervisorプロンプト")
    agent_prompt_id: Optional[int] = Field(default=None, description="Agentプロンプト")
    summary_prompt_id: Optional[int] = Field(default=None, description="Summaryプロンプト")
    is_active: Optional[bool] = Field(default=None, description="有効/無効フラグ")


class SystemPromptGroupRead(SystemPromptGroupBase):
    """システムプロンプトグループ取得用スキーマ"""
    id: int
    user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SystemPromptGroupListResponse(BaseModel):
    """システムプロンプトグループ一覧取得レスポンス"""
    groups: List[SystemPromptGroupRead]
    total: int

class VectorExistenceCheckRequest(BaseModel):
    """ベクトル存在チェックリクエスト"""
    urls: List[str]  # チェック対象のURL一覧

class VectorExistenceCheckResponse(BaseModel):
    """ベクトル存在チェックレスポンス"""
    existing_urls: List[str]  # 既にベクトルが存在するURL一覧

class DuplicationCheckRequest(BaseModel):
    """重複チェックリクエスト（ベクトル+要約）"""
    urls: List[str]  # チェック対象のURL一覧
    prompt_mode: Literal["default", "prompt_selection"] = "default"
    selected_prompts: List[PromptSelection] = Field(default_factory=list)

class SummaryDuplicationInfo(BaseModel):
    """要約重複情報"""
    url: str
    prompt_name: str
    prompt_type: Literal["default", "custom"]
    system_prompt_id: Optional[int] = None

class DuplicationCheckResponse(BaseModel):
    """統合重複チェックレスポンス"""
    existing_vector_urls: List[str]  # 既にベクトルが存在するURL一覧
    existing_summary_info: List[SummaryDuplicationInfo]  # 既に要約が存在するURL+プロンプト情報

class MissingVectorCheckRequest(BaseModel):
    """ベクトル未存在チェックリクエスト"""
    urls: List[str]  # チェック対象のURL一覧

class MissingVectorCheckResponse(BaseModel):
    """ベクトル未存在チェックレスポンス"""
    missing_vector_urls: List[str]  # ベクトルが存在しないURL一覧
    total_urls: int  # 総URL数
    missing_count: int  # ベクトルが存在しない論文数

class ExistingSummaryCheckRequest(BaseModel):
    """既存要約チェックリクエスト（重複処理防止用）"""
    url: str  # チェック対象のURL
    system_prompt_id: Optional[int] = None  # プロンプトID（Noneの場合はデフォルトプロンプト）
    llm_provider: str  # LLMプロバイダー（例：Google, OpenAI）
    llm_model_name: str  # LLMモデル名（例：gemini-2.5-flash, gpt-4）

class ExistingSummaryCheckResponse(BaseModel):
    """既存要約チェックレスポンス"""
    exists: bool  # 要約が既に存在するかどうか
    requires_regeneration: bool = False  # プロンプト更新により再生成が必要かどうか
    summary_type: Optional[str] = None  # 存在する場合の要約タイプ（default/custom）
    summary_id: Optional[int] = None  # 存在する場合の要約ID

# ★ 単一要約生成API用スキーマ
class SingleSummaryRequest(BaseModel):
    """単一要約生成リクエスト"""
    url: str  # arXiv URL
    system_prompt_id: Optional[int] = None  # Noneはデフォルトプロンプト
    create_embedding: bool = True  # ベクトル作成フラグ
    config_overrides: Optional[Dict[str, Any]] = None  # LLM設定上書き
    current_paper_index: int = 0  # 現在の論文インデックス（進捗表示用）
    total_papers: int = 1  # 総論文数（進捗表示用）
    current_summary_index: int = 0  # 現在の要約インデックス（進捗表示用）
    total_summaries: int = 1  # 総要約数（進捗表示用）
    is_first_summary_for_paper: bool = False  # 各論文の最初の要約処理かどうか（タグ生成用）

class SingleSummaryResponse(BaseModel):
    """単一要約生成レスポンス"""
    user_paper_link_id: int  # UserPaperLink ID
    paper_metadata_id: int  # PaperMetadata ID
    summary_id: Optional[int] = None  # GeneratedSummary ID（デフォルトプロンプト使用時）
    custom_summary_id: Optional[int] = None  # CustomGeneratedSummary ID（カスタムプロンプト使用時）
    vector_created: bool  # ベクトル作成済みフラグ
    processing_time: float  # 処理時間（秒）
    prompt_name: str  # 使用されたプロンプト名（進捗表示用）
    prompt_type: Literal["default", "custom"]  # プロンプトタイプ
    message: str = "Summary generated successfully"  # 処理結果メッセージ

# ★ 並列要約生成API用スキーマ
class MultipleSummaryRequest(BaseModel):
    """並列要約生成リクエスト（1論文に対して複数プロンプトで並列要約生成）"""
    url: str  # arXiv URL
    selected_prompts: List[PromptSelection]  # 選択されたプロンプト一覧
    create_embeddings: bool = True  # ベクトル作成フラグ
    embedding_target: Literal["default_only", "custom_only", "both", "none"]  # 埋め込みベクトル作成対象
    config_overrides: Optional[Dict[str, Any]] = None  # LLM設定上書き
    current_paper_index: int = 0  # 現在の論文インデックス（進捗表示用）
    total_papers: int = 1  # 総論文数（進捗表示用）

class SummaryResult(BaseModel):
    """個別要約結果"""
    summary_id: Optional[int] = None  # GeneratedSummary ID（デフォルトプロンプト使用時）
    custom_summary_id: Optional[int] = None  # CustomGeneratedSummary ID（カスタムプロンプト使用時）
    prompt_name: str  # 使用されたプロンプト名
    prompt_type: Literal["default", "custom"]  # プロンプトタイプ
    vector_created: bool  # ベクトル作成済みフラグ
    processing_time: float  # 処理時間（秒）
    error: Optional[str] = None  # エラーメッセージ（失敗時）

class MultipleSummaryResponse(BaseModel):
    """並列要約生成レスポンス"""
    user_paper_link_id: int  # UserPaperLink ID
    paper_metadata_id: int  # PaperMetadata ID
    summary_results: List[SummaryResult]  # 各要約の結果
    tags_created: bool  # タグが作成されたかどうか
    total_processing_time: float  # 総処理時間（秒）
    successful_summaries: int  # 成功した要約数
    failed_summaries: int  # 失敗した要約数
    message: str = "Multiple summaries generated"  # 処理結果メッセージ

class TagsExistenceRequest(BaseModel):
    """タグ存在チェックリクエスト"""
    urls: List[str]  # チェック対象のURL一覧

class TagsExistenceResponse(BaseModel):
    """タグ存在チェックレスポンス"""
    existing_tags: Dict[str, List[str]]  # URL -> タグ一覧のマッピング