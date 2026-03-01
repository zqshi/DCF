function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, '')
    .replace(/[，。！？、,.!?;:：'"“”‘’()（）【】\[\]<>《》]/g, '');
}

function normalizeSearchKeywords(input = '') {
  return String(input || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5_-]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function calculateSkillSearchScore(skill, keywords = []) {
  if (!keywords.length) return 0;
  const structure = skill && skill.structure && typeof skill.structure === 'object' ? skill.structure : {};
  const fields = [
    String((skill && skill.name) || ''),
    String((skill && skill.description) || ''),
    String((skill && skill.type) || ''),
    String((skill && skill.domain) || ''),
    String((skill && skill.source) || '')
  ];
  const structuredText = []
    .concat(Array.isArray(structure.trigger) ? structure.trigger : [])
    .concat(Array.isArray(structure.steps) ? structure.steps : [])
    .concat(Array.isArray(structure.inputs) ? structure.inputs : [])
    .concat(Array.isArray(structure.outputs) ? structure.outputs : []);
  const bag = fields.concat(structuredText).join(' ').toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (String((skill && skill.name) || '').toLowerCase().includes(keyword)) score += 40;
    if (String((skill && skill.description) || '').toLowerCase().includes(keyword)) score += 20;
    if (bag.includes(keyword)) score += 10;
  }
  return score;
}

function isEchoResult(result, goal) {
  const r = normalizeText(result);
  const g = normalizeText(goal);
  if (!r || !g) return false;
  if (r === g) return true;
  if (r.includes(g) && Math.abs(r.length - g.length) <= 6) return true;
  return false;
}

function isSyntheticRuntimeResult(result, source = 'unknown') {
  const text = String(result || '').trim();
  if (!text) return true;
  const s = String(source || '').trim().toLowerCase();
  const patterns = [
    /^delivered by deterministic fallback/i,
    /^delivered by openclaw runtime plugin/i,
    /^openclaw runtime delivered task/i,
    /^delivered by openclaw runtime bridge/i,
    /^收到[，,\s]*这个任务我已经执行完成[:：]/,
    /^已通过自[建主]执行引擎完成任务[:：]/,
    /^输出包含执行步骤[、,，]结果摘要与后续建议/
  ];
  if (patterns.some((re) => re.test(text))) return true;
  return s === 'local';
}

module.exports = {
  normalizeText,
  normalizeSearchKeywords,
  calculateSkillSearchScore,
  isEchoResult,
  isSyntheticRuntimeResult
};
