const path = require('path');
const unzipper = require('unzipper');

function toStringSafe(value) {
  return String(value || '').trim();
}

function normalizeZipPath(raw) {
  const normalized = path.posix.normalize(String(raw || '').replaceAll('\\', '/'));
  if (!normalized || normalized === '.') return '';
  if (normalized.startsWith('../') || normalized.includes('/../')) return '';
  return normalized.replace(/^\/+/, '');
}

function readMarkdownFrontmatter(raw) {
  const text = String(raw || '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  const lines = String(match[1] || '').split(/\r?\n/);
  const out = {};
  let activeListKey = '';
  for (const line of lines) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const key = toStringSafe(keyMatch[1]);
      const value = toStringSafe(keyMatch[2]);
      activeListKey = '';
      if (!key) continue;
      if (value === '') {
        out[key] = [];
        activeListKey = key;
      } else if (value.startsWith('[') && value.endsWith(']')) {
        out[key] = value.slice(1, -1).split(',').map((x) => toStringSafe(x)).filter(Boolean);
      } else {
        out[key] = value;
      }
      continue;
    }
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && activeListKey) {
      if (!Array.isArray(out[activeListKey])) out[activeListKey] = [];
      out[activeListKey].push(toStringSafe(listMatch[1]));
    }
  }
  return out;
}

function extractFirstParagraph(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    const trimmed = toStringSafe(line);
    if (!trimmed) {
      if (parts.length) break;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('---')) continue;
    if (trimmed.startsWith('- ')) continue;
    parts.push(trimmed);
  }
  return parts.join(' ').trim();
}

function extractSectionContent(markdown, sectionNames = []) {
  const lines = String(markdown || '').split(/\r?\n/);
  const targetNames = new Set(sectionNames.map((x) => toStringSafe(x).toLowerCase()).filter(Boolean));
  if (!targetNames.size) return '';
  let collecting = false;
  const bucket = [];
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s*(.+?)\s*$/);
    if (headingMatch) {
      const headingName = toStringSafe(headingMatch[1]).toLowerCase();
      if (collecting) break;
      if (targetNames.has(headingName)) collecting = true;
      continue;
    }
    if (collecting) bucket.push(line);
  }
  return bucket.join('\n').trim();
}

function normalizeTypeAndDomain(frontmatter = {}) {
  const rawType = toStringSafe(frontmatter.type).toLowerCase();
  const rawDomain = toStringSafe(frontmatter.domain);
  if (rawType === 'domain') return { type: 'domain', domain: rawDomain || 'general' };
  if (rawDomain) return { type: 'domain', domain: rawDomain };
  return { type: 'general', domain: null };
}

function isTextResource(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return [
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.sh', '.bash', '.zsh', '.js', '.ts', '.py', '.rb', '.go', '.java', '.kt',
    '.sql', '.xml', '.csv', '.env', '.dockerfile'
  ].some((ext) => lower.endsWith(ext)) || lower.endsWith('dockerfile');
}

function guessContentType(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'text/yaml';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'text/shell';
  return 'text/plain';
}

function scanResourceDir(entries, fileMap, skillRoot, subDir, type) {
  const prefix = path.posix.join(skillRoot || '.', subDir).replace(/^\.\//, '');
  const comparePrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const maxPreviewBytes = 200 * 1024;
  return entries
    .filter((entryPath) => entryPath.startsWith(comparePrefix))
    .map((entryPath) => {
      const body = fileMap.get(entryPath);
      const item = {
        type,
        path: path.posix.relative(skillRoot || '.', entryPath),
        size: body ? body.length : 0
      };
      if (!body || !isTextResource(entryPath)) {
        item.contentType = 'binary';
        return item;
      }
      const clipped = body.length > maxPreviewBytes ? body.subarray(0, maxPreviewBytes) : body;
      item.contentType = guessContentType(entryPath);
      item.content = String(clipped.toString('utf8'));
      if (body.length > maxPreviewBytes) item.content += '\n\n... [内容过长，已截断展示]';
      return item;
    });
}

function buildSkillFromMarkdown(skillFilePath, markdownRaw, allEntryPaths, fileMap) {
  const frontmatter = readMarkdownFrontmatter(markdownRaw);
  const skillRoot = path.posix.dirname(skillFilePath);
  const fallbackName = path.posix.basename(skillRoot || '') || path.posix.basename(skillFilePath, path.posix.extname(skillFilePath));
  const name = toStringSafe(frontmatter.name || frontmatter.title) || fallbackName;
  const { type, domain } = normalizeTypeAndDomain(frontmatter);
  const description = toStringSafe(frontmatter.description) || extractFirstParagraph(markdownRaw) || `${name} skill`;
  const promptSection = extractSectionContent(markdownRaw, ['Prompt', 'System Prompt', '提示词']);
  const prompt = toStringSafe(frontmatter.prompt) || promptSection;
  const triggers = Array.isArray(frontmatter.trigger)
    ? frontmatter.trigger
    : toStringSafe(frontmatter.trigger)
      ? toStringSafe(frontmatter.trigger).split(',').map((x) => toStringSafe(x)).filter(Boolean)
      : [name];

  const scriptResources = scanResourceDir(allEntryPaths, fileMap, skillRoot, 'scripts', 'script');
  const templateResources = scanResourceDir(allEntryPaths, fileMap, skillRoot, 'templates', 'template');
  const referenceResources = scanResourceDir(allEntryPaths, fileMap, skillRoot, 'references', 'reference');
  const assetResources = scanResourceDir(allEntryPaths, fileMap, skillRoot, 'assets', 'asset');
  const exampleResources = scanResourceDir(allEntryPaths, fileMap, skillRoot, 'examples', 'example');

  return {
    name,
    description,
    type,
    domain,
    source: 'archive',
    structure: {
      summary: description,
      trigger: triggers.length ? triggers : [name],
      steps: [
        '读取技能目标与上下文',
        '执行技能流程并记录产出',
        '按规范输出结果并沉淀复用信息'
      ],
      inputs: ['任务目标', '上下文信息'],
      outputs: ['执行结果', '复盘结论'],
      prompt,
      skillMarkdown: markdownRaw,
      resources: {
        scripts: scriptResources,
        templates: templateResources,
        references: referenceResources,
        assets: assetResources,
        examples: exampleResources,
        tools: [],
        others: []
      }
    }
  };
}

function joinZipPath(baseDir, childPath) {
  const base = String(baseDir || '').trim();
  const child = String(childPath || '').trim();
  if (!base) return normalizeZipPath(child);
  return normalizeZipPath(path.posix.join(base, child));
}

function findTextFileContent(fileMap, rootCandidates, resourcePath) {
  const normalizedResourcePath = normalizeZipPath(resourcePath);
  if (!normalizedResourcePath) return null;
  const candidates = [];
  if (normalizedResourcePath.includes('/')) candidates.push(normalizedResourcePath);
  for (const root of rootCandidates) {
    const joined = joinZipPath(root, normalizedResourcePath);
    if (joined) candidates.push(joined);
  }
  const unique = Array.from(new Set(candidates));
  for (const candidate of unique) {
    const body = fileMap.get(candidate);
    if (!body) continue;
    if (!isTextResource(candidate)) return { contentType: 'binary', content: '', size: body.length };
    const maxPreviewBytes = 200 * 1024;
    const clipped = body.length > maxPreviewBytes ? body.subarray(0, maxPreviewBytes) : body;
    let content = String(clipped.toString('utf8'));
    if (body.length > maxPreviewBytes) content += '\n\n... [内容过长，已截断展示]';
    return { contentType: guessContentType(candidate), content, size: body.length };
  }
  return null;
}

function enrichResourceGroups(rawResources, fileMap, rootCandidates) {
  const base = rawResources && typeof rawResources === 'object' ? rawResources : {};
  const groups = ['scripts', 'templates', 'references', 'assets', 'examples', 'tools', 'others'];
  const result = {};
  for (const groupKey of groups) {
    const list = Array.isArray(base[groupKey]) ? base[groupKey] : [];
    result[groupKey] = list.map((entry) => {
      if (typeof entry === 'string') {
        const fileData = findTextFileContent(fileMap, rootCandidates, entry);
        return {
          type: groupKey.slice(0, -1),
          path: entry,
          contentType: fileData ? fileData.contentType : '',
          content: fileData ? fileData.content : '',
          size: fileData ? fileData.size : 0
        };
      }
      if (!entry || typeof entry !== 'object') return entry;
      const pathValue = String(entry.path || '').trim();
      const fileData = pathValue ? findTextFileContent(fileMap, rootCandidates, pathValue) : null;
      return {
        ...entry,
        contentType: entry.contentType || (fileData ? fileData.contentType : ''),
        content: typeof entry.content === 'string' && entry.content.trim()
          ? entry.content
          : (fileData ? fileData.content : ''),
        size: Number.isFinite(Number(entry.size)) && Number(entry.size) > 0
          ? Number(entry.size)
          : (fileData ? fileData.size : 0)
      };
    });
  }
  return result;
}

function mergeSkillWithMarkdown(rawSkill, markdownSkill, fileMap, roots = []) {
  const sourceSkill = rawSkill && typeof rawSkill === 'object' ? rawSkill : {};
  const markdownStructure = markdownSkill && markdownSkill.structure ? markdownSkill.structure : {};
  const rawStructure = sourceSkill.structure && typeof sourceSkill.structure === 'object' ? sourceSkill.structure : {};
  const mergedResources = (() => {
    const rawResources = rawStructure.resources && typeof rawStructure.resources === 'object'
      ? rawStructure.resources
      : null;
    const mdResources = markdownStructure.resources && typeof markdownStructure.resources === 'object'
      ? markdownStructure.resources
      : {};
    const base = rawResources || mdResources;
    return enrichResourceGroups(base, fileMap, roots);
  })();
  return {
    ...markdownSkill,
    ...sourceSkill,
    structure: {
      ...markdownStructure,
      ...rawStructure,
      prompt: rawStructure.prompt || sourceSkill.prompt || markdownStructure.prompt || '',
      skillMarkdown: rawStructure.skillMarkdown || markdownStructure.skillMarkdown || '',
      resources: mergedResources
    }
  };
}

async function openZipEntries(buffer) {
  const directory = await unzipper.Open.buffer(buffer);
  const files = [];
  for (const entry of directory.files || []) {
    const normalizedPath = normalizeZipPath(entry && entry.path ? entry.path : '');
    if (!normalizedPath) continue;
    const isDirectory = entry.type === 'Directory' || normalizedPath.endsWith('/');
    if (isDirectory) continue;
    const body = await entry.buffer();
    files.push({ path: normalizedPath, body });
  }
  return files;
}

class SkillBundleArchiveGateway {
  async readArchive(input = {}) {
    const fileName = toStringSafe(input.fileName) || 'skill-bundle.zip';
    const dataBase64Raw = toStringSafe(input.dataBase64).replace(/^data:.*;base64,/, '');
    if (!dataBase64Raw) throw new Error('archive.dataBase64 is required');

    let buffer;
    try {
      buffer = Buffer.from(dataBase64Raw, 'base64');
    } catch {
      throw new Error('archive.dataBase64 is invalid base64');
    }
    if (!buffer || !buffer.length) throw new Error('archive payload is empty');

    const files = await openZipEntries(buffer);
    const fileMap = new Map(files.map((file) => [file.path, file.body]));
    const entryPaths = files.map((file) => file.path);
    const markdownByPath = new Map();
    const markdownByDir = new Map();
    const markdownPaths = entryPaths.filter((filePath) => /(^|\/)SKILL\.md$/i.test(filePath));
    for (const mdPath of markdownPaths) {
      const markdown = String(fileMap.get(mdPath) || '');
      if (!markdown.trim()) continue;
      const built = buildSkillFromMarkdown(mdPath, markdown, entryPaths, fileMap);
      markdownByPath.set(mdPath, built);
      markdownByDir.set(path.posix.dirname(mdPath), built);
    }

    const jsonCandidates = entryPaths.filter((filePath) => /(^|\/)skill\.json$/i.test(filePath));
    const skillItems = [];
    for (const jsonPath of jsonCandidates) {
      const parsed = JSON.parse(String(fileMap.get(jsonPath) || ''));
      const jsonDir = path.posix.dirname(jsonPath);
      const siblingMarkdownPath = normalizeZipPath(path.posix.join(jsonDir, 'SKILL.md'));
      const directMarkdown = markdownByPath.get(siblingMarkdownPath) || markdownByDir.get(jsonDir) || null;
      const fallbackMarkdown = directMarkdown
        || Array.from(markdownByDir.entries())
          .find(([dir]) => String(dir || '').startsWith(String(jsonDir || '') + '/'))?.[1]
        || null;
      const fallbackMarkdownPath = fallbackMarkdown
        ? Array.from(markdownByPath.entries()).find((entry) => entry[1] === fallbackMarkdown)?.[0] || ''
        : '';
      const roots = [jsonDir, fallbackMarkdownPath ? path.posix.dirname(fallbackMarkdownPath) : ''].filter(Boolean);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (fallbackMarkdown) skillItems.push(mergeSkillWithMarkdown(item, fallbackMarkdown, fileMap, roots));
          else skillItems.push(mergeSkillWithMarkdown(item, {}, fileMap, roots));
        }
      } else if (parsed && typeof parsed === 'object') {
        if (fallbackMarkdown) skillItems.push(mergeSkillWithMarkdown(parsed, fallbackMarkdown, fileMap, roots));
        else skillItems.push(mergeSkillWithMarkdown(parsed, {}, fileMap, roots));
      }
    }

    if (!skillItems.length) {
      for (const mdPath of markdownPaths) {
        const built = markdownByPath.get(mdPath);
        if (built) skillItems.push(built);
      }
    }

    if (!skillItems.length) {
      throw new Error('archive does not contain skill.json or SKILL.md');
    }

    const skills = skillItems
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        ...item,
        source: item.source || 'archive'
      }));

    return {
      fileName,
      skills
    };
  }
}

module.exports = {
  SkillBundleArchiveGateway
};
