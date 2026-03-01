class GitHubSearchGateway {
  async searchRepositories(query) {
    const q = encodeURIComponent(query);
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=8`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'dcf-bootstrap-demo',
        Accept: 'application/vnd.github+json'
      }
    });
    if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`);
    const data = await res.json();
    return data.items || [];
  }
}

module.exports = { GitHubSearchGateway };
