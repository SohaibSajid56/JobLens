import requests
import json
import numpy as np
from typing import List
from fastapi import HTTPException
from app.core.config import settings

def hf_api_request(api_url: str, payload: dict) -> dict:
    if not settings.HF_TOKEN:
        raise HTTPException(status_code=500, detail="HF_TOKEN credential configuration is missing.")
    
    headers = {
        "Authorization": f"Bearer {settings.HF_TOKEN}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to connect to HuggingFace Router: {str(e)}")
        
    if response.status_code == 503:
        raise HTTPException(status_code=503, detail="HuggingFace model is warming up on the cloud. Please try again in a few seconds.")
        
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=f"HuggingFace Router Error ({response.status_code}): {response.text}")
        
    return response.json()

def embed_chunks(chunks: List[str]) -> np.ndarray:
    if not chunks:
        return np.empty((0, 384))
        
    API_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction"
    
    response_data = hf_api_request(API_URL, {"inputs": chunks})
    arr = np.array(response_data)
    
    if arr.ndim == 3:
        arr = arr.mean(axis=1)
    elif arr.ndim == 1:
        arr = np.expand_dims(arr, axis=0)
        
    return arr

def llm_generate(conversation: list, max_new_tokens: int = 768) -> str:
    API_URL = "https://router.huggingface.co/v1/chat/completions"
    
    payload = {
        "model": "Qwen/Qwen2.5-7B-Instruct",
        "messages": conversation,
        "max_tokens": max_new_tokens,
        "temperature": 0.3,
        "top_p": 0.9
    }
    
    res_json = hf_api_request(API_URL, payload)
    
    if "choices" in res_json and len(res_json["choices"]) > 0:
        return res_json["choices"][0]["message"]["content"].strip()
        
    return str(res_json)

def llm_generate_json(conversation: list, max_new_tokens: int = 600) -> dict:
    raw = llm_generate(conversation, max_new_tokens=max_new_tokens)
    cleaned = raw.strip()
    
    if "```" in cleaned:
        parts = cleaned.split("```")
        for part in parts:
            part_clean = part.strip()
            if part_clean.startswith("json"):
                part_clean = part_clean[4:].strip()
            if part_clean.startswith("{"):
                cleaned = part_clean
                break

    start = cleaned.find("{")
    if start == -1:
        raise ValueError(f"No JSON opening brace found in LLM output payload: {raw[:200]}")
    
    for end in range(len(cleaned), start, -1):
        try:
            return json.loads(cleaned[start:end])
        except json.JSONDecodeError:
            continue
            
    raise ValueError(f"Failed to isolate a clean balanced JSON matrix payload in output chunk: {raw[:300]}")