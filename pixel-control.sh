#!/data/data/com.termux/files/usr/bin/bash
# Pixel Phone - Control Plane (only input, no worker)
# Built-in terminal developer option theke chalabe
# Dine PC, Rate Tab workflow control

WORKER="https://project-alpha-worker-production.rajotto888.workers.dev"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Pixel Control Plane ===${NC}"
echo "Dine PC (pc-main), Rate Tab (tab-main)"
echo "Worker: $WORKER"
echo ""

# Functions for easy push
push-pc() {
  # Usage: push-pc "your command"
  local CMD="$*"
  if [ -z "$CMD" ]; then
    echo "Usage: push-pc \"command\""
    return 1
  fi
  echo -e "${CYAN}[-> PC] $CMD${NC}"
  curl -s -X POST "$WORKER/api/broker/push" \
    -H "Content-Type: application/json" \
    -d "{\"device_id\":\"pc-main\",\"command\":$(echo "$CMD" | jq -Rs .)}" | jq
}

push-tab() {
  # Usage: push-tab "your command"
  local CMD="$*"
  if [ -z "$CMD" ]; then
    echo "Usage: push-tab \"command\""
    return 1
  fi
  echo -e "${YELLOW}[-> TAB] $CMD${NC}"
  curl -s -X POST "$WORKER/api/broker/push" \
    -H "Content-Type: application/json" \
    -d "{\"device_id\":\"tab-main\",\"command\":$(echo "$CMD" | jq -Rs .)}" | jq
}

push-tab-offline() {
  # Add offline task to Tab (will run even without internet)
  # This creates a file in Tab's offline queue via broker? 
  # Actually offline tasks are local to Tab, but we can push as online that Tab will save as offline
  local CMD="$*"
  if [ -z "$CMD" ]; then
    echo "Usage: push-tab-offline \"command\""
    return 1
  fi
  # Push as special command that Tab worker will save to offline queue
  local WRAPPER="mkdir -p ~/tab-work/offline-queue && echo $(echo "$CMD" | jq -Rs .) > ~/tab-work/offline-queue/offline_\$(date +%s).task && echo 'Offline task added: $CMD'"
  echo -e "${YELLOW}[-> TAB OFFLINE] $CMD${NC}"
  curl -s -X POST "$WORKER/api/broker/push" \
    -H "Content-Type: application/json" \
    -d "{\"device_id\":\"tab-main\",\"command\":$(echo "$WRAPPER" | jq -Rs .)}" | jq
}

list-pc() {
  echo -e "${GREEN}=== PC Results (pc-main) ===${NC}"
  curl -s "$WORKER/api/broker/list?device_id=pc-main&limit=10" | jq -r '.commands[] | "\(.created_at) | \(.status) | \(.command) | \(.result | .[0:200])"'
}

list-tab() {
  echo -e "${YELLOW}=== Tab Results (tab-main) ===${NC}"
  curl -s "$WORKER/api/broker/list?device_id=tab-main&limit=10" | jq
}

list-tab-short() {
  curl -s "$WORKER/api/broker/list?device_id=tab-main&limit=5" | jq -r '.commands[] | "[\(.status)] \(.command) => \(.result | .[0:300])"'
}

check-status() {
  echo -e "${GREEN}=== Broker Status ===${NC}"
  echo "PC:"
  curl -s "$WORKER/api/broker/poll?device_id=pc-main&limit=1" | jq
  echo "Tab:"
  curl -s "$WORKER/api/broker/poll?device_id=tab-main&limit=1" | jq
  echo "Pixel:"
  curl -s "$WORKER/api/broker/poll?device_id=pixel-main&limit=1" | jq
}

# Help
help() {
  echo "Commands:"
  echo "  push-pc \"ls D:\"              -> Push to PC (workstation)"
  echo "  push-tab \"pwd; ls\"           -> Push to Tab (when online at home)"
  echo "  push-tab-offline \"echo hi\"   -> Add offline task to Tab (runs even without internet)"
  echo "  list-pc                        -> See PC results"
  echo "  list-tab                       -> See Tab results"
  echo "  list-tab-short                 -> Short Tab results"
  echo "  check-status                   -> Check all devices"
  echo ""
  echo "Workflow:"
  echo "  Dine: push-pc \"your work\""
  echo "  Rate: push-tab \"night task\" (Tab basay online hole run hobe)"
  echo "  Offline: push-tab-offline \"local file process\" (internet chara cholbe)"
}

# If no args, show help
if [ $# -eq 0 ]; then
  help
else
  "$@"
fi
