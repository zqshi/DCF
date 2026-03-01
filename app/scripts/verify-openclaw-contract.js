#!/usr/bin/env node
const { RuntimeErrorCodes } = require('../src/shared/runtime/RuntimeErrorCodes');

function resolveBaseUrl() {
  const raw = String(
    process.env.OPENCLAW_BASE_URL
    || process.env.OPENCLAW_GATEWAY_URL
    || "http://127.0.0.1:18789",
  ).trim();
  return raw.replace(/\/$/, "");
}

function authHeaders() {
  const token = String(
    process.env.OPENCLAW_API_KEY
    || process.env.OPENCLAW_GATEWAY_TOKEN
    || "",
  ).trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function submitTask(baseUrl, contractVersion, payload) {
  const res = await fetch(`${baseUrl}/runtime/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Contract-Version": contractVersion,
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

async function getStatus(baseUrl, contractVersion, runtimeTaskId) {
  const res = await fetch(`${baseUrl}/runtime/tasks/${runtimeTaskId}`, {
    method: "GET",
    headers: {
      "X-Contract-Version": contractVersion,
      ...authHeaders(),
    },
  });
  return { status: res.status, ok: res.ok };
}

async function main() {
  const baseUrl = resolveBaseUrl();
  const expectedVersion = String(
    process.env.OPENCLAW_CONTRACT_VERSION
    || process.env.DCF_RUNTIME_CONTRACT_VERSION
    || "v1",
  ).trim() || "v1";
  const wrongVersion = expectedVersion === "v1" ? "v0" : "v1";

  const payload = {
    taskId: `contract-check-${Date.now()}`,
    employeeId: "contract-checker",
    conversationId: "contract-check",
    goal: "verify runtime contract handshake",
    riskLevel: "L2",
  };

  const wrong = await submitTask(baseUrl, wrongVersion, payload);
  if (wrong.status !== 409 || !wrong.body || wrong.body.code !== RuntimeErrorCodes.CONTRACT_VERSION_MISMATCH) {
    throw new Error(`expected 409 ${RuntimeErrorCodes.CONTRACT_VERSION_MISMATCH} for wrong version, got status=${wrong.status}`);
  }

  const right = await submitTask(baseUrl, expectedVersion, payload);
  if (!right.ok || !right.body || !right.body.runtimeTaskId) {
    throw new Error(`expected accepted task for version=${expectedVersion}, got status=${right.status}`);
  }

  const status = await getStatus(baseUrl, expectedVersion, right.body.runtimeTaskId);
  if (!status.ok) {
    throw new Error(`expected task status endpoint ok for version=${expectedVersion}, got status=${status.status}`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    expectedVersion,
    wrongVersion,
    mismatchStatus: wrong.status,
    submitStatus: right.status,
    runtimeTaskId: right.body.runtimeTaskId,
    statusCheck: status.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
