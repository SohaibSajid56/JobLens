# backend/app/main.py
import os
from app.database.init_db import init_db

# Clear any stale or broken system proxies hiding in Windows environment keys
os.environ['http_proxy'] = ''
os.environ['https_proxy'] = ''
os.environ['no_proxy'] = '*'

# Your existing imports continue below here...
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import auth, analyzer, interview, history
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import auth, analyzer, interview, history

app = FastAPI(title="JobLens Enterprise Core Core Engine API")
@app.on_event("startup")
def on_startup():
    init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Route Mounting Configuration
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(analyzer.router, prefix="/internal", tags=["Job Engine Analytics"])
app.include_router(interview.router, prefix="/internal/interview", tags=["Live System Interviews"])
app.include_router(history.router, prefix="/internal/history", tags=["History Streams"])

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "engine": "JobLens Lightweight Distribution Node v2"}