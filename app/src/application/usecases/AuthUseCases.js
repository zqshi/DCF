const { randomUUID, createHash, randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ['*'],
  ops_admin: [
    'admin.runtime.read',
    'admin.runtime.write',
    'admin.tasks.read',
    'admin.tasks.write',
    'admin.employees.read',
    'admin.employees.write',
    'admin.logs.read'
  ],
  auditor: [
    'admin.runtime.read',
    'admin.tasks.read',
    'admin.logs.read',
    'admin.employees.read'
  ],
  skill_admin: [
    'admin.skills.read',
    'admin.skills.write',
    'admin.tools.read',
    'admin.tools.write',
    'admin.tools.assets.read',
    'admin.tools.assets.write',
    'admin.tools.approval.read',
    'admin.tools.approval.write',
    'admin.tools.policy.read',
    'admin.tools.policy.write',
    'admin.oss.read',
    'admin.oss.write',
    'admin.tasks.read',
    'admin.logs.read'
  ]
};

const DEFAULT_USERS = [
  {
    id: 'u-admin-1',
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: 'super_admin',
    tenantId: 'tenant-default',
    accountId: 'account-default'
  },
  {
    id: 'u-ops-1',
    username: 'ops',
    password: 'ops123',
    displayName: '运营管理员',
    role: 'ops_admin',
    tenantId: 'tenant-default',
    accountId: 'account-default'
  },
  {
    id: 'u-audit-1',
    username: 'auditor',
    password: 'audit123',
    displayName: '审计员',
    role: 'auditor',
    tenantId: 'tenant-default',
    accountId: 'account-default'
  },
  {
    id: 'u-skill-1',
    username: 'skill',
    password: 'skill123',
    displayName: '技能管理员',
    role: 'skill_admin',
    tenantId: 'tenant-default',
    accountId: 'account-default'
  }
];

const USER_STATUS = {
  active: 'active',
  disabled: 'disabled'
};
const DEMO_USERNAMES = new Set(['admin', 'ops', 'auditor', 'skill']);
const TOOL_PERMISSION_COMPAT = {
  'admin.tools.read': [
    'admin.tools.assets.read',
    'admin.tools.approval.read',
    'admin.tools.policy.read'
  ],
  'admin.tools.write': [
    'admin.tools.assets.write',
    'admin.tools.approval.write',
    'admin.tools.policy.write'
  ],
  'admin.tools.assets.read': ['admin.tools.read'],
  'admin.tools.approval.read': ['admin.tools.read'],
  'admin.tools.policy.read': ['admin.tools.read'],
  'admin.tools.assets.write': ['admin.tools.write'],
  'admin.tools.approval.write': ['admin.tools.write'],
  'admin.tools.policy.write': ['admin.tools.write']
};
const ACTION_PERMISSION_COMPAT = {
  'admin.skills.action.debug-toggle': ['admin.skills.debug'],
  'admin.skills.action.unlink-employee': ['admin.skills.delete'],
  'admin.skills.action.delete': ['admin.skills.delete'],
  'admin.skills.debug': ['admin.skills.action.debug-toggle'],
  'admin.skills.delete': ['admin.skills.action.unlink-employee', 'admin.skills.action.delete'],
  'admin.tools.action.create-service': ['admin.tools.assets.write', 'admin.tools.write'],
  'admin.tools.action.update-service': ['admin.tools.assets.write', 'admin.tools.write'],
  'admin.tools.action.delete-service': ['admin.tools.assets.write', 'admin.tools.write'],
  'admin.tools.action.check-health': ['admin.tools.assets.write', 'admin.tools.write'],
  'admin.tools.action.approve-service': ['admin.tools.approval.write', 'admin.tools.write'],
  'admin.tools.action.reject-service': ['admin.tools.approval.write', 'admin.tools.write'],
  'admin.tools.action.rollback-service': ['admin.tools.approval.write', 'admin.tools.write'],
  'admin.tools.action.resubmit-service': ['admin.tools.approval.write', 'admin.tools.write'],
  'admin.oss.action.approve-case': ['admin.oss.write'],
  'admin.oss.action.deploy': ['admin.oss.write'],
  'admin.oss.action.verify': ['admin.oss.write'],
  'admin.oss.action.rollback': ['admin.oss.write'],
  'admin.tools.assets.write': ['admin.tools.action.create-service', 'admin.tools.action.update-service', 'admin.tools.action.delete-service', 'admin.tools.action.check-health'],
  'admin.tools.approval.write': ['admin.tools.action.approve-service', 'admin.tools.action.reject-service', 'admin.tools.action.rollback-service', 'admin.tools.action.resubmit-service'],
  'admin.oss.write': ['admin.oss.action.approve-case', 'admin.oss.action.deploy', 'admin.oss.action.verify', 'admin.oss.action.rollback']
};
const PAGE_PERMISSION_COMPAT = {
  'admin.runtime.read': [
    'admin.runtime.page.platform-overview.read',
    'admin.runtime.page.overview.read',
    'admin.runtime.page.health.read',
    'admin.runtime.page.cycles.read',
    'admin.runtime.page.advanced.read',
    'admin.runtime.page.strategy-center.read',
    'admin.runtime.page.prompts.read',
    'admin.runtime.page.autoevolve.read'
  ],
  'admin.tasks.read': [
    'admin.tasks.page.overview.read',
    'admin.tasks.page.runtime.read',
    'admin.tasks.page.governance.read'
  ],
  'admin.employees.read': [
    'admin.employees.page.overview.read',
    'admin.employees.page.contracts.read',
    'admin.employees.page.growth.read'
  ],
  'admin.skills.read': ['admin.skills.page.management.read'],
  'admin.tools.assets.read': ['admin.tools.page.assets.read'],
  'admin.tools.approval.read': ['admin.tools.page.approvals.read'],
  'admin.logs.read': [
    'admin.logs.page.behavior.read',
    'admin.logs.page.agent.read',
    'admin.logs.page.admin.read'
  ],
  'admin.oss.read': ['admin.oss.page.search.read'],
  'admin.auth.read': [
    'admin.auth.page.users.read',
    'admin.auth.page.roles.read',
    'admin.auth.page.members.read'
  ],
  'admin.runtime.page.platform-overview.read': ['admin.runtime.read'],
  'admin.runtime.page.overview.read': ['admin.runtime.read'],
  'admin.runtime.page.health.read': ['admin.runtime.read'],
  'admin.runtime.page.cycles.read': ['admin.runtime.read'],
  'admin.runtime.page.advanced.read': ['admin.runtime.read'],
  'admin.runtime.page.strategy-center.read': ['admin.runtime.read'],
  'admin.runtime.page.prompts.read': ['admin.runtime.read'],
  'admin.runtime.page.autoevolve.read': ['admin.runtime.read'],
  'admin.tasks.page.overview.read': ['admin.tasks.read'],
  'admin.tasks.page.runtime.read': ['admin.tasks.read'],
  'admin.tasks.page.governance.read': ['admin.tasks.read'],
  'admin.employees.page.overview.read': ['admin.employees.read'],
  'admin.employees.page.contracts.read': ['admin.employees.read'],
  'admin.employees.page.growth.read': ['admin.employees.read'],
  'admin.skills.page.management.read': ['admin.skills.read'],
  'admin.tools.page.assets.read': ['admin.tools.assets.read', 'admin.tools.read'],
  'admin.tools.page.approvals.read': ['admin.tools.approval.read', 'admin.tools.read'],
  'admin.logs.page.behavior.read': ['admin.logs.read'],
  'admin.logs.page.agent.read': ['admin.logs.read'],
  'admin.logs.page.admin.read': ['admin.logs.read'],
  'admin.oss.page.search.read': ['admin.oss.read'],
  'admin.auth.page.users.read': ['admin.auth.read'],
  'admin.auth.page.roles.read': ['admin.auth.read'],
  'admin.auth.page.members.read': ['admin.auth.read']
};

const PASSWORD_HASH_ALGO = 'scrypt-v1';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;
const DISPLAY_NAME_MIN_LEN = 2;
const DISPLAY_NAME_MAX_LEN = 20;

function hashText(value, pepper = '') {
  return createHash('sha256').update(`${String(value || '')}:${pepper}`).digest('hex');
}

function hashPassword(value, pepper = '', options = {}) {
  const salt = options.salt
    ? Buffer.from(String(options.salt), 'hex')
    : randomBytes(16);
  const derived = scryptSync(`${String(value || '')}:${pepper}`, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });
  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function parseScryptHash(stored = '') {
  const parts = String(stored || '').split('$');
  if (parts.length !== 7) return null;
  if (parts[0] !== 'scrypt' || parts[1] !== 'v1') return null;
  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return null;
  const saltHex = String(parts[5] || '').trim();
  const hashHex = String(parts[6] || '').trim();
  if (!saltHex || !hashHex) return null;
  return { N, r, p, saltHex, hashHex };
}

function verifyPasswordHash(rawPassword, storedHash, pepper = '') {
  const stored = String(storedHash || '').trim();
  if (!stored) return false;

  const parsed = parseScryptHash(stored);
  if (parsed) {
    try {
      const salt = Buffer.from(parsed.saltHex, 'hex');
      const expected = Buffer.from(parsed.hashHex, 'hex');
      const actual = scryptSync(`${String(rawPassword || '')}:${pepper}`, salt, expected.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: SCRYPT_MAXMEM
      });
      if (actual.length !== expected.length) return false;
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  // Backward compatibility for legacy SHA-256 hash storage.
  const legacy = hashText(rawPassword, pepper);
  try {
    const legacyBuf = Buffer.from(legacy, 'hex');
    const storedBuf = Buffer.from(stored, 'hex');
    if (legacyBuf.length !== storedBuf.length || legacyBuf.length === 0) return false;
    return timingSafeEqual(legacyBuf, storedBuf);
  } catch {
    return false;
  }
}

function validateDisplayName(displayName) {
  const normalized = String(displayName || '').trim();
  if (!normalized) throw new Error('displayName is required');
  const size = Array.from(normalized).length;
  if (size < DISPLAY_NAME_MIN_LEN || size > DISPLAY_NAME_MAX_LEN) {
    throw new Error(`displayName 长度需为 ${DISPLAY_NAME_MIN_LEN}-${DISPLAY_NAME_MAX_LEN} 个字符`);
  }
  return normalized;
}

function normalizePositionValue(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const candidates = [
    src.position,
    src.post,
    src.jobTitle,
    src.title,
    src.roleName,
    src.profile && typeof src.profile === 'object' ? src.profile.position : null
  ];
  for (const item of candidates) {
    const normalized = String(item || '').trim();
    if (normalized) return normalized;
  }
  return null;
}

class AuthUseCases {
  constructor(options = {}) {
    const sessionTtlMs = Number(options.sessionTtlMs || process.env.AUTH_SESSION_TTL_MS || (8 * 60 * 60 * 1000));
    this.sessionTtlMs = sessionTtlMs;
    this.passwordPepper = String(options.passwordPepper || process.env.AUTH_PASSWORD_PEPPER || '');
    this.nodeEnv = String(options.nodeEnv || process.env.NODE_ENV || 'development').toLowerCase();
    this.slidingSession = typeof options.slidingSession === 'boolean'
      ? options.slidingSession
      : (process.env.AUTH_SESSION_SLIDING || '1') !== '0';
    this.singleSessionPerUser = typeof options.singleSessionPerUser === 'boolean'
      ? options.singleSessionPerUser
      : process.env.AUTH_SINGLE_SESSION_PER_USER === '1';
    this.maxFailedAttempts = Number(options.maxFailedAttempts || process.env.AUTH_MAX_FAILED_ATTEMPTS || 5);
    this.lockoutMs = Number(options.lockoutMs || process.env.AUTH_LOCKOUT_MS || (15 * 60 * 1000));
    this.failWindowMs = Number(options.failWindowMs || process.env.AUTH_FAIL_WINDOW_MS || (10 * 60 * 1000));
    this.requireExternalUsers = typeof options.requireExternalUsers === 'boolean'
      ? options.requireExternalUsers
      : (process.env.AUTH_REQUIRE_EXTERNAL_USERS === '1' || this.nodeEnv === 'production');
    this.forbidDemoUsers = typeof options.forbidDemoUsers === 'boolean'
      ? options.forbidDemoUsers
      : ((process.env.AUTH_FORBID_DEMO_USERS || '').trim() === '1' || this.nodeEnv === 'production');
    this.rolePermissions = this.loadRolePermissions(options);
    this.userSource = 'unknown';
    this.users = this.loadUsers(options);
    if (this.forbidDemoUsers) this.assertNoDemoUsers(this.users);
    this.sessions = new Map();
    this.failedLogins = new Map();
  }

  loadRolePermissions(options = {}) {
    const src = options.rolePermissions && typeof options.rolePermissions === 'object'
      ? options.rolePermissions
      : DEFAULT_ROLE_PERMISSIONS;
    const normalized = {};
    for (const [role, permissions] of Object.entries(src)) {
      const roleName = String(role || '').trim();
      if (!roleName) continue;
      const list = Array.isArray(permissions)
        ? permissions.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      if (!list.length) continue;
      normalized[roleName] = Array.from(new Set(list));
    }
    if (!normalized.super_admin) normalized.super_admin = ['*'];
    return normalized;
  }

  resolveUsersInput(options = {}) {
    if (Array.isArray(options.users) && options.users.length) return { users: options.users, source: 'options.users' };
    if (process.env.AUTH_USERS_JSON) {
      try {
        const parsed = JSON.parse(process.env.AUTH_USERS_JSON);
        if (Array.isArray(parsed) && parsed.length) return { users: parsed, source: 'env.AUTH_USERS_JSON' };
      } catch {
        throw new Error('AUTH_USERS_JSON 格式不合法，必须是 JSON 数组');
      }
    }
    const filePath = options.usersFile || process.env.AUTH_USERS_FILE;
    if (filePath) {
      const absolute = path.resolve(filePath);
      if (!fs.existsSync(absolute)) throw new Error(`AUTH_USERS_FILE 不存在: ${absolute}`);
      const raw = fs.readFileSync(absolute, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return { users: parsed, source: `file:${absolute}` };
      } catch {
        throw new Error(`AUTH_USERS_FILE 内容不是合法 JSON: ${absolute}`);
      }
      throw new Error(`AUTH_USERS_FILE 必须是非空数组: ${absolute}`);
    }
    if (this.requireExternalUsers) {
      throw new Error('鉴权配置缺失：生产/严格模式下必须配置 AUTH_USERS_FILE 或 AUTH_USERS_JSON');
    }
    return { users: DEFAULT_USERS, source: 'default-demo' };
  }

  normalizeUser(input, idx) {
    if (!input || typeof input !== 'object') throw new Error(`用户配置无效: index=${idx}`);
    if (!input.username || !input.role || !input.displayName) {
      throw new Error(`用户配置缺失字段(username/role/displayName): index=${idx}`);
    }
    const rolePermissions = this.rolePermissions[input.role] || [];
    const hasCustomPermissions = Array.isArray(input.permissions) && input.permissions.length;
    const permissions = hasCustomPermissions ? input.permissions : rolePermissions;
    if (!permissions.length) throw new Error(`用户角色无权限定义: role=${input.role}`);

    const authProvider = String(input.authProvider || '').trim().toLowerCase();
    const ssoManaged = input.ssoManaged === true || authProvider === 'sso';
    let passwordHash = input.passwordHash || null;
    if (!passwordHash && input.password) passwordHash = hashPassword(input.password, this.passwordPepper);
    if (!passwordHash && !ssoManaged) throw new Error(`用户未配置 passwordHash/password: username=${input.username}`);
    const status = String(input.status || USER_STATUS.active);
    if (!Object.values(USER_STATUS).includes(status)) {
      throw new Error(`用户状态不合法: username=${input.username}`);
    }

    return {
      id: input.id || `u-${input.username}`,
      username: String(input.username),
      displayName: String(input.displayName),
      position: normalizePositionValue(input),
      tenantId: input.tenantId ? String(input.tenantId) : null,
      accountId: input.accountId ? String(input.accountId) : null,
      externalUserId: input.externalUserId ? String(input.externalUserId) : null,
      role: String(input.role),
      passwordHash: passwordHash ? String(passwordHash) : null,
      permissions,
      permissionsSource: hasCustomPermissions ? 'custom' : 'role',
      status,
      authProvider: ssoManaged ? 'sso' : (authProvider || 'local'),
      ssoManaged
    };
  }

  loadUsers(options = {}) {
    const loaded = this.resolveUsersInput(options);
    const users = loaded.users;
    this.userSource = loaded.source || 'unknown';
    const normalized = users.map((u, i) => this.normalizeUser(u, i));
    const dup = new Set();
    for (const user of normalized) {
      if (dup.has(user.username)) throw new Error(`用户名重复: ${user.username}`);
      dup.add(user.username);
    }
    return normalized;
  }

  assertNoDemoUsers(users) {
    const hit = users.filter((x) => DEMO_USERNAMES.has(String(x.username || '').trim().toLowerCase()));
    if (hit.length > 0) {
      throw new Error(`生产模式禁止演示账号: ${hit.map((x) => x.username).join(', ')}`);
    }
  }

  cleanupSessions() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }

  login(username, password) {
    this.cleanupSessions();
    const lockState = this.getLockState(username);
    if (lockState.locked) {
      throw new Error(`账号已锁定，请在 ${lockState.retryAfterSeconds} 秒后重试`);
    }
    const user = this.users.find((x) => x.username === username);
    if (!user) {
      this.recordFailure(username);
      throw new Error('用户名或密码错误');
    }
    if (user.status === USER_STATUS.disabled) {
      throw new Error('账号已停用，请联系管理员');
    }
    if (user.ssoManaged === true && !user.passwordHash) {
      throw new Error('该账号仅支持 SSO 登录');
    }
    if (!verifyPasswordHash(password, user.passwordHash, this.passwordPepper)) {
      this.recordFailure(username);
      throw new Error('用户名或密码错误');
    }

    const session = this.createSessionForUser(user);
    this.failedLogins.delete(username);
    return {
      token: session.token,
      user: this.toSafeUser(user),
      expiresAt: new Date(session.expiresAt).toISOString(),
      authMethod: 'password'
    };
  }

  createSessionForUser(user) {
    const token = randomUUID();
    const now = Date.now();
    if (this.singleSessionPerUser) this.revokeUserSessions(user.id);
    const session = {
      token,
      userId: user.id,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs
    };
    this.sessions.set(token, session);
    return session;
  }

  loginViaSso(identity = {}) {
    const username = String(identity.username || '').trim();
    if (!username) throw new Error('username is required for sso login');
    const user = this.users.find((x) => x.username === username);
    if (!user) throw new Error('sso user is not provisioned');
    if (user.status === USER_STATUS.disabled) throw new Error('账号已停用，请联系管理员');
    if (user.ssoManaged !== true && String(user.authProvider || '') !== 'sso') {
      throw new Error('user is not sso managed');
    }
    const tenantId = identity.tenantId ? String(identity.tenantId).trim() : '';
    const accountId = identity.accountId ? String(identity.accountId).trim() : '';
    if (tenantId && user.tenantId && tenantId !== user.tenantId) throw new Error('tenant scope mismatch');
    if (accountId && user.accountId && accountId !== user.accountId) throw new Error('account scope mismatch');
    const session = this.createSessionForUser(user);
    const authMethod = String(identity.authMethod || '').trim() || 'sso-bridge';
    return {
      token: session.token,
      user: this.toSafeUser(user),
      expiresAt: new Date(session.expiresAt).toISOString(),
      authMethod
    };
  }

  getLockState(username) {
    const key = String(username || '');
    const current = this.failedLogins.get(key);
    if (!current) return { locked: false, retryAfterSeconds: 0 };
    const now = Date.now();
    if (current.lockedUntil && current.lockedUntil > now) {
      return { locked: true, retryAfterSeconds: Math.ceil((current.lockedUntil - now) / 1000) };
    }
    if (current.firstFailedAt && (now - current.firstFailedAt) > this.failWindowMs) {
      this.failedLogins.delete(key);
      return { locked: false, retryAfterSeconds: 0 };
    }
    return { locked: false, retryAfterSeconds: 0 };
  }

  recordFailure(username) {
    const key = String(username || '');
    const now = Date.now();
    const current = this.failedLogins.get(key);
    if (!current || (now - current.firstFailedAt) > this.failWindowMs) {
      this.failedLogins.set(key, {
        count: 1,
        firstFailedAt: now,
        lockedUntil: 0
      });
      return;
    }
    current.count += 1;
    if (current.count >= this.maxFailedAttempts) {
      current.lockedUntil = now + this.lockoutMs;
      current.count = 0;
      current.firstFailedAt = now;
    }
    this.failedLogins.set(key, current);
  }

  logout(token) {
    if (!token) return false;
    return this.sessions.delete(token);
  }

  revokeUserSessions(userId) {
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }

  renewSession(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (!this.slidingSession) return session;
    const now = Date.now();
    session.expiresAt = now + this.sessionTtlMs;
    this.sessions.set(token, session);
    return session;
  }

  getSession(token) {
    if (!token) return null;
    this.cleanupSessions();
    let session = this.sessions.get(token);
    if (!session) return null;
    session = this.renewSession(token) || session;
    const user = this.users.find((x) => x.id === session.userId);
    if (!user) return null;
    if (user.status === USER_STATUS.disabled) {
      this.sessions.delete(token);
      return null;
    }
    const remainingMs = Math.max(0, session.expiresAt - Date.now());
    return {
      token: session.token,
      user: this.toSafeUser(user),
      expiresAt: new Date(session.expiresAt).toISOString(),
      remainingMs
    };
  }

  canAccess(user, permission) {
    if (!user) return false;
    const perms = user.permissions || [];
    if (perms.includes('*')) return true;
    if (perms.includes(permission)) return true;
    const pageFallback = PAGE_PERMISSION_COMPAT[String(permission || '')] || [];
    if (pageFallback.some((item) => perms.includes(item))) return true;
    const fallback = TOOL_PERMISSION_COMPAT[String(permission || '')] || [];
    if (fallback.some((item) => perms.includes(item))) return true;
    const actionFallback = ACTION_PERMISSION_COMPAT[String(permission || '')] || [];
    return actionFallback.some((item) => perms.includes(item));
  }

  toSafeUser(user) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      position: user.position ? String(user.position) : null,
      tenantId: user.tenantId || null,
      accountId: user.accountId || null,
      externalUserId: user.externalUserId || null,
      role: user.role,
      permissions: user.permissions,
      permissionsSource: user.permissionsSource || 'role',
      status: user.status || USER_STATUS.active,
      authProvider: user.authProvider || 'local',
      ssoManaged: user.ssoManaged === true
    };
  }

  getHealthStatus() {
    const legacyPasswordHashUsers = this.users.filter((x) => {
      const hash = String(x && x.passwordHash ? x.passwordHash : '').trim();
      if (!hash) return false;
      return !hash.startsWith('scrypt$');
    }).length;
    const demoUsers = this.users
      .filter((x) => DEMO_USERNAMES.has(String(x.username || '').trim().toLowerCase()))
      .map((x) => x.username);
    const externalSource = this.userSource !== 'default-demo';
    const healthy = (!this.requireExternalUsers || externalSource) && (!this.forbidDemoUsers || demoUsers.length === 0);
    return {
      healthy,
      nodeEnv: this.nodeEnv,
      strictMode: this.requireExternalUsers,
      forbidDemoUsers: this.forbidDemoUsers,
      userSource: this.userSource,
      userCount: this.users.length,
      passwordHashing: PASSWORD_HASH_ALGO,
      legacyPasswordHashUsers,
      demoUsers
    };
  }

  listUsers() {
    return this.users
      .map((user) => this.toSafeUser(user))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  listRoles() {
    return Object.entries(this.rolePermissions)
      .map(([role, permissions]) => ({
        role,
        permissions: permissions.slice(),
        memberCount: this.users.filter((x) => x.role === role).length,
        system: role === 'super_admin'
      }))
      .sort((a, b) => a.role.localeCompare(b.role));
  }

  listPermissionCatalog() {
    const all = new Set();
    for (const permissions of Object.values(this.rolePermissions)) {
      for (const permission of permissions) all.add(permission);
    }
    return Array.from(all).sort();
  }

  validateRoleName(role) {
    const value = String(role || '').trim();
    if (!/^[a-z][a-z0-9_]{2,39}$/.test(value)) {
      throw new Error('role 仅支持 3-40 位小写字母/数字/下划线，且需字母开头');
    }
    return value;
  }

  normalizePermissions(permissions = []) {
    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new Error('permissions must be non-empty array');
    }
    const next = permissions
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    if (!next.length) throw new Error('permissions must be non-empty array');
    return Array.from(new Set(next));
  }

  createRole(input = {}) {
    const role = this.validateRoleName(input.role || '');
    if (this.rolePermissions[role]) throw new Error(`role already exists: ${role}`);
    const permissions = this.normalizePermissions(input.permissions || []);
    this.rolePermissions[role] = permissions;
    return {
      role,
      permissions: permissions.slice(),
      memberCount: 0,
      system: false
    };
  }

  updateRole(roleName, patch = {}) {
    const role = String(roleName || '').trim();
    if (!this.rolePermissions[role]) throw new Error('role not found');
    if (role === 'super_admin') throw new Error('super_admin role is immutable');
    const hasRenamePatch = Object.prototype.hasOwnProperty.call(patch, 'roleName')
      || Object.prototype.hasOwnProperty.call(patch, 'role');
    const requestedRole = hasRenamePatch
      ? this.validateRoleName(patch.roleName || patch.role || '')
      : role;
    if (requestedRole !== role && this.rolePermissions[requestedRole]) {
      throw new Error(`role already exists: ${requestedRole}`);
    }
    const nextPermissions = Object.prototype.hasOwnProperty.call(patch, 'permissions')
      ? this.normalizePermissions(patch.permissions)
      : this.rolePermissions[role].slice();
    if (requestedRole !== role) {
      delete this.rolePermissions[role];
      this.rolePermissions[requestedRole] = nextPermissions;
    } else {
      this.rolePermissions[role] = nextPermissions;
    }
    for (const user of this.users) {
      if (user.role === role) {
        user.role = requestedRole;
        if (user.permissionsSource !== 'custom') {
          user.permissions = nextPermissions.slice();
          user.permissionsSource = 'role';
        }
      }
    }
    return {
      role: requestedRole,
      previousRole: role,
      permissions: nextPermissions.slice(),
      memberCount: this.users.filter((x) => x.role === requestedRole).length,
      system: false
    };
  }

  deleteRole(roleName) {
    const role = String(roleName || '').trim();
    if (!this.rolePermissions[role]) throw new Error('role not found');
    if (role === 'super_admin') throw new Error('super_admin role cannot be deleted');
    const members = this.users.filter((x) => x.role === role);
    if (members.length > 0) throw new Error(`role is in use by ${members.length} users`);
    delete this.rolePermissions[role];
    return { deleted: true, role };
  }

  createUser(input = {}) {
    const username = String(input.username || '').trim() || this.generateUsername();
    const displayName = validateDisplayName(input.displayName);
    const role = String(input.role || '').trim();
    const password = String(input.password || '');
    const ssoManaged = input.ssoManaged === true || String(input.authProvider || '').trim().toLowerCase() === 'sso' || !password;
    if (!username) throw new Error('username is required');
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('username 仅支持 3-40 位字母/数字/._-');
    if (!displayName) throw new Error('displayName is required');
    if (!role) throw new Error('role is required');
    if (!this.rolePermissions[role]) throw new Error(`unknown role: ${role}`);
    if (!ssoManaged && password.length < 8) throw new Error('password 至少 8 位');
    if (this.users.some((x) => x.username === username)) throw new Error(`用户名已存在: ${username}`);
    const user = this.normalizeUser({
      id: input.id || `u-${randomUUID().slice(0, 8)}`,
      username,
      displayName,
      role,
      password: ssoManaged ? undefined : password,
      authProvider: ssoManaged ? 'sso' : 'local',
      ssoManaged,
      tenantId: input.tenantId || null,
      accountId: input.accountId || null,
      externalUserId: input.externalUserId || null,
      position: normalizePositionValue(input),
      permissions: Array.isArray(input.permissions) ? input.permissions : undefined,
      status: input.status || USER_STATUS.active
    }, -1);
    this.users.push(user);
    return this.toSafeUser(user);
  }

  updateUser(userId, patch = {}) {
    const idx = this.users.findIndex((x) => x.id === userId);
    if (idx < 0) throw new Error('user not found');
    const current = this.users[idx];
    const next = { ...current };

    if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
      next.displayName = validateDisplayName(patch.displayName);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'role')) {
      const role = String(patch.role || '').trim();
      if (!this.rolePermissions[role]) throw new Error(`unknown role: ${role}`);
      next.role = role;
      if (!Array.isArray(patch.permissions)) {
        next.permissions = this.rolePermissions[role].slice();
        next.permissionsSource = 'role';
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'permissions')) {
      if (!Array.isArray(patch.permissions) || patch.permissions.length === 0) {
        throw new Error('permissions must be non-empty array');
      }
      next.permissions = patch.permissions.map((x) => String(x || '').trim()).filter(Boolean);
      if (!next.permissions.length) throw new Error('permissions must be non-empty array');
      next.permissionsSource = 'custom';
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const status = String(patch.status || '').trim();
      if (!Object.values(USER_STATUS).includes(status)) throw new Error('invalid status');
      next.status = status;
      if (status === USER_STATUS.disabled) this.revokeUserSessions(current.id);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'tenantId')) {
      next.tenantId = patch.tenantId ? String(patch.tenantId) : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'accountId')) {
      next.accountId = patch.accountId ? String(patch.accountId) : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'externalUserId')) {
      next.externalUserId = patch.externalUserId ? String(patch.externalUserId) : null;
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'position')
      || Object.prototype.hasOwnProperty.call(patch, 'post')
      || Object.prototype.hasOwnProperty.call(patch, 'jobTitle')
      || Object.prototype.hasOwnProperty.call(patch, 'title')
      || Object.prototype.hasOwnProperty.call(patch, 'roleName')
      || Object.prototype.hasOwnProperty.call(patch, 'profile')
    ) {
      next.position = normalizePositionValue(patch);
    }

    this.users[idx] = next;
    return this.toSafeUser(next);
  }

  resetPassword(userId, password) {
    const idx = this.users.findIndex((x) => x.id === userId);
    if (idx < 0) throw new Error('user not found');
    const nextPassword = String(password || '');
    if (nextPassword.length < 8) throw new Error('password 至少 8 位');
    const user = this.users[idx];
    if (user.ssoManaged === true) throw new Error('sso managed user cannot reset password');
    user.passwordHash = hashPassword(nextPassword, this.passwordPepper);
    user.authProvider = 'local';
    user.ssoManaged = false;
    this.revokeUserSessions(user.id);
    this.users[idx] = user;
    return this.toSafeUser(user);
  }

  deleteUser(userId) {
    const idx = this.users.findIndex((x) => x.id === userId);
    if (idx < 0) throw new Error('user not found');
    const removed = this.users[idx];
    this.revokeUserSessions(removed.id);
    this.users.splice(idx, 1);
    return {
      deleted: true,
      user: this.toSafeUser(removed)
    };
  }

  generateUsername() {
    const usernames = new Set(this.users.map((item) => String(item && item.username ? item.username : '').trim()));
    for (let i = 0; i < 5; i += 1) {
      const candidate = `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      if (!usernames.has(candidate)) return candidate;
    }
    throw new Error('failed to generate username');
  }
}

module.exports = {
  AuthUseCases,
  hashPasswordForStorage: hashPassword,
  verifyPasswordHash,
  ROLE_PERMISSIONS: DEFAULT_ROLE_PERMISSIONS,
  USER_STATUS
};
