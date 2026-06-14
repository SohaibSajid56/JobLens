import requests
from fastapi import HTTPException
from app.core.config import settings

def search_linkedin_jobs(title: str, location: str):
    if not settings.RAPIDAPI_KEY:
        raise HTTPException(status_code=500, detail="RAPIDAPI_KEY credential missing.")
    url = "https://linkedin-job-search-api.p.rapidapi.com/active-jb-1h"
    querystring = {"offset": "0", "title_filter": title, "location_filter": location, "description_type": "text"}
    headers = {
        "x-rapidapi-key": settings.RAPIDAPI_KEY,
        "x-rapidapi-host": "linkedin-job-search-api.p.rapidapi.com",
        "Content-Type": "application/json",
    }
    response = requests.get(url, headers=headers, params=querystring)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()

def normalize_jobs(api_data):
    if isinstance(api_data, list): raw_jobs = api_data
    elif isinstance(api_data, dict):
        raw_jobs = api_data.get("jobs") or api_data.get("data") or api_data.get("results") or []
    else: raw_jobs = []
    
    jobs = []
    for job in raw_jobs:
        jobs.append({
            "title": job.get("title") or job.get("job_title") or "Untitled position",
            "company": job.get("company") or job.get("company_name") or "Hidden Employer",
            "location": job.get("location") or job.get("job_location") or "Remote / Global",
            "url": job.get("url") or job.get("job_url") or job.get("linkedin_url") or "",
            "description": job.get("description") or job.get("job_description") or "",
            "posted_at": job.get("posted_at") or job.get("date_posted") or "",
        })
    return jobs