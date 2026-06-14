import traceback
from uuid import UUID
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database.connection import get_db
from app.database.models import AnalysisSession, ChatMessage, User, InterviewAnswer
from app.services.huggingface import llm_generate_json
import requests
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.core.config import settings

router = APIRouter()


class InterviewQuestionsRequest(BaseModel):
    session_id: str


class SpeakRequest(BaseModel):
    text: str


class EvaluateAnswerRequest(BaseModel):
    session_id: str
    question: str
    question_type: str
    expected_skills: List[str]
    user_answer: str


@router.post("/speak")
def generate_speech(req: SpeakRequest, user: User = Depends(get_current_user)):
    raise HTTPException(
        status_code=503,
        detail="Triggering instant native browser TTS."
    )


@router.post("/questions")
def get_interview_questions(
    req: InterviewQuestionsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        session_uuid = UUID(req.session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id format.")

    session = (
        db.query(AnalysisSession)
        .filter(
            AnalysisSession.id == session_uuid,
            AnalysisSession.user_id == user.id
        )
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Target analysis data context invalid.")

    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    context = "".join([
        f"\n{r.role.upper()}: {r.content[:500]}\n"
        for r in rows
    ])

    conversation = [
        {
            "role": "system",
            "content": (
                "You are an expert technical interviewer. Return a valid JSON object containing a 'questions' "
                "array where each object contains 'question', 'type', and 'expected_skills' fields. "
                "CRITICAL: All generated text MUST be strictly in English. Output ONLY the raw JSON block structure."
            )
        },
        {
            "role": "user",
            "content": f"Context:\n{context}\nGenerate 5 targeted technical and behavioral interview questions in English."
        }
    ]

    try:
        data = llm_generate_json(conversation)
        questions = data.get("questions", [])

        if not isinstance(questions, list):
            questions = []

        return {
            "questions": questions,
            "session_id": req.session_id
        }

    except Exception as e:
        print("\n❌ QUESTION GENERATION ERROR:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Could not generate interview questions: {str(e)}")


@router.post("/evaluate")
def evaluate_answer(
    req: EvaluateAnswerRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        session_uuid = UUID(req.session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id format.")

    session = (
        db.query(AnalysisSession)
        .filter(
            AnalysisSession.id == session_uuid,
            AnalysisSession.user_id == user.id
        )
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found.")

    if not req.user_answer or len(req.user_answer.strip()) < 2:
        result = {
            "score": 1,
            "strengths": [],
            "weaknesses": ["Answer provided was too brief to analyze accurately."],
            "missing_keywords": [],
            "detailed_feedback": "Please elaborate further on your experience in your response.",
            "ideal_answer_direction": "Incorporate explicit architectural examples and core workflow patterns."
        }

        db.add(InterviewAnswer(
            session_id=session.id,
            question=req.question,
            question_type=req.question_type,
            expected_skills=req.expected_skills,
            user_answer=req.user_answer,
            score=result["score"],
            strengths=result["strengths"],
            weaknesses=result["weaknesses"],
            missing_keywords=result["missing_keywords"],
            detailed_feedback=result["detailed_feedback"],
            ideal_answer_direction=result["ideal_answer_direction"],
            raw_evaluation=result
        ))
        db.commit()

        return result

    skills_str = ", ".join(req.expected_skills) if req.expected_skills else "general competency"

    prompt = (
        f"Question: {req.question}\n"
        f"Question Type: {req.question_type}\n"
        f"Skills being tested: {skills_str}\n\n"
        f"Candidate answer:\n\"\"\"\n{req.user_answer}\n\"\"\"\n\n"
        "Evaluate this answer strictly based ONLY on what was actually said."
    )

    conversation = [
        {
            "role": "system",
            "content": (
                "You are a strict but fair technical interviewer evaluating a candidate answer. "
                "Provide metrics strictly as a valid JSON format structure containing EXACTLY these keys:\n"
                '{"score": 8, "strengths": ["item"], "weaknesses": ["item"], "missing_keywords": ["item"], '
                '"detailed_feedback": "string", "ideal_answer_direction": "string"}\n'
                "CRITICAL: All feedback, items, and text MUST be strictly in English. "
                "Output raw JSON only. No explanations or wrapping outside the main object braces."
            )
        },
        {
            "role": "user",
            "content": prompt
        }
    ]

    try:
        result = llm_generate_json(conversation)

        if not isinstance(result, dict):
            result = {}

        result.setdefault("score", 5)
        result.setdefault("strengths", [])
        result.setdefault("weaknesses", [])
        result.setdefault("missing_keywords", [])
        result.setdefault("detailed_feedback", "Evaluation processed successfully.")
        result.setdefault("ideal_answer_direction", "Provide structured explanations with framework instances.")

        for key in ["strengths", "weaknesses", "missing_keywords"]:
            if not isinstance(result.get(key), list):
                if result.get(key):
                    result[key] = [str(result[key])]
                else:
                    result[key] = []

        try:
            result["score"] = max(1, min(10, int(result["score"])))
        except Exception:
            result["score"] = 5

        db.add(InterviewAnswer(
            session_id=session.id,
            question=req.question,
            question_type=req.question_type,
            expected_skills=req.expected_skills,
            user_answer=req.user_answer,
            score=result.get("score"),
            strengths=result.get("strengths", []),
            weaknesses=result.get("weaknesses", []),
            missing_keywords=result.get("missing_keywords", []),
            detailed_feedback=result.get("detailed_feedback"),
            ideal_answer_direction=result.get("ideal_answer_direction"),
            raw_evaluation=result
        ))
        db.commit()

        return result

    except Exception as e:
        print("\n❌ CRITICAL EVALUATION EXCEPTION CAUGHT:")
        traceback.print_exc()

        result = {
            "score": 5,
            "strengths": [],
            "weaknesses": [f"AI evaluation could not parse automatically: {str(e)}"],
            "missing_keywords": [],
            "detailed_feedback": "The server encountered an error processing the assessment parameters.",
            "ideal_answer_direction": "Verify your structural connection inputs and try resubmitting."
        }

        db.add(InterviewAnswer(
            session_id=session.id,
            question=req.question,
            question_type=req.question_type,
            expected_skills=req.expected_skills,
            user_answer=req.user_answer,
            score=result["score"],
            strengths=result["strengths"],
            weaknesses=result["weaknesses"],
            missing_keywords=result["missing_keywords"],
            detailed_feedback=result["detailed_feedback"],
            ideal_answer_direction=result["ideal_answer_direction"],
            raw_evaluation=result
        ))
        db.commit()

        return result
    

@router.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user)
):
    try:
        audio_bytes = await audio.read()

        if not audio_bytes or len(audio_bytes) < 1000:
            raise HTTPException(status_code=400, detail="Audio file is too small or empty.")

        if not settings.HF_TOKEN:
            raise HTTPException(status_code=500, detail="HF_TOKEN is missing.")

        # Use Hugging Face Router, not old api-inference domain
        url = "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3"

        headers = {
            "Authorization": f"Bearer {settings.HF_TOKEN}",
            "Content-Type": audio.content_type or "audio/webm"
        }

        response = requests.post(
            url,
            headers=headers,
            data=audio_bytes,
            timeout=90
        )

        print("HF TRANSCRIBE STATUS:", response.status_code)
        print("HF TRANSCRIBE RESPONSE:", response.text[:500])

        if response.status_code == 503:
            raise HTTPException(
                status_code=503,
                detail="Speech model is warming up. Try again in a few seconds."
            )

        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Transcription failed: {response.text[:500]}"
            )

        data = response.json()

        text = data.get("text", "")

        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="No speech detected in audio.")

        return {"text": text.strip()}

    except HTTPException:
        raise
    except Exception as e:
        print("TRANSCRIPTION SERVER ERROR:", str(e))
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")