#!/usr/bin/env node
const { hashPasswordForStorage } = require('../src/application/usecases/AuthUseCases');

function usage() {
  // eslint-disable-next-line no-console
  console.log('用法: node scripts/hash-admin-password.js <明文密码> [pepper]');
  process.exit(1);
}

const plain = process.argv[2];
if (!plain) usage();
const pepper = process.argv[3] || process.env.AUTH_PASSWORD_PEPPER || '';
const hash = hashPasswordForStorage(plain, pepper);
// eslint-disable-next-line no-console
console.log(hash);
