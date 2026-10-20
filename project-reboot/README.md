# Project Reboot

Offline voice agent for Tab SM-X200 (basay). Agent name: **Agent Reboot**.

This is separate from **Project Alpha** (cloud orchestrator). Project Reboot is the offline gift.

See `../docs/PROJECT_REBOOT_SPEC.md` for full spec.

## Quick Start

- `agent-reboot/main.py` - voice loop (STT -> LLM -> TTS)
- `../offline-ai-agent.py` - existing offline brain
- `../free-compute-templates/` - HF Space / Colab / Kaggle templates for remote brain

## Naming
- Project Alpha = cloud orchestrator (current project)
- Project Reboot = offline agent project (this folder)
- Agent Reboot = actual background voice service on Tab
