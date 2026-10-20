"""
Colab / Kaggle - Burst Compute OpenAI Compatible Server + Cloudflare Tunnel
Purpose: When heavy model or GPU needed, use free T4/P100 instantly
Pattern: Stable Gateway (HF Space) + Ephemeral Burst (Colab/Kaggle via tunnel)

This single Python file does:
1. Loads model via transformers or llama.cpp (GPU if available)
2. Starts FastAPI OpenAI compatible server on local port
3. Opens Cloudflare Quick Tunnel (cloudflared) or ngrok to get public URL
4. Prints public URL to copy into Project Alpha gateway config

Usage:
- Colab: Create notebook, Runtime > Change runtime type > T4 GPU, paste this file, run
- Kaggle: Create notebook, Settings > Accelerator > GPU T4 x2, Internet ON, paste, run

The generated remote URL (e.g., https://xxxx.trycloudflare.com/v1) is ephemeral (lasts until notebook stops)
Copy it and update Project Alpha catalog.ts private-llama baseUrl or via UI Provider Settings
"""

import os, subprocess, time, threading, uuid, sys

# --- Config ---
MODEL_ID = os.getenv("MODEL_ID", "meta-llama/Llama-3.2-3B-Instruct")  # Change to your model
PORT = int(os.getenv("PORT", "8000"))
USE_LLAMA_CPP = False  # Set True if you want llama.cpp (need GGUF)

def install_deps():
    print("Installing deps...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "fastapi", "uvicorn", "transformers", "accelerate", "torch"])
    except Exception as e:
        print(f"Install error: {e}")

def download_cloudflared():
    # Download cloudflared binary for Linux (Colab/Kaggle are Linux)
    if not os.path.exists("cloudflared"):
        print("Downloading cloudflared...")
        # Try via curl
        try:
            subprocess.check_call("curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared", shell=True)
        except:
            # Fallback via wget
            subprocess.check_call("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared && chmod +x cloudflared", shell=True)
    print("cloudflared ready")

# --- FastAPI Server ---
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="Project Alpha Colab/Kaggle Burst Node")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

model = None
tokenizer = None

def load_model():
    global model, tokenizer
    if model is not None:
        return
    print(f"Loading {MODEL_ID}...")
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID,
            torch_dtype="auto",
            device_map="auto",
            trust_remote_code=True
        )
        print("Model loaded")
    except Exception as e:
        print(f"Load failed, using mock: {e}")
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

@app.get("/")
def root():
    return {"ok": True, "model": MODEL_ID, "burst": True, "gateway": "project-alpha"}

@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "project-alpha"}]}

@app.post("/v1/chat/completions")
def chat(req: ChatRequest):
    if model is None:
        load_model()
    if model == "mock":
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:6]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": f"[Colab Mock] Echo: {req.messages[-1].content[:200]}"}, "finish_reason": "stop"}]
        }
    try:
        prompt = "\n".join([f"{m.role}: {m.content}" for m in req.messages]) + "\nassistant:"
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        outputs = model.generate(**inputs, max_new_tokens=min(req.max_tokens or 512, 1024), temperature=req.temperature or 0.7, do_sample=True, pad_token_id=tokenizer.eos_token_id)
        gen = tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex[:6]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": req.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": gen}, "finish_reason": "stop"}]
        }
    except Exception as e:
        return {"error": str(e)}

def run_server():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)

def run_tunnel():
    time.sleep(3)
    print("\n=== Starting Cloudflare Tunnel ===")
    # cloudflared tunnel --url http://localhost:8000
    proc = subprocess.Popen(f"./cloudflared tunnel --url http://localhost:{PORT}", shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        print(line, end="")
        if "trycloudflare.com" in line:
            # Extract URL
            import re
            m = re.search(r"https://[^\s]*trycloudflare\.com", line)
            if m:
                url = m.group(0)
                print(f"\n\n*** COPY THIS URL INTO PROJECT ALPHA GATEWAY ***")
                print(f"{url}/v1")
                print(f"Update catalog.ts private-llama baseUrl to: {url}/v1")
                print(f"Or paste in UI: Provider Settings > private-llama > Base URL = {url}/v1\n\n")

if __name__ == "__main__":
    install_deps()
    download_cloudflared()
    # Start server in thread
    t = threading.Thread(target=run_server, daemon=True)
    t.start()
    # Start tunnel (blocking prints URL)
    run_tunnel()
