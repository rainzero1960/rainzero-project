# backend/db.py
import os
from sqlmodel import SQLModel, create_engine, Session
from dotenv import load_dotenv, find_dotenv

# このファイルの上部で、新しいモデルがインポートされるようにする
# (通常はSQLModel.metadata.create_allが自動検出するが、明示的なインポートがあれば確実)
from models import PaperMetadata, GeneratedSummary, UserPaperLink, ChatMessage, User, RagSession, RagMessage # 例

_ = load_dotenv(find_dotenv())

# --- 環境変数の読み取り ---
DEPLOY_ENV = os.getenv("DEPLOY", "cloud") # デフォルトは 'cloud' (Supabase想定)

DATABASE_URL = None
engine = None
 
if DEPLOY_ENV == "local":
    # --- SQLite設定 (ローカルデプロイ時) ---
    print("Using SQLite for local deployment.")
    SQLITE_FILE_PATH = "database/sqlite/db.sqlite3"
    # ディレクトリが存在しない場合に作成
    os.makedirs(os.path.dirname(SQLITE_FILE_PATH), exist_ok=True)
    DATABASE_URL = f"sqlite:///{SQLITE_FILE_PATH}"
    engine = create_engine(DATABASE_URL, echo=True) # echo=False に変更推奨 (本番時)
else:
    # --- Supabase/PostgreSQL設定 (クラウドデプロイ時または DEPLOY != "local") ---
    print(f"Using Supabase/PostgreSQL for '{DEPLOY_ENV}' deployment.")
    DB_USER = os.getenv("SUPABASE_DB_USER", "postgres")
    DB_PASSWORD = os.getenv("SUPABASE_DB_PASSWORD")
    DB_HOST = os.getenv("SUPABASE_DB_HOST")
    db_port_env = os.getenv("SUPABASE_DB_PORT", "5432")
    DB_PORT = db_port_env if db_port_env and db_port_env.strip() else "5432"
    DB_NAME = os.getenv("SUPABASE_DB_NAME", "postgres")

    if not all([DB_PASSWORD, DB_HOST]):
        raise ValueError(
            "Supabase connection environment variables (SUPABASE_DB_PASSWORD, SUPABASE_DB_HOST) are not fully set."
        )

    #ipv6の直接接続は下記（現状の環境変数設定、Google Cloud含め）
    DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@db.{DB_HOST}:{DB_PORT}/{DB_NAME}"
    # 並列処理対応のための接続プール設定
    engine = create_engine(
        DATABASE_URL, 
        echo=False,
        pool_size=20,  # 接続プールサイズを増加
        max_overflow=30,  # 最大オーバーフロー接続数
        pool_pre_ping=True,  # 接続の健全性チェック
        pool_recycle=3600  # 1時間ごとに接続をリサイクル
    )
    
    #ipv4接続設定しかできない場合は下記。TODO：ipv6では接続できないときにフォールバックするようにする
    #　SUpabeseの場合、ppoler接続はEgressを消費するため、非推奨。無料プランでは5GBを超えると接続できなくなる（月跨ぎでリセットされない）。
    #DATABASE_URL = f"postgresql://postgres.spseumtylmkfczyqwjwj:{DB_PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
    #engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=20)


def get_session():
    with Session(engine) as session:
        yield session

def init_db() -> None:
    """
    アプリ起動時に呼び出し、まだテーブルが無ければ CREATE する。
    SupabaseではスキーマはSupabase Studioやマイグレーションで管理するため、
    この関数はSQLite利用時のみテーブル作成を行う。
    """
    if DEPLOY_ENV == "local":
        print("Initializing SQLite database and creating tables if they don't exist...")
        # models.py で定義された全てのSQLModelテーブルが作成される
        SQLModel.metadata.create_all(engine)
        print("SQLite database initialization complete.")
    else:
        print("Database initialization (table creation) skipped for Supabase/PostgreSQL (managed externally).")