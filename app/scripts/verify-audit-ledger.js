#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function usage() {
  console.error('Usage: node scripts/verify-audit-ledger.js <ledger-path> [secret]');
}

function main() {
  const ledgerPath = process.argv[2] || process.env.AUDIT_ANCHOR_LEDGER_PATH;
  const secret = String(process.argv[3] || process.env.AUDIT_ANCHOR_SECRET || 'dcf-default-anchor-secret');
  if (!ledgerPath) {
    usage();
    process.exit(2);
  }

  const absolute = path.resolve(ledgerPath);
  if (!fs.existsSync(absolute)) {
    console.error(`Ledger file not found: ${absolute}`);
    process.exit(2);
  }

  const lines = fs.readFileSync(absolute, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.length) {
    console.log(JSON.stringify({ ok: true, count: 0, reason: 'empty ledger' }, null, 2));
    return;
  }

  const anchors = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at line ${index + 1}: ${error.message}`);
    }
  });

  for (let i = 0; i < anchors.length; i += 1) {
    const current = anchors[i];
    const previous = i > 0 ? anchors[i - 1] : null;
    const expectedPrev = previous ? previous.signature : 'GENESIS';
    if ((current.previousSignature || 'GENESIS') !== expectedPrev) {
      throw new Error(`Anchor chain mismatch at line ${i + 1}: expected previousSignature=${expectedPrev}`);
    }

    const expectedSignature = hash(
      `${current.headHash}|${current.eventCount}|${current.createdAt}|${current.creator}|${current.previousSignature || 'GENESIS'}|${secret}`
    );
    if (expectedSignature !== current.signature) {
      throw new Error(`Anchor signature mismatch at line ${i + 1}: anchorId=${current.id}`);
    }
  }

  const latest = anchors[anchors.length - 1];
  console.log(JSON.stringify({
    ok: true,
    count: anchors.length,
    latestAnchorId: latest.id,
    latestHeadHash: latest.headHash
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
