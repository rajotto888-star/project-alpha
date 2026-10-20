# Colab Burst Compute - Project Alpha

**Purpose:** Heavy model or GPU needed instantly via free T4.

**How to use in Google Colab:**
1. Go to https://colab.research.google.com > New notebook
2. Runtime > Change runtime type > T4 GPU
3. Paste `colab_kaggle_openai_server.py` content into cell and run
4. It will install deps, load model (e.g., Llama-3.2-3B), start FastAPI on :8000
5. Last line opens Cloudflare Quick Tunnel via `cloudflared`
6. Output shows: `https://xxxx.trycloudflare.com` - COPY this URL
7. In Project Alpha: Provider Settings > private-llama > Base URL = `https://xxxx.trycloudflare.com/v1`
8. Now Project Alpha will route requests to your Colab GPU!

**Limit:** 12h per session, 30h/week, resets when notebook stops.

**Model env:** Set `MODEL_ID` env before running:
```python
%env MODEL_ID=meta-llama/Llama-3.2-3B-Instruct
%env PORT=8000
```
