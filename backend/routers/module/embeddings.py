from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
import yaml
from pathlib import Path

# 直接 backend/config.yaml を読む
_cfg_path = Path(__file__).parent.parent.parent / "config.yaml"
_cfg      = yaml.safe_load(_cfg_path.read_text(encoding="utf-8")).get("vector_store", {})

if _cfg.get("provider", "Google") != "Google":
    raise NotImplementedError(f"Unsupported embedding provider: {_cfg.get('provider')}")

try:
    EMBED = GoogleGenerativeAIEmbeddings(
        model=_cfg.get("embedding_model", "models/text-embedding-004")
    )
    print("Embedding model (EMBED) initialized successfully.")
except Exception as e:
    print(f"CRITICAL ERROR: Failed to initialize Embedding model (EMBED): {e}")
    # アプリケーションの起動を中止するか、EMBEDをNoneにして後続処理でハンドリングする
    EMBED = None # または raise SystemExit("Failed to initialize embedding model")

# チャンク設定: 2000 chars / overlap 200
TEXT_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=2000,
    chunk_overlap=200,
    separators=[
        "\n\n", "\n", " ", ".", ",",
        "\u3002", "\u3001", "\uff0e", "\uff0c", "\u200b", ""
    ],
)
