# knowledgepaper/backend/Dockerfile

FROM python:3.10-slim
WORKDIR /app

ENV PYTHONUNBUFFERED 1
# Cloud Run は PORT 環境変数でリッスンするポートを指定する
# デフォルトは 8080 だが、明示的に設定
ENV PORT 8080
ENV PIP_NO_CACHE_DIR=off
ENV PIP_DISABLE_PIP_VERSION_CHECK=on

# psycopg2-binary のビルドに必要な依存関係をインストール
RUN apt-get update && \
    apt-get install -y libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

# requirements.txt をコピーして依存関係をインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# backend ディレクトリの残りのコードをコピー
# (Dockerfile が backend ディレクトリにあるので、カレントディレクトリをコピー)
COPY . .

# FastAPI アプリケーションを実行
# main.py がカレントディレクトリ (WORKDIR /app) にある想定
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]