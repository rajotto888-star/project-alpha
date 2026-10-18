#!/data/data/com.termux/files/usr/bin/bash
# Tab Unified Worker - OFFLINE + ONLINE
# Dine PC, Rate Tab workflow
# Basay internet thakle online, baire offline task cholbe

WORKER="https://project-alpha-worker-production.rajotto888.workers.dev"
DEVICE="tab-main"
BASE="$HOME/tab-work"
OFFLINE_Q="$BASE/offline-queue"
OFFLINE_DONE="$BASE/offline-done"
OFFLINE_RESULTS="$BASE/offline-results"
OFFLINE_SYNCED="$BASE/offline-synced"
ONLINE_LOG="$BASE/online-log"

mkdir -p "$OFFLINE_Q" "$OFFLINE_DONE" "$OFFLINE_RESULTS" "$OFFLINE_SYNCED" "$ONLINE_LOG"

echo "=========================================="
echo "[*] Tab Unified Worker - $DEVICE"
echo "[*] Mode: OFFLINE + ONLINE (auto switch)"
echo "[*] Base: $BASE"
echo "[*] Worker: $WORKER"
echo "[*] Time: $(date)"
echo "=========================================="
echo "[*] Offline queue: $OFFLINE_Q"
echo "[*] Online: broker poll every 5s when internet"
echo ""

# Install jq if needed
if ! command -v jq &> /dev/null; then
  pkg install -y jq 2>/dev/null
fi

check_internet() {
  curl -s --max-time 8 "$WORKER/api/broker/poll?device_id=$DEVICE&limit=1" > /dev/null 2>&1
  return $?
}

execute_command() {
  local CMD="$1"
  local LOG_PREFIX="$2"
  echo ">> $CMD"
  OUT=$(eval "$CMD 2>&1")
  EXIT_CODE=$?
  echo "$OUT"
  echo "---EXIT:$EXIT_CODE---"
  return $EXIT_CODE
}

# Offline worker - always runs even without internet
process_offline_queue() {
  for task_file in "$OFFLINE_Q"/*.task "$OFFLINE_Q"/*.sh 2>/dev/null; do
    [ -e "$task_file" ] || continue
    FNAME=$(basename "$task_file")
    echo ""
    echo "[OFFLINE] Found: $FNAME at $(date +%H:%M:%S)"
    CMD=$(cat "$task_file")
    echo ">> $CMD"
    
    RESULT_FILE="$OFFLINE_RESULTS/${FNAME%.task}_$(date +%Y%m%d_%H%M%S).result"
    {
      echo "=== OFFLINE TASK: $FNAME ==="
      echo "Time: $(date)"
      echo "Command: $CMD"
      echo "---OUTPUT---"
      eval "$CMD 2>&1"
      echo ""
      echo "---EXIT:$?---"
    } > "$RESULT_FILE" 2>&1
    
    cat "$RESULT_FILE"
    mv "$task_file" "$OFFLINE_DONE/"
    echo "[OFFLINE] Done -> $RESULT_FILE"
  done
}

# Sync offline results to broker when online (so PC can see next day)
sync_offline_results() {
  if [ "$(ls -A $OFFLINE_RESULTS 2>/dev/null)" ]; then
    echo ""
    echo "[SYNC] Found offline results to sync to PC..."
    for res in "$OFFLINE_RESULTS"/*.result; do
      [ -e "$res" ] || continue
      BNAME=$(basename "$res")
      CONTENT=$(cat "$res" | head -c 8000 | jq -Rs . 2>/dev/null)
      if [ -n "$CONTENT" ]; then
        # Push to pc-main as notification
        BODY=$(jq -n --arg content "$CONTENT" --arg fname "$BNAME" '{device_id:"pc-main", command: ("echo [TAB-OFFLINE-RESULT: " + $fname + "] && echo " + $content)}' 2>/dev/null)
        # Alternative simple push
        curl -s -X POST "$WORKER/api/broker/push" \
          -H "Content-Type: application/json" \
          -d "{\"device_id\":\"pc-main\",\"command\":\"echo '[TAB-OFFLINE $BNAME]'\"}" > /dev/null 2>&1
        echo "[SYNC] Pushed $BNAME to pc-main"
        mv "$res" "$OFFLINE_SYNCED/"
      fi
    done
  fi
}

# Main loop
while true; do
  # 1. Always process offline queue (no internet needed)
  process_offline_queue
  
  # 2. Check internet
  if check_internet; then
    echo -n "[ONLINE] "
    
    # Sync offline results first
    sync_offline_results
    
    # Poll broker for tab-main
    RES=$(curl -s --max-time 20 "$WORKER/api/broker/poll?device_id=$DEVICE&limit=5")
    COUNT=$(echo "$RES" | jq -r '.commands | length' 2>/dev/null || echo "0")
    
    if [ "$COUNT" != "0" ] && [ "$COUNT" != "null" ] && [ "$COUNT" -gt 0 ] 2>/dev/null; then
      echo ""
      echo "[ONLINE] $COUNT command(s) from broker"
      
      echo "$RES" | jq -c '.commands[]' 2>/dev/null | while read -r cmd_json; do
        ID=$(echo "$cmd_json" | jq -r '.id')
        COMMAND=$(echo "$cmd_json" | jq -r '.command')
        
        echo ">> $COMMAND"
        OUT=$(eval "$COMMAND 2>&1" | head -c 18000)
        [ -z "$OUT" ] && OUT="(no output)"
        
        RESULT_JSON=$(printf "%s" "$OUT" | jq -Rs .)
        BODY=$(jq -n --arg id "$ID" --argjson result "$RESULT_JSON" '{id:$id, status:"done", result:$result}')
        
        curl -s -X POST "$WORKER/api/broker/ack" \
          -H "Content-Type: application/json" \
          -d "$BODY" > /dev/null
        
        echo "[ONLINE] Ack $ID"
        echo "$(date): $COMMAND -> done" >> "$ONLINE_LOG/online-$(date +%Y%m%d).log"
      done
    else
      echo -n "."
    fi
  else
    echo -n "[OFFLINE] No internet - only offline tasks $(date +%H:%M:%S) "
    echo -n "."
  fi
  
  sleep 5
done
