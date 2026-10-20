# Project Reboot — Agent Reboot (Offline Voice Agent)

**Project Alpha** = current cloud-native AI orchestrator (Worker + D1 + KV + React, 12 providers 46 models, cookie-only auth, vault ephemeral header, SSRF hardened, free compute gateway hf-space/colab/kaggle)

**Project Reboot** = offline gift for Tab SM-X200 (basay) — background service voice agent, more skills than AI assistant, offline version of assistant's brain/power, can be APK/software any form, all access for user's work, research permission full, may use custom model from colab/kaggle.

Agent name: **Agent Reboot**

## Purpose
Tab has Gemini app premium subscription but useless. Agent Reboot will take its access and use it for tasks, plus be background service not just terminal, voice command + voice response, offline brain.

## Architecture: Project Reboot

### 1. Core Components (from existing files)
- `offline-ai-agent.py` — main offline brain (already in workspace)
- `offline-research-agent.py` — PC research agent that polls free models every ~1min, saves colab/kaggle/hf research JSON
- `broker-poller-pc-public.ps1` — PC poller for command broker
- `boot-voice-agent.sh` — Tab boot voice agent starter
- `tab-unified-worker.sh` — Tab unified worker (needs fix - buffering issue)
- `custom-model-loader.py` — loads custom model from colab/kaggle
- `gemini-bridge.py` — uses Gemini premium subscription via bridge
- `pixel-control.sh` — pixel control for Tab

### 2. Agent Reboot Features
- **Voice Command + Voice Response**: background service listening, STT -> LLM -> TTS
- **Offline Brain**: uses small model (SmolLM2-1.7B, Llama-3.2-3B) loaded via transformers, quantized, runs on Tab CPU
- **Online Fallback**: when internet available, uses Project Alpha gateway (groq, openrouter free, hf-space, colab tunnel, kaggle tunnel)
- **Skills > AI Assistant**: file operations, research, code execution, Drive sync, GitHub push, Cloudflare deploy, PC control via broker
- **Background Service**: not just terminal, runs as Android background service / Termux boot, or APK
- **APK Form**: can be built as Kivy/Buildozer APK or as Termux:Boot script

### 3. Free Compute Integration (Project Alpha -> Reboot)
- **HF Space** (`free-compute-templates/hf-space/`): semi-stable node for SmolLM2, always-on URL `https://<space>.hf.space/v1` -> Agent Reboot uses as remote brain when offline model too weak
- **Colab Burst** (`free-compute-templates/colab/`): on-demand T4 GPU, runs `colab_kaggle_openai_server.py` + cloudflared tunnel `https://xxxx.trycloudflare.com/v1` -> Agent Reboot can request user to start Colab for heavy tasks
- **Kaggle Burst** (`free-compute-templates/kaggle/`): same, T4 x2 30h/week
- Registry: `free-compute-templates/registry.json` + `free_models.json` (now includes hf_space, colab, kaggle)

### 4. Command Broker (Arena to Tab A8 Spec)
- Spec: `docs/01_ARENA_TO_TAB_A8_COMMAND_BROKER_SPECIFICATION.md`
- Worker route: `/api/broker/*` (already live, 200 OK)
- PC `pc-main` ONLINE, Tab `tab-main` basay with workers PID 19076/20498/22285 (claim works but ack fails due to curl buffering - needs ultra-worker fix)
- Agent Reboot will be a broker worker that polls `/api/broker/poll?device_id=tab-main` and executes commands

### 5. Security
- Vault: ephemeral header-first `X-EPHEMERAL-KEYS` base64 JSON, no secret persistence, AES-GCM in IndexedDB
- SSRF guard: hardened for custom baseUrl, allows private IPs only for local providers (private-llama, colab, kaggle, hf-space) when custom endpoint set via `X-CUSTOM-ENDPOINTS` header
- Custom endpoints: `localStorage.custom_endpoints` for Android Private LM (e.g., `http://192.168.1.10:8080/v1`)

### 6. Tab SM-X200 Specific
- Device: Samsung Tab A8 SM-X200, battery 53%, basay
- Termux: installed, workers running but ack failing (curl + python json.dumps issue)
- Fix: `python3 -u` unbuffered + `flush=True`, ultra-worker.sh with curl + python
- Background service: use Termux:Boot + Termux:API for voice, or build APK via Buildozer

### 7. Project Structure
```
Project Alpha/ (cloud orchestrator)
  apps/worker/ (12 providers)
  apps/web/ (chat, providers, keys with custom endpoint UI)
  free-compute-templates/
    hf-space/ (FastAPI + transformers, Dockerfile, requirements.txt)
    colab/ (colab_kaggle_openai_server.py + README)
    kaggle/ (same)
  docs/
    PROJECT_REBOOT_SPEC.md (this file)
    ANDROID_PRIVATE_LM_SETUP.md
    FREE_COMPUTE_GATEWAY_PLAN.md

Project Reboot/ (offline agent) -> Agent Reboot
  offline-ai-agent.py (brain)
  offline-research-agent.py (research free models)
  gemini-bridge.py (use Gemini premium)
  boot-voice-agent.sh (Tab boot)
  agent-reboot/
    main.py (voice loop)
    stt.py (speech to text)
    tts.py (text to speech)
    skills/ (file, research, code, drive, github, cloudflare, pc control)
    models/ (SmolLM2-1.7B quantized)
    service/ (Android background service)
```

### 8. Next Steps for Agent Reboot
- [x] Project Alpha 12 providers live (groq 6, openrouter 26, private-llama 2, private-smollm 2, hf-space 3, colab 3, kaggle 2, openai 2)
- [x] Free compute templates created + Drive uploaded
- [x] SSRF guard hardened for custom baseUrl + Android Private LM
- [x] Chat fallback + Provider model display + Keys grid + Login only password UI
- [ ] Fix Tab worker ack (ultra-worker curl buffering)
- [ ] Build Agent Reboot APK or Termux background service with voice
- [ ] Deploy HF Space for stable small model
- [ ] Test Colab/Kaggle burst via tunnel
- [ ] Integrate Gemini premium bridge

## Naming Convention
- **Project Alpha**: cloud orchestrator, always referred as "project alpha"
- **Project Reboot**: offline agent project, folder `project-reboot` or `agent-reboot`
- **Agent Reboot**: the actual agent/service running on Tab, background voice agent

All future tasks for offline agent should use "Project Reboot" / "Agent Reboot" naming, not "Tab gift" or other names.

Version: Project Alpha V8.06 + Project Reboot V1.0
Live: https://project-alpha-worker-production.rajotto888.workers.dev
GitHub: rajotto888-star/project-alpha main b0a0cdd
Drive: Project Alpha All doc 106N1-l-nlTvp1IH8qgKJb1u19-yttLEA + free-compute-templates 1ftqDcueePfFpMQsDp_1uWxoiWVnT_-S8
