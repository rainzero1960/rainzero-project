import os
import re
import io
import arxiv
import glob
import PyPDF2
import requests
import concurrent.futures
from bs4 import BeautifulSoup
from datetime import date, timedelta
from dotenv import load_dotenv
from typing import Optional, List
import yaml
import pathlib
import functools

# LangChain関連
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import (
    RunnableLambda,
    RunnableParallel,
    RunnablePassthrough,
)

from langchain_core.language_models.chat_models import BaseChatModel

# こちらは別ファイル「util.py」などから読み込む想定
# （CONFIG, initialize_llm, escape_curly_braces は実装済みとする）
from .module.util import CONFIG, initialize_llm, escape_curly_braces

# ★ 設定読み込み関数（config.yamlから特定用途のLLM設定を取得）
@functools.lru_cache(maxsize=1)
def _load_summary_cfg():
    cfg_path = pathlib.Path(__file__).parent.parent / "config.yaml"
    return yaml.safe_load(cfg_path.read_text())

def get_summary_specialized_llm_config(llm_type: str) -> dict:
    """config.yamlから特定用途のLLM設定を取得する
    
    Args:
        llm_type: "summary_fallback", "summary_default"
    
    Returns:
        dict: LLM設定辞書
    """
    cfg = _load_summary_cfg()
    specialized_settings = cfg.get("specialized_llm_settings", {})
    llm_config = specialized_settings.get(llm_type, {})
    
    # デフォルト値設定（config.yamlに設定がない場合のフォールバック）
    defaults = {
        "summary_fallback": {
            "provider": "Google",
            "model_name": "gemini-2.0-flash-001",
            "temperature": 0.7,
            "top_p": 1.0,
            "max_retries": 3
        },
        "summary_default": {
            "provider": "Google",
            "model_name": "gemini-2.0-flash",
            "temperature": 0.7,
            "top_p": 1.0,
            "max_retries": 3
        }
    }
    
    # デフォルト値とマージ
    default_config = defaults.get(llm_type, defaults["summary_fallback"])
    return {**default_config, **llm_config}
from .module.prompt_manager import (
    get_paper_summary_initial_prompt, 
    get_paper_summary_refinement_prompt, 
    get_paper_summary_second_stage_prompt,
    get_paper_summary_initial_prompt_with_character, # キャラクタープロンプト付き関数を追加
    get_paper_summary_initial_prompt_with_default_character, # デフォルトプロンプト+キャラクター関数を追加
    PromptType, # PromptType をインポート
    get_effective_prompt_raw # get_effective_prompt_raw をインポート
)
from typing import Optional, Dict, Any # Dict, Any をインポート
import logging
# ── ① 全体のログ設定（アプリ起動時に一度だけ実行） ──
logging.basicConfig(
    level=logging.INFO,                       # INFO 以上を拾う
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

import time

TRY_SECOND = False


###############################################################################
# パスやURL等の共通設定
###############################################################################
class SummariesPaths:
    """要約結果の保存先ディレクトリや、Hugging FaceのURLテンプレなどをまとめる。"""
    BASE_OUTPUT_DIR = "./summaries"
    HF_URL_TEMPLATE = "https://huggingface.co/papers?date={}"
    ARXIV_ID_PATTERN = r"\d{4}\.\d{5}"

    def __init__(self):
        os.makedirs(self.BASE_OUTPUT_DIR, exist_ok=True)


###############################################################################
# 論文情報をまとめるデータクラス
###############################################################################
class ArxivPaper:
    """arXiv論文のID、メタ情報、取得した本文、LLMによる要約などを保持する。"""
    def __init__(self, paper_id, title, abstract, url, content):
        self.paper_id = paper_id      # 例: '2502.17355'
        self.title = title
        self.abstract = abstract
        self.entry_url = url
        self.full_text = content      # HTML or PDF から抽出した本文
        self.generated_summary = ""   # 後からLLM要約結果を格納


###############################################################################
# arXiv ID の収集（Hugging Face or ユーザ指定ファイル）
###############################################################################
class ArxivIDCollector:
    """arXiv IDを取得するためのロジック。"""

    def __init__(self, config_override: Optional[Dict[str, Any]] = None):
        self.paths = SummariesPaths()
        self.current_config = {**CONFIG} # グローバル設定をコピー
        if config_override:
            self.current_config.update(config_override)

    def gather_hf_arxiv_ids(self) -> list[str]:
        """
        Hugging Face のサイトからarXiv IDをスクレイピングして返す。
        CONFIG内のフラグにより日付を指定するか、前日を使うか分岐。
        """
        # ★ self.current_config を参照するように変更
        use_custom_date = self.current_config.get("huggingface_use_config_date", False)
        target_date_str = ""

        if use_custom_date:
            custom_date = self.current_config.get("huggingface_custom_date", "")
            if not custom_date:
                print("[Error] カスタム日付が huggingface_custom_date で未設定です。")
                # ここでエラーを出すか、デフォルトの日付（例：前日）にフォールバックするか検討
                # 今回はエラーメッセージを出力し、前日にフォールバックする
                target_date_str = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
                print(f"[WARN] カスタム日付が未指定のため、前日の日付を使用します: {target_date_str}")
            else:
                target_date_str = custom_date
        else:
            target_date_str = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")

        print(f"[INFO] Hugging Face: 対象日付 => {target_date_str}")

        target_url = self.paths.HF_URL_TEMPLATE.format(target_date_str)
        found_ids = []
        try:
            # ★ requests にタイムアウトとリトライ処理を追加することを検討 (後述)
            resp = requests.get(target_url, timeout=10, allow_redirects=True) # タイムアウト設定
            resp.raise_for_status() # これで 4xx, 5xx エラー時に例外発生
            soup = BeautifulSoup(resp.content, "html.parser")
            all_articles = soup.find_all("article")
            for article_tag in all_articles:
                for anchor in article_tag.find_all("a"):
                    link_href = anchor.get("href")
                    if link_href and re.match(rf"^/papers/{self.paths.ARXIV_ID_PATTERN}$", link_href):
                        found_ids.append(link_href.split("/")[-1])
        except requests.exceptions.HTTPError as http_err:
            print(f"[Error] Hugging Faceページ取得中にHTTPエラーが発生: {http_err}")
            if http_err.response.status_code == 429:
                print("[Error Details] 429 Too Many Requests. しばらく待ってから再試行してください。")
            # 429エラーの場合は、リトライ処理を入れるか、エラーとして処理を中断する
            # ここではエラーとして空リストを返す
            return []
        except requests.exceptions.RequestException as exc:
            print(f"[Error] Hugging Faceページ取得中に問題が発生: {exc}")
            return [] # エラー時は空リストを返す

        unique_ids = list(set(found_ids))
        print(f"[INFO] Hugging Face: 取得した論文ID数 => {len(unique_ids)}")
        return unique_ids


    def gather_arxiv_ids_from_file(self, filepath: str) -> list[str]:
        """
        別途用意したテキストファイル内に書かれた
        `https://arxiv.org/abs/****.*****` の行から IDを抽出。
        """
        if not os.path.isfile(filepath):
            print(f"[Error] 指定ファイルが見つかりません: {filepath}")
            return []

        extracted_ids = []
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("https://arxiv.org/abs/"):
                    splitted = line.split("/")[-1]  # 最後のスラッシュ以降
                    if re.match(self.paths.ARXIV_ID_PATTERN, splitted):
                        extracted_ids.append(splitted)
                    else:
                        print(f"[WARN] フォーマットが想定外: {line}")
                else:
                    # 空行やコメント行など
                    pass

        return list(set(extracted_ids))


###############################################################################
# arXiv論文のHTML/PDFを取得して本文を抽出
###############################################################################
class ArxivPaperRetriever:
    """arXiv のメタ情報（タイトル, abstract）と HTML/PDF本文を取得。"""

    def __init__(self):
        self.arxiv_client = arxiv.Client()

    def get_paper_data(self, arxiv_id: str) -> ArxivPaper:
        # メタ情報(タイトル/アブストラクト等)の取得
        search = arxiv.Search(id_list=[arxiv_id])
        try:
            result = next(self.arxiv_client.results(search))
            meta_title = result.title
            meta_abstract = result.summary
            meta_url = result.entry_id
        except StopIteration:
            print(f"[Error] arXiv ID {arxiv_id} の情報が見つかりませんでした。")
            return ArxivPaper(arxiv_id, "N/A", "N/A", "", "")

        # HTMLまたはPDFから本文抽出
        raw_content = self.parse_html_or_pdf(arxiv_id)
        print(f"取得完了: {meta_title}")

        return ArxivPaper(arxiv_id, meta_title, meta_abstract, meta_url, raw_content)

    def parse_html_or_pdf(self, arxiv_id: str) -> str:
        """arXivのHTMLページを取得し、だめならPDFを取得してテキスト抽出。"""
        html_url = f"https://arxiv.org/html/{arxiv_id}"
        try:
            r = requests.get(html_url, allow_redirects=True)
            r.raise_for_status()
            text_got = self.parse_html_body(r.text)
            if text_got.strip():
                return text_got
            else:
                print(f"[Info] HTMLが空 => PDFから抽出: {arxiv_id}")
                return self.parse_pdf_content(arxiv_id)
        except requests.exceptions.RequestException as exc:
            print(f"[Warn] HTML取得失敗 => PDFへ切替: {exc}")
            return self.parse_pdf_content(arxiv_id)

    def parse_html_body(self, html_data: str) -> str:
        """HTMLをパースして不要タグ/行を削除し本文テキストだけ返す。"""
        soup = BeautifulSoup(html_data, "html.parser")
        for t in soup.find_all(["header", "nav", "footer", "script", "style"]):
            t.decompose()
        body = soup.body
        if not body:
            return ""

        joined_text = body.get_text(separator="\n", strip=True)
        lines = [ln.strip() for ln in joined_text.splitlines() if ln.strip()]

        filtered = []
        for l in lines:
            lower = l.lower()
            if "@" in lower:
                continue
            skip_words = ["university", "lab", "department", "institute", "corresponding author"]
            if any(sw in lower for sw in skip_words):
                continue
            filtered.append(l)

        return "\n".join(filtered)

    def parse_pdf_content(self, arxiv_id: str) -> str:
        """PDFをダウンロードしてPyPDF2でテキスト抽出。"""
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"
        try:
            resp = requests.get(pdf_url, allow_redirects=True)
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"[Error] PDFを取得できませんでした: {e}")
            return ""

        text_all = ""
        try:
            with io.BytesIO(resp.content) as pdf_bin:
                pdf_reader = PyPDF2.PdfReader(pdf_bin)
                for page in pdf_reader.pages:
                    text_all += page.extract_text() + "\n"
        except Exception as ex:
            print(f"[Error] PDF解析に失敗しました: {ex}")
            return ""

        return text_all


###############################################################################
# LLM要約器
###############################################################################
class SummarizerLLM:
    """LangChain で定義した LLM を使って要約を実行する。"""

    def __init__(self, llm_config: Optional[dict] = None, db_session=None, user_id=None, force_default_prompt: bool = False, system_prompt_id: Optional[str] = None):
        current_config = {**CONFIG} # グローバルをコピー
        if llm_config:
            current_config.update(llm_config)

        # ★ プライマリLLM情報を保持
        self.primary_llm_provider = current_config["llm_name"]
        self.primary_llm_model = current_config["llm_model_name"]

        self.llm_instance = initialize_llm(
            name=self.primary_llm_provider,
            model_name=self.primary_llm_model,
            temperature=current_config["rag_llm_temperature"],
            top_p=current_config["rag_llm_top_p"],
            llm_max_retries=current_config["llm_max_retries"]
        )

        self.llm_instance_error = initialize_llm(
            name=self.primary_llm_provider,
            model_name=self.primary_llm_model,
            temperature=0.7,
            llm_max_retries=current_config["llm_max_retries"]
        )

        # ★ フォールバックLLM初期化（グローバル変数使用）
        # フォールバックLLM設定をconfig.yamlから取得
        fallback_config = get_summary_specialized_llm_config("summary_fallback")
        self.llm_instance_roleback = initialize_llm(
            name=fallback_config["provider"],
            model_name=fallback_config["model_name"],
            temperature=current_config["rag_llm_temperature"],
            top_p=current_config["rag_llm_top_p"],
            llm_max_retries=current_config["llm_max_retries"]
        )

        # フォールバックに切り替える失敗回数の閾値
        self.fail_threshold = current_config.get("llm_initial_fail_threshold", 3)
        # フォールバック後のリトライ回数
        self.fallback_max_retries = current_config.get("llm_fallback_max_retries", 3)
        
        # プロンプト管理用のDB接続情報を保存
        self.db_session = db_session
        self.user_id = user_id
        self.force_default_prompt = force_default_prompt
        
        self.is_using_custom_initial_prompt = False
        self.system_prompt_id = system_prompt_id
        
        if self.db_session and self.user_id and not force_default_prompt:
            try:
                prompt_info = get_effective_prompt_raw(self.db_session, PromptType.PAPER_SUMMARY_INITIAL, self.user_id, self.system_prompt_id)
                self.is_using_custom_initial_prompt = prompt_info.get("is_custom", False)
                self.system_prompt_id = prompt_info.get("metadata", {}).get("id")
                logger.info(f"初期要約プロンプトのカスタム状態: {self.is_using_custom_initial_prompt}, プロンプトID: {self.system_prompt_id} (ユーザーID: {self.user_id})")
            except Exception as e:
                logger.error(f"初期要約プロンプトのカスタム状態確認中にエラー (ユーザーID: {self.user_id}): {e}")
        elif force_default_prompt:
            logger.info(f"デフォルトプロンプトを強制使用 (ユーザーID: {self.user_id})")


    def _build_summary_chain(self, llm_instance_to_use: BaseChatModel, db_session=None, user_id=None, character_override=None, affinity_level=0):
        """指定されたLLMインスタンスを使って要約チェーンを構築するヘルパーメソッド。"""
        # 動的プロンプト取得（初期要約用）
        try:
            # force_default_promptが有効な場合は、カスタムプロンプトを無視してデフォルト+キャラクターを使用
            if self.force_default_prompt:
                logger.info(f"デフォルトプロンプト+キャラクタープロンプトを強制使用します（ユーザーID: {user_id}, キャラクター: {character_override}）")
                system_prompt1 = get_paper_summary_initial_prompt_with_default_character(
                    db_session, user_id, force_default_prompt=True, 
                    affinity_level=affinity_level, character_override=character_override
                )
                logger.info(f"デフォルト論文要約プロンプト（キャラクター付き）を取得しました（ユーザーID: {user_id}）")
            elif db_session and user_id and self.system_prompt_id:
                system_prompt1 = get_paper_summary_initial_prompt_with_character(
                    db_session, user_id, affinity_level=affinity_level, 
                    character_override=character_override, system_prompt_id=self.system_prompt_id
                )
                logger.info(f"論文要約カスタムプロンプト（キャラクター付き）を動的取得しました（ユーザーID: {user_id}, プロンプトID: {self.system_prompt_id}）")
            elif db_session and user_id:
                system_prompt1 = get_paper_summary_initial_prompt_with_character(
                    db_session, user_id, affinity_level=affinity_level, character_override=character_override
                )
                logger.info(f"論文要約初期プロンプト（キャラクター付き）を動的取得しました（ユーザーID: {user_id}）")
            else:
                raise Exception("db_session または user_id が提供されていません")
        except Exception as e:
            if not self.force_default_prompt:
                logger.error(f"論文要約初期プロンプトの取得に失敗しました: {e}")
                logger.warning("デフォルトのハードコードされた論文要約プロンプトにフォールバックします")
            # フォールバック用のデフォルトプロンプト
            system_prompt1 = """## 論文タイトル（原文まま）
## 一言でいうと
### 論文リンク
### 著者/所属機関
### 投稿日付(yyyy/MM/dd)

## 概要
### abustractの日本語訳（原文ままで翻訳）


## 先行研究と比べてどこがすごい？

## 技術や手法の面白いポイントはどこ？

## なぜその技術が必要なの？

## どうやって有効だと検証した？

## 議論はある？

## 結果について詳細に

## 次に読むべき論文は？

## コメント

## 手法の詳細（数式や理論展開など）

上記のテンプレートに合うようにまとめて表示してください。
マークダウン記法をコードブロックで括って表示してください。
わからない部分はわからないと記載してくれれば良いです。
記載は詳細に、かつ、全て日本語で記載してください。
全体的に、論文の内容を詳細かつわかりやすさを重視して解説してください。冗長であっても良いので、非専門家が読んでも理解できるように解説をするようにしてください。

数式の書き方は重要です。
文章中の数式は$一つで囲ってください。数式の中で、テキストとして「_」を利用したい場合は「\\_」を利用してください。
例えば、$\\mathcal{{G}} = \\{{G_i: \\boldsymbol{{\\mu}}_i, \\boldsymbol{{r}}_i, \\boldsymbol{{s}}_i, \\sigma_i, \\boldsymbol{{h}}_i\\}}_{{i=1}}^N$や$A = \\{{\\, i \\mid \\text{{noise\\_level\\_of\\_frame}}_{{i}}=t \\,\\}}$などです
一方で、数式ブロックは$$で囲んでください
例えば、
$$
\\boldsymbol{{I}} = \\sum_{{i=1}}^N T_i \\alpha_i^{{2D}} \\mathcal{{SH}}(\\boldsymbol{{h}}_i, \\boldsymbol{{v}}_i)\\
$$
や、
$$
\\mathcal{{L}}_{{\\text{{DM}}}}=\\mathbb{{E}}_{{t\\sim\\mathcal{{U}}(0,1),\\,\\boldsymbol{{\\epsilon}}\\sim\\mathcal{{N}}(\\mathbf{{0}},\\mathbf{{I}})}}\\left[\\bigl\\{{\\boldsymbol{{\\epsilon}}_{{\\theta}}(\\mathbf{{x}}_{{t}},t)-\\boldsymbol{{\\epsilon}}\\bigr\\}}_{{2}}^{{2}}\\right] \\quad (5)\\
$$
などです。
加えて重要なこととして、標準コマンドとして利用可能な数学記法を使用してください。また、「{{」や「}}」の個数がちゃんと合っているかどうかも確認してください。
特に、数式に関してはただ数式を記載するのではなく、その数式が何を表しているのか、どのような意味を持つのかを説明してください。

また、論文の内容において、下記の質問に対して回答してください。
・本論文を読む上での前提知識や専門用語を解説してください。論文中には記載されていない前提知識を優先して数式を交えながらわかりやすく解説してください。
・結局論文は何が新規性として主張しているのかを、研究者が納得できるように解説してください。
・技術的な詳細を教えてください、研究者が納得できるように詳細に解説してください。
・論文を150文字で要約してください。"""
        # 動的プロンプト取得（修正用）
        try:
            if db_session and user_id:
                system_prompt2 = get_paper_summary_refinement_prompt(db_session, user_id)
                logger.info(f"論文要約修正プロンプトを動的取得しました（ユーザーID: {user_id}）")
            else:
                raise Exception("db_session または user_id が提供されていません")
        except Exception as e:
            logger.error(f"論文要約修正プロンプトの取得に失敗しました: {e}")
            logger.warning("デフォルトのハードコードされた論文要約修正プロンプトにフォールバックします")
            # フォールバック用のデフォルトプロンプト
            system_prompt2 = """
以下に、論文の文章全文と、そこからLLMにより要約された文章を示します。
要約文章の段落・構成はそのままに、記載されている文章の内容が、正しいかどうか、すべて適切に述べられているかどうか判断し、再度書き直してください。
下記フォーマットに従って書き直してください。

----

## 論文タイトル（原文まま）
## 一言でいうと
### 論文リンク
### 著者/所属機関
### 投稿日付(yyyy/MM/dd)

## 概要
### abustractの日本語訳（原文ままで翻訳）


## 先行研究と比べてどこがすごい？

## 技術や手法の面白いポイントはどこ？

## なぜその技術が必要なの？

## どうやって有効だと検証した？

## 議論はある？

## 結果について詳細に

## 次に読むべき論文は？

## コメント

## 手法の詳細（数式や理論展開など）

上記のテンプレートに合うようにまとめて表示してください。
マークダウン記法をコードブロックで括って表示してください。
わからない部分はわからないと記載してくれれば良いです。
記載は詳細に、かつ、全て日本語で記載してください。
全体的に、論文の内容を詳細かつわかりやすさを重視して解説してください。冗長であっても良いので、非専門家が読んでも理解できるように解説をするようにしてください。

数式の書き方は重要です。
文章中の数式は$一つで囲ってください。数式の中で、テキストとして「_」を利用したい場合は「\\_」を利用してください。
例えば、$\\mathcal{{G}} = \\{{G_i: \boldsymbol{{\\mu}}_i, \\boldsymbol{{r}}_i, \\boldsymbol{{s}}_i, \\sigma_i, \\boldsymbol{{h}}_i\\}}_{{i=1}}^N$や$A = \\{{\\, i \\mid \\text{{noise\\_level\\_of\\_frame}}_{{i}}=t \\,\\}}$などです
一方で、数式ブロックは$$で囲んでください
例えば、
$$
\\boldsymbol{{I}} = \\sum_{{i=1}}^N T_i \\alpha_i^{{2D}} \\mathcal{{SH}}(\\boldsymbol{{h}}_i, \\boldsymbol{{v}}_i)\\
$$
や、
$$
\\mathcal{{L}}_{{\\text{{DM}}}}=\\mathbb{{E}}_{{t\\sim\\mathcal{{U}}(0,1),\\,\\boldsymbol{{\\epsilon}}\\sim\\mathcal{{N}}(\\mathbf{{0}},\\mathbf{{I}})}}\\left[\\bigl\\{{\\boldsymbol{{\\epsilon}}_{{\\theta}}(\\mathbf{{x}}_{{t}},t)-\\boldsymbol{{\\epsilon}}\\bigr\\}}_{{2}}^{{2}}\\right] \\quad (5)\\
$$
などです。
加えて重要なこととして、標準コマンドとして利用可能な数学記法を使用してください。また、「{{」や「}}」の個数がちゃんと合っているかどうかも確認してください。
特に、数式に関してはただ数式を記載するのではなく、その数式が何を表しているのか、どのような意味を持つのかを説明してください。

また、論文の内容において、下記の質問に対して回答してください。
・結局論文は何が新規性として主張しているのかを、研究者が納得できるように解説してください。
・技術的な詳細を教えてください、研究者が納得できるように詳細に解説してください。
・論文を150文字で要約してください。

----

特に、数式が適切に表示されるようにルール通りに記載されているかどうか、
論文ないの技術の説明において、特殊な用語や特徴的な用語に関しては別途説明されているかどうか
特に、数式に関してはただ数式を記載するのではなく、その数式が何を表しているのか、どのような意味を持つのかを説明してください。

では、指定のフォーマットに従って書き直してください。
"""

        # 動的プロンプト取得（2段階目ユーザープロンプト）
        try:
            if db_session and user_id:
                user_prompt_stage2 = get_paper_summary_second_stage_prompt(db_session, user_id, documents="{documents}", summary="{summary}")
                logger.info(f"論文要約2段階目ユーザープロンプトを動的取得しました（ユーザーID: {user_id}）")
            else:
                raise Exception("db_session または user_id が提供されていません")
        except Exception as e:
            logger.error(f"論文要約2段階目ユーザープロンプトの取得に失敗しました: {e}")
            logger.warning("デフォルトのハードコードされた2段階目ユーザープロンプトにフォールバックします")
            # フォールバック用のデフォルトプロンプト
            user_prompt_stage2 = """# 論文のドキュメント全文
{documents}

# 要約文章
{summary}

# 指示
指定のフォーマットに従って書き直してください。
"""

        prompt1 = ChatPromptTemplate.from_messages([
            ("system", system_prompt1),
            ("user", "{documents}"),
        ])
        # llm_instance_to_use が BaseChatModel を継承していることを期待
        chain1 = prompt1 | llm_instance_to_use

        prompt2 = ChatPromptTemplate.from_messages([
            ("system", system_prompt2), # システムプロンプトは修正用を使う
            ("user", user_prompt_stage2),
        ])
        # llm_instance_to_use が BaseChatModel を継承していることを期待
        chain2 = prompt2 | llm_instance_to_use # ここも引数のLLMを使う

        # 2段階のチェーンを構築
        if TRY_SECOND:
            summary_chain = (
                RunnableParallel(
                    {
                        "documents": RunnablePassthrough(), # 入力テキストをそのまま渡す
                        "summary": chain1 | StrOutputParser(),                 # ステージ1: 初期要約
                    }
                )
                | chain2 # ステージ2: 要約の修正
            )
        else:
            print("[INFO] 2段階目の要約チェーンは無効化されています。")
            return chain1 # 2段階目を使わない場合は、最初のチェーンだけを返す
        return summary_chain

    async def _execute_llm_with_retry(
        self, 
        safe_text: str, 
        character_override: str = None, 
        affinity_level: int = 0
    ) -> tuple[str, dict]:
        """
        LLMへのリクエストを3回リトライ + フォールバック処理で実行する共通関数
        
        Args:
            safe_text: エスケープ済みのテキスト
            character_override: キャラクター設定（Noneの場合はユーザー設定、空文字列でキャラなし）
            affinity_level: 好感度レベル
            
        Returns:
            tuple[str, dict]: (要約テキスト, LLM情報)
        """
        primary_failed_count = 0
        
        # --- プライマリLLMでの試行 ---
        primary_chain = self._build_summary_chain(
            self.llm_instance, self.db_session, self.user_id, 
            character_override=character_override, affinity_level=affinity_level
        )
        error_primary_chain = self._build_summary_chain(
            self.llm_instance_error, self.db_session, self.user_id,
            character_override=character_override, affinity_level=affinity_level
        )
        
        print(f"[INFO] プライマリLLM ({self.primary_llm_model}) で要約処理開始...")

        while primary_failed_count < self.fail_threshold:
            try:
                response = None
                if primary_failed_count > 0:
                    print(f"[INFO] プライマリLLM要約処理再試行中... (attempt {primary_failed_count + 1}/{self.fail_threshold})")
                    # エラー時はエラーハンドリング用のチェーンを使用
                    response = await error_primary_chain.ainvoke({"documents": safe_text})
                else:
                    # 最初の試行は通常のチェーンを使用
                    print(f"[INFO] プライマリLLM要約処理中... (attempt {primary_failed_count + 1}/{self.fail_threshold})")
                    response = await primary_chain.ainvoke({"documents": safe_text})
                
                print(f"[INFO] 出力結果: {len(response.content)} 文字")
                if not response or len(response.content) < 10:
                    print(f"[WARN] 要約結果が空または短すぎます。再試行します。{response}")
                    raise ValueError("要約結果が空または短すぎます。再試行します。")
                
                print(f"[INFO] プライマリLLM要約処理成功 (attempt {primary_failed_count + 1}/{self.fail_threshold})")
                
                # プライマリLLM成功時の情報を返す
                llm_info = {
                    "provider": self.primary_llm_provider,
                    "model_name": self.primary_llm_model,
                    "used_fallback": False
                }
                
                # キャラクター情報を追加
                if character_override is not None:
                    if character_override == "":
                        llm_info["character_role"] = None
                    else:
                        llm_info["character_role"] = character_override
                    llm_info["affinity_level"] = affinity_level
                
                return response.content, llm_info
                
            except Exception as e:
                primary_failed_count += 1
                print(f"[WARN] プライマリLLM要約中にエラー発生 (attempt {primary_failed_count}/{self.fail_threshold}): {e}")
                if primary_failed_count < self.fail_threshold:
                    print(f"[INFO] 少し待機してリトライします...")
                    import asyncio
                    await asyncio.sleep(2) # 非同期バックオフ待機

        # --- フォールバックLLMでの試行 ---
        fallback_config = get_summary_specialized_llm_config("summary_fallback")
        print(f"[WARN] プライマリLLMでの処理が {self.fail_threshold} 回失敗。フォールバックLLM ({fallback_config['model_name']}) に切り替えます。")
        
        fallback_chain = self._build_summary_chain(
            self.llm_instance_roleback, self.db_session, self.user_id,
            character_override=character_override, affinity_level=affinity_level
        )
        fallback_attempt = 0

        while fallback_attempt < self.fallback_max_retries:
            try:
                print(f"[INFO] フォールバックLLM要約処理中... (attempt {fallback_attempt + 1}/{self.fallback_max_retries})")
                response = await fallback_chain.ainvoke({"documents": safe_text})
                
                if not response or len(response.content) < 10:
                    print(f"[WARN] フォールバック要約結果が空または短すぎます。再試行します。{response}")
                    raise ValueError("フォールバック要約結果が空または短すぎます。")
                
                print(f"[INFO] フォールバックLLM要約処理成功 (attempt {fallback_attempt + 1}/{self.fallback_max_retries})")
                
                # フォールバックLLM成功時の情報を返す
                llm_info = {
                    "provider": fallback_config["provider"],
                    "model_name": fallback_config["model_name"],
                    "used_fallback": True
                }
                
                # キャラクター情報を追加
                if character_override is not None:
                    if character_override == "":
                        llm_info["character_role"] = None
                    else:
                        llm_info["character_role"] = character_override
                    llm_info["affinity_level"] = affinity_level
                
                return response.content, llm_info
                
            except Exception as e:
                fallback_attempt += 1
                print(f"[WARN] フォールバックLLM要約中にエラー発生 (attempt {fallback_attempt}/{self.fallback_max_retries}): {e}")
                if fallback_attempt < self.fallback_max_retries:
                    print(f"[INFO] 少し待機してリトライします...")
                    import asyncio
                    await asyncio.sleep(2) # 非同期バックオフ待機

        # すべてのリトライが失敗した場合
        total_attempts = self.fail_threshold + self.fallback_max_retries
        print(f"[ERROR] プライマリおよびフォールバックLLMでの要約処理が合計 {total_attempts} 回失敗しました。")
        
        # 失敗時もフォールバック情報を返す（最後に試行したLLM情報）
        error_llm_info = {
            "provider": fallback_config["provider"],
            "model_name": fallback_config["model_name"],
            "used_fallback": True
        }
        
        # キャラクター情報を追加
        if character_override is not None:
            if character_override == "":
                error_llm_info["character_role"] = None
            else:
                error_llm_info["character_role"] = character_override
            error_llm_info["affinity_level"] = affinity_level
        
        raise Exception(f"全ての要約処理が失敗しました（合計 {total_attempts} 回試行）")

    async def produce_summary(self, text_to_summarize: str) -> tuple[str, dict]:
        """テキストをLLMに渡して要約。プライマリLLMで失敗した場合、フォールバックLLMを使用する。
        ★★★ 非同期化：FastAPIブロッキング解消 ★★★
        
        Returns:
            tuple[str, dict]: (要約テキスト, 使用されたLLM情報)
            LLM情報は以下の形式: {"provider": str, "model_name": str, "used_fallback": bool}
        """
        safe_text = escape_curly_braces(text_to_summarize)
        print(f"[INFO] 要約対象のテキスト長: {len(safe_text)} 文字")
        primary_failed_count = 0

        # --- プライマリLLMでの試行 ---
        primary_chain = self._build_summary_chain(self.llm_instance, self.db_session, self.user_id)
        error_primaly_chain = self._build_summary_chain(self.llm_instance_error, self.db_session, self.user_id)
        print(f"[INFO] プライマリLLM ({self.primary_llm_model}) で要約処理開始...")

        while primary_failed_count < self.fail_threshold:
            try:
                response = None
                if primary_failed_count > 0:
                    print(f"[INFO] プライマリLLM要約処理再試行中0.7... (attempt {primary_failed_count + 1}/{self.fail_threshold})")
                    # エラー時はエラーハンドリング用のチェーンを使用
                    response = await error_primaly_chain.ainvoke({"documents": safe_text})
                else:
                    # 最初の試行は通常のチェーンを使用
                    print(f"[INFO] プライマリLLM要約処理中... (attempt {primary_failed_count + 1}/{self.fail_threshold})")
                    response = await primary_chain.ainvoke({"documents": safe_text})
                print(f"[INFO] TRY SECOND = {TRY_SECOND}")
                print(f"[INFO] 出力結果: {len(response.content)} 文字")
                if not response or len(response.content) < 10:
                    print(f"[WARN] 要約結果が空または短すぎます。再試行します。{response}")
                    raise ValueError("要約結果が空または短すぎます。再試行します。")
                print(f"[INFO] プライマリLLM要約処理成功 (attempt {primary_failed_count + 1}/{self.fail_threshold})")
                # プライマリLLM成功時の情報を返す
                llm_info = {
                    "provider": self.primary_llm_provider,
                    "model_name": self.primary_llm_model,
                    "used_fallback": False
                }
                return response.content, llm_info
            except Exception as e:
                primary_failed_count += 1
                print(f"[WARN] プライマリLLM要約中にエラー発生 (attempt {primary_failed_count}/{self.fail_threshold}): {e}")
                if primary_failed_count < self.fail_threshold:
                    print(f"[INFO] 少し待機してリトライします...")
                    import asyncio
                    await asyncio.sleep(2) # 非同期バックオフ待機

        # --- フォールバックLLMでの試行 ---
        fallback_config = get_summary_specialized_llm_config("summary_fallback")
        print(f"[WARN] プライマリLLMでの処理が {self.fail_threshold} 回失敗。フォールバックLLM ({fallback_config['model_name']}) に切り替えます。")
        fallback_chain = self._build_summary_chain(self.llm_instance_roleback, self.db_session, self.user_id)
        fallback_attempt = 0

        while fallback_attempt < self.fallback_max_retries:
            try:
                print(f"[INFO] フォールバックLLM要約処理中... (attempt {fallback_attempt + 1}/{self.fallback_max_retries})")
                response = await fallback_chain.ainvoke({"documents": safe_text})
                print(f"[INFO] フォールバックLLM要約処理成功 (attempt {fallback_attempt + 1}/{self.fallback_max_retries})")
                # フォールバックLLM成功時の情報を返す
                llm_info = {
                    "provider": fallback_config["provider"],
                    "model_name": fallback_config["model_name"],
                    "used_fallback": True
                }
                return response.content, llm_info
            except Exception as e:
                fallback_attempt += 1
                print(f"[WARN] フォールバックLLM要約中にエラー発生 (attempt {fallback_attempt}/{self.fallback_max_retries}): {e}")
                if fallback_attempt < self.fallback_max_retries:
                    print(f"[INFO] 少し待機してリトライします...")
                    await asyncio.sleep(2) # 非同期バックオフ待機

        # すべてのリトライが失敗した場合
        total_attempts = self.fail_threshold + self.fallback_max_retries
        print(f"[ERROR] プライマリおよびフォールバックLLMでの要約処理が合計 {total_attempts} 回失敗しました。")
        # 失敗時もフォールバック情報を返す（最後に試行したLLM情報）
        # フォールバック設定を再取得（スコープが異なるため）
        fallback_config = get_summary_specialized_llm_config("summary_fallback")
        llm_info = {
            "provider": fallback_config["provider"],
            "model_name": fallback_config["model_name"],
            "used_fallback": True
        }
        return "LLMの要約処理に失敗しました。", llm_info

    async def produce_dual_summaries(self, text_to_summarize: str, affinity_level: int = 0) -> tuple[tuple[str, dict], tuple[str, dict]]:
        """
        キャラクターなし/ありの2つの要約を並列生成します。
        
        Args:
            text_to_summarize (str): 要約対象のテキスト
            affinity_level (int): 好感度レベル（0=デフォルト、1-4=高いレベル）
            
        Returns:
            tuple[tuple[str, dict], tuple[str, dict]]: 
                ((キャラクターなし要約, LLM情報), (キャラクターあり要約, LLM情報))
        """
        import asyncio
        
        safe_text = escape_curly_braces(text_to_summarize)
        print(f"[INFO] 2種類の要約を並列生成開始: テキスト長 {len(safe_text)} 文字, 好感度レベル {affinity_level}")
        
        # ユーザーが選択したキャラクターを取得
        selected_character = None
        if self.db_session and self.user_id:
            try:
                from models import User
                from sqlmodel import select
                user = self.db_session.exec(select(User).where(User.id == self.user_id)).first()
                if user and user.selected_character:
                    selected_character = user.selected_character
                    print(f"[INFO] ユーザー選択キャラクター: {selected_character}")
            except Exception as e:
                logger.error(f"ユーザーキャラクター取得エラー: {e}")
        
        async def generate_summary_without_character():
            """キャラクターなしの要約生成"""
            print("[INFO] キャラクターなし要約生成開始...")
            # 共通のリトライロジック関数を使用（キャラクターを明示的に空文字列に設定）
            return await self._execute_llm_with_retry(safe_text, character_override="", affinity_level=affinity_level)
        
        async def generate_summary_with_character():
            """キャラクターありの要約生成"""
            print(f"[INFO] キャラクターあり要約生成開始... (キャラクター: {selected_character})")
            # 共通のリトライロジック関数を使用（ユーザーが選択したキャラクター設定）
            return await self._execute_llm_with_retry(safe_text, character_override=selected_character, affinity_level=affinity_level)
        
        # 並列実行
        try:
            results = await asyncio.gather(
                generate_summary_without_character(),
                generate_summary_with_character(),
                return_exceptions=True
            )
            
            # エラーハンドリング
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    summary_type = "キャラクターなし" if i == 0 else "キャラクターあり"
                    print(f"[ERROR] {summary_type}要約生成が失敗しました: {result}")
                    raise result
            
            summary_without_char, summary_with_char = results
            print(f"[INFO] 2種類の要約並列生成完了")
            
            return summary_without_char, summary_with_char
            
        except Exception as e:
            print(f"[ERROR] 並列要約生成中にエラーが発生しました: {e}")
            raise

    async def produce_summary_without_character(self, text_to_summarize: str) -> tuple[str, dict]:
        """キャラクターなしの要約を生成します。
        
        Args:
            text_to_summarize (str): 要約対象のテキスト
            
        Returns:
            tuple[str, dict]: (要約テキスト, LLM情報)
        """
        safe_text = escape_curly_braces(text_to_summarize)
        print(f"[INFO] キャラクターなし要約生成開始: テキスト長 {len(safe_text)} 文字")
        
        # 共通のリトライロジック関数を使用（キャラクターを明示的に空文字列に設定）
        return await self._execute_llm_with_retry(safe_text, character_override="", affinity_level=0)

    async def produce_summary_with_character(self, text_to_summarize: str, affinity_level: int = 0) -> tuple[str, dict]:
        """キャラクターありの要約を生成します。
        
        Args:
            text_to_summarize (str): 要約対象のテキスト
            affinity_level (int): 好感度レベル（0=デフォルト、1-4=高いレベル）
            
        Returns:
            tuple[str, dict]: (要約テキスト, LLM情報)
        """
        safe_text = escape_curly_braces(text_to_summarize)
        print(f"[INFO] キャラクターあり要約生成開始: テキスト長 {len(safe_text)} 文字, 好感度レベル {affinity_level}")
        
        # ユーザーが選択したキャラクターを取得
        selected_character = None
        if self.db_session and self.user_id:
            try:
                from models import User
                from sqlmodel import select
                user = self.db_session.exec(select(User).where(User.id == self.user_id)).first()
                if user and user.selected_character:
                    selected_character = user.selected_character
                    print(f"[INFO] ユーザー選択キャラクター: {selected_character}")
            except Exception as e:
                logger.error(f"ユーザーキャラクター取得エラー: {e}")
        
        # 共通のリトライロジック関数を使用（ユーザーが選択したキャラクター設定）
        return await self._execute_llm_with_retry(safe_text, character_override=selected_character, affinity_level=affinity_level)


###############################################################################
# 全体のオーケストレーション
###############################################################################
class SummariesOrchestrator:
    """
    - CONFIG["mode"] に応じて: 
        * "hugging_face" => HuggingFaceサイトからarXiv ID収集
        * "arxiv_list"   => 指定ファイルからarXiv ID収集
    - 収集したarXiv IDごとに本文取得 + LLM要約
    - モードごとにフォルダ分けして結果を保存
    """

    def __init__(self):
        self.collector = ArxivIDCollector()
        self.retriever = ArxivPaperRetriever()
        self.summarizer = SummarizerLLM()

    def orchestrate(self):
        # 1) モード判定
        current_mode = CONFIG.get("mode", "hugging_face")
        if current_mode == "hugging_face":
            list_of_arxiv_ids = self.collector.gather_hf_arxiv_ids()
            subfolder = "hf_docs"
        elif current_mode == "arxiv_list":
            file_list = CONFIG.get("arxiv_list_file", "arxiv_list.txt")
            list_of_arxiv_ids = self.collector.gather_arxiv_ids_from_file(file_list)
            subfolder = "user_docs"
        else:
            print(f"[Error] 不明なモード: {current_mode}")
            return

        print(f"[INFO] 取得したarXiv ID数 => {len(list_of_arxiv_ids)}")
        if not list_of_arxiv_ids:
            print("[WARN] arXiv IDが1件も得られませんでした。処理終了。")
            return

        # 2) 論文情報を取得 & 要約 (並列化)
        paper_objects = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            jobs = {
                executor.submit(self._retrieve_and_summarize, arxiv_id, i): arxiv_id
                for i, arxiv_id in enumerate(list_of_arxiv_ids, start=1)
            }
            for future in concurrent.futures.as_completed(jobs):
                doc_id = jobs[future]
                try:
                    paper_obj = future.result()
                    paper_objects.append(paper_obj)
                except Exception as e:
                    print(f"[Error] 論文処理中に例外: {doc_id} => {e}")

        # 3) 保存
        self._store_outcome(paper_objects, subfolder)

    def _retrieve_and_summarize(self, arxiv_id: str, index: int) -> ArxivPaper:
        print(f"({index}) ID={arxiv_id} のデータ取得開始...")
        info_obj = self.retriever.get_paper_data(arxiv_id)

        # 先頭2000文字を1つの文字列にまとめて LLM要約を呼び出す
        combined_data = (
            f"Title: {info_obj.title}\n\n"
            f"Abstract: {info_obj.abstract}\n\n"
            f"Body: {info_obj.full_text[:100000]}\n"
        )
        summary_result, llm_info = self.summarizer.produce_summary(combined_data)
        info_obj.generated_summary = summary_result
        return info_obj

    def _store_outcome(self, collection_of_papers: list[ArxivPaper], subfolder: str):
        """
        取得した論文群を保存する。
        - 要約結果は従来どおり summaries/ 以下に
        - 新たに body/ フォルダを作成して combined_data を保存
        - これらのフォルダを大きく papers/ フォルダを作って配置
        - ファイル名は id_title の形で、タイトルに含まれる不正文字や空白を置換
        """
        # 1) 日付ベースのサブフォルダ名を用意
        today_str = date.today().strftime("%Y-%m-%d")

        if subfolder == "hf_docs":
            # Hugging Face 用の日付ロジック
            if CONFIG.get("huggingface_use_config_date", False):
                target_date = CONFIG["huggingface_custom_date"]
            else:
                target_date = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            # arxiv_list 用
            target_date = today_str

        # 2) "papers" フォルダの下に、引数 subfolder + 日付フォルダをまとめて作成
        papers_base_dir = "./outputs/papers"  # 大きいフォルダ
        output_dir_for_today = os.path.join(papers_base_dir, subfolder, target_date)

        # 3) その下に summaries フォルダと body フォルダを作成
        summaries_dir = os.path.join(output_dir_for_today, "summaries")
        body_dir = os.path.join(output_dir_for_today, "body")
        os.makedirs(summaries_dir, exist_ok=True)
        os.makedirs(body_dir, exist_ok=True)

        # 4) 論文ごとにファイルを作成して保存
        for paper in collection_of_papers:
            # -------------------------
            # (A) ファイル名を "id_title.md" にするための整形処理
            # -------------------------
            # 1) タイトル中のファイル名に使えない文字を除去
            sanitized_title = re.sub(r'[\\/:*?"<>|]', '', paper.title)
            # 2) 前後の空白を取り除き、空白文字を全て'_'に置換
            sanitized_title = sanitized_title.strip()
            sanitized_title = re.sub(r'\s+', '_', sanitized_title)
            # 3) arXiv ID と整形済みタイトルを組み合わせたファイル名を作成
            combined_filename = f"{paper.paper_id}_{sanitized_title}.md"

            # -------------------------
            # (B) 要約結果の保存 (従来通り)
            # -------------------------
            summary_outpath = os.path.join(summaries_dir, combined_filename)
            content_for_file = (
                f"# {paper.title}\n\n"
                f"[View Paper]({paper.entry_url})\n\n"
                f"## Abstract\n{paper.abstract}\n\n"
                f"## Summary by LLM\n{paper.generated_summary}\n"
            )
            with open(summary_outpath, "w", encoding="utf-8") as f:
                f.write(content_for_file)

            # -------------------------
            # (C) 論文本文(combined_data)の保存
            # -------------------------
            body_outpath = os.path.join(body_dir, combined_filename)
            combined_data = (
                f"Title: {paper.title}\n\n"
                f"Abstract: {paper.abstract}\n\n"
                f"Body: {paper.full_text}\n"
            )
            with open(body_outpath, "w", encoding="utf-8") as f:
                f.write(combined_data)

        print(f"[INFO] 要約結果と本文を保存しました => {output_dir_for_today}")



###############################################################################
# 実行スクリプト
###############################################################################
if __name__ == "__main__":
    orchestrator = SummariesOrchestrator()
    orchestrator.orchestrate()