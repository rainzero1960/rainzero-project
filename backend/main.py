# uvicorn main:app --host 0.0.0.0 --port 8000 --reload

from fastapi import FastAPI, Depends 
from fastapi.middleware.cors import CORSMiddleware

from db import init_db           # ★ 追加
from db import get_session       # ★ 追加
from models import User, RagSession, UserPaperLink, GeneratedSummary # ★ 追加
from sqlmodel import Session, select  # ★ 追加
from routers import papers as papers_router   # ★ 追加
from routers import rag as rag_router
from routers import embeddings as embeddings_router
from routers import deepresearch as deepresearch_router
from routers import deeprag as deeprag_router
from routers import auth as auth_router
from routers import system_prompts as system_prompts_router
from routers import system_prompt_groups as system_prompt_groups_router
from routers import images as images_router
from routers import background_images as background_images_router

app = FastAPI(title="KnowledgePaper API")
app.include_router(papers_router.router) 
app.include_router(rag_router.router)
app.include_router(embeddings_router.router)
app.include_router(deepresearch_router.router)   
app.include_router(deeprag_router.router) 
app.include_router(auth_router.router)
app.include_router(system_prompts_router.router)
app.include_router(system_prompt_groups_router.router)
app.include_router(images_router.router)
app.include_router(background_images_router.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")          # ★ 起動時に DB を初期化
def on_startup():
    init_db()

@app.get("/ping")
def ping():
    return {"ok": True}


