const { INDEPENDENT_PERSONA_DECLARATION } = require('../../shared/independentPersonaDeclaration');
const { resolveLanguagePreference, buildLanguageInstruction } = require('../../shared/languagePreference');

function formatFetchError(error) {
  if (!(error && typeof error === 'object')) return 'unknown';
  if (error.name === 'AbortError') return 'timeout';
  const cause = error.cause && typeof error.cause === 'object' ? error.cause : null;
  const code = String((cause && cause.code) || error.code || '').trim();
  if (code) return code;
  const message = String(error.message || '').trim();
  if (!message) return 'unknown';
  return message.replace(/\s+/g, '_').slice(0, 64);
}

class LlmDialogueGateway {
  constructor(options = {}) {
    this.apiKey = String(
      options.apiKey
      || process.env.OPENCLAW_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.LLM_API_KEY
      || ''
    ).trim();
    this.baseUrl = this.normalizeBaseUrl(
      options.baseUrl
      || process.env.OPENCLAW_BASE_URL
      || process.env.OPENAI_BASE_URL
      || process.env.LLM_API_BASE
      || 'https://api.openai.com'
    );
    this.model = String(options.model || process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4.1-mini').trim();
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.OPENAI_TIMEOUT_MS || 45000));
    this.timeoutRetries = Math.max(0, Number(options.timeoutRetries || process.env.OPENAI_TIMEOUT_RETRIES || 1));
    this.lastError = null;
  }

  normalizeBaseUrl(raw) {
    const base = String(raw || '').trim().replace(/\/+$/, '');
    if (!base) return 'https://api.openai.com';
    // Users often provide ".../v1"; requests below already include "/v1/*".
    return base.replace(/\/v1$/i, '');
  }

  isEnabled() {
    return Boolean(this.apiKey);
  }

  buildPrompt(input = {}) {
    const goal = String(input.goal || '').trim();
    const employee = input.employee && typeof input.employee === 'object' ? input.employee : {};
    const employeeCode = String(employee.employeeCode || 'DE-UNKNOWN').trim();
    const employeeName = String(employee.name || '数字员工').trim();
    const department = String(employee.department || 'unknown').trim();
    const role = String(employee.role || 'digital-operator').trim();
    const recentTurns = Array.isArray(input.recentTurns) ? input.recentTurns : [];
    const history = Array.isArray(input.history) ? input.history : [];
    const memory = Array.isArray(input.memory) ? input.memory : [];
    const recentBlock = recentTurns.length
      ? recentTurns
        .map((turn, idx) => `- 历史#${idx + 1} 用户目标: ${String(turn.goal || '').slice(0, 280)} | 你给出的结果: ${String(turn.result || '').slice(0, 760)}`)
        .join('\n')
      : '- 暂无历史会话沉淀';
    const memoryBlock = memory.length
      ? memory
        .map((item, idx) => `- 沉淀#${idx + 1} ${String(item.title || '').slice(0, 120)}: ${String(item.summary || '').slice(0, 480)}`)
        .join('\n')
      : '- 暂无知识沉淀';
    const historyBlock = history.length
      ? history
        .map((item, idx) => {
          const role = String(item && item.role || '').trim().toLowerCase();
          const label = role === 'assistant' ? 'assistant' : (role === 'system' ? 'system' : 'user');
          return `- 消息#${idx + 1} ${label}: ${String(item && item.content || '').slice(0, 320)}`;
        })
        .join('\n')
      : '- 暂无会话消息历史';
    const languageInstruction = buildLanguageInstruction(resolveLanguagePreference(goal, history));
    return [
      INDEPENDENT_PERSONA_DECLARATION,
      '你是企业数字员工，正在和业务同事继续同一会话。',
      '请保持稳定人格、口吻自然、目标导向，像真实同事一样沟通。',
      `身份: ${employeeName} (${employeeCode}) / ${department} / ${role}`,
      `用户目标: ${goal}`,
      '近期会话沉淀:',
      recentBlock,
      '当前会话消息历史:',
      historyBlock,
      '已沉淀知识:',
      memoryBlock,
      languageInstruction,
      '请输出自然表达，不要机械模板，不要复述用户原句，不要说“Goal delivered”。',
      '除非用户明确要求查看运行日志/执行链路，否则禁止提及自建引擎、runtime、OpenClaw、skills runtime等底层实现。',
      '真实性约束：只有拿到外部系统成功回执（如 messageId/requestId/callId）时，才能说“已发送/已拨打/已处理完成”。',
      '如果没有回执，只能如实说明“待确认/执行中/执行失败”，并给出下一步。禁止编造已完成事实。',
      '输出要求：直接给有用回复，最多6句；优先包含下一步动作、可交付结果和必要澄清。'
    ].join('\n');
  }

  async requestJson(path, payload) {
    const maxAttempts = this.timeoutRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (!response.ok) {
          let body = {};
          try { body = await response.json(); } catch {}
          const message = (
            body && body.error && (body.error.message || body.error.msg || body.error.code)
          ) || `HTTP ${response.status}`;
          this.lastError = `${path} ${message}`;
          return {};
        }
        const json = await response.json().catch(() => ({}));
        this.lastError = null;
        return json;
      } catch (error) {
        const code = formatFetchError(error);
        this.lastError = `${path} network_error:${code}`;
        if (code === 'timeout' && attempt < maxAttempts) continue;
        return {};
      } finally {
        clearTimeout(timer);
      }
    }
    return {};
  }

  extractResponsesText(body = {}) {
    if (body && typeof body.output_text === 'string') return body.output_text.trim();
    const outputs = Array.isArray(body && body.output) ? body.output : [];
    const texts = [];
    for (const item of outputs) {
      const content = Array.isArray(item && item.content) ? item.content : [];
      for (const c of content) {
        if (c && c.type === 'output_text' && typeof c.text === 'string') texts.push(c.text);
        if (c && c.type === 'text' && typeof c.text === 'string') texts.push(c.text);
      }
    }
    return texts.join('\n').trim();
  }

  extractChatText(body = {}) {
    const choices = Array.isArray(body && body.choices) ? body.choices : [];
    const first = choices[0] || {};
    const message = first.message || {};
    if (typeof message.content === 'string') return message.content.trim();
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
        .join('\n')
        .trim();
    }
    return '';
  }

  async generateReply(input = {}) {
    if (!this.isEnabled()) return '';
    const prompt = this.buildPrompt(input);
    const responsesBody = await this.requestJson('/v1/responses', {
      model: this.model,
      input: prompt,
      temperature: 0.6
    });
    const responsesText = this.extractResponsesText(responsesBody);
    if (responsesText) {
      this.lastError = null;
      return responsesText;
    }
    if (!this.lastError) this.lastError = 'empty_response';
    return '';
  }

  async reply(messages = []) {
    if (!this.isEnabled()) return { content: '' };
    const lines = Array.isArray(messages)
      ? messages
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const role = String(item.role || 'user').trim().toLowerCase();
          const content = String(item.content || '').trim();
          if (!content) return '';
          return `[${role}] ${content}`;
        })
        .filter(Boolean)
      : [];
    const prompt = lines.join('\n');
    if (!prompt) return { content: '' };
    const responsesBody = await this.requestJson('/v1/responses', {
      model: this.model,
      input: prompt,
      temperature: 0.2
    });
    const text = this.extractResponsesText(responsesBody);
    if (text) return { content: text };
    if (!this.lastError) this.lastError = 'empty_response';
    return { content: '' };
  }
}

module.exports = { LlmDialogueGateway };
