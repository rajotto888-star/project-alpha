# Arena to Tab A8 Command Broker Specification

## Goal
Arena.ai agent (this agent) can send auto-commands directly to Tab A8 Termux without 3rd party, via Project Alpha Cloudflare Worker.

## Architecture
- **Producer:** Arena.ai agent (or web UI) -> POST https://project-alpha-worker-production.rajotto888.workers.dev/api/broker/push
- **Queue:** D1 table `broker_commands` (id, device_id, command, payload, status, created_at, claimed_at, done_at, created_by)
- **Consumer:** Termux on Tab A8 polls GET /api/broker/poll?device_id=tab-a8 every 5s, claims pending commands
- **Ack:** Termux executes in bash, then POST /api/broker/ack {id, status: done|failed, result}

## Auth
- Uses same session cookie as Project Alpha (Google OAuth). Arena agent must have valid session (or use ephemeral broker secret in future).
- device_id default "tab-a8", can be any string.

## API

### POST /api/broker/push
```json
{
  "device_id": "tab-a8",
  "command": "ls -lh ~/project-alpha && pnpm -r test",
  "payload": {"source": "arena", "priority": "high"}
}
```
Response: `{ok:true, id, device_id, command, status:"pending"}`

### GET /api/broker/poll?device_id=tab-a8&limit=5
Returns pending commands and auto-claims them to "claimed".

### POST /api/broker/ack
```json
{
  "id": "abc123",
  "status": "done",
  "result": "Test Files 21 passed..."
}
```

### GET /api/broker/list?device_id=tab-a8&limit=20
List recent commands for UI.

## Termux Client (Tab A8)
```bash
#!/data/data/com.termux/files/usr/bin/bash
WORKER="https://project-alpha-worker-production.rajotto888.workers.dev"
COOKIE="__Host-session=YOUR_SESSION_COOKIE"
while true; do
  RES=$(curl -s -H "Cookie: $COOKIE" "$WORKER/api/broker/poll?device_id=tab-a8")
  echo "$RES" | jq -r '.commands[]?.command' | while read -r CMD; do
    ID=$(echo "$RES" | jq -r '.commands[]?.id' | head -n1)
    OUT=$(bash -c "$CMD" 2>&1 | tail -c 18000)
    curl -s -X POST -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
      -d "{\"id\":\"$ID\",\"status\":\"done\",\"result\":$(echo "$OUT" | jq -Rs .)}" \
      "$WORKER/api/broker/ack" > /dev/null
  done
  sleep 5
done
```

## Security
- No secrets in command payload (use <REDACTED> pattern)
- Commands are scoped per user_id (created_by)
- Status flow: pending -> claimed -> done/failed
- Indexes on device_id+status for fast poll

## Future
- Add X-BROKER-SECRET header for Arena.ai direct auth without cookie
- Add SSE push to Termux via WebSocket for instant delivery
- Add command allowlist to prevent dangerous rm -rf /

Version: 8.08.0
Endpoint: https://project-alpha-worker-production.rajotto888.workers.dev/api/broker/*
