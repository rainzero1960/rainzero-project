# backend/auth_utils.py
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from db import get_session
from models import User
from schemas import TokenData

from dotenv import load_dotenv, find_dotenv
import os

_ = load_dotenv(find_dotenv())

# 環境変数から読み込むのが望ましい
SECRET_KEY = os.getenv("HS256_SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token") # FastAPI側のトークン発行エンドポイント（後方互換性のため残す）

def get_app_authorization_token(request: Request) -> str:
    """X-App-Authorizationヘッダーからトークンを取得"""
    authorization = request.headers.get("X-App-Authorization")
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # "Bearer "で始まっている場合は削除
    if authorization.startswith("Bearer "):
        return authorization[7:]
    return authorization

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        # ★ ここも ACCESS_TOKEN_EXPIRE_MINUTES を参照するようにする ★
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(
    request: Request, session: Session = Depends(get_session)
) -> User:
    token = get_app_authorization_token(request)
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: Optional[str] = payload.get("sub")
        user_id: Optional[int] = payload.get("user_id")
        if username is None or user_id is None:
            raise credentials_exception
        token_data = TokenData(username=username, user_id=user_id)
        print(f"[AUTH_DEBUG] JWT decoded - username: {username}, user_id: {user_id}")
    except JWTError:
        raise credentials_exception

    user = session.exec(select(User).where(User.id == token_data.user_id)).first()
    if user is None:
        print(f"[AUTH_DEBUG] User not found for user_id: {token_data.user_id}")
        raise credentials_exception
    print(f"[AUTH_DEBUG] Retrieved user - id: {user.id}, username: {user.username}")
    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    # ここでユーザーが無効化されているかなどのチェックを追加できる
    # if current_user.disabled:
    #     raise HTTPException(status_code=400, detail="Inactive user")
    return current_user