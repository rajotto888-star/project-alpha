# Kaggle Burst Compute - Project Alpha

**Purpose:** Use free 30h T4/P100 weekly + 20h TPU for training/inference.

**How to use in Kaggle:**
1. Go to https://kaggle.com/code > New Notebook
2. Settings (right panel) > Accelerator > GPU T4 x2, Internet ON
3. Paste `colab_kaggle_openai_server.py` (same file works for Kaggle) and run
4. Same as Colab: installs, loads model, starts server, opens cloudflared tunnel
5. Copy `https://xxxx.trycloudflare.com/v1` URL
6. Update Project Alpha gateway: `private-llama` baseUrl = that URL

**Advantage over Colab:** 30h weekly vs 12h, 2x T4 available, 9h per session.

**For training:** Use Kaggle notebook to fine-tune, then push model to HF Hub, then deploy to HF Space for semi-stable hosting.
