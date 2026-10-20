# Android Private LM Setup for Project Alpha

Your Android has a Private LLM app (e.g., PocketPal, MLC Chat, LocalAI, or custom). Project Alpha can connect to it.

## Option 1: Direct Local Network (Same WiFi) - For Testing

1. On Android, start your Private LM app and enable its OpenAI-compatible server.
   - Example: PocketPal -> Settings -> Enable API Server -> Port 8080
   - Note the IP: e.g., `http://192.168.1.10:8080/v1`

2. In Project Alpha web app:
   - Go to **Providers** tab
   - Find **private-llama** (or private-smollm)
   - In "Custom endpoint" field, enter: `http://192.168.1.10:8080/v1`
   - Click **Save URL**
   - Enable **private-llama** checkbox, select model `llama-3.2-3b-instruct`
   - Click **Save preferences**
   - Go to **Role assignments**, set PTM to `private-llama / llama-3.2-3b-instruct`
   - Go to **Keys** tab, add key for private-llama: any string like `android-local-key`
   - Now chat will use your Android LLM

Note: SSRF guard allows private IPs (192.168.x.x, 10.x.x.x) and http only for private-llama/colab/kaggle/hf-space when custom endpoint is set. Public providers (groq, openrouter, openai) still require https.

## Option 2: Public Tunnel (Recommended for Production) - Works from Anywhere

If direct local IP doesn't work (Cloudflare Worker can't reach your private IP), use cloudflared tunnel:

On Android (Termux):
```bash
pkg install cloudflared
# If your LM runs on localhost:8080
cloudflared tunnel --url http://localhost:8080
```
It will print: `https://xxxx-xxxx-xxxx.trycloudflare.com`

Then in Project Alpha Providers tab, set private-llama custom endpoint to:
`https://xxxx-xxxx-xxxx.trycloudflare.com/v1`

This is https, public, and bypasses private IP restriction. It's the same pattern as Colab/Kaggle burst.

## Option 3: HF Space as Stable Gateway

If Android app is slow, deploy a small model to HF Spaces (free) using `free-compute-templates/hf-space/` and use that as private-smollm.

## Troubleshooting Chat Not Replying

If chat shows "hey hello" but no reply:
1. Check **Keys** tab: you need at least one key saved (groq, openrouter, or private-llama)
2. Check **Providers** tab: enable at least groq or private-llama, select model, Save preferences
3. Check **Role assignments**: PTM and VCM must be set, or chat will fallback to first available key
4. Check browser console (F12) for errors: missing ephemeral keys, etc.
5. Ensure vault is unlocked (green header)

## Provider Model Display Fix

Previously, model select showed blank. Now it shows:
- Provider id with enabled status and current model: e.g., `groq ✅ enabled — model: llama-3.3-70b-versatile`
- Model dropdown defaults to first model if none selected
- First-time defaults: groq, openrouter, openai enabled with first model

## Login Only Password Option

Previously locked screen showed Auto-login, Google, Sign out buttons. Now:
- Only vault passphrase input + Unlock/Create buttons visible by default
- Advanced login (Google / Auto-login) hidden behind <details> "Advanced login"
- Auto-login still happens silently in background for default-user

## All Provider Keys Display

Previously Keys tab showed only one dropdown. Now:
- Quick add single key (dropdown + input)
- Grid of all providers showing ✅ key saved or ❌ no key with masked key preview
- Instructions for where to get keys

## Security: Vault Ephemeral Header

- Keys live only in browser, encrypted with AES-GCM, never stored on server
- Ephemeral header: X-EPHEMERAL-KEYS base64 JSON, header-first, body fallback only when header absent
- Custom endpoints: X-CUSTOM-ENDPOINTS base64 JSON for Android/Colab/HF Space overrides
- SSRF guard: blocks metadata, allows private IPs only for local providers when custom endpoint set
