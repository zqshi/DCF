const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryStore } = require('../src/infrastructure/repositories/InMemoryStore');
const { SkillUseCases } = require('../src/application/usecases/SkillUseCases');
const { EmployeeUseCases } = require('../src/application/usecases/EmployeeUseCases');

test('skill usecases keep normalized structure and support detail query', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const created = suc.create({
    name: 'finance-reconcile',
    type: 'domain',
    domain: 'finance',
    description: '自动核对财务明细'
  });
  assert.equal(created.type, 'domain');
  assert.equal(created.structure.schema, 'skills.v1');
  assert.equal(Array.isArray(created.structure.steps), true);

  const detail = suc.getById(created.id);
  assert.equal(detail.id, created.id);
  assert.equal(detail.description, '自动核对财务明细');
  assert.equal(detail.structure.trigger.length > 0, true);
});

test('skill usecases preload find-skills as general skill', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const found = suc.list().find((x) => x.name === 'find-skills');
  assert.ok(found);
  assert.equal(found.type, 'general');
  assert.equal(found.source, 'preloaded');
});

test('skill usecases can preload essential skills catalog for admin visibility', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);

  const result = suc.preloadEssentialSkills({ overwrite: true });
  assert.equal((result.created + result.updated) >= 4, true);
  assert.equal(result.total, 4);
  assert.equal(suc.list().some((x) => x.name === 'find-skills'), true);
  assert.equal(suc.list().some((x) => x.name === 'tavily-search'), true);
  assert.equal(suc.list().some((x) => x.name === 'multi-search-engine'), true);
  assert.equal(suc.list().some((x) => x.name === 'office-automation'), true);
  const details = suc.list().filter((x) => ['find-skills', 'tavily-search', 'multi-search-engine', 'office-automation'].includes(x.name));
  assert.equal(details.every((item) => item.structure && String(item.structure.summary || '').trim().length > 0), true);
  assert.equal(details.every((item) => item.structure && String(item.structure.prompt || '').trim().length > 0), true);
  assert.equal(details.every((item) => item.structure && String(item.structure.skillMarkdown || '').trim().length > 0), true);
});

test('skill usecases can sync runtime catalog into managed skills', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const result = suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    items: [
      { slug: 'runtime-mail-assistant', status: 'ready', description: 'mail helper' },
      { slug: 'runtime-risk-review', status: 'ready', type: 'domain', domain: 'ops' },
      { slug: 'runtime-disabled-skill', status: 'disabled' }
    ]
  });
  assert.equal(result.accepted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(suc.list().some((x) => x.name === 'runtime-mail-assistant'), true);
  assert.equal(suc.list().some((x) => x.name === 'runtime-risk-review' && x.type === 'domain' && x.domain === 'ops'), true);
});

test('skill runtime sync can prune missing runtime skills safely', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  suc.importBatch({
    mode: 'merge',
    skills: [
      { name: 'runtime-will-keep', type: 'general', source: 'runtime:openclaw' },
      { name: 'runtime-will-prune', type: 'general', source: 'runtime:openclaw' }
    ]
  });
  const result = suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    pruneMissing: true,
    items: [
      { slug: 'runtime-will-keep', status: 'ready' }
    ]
  });
  assert.equal(result.pruned, 1);
  assert.equal(suc.list().some((x) => x.name === 'runtime-will-keep'), true);
  assert.equal(suc.list().some((x) => x.name === 'runtime-will-prune'), false);
});

test('skill runtime sync keeps runtime raw fields and inference flags for admin truth display', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    fetchedAt: '2026-02-27T00:00:00.000Z',
    items: [
      {
        slug: 'runtime-unknown-shape',
        status: 'enabled',
        raw: {
          slug: 'runtime-unknown-shape',
          status: 'enabled',
          owner: 'runtime-team'
        }
      }
    ]
  });
  const synced = suc.list().find((x) => x.name === 'runtime-unknown-shape');
  assert.ok(synced);
  assert.equal(String(synced.source), 'runtime:openclaw');
  assert.equal(synced.type, 'general');
  assert.equal(synced.description, '');
  assert.equal(synced.version, '');
  assert.equal(Boolean(synced.runtimeMeta), true);
  assert.equal(Boolean(synced.runtimeMeta.platformInference), true);
  assert.equal(synced.runtimeMeta.platformInference.typeInferred, true);
  assert.equal(synced.runtimeMeta.platformInference.descriptionInferred, true);
  assert.equal(synced.runtimeMeta.platformInference.versionInferred, true);
  assert.equal(synced.runtimeMeta.runtime.status, 'enabled');
  assert.equal(synced.runtimeMeta.runtime.raw.owner, 'runtime-team');
});

test('skill runtime sync preserves runtime structure markdown/prompt/resources', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    items: [
      {
        slug: 'runtime-find-skills',
        status: 'ready',
        description: 'runtime skill detail',
        structure: {
          prompt: '你是技能导航助手',
          skillMarkdown: '# Runtime Find Skills',
          resources: {
            scripts: [{ type: 'script', path: 'scripts/find.sh' }],
            templates: [],
            references: [],
            assets: [],
            examples: [],
            tools: [],
            others: []
          }
        }
      }
    ]
  });
  const synced = suc.list().find((x) => x.name === 'runtime-find-skills');
  assert.ok(synced);
  assert.equal(synced.type, 'general');
  assert.equal(String(synced.structure.prompt).includes('技能导航'), true);
  assert.equal(String(synced.structure.skillMarkdown).includes('Runtime Find Skills'), true);
  assert.equal(Array.isArray(synced.structure.resources.scripts), true);
  assert.equal(synced.structure.resources.scripts[0].path, 'scripts/find.sh');
});

test('skill risk score is normalized to range 0..100', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const high = suc.create({ name: 'risk-high', type: 'general', riskScore: 999 });
  const low = suc.create({ name: 'risk-low', type: 'general', riskScore: -5 });
  const mid = suc.create({ name: 'risk-mid', type: 'general', riskScore: 42.6 });
  assert.equal(high.riskScore, 100);
  assert.equal(low.riskScore, 0);
  assert.equal(mid.riskScore, 43);
});

test('skill usecases can export and import with merge/replace mode', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  suc.create({ name: 'general-report', type: 'general' });

  const exported = suc.exportAll();
  assert.equal(exported.schemaVersion, 'skills.export.v1');
  assert.equal(Array.isArray(exported.skills), true);
  assert.equal(exported.skills.length, 5);
  assert.equal(exported.skills.every((x) => x.structure && x.structure.schema === 'skills.v1'), true);

  const mergeResult = suc.importBatch({
    mode: 'merge',
    skills: [
      { name: 'general-report', type: 'general', description: '新版描述' },
      { name: 'ops-risk-audit', type: 'domain', domain: 'ops' }
    ]
  });
  assert.equal(mergeResult.total, 2);
  assert.equal(mergeResult.created, 1);
  assert.equal(mergeResult.updated, 1);

  const replaceResult = suc.importBatch({
    mode: 'replace',
    skills: [{ name: 'final-only', type: 'general' }]
  });
  assert.equal(replaceResult.created, 1);
  assert.equal(replaceResult.updated, 0);
  assert.equal(suc.list().length, 5);
  assert.equal(suc.list().some((x) => x.name === 'final-only'), true);
  assert.equal(suc.list().some((x) => x.name === 'find-skills'), true);
});

test('skill search finds preloaded skill by keyword and supports type filter', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  suc.create({ name: 'finance-reconcile', type: 'domain', domain: 'finance' });

  const result = suc.search({ q: 'skills' });
  assert.equal(result.total >= 1, true);
  assert.equal(result.items[0].name, 'find-skills');

  const filtered = suc.search({ q: 'finance', type: 'domain' });
  assert.equal(filtered.items.some((x) => x.name === 'finance-reconcile'), true);
  assert.equal(filtered.items.some((x) => x.type !== 'domain'), false);
});

test('skill usecases reject invalid import payload', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  assert.throws(() => suc.importBatch({ mode: 'merge', skills: {} }), /skills must be an array/);

  const result = suc.importBatch({
    skills: [
      { name: 'bad-domain', type: 'domain' },
      { name: 'good-general', type: 'general' }
    ]
  });
  assert.equal(result.invalid.length, 1);
  assert.equal(result.created, 1);
});

test('skill usecases can link skill to employee', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Link', creator: 'u-link', department: 'OPS', role: 'Operator' });
  const skill = suc.create({ name: 'ops-report', type: 'general' });

  const linked = suc.linkToEmployee({ employeeId: employee.id, skillId: skill.id });
  assert.equal(linked.employeeId, employee.id);
  assert.equal(linked.skillId, skill.id);
  assert.equal(linked.linkedSkillIds.includes(skill.id), true);
});

test('skill detail includes linked employee summary', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Finance-Reviewer', creator: 'u-fin', department: 'Finance', role: 'Reviewer' });
  const skill = suc.create({ name: 'finance-briefing', type: 'domain', domain: 'finance' });

  suc.linkToEmployee({ employeeId: employee.id, skillId: skill.id });
  const detail = suc.getById(skill.id);
  assert.equal(Array.isArray(detail.linkedEmployees), true);
  assert.equal(detail.linkedEmployees.length, 1);
  assert.equal(detail.linkedEmployees[0].id, employee.id);
  assert.equal(detail.linkedEmployees[0].department, 'Finance');
});

test('skill usecases support unlink and guarded delete', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const euc = new EmployeeUseCases(store);
  const employee = euc.create({ name: 'Ops-Unlink', creator: 'u-unlink', department: 'OPS', role: 'Operator' });
  const skill = suc.create({ name: 'ops-cleanup', type: 'general' });

  suc.linkToEmployee({ employeeId: employee.id, skillId: skill.id });
  assert.throws(() => suc.deleteSkill(skill.id), /unlink first/);

  const unlinked = suc.unlinkFromEmployee({ employeeId: employee.id, skillId: skill.id });
  assert.equal(unlinked.linkedSkillIds.includes(skill.id), false);

  const deleted = suc.deleteSkill(skill.id);
  assert.equal(deleted.deleted, true);
  assert.equal(suc.list().some((x) => x.id === skill.id), false);
});

test('deleted preloaded skill should not be auto-restored on next read', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const preloaded = suc.list().find((x) => x.name === 'find-skills');
  assert.ok(preloaded);

  const deleted = suc.deleteSkill(preloaded.id);
  assert.equal(deleted.deleted, true);
  assert.equal(suc.list().some((x) => x.name === 'find-skills'), false);
});

test('deleted skill should not be reintroduced by runtime sync', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const runtimeSync = suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    items: [{ slug: 'runtime-mail-assistant', status: 'ready' }]
  });
  assert.equal(runtimeSync.accepted, 1);
  const runtimeSkill = suc.list().find((x) => x.name === 'runtime-mail-assistant');
  assert.ok(runtimeSkill);

  const deleted = suc.deleteSkill(runtimeSkill.id);
  assert.equal(deleted.deleted, true);
  assert.equal(suc.list().some((x) => x.name === 'runtime-mail-assistant'), false);

  const syncedAgain = suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    items: [{ slug: 'runtime-mail-assistant', status: 'ready' }]
  });
  assert.equal(syncedAgain.skippedDeleted, 1);
  assert.equal(suc.list().some((x) => x.name === 'runtime-mail-assistant'), false);
});

test('deleted essential preloaded skill should not be restored by runtime sync side effects', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const essential = suc.list().find((x) => x.name === 'office-automation');
  assert.ok(essential);

  const deleted = suc.deleteSkill(essential.id);
  assert.equal(deleted.deleted, true);
  assert.equal(suc.list().some((x) => x.name === 'office-automation'), false);

  suc.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    items: [{ slug: 'runtime-anything', status: 'ready' }]
  });
  assert.equal(suc.list().some((x) => x.name === 'office-automation'), false);
});

test('skill structure preserves full prompt and resource groups', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const created = suc.create({
    name: 'ops-runbook',
    type: 'domain',
    domain: 'ops',
    prompt: '你是运维专家，请严格按回滚清单执行，不得跳步。',
    structure: {
      skillMarkdown: '# Ops Runbook\n\n## Prompt\n你是运维专家，请严格按回滚清单执行，不得跳步。\n',
      resources: {
        scripts: [{ path: 'scripts/rollback.sh', command: 'bash scripts/rollback.sh', description: '执行回滚' }],
        templates: ['templates/incident-report.md'],
        references: [{ name: 'SRE Guide', path: 'references/sre.md' }]
      }
    }
  });
  const detail = suc.getById(created.id);
  assert.equal(detail.structure.prompt, '你是运维专家，请严格按回滚清单执行，不得跳步。');
  assert.equal(Array.isArray(detail.structure.resources.scripts), true);
  assert.equal(detail.structure.resources.scripts.length, 1);
  assert.equal(detail.structure.resources.templates.length, 1);
  assert.equal(detail.structure.resources.references.length, 1);
  assert.equal(detail.structure.skillMarkdown.includes('Ops Runbook'), true);
});

test('skill usecases can import skills from archive bundle via importer', async () => {
  const store = new InMemoryStore();
  const mockImporter = {
    readArchive(input) {
      assert.equal(input.fileName, 'ops-bundle.zip');
      assert.equal(Boolean(input.dataBase64), true);
      return {
        fileName: input.fileName,
        skills: [
          {
            name: 'bundle-ops-skill',
            type: 'domain',
            domain: 'ops',
            description: 'skill from archive bundle'
          }
        ]
      };
    }
  };
  const suc = new SkillUseCases(store, { bundleImporter: mockImporter });
  const result = await suc.importBundle({
    mode: 'merge',
    archive: {
      fileName: 'ops-bundle.zip',
      dataBase64: 'UEsDBAoAAAAAA'
    }
  });
  assert.equal(result.created, 1);
  assert.equal(result.archive.fileName, 'ops-bundle.zip');
  assert.equal(result.archive.skillCount, 1);
  assert.equal(suc.list().some((x) => x.name === 'bundle-ops-skill'), true);
});

test('skill proposal state machine enforces deterministic transitions', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);

  const proposal = suc.propose({
    name: 'finance-risk-proposal',
    type: 'domain',
    domain: 'finance',
    description: 'Finance risk proposal',
    evaluation: {
      summaryDimensionCount: 8,
      dimensions: {
        technicalMaturity: 4,
        communityActivity: 4,
        codeQuality: 4,
        documentation: 4,
        licenseCompliance: 4,
        security: 4,
        performance: 3,
        maintainability: 4
      },
      hardGate: { passed: true, reasons: [] },
      evidence: [{
        sourceUrl: 'https://github.com/example/finance-risk-proposal',
        capturedAt: new Date().toISOString(),
        evidenceExcerpt: 'repo audit snapshot'
      }]
    }
  }, { userId: 'u-skill-1' });
  assert.equal(proposal.status, 'pending');

  assert.throws(() => suc.changeProposalStatus(proposal.id, 'approved', {
    userId: 'u-skill-1',
    role: 'skill_admin',
    note: 'self approve should be blocked'
  }), /approver must be different from proposer/);

  const approved = suc.changeProposalStatus(proposal.id, 'approved', {
    userId: 'u-admin-1',
    role: 'super_admin',
    note: 'looks good'
  });
  assert.equal(approved.status, 'approved');

  assert.throws(() => suc.changeProposalStatus(proposal.id, 'rollback', {
    userId: 'u-skill-1',
    role: 'skill_admin',
    reason: 'need revision but role should be blocked'
  }), /role is not allowed/);

  const rolledBack = suc.changeProposalStatus(proposal.id, 'rollback', {
    userId: 'u-admin-1',
    role: 'super_admin',
    reason: 'need revision'
  });
  assert.equal(rolledBack.status, 'rollback');

  const resubmitted = suc.changeProposalStatus(proposal.id, 'pending', {
    userId: 'u-skill-1',
    role: 'skill_admin',
    note: 'resubmit after changes'
  });
  assert.equal(resubmitted.status, 'pending');

  const rejected = suc.changeProposalStatus(proposal.id, 'rejected', {
    userId: 'u-admin-1',
    role: 'super_admin',
    reason: 'not fit'
  });
  assert.equal(rejected.status, 'rejected');
  assert.ok(Array.isArray(rejected.proposal.history));
  assert.equal(rejected.proposal.history.length >= 4, true);
  assert.throws(() => suc.changeProposalStatus(proposal.id, 'approved', { userId: 'u-admin-1', role: 'super_admin' }), /invalid skill status transition/);
});

test('skill proposal approval is blocked when evaluation evidence is missing', () => {
  const store = new InMemoryStore();
  const suc = new SkillUseCases(store);
  const proposal = suc.propose({
    name: 'evidence-missing-proposal',
    type: 'general',
    evaluation: {
      summaryDimensionCount: 8,
      dimensions: {
        technicalMaturity: 4,
        communityActivity: 4,
        codeQuality: 4,
        documentation: 4,
        licenseCompliance: 4,
        security: 4,
        performance: 4,
        maintainability: 4
      },
      hardGate: { passed: true, reasons: [] },
      evidence: []
    }
  }, { userId: 'u-skill-2' });

  assert.throws(() => suc.changeProposalStatus(proposal.id, 'approved', {
    userId: 'u-admin-2',
    role: 'super_admin'
  }), /requires at least one evidence item/);
});
