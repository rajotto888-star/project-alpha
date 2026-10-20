"""
Agent Reboot - Main Voice Loop for Project Reboot
Background service: voice command + voice response, offline brain + online fallback
Tab SM-X200 (basay) via Termux or APK
"""

import os
import sys
import time
import json
import threading

# Config
DEVICE_ID = "tab-main"
BROKER_URL = "https://project-alpha-worker-production.rajotto888.workers.dev/api/broker"
OFFLINE_MODEL = os.getenv("MODEL_ID", "HuggingFaceTB/SmolLM2-1.7B-Instruct")
USE_OFFLINE = True  # Try offline first, fallback to online gateway

print(f"[Agent Reboot] Starting - Project Reboot V1.0")
print(f"[Agent Reboot] Device: {DEVICE_ID}, Model: {OFFLINE_MODEL}")

# Try load offline model
model = None
tokenizer = None

def load_offline_model():
    global model, tokenizer
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        print(f"[Agent Reboot] Loading offline model {OFFLINE_MODEL}...")
        tokenizer = AutoTokenizer.from_pretrained(OFFLINE_MODEL)
        model = AutoModelForCausalLM.from_pretrained(
            OFFLINE_MODEL,
            torch_dtype="auto",
            device_map="auto",
            trust_remote_code=True
        )
        print(f"[Agent Reboot] Offline model loaded")
        return True
    except Exception as e:
        print(f"[Agent Reboot] Offline load failed: {e}, will use online gateway")
        return False

def offline_generate(prompt: str) -> str:
    if model is None:
        return ""
    try:
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        outputs = model.generate(**inputs, max_new_tokens=256, temperature=0.7, do_sample=True, pad_token_id=tokenizer.eos_token_id)
        return tokenizer.decode(outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)
    except Exception as e:
        print(f"[Agent Reboot] Offline generate error: {e}")
        return ""

def online_generate(prompt: str) -> str:
    """Use Project Alpha gateway (groq, openrouter free, hf-space, colab tunnel)"""
    try:
        import requests
        # Get custom endpoints from local file if exists
        custom_endpoints = {}
        try:
            with open("custom_endpoints.json", "r") as f:
                custom_endpoints = json.load(f)
        except:
            pass
        
        # Try gateway - uses vault keys? For Agent Reboot, use env keys or dummy for private-llama
        # This is placeholder - real impl would use Project Alpha's ephemeral header
        print(f"[Agent Reboot] Online fallback to Project Alpha gateway for: {prompt[:50]}...")
        # Mock response for now
        return f"[Online via Project Alpha] Response to: {prompt[:100]}"
    except Exception as e:
        print(f"[Agent Reboot] Online error: {e}")
        return f"Error: {e}"

def voice_loop():
    """Main loop: STT -> LLM -> TTS"""
    print("[Agent Reboot] Voice loop started - say 'Reboot' to wake")
    while True:
        try:
            # Placeholder for STT - in real Termux use termux-speech-to-text or Vosk
            # For now, text input
            prompt = input("You (voice/text): ")
            if not prompt.strip():
                continue
            if prompt.lower() in ["exit", "quit", "stop"]:
                print("[Agent Reboot] Stopping")
                break
            
            # Generate
            if USE_OFFLINE and model is not None:
                response = offline_generate(prompt)
                if not response:
                    response = online_generate(prompt)
            else:
                response = online_generate(prompt)
            
            print(f"Agent Reboot: {response}")
            
            # Placeholder for TTS - in real Termux use termux-tts-speak or espeak
            try:
                os.system(f'termux-tts-speak "{response[:200]}" 2>/dev/null || espeak "{response[:100]}" 2>/dev/null || echo "[TTS] {response[:50]}"')
            except:
                pass
                
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[Agent Reboot] Loop error: {e}")
            time.sleep(1)

if __name__ == "__main__":
    # Load offline model in background thread
    if USE_OFFLINE:
        threading.Thread(target=load_offline_model, daemon=True).start()
    
    voice_loop()
