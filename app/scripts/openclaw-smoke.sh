#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${DCF_BASE_URL:-http://127.0.0.1:8092}"
SMOKE_USER="${DCF_SMOKE_USERNAME:-admin}"
SMOKE_PASS="${DCF_SMOKE_PASSWORD:-admin123}"
COOKIE_JAR="${DCF_SMOKE_COOKIE_JAR:-/tmp/dcf-openclaw-smoke.cookie}"
SMOKE_CREATOR="u-smoke-$(date +%s)-$RANDOM-$$"
SMOKE_ACCEPT_FAILED="${DCF_SMOKE_ACCEPT_FAILED:-0}"

echo "[1/6] login"
rm -f "$COOKIE_JAR"
LOGIN_JSON="$(curl -sS -m 8 -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$SMOKE_USER\",\"password\":\"$SMOKE_PASS\"}")"
LOGIN_OK="$(echo "$LOGIN_JSON" | node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(o.ok===true));')"
if [[ "$LOGIN_OK" != "true" ]]; then
  echo "error: failed to login for smoke"
  echo "$LOGIN_JSON"
  exit 1
fi

echo "[2/6] create employee"
EMPLOYEE_JSON="$(curl -sS -m 5 -b "$COOKIE_JAR" -X POST "$BASE_URL/api/front/employees" \
  -H 'Content-Type: application/json' \
  -d "{\"creator\":\"$SMOKE_CREATOR\",\"name\":\"Smoke Ops\",\"department\":\"OPS\",\"role\":\"Operator\"}")"
EMPLOYEE_ID="$(echo "$EMPLOYEE_JSON" | node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(o.id||""));')"
if [[ -z "$EMPLOYEE_ID" ]]; then
  if echo "$EMPLOYEE_JSON" | grep -q 'each creator can only create one parent digital employee'; then
    EMPLOYEE_LIST="$(curl -sS -m 5 -b "$COOKIE_JAR" "$BASE_URL/api/front/employees")"
    EMPLOYEE_ID="$(echo "$EMPLOYEE_LIST" | node -e 'const fs=require("fs"); const arr=JSON.parse(fs.readFileSync(0,"utf8")); const row=Array.isArray(arr)&&arr.length?arr[0]:null; process.stdout.write(String((row&&row.id)||""));')"
  fi
  if [[ -z "$EMPLOYEE_ID" ]]; then
    echo "error: failed to create employee"
    echo "$EMPLOYEE_JSON"
    exit 1
  fi
fi
echo "employee_id=$EMPLOYEE_ID"

echo "[3/6] submit task"
TASK_JSON="$(curl -sS -m 5 -b "$COOKIE_JAR" -X POST "$BASE_URL/api/front/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"employeeId\":\"$EMPLOYEE_ID\",\"goal\":\"smoke task via openclaw\",\"riskLevel\":\"L2\",\"conversationId\":\"smoke-thread\"}")"
TASK_ID="$(echo "$TASK_JSON" | node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(o.id||""));')"
if [[ -z "$TASK_ID" ]]; then
  echo "error: failed to create task"
  echo "$TASK_JSON"
  exit 1
fi
echo "task_id=$TASK_ID"

echo "[4/6] wait for task completion"
ATTEMPTS=20
STATUS=""
for ((i=1; i<=ATTEMPTS; i++)); do
  TASKS="$(curl -sS -m 5 -b "$COOKIE_JAR" "$BASE_URL/api/front/tasks")"
  STATUS="$(echo "$TASKS" | node -e 'const fs=require("fs"); const arr=JSON.parse(fs.readFileSync(0,"utf8")); const t=arr.find(x=>x.id===process.argv[1]); process.stdout.write(String((t&&t.status)||""));' "$TASK_ID")"
  if [[ "$STATUS" == "succeeded" || "$STATUS" == "failed" || "$STATUS" == "rolled_back" || "$STATUS" == "aborted" ]]; then
    break
  fi
  sleep 1
done
echo "final_status=$STATUS"
if [[ "$STATUS" != "succeeded" ]]; then
  if [[ "$STATUS" == "failed" && "$SMOKE_ACCEPT_FAILED" == "1" ]]; then
    echo "warn: final_status=failed accepted by DCF_SMOKE_ACCEPT_FAILED=1"
  else
    echo "error: expected final_status=succeeded, got ${STATUS:-unknown}"
    exit 1
  fi
fi

echo "[5/6] fetch task events"
EVENTS="$(curl -sS -m 5 -b "$COOKIE_JAR" "$BASE_URL/api/events?limit=500")"
TASK_EVENT_TYPES="$(echo "$EVENTS" | node -e 'const fs=require("fs"); const arr=JSON.parse(fs.readFileSync(0,"utf8")); const id=process.argv[1]; const types=arr.filter(e=>((e.payload||{}).taskId===id||(e.payload||{}).task_id===id)).map(e=>e.type); process.stdout.write(types.join(","));' "$TASK_ID")"
echo "task_events=$TASK_EVENT_TYPES"

echo "[6/6] assert core events"
if [[ "$TASK_EVENT_TYPES" != *"task.created"* ]]; then
  echo "error: task.created missing"
  exit 1
fi
if [[ "$TASK_EVENT_TYPES" != *"task.running"* ]]; then
  echo "error: task.running missing"
  exit 1
fi
if [[ "$STATUS" == "succeeded" && "$TASK_EVENT_TYPES" != *"task.succeeded"* ]]; then
  echo "error: task.succeeded missing"
  exit 1
fi
echo "openclaw-smoke: passed"
