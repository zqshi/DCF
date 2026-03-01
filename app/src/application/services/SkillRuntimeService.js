class SkillRuntimeService {
  constructor(options = {}) {
    this.maxSkills = Math.max(1, Math.min(20, Number(options.maxSkills || 5)));
    this.defaultTimeoutMs = Math.max(1000, Number(options.defaultTimeoutMs || 30000));
  }

  classify(type) {
    return String(type || '').toLowerCase() === 'domain' ? 'domain' : 'general';
  }

  scoreSkill(skill, taskText) {
    const text = String(taskText || '').toLowerCase();
    const name = String(skill && skill.name || '').toLowerCase();
    const desc = String(skill && skill.description || '').toLowerCase();
    const domain = String(skill && skill.domain || '').toLowerCase();
    let score = 0;
    if (name && text.includes(name)) score += 50;
    if (desc && text && desc.split(/\s+/).some((token) => token && text.includes(token))) score += 10;
    if (domain && text.includes(domain)) score += 30;
    return score;
  }

  resolveSkills(task = {}, employee = {}, availableSkills = []) {
    const requested = Array.isArray((task.skillRuntime || {}).preferredSkills)
      ? task.skillRuntime.preferredSkills.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const linkedIds = Array.isArray(employee.linkedSkillIds)
      ? new Set(employee.linkedSkillIds.map((x) => String(x)))
      : new Set();
    const taskText = `${String(task.goal || '')} ${String(task.description || '')}`.trim();

    const ranked = (Array.isArray(availableSkills) ? availableSkills : [])
      .filter((skill) => skill && typeof skill === 'object')
      .map((skill) => {
        let score = this.scoreSkill(skill, taskText);
        if (requested.includes(String(skill.name || ''))) score += 100;
        if (linkedIds.has(String(skill.id || ''))) score += 80;
        if (this.classify(skill.type) === 'domain') score += 5;
        return { skill, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxSkills)
      .map((item) => ({
        id: item.skill.id,
        name: item.skill.name,
        type: this.classify(item.skill.type),
        domain: item.skill.domain || null,
        version: String(item.skill.version || '1.0.0'),
        score: item.score
      }));

    return ranked;
  }

  buildExecutionEnvelope(task = {}, employee = {}, availableSkills = []) {
    const selectedSkills = this.resolveSkills(task, employee, availableSkills);
    return {
      engine: 'skills-runtime-v1',
      taskId: String(task.id || task.taskId || ''),
      employeeId: String(employee.id || ''),
      timeoutMs: Math.max(1000, Number((task.skillRuntime || {}).timeoutMs || this.defaultTimeoutMs)),
      selectedSkills,
      metadata: {
        riskLevel: String(task.riskLevel || 'L2').toUpperCase(),
        traceId: String(task.traceId || '').trim() || null
      }
    };
  }
}

module.exports = { SkillRuntimeService };

