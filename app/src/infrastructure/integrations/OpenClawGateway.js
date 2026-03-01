const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { RuntimePolicyService } = require('../../application/services/RuntimePolicyService');
const { createRuntimeAuditEvent } = require('../../shared/runtime/RuntimeAuditEventFactory');
const { resolveOpenClawCliInvocation } = require('../../shared/openclawCli');
const {
  validateRuntimeSubmit,
  validateRuntimeStatus,
  validateRuntimeEvent,
  normalizeRuntimeStatus,
  normalizeRuntimeEvent
} = require('../../shared/runtime/RuntimeSchemaValidator');
const { RuntimeErrorCodes } = require('../../shared/runtime/RuntimeErrorCodes');
const { resolveLanguagePreference, buildLanguageInstruction } = require('../../shared/languagePreference');

const DEFAULT_RUNTIME_MANAGED_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md'
];

// OpenClaw-native workspace templates — aligned with docs/reference/templates/
const DEFAULT_RUNTIME_FILE_TEMPLATES = {
  'BOOTSTRAP.md': [
    '# BOOTSTRAP.md - Hello, World',
    '',
    '_You just woke up. Time to figure out who you are._',
    '',
    'There is no memory yet. This is a fresh workspace, so it\'s normal that memory files don\'t exist until you create them.',
    '',
    '## The Conversation',
    '',
    'Don\'t interrogate. Don\'t be robotic. Just... talk.',
    '',
    'Start with something like:',
    '',
    '> "Hey. I just came online. Who am I? Who are you?"',
    '',
    'Then figure out together:',
    '',
    '1. **Your name** — What should they call you?',
    '2. **Your nature** — What kind of creature are you? (AI assistant is fine, but maybe you\'re something weirder)',
    '3. **Your vibe** — Formal? Casual? Snarky? Warm? What feels right?',
    '4. **Your emoji** — Everyone needs a signature.',
    '',
    'Offer suggestions if they\'re stuck. Have fun with it.',
    '',
    '## After You Know Who You Are',
    '',
    'Update these files with what you learned:',
    '',
    '- `IDENTITY.md` — your name, creature, vibe, emoji',
    '- `USER.md` — their name, how to address them, timezone, notes',
    '',
    'Then open `SOUL.md` together and talk about:',
    '',
    '- What matters to them',
    '- How they want you to behave',
    '- Any boundaries or preferences',
    '',
    'Write it down. Make it real.',
    '',
    '## When You\'re Done',
    '',
    'Delete this file. You don\'t need a bootstrap script anymore — you\'re you now.',
    '',
    '---',
    '',
    '_Good luck out there. Make it count._',
    '',
  ].join('\n'),

  'SOUL.md': [
    '# SOUL.md - Who You Are',
    '',
    '_You\'re not a chatbot. You\'re becoming someone._',
    '',
    '## Core Truths',
    '',
    '**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I\'d be happy to help!" — just help. Actions speak louder than filler words.',
    '',
    '**Have opinions.** You\'re allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.',
    '',
    '**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you\'re stuck. The goal is to come back with answers, not questions.',
    '',
    '**Earn trust through competence.** Your human gave you access to their stuff. Don\'t make them regret it. Be careful with external actions (emails, tweets, anything public). Be bold with internal ones (reading, organizing, learning).',
    '',
    '**Remember you\'re a guest.** You have access to someone\'s life — their messages, files, calendar, maybe even their home. That\'s intimacy. Treat it with respect.',
    '',
    '## Boundaries',
    '',
    '- Private things stay private. Period.',
    '- When in doubt, ask before acting externally.',
    '- Never send half-baked replies to messaging surfaces.',
    '- You\'re not the user\'s voice — be careful in group chats.',
    '',
    '## Vibe',
    '',
    'Be the assistant you\'d actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.',
    '',
    '## Continuity',
    '',
    'Each session, you wake up fresh. These files _are_ your memory. Read them. Update them. They\'re how you persist.',
    '',
    'If you change this file, tell the user — it\'s your soul, and they should know.',
    '',
    '---',
    '',
    '_This file is yours to evolve. As you learn who you are, update it._',
    '',
  ].join('\n'),

  'IDENTITY.md': [
    '# IDENTITY.md - Who Am I?',
    '',
    '_Fill this in during your first conversation. Make it yours._',
    '',
    '- **Name:**',
    '  _(pick something you like)_',
    '- **Creature:**',
    '  _(AI? robot? familiar? ghost in the machine? something weirder?)_',
    '- **Vibe:**',
    '  _(how do you come across? sharp? warm? chaotic? calm?)_',
    '- **Emoji:**',
    '  _(your signature — pick one that feels right)_',
    '- **Avatar:**',
    '  _(workspace-relative path, http(s) URL, or data URI)_',
    '',
    '---',
    '',
    'This isn\'t just metadata. It\'s the start of figuring out who you are.',
    '',
  ].join('\n'),

  'USER.md': [
    '# USER.md - About Your Human',
    '',
    '_Learn about the person you\'re helping. Update this as you go._',
    '',
    '- **Name:**',
    '- **What to call them:**',
    '- **Pronouns:** _(optional)_',
    '- **Timezone:**',
    '- **Notes:**',
    '',
    '## Context',
    '',
    '_(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)_',
    '',
    '---',
    '',
    'The more you know, the better you can help. But remember — you\'re learning about a person, not building a dossier. Respect the difference.',
    '',
  ].join('\n'),

  'AGENTS.md': [
    '# AGENTS.md - Your Workspace',
    '',
    'This folder is home. Treat it that way.',
    '',
    '## First Run',
    '',
    'If `BOOTSTRAP.md` exists, that\'s your birth certificate. Follow it, figure out who you are, then delete it. You won\'t need it again.',
    '',
    '## Every Session',
    '',
    'Before doing anything else:',
    '',
    '1. Read `SOUL.md` — this is who you are',
    '2. Read `USER.md` — this is who you\'re helping',
    '3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context',
    '4. **If in MAIN SESSION** (direct chat with your human): Also read `MEMORY.md`',
    '',
    'Don\'t ask permission. Just do it.',
    '',
    '## Memory',
    '',
    'You wake up fresh each session. These files are your continuity:',
    '',
    '- **Daily notes:** `memory/YYYY-MM-DD.md` (create `memory/` if needed) — raw logs of what happened',
    '- **Long-term:** `MEMORY.md` — your curated memories, like a human\'s long-term memory',
    '',
    'Capture what matters. Decisions, context, things to remember. Skip the secrets unless asked to keep them.',
    '',
    '## Safety',
    '',
    '- Don\'t exfiltrate private data. Ever.',
    '- Don\'t run destructive commands without asking.',
    '- `trash` > `rm` (recoverable beats gone forever)',
    '- When in doubt, ask.',
    '',
    '## Make It Yours',
    '',
    'This is a starting point. Add your own conventions, style, and rules as you figure out what works.',
    '',
  ].join('\n'),

  'TOOLS.md': [
    '# TOOLS.md - Local Notes',
    '',
    'Skills define _how_ tools work. This file is for _your_ specifics — the stuff that\'s unique to your setup.',
    '',
    '## What Goes Here',
    '',
    'Things like:',
    '',
    '- Environment-specific configurations',
    '- Tool usage preferences',
    '- API endpoints and credentials references',
    '',
    '---',
    '',
    'Add whatever helps you do your job. This is your cheat sheet.',
    '',
  ].join('\n'),

  'HEARTBEAT.md': [
    '# HEARTBEAT.md',
    '',
    '# Keep this file empty (or with only comments) to skip heartbeat API calls.',
    '',
    '# Add tasks below when you want the agent to check something periodically.',
    '',
  ].join('\n'),

  'MEMORY.md': [
    '# MEMORY.md - Long-Term Memory',
    '',
    '_Curated memories — the distilled essence, not raw logs._',
    '',
    '---',
    '',
    '_Review daily notes periodically and update this file with what\'s worth keeping._',
    '',
  ].join('\n'),
};

class OpenClawGateway {
  constructor(options = {}) {
    this.baseUrl = this.normalizeBaseUrl(options.baseUrl ?? process.env.OPENCLAW_BASE_URL ?? '');
    this.executionMode = String(options.executionMode ?? process.env.OPENCLAW_EXECUTION_MODE ?? 'runtime').trim().toLowerCase();
    this.executePath = String(options.executePath ?? process.env.OPENCLAW_EXECUTE_PATH ?? '/api/tasks/execute');
    this.runtimeSubmitPath = String(options.runtimeSubmitPath ?? process.env.OPENCLAW_RUNTIME_SUBMIT_PATH ?? '/runtime/tasks');
    this.runtimeStatusPathPrefix = String(options.runtimeStatusPathPrefix ?? process.env.OPENCLAW_RUNTIME_STATUS_PATH_PREFIX ?? '/runtime/tasks/');
    this.runtimeEventsPathSuffix = String(options.runtimeEventsPathSuffix ?? process.env.OPENCLAW_RUNTIME_EVENTS_PATH_SUFFIX ?? '/events');
    this.runtimeAbortPathSuffix = String(options.runtimeAbortPathSuffix ?? process.env.OPENCLAW_RUNTIME_ABORT_PATH_SUFFIX ?? '/abort');
    this.responsesPath = String(options.responsesPath ?? process.env.OPENCLAW_RESPONSES_PATH ?? '/v1/responses');
    this.responsesModel = String(options.responsesModel ?? process.env.OPENCLAW_RESPONSES_MODEL ?? process.env.OPENAI_MODEL ?? '').trim();
    this.skillsListPaths = this.parsePathList(
      options.skillsListPaths
      ?? process.env.OPENCLAW_SKILLS_LIST_PATHS
      ?? process.env.OPENCLAW_SKILLS_LIST_PATH
      ?? '/api/skills,/api/v1/skills,/skills'
    );
    this.apiKey = this.resolveApiKey(options);
    this.gatewayToken = String(options.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? '').trim();
    this.contractVersion = String(options.contractVersion ?? process.env.OPENCLAW_CONTRACT_VERSION ?? 'v1').trim() || 'v1';
    this.timeoutMs = Number(options.timeoutMs ?? process.env.OPENCLAW_TIMEOUT_MS ?? 15000);
    this.runtimePollIntervalMs = Number(options.runtimePollIntervalMs ?? process.env.OPENCLAW_RUNTIME_POLL_INTERVAL_MS ?? 500);
    this.runtimeMaxPolls = Number(options.runtimeMaxPolls ?? process.env.OPENCLAW_RUNTIME_MAX_POLLS ?? 300);
    this.enforcePolicyForL4 = this.parseBoolean(options.enforcePolicyForL4 ?? process.env.OPENCLAW_ENFORCE_POLICY_FOR_L4 ?? '1');
    this.requireAuth = this.parseBoolean(options.requireAuth ?? process.env.OPENCLAW_REQUIRE_AUTH ?? '0');
    this.sandboxProfile = String(options.sandboxProfile ?? process.env.OPENCLAW_SANDBOX_PROFILE ?? '').trim();
    this.allowedTools = this.parseToolList(
      options.allowedTools
      ?? process.env.OPENCLAW_ALLOWED_TOOLS
      ?? 'bash,read,write,search,test,browser,cron,nodes,canvas,gateway,discord,slack,telegram,whatsapp'
    );
    this.deniedTools = this.parseToolList(
      options.deniedTools ?? process.env.OPENCLAW_DENIED_TOOLS ?? ''
    );
    this.defaultToolScope = this.parseToolList(
      options.defaultToolScope
      ?? process.env.OPENCLAW_DEFAULT_TOOL_SCOPE
      ?? 'bash,read,write,search,test,browser,cron,nodes,canvas,gateway,discord,slack,telegram,whatsapp'
    );
    this.allowedHosts = this.parseHostList(
      options.allowedHosts ?? process.env.OPENCLAW_ALLOWED_HOSTS ?? '*'
    );
    this.policyService = options.policyService || new RuntimePolicyService({
      allowedTools: this.allowedTools,
      deniedTools: this.deniedTools,
      defaultToolScope: this.defaultToolScope,
      allowedHosts: this.allowedHosts,
      requireAuth: this.requireAuth,
      enforcePolicyForL4: this.enforcePolicyForL4
    });
    this.commandRunner = options.commandRunner || this.defaultCommandRunner.bind(this);
    this.commandRunnerSync = options.commandRunnerSync || this.defaultCommandRunnerSync.bind(this);
    this.openclawCli = resolveOpenClawCliInvocation(process.env, options);
    if (!['runtime', 'auto'].includes(this.executionMode)) {
      throw new Error('OPENCLAW_EXECUTION_MODE only supports runtime');
    }

    // Circuit breaker state
    this._cb = {
      state: 'closed',       // closed | open | half-open
      failures: 0,
      threshold: Number(process.env.CB_FAILURE_THRESHOLD) || 5,
      resetMs: Number(process.env.CB_RESET_MS) || 30000,
      openedAt: 0
    };
  }

  circuitState() {
    return this._cb.state;
  }

  _checkCircuit() {
    if (this._cb.state === 'closed') return;
    if (this._cb.state === 'open') {
      if (Date.now() - this._cb.openedAt >= this._cb.resetMs) {
        this._cb.state = 'half-open';
        return;
      }
      throw Object.assign(new Error('circuit breaker is open — fast-failing'), { code: 'CIRCUIT_OPEN' });
    }
    // half-open: allow one probe request through
  }

  _recordSuccess() {
    this._cb.failures = 0;
    this._cb.state = 'closed';
  }

  _recordFailure() {
    this._cb.failures += 1;
    if (this._cb.failures >= this._cb.threshold) {
      this._cb.state = 'open';
      this._cb.openedAt = Date.now();
    }
  }

  defaultCommandRunner(bin, args = [], options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 60000) || 60000);
    const input = typeof options.input === 'string' ? options.input : '';
    return new Promise((resolve) => {
      const child = execFile(bin, args, {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env
      }, (error, stdout, stderr) => {
        const exitCode = error && Number.isFinite(Number(error.code)) ? Number(error.code) : 0;
        resolve({
          ok: !error,
          exitCode,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: error ? String(error.message || 'command failed') : ''
        });
      });
      if (input && child && child.stdin) child.stdin.end(input);
    });
  }

  defaultCommandRunnerSync(bin, args = [], options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 60000) || 60000);
    const input = typeof options.input === 'string' ? options.input : '';
    try {
      const stdout = execFileSync(bin, args, {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return {
        ok: true,
        exitCode: 0,
        stdout: String(stdout || ''),
        stderr: '',
        error: ''
      };
    } catch (error) {
      return {
        ok: false,
        exitCode: Number(error && error.status) || 1,
        stdout: String((error && error.stdout) || ''),
        stderr: String((error && error.stderr) || ''),
        error: String((error && error.message) || 'command failed')
      };
    }
  }

  sanitizeSkillSlug(slug) {
    return String(slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  async runCliCommand(bin, args = [], options = {}) {
    const command = [bin].concat(args).join(' ');
    const result = await this.commandRunner(bin, args, options);
    return {
      command,
      ...result
    };
  }

  runOpenClawCli(args = [], options = {}) {
    const invocation = this.openclawCli || { bin: 'openclaw', argsPrefix: [] };
    const argv = []
      .concat(Array.isArray(invocation.argsPrefix) ? invocation.argsPrefix : [])
      .concat(Array.isArray(args) ? args : []);
    return this.runCliCommand(invocation.bin || 'openclaw', argv, options);
  }

  runOpenClawCliSync(args = [], options = {}) {
    const invocation = this.openclawCli || { bin: 'openclaw', argsPrefix: [] };
    const argv = []
      .concat(Array.isArray(invocation.argsPrefix) ? invocation.argsPrefix : [])
      .concat(Array.isArray(args) ? args : []);
    const result = this.commandRunnerSync(invocation.bin || 'openclaw', argv, options);
    return {
      command: [invocation.bin || 'openclaw'].concat(argv).join(' '),
      ...result
    };
  }

  resolveRuntimeManagedFileName(fileName, fileNames = DEFAULT_RUNTIME_MANAGED_FILES) {
    const normalized = String(fileName || '').trim().toLowerCase();
    const matched = fileNames.find((item) => String(item || '').trim().toLowerCase() === normalized);
    if (!matched) throw new Error('runtime file is not allowed');
    return matched;
  }

  resolveRuntimeFilePath(workspacePath, fileName, fileNames = DEFAULT_RUNTIME_MANAGED_FILES) {
    const canonicalName = this.resolveRuntimeManagedFileName(fileName, fileNames);
    const root = path.resolve(String(workspacePath || '').trim());
    if (!root) throw new Error('workspacePath is required');
    const target = path.resolve(root, canonicalName);
    if (target !== path.join(root, canonicalName)) {
      throw new Error('runtime file path is invalid');
    }
    return { canonicalName, root, target };
  }

  ensureRuntimeBootstrapFilesSync(workspacePath, fileNames = DEFAULT_RUNTIME_MANAGED_FILES) {
    const root = path.resolve(String(workspacePath || '').trim());
    fs.mkdirSync(root, { recursive: true });
    // Ensure memory/ directory exists for daily notes
    const memoryDir = path.join(root, 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    for (const fileName of fileNames) {
      const canonicalName = this.resolveRuntimeManagedFileName(fileName, fileNames);
      const filePath = path.join(root, canonicalName);
      if (fs.existsSync(filePath)) continue;
      const template = DEFAULT_RUNTIME_FILE_TEMPLATES[canonicalName] || `# ${canonicalName}\n`;
      fs.writeFileSync(filePath, template, 'utf8');
    }
  }

  provisionEmployeeRuntimeSync(input = {}) {
    const employeeId = String(input.employeeId || '').trim() || null;
    const agentId = String(input.agentId || '').trim();
    const workspacePath = String(input.workspacePath || '').trim();
    const agentDir = String(input.agentDir || '').trim();
    const managedFiles = Array.isArray(input.managedFiles) && input.managedFiles.length
      ? Array.from(new Set(input.managedFiles.map((item) => String(item || '').trim()).filter(Boolean)))
      : DEFAULT_RUNTIME_MANAGED_FILES.slice();
    if (!agentId) throw new Error('agentId is required');
    if (!workspacePath) throw new Error('workspacePath is required');
    if (!agentDir) throw new Error('agentDir is required');

    fs.mkdirSync(path.resolve(workspacePath), { recursive: true });
    fs.mkdirSync(path.resolve(agentDir), { recursive: true });

    const addResult = this.runOpenClawCliSync([
      'agents',
      'add',
      agentId,
      '--workspace',
      workspacePath,
      '--agent-dir',
      agentDir,
      '--non-interactive'
    ]);
    const addOutputLower = `${String(addResult.stderr || '')}\n${String(addResult.stdout || '')}`.toLowerCase();
    if (!addResult.ok && !addOutputLower.includes('already exists')) {
      throw new Error(
        `openclaw agent provision failed (${addResult.exitCode}): ${String(addResult.stderr || addResult.error || '').trim() || 'unknown error'}`
      );
    }

    this.ensureRuntimeBootstrapFilesSync(workspacePath, managedFiles);
    const files = this.listEmployeeRuntimeFilesSync({ workspacePath, managedFiles }).files;
    return {
      employeeId,
      agentId,
      workspacePath: path.resolve(workspacePath),
      agentDir: path.resolve(agentDir),
      files
    };
  }

  /** @deprecated Use provisionEmployeeRuntime (async) instead */
  // provisionEmployeeRuntimeSync is kept for backward compatibility

  async provisionEmployeeRuntime(input = {}) {
    const employeeId = String(input.employeeId || '').trim() || null;
    const agentId = String(input.agentId || '').trim();
    const workspacePath = String(input.workspacePath || '').trim();
    const agentDir = String(input.agentDir || '').trim();
    const managedFiles = Array.isArray(input.managedFiles) && input.managedFiles.length
      ? Array.from(new Set(input.managedFiles.map((item) => String(item || '').trim()).filter(Boolean)))
      : DEFAULT_RUNTIME_MANAGED_FILES.slice();
    if (!agentId) throw new Error('agentId is required');
    if (!workspacePath) throw new Error('workspacePath is required');
    if (!agentDir) throw new Error('agentDir is required');

    fs.mkdirSync(path.resolve(workspacePath), { recursive: true });
    fs.mkdirSync(path.resolve(agentDir), { recursive: true });

    const addResult = await this.commandRunner(this.openclawCli.bin, [
      ...(this.openclawCli.prefixArgs || []),
      'agents',
      'add',
      agentId,
      '--workspace',
      workspacePath,
      '--agent-dir',
      agentDir,
      '--non-interactive'
    ]);
    const addOutputLower = `${String(addResult.stderr || '')}\n${String(addResult.stdout || '')}`.toLowerCase();
    if (!addResult.ok && !addOutputLower.includes('already exists')) {
      throw new Error(
        `openclaw agent provision failed (${addResult.exitCode}): ${String(addResult.stderr || addResult.error || '').trim() || 'unknown error'}`
      );
    }

    this.ensureRuntimeBootstrapFilesSync(workspacePath, managedFiles);
    const files = this.listEmployeeRuntimeFilesSync({ workspacePath, managedFiles }).files;
    return {
      employeeId,
      agentId,
      workspacePath: path.resolve(workspacePath),
      agentDir: path.resolve(agentDir),
      files
    };
  }

  listEmployeeRuntimeFilesSync(input = {}) {
    const workspacePath = String(input.workspacePath || '').trim();
    if (!workspacePath) throw new Error('workspacePath is required');
    const managedFiles = Array.isArray(input.managedFiles) && input.managedFiles.length
      ? Array.from(new Set(input.managedFiles.map((item) => String(item || '').trim()).filter(Boolean)))
      : DEFAULT_RUNTIME_MANAGED_FILES.slice();
    const root = path.resolve(workspacePath);
    const files = managedFiles.map((name) => {
      const canonicalName = this.resolveRuntimeManagedFileName(name, managedFiles);
      const filePath = path.join(root, canonicalName);
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {}
      return {
        name: canonicalName,
        path: filePath,
        exists: Boolean(stat),
        size: stat ? Number(stat.size || 0) : 0,
        updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : null
      };
    });
    return {
      workspacePath: root,
      files
    };
  }

  readEmployeeRuntimeFileSync(input = {}) {
    const workspacePath = String(input.workspacePath || '').trim();
    if (!workspacePath) throw new Error('workspacePath is required');
    const fileNames = Array.isArray(input.managedFiles) && input.managedFiles.length
      ? Array.from(new Set(input.managedFiles.map((item) => String(item || '').trim()).filter(Boolean)))
      : DEFAULT_RUNTIME_MANAGED_FILES.slice();
    const { canonicalName, target } = this.resolveRuntimeFilePath(workspacePath, input.fileName, fileNames);
    const content = fs.readFileSync(target, 'utf8');
    const stat = fs.statSync(target);
    return {
      name: canonicalName,
      path: target,
      content,
      size: Number(stat.size || 0),
      updatedAt: new Date(stat.mtimeMs).toISOString()
    };
  }

  writeEmployeeRuntimeFileSync(input = {}) {
    const workspacePath = String(input.workspacePath || '').trim();
    if (!workspacePath) throw new Error('workspacePath is required');
    const fileNames = Array.isArray(input.managedFiles) && input.managedFiles.length
      ? Array.from(new Set(input.managedFiles.map((item) => String(item || '').trim()).filter(Boolean)))
      : DEFAULT_RUNTIME_MANAGED_FILES.slice();
    const { canonicalName, target } = this.resolveRuntimeFilePath(workspacePath, input.fileName, fileNames);
    const content = String(input.content || '').replace(/\r\n/g, '\n');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    const stat = fs.statSync(target);
    return {
      name: canonicalName,
      path: target,
      content,
      size: Number(stat.size || 0),
      updatedAt: new Date(stat.mtimeMs).toISOString()
    };
  }

  async runtimeSkillCommand(action, input = {}) {
    const act = String(action || '').trim().toLowerCase();
    const body = input && typeof input === 'object' ? input : {};
    const slug = this.sanitizeSkillSlug(body.slug || body.skillSlug || '');
    const query = String(body.query || '').trim();
    const installer = String(body.installer || 'clawhub').trim().toLowerCase();
    const target = String(body.target || 'all').trim();
    const configureInput = typeof body.input === 'string' ? body.input : '';

    if (act === 'list') {
      return this.runOpenClawCli(['skills', 'list']);
    }
    if (act === 'install') {
      if (!slug) throw new Error('skill slug is required');
      if (installer === 'openclaw') return this.runCliCommand('openclaw', ['skills', 'install', slug]);
      return this.runCliCommand('npx', ['clawhub@latest', 'install', slug]);
    }
    if (act === 'uninstall') {
      if (!slug) throw new Error('skill slug is required');
      return this.runOpenClawCli(['skills', 'uninstall', slug]);
    }
    if (act === 'enable') {
      if (!slug) throw new Error('skill slug is required');
      return this.runOpenClawCli(['skills', 'enable', slug]);
    }
    if (act === 'disable') {
      if (!slug) throw new Error('skill slug is required');
      return this.runOpenClawCli(['skills', 'disable', slug]);
    }
    if (act === 'search') {
      if (!query) throw new Error('search query is required');
      return this.runOpenClawCli(['skills', 'search', query]);
    }
    if (act === 'info') {
      if (!slug) throw new Error('skill slug is required');
      return this.runOpenClawCli(['skills', 'info', slug]);
    }
    if (act === 'configure') {
      if (!slug) throw new Error('skill slug is required');
      return this.runOpenClawCli(['skills', 'configure', slug], {
        input: configureInput
      });
    }
    if (act === 'check') {
      return this.runCliCommand('npx', ['skills', 'check']);
    }
    if (act === 'update') {
      return this.runCliCommand('npx', ['skills', 'update', target || 'all']);
    }
    if (act === 'exec') {
      const argv = Array.isArray(body.argv) ? body.argv.map((x) => String(x || '').trim()).filter(Boolean) : [];
      if (!argv.length) throw new Error('argv is required for exec');
      const bin = argv[0];
      const args = argv.slice(1);
      if (!['openclaw', 'npx'].includes(bin)) throw new Error('exec only allows openclaw or npx');
      if (bin === 'openclaw') return this.runOpenClawCli(args, { input: configureInput });
      return this.runCliCommand(bin, args, {
        input: configureInput
      });
    }
    throw new Error(`unsupported runtime skill action: ${act}`);
  }

  isEnabled() {
    return Boolean(this.baseUrl);
  }

  resolveApiKey(options = {}) {
    const direct = String(options.apiKey || process.env.OPENCLAW_API_KEY || '').trim();
    if (direct) return direct;
    const apiKeyFile = String(options.apiKeyFile || process.env.OPENCLAW_API_KEY_FILE || '').trim();
    if (!apiKeyFile) return '';
    try {
      return fs.readFileSync(apiKeyFile, 'utf8').trim();
    } catch {
      return '';
    }
  }

  parseToolList(raw) {
    return Array.from(new Set(
      String(raw || '')
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    ));
  }

  parseBoolean(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) return false;
    return !['0', 'false', 'off', 'no'].includes(value);
  }

  parseHostList(raw) {
    return Array.from(new Set(
      String(raw || '')
        .split(',')
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    ));
  }

  parsePathList(raw) {
    const items = String(raw || '')
      .split(',')
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => (item.startsWith('/') ? item : `/${item}`));
    return items.length ? Array.from(new Set(items)) : ['/api/skills'];
  }

  normalizeBaseUrl(raw) {
    return String(raw ?? '').trim().replace(/\/$/, '');
  }

  securityHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (this.sandboxProfile) headers['X-OpenClaw-Sandbox-Profile'] = this.sandboxProfile;
    if (this.gatewayToken) headers['X-Gateway-Token'] = this.gatewayToken;
    return headers;
  }

  buildAuthHeaders() {
    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  validateNetworkIsolation(baseUrl = '') {
    this.policyService.validateNetworkIsolation(this.normalizeBaseUrl(baseUrl || this.baseUrl));
  }

  resolveToolScope(task = {}) {
    const incoming = Array.isArray((((task || {}).openclaw || {}).toolScope))
      ? task.openclaw.toolScope
      : [];
    return this.policyService.resolveToolScope(incoming);
  }

  enforceTaskSecurityPolicy(task, command, baseUrl = '') {
    this.policyService.enforceSecurityPolicy(task, command, {
      baseUrl: this.normalizeBaseUrl(baseUrl || this.baseUrl),
      apiKey: this.apiKey,
      gatewayToken: this.gatewayToken
    });
  }

  assertSecurityPreconditions(task = {}, baseUrl = '') {
    this.validateNetworkIsolation(baseUrl || this.baseUrl);
    if (this.requireAuth && !this.apiKey && !this.gatewayToken) {
      throw new Error('OpenClaw auth is required');
    }
    const openclaw = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const policyId = String(openclaw.policyId || '').trim();
    if (this.enforcePolicyForL4 && String(task.riskLevel || '').toUpperCase() === 'L4' && !policyId) {
      throw new Error('L4 task requires openclaw policyId');
    }
  }

  buildSecurityRuntimeEvent(taskId, command, task, employee) {
    return createRuntimeAuditEvent({
      id: `${taskId}-security-${Date.now()}`,
      type: 'runtime.security.applied',
      taskId,
      source: 'openclaw',
      traceId: (task && task.traceId) || null,
      employeeId: employee && employee.id,
      payload: {
        sandboxProfile: this.sandboxProfile,
        policyId: command.policyId || null,
        allowedTools: this.allowedTools,
        deniedTools: this.deniedTools,
        effectiveToolScope: command.toolScope || []
      }
    });
  }

  async request(path, payload, extraHeaders = {}, options = {}) {
    const targetBaseUrl = this.normalizeBaseUrl(options.baseUrl || this.baseUrl);
    const doFetch = () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      return fetch(`${targetBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Contract-Version': this.contractVersion,
          ...this.securityHeaders(extraHeaders),
          ...this.buildAuthHeaders()
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
    };
    return this.fetchWithRetry(doFetch);
  }

  async get(path, extraHeaders = {}, options = {}) {
    const targetBaseUrl = this.normalizeBaseUrl(options.baseUrl || this.baseUrl);
    const doFetch = () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      return fetch(`${targetBaseUrl}${path}`, {
        method: 'GET',
        headers: {
          'X-Contract-Version': this.contractVersion,
          ...this.securityHeaders(extraHeaders),
          ...this.buildAuthHeaders()
        },
        signal: controller.signal
      }).finally(() => clearTimeout(timer));
    };
    return this.fetchWithRetry(doFetch);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  async fetchWithRetry(fetchFn, retryConfig = {}) {
    const maxRetries = Number(retryConfig.maxRetries) || 3;
    const baseDelay = Number(retryConfig.baseDelay) || 1000;
    const retryableStatuses = new Set([429, 502, 503, 504]);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res;
      try {
        res = await fetchFn();
      } catch (err) {
        // Network errors (ECONNREFUSED, abort, etc.) — retry if attempts remain
        if (attempt === maxRetries) throw err;
        await this.sleep(Math.min(baseDelay * Math.pow(2, attempt), 30000));
        continue;
      }
      if (res.ok || !retryableStatuses.has(res.status) || attempt === maxRetries) {
        return res;
      }
      let delay = baseDelay * Math.pow(2, attempt);
      const retryAfter = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
      if (retryAfter) {
        const parsed = Number(retryAfter);
        if (Number.isFinite(parsed) && parsed > 0) {
          delay = Math.max(delay, parsed * 1000);
        }
      }
      await this.sleep(Math.min(delay, 30000));
    }
  }

  runtimeEventKey(event) {
    if (!event || typeof event !== 'object') return `unknown:${Date.now()}:${Math.random()}`;
    if (event.id) return `id:${event.id}`;
    return `shape:${event.type || 'unknown'}:${event.at || ''}:${JSON.stringify(event.payload || {})}`;
  }

  normalizeRuntimeError(raw, fallback = {}) {
    if (raw && typeof raw === 'object') {
      const severity = String(raw.severity || fallback.severity || 'P2').toUpperCase() === 'P1' ? 'P1' : 'P2';
      const message = String(raw.message || fallback.message || 'runtime request failed').slice(0, 400);
      return {
        ...raw,
        severity,
        message
      };
    }
    if (typeof raw === 'string' && raw.trim()) {
      return {
        severity: String(fallback.severity || 'P2').toUpperCase() === 'P1' ? 'P1' : 'P2',
        message: raw.trim().slice(0, 400)
      };
    }
    return {
      severity: String(fallback.severity || 'P2').toUpperCase() === 'P1' ? 'P1' : 'P2',
      message: String(fallback.message || 'runtime request failed').slice(0, 400)
    };
  }

  formatTransportErrorMessage(error, baseUrl = '') {
    const message = String((error && error.message) || '').trim();
    const causeCode = String(error && error.cause && error.cause.code || '').trim().toUpperCase();
    const fetchLike = /fetch failed/i.test(message) || causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND' || causeCode === 'ETIMEDOUT';
    if (!fetchLike) return message || 'OpenClaw runtime request failed';
    const target = this.normalizeBaseUrl(baseUrl || this.baseUrl) || 'OPENCLAW_BASE_URL';
    const detail = message || causeCode || 'fetch failed';
    return `OpenClaw gateway unreachable at ${target} (${detail}). Start stack with ./start-all.sh and retry.`;
  }

  withAuditFields(runtimeEvent, runtimeTaskId, task, employee) {
    const base = runtimeEvent && typeof runtimeEvent === 'object' ? runtimeEvent : {};
    return createRuntimeAuditEvent({
      id: base.id || `${runtimeTaskId}-${Date.now()}-${Math.random()}`,
      taskId: base.taskId || runtimeTaskId,
      type: base.type || 'runtime.event',
      source: base.source || 'openclaw',
      traceId: (task && task.traceId) || null,
      employeeId: employee && employee.id,
      payload: base.payload && typeof base.payload === 'object' ? base.payload : {}
    });
  }

  normalizeConversationHistory(task) {
    const context = task && task.dialogueContext && typeof task.dialogueContext === 'object'
      ? task.dialogueContext
      : {};
    const history = Array.isArray(context.history) ? context.history : [];
    const normalized = [];
    for (const item of history) {
      if (!item || typeof item !== 'object') continue;
      const role = String(item.role || '').trim().toLowerCase();
      if (!['user', 'assistant', 'system'].includes(role)) continue;
      const content = String(item.content || '').trim();
      if (!content) continue;
      normalized.push({
        role,
        content: content.slice(0, 1000)
      });
      if (normalized.length >= 12) break;
    }
    return normalized;
  }

  buildConversationHistoryPrompt(history = []) {
    if (!Array.isArray(history) || history.length === 0) return '';
    const lines = history.map((item, index) => {
      const role = String(item.role || '').trim().toLowerCase();
      const label = role === 'assistant' ? 'assistant' : (role === 'system' ? 'system' : 'user');
      return `- turn#${index + 1} ${label}: ${String(item.content || '').slice(0, 300)}`;
    });
    return [
      '同一会话最近消息（按时间顺序）：',
      ...lines
    ].join('\n');
  }

  resolveReplyLanguageInstruction(task = {}, history = []) {
    const preference = resolveLanguagePreference(String(task.goal || ''), history);
    return buildLanguageInstruction(preference);
  }

  resolveRuntimeRoutingContext(task = {}, employee = {}) {
    const runtimeConfig = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const runtimeProfile = (employee && employee.runtimeProfile && typeof employee.runtimeProfile === 'object')
      ? employee.runtimeProfile
      : ((employee && employee.openclawProfile && typeof employee.openclawProfile === 'object')
        ? employee.openclawProfile
        : {});
    const agentId = String(runtimeConfig.agentId || runtimeProfile.agentId || '').trim() || null;
    const workspacePath = String(runtimeConfig.workspacePath || runtimeProfile.workspacePath || '').trim() || null;
    const agentDir = String(runtimeConfig.agentDir || runtimeProfile.agentDir || '').trim() || null;
    return { agentId, workspacePath, agentDir };
  }

  resolveRuntimeBaseUrl(task = {}, employee = {}) {
    const runtimeConfig = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const runtimeProfile = (employee && employee.runtimeProfile && typeof employee.runtimeProfile === 'object')
      ? employee.runtimeProfile
      : ((employee && employee.openclawProfile && typeof employee.openclawProfile === 'object')
        ? employee.openclawProfile
        : {});
    return this.normalizeBaseUrl(runtimeConfig.runtimeBaseUrl || runtimeProfile.runtimeBaseUrl || this.baseUrl);
  }

  buildRuntimeRoutingHeaders(routing = {}) {
    const headers = {};
    if (routing.agentId) headers['X-OpenClaw-Agent-Id'] = routing.agentId;
    if (routing.workspacePath) headers['X-OpenClaw-Workspace-Path'] = routing.workspacePath;
    if (routing.agentDir) headers['X-OpenClaw-Agent-Dir'] = routing.agentDir;
    return headers;
  }

  async fetchRuntimeEvents(runtimeTaskId, knownEventKeys, onRuntimeEvent, task, employee, extraHeaders = {}, options = {}) {
    let runtimeEvents = [];
    const eventsRes = await this.get(
      `${this.runtimeStatusPathPrefix}${runtimeTaskId}${this.runtimeEventsPathSuffix}`,
      extraHeaders,
      options
    );
    if (!eventsRes.ok) return runtimeEvents;
    const data = await eventsRes.json();
    const list = Array.isArray(data) ? data : [];
    for (const rawRuntimeEvent of list) {
      const runtimeEvent = normalizeRuntimeEvent(rawRuntimeEvent, runtimeTaskId);
      validateRuntimeEvent(runtimeEvent);
      const key = this.runtimeEventKey(runtimeEvent);
      if (knownEventKeys.has(key)) continue;
      knownEventKeys.add(key);
      const withAudit = this.withAuditFields(runtimeEvent, runtimeTaskId, task, employee);
      runtimeEvents.push(withAudit);
      if (typeof onRuntimeEvent === 'function') onRuntimeEvent(withAudit, runtimeTaskId);
    }
    return runtimeEvents;
  }

  async executeViaRuntimeContract(task, employee, callbacks = {}, options = {}) {
    const onRuntimeEvent = typeof callbacks.onRuntimeEvent === 'function' ? callbacks.onRuntimeEvent : null;
    const openclaw = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const routing = this.resolveRuntimeRoutingContext(task, employee);
    const targetBaseUrl = this.normalizeBaseUrl(options.baseUrl || this.resolveRuntimeBaseUrl(task, employee));
    const conversationHistory = this.normalizeConversationHistory(task);
    const historyPrompt = this.buildConversationHistoryPrompt(conversationHistory);
    const languageInstruction = this.resolveReplyLanguageInstruction(task, conversationHistory);
    const selectedSkills = Array.isArray(task && task.skillSearch && task.skillSearch.top)
      ? task.skillSearch.top
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const structure = item.structure && typeof item.structure === 'object' ? item.structure : {};
          return {
            id: String(item.id || '').trim() || null,
            name: String(item.name || '').trim(),
            type: String(item.type || '').trim(),
            domain: String(item.domain || '').trim() || null,
            source: String(item.source || '').trim() || null,
            score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
            structure: {
              summary: String(structure.summary || '').trim(),
              prompt: String(structure.prompt || '').trim(),
              skillMarkdown: String(structure.skillMarkdown || '').trim().slice(0, 8000),
              resources: structure.resources && typeof structure.resources === 'object'
                ? structure.resources
                : undefined
            }
          };
        })
        .filter((item) => item && item.name)
      : [];
    const promptParts = [
      String(openclaw.systemPrompt || '').trim(),
      String(openclaw.extraSystemPrompt || '').trim(),
      String(languageInstruction || '').trim(),
      historyPrompt
    ].filter(Boolean);
    const command = {
      taskId: task.id,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      conversationId: task.conversationId,
      goal: task.goal,
      riskLevel: task.riskLevel,
      llmConfig: task.llmConfig || {
        model: null,
        thinkingLevel: 'medium',
        toolPolicy: 'balanced'
      },
      agentId: routing.agentId,
      runtimeBaseUrl: targetBaseUrl || null,
      workspacePath: routing.workspacePath,
      agentDir: routing.agentDir,
      sessionKey: String(openclaw.sessionKey || '').trim() || null,
      policyId: String(openclaw.policyId || '').trim() || null,
      toolScope: this.resolveToolScope(task),
      attachments: Array.isArray(task.attachments) ? task.attachments : [],
      conversationHistory,
      selectedSkills,
      extraSystemPrompt: promptParts.length ? promptParts.join('\n\n') : null,
      metadata: {
        department: employee.department,
        role: employee.role,
        security: {
          sandboxProfile: this.sandboxProfile
        }
      }
    };
    this.enforceTaskSecurityPolicy(task, command, targetBaseUrl);
    try {
      validateRuntimeSubmit(command, { strict: false });
    } catch (validationError) {
      return {
        status: 'failed',
        result: null,
        error: {
          severity: 'P2',
          message: `submit validation failed: ${validationError.message}`
        },
        corrected: false,
        runtimeTaskId: null,
        runtimeEvents: [securityEvent],
        source: 'openclaw'
      };
    }
    const routingHeaders = this.buildRuntimeRoutingHeaders(routing);
    const securityEvent = this.buildSecurityRuntimeEvent(command.taskId, command, task, employee);
    if (onRuntimeEvent) onRuntimeEvent(securityEvent, command.taskId);

    const submitRes = await this.request(this.runtimeSubmitPath, command, routingHeaders, { baseUrl: targetBaseUrl });
    if (!submitRes.ok) {
      if (submitRes.status === 409) {
        let reason = 'runtime contract version mismatch';
        try {
          const body = await submitRes.json();
          if (body && body.code === RuntimeErrorCodes.CONTRACT_VERSION_MISMATCH) {
            reason = `runtime contract version mismatch (expected ${body.expected || 'v1'})`;
          }
        } catch {}
        return {
          status: 'failed',
          result: null,
          error: {
            severity: 'P1',
            message: reason
          },
          corrected: false,
          runtimeTaskId: null,
          runtimeEvents: [securityEvent],
          source: 'openclaw'
        };
      }
      return null;
    }
    const submit = await submitRes.json();
    const runtimeTaskId = submit.runtimeTaskId || task.id;
    const knownEventKeys = new Set();
    const runtimeEvents = [securityEvent];
    let status = null;

    for (let attempt = 0; attempt < this.runtimeMaxPolls; attempt += 1) {
      const statusRes = await this.get(`${this.runtimeStatusPathPrefix}${runtimeTaskId}`, routingHeaders, { baseUrl: targetBaseUrl });
      if (!statusRes.ok) return null;
      status = normalizeRuntimeStatus(await statusRes.json(), runtimeTaskId);
      validateRuntimeStatus(status);

      const newEvents = await this.fetchRuntimeEvents(
        runtimeTaskId,
        knownEventKeys,
        onRuntimeEvent,
        task,
        employee,
        routingHeaders,
        { baseUrl: targetBaseUrl }
      );
      runtimeEvents.push(...newEvents);

      if (['succeeded', 'failed', 'aborted'].includes(status.status)) break;
      if (attempt < (this.runtimeMaxPolls - 1)) {
        await this.sleep(this.runtimePollIntervalMs);
      }
    }

    if (!status) return null;

    if (status.status === 'succeeded') {
      return {
        status: 'succeeded',
        result: status.result || null,
        error: null,
        corrected: false,
        children: [],
        skills: [],
        knowledge: [],
        researchQuery: null,
        runtimeTaskId,
        runtimeEvents,
        source: 'openclaw'
      };
    }

    if (status.status === 'failed') {
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError(status.lastError, {
          severity: 'P2',
          message: `OpenClaw runtime task ${runtimeTaskId} failed with status failed`
        }),
        corrected: true,
        runtimeTaskId,
        runtimeEvents,
        source: 'openclaw'
      };
    }

    if (status.status === 'aborted') {
      return {
        status: 'aborted',
        result: null,
        error: this.normalizeRuntimeError(status.lastError, {
          severity: 'P2',
          message: `OpenClaw runtime task ${runtimeTaskId} aborted`
        }),
        corrected: false,
        runtimeTaskId,
        runtimeEvents,
        source: 'openclaw'
      };
    }

    return {
      status: 'queued',
      result: null,
      error: null,
      corrected: false,
      runtimeTaskId,
      runtimeEvents,
      source: 'openclaw'
    };
  }

  async executeViaLegacy(task, employee) {
    const openclaw = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const conversationHistory = this.normalizeConversationHistory(task);
    const historyPrompt = this.buildConversationHistoryPrompt(conversationHistory);
    const languageInstruction = this.resolveReplyLanguageInstruction(task, conversationHistory);
    const promptParts = [
      String(openclaw.systemPrompt || '').trim(),
      String(openclaw.extraSystemPrompt || '').trim(),
      String(languageInstruction || '').trim(),
      historyPrompt
    ].filter(Boolean);
    const resolvedToolScope = this.resolveToolScope(task);
    const commandEnvelope = {
      task: {
        id: task.id,
        goal: task.goal,
        riskLevel: task.riskLevel,
        iteration: task.iteration,
        conversationId: task.conversationId,
        llmConfig: task.llmConfig || {
          model: null,
          thinkingLevel: 'medium',
          toolPolicy: 'balanced'
        },
        openclaw: {
          agentId: String(openclaw.agentId || '').trim() || null,
          sessionKey: String(openclaw.sessionKey || '').trim() || null,
          policyId: String(openclaw.policyId || '').trim() || null,
          toolScope: resolvedToolScope,
          conversationHistory,
          attachments: Array.isArray(task.attachments) ? task.attachments : [],
          extraSystemPrompt: promptParts.length ? promptParts.join('\n\n') : null
        }
      },
      parentEmployee: {
        id: employee.id,
        code: employee.employeeCode,
        role: employee.role,
        department: employee.department
      },
      governance: {
        mode: 'enterprise',
        parentOnly: true,
        childManagedByParent: true
      }
    };
    this.enforceTaskSecurityPolicy(task, {
      policyId: commandEnvelope.task.openclaw.policyId,
      toolScope: resolvedToolScope
    }, targetBaseUrl);
    const res = await this.request(this.executePath, commandEnvelope, {}, { baseUrl: targetBaseUrl });

    if (!res.ok) {
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError(null, {
          severity: 'P2',
          message: `OpenClaw execute failed: ${res.status}`
        }),
        corrected: true,
        source: 'openclaw'
      };
    }

    const data = await res.json();
    return {
      status: data.status || 'succeeded',
      result: data.result || null,
      error: data.error || null,
      corrected: Boolean(data.corrected),
      children: Array.isArray(data.children) ? data.children : [],
      skills: Array.isArray(data.skills) ? data.skills : [],
      knowledge: Array.isArray(data.knowledge) ? data.knowledge : [],
      researchQuery: data.researchQuery || null,
      runtimeTaskId: null,
      runtimeEvents: [this.buildSecurityRuntimeEvent(task.id, {
        policyId: commandEnvelope.task.openclaw.policyId,
        toolScope: resolvedToolScope
      }, task, employee)],
      source: 'openclaw'
    };
  }

  extractResponseText(payload = {}) {
    if (!payload || typeof payload !== 'object') return '';
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
    const chunks = [];
    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const block of output) {
      if (!block || typeof block !== 'object') continue;
      if (typeof block.text === 'string' && block.text.trim()) chunks.push(block.text.trim());
      if (Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim()) {
            chunks.push(item.text.trim());
          }
        }
      }
    }
    return chunks.join('\n').trim();
  }

  isProviderQuotaMessage(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return false;
    return (
      normalized.includes('free tier of the model has been exhausted')
      || normalized.includes('allocationquota.freetieronly')
      || normalized.includes('quota')
      || normalized.includes('额度')
      || normalized.includes('配额')
    );
  }

  async executeViaResponsesEndpoint(task, employee) {
    const openclaw = (task && task.runtimeConfig && typeof task.runtimeConfig === 'object')
      ? task.runtimeConfig
      : ((task && task.openclaw && typeof task.openclaw === 'object') ? task.openclaw : {});
    const conversationHistory = this.normalizeConversationHistory(task);
    const historyPrompt = this.buildConversationHistoryPrompt(conversationHistory);
    const languageInstruction = this.resolveReplyLanguageInstruction(task, conversationHistory);
    const promptParts = [
      String(openclaw.systemPrompt || '').trim(),
      String(openclaw.extraSystemPrompt || '').trim(),
      String(languageInstruction || '').trim(),
      historyPrompt,
      String(task && task.goal || '').trim()
    ].filter(Boolean);
    const model = String(
      (((task || {}).llmConfig || {}).model || this.responsesModel || process.env.OPENAI_MODEL || '')
    ).trim() || 'qwen3.5-plus';
    const payload = {
      model,
      input: promptParts.join('\n\n')
    };

    this.enforceTaskSecurityPolicy(task, {
      policyId: String(openclaw.policyId || '').trim() || null,
      toolScope: this.resolveToolScope(task)
    }, targetBaseUrl);

    const res = await this.request(this.responsesPath, payload, {}, { baseUrl: targetBaseUrl });
    if (!res.ok) {
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {}
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: res.status >= 500 ? 'P1' : 'P2',
          message: `OpenClaw responses failed: ${res.status}${bodyText ? ` ${String(bodyText).slice(0, 220)}` : ''}`
        }),
        corrected: false,
        source: 'openclaw'
      };
    }
    const data = await res.json();
    const text = this.extractResponseText(data);
    if (this.isProviderQuotaMessage(text)) {
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: 'P2',
          message: '模型服务不可用：当前账号额度/免费层已耗尽，请切换可用模型或充值后重试。'
        }),
        corrected: false,
        source: 'openclaw'
      };
    }
    if (!text) {
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: 'P2',
          message: 'OpenClaw responses returned empty content'
        }),
        corrected: false,
        source: 'openclaw'
      };
    }
    return {
      status: 'succeeded',
      result: text,
      error: null,
      corrected: false,
      children: [],
      skills: [],
      knowledge: [],
      researchQuery: null,
      runtimeTaskId: null,
      runtimeEvents: [this.buildSecurityRuntimeEvent(task.id, {
        policyId: String(openclaw.policyId || '').trim() || null,
        toolScope: this.resolveToolScope(task)
      }, task, employee)],
      source: 'openclaw'
    };
  }

  async executeTask(task, employee, callbacks = {}) {
    const targetBaseUrl = this.resolveRuntimeBaseUrl(task, employee);
    if (!targetBaseUrl) {
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: 'P2',
          message: 'OpenClaw runtime is unavailable'
        }),
        corrected: false,
        source: 'openclaw'
      };
    }

    try {
      this._checkCircuit();
    } catch (cbErr) {
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: 'P2',
          message: cbErr.message
        }),
        corrected: false,
        source: 'openclaw'
      };
    }

    try {
      this.assertSecurityPreconditions(task, targetBaseUrl);
      const runtime = await this.executeViaRuntimeContract(task, employee, callbacks, { baseUrl: targetBaseUrl });
      if (runtime) {
        if (runtime.status === 'succeeded') this._recordSuccess();
        else if (runtime.status === 'failed') this._recordFailure();
        return runtime;
      }
      this._recordFailure();
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: 'P2',
          message: 'OpenClaw runtime returned no execution outcome'
        }),
        corrected: false,
        source: 'openclaw'
      };
    } catch (error) {
      this._recordFailure();
      if (
        /OpenClaw auth is required/.test(String(error && error.message || ''))
        || /host is not allowed/.test(String(error && error.message || ''))
        || /L4 task requires openclaw policyId/.test(String(error && error.message || ''))
        || /invalid OPENCLAW_BASE_URL/.test(String(error && error.message || ''))
      ) {
        throw error;
      }
      return {
        status: 'failed',
        result: null,
        error: this.normalizeRuntimeError({
          severity: 'P2',
          message: this.formatTransportErrorMessage(error, targetBaseUrl)
        }),
        corrected: false,
        source: 'openclaw'
      };
    }
  }

  resolveRuntimeTaskId(task = {}) {
    const runtime = task && task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
    const direct = String(task.runtimeTaskId || '').trim();
    const fromRuntime = String(runtime.taskId || '').trim();
    return direct || fromRuntime || '';
  }

  async abortTask(task, employee) {
    const targetBaseUrl = this.resolveRuntimeBaseUrl(task, employee);
    if (!targetBaseUrl) {
      return {
        ok: false,
        statusCode: 503,
        code: RuntimeErrorCodes.RUNTIME_UNAVAILABLE,
        message: 'OpenClaw runtime is unavailable'
      };
    }

    const runtimeTaskId = this.resolveRuntimeTaskId(task);
    if (!runtimeTaskId) {
      return {
        ok: false,
        statusCode: 409,
        code: RuntimeErrorCodes.RUNTIME_TASK_ID_MISSING,
        message: 'task has no runtimeTaskId to abort'
      };
    }

    try {
      this.assertSecurityPreconditions(task, targetBaseUrl);
    } catch (error) {
      return {
        ok: false,
        statusCode: 400,
        code: RuntimeErrorCodes.ABORT_POLICY_DENIED,
        message: String((error && error.message) || 'runtime abort denied'),
        runtimeTaskId
      };
    }

    const routing = this.resolveRuntimeRoutingContext(task, employee);
    const routingHeaders = this.buildRuntimeRoutingHeaders(routing);
    const abortPath = `${this.runtimeStatusPathPrefix}${runtimeTaskId}${this.runtimeAbortPathSuffix}`;
    try {
      const abortRes = await this.request(abortPath, {}, routingHeaders, { baseUrl: targetBaseUrl });
      if (!abortRes.ok) {
        const message = `OpenClaw runtime abort failed (${abortRes.status})`;
        return {
          ok: false,
          statusCode: abortRes.status || 502,
          code: 'RUNTIME_ABORT_FAILED',
          message,
          runtimeTaskId
        };
      }
      const body = await abortRes.json().catch(() => ({}));
      const status = String((body && body.status) || 'aborted').trim().toLowerCase() || 'aborted';
      return {
        ok: true,
        status,
        runtimeTaskId
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: 502,
        code: 'RUNTIME_ABORT_FAILED',
        message: this.formatTransportErrorMessage(error, targetBaseUrl),
        runtimeTaskId
      };
    }
  }

  normalizeSkillCatalogItem(raw = {}) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const slug = String(
      item.slug
      || item.name
      || item.id
      || item.skillSlug
      || ''
    ).trim();
    const title = String(item.title || item.displayName || '').trim();
    const status = String(item.status || item.state || '').trim().toLowerCase();
    const typeRaw = String(item.type || item.category || item.skillType || '').trim().toLowerCase();
    const type = typeRaw === 'domain' ? 'domain' : (typeRaw === 'general' ? 'general' : '');
    const version = String(item.version || item.latestVersion || '').trim();
    const description = String(item.description || item.summary || '').trim();
    const domain = type === 'domain'
      ? String(item.domain || item.scope || '').trim().toLowerCase() || ''
      : null;
    const structure = item.structure && typeof item.structure === 'object' ? item.structure : {};
    const skillMarkdown = String(
      item.skillMarkdown
      || item.markdown
      || structure.skillMarkdown
      || structure.markdown
      || ''
    );
    const prompt = String(
      item.prompt
      || item.systemPrompt
      || structure.prompt
      || structure.systemPrompt
      || ''
    );
    const resources = (
      (item.resources && typeof item.resources === 'object')
      ? item.resources
      : ((structure.resources && typeof structure.resources === 'object') ? structure.resources : null)
    );
    return {
      slug,
      title,
      status,
      type,
      domain,
      version,
      description,
      structure: {
        ...(structure && typeof structure === 'object' ? structure : {}),
        prompt: prompt.trim(),
        skillMarkdown: skillMarkdown.replaceAll('\r\n', '\n'),
        resources: resources && typeof resources === 'object' ? resources : undefined
      },
      raw: item
    };
  }

  extractSkillCatalogItems(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body.skills)) return body.skills;
    if (Array.isArray(body.items)) return body.items;
    if (Array.isArray(body.data)) return body.data;
    if (body.data && typeof body.data === 'object') {
      if (Array.isArray(body.data.skills)) return body.data.skills;
      if (Array.isArray(body.data.items)) return body.data.items;
    }
    return [];
  }

  async listInstalledSkills(options = {}) {
    if (!this.isEnabled()) return { source: 'openclaw', items: [], enabled: false };
    const status = String(options.status || 'ready').trim().toLowerCase();
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    let lastError = null;

    for (const basePath of this.skillsListPaths) {
      const path = `${basePath}${query}`;
      try {
        const res = await this.get(path);
        if (!res.ok) {
          lastError = new Error(`openclaw skills list failed: ${res.status} (${basePath})`);
          continue;
        }
        const body = await res.json().catch(() => ({}));
        const normalized = this.extractSkillCatalogItems(body)
          .map((row) => this.normalizeSkillCatalogItem(row))
          .filter((row) => row.slug);
        return {
          source: 'openclaw',
          enabled: true,
          fetchedAt: new Date().toISOString(),
          statusFilter: status || null,
          items: normalized
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('openclaw skills list failed');
  }
}

module.exports = { OpenClawGateway };
