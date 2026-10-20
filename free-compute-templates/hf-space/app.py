"""
HF Space - OpenAI Compatible Server for Project Alpha
Semi-stable node for small/medium models (SmolLM, Llama-3-8B, Qwen-7B)
Uses FastAPI + transformers (or llama.cpp) + OpenAI compatible API
Deploy as Docker SDK Space on HuggingFace
Provides: https://<your-space>.hf.space/v1
Integrates with Project Alpha catalog.ts private-llama / private-smollm slots
"""
import os, time, uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# Config from env
MODEL_ID = os.getenv("MODEL_ID", "HuggingFaceTB/SmolLM2-1.7B-Instruct")
PORT = int(os.getenv("PORT", "7860"))

app = FastAPI(title="Project Alpha HF Space Gateway", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy load model
model = None
tokenizer = None

def load_model():
    global model, tokenizer
    if model is not None:
        return
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch
        print(f"Loading {MODEL_ID}...")
        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype="auto",
            device_map="auto",
            trust_remote_code=True
        )
        print(f"Model {MODEL_ID} loaded")
    except Exception as e:
        print(f"Failed to load model: {e}")
        # Fallback mock for testing
        model = "mock"
        tokenizer = "mock"

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.7
    stream: Optional[bool] = False

@app.get("/")
def root():
    return {"ok": True, "service": "project-alpha-hf-space", "model": MODEL_ID, "openai_compat": "/v1/chat/completions"}

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "loaded": model is not None}

@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {"id": MODEL_ID, "object": "model", "created": int(time.time()), "owned_by": "project-alpha"},
            {"id": "smollm2-1.7b-instruct", "object": "model", "created": int(time.time()), "owned_by": "project-alpha"},
            {"id": "smollm2-360m-instruct", "object": "model", "created": int(time.time()), "owned_by": "project-alpha"},
        ]
    }

@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest):
    if model is None:
        load_model()
    
    # Mock if model failed to load
    if model == "mock":
        # Return mock response for testing gateway integration
        prompt = "\n".join([f"{m.role}: {m.content}" for m in req.messages])
        mock_content = f"[HF Space Mock] Model {MODEL_ID} received: {prompt[-200:]} ... This is a mock response to test Project Alpha gateway integration. Deploy real model via MODEL_ID env."
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": mock_content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        }
    
    try:
        # Build prompt
        prompt = ""
        for m in req.messages:
            if m.role == "system":
                prompt += f"<|system|>\n{m.content}\n"
            elif m.role == "user":
                prompt += f"<|user|>\n{m.content}\n"
            elif m.role == "assistant":
                prompt += f"<|assistant|>\n{m.content}\n"
        prompt += "<|assistant|>\n"
        
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        max_new = min(req.max_tokens or 512, 1024)
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new,
            temperature=req.temperature or 0.7,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id
        )
        generated = tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
        
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": generated}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": inputs.input_ids.shape[1], "completion_tokens": len(outputs[0]) - inputs.input_ids.shape[1], "total_tokens": len(outputs[0])}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
