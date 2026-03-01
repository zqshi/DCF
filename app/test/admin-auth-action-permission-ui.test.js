const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('auth users and roles write actions are guarded by data-required-permission', () => {
  const authUsersHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public/admin/auth-users.html'), 'utf8');
  const authRolesHtml = fs.readFileSync(path.resolve(__dirname, '..', 'public/admin/auth-roles.html'), 'utf8');
  const authMembersJs = fs.readFileSync(path.resolve(__dirname, '..', 'public/admin/auth-members.js'), 'utf8');
  const authRolesJs = fs.readFileSync(path.resolve(__dirname, '..', 'public/admin/auth-roles.js'), 'utf8');

  assert.equal(
    authUsersHtml.includes('id="openCreateUserDrawerBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );
  assert.equal(
    authUsersHtml.includes('id="createUserBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );
  assert.equal(
    authUsersHtml.includes('id="saveUserEditBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );
  assert.equal(
    authUsersHtml.includes('id="confirmUserDeleteBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );

  assert.equal(
    authRolesHtml.includes('id="openCreateRoleDrawerBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );
  assert.equal(
    authRolesHtml.includes('id="createRoleBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );
  assert.equal(
    authRolesHtml.includes('id="saveRoleEditBtn" type="button" class="primary" data-required-permission="admin.auth.write"'),
    true
  );

  assert.equal(authMembersJs.includes('data-edit-user="${escapeHtml(user.id)}" data-required-permission="admin.auth.write"'), true);
  assert.equal(authMembersJs.includes('data-delete-user="${escapeHtml(user.id)}" data-required-permission="admin.auth.write"'), true);
  assert.equal(authMembersJs.includes('data-edit-role="${escapeHtml(role.role)}" data-required-permission="admin.auth.write"'), true);
  assert.equal(authMembersJs.includes('data-delete-role="${escapeHtml(role.role)}"'), true);
  assert.equal(authMembersJs.includes('data-required-permission="admin.auth.write"'), true);
  assert.equal(authRolesJs.includes('data-required-permission="admin.auth.write"'), true);
});
