# Project Alpha - Free Compute Gateway Master Plan
**Architecture: Stable Gateway + Ephemeral Burst Compute**

Free cloud compute (Colab, Kaggle) is ephemeral and resets, cannot be used as permanent server. Project Alpha uses pattern:

## 1. HF Spaces (Semi-Stable Node)
- **Purpose:** Small/medium models (SmolLM2-1.7B, Llama-3-8B, Qwen-7B) on CPU or Free ZeroGPU
- **Implementation:** `free-compute-templates/hf-space/app.py` - FastAPI + transformers, OpenAI compatible
- **Deploy:** Create Space (Docker SDK) on HF, upload app.py, requirements.txt, Dockerfile, set MODEL_ID env
- **Result:** Permanent public URL `https://<space>.hf.space/v1`
- **Integration:** Update `catalog.ts` private-smollm or private-llama baseUrl to Space URL, or add new provider `hf-space`

## 2. Colab & Kaggle (Burst / On-Demand)
- **Purpose:** Heavy model or GPU needed instantly via free T4/P100
- **Implementation:** `free-compute-templates/colab/colab_kaggle_openai_server.py` - Loads model locally, starts FastAPI, opens cloudflared tunnel
- **Deploy:** Run notebook in Colab (T4) or Kaggle (T4 x2, Internet ON), it prints `https://xxxx.trycloudflare.com/v1`
- **Integration:** Copy tunnel URL into Project Alpha Provider Settings > private-llama Base URL, or update catalog.ts. Gateway routes to Colab/Kaggle GPU.
- **Limit:** Colab 12h/session, Kaggle 30h/week, resets when notebook stops - thus "burst" only

## 3. Gateway Registry (Project Alpha Worker)
- Worker has `registry.json` or `catalog.ts` that maps provider_id -> baseUrl
- Stable: `private-smollm` -> HF Space (always on)
- Burst: `private-llama` -> Colab/Kaggle tunnel URL (updated manually when notebook runs)
- Future: Auto-registry via broker - Colab notebook can POST its tunnel URL to `/api/broker/push` device_id=colab-node, worker can auto-update KV

## 4. Security & SSRF Guard
- All custom baseUrls go through `ssrfGuard.ts` - only allows https, no private IPs, no localhost
- Cloudflare tunnel URLs (`*.trycloudflare.com`) are allowed (public, ephemeral)
- HF Space URLs (`*.hf.space`) allowed

## 5. Workflow Example
1. User needs Llama-3.2-3B for heavy task
2. Opens Colab, runs `colab_kaggle_openai_server.py` with MODEL_ID=meta-llama/Llama-3.2-3B-Instruct
3. Gets URL `https://abc-123.trycloudflare.com/v1`
4. Pastes into Project Alpha UI > Provider Settings > private-llama
5. Chat requests with model `llama-3.2-3b-instruct` now routed to Colab GPU
6. When done, stops Colab, gateway falls back to HF Space or Groq

## 6. Files
- `free-compute-templates/hf-space/app.py` - HF Space server
- `free-compute-templates/colab/colab_kaggle_openai_server.py` - Colab/Kaggle server + tunnel
- `free-compute-templates/kaggle/` - same file, README for Kaggle specifics
- `apps/worker/src/providers/catalog.ts` - registry (private-llama, private-smollm, hf-space, colab, kaggle)

## 7. Next Steps (Done)
- [x] HF Space template created
- [x] Colab/Kaggle template created
- [x] Docs written
- [x] Catalog updated to include private-llama, private-smollm with gateway URLs
- [ ] Deploy HF Space to huggingface.co (user action)
- [ ] Run Colab notebook to test tunnel (user action when needed)
