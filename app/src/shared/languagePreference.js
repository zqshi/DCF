function countMatches(text = '', pattern) {
  const matches = String(text || '').match(pattern);
  return Array.isArray(matches) ? matches.length : 0;
}

function detectTextLanguage(text = '') {
  const source = String(text || '').trim();
  if (!source) return 'neutral';
  const cjkCount = countMatches(source, /[\u3400-\u9fff]/g);
  const latinCount = countMatches(source, /[A-Za-z]/g);
  if (cjkCount >= 2 && cjkCount >= latinCount * 0.6) return 'zh';
  if (latinCount >= 4 && latinCount > cjkCount * 1.2) return 'en';
  return 'neutral';
}

function resolveLanguagePreference(goal = '', history = []) {
  const items = Array.isArray(history) ? history : [];
  const latestUser = items
    .slice()
    .reverse()
    .find((item) => String(item && item.role || '').trim().toLowerCase() === 'user' && String(item && item.content || '').trim());
  const latestLang = detectTextLanguage(latestUser ? latestUser.content : '');
  if (latestLang !== 'neutral') return latestLang;
  const goalLang = detectTextLanguage(goal);
  if (goalLang !== 'neutral') return goalLang;
  return 'zh';
}

function buildLanguageInstruction(preference = 'zh') {
  if (preference === 'en') {
    return 'Language rule: reply in English by default, and switch language only when the user explicitly asks.';
  }
  return '语言约束：默认使用简体中文回复；仅在用户明确要求时切换语言。';
}

module.exports = {
  detectTextLanguage,
  resolveLanguagePreference,
  buildLanguageInstruction
};
