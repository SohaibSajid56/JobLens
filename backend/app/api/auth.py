from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import hash_pw, verify_pw, create_token
from app.database.connection import get_db
from app.database.models import User

router = APIRouter()


class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    full_name: str


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == req.username).first()

    if existing:
        raise HTTPException(status_code=400, detail="Account handle is taken.")

    user = User(
        username=req.username,
        full_name=req.full_name or req.username,
        password_hash=hash_pw(req.password)
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token({"sub": str(user.id)})

    return TokenResponse(
        access_token=token,
        username=user.username,
        full_name=user.full_name or user.username
    )


@router.post("/login", response_model=TokenResponse)
def login_route(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.username == form.username).first()

    if not user or not verify_pw(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credential values.")

    token = create_token({"sub": str(user.id)})

    return TokenResponse(
        access_token=token,
        username=user.username,
        full_name=user.full_name or user.username
    )