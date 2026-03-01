const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const {
  AuthUseCases,
  hashPasswordForStorage
} = require('../src/application/usecases/AuthUseCases');

test('auth login creates session and supports logout', () => {
  const auth = new AuthUseCases();
  const login = auth.login('admin', 'admin123');
  assert.equal(login.user.role, 'super_admin');
  const session = auth.getSession(login.token);
  assert.equal(session.user.username, 'admin');
  const ok = auth.logout(login.token);
  assert.equal(ok, true);
  assert.equal(auth.getSession(login.token), null);
});

test('auth enforces role permissions by RBAC', () => {
  const auth = new AuthUseCases();
  const ops = auth.login('ops', 'ops123').user;
  assert.equal(auth.canAccess(ops, 'admin.runtime.read'), true);
  assert.equal(auth.canAccess(ops, 'admin.tasks.write'), true);
  assert.equal(auth.canAccess(ops, 'admin.employees.write'), true);
  assert.equal(auth.canAccess(ops, 'admin.logs.write'), false);
  assert.equal(auth.canAccess(ops, 'admin.skills.read'), false);

  const skill = auth.login('skill', 'skill123').user;
  assert.equal(auth.canAccess(skill, 'admin.oss.read'), true);
  assert.equal(auth.canAccess(skill, 'admin.skills.write'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.read'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.write'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.assets.read'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.assets.write'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.approval.read'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.approval.write'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.policy.read'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.policy.write'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.action.create-service'), true);
  assert.equal(auth.canAccess(skill, 'admin.tools.action.approve-service'), true);
  assert.equal(auth.canAccess(skill, 'admin.oss.action.approve-case'), true);
  assert.equal(auth.canAccess(skill, 'admin.runtime.write'), false);
});

test('auth rejects invalid credentials', () => {
  const auth = new AuthUseCases();
  assert.throws(() => auth.login('admin', 'wrong-pass'), /用户名或密码错误/);
  assert.throws(() => auth.login('not-exist', 'x'), /用户名或密码错误/);
});

test('auth can load users from file with password hash and pepper', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-auth-'));
  const file = path.join(dir, 'users.json');
  const pepper = 'pepper-x';
  const hash = hashPasswordForStorage('secret-1', pepper);
  fs.writeFileSync(file, JSON.stringify([
    {
      id: 'u1',
      username: 'root',
      displayName: '管理员',
      role: 'super_admin',
      passwordHash: hash
    }
  ]), 'utf8');

  const auth = new AuthUseCases({ usersFile: file, passwordPepper: pepper });
  const login = auth.login('root', 'secret-1');
  assert.equal(login.user.username, 'root');
  assert.throws(() => auth.login('root', 'secret-2'), /用户名或密码错误/);
});

test('auth remains compatible with legacy sha256 password hash', () => {
  const pepper = 'legacy-pepper';
  const legacyHash = createHash('sha256').update(`legacy-pass-1:${pepper}`).digest('hex');
  const auth = new AuthUseCases({
    users: [{
      id: 'u-legacy-1',
      username: 'legacy_admin',
      displayName: 'Legacy Admin',
      role: 'super_admin',
      passwordHash: legacyHash
    }],
    passwordPepper: pepper,
    requireExternalUsers: false,
    forbidDemoUsers: false
  });
  const login = auth.login('legacy_admin', 'legacy-pass-1');
  assert.equal(login.user.username, 'legacy_admin');
  assert.equal(auth.getHealthStatus().legacyPasswordHashUsers, 1);
});

test('auth requires external users in production mode', () => {
  assert.throws(
    () => new AuthUseCases({ nodeEnv: 'production' }),
    /必须配置 AUTH_USERS_FILE 或 AUTH_USERS_JSON/
  );
});

test('auth requires external users when strict flag is enabled', () => {
  assert.throws(
    () => new AuthUseCases({ requireExternalUsers: true }),
    /必须配置 AUTH_USERS_FILE 或 AUTH_USERS_JSON/
  );
});

test('auth locks account after repeated failed logins', () => {
  const auth = new AuthUseCases({
    maxFailedAttempts: 3,
    lockoutMs: 60000,
    failWindowMs: 60000
  });
  assert.throws(() => auth.login('admin', 'bad-1'), /用户名或密码错误/);
  assert.throws(() => auth.login('admin', 'bad-2'), /用户名或密码错误/);
  assert.throws(() => auth.login('admin', 'bad-3'), /用户名或密码错误/);
  assert.throws(() => auth.login('admin', 'admin123'), /账号已锁定/);
});

test('auth lock can be reset after lockout window', () => {
  const auth = new AuthUseCases({
    maxFailedAttempts: 2,
    lockoutMs: 20,
    failWindowMs: 1000
  });
  assert.throws(() => auth.login('admin', 'bad-1'), /用户名或密码错误/);
  assert.throws(() => auth.login('admin', 'bad-2'), /用户名或密码错误/);
  return new Promise((resolve) => {
    setTimeout(() => {
      const login = auth.login('admin', 'admin123');
      assert.equal(login.user.username, 'admin');
      resolve();
    }, 25);
  });
});

test('auth supports single-session-per-user policy', () => {
  const auth = new AuthUseCases({ singleSessionPerUser: true });
  const a = auth.login('admin', 'admin123');
  const b = auth.login('admin', 'admin123');
  assert.equal(auth.getSession(a.token), null);
  assert.equal(auth.getSession(b.token).user.username, 'admin');
});

test('auth sliding session renewal extends expiry', () => new Promise((resolve) => {
  const auth = new AuthUseCases({ sessionTtlMs: 80, slidingSession: true });
  const login = auth.login('admin', 'admin123');
  const first = auth.getSession(login.token);
  setTimeout(() => {
    const second = auth.getSession(login.token);
    assert.ok(second.remainingMs > first.remainingMs - 30);
    resolve();
  }, 30);
}));

test('auth can disable sliding session renewal', () => new Promise((resolve) => {
  const auth = new AuthUseCases({ sessionTtlMs: 80, slidingSession: false });
  const login = auth.login('admin', 'admin123');
  const first = auth.getSession(login.token);
  setTimeout(() => {
    const second = auth.getSession(login.token);
    assert.ok(second.remainingMs < first.remainingMs);
    resolve();
  }, 30);
}));

test('auth supports user management lifecycle for admin backend', () => {
  const auth = new AuthUseCases();
  const created = auth.createUser({
    username: 'ops2',
    displayName: '二线运营',
    role: 'ops_admin',
    password: 'ops-pass-001'
  });
  assert.equal(created.username, 'ops2');
  assert.equal(created.status, 'active');
  const rawCreated = auth.users.find((x) => x.id === created.id);
  assert.equal(String(rawCreated.passwordHash || '').startsWith('scrypt$'), true);

  const login = auth.login('ops2', 'ops-pass-001');
  assert.equal(login.user.role, 'ops_admin');

  const updated = auth.updateUser(created.id, { status: 'disabled', displayName: '二线运营(停用)' });
  assert.equal(updated.status, 'disabled');
  assert.equal(auth.getSession(login.token), null);
  assert.throws(() => auth.login('ops2', 'ops-pass-001'), /账号已停用/);

  auth.updateUser(created.id, { status: 'active' });
  auth.resetPassword(created.id, 'ops-pass-002');
  const rawReset = auth.users.find((x) => x.id === created.id);
  assert.equal(String(rawReset.passwordHash || '').startsWith('scrypt$'), true);
  assert.throws(() => auth.login('ops2', 'ops-pass-001'), /用户名或密码错误/);
  const relogin = auth.login('ops2', 'ops-pass-002');
  assert.equal(relogin.user.username, 'ops2');

  const deleted = auth.deleteUser(created.id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.user.id, created.id);
  assert.equal(auth.getSession(relogin.token), null);
  assert.equal(auth.listUsers().some((x) => x.id === created.id), false);
  assert.throws(() => auth.login('ops2', 'ops-pass-002'), /用户名或密码错误/);
});

test('auth can authorize sso user without password and deny local password login', () => {
  const auth = new AuthUseCases();
  const created = auth.createUser({
    username: 'sso_user_1',
    displayName: 'SSO用户1',
    role: 'ops_admin',
    ssoManaged: true,
    authProvider: 'sso'
  });
  assert.equal(created.ssoManaged, true);
  assert.equal(created.authProvider, 'sso');
  assert.throws(() => auth.login('sso_user_1', 'any-password'), /仅支持 SSO 登录/);
});

test('auth createUser auto-generates username when missing', () => {
  const auth = new AuthUseCases();
  const created = auth.createUser({
    displayName: '自动生成账号',
    role: 'ops_admin',
    ssoManaged: true,
    authProvider: 'sso'
  });
  assert.match(created.username, /^u_[a-z0-9]{12}$/);
  assert.equal(created.displayName, '自动生成账号');
});

test('auth user profile exposes position for front default employee role', () => {
  const auth = new AuthUseCases();
  const created = auth.createUser({
    username: 'ops_position_1',
    displayName: '岗位用户',
    role: 'ops_admin',
    password: 'ops-position-001',
    position: '运营专员'
  });
  assert.equal(created.position, '运营专员');

  const login = auth.login('ops_position_1', 'ops-position-001');
  assert.equal(login.user.position, '运营专员');

  const updated = auth.updateUser(created.id, { position: '运营经理' });
  assert.equal(updated.position, '运营经理');

  const users = auth.listUsers();
  const found = users.find((item) => item.id === created.id);
  assert.ok(found);
  assert.equal(found.position, '运营经理');
});

test('auth createUser validates displayName length between 2 and 20 chars', () => {
  const auth = new AuthUseCases();
  assert.throws(() => auth.createUser({
    username: 'name_too_short',
    displayName: '张',
    role: 'ops_admin',
    ssoManaged: true,
    authProvider: 'sso'
  }), /displayName 长度需为 2-20 个字符/);

  assert.throws(() => auth.createUser({
    username: 'name_too_long',
    displayName: '张张张张张张张张张张张张张张张张张张张张张',
    role: 'ops_admin',
    ssoManaged: true,
    authProvider: 'sso'
  }), /displayName 长度需为 2-20 个字符/);
});

test('auth role rename updates member role binding', () => {
  const auth = new AuthUseCases();
  auth.createRole({
    role: 'ops_observer',
    permissions: ['admin.tasks.read']
  });
  const user = auth.createUser({
    username: 'observer1',
    displayName: '观察员1',
    role: 'ops_observer',
    ssoManaged: true,
    authProvider: 'sso'
  });
  const renamed = auth.updateRole('ops_observer', {
    roleName: 'ops_auditor',
    permissions: ['admin.tasks.read', 'admin.logs.read']
  });
  assert.equal(renamed.role, 'ops_auditor');
  assert.equal(renamed.previousRole, 'ops_observer');
  const users = auth.listUsers();
  const found = users.find((x) => x.id === user.id);
  assert.ok(found);
  assert.equal(found.role, 'ops_auditor');
  assert.equal(found.permissions.includes('admin.logs.read'), true);
});

test('auth forbids demo usernames when production policy is enabled', () => {
  assert.throws(
    () => new AuthUseCases({
      users: [
        {
          id: 'u-demo-1',
          username: 'admin',
          displayName: 'Demo Admin',
          role: 'super_admin',
          password: 'admin12345'
        }
      ],
      forbidDemoUsers: true
    }),
    /禁止演示账号/
  );
});

test('auth health status reports source and demo user exposure', () => {
  const auth = new AuthUseCases({
    users: [
      {
        id: 'u-prod-1',
        username: 'ops_lead',
        displayName: 'Ops Lead',
        role: 'ops_admin',
        password: 'ops-lead-123'
      }
    ],
    requireExternalUsers: true,
    forbidDemoUsers: true
  });
  const health = auth.getHealthStatus();
  assert.equal(health.healthy, true);
  assert.equal(health.strictMode, true);
  assert.equal(health.userCount, 1);
  assert.deepEqual(health.demoUsers, []);
});
