#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OPENCLAW_BASE_URL:-${OPENCLAW_GATEWAY_URL:-http://127.0.0.1:18789}}"
BASE_URL="${BASE_URL%/}"
CONTRACT_VERSION="${OPENCLAW_CONTRACT_VERSION:-${DCF_RUNTIME_CONTRACT_VERSION:-v1}}"
TOKEN="${OPENCLAW_API_KEY:-${OPENCLAW_GATEWAY_TOKEN:-}}"
CURL_TIMEOUT_SEC="${DCF_BROWSER_VERIFY_CURL_TIMEOUT_SEC:-15}"
VERIFY_TIMEOUT_MS="${DCF_BROWSER_VERIFY_TIMEOUT_MS:-90000}"
VERIFY_POLL_MS="${DCF_BROWSER_VERIFY_POLL_MS:-1000}"
VERIFY_URL="${DCF_BROWSER_VERIFY_URL:-https://example.com}"
EXPECT_TEXT="${DCF_BROWSER_EXPECT_TEXT:-Example Domain}"

if ! [[ "$CURL_TIMEOUT_SEC" =~ ^[0-9]+$ ]] || [ "$CURL_TIMEOUT_SEC" -le 0 ]; then
  CURL_TIMEOUT_SEC=15
fi
if ! [[ "$VERIFY_TIMEOUT_MS" =~ ^[0-9]+$ ]] || [ "$VERIFY_TIMEOUT_MS" -le 0 ]; then
  VERIFY_TIMEOUT_MS=90000
fi
if ! [[ "$VERIFY_POLL_MS" =~ ^[0-9]+$ ]] || [ "$VERIFY_POLL_MS" -le 0 ]; then
  VERIFY_POLL_MS=1000
fi

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

auth_curl() {
  if [ -n "$TOKEN" ]; then
    curl -sS -m "$CURL_TIMEOUT_SEC" "$@" -H "Authorization: Bearer $TOKEN"
  else
    curl -sS -m "$CURL_TIMEOUT_SEC" "$@"
  fi
}

auth_curl_retry() {
  local attempts="${DCF_BROWSER_VERIFY_RETRY:-3}"
  if ! [[ "$attempts" =~ ^[0-9]+$ ]] || [ "$attempts" -le 0 ]; then
    attempts=3
  fi
  local i=1
  while [ "$i" -le "$attempts" ]; do
    if output="$(auth_curl "$@" 2>&1)"; then
      printf '%s' "$output"
      return 0
    fi
    if [ "$i" -ge "$attempts" ]; then
      echo "$output" >&2
      return 1
    fi
    sleep 0.4
    i=$((i + 1))
  done
}

TASK_ID="browser-capability-$(date +%s)-$$"
SUBMIT_PAYLOAD="$(cat <<JSON
{"taskId":"$TASK_ID","employeeId":"browser-capability-checker","employeeCode":"browser-capability-checker","conversationId":"browser-capability-check","goal":"Use browser tool to open $VERIFY_URL. Return only the page title.","riskLevel":"L2","toolScope":["browser"]}
JSON
)"

submit_json="$(auth_curl_retry \
  -X POST "$BASE_URL/runtime/tasks" \
  -H "Content-Type: application/json" \
  -H "X-Contract-Version: $CONTRACT_VERSION" \
  -d "$SUBMIT_PAYLOAD")"

runtime_task_id="$(printf '%s' "$submit_json" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(String(o.runtimeTaskId||o.taskId||""));')"
if [ -z "$runtime_task_id" ]; then
  echo "{\"ok\":false,\"error\":\"submit response missing runtimeTaskId\",\"submit\":\"$(printf '%s' "$submit_json" | tr '"' "'" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-300)'\"}"
  exit 1
fi

status_json=""
final_status=""
deadline_ms=$(( $(now_ms) + VERIFY_TIMEOUT_MS ))
while [ "$(now_ms)" -lt "$deadline_ms" ]; do
  status_json="$(auth_curl_retry \
    -X GET "$BASE_URL/runtime/tasks/$runtime_task_id" \
    -H "X-Contract-Version: $CONTRACT_VERSION")"
  final_status="$(printf '%s' "$status_json" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(String((o.status||(o.task&&o.task.status)||"")).toLowerCase());')"
  if [ "$final_status" = "succeeded" ] || [ "$final_status" = "failed" ] || [ "$final_status" = "aborted" ]; then
    break
  fi
  sleep_sec="$(node -e "process.stdout.write(String((${VERIFY_POLL_MS})/1000))")"
  sleep "$sleep_sec"
done

events_json="$(auth_curl_retry \
  -X GET "$BASE_URL/runtime/tasks/$runtime_task_id/events" \
  -H "X-Contract-Version: $CONTRACT_VERSION" || true)"

result_text="$(printf '%s' "$status_json" | node -e 'const fs=require("fs");const o=JSON.parse(fs.readFileSync(0,"utf8"));const r=o.result;let t="";if(typeof r==="string") t=r; else if(r&&typeof r==="object") t=String(r.output_text||r.content||r.text||""); else t=String(o.output_text||"");process.stdout.write(t);')"
events_count="$(printf '%s' "$events_json" | node -e 'const fs=require("fs");let raw="";try{raw=fs.readFileSync(0,"utf8")}catch{};let c=0;try{const o=JSON.parse(raw);if(Array.isArray(o)) c=o.length;}catch{};process.stdout.write(String(c));')"

if [ "$final_status" != "succeeded" ]; then
  echo "{\"ok\":false,\"baseUrl\":\"$BASE_URL\",\"runtimeTaskId\":\"$runtime_task_id\",\"finalStatus\":\"${final_status:-unknown}\",\"eventsCount\":$events_count}"
  exit 1
fi

if [ -n "$EXPECT_TEXT" ] && [[ "$result_text" != *"$EXPECT_TEXT"* ]]; then
  trimmed="$(printf '%s' "$result_text" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-220)"
  echo "{\"ok\":false,\"baseUrl\":\"$BASE_URL\",\"runtimeTaskId\":\"$runtime_task_id\",\"finalStatus\":\"$final_status\",\"expectedText\":\"$EXPECT_TEXT\",\"resultText\":\"$trimmed\",\"eventsCount\":$events_count}"
  exit 1
fi

trimmed="$(printf '%s' "$result_text" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-220)"
echo "{\"ok\":true,\"baseUrl\":\"$BASE_URL\",\"contractVersion\":\"$CONTRACT_VERSION\",\"runtimeTaskId\":\"$runtime_task_id\",\"finalStatus\":\"$final_status\",\"expectedText\":\"$EXPECT_TEXT\",\"resultText\":\"$trimmed\",\"eventsCount\":$events_count}"
