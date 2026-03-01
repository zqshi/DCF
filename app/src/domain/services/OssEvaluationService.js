function scoreRepo(repo, goal) {
  const stars = repo.stargazers_count || 0;
  const updatedDays = Math.max(1, Math.round((Date.now() - Date.parse(repo.updated_at || new Date().toISOString())) / 86400000));
  const freshness = Math.max(0, 100 - Math.min(100, updatedDays / 3));
  const popularity = Math.min(100, Math.round(Math.log10(stars + 1) * 30));
  const keyword = goal && repo.description && repo.description.toLowerCase().includes(goal.toLowerCase()) ? 20 : 0;
  const total = Math.min(100, popularity + freshness + keyword);
  return { total, popularity, freshness, keyword };
}

function evaluateRepos(repos, goal) {
  return repos
    .map((r) => ({
      name: r.full_name,
      url: r.html_url,
      description: r.description || '',
      stars: r.stargazers_count || 0,
      updatedAt: r.updated_at,
      updateAgeDays: Math.max(1, Math.round((Date.now() - Date.parse(r.updated_at || new Date().toISOString())) / 86400000)),
      license: r.license ? r.license.spdx_id : 'UNKNOWN',
      criticalVulnerabilities: Number.isFinite(Number(r.critical_vulnerabilities))
        ? Number(r.critical_vulnerabilities)
        : 0,
      score: scoreRepo(r, goal)
    }))
    .sort((a, b) => b.score.total - a.score.total);
}

module.exports = { evaluateRepos };
