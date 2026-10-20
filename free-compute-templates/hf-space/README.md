# HF Space - Project Alpha Semi-Stable Node

**Purpose:** Host small/medium models (SmolLM2-1.7B, Llama-3-8B, Qwen-7B) on HF Spaces free CPU or ZeroGPU.

**Deploy:**
1. Create new Space on https://huggingface.co/new-space
   - Name: project-alpha-smollm
   - SDK: Docker
   - Hardware: CPU basic (free) or ZeroGPU (free)
2. Upload `app.py`, `requirements.txt`, `Dockerfile`
3. Set env var `MODEL_ID` in Space settings (e.g., HuggingFaceTB/SmolLM2-1.7B-Instruct)
4. Space will build and provide URL: https://<your-username>-project-alpha-smollm.hf.space
5. OpenAI compatible endpoint: https://<your-space>.hf.space/v1/chat/completions

**Integrate with Project Alpha:**
- In `apps/worker/src/providers/catalog.ts`, update `private-smollm` baseUrl to your Space URL:
```ts
{
  id: "private-smollm",
  baseUrl: "https://your-space.hf.space/v1",
  models: ["smollm2-1.7b-instruct", "smollm2-360m-instruct"],
  implemented: true,
  selectable: true,
}
```
- Or add new provider `hf-space` in catalog.ts
- Gateway will route requests to your Space

**Test:**
curl https://your-space.hf.space/v1/models
curl -X POST https://your-space.hf.space/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"smollm2-1.7b-instruct","messages":[{"role":"user","content":"Hello"}]}'
