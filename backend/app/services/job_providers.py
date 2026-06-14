import requests
from urllib.parse import quote_plus
from app.core.config import settings
from urllib.parse import quote_plus


def normalize_job(title=None, company=None, location=None, description=None, url=None, source=None):
    return {
        "title": title or "Untitled Job",
        "company": company or "Unknown company",
        "location": location or "Unknown location",
        "description": description or "",
        "url": url or "",
        "source": source or "unknown",
    }


def search_adzuna_jobs(title: str, location: str, limit: int = 10) -> list:
    if not settings.ADZUNA_APP_ID or not settings.ADZUNA_APP_KEY:
        return []

    url = "https://api.adzuna.com/v1/api/jobs/us/search/1"

    params = {
        "app_id": settings.ADZUNA_APP_ID,
        "app_key": settings.ADZUNA_APP_KEY,
        "what": title,
        "where": location,
        "results_per_page": limit,
        "content-type": "application/json",
    }

    try:
        res = requests.get(url, params=params, timeout=12)
        if res.status_code >= 400:
            print("ADZUNA ERROR:", res.status_code, res.text[:300])
            return []

        data = res.json()
        results = data.get("results", [])

        jobs = []
        for item in results:
            jobs.append(normalize_job(
                title=item.get("title"),
                company=(item.get("company") or {}).get("display_name"),
                location=(item.get("location") or {}).get("display_name"),
                description=item.get("description"),
                url=item.get("redirect_url"),
                source="adzuna"
            ))

        return jobs

    except Exception as e:
        print("ADZUNA EXCEPTION:", str(e))
        return []


def search_jooble_jobs(title: str, location: str, limit: int = 10) -> list:
    if not settings.JOOBLE_API_KEY:
        return []

    url = f"https://jooble.org/api/{settings.JOOBLE_API_KEY}"

    payload = {
        "keywords": title,
        "location": location,
    }

    try:
        res = requests.post(url, json=payload, timeout=12)
        if res.status_code >= 400:
            print("JOOBLE ERROR:", res.status_code, res.text[:300])
            return []

        data = res.json()
        results = data.get("jobs", [])[:limit]

        jobs = []
        for item in results:
            jobs.append(normalize_job(
                title=item.get("title"),
                company=item.get("company"),
                location=item.get("location"),
                description=item.get("snippet"),
                url=item.get("link"),
                source="jooble"
            ))

        return jobs

    except Exception as e:
        print("JOOBLE EXCEPTION:", str(e))
        return []


def search_arbeitnow_jobs(title: str, location: str, limit: int = 10) -> list:
    try:
        res = requests.get("https://www.arbeitnow.com/api/job-board-api", timeout=12)

        if res.status_code >= 400:
            print("ARBEITNOW ERROR:", res.status_code, res.text[:300])
            return []

        data = res.json()
        results = data.get("data", [])

        title_l = title.lower()
        location_l = (location or "").lower()

        jobs = []

        for item in results:
            job_title = item.get("title", "")
            job_location = item.get("location", "")

            title_match = any(word in job_title.lower() for word in title_l.split())
            location_match = not location_l or location_l in job_location.lower() or "remote" in job_location.lower()

            if title_match and location_match:
                jobs.append(normalize_job(
                    title=job_title,
                    company=item.get("company_name"),
                    location=job_location,
                    description=item.get("description", "")[:600],
                    url=item.get("url"),
                    source="arbeitnow"
                ))

            if len(jobs) >= limit:
                break

        return jobs

    except Exception as e:
        print("ARBEITNOW EXCEPTION:", str(e))
        return []


def build_job_search_fallback(title: str, location: str) -> list:
    q = quote_plus(title)
    loc = quote_plus(location or "")
    google_q = quote_plus(f"{title} jobs in {location}")

    return [
        {
            "title": f"{title} roles in {location}",
            "company": "LinkedIn Search",
            "location": location or "Any location",
            "description": "Open a live LinkedIn job search for this role and country.",
            "url": f"https://www.linkedin.com/jobs/search/?keywords={q}&location={loc}",
            "source": "search_link"
        },
        {
            "title": f"{title} jobs in {location}",
            "company": "Indeed Search",
            "location": location or "Any location",
            "description": "Open a live Indeed job search for this role and country.",
            "url": f"https://www.indeed.com/jobs?q={q}&l={loc}",
            "source": "search_link"
        },
        {
            "title": f"{title} jobs in {location}",
            "company": "Google Jobs Search",
            "location": location or "Any location",
            "description": "Open a broad Google job search for this role and country.",
            "url": f"https://www.google.com/search?q={google_q}",
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


def dedupe_jobs(jobs: list) -> list:
    seen = set()
    unique = []

    for job in jobs:
        key = (
            (job.get("title") or "").lower().strip(),
            (job.get("company") or "").lower().strip(),
            (job.get("location") or "").lower().strip(),
        )

        if key in seen:
            continue

        seen.add(key)
        unique.append(job)

    return unique


def search_jobs_multi_provider(title: str, location: str, limit: int = 20) -> list:
    jobs = []

    providers = [
        search_adzuna_jobs,
        search_jooble_jobs,
        search_arbeitnow_jobs,
    ]

    for provider in providers:
        try:
            provider_jobs = provider(title, location, limit=limit)
            jobs.extend(provider_jobs)
            jobs = dedupe_jobs(jobs)

            if len(jobs) >= limit:
                return jobs[:limit]

        except Exception as e:
            print("JOB PROVIDER FAILED:", provider.__name__, str(e))

    if jobs:
        return jobs[:limit]

    return build_job_search_fallback(title, location)