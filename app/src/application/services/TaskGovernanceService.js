function toRiskRank(level) {
  const order = { L1: 1, L2: 2, L3: 3, L4: 4 };
  return order[String(level || '').trim().toUpperCase()] || 2;
}

function makePolicyDenied(message) {
  const error = new Error(message);
  error.code = 'POLICY_DENIED';
  error.statusCode = 403;
  return error;
}

function textContains(source, keyword) {
  const s = String(source || '').toLowerCase();
  const k = String(keyword || '').trim().toLowerCase();
  if (!s || !k) return false;
  return s.includes(k);
}

function enforceTaskBoundaries(employee, input, task) {
  const policy = employee && employee.jobPolicy && typeof employee.jobPolicy === 'object'
    ? employee.jobPolicy
    : {};
  const goal = String(task.goal || '').trim();
  const ticket = (input && input.permissionTicket && typeof input.permissionTicket === 'object')
    ? input.permissionTicket
    : {};

  const deny = Array.isArray(policy.deny) ? policy.deny : [];
  if (deny.some((item) => textContains(goal, item))) {
    throw makePolicyDenied('goal hit deny policy boundary');
  }

  const allow = Array.isArray(policy.allow) ? policy.allow : [];
  const strictAllow = Boolean(policy.strictAllow === true);
  if (strictAllow && allow.length > 0 && !allow.some((item) => textContains(goal, item))) {
    throw makePolicyDenied('goal is outside allow policy boundary');
  }

  if (policy.maxRiskLevel && toRiskRank(task.riskLevel) > toRiskRank(policy.maxRiskLevel)) {
    throw makePolicyDenied('risk level exceeds employee policy boundary');
  }

  const allowedDepartments = Array.isArray(policy.allowedDepartments) ? policy.allowedDepartments : [];
  if (allowedDepartments.length > 0 && !allowedDepartments.includes(employee.department)) {
    throw makePolicyDenied('employee department is outside policy boundary');
  }

  const allowedRoles = Array.isArray(policy.allowedRoles) ? policy.allowedRoles : [];
  if (allowedRoles.length > 0 && !allowedRoles.includes(employee.role)) {
    throw makePolicyDenied('employee role is outside policy boundary');
  }

  const ticketDepartment = String(ticket.department || '').trim();
  if (ticketDepartment && ticketDepartment !== String(employee.department || '').trim()) {
    throw makePolicyDenied('permission ticket department mismatch');
  }

  const ticketRole = String(ticket.role || '').trim();
  if (ticketRole && ticketRole !== String(employee.role || '').trim()) {
    throw makePolicyDenied('permission ticket role mismatch');
  }
}

function hasDuplicatedExternalWrite(store, employeeId, externalWrite) {
  return store.tasks.some((existing) => (
    existing.employeeId === employeeId
    && existing.externalWrite
    && existing.externalWrite.system === externalWrite.system
    && existing.externalWrite.operation === externalWrite.operation
    && existing.externalWrite.idempotencyKey === externalWrite.idempotencyKey
  ));
}

module.exports = {
  toRiskRank,
  makePolicyDenied,
  textContains,
  enforceTaskBoundaries,
  hasDuplicatedExternalWrite
};
