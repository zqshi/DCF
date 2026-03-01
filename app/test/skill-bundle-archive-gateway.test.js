const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SkillBundleArchiveGateway } = require('../src/infrastructure/integrations/SkillBundleArchiveGateway');

test('skill bundle archive gateway parses SKILL.md bundle and resources', async (t) => {
  const hasZip = spawnSync('zip', ['-v'], { encoding: 'utf8' }).status === 0;
  const hasUnzip = spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0;
  if (!hasZip || !hasUnzip) {
    t.skip('zip/unzip command unavailable in environment');
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-skill-zip-test-'));
  const skillDir = path.join(tmpRoot, 'risk-inspector');
  const scriptsDir = path.join(skillDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: risk-inspector\ntype: domain\ndomain: finance\ndescription: 风险巡检技能\n---\n\n## Prompt\n你是风险巡检专家。\n`, 'utf8');
  fs.writeFileSync(path.join(scriptsDir, 'check.sh'), '#!/usr/bin/env bash\necho check\n', 'utf8');

  const zipPath = path.join(tmpRoot, 'risk-inspector.zip');
  const zipResult = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: skillDir, encoding: 'utf8' });
  assert.equal(zipResult.status, 0, zipResult.stderr || zipResult.stdout);

  const gateway = new SkillBundleArchiveGateway();
  const output = await gateway.readArchive({
    fileName: 'risk-inspector.zip',
    dataBase64: fs.readFileSync(zipPath).toString('base64')
  });

  assert.equal(Array.isArray(output.skills), true);
  assert.equal(output.skills.length, 1);
  assert.equal(output.skills[0].name, 'risk-inspector');
  assert.equal(output.skills[0].type, 'domain');
  assert.equal(output.skills[0].domain, 'finance');
  assert.equal(output.skills[0].structure.prompt.includes('风险巡检专家'), true);
  assert.equal(output.skills[0].structure.skillMarkdown.includes('## Prompt'), true);
  assert.equal(output.skills[0].structure.resources.scripts.length, 1);
  assert.equal(output.skills[0].structure.resources.scripts[0].content.includes('echo check'), true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('skill bundle archive gateway enriches skill.json with SKILL.md and template content', async (t) => {
  const hasZip = spawnSync('zip', ['-v'], { encoding: 'utf8' }).status === 0;
  const hasUnzip = spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0;
  if (!hasZip || !hasUnzip) {
    t.skip('zip/unzip command unavailable in environment');
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-skill-zip-test-json-md-'));
  const skillDir = path.join(tmpRoot, 'skills-finder');
  const templatesDir = path.join(skillDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify({
    name: 'skills-finder',
    type: 'general',
    description: 'json source',
    structure: {
      resources: {
        templates: [{ path: 'templates/skill-search.md', description: 'search template' }]
      }
    }
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skills Finder\n\n## Prompt\n你是技能搜索专家。\n', 'utf8');
  fs.writeFileSync(path.join(templatesDir, 'skill-search.md'), '## Template\n\n- keyword: {{keyword}}\n', 'utf8');

  const zipPath = path.join(tmpRoot, 'skills-finder.zip');
  const zipResult = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: skillDir, encoding: 'utf8' });
  assert.equal(zipResult.status, 0, zipResult.stderr || zipResult.stdout);

  const gateway = new SkillBundleArchiveGateway();
  const output = await gateway.readArchive({
    fileName: 'skills-finder.zip',
    dataBase64: fs.readFileSync(zipPath).toString('base64')
  });

  assert.equal(output.skills.length, 1);
  assert.equal(output.skills[0].name, 'skills-finder');
  assert.equal(output.skills[0].structure.skillMarkdown.includes('# Skills Finder'), true);
  assert.equal(output.skills[0].structure.prompt.includes('技能搜索专家'), true);
  assert.equal(output.skills[0].structure.resources.templates.length, 1);
  assert.equal(output.skills[0].structure.resources.templates[0].path, 'templates/skill-search.md');
  assert.equal(output.skills[0].structure.resources.templates[0].content.includes('{{keyword}}'), true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
