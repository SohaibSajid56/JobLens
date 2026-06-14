import uuid
from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database.connection import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(80), unique=True, nullable=False, index=True)
    full_name = Column(String(150), nullable=True)
    password_hash = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    analysis_sessions = relationship(
        "AnalysisSession",
        back_populates="user",
        cascade="all, delete-orphan"
    )


class CvDocument(Base):
    __tablename__ = "cv_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    filename = Column(Text, nullable=False)
    extracted_text = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AnalysisSession(Base):
    __tablename__ = "analysis_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    cv_document_id = Column(UUID(as_uuid=True), ForeignKey("cv_documents.id", ondelete="SET NULL"), nullable=True)

    title = Column(Text, nullable=True)
    job_description = Column(Text, nullable=False)
    match_pct = Column(Integer, nullable=True)
    has_cv = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="analysis_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")
    result = relationship("AnalysisResult", back_populates="session", uselist=False, cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("analysis_sessions.id", ondelete="CASCADE"), nullable=False)

    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    match_pct = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("AnalysisSession", back_populates="messages")


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("analysis_sessions.id", ondelete="CASCADE"), nullable=False, unique=True)

    ai_response = Column(Text, nullable=True)
    missing_skills = Column(JSONB, default=list)
    raw_model_output = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("AnalysisSession", back_populates="result")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    analysis_session_id = Column(UUID(as_uuid=True), ForeignKey("analysis_sessions.id", ondelete="CASCADE"), nullable=False)

    mode = Column(String(20), default="text")
    overall_score = Column(Numeric(4, 2), nullable=True)

    started_at = Column(DateTime(timezone=True), server_default=func.now())


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_session_id = Column(UUID(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)

    question_text = Column(Text, nullable=False)
    question_type = Column(String(80), nullable=True)
    expected_skills = Column(JSONB, default=list)
    order_no = Column(Integer, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    session_id = Column(UUID(as_uuid=True), ForeignKey("analysis_sessions.id", ondelete="CASCADE"), nullable=False)

    question = Column(Text, nullable=False)
    question_type = Column(String(80), nullable=True)
    expected_skills = Column(JSONB, default=list)
    user_answer = Column(Text, nullable=False)

    score = Column(Numeric(4, 2), nullable=True)
    strengths = Column(JSONB, default=list)
    weaknesses = Column(JSONB, default=list)
    missing_keywords = Column(JSONB, default=list)
    detailed_feedback = Column(Text, nullable=True)
    ideal_answer_direction = Column(Text, nullable=True)
    raw_evaluation = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class JobSearch(Base):
    __tablename__ = "job_searches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    inferred_title = Column(Text, nullable=True)
    location = Column(Text, nullable=True)
    skills = Column(JSONB, default=list)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class JobPosting(Base):
    __tablename__ = "job_postings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_search_id = Column(UUID(as_uuid=True), ForeignKey("job_searches.id", ondelete="CASCADE"), nullable=False)

    title = Column(Text, nullable=True)
    company = Column(Text, nullable=True)
    location = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    source = Column(String(80), default="linkedin")
    raw_data = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())