#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, 'utf8');
  return JSON.parse(raw);
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

function toList(value) {
  return String(value || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function defaultJobPolicy() {
  return {
    allow: [],
    deny: [
      '导出全部凭证',
      '导出凭证',
      '隐私数据外发',
      '批量删除生产数据',
      '绕过审批',
      'drop database',
      'truncate table',
      'bypass approval'
    ],
    strictAllow: false,
    allowedDepartments: [],
    allowedRoles: [],
    maxRiskLevel: 'L4',
    kpi: [],
    escalationRule: '敏感动作自动提升为L4并触发审批',
    shutdownRule: 'P1风险触发熔断并人工接管'
  };
}

function usage() {
  console.log([
    'Usage:',
    '  DCF_ADMIN_USERNAME=admin DCF_ADMIN_PASSWORD=admin123 npm run policy:apply-runtime',
    '',
    'Optional env:',
    '  DCF_BASE_URL=http://127.0.0.1:8092',
    '  DCF_POLICY_FILE=./config/runtime-permission-policy.example.json',
    '  DCF_EMPLOYEE_IDS=id1,id2',
    '  DCF_APPLY_JOB_POLICY=1',
    '  DCF_DRY_RUN=0'
  ].join('\n'));
}

function ensureOk(response, text, action) {
  if (response.ok) return;
  const statusLine = `${response.status} ${response.statusText}`;
  throw new Error(`${action} failed: ${statusLine} :: ${String(text || '').slice(0, 500)}`);
}

async function requestJson(baseUrl, endpoint, options = {}, context = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(context.cookie ? { Cookie: context.cookie } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  ensureOk(response, text, `${options.method || 'GET'} ${endpoint}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const text = await response.text();
  ensureOk(response, text, 'POST /api/auth/login');
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('login succeeded but no session cookie was returned');
  const sessionCookie = String(cookie).split(';')[0];
  return sessionCookie;
}

function resolveTargets(employees = [], selectedIds = []) {
  if (!selectedIds.length) return employees;
  const selectedSet = new Set(selectedIds);
  return employees.filter((employee) => selectedSet.has(String(employee.id || '')));
}

async function main() {
  const baseUrl = String(process.env.DCF_BASE_URL || 'http://127.0.0.1:8092').replace(/\/$/, '');
  const username = String(process.env.DCF_ADMIN_USERNAME || '').trim();
  const password = String(process.env.DCF_ADMIN_PASSWORD || '').trim();
  const policyFile = String(
    process.env.DCF_POLICY_FILE || './config/runtime-permission-policy.example.json'
  ).trim();
  const selectedIds = toList(process.env.DCF_EMPLOYEE_IDS || '');
  const applyJobPolicy = toBool(process.env.DCF_APPLY_JOB_POLICY, true);
  const dryRun = toBool(process.env.DCF_DRY_RUN, false);

  if (!username || !password) {
    usage();
    throw new Error('DCF_ADMIN_USERNAME and DCF_ADMIN_PASSWORD are required');
  }

  const policy = readJson(policyFile);
  const approvalPolicy = { byRisk: policy.riskPolicy || {} };
  const jobPolicy = defaultJobPolicy();
  const summary = {
    ok: true,
    baseUrl,
    policyFile: path.resolve(policyFile),
    dryRun,
    applyJobPolicy,
    selectedEmployeeIds: selectedIds,
    totalEmployees: 0,
    targetedEmployees: 0,
    updated: [],
    skipped: [],
    failed: []
  };

  const cookie = await login(baseUrl, username, password);
  const employees = await requestJson(baseUrl, '/api/admin/employees', { method: 'GET' }, { cookie });
  const list = Array.isArray(employees) ? employees : [];
  const targets = resolveTargets(list, selectedIds);
  summary.totalEmployees = list.length;
  summary.targetedEmployees = targets.length;

  for (const employee of targets) {
    const employeeId = String(employee.id || '').trim();
    if (!employeeId) {
      summary.skipped.push({ employeeId: null, reason: 'missing employee id' });
      continue;
    }
    if (dryRun) {
      summary.updated.push({
        employeeId,
        employeeCode: employee.employeeCode || null,
        approvalPolicyUpdated: true,
        jobPolicyUpdated: applyJobPolicy
      });
      continue;
    }

    try {
      await requestJson(
        baseUrl,
        `/api/admin/employees/${employeeId}/approval-policy`,
        { method: 'POST', body: { approvalPolicy } },
        { cookie }
      );
      if (applyJobPolicy) {
        await requestJson(
          baseUrl,
          `/api/admin/employees/${employeeId}/policy`,
          { method: 'POST', body: { jobPolicy } },
          { cookie }
        );
      }
      summary.updated.push({
        employeeId,
        employeeCode: employee.employeeCode || null,
        approvalPolicyUpdated: true,
        jobPolicyUpdated: applyJobPolicy
      });
    } catch (error) {
      summary.ok = false;
      summary.failed.push({
        employeeId,
        employeeCode: employee.employeeCode || null,
        error: String(error && error.message || error)
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error && error.message || error)
  }, null, 2));
  process.exit(1);
});
