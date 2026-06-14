from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.connection import get_db
from app.database.models import AnalysisSession, ChatMessage, User

router = APIRouter()


@router.get("")
def get_history_internal(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    sessions = (
        db.query(AnalysisSession)
        .filter(AnalysisSession.user_id == user.id)
        .order_by(AnalysisSession.created_at.desc())
        .all()
    )

    output = []

    for s in sessions:
        messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.session_id == s.id)
            .order_by(ChatMessage.created_at.asc())
            .all()
        )

        turns = []
        i = 0

        while i < len(messages):
            if messages[i].role == "user":
                user_msg = messages[i].content
                ai_msg = ""
                match_pct = None

                if i + 1 < len(messages) and messages[i + 1].role == "assistant":
                    ai_msg = messages[i + 1].content
                    match_pct = messages[i + 1].match_pct

                turns.append({
                    "timestamp": messages[i].created_at.isoformat(),
                    "user": user_msg,
                    "ai": ai_msg,
                    "match_pct": match_pct
                })

            i += 1

        output.append({
            "session_id": str(s.id),
            "started": s.created_at.isoformat(),
            "has_cv": s.has_cv,
            "match_pct": s.match_pct,
            "turns": turns
        })

    return {"sessions": output}


@router.delete("/{session_id}")
def delete_session_internal(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    session = (
        db.query(AnalysisSession)
        .filter(
            AnalysisSession.id == UUID(session_id),
            AnalysisSession.user_id == user.id
        )
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(session)
    db.commit()

    return {"deleted": True}