import uuid
import base64
import traceback
import json
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.security import get_current_user
from app.services.huggingface import llm_generate, llm_generate_json
from app.services.job_providers import search_jobs_multi_provider


from uuid import UUID
from sqlalchemy.orm import Session
from urllib.parse import quote_plus

from app.database.connection import get_db
from app.database.models import (
    User,
    CvDocument,
    AnalysisSession,
    ChatMessage as DbChatMessage,
    AnalysisResult,
    JobSearch,
    JobPosting
)


router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str

class AnalyzeRequest(BaseModel):
    messages: List[ChatMessage]
    cv_pdf: Optional[dict] = None
    session_id: Optional[str] = None

class RecommendJobsRequest(BaseModel):
    cv_pdf: dict
    location: Optional[str] = "Pakistan"
    country_code: Optional[str] = "pk"

def extract_cv_text(cv_pdf: dict) -> str:
    import pdfplumber, io
    raw = base64.b64decode(cv_pdf["base64"])
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        return "\n".join(p.extract_text() or "" for p in pdf.pages).strip()


def extract_cv_profile(cv_text: str) -> dict:
    conversation = [
        {
            "role": "system",
            "content": (
                "You are a career profile extraction engine. "
                "Read the candidate CV and return ONLY valid JSON. "
                "Extract a realistic target job title and the candidate's strongest hard skills. "
                "Do not invent skills. Use only skills clearly supported by the CV. "
                "Format exactly: "
                '{"inferred_title": "Software Engineer", "skills": ["Python", "React", "PostgreSQL"]}'
            )
        },
        {
            "role": "user",
            "content": f"CV TEXT:\n{cv_text[:6000]}"
        }
    ]

    try:
        data = llm_generate_json(conversation, max_new_tokens=600)

        title = data.get("inferred_title") or infer_title(cv_text)
        skills = data.get("skills", [])

        if not isinstance(skills, list):
            skills = []

        cleaned_skills = []
        for skill in skills:
            skill = str(skill).strip()
            if skill and skill.lower() not in [s.lower() for s in cleaned_skills]:
                cleaned_skills.append(skill)

        return {
            "inferred_title": str(title).strip() or infer_title(cv_text),
            "skills": cleaned_skills[:12]
        }

    except Exception as e:
        print("\n⚠️ CV PROFILE EXTRACTION FALLBACK:")
        print(str(e))

        fallback_title = infer_title(cv_text)

        fallback_skills = []
        lowered = cv_text.lower()

        known_skills = [
            "Python", "JavaScript", "TypeScript", "React", "Node.js", "Express",
            "FastAPI", "Django", "Flask", "PostgreSQL", "MySQL", "MongoDB",
            "Docker", "Kubernetes", "AWS", "Azure", "Git", "GitHub",
            "Flutter", "Dart", "Firebase", "C++", "Java", "SQL",
            "Machine Learning", "Deep Learning", "NLP", "Pandas", "NumPy"
        ]

        for skill in known_skills:
            if skill.lower() in lowered:
                fallback_skills.append(skill)

        return {
            "inferred_title": fallback_title,
            "skills": fallback_skills[:12]
        }



def infer_title(cv_text: str) -> str:
    text = cv_text.lower()
    if "react" in text or "node" in text: return "Full Stack Developer"
    if "flutter" in text or "dart" in text: return "Flutter App Developer"
    if "python" in text or "c++" in text: return "Software Engineer"
    return "Software Engineer"

# --- NEW AI DEDUCTIVE SCORER ---
# --- NEW AI DEDUCTIVE SCORER ---

# --- NEW AI DEDUCTIVE SCORER ---
# --- NEW AI DEDUCTIVE SCORER ---
def calculate_strict_match(jd_text: str, cv_text: str) -> dict:
    conversation = [
        {
            "role": "system",
            "content": (
                "You are a ruthless, highly critical technical recruiter evaluating a candidate's CV against a Job Description. "
                "Calculate a highly realistic 'overall_match_pct' (0 to 100). "
                "CRITICAL RULES: "
                "1. If the candidate's profession or industry is completely different from the job (e.g., a Software Developer applying to be a Doctor or Sales rep), the score MUST be between 0 and 5. "
                "2. Do NOT start at 100. Start at 0 and only add points for explicitly matching hard skills, required experience, and exact domain alignment. "
                "3. Heavily penalize missing mandatory requirements. "
                "You must output ONLY a valid JSON object. No markdown formatting, no explanations. "
                "Format EXACTLY like this: {\"overall_match_pct\": 15, \"missing_skills\": [\"Skill A\", \"Skill B\"]}"
            )
        },
        {
            "role": "user",
            "content": f"JOB DESCRIPTION:\n{jd_text}\n\nCANDIDATE CV:\n{cv_text}"
        }
    ]
    
    try:
        result = llm_generate_json(conversation)
        
        if not isinstance(result, dict):
            result = {}
            
        raw_score = result.get("overall_match_pct", 0)
        
        # Scrubber to strip out any '%' signs or text if the AI hallucinates
        if isinstance(raw_score, str):
            digits_only = "".join(filter(str.isdigit, raw_score))
            score = int(digits_only) if digits_only else 0
        else:
            try:
                score = int(raw_score)
            except Exception:
                score = 0
                
        missing = result.get("missing_skills", [])
        if not isinstance(missing, list):
            missing = []
            
        return {
            "overall_match_pct": max(0, min(100, score)), # Locks safely between 0 and 100
            "missing_skills": missing
        }
    except Exception as e:
        print(f"⚠️ Scoring Fallback triggered: {e}")
        return {"overall_match_pct": 0, "missing_skills": ["Analysis failed to parse automatically."]}

@router.post("/analyze_job")
def analyze_job(
    req: AnalyzeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        cv_text = None
        cv_doc = None
        gap_data = None

        if req.cv_pdf:
            try:
                cv_text = extract_cv_text(req.cv_pdf)
                cv_doc = CvDocument(
                    user_id=user.id,
                    filename=req.cv_pdf.get("filename", "cv.pdf"),
                    extracted_text=cv_text
                )
                db.add(cv_doc)
                db.commit()
                db.refresh(cv_doc)
            except Exception as parse_err:
                print(f"⚠️ PDF Parsing Notice: {str(parse_err)}")
                cv_text = None

        user_msg = req.messages[-1].content if req.messages else ""

        if req.session_id:
            session = (
                db.query(AnalysisSession)
                .filter(
                    AnalysisSession.id == UUID(req.session_id),
                    AnalysisSession.user_id == user.id
                )
                .first()
            )
        else:
            session = None

        if not session:
            session = AnalysisSession(
                user_id=user.id,
                cv_document_id=cv_doc.id if cv_doc else None,
                title=user_msg[:80],
                job_description=user_msg,
                has_cv=cv_text is not None
            )
            db.add(session)
            db.commit()
            db.refresh(session)

        if cv_text and len(cv_text.strip()) > 50:
            gap_data = calculate_strict_match(user_msg, cv_text)

            missing_str = ", ".join(gap_data.get("missing_skills", []))
            prompt_summary = (
                f"\n\n[GAP RESULTS] Match Score: {gap_data['overall_match_pct']}%"
                f"\n[MISSING SKILLS] {missing_str}"
            )

            conversation = [
                {
                    "role": "system",
                    "content": "You are an elite corporate technical recruiter and resume reviewer coach. Produce a highly detailed analysis report structure. Focus specifically on the missing skills provided in the prompt summary."
                },
                {
                    "role": "user",
                    "content": user_msg + prompt_summary
                }
            ]
        else:
            gap_data = {
                "overall_match_pct": 0,
                "missing_skills": ["Could not extract text from the provided PDF."]
            }

            conversation = [
                {
                    "role": "system",
                    "content": "Analyze the job description. Warn the user if their CV could not be read."
                },
                {
                    "role": "user",
                    "content": user_msg
                }
            ]

        response_text = llm_generate(conversation)
        match_pct = gap_data["overall_match_pct"] if gap_data else None

        session.match_pct = match_pct
        session.has_cv = cv_text is not None

        db.add(DbChatMessage(
            session_id=session.id,
            role="user",
            content=user_msg
        ))

        db.add(DbChatMessage(
            session_id=session.id,
            role="assistant",
            content=response_text,
            match_pct=match_pct
        ))

        existing_result = (
            db.query(AnalysisResult)
            .filter(AnalysisResult.session_id == session.id)
            .first()
        )

        if existing_result:
            existing_result.ai_response = response_text
            existing_result.missing_skills = gap_data.get("missing_skills", [])
            existing_result.raw_model_output = gap_data
        else:
            db.add(AnalysisResult(
                session_id=session.id,
                ai_response=response_text,
                missing_skills=gap_data.get("missing_skills", []),
                raw_model_output=gap_data
            ))

        db.commit()

        return {
            "response": response_text,
            "session_id": str(session.id),
            "match_pct": match_pct
        }

    except Exception as e:
        print("\n❌ CRITICAL UNHANDLED EXCEPTION IN /analyze_job ENDPOINT:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Backend Internal Error: {str(e)}")



def build_job_search_fallback(title: str, location: str) -> list:
    q = quote_plus(title)
    loc = quote_plus(location or "")

    return [
        {
            "title": f"{title} roles",
            "company": "LinkedIn Search",
            "location": location or "Any location",
            "description": "Open a live job-board search for this role and location.",
            "url": f"https://www.linkedin.com/jobs/search/?keywords={q}&location={loc}",
            "source": "search_link"
        },
        {
            "title": f"{title} jobs",
            "company": "Indeed Search",
            "location": location or "Any location",
            "description": "Open a live job-board search for this role and location.",
            "url": f"https://www.indeed.com/jobs?q={q}&l={loc}",
            "source": "search_link"
        },
        {
            "title": f"Remote {title} jobs",
            "company": "RemoteOK Search",
            "location": "Remote",
            "description": "Open a remote-focused job search for this role.",
            "url": f"https://remoteok.com/remote-{quote_plus(title.lower().replace(' ', '-'))}-jobs",
            "source": "search_link"
        }
    ]




@router.post("/recommend_jobs")
def recommend_jobs_internal(
    req: RecommendJobsRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        cv_text = extract_cv_text(req.cv_pdf)

        profile = extract_cv_profile(cv_text)
        inferred_title = profile["inferred_title"]
        skills = profile["skills"]
        location = req.location or "Pakistan"
        country_code = req.country_code or "pk"

        job_list = []

        try:
            job_list = search_jobs_multi_provider(
                title=inferred_title,
                location=location,
                limit=20
            )

        except HTTPException as api_err:
            print("\n⚠️ JOB PROVIDER ERROR:")
            print(api_err.detail)
            job_list = []

        job_search = JobSearch(
            user_id=user.id,
            inferred_title=inferred_title,
            location=req.location,
            skills=skills
        )

        db.add(job_search)
        db.commit()
        db.refresh(job_search)

        for job in job_list[:20]:
            db.add(JobPosting(
                job_search_id=job_search.id,
                title=job.get("title"),
                company=job.get("company"),
                location=job.get("location"),
                description=job.get("description"),
                url=job.get("url"),
                source="linkedin",
                raw_data=job
            ))

        db.commit()

        return {
            "inferred_title": inferred_title,
            "skills": skills,
            "jobs": job_list
        }

    except Exception as e:
        print("\n❌ CRITICAL UNHANDLED EXCEPTION IN /recommend_jobs:")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail="Unable to load job recommendations right now. Please try again later."
        )