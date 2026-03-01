async function syncRuntimeSkills(context, options = {}) {
  const {
    executionGateway,
    skillUC,
    store
  } = context;
  const force = Boolean(options.force === true);
  const pruneMissing = Boolean(options.pruneMissing === true);
  const intervalMs = Math.max(1000, Number(process.env.SKILL_RUNTIME_SYNC_INTERVAL_MS || 30000));
  const now = Date.now();
  const state = store.runtimeSkillSyncState && typeof store.runtimeSkillSyncState === 'object'
    ? store.runtimeSkillSyncState
    : {};
  const lastAttemptMs = Number(state.lastAttemptMs || 0);
  if (!force && (now - lastAttemptMs) < intervalMs) {
    return {
      skipped: true,
      reason: 'cooldown',
      nextAllowedAt: new Date(lastAttemptMs + intervalMs).toISOString()
    };
  }
  store.runtimeSkillSyncState = {
    ...state,
    lastAttemptMs: now
  };

  const catalog = await executionGateway.listInstalledSkills({ status: 'ready' });
  if (!catalog || catalog.enabled === false) {
    return {
      skipped: true,
      reason: 'runtime_unavailable',
      syncedAt: new Date().toISOString()
    };
  }
  const synced = skillUC.syncFromRuntimeCatalog({
    engine: 'openclaw',
    source: 'runtime:openclaw',
    onlyReady: true,
    pruneMissing,
    fetchedAt: catalog.fetchedAt || null,
    items: Array.isArray(catalog.items) ? catalog.items : []
  });
  store.runtimeSkillSyncState = {
    ...store.runtimeSkillSyncState,
    lastSuccessAt: new Date().toISOString(),
    lastError: ''
  };
  return {
    ...synced,
    fetchedAt: catalog.fetchedAt || null
  };
}

function shouldResyncAfterSkillCommand(action) {
  return ['install', 'uninstall', 'enable', 'disable', 'update'].includes(String(action || '').trim().toLowerCase());
}

async function handleSkillManagementRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    parseBody,
    parseBinaryBody,
    currentSession,
    adminUC,
    skillUC,
    executionGateway,
    store
  } = context;

  if (url.pathname === '/api/admin/skills/export' && req.method === 'GET') {
    json(res, 200, skillUC.exportAll());
    return true;
  }
  if (url.pathname === '/api/admin/skills/import' && req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const isZipPayload = contentType.includes('application/zip')
      || contentType.includes('application/octet-stream')
      || contentType.includes('application/x-zip-compressed');
    if (isZipPayload) {
      const binary = await parseBinaryBody(req);
      const mode = url.searchParams.get('mode') === 'replace' ? 'replace' : 'merge';
      const bundleName = url.searchParams.get('bundleName') || 'skill-bundle.zip';
      json(res, 200, await skillUC.importBundle({
        mode,
        archive: {
          fileName: bundleName,
          dataBase64: binary.toString('base64')
        }
      }));
      return true;
    }

    const body = await parseBody(req);
    const hasArchive = Boolean(body && body.archive && body.archive.dataBase64);
    json(res, 200, hasArchive ? await skillUC.importBundle(body) : skillUC.importBatch(body));
    return true;
  }
  if (url.pathname === '/api/admin/skills/proposals' && req.method === 'POST') {
    const session = currentSession(req);
    json(res, 201, skillUC.propose(await parseBody(req), {
      userId: session ? session.user.id : 'unknown',
      role: session ? session.user.role : ''
    }));
    return true;
  }
  if (url.pathname === '/api/admin/skills/preload-essential' && req.method === 'POST') {
    const body = await parseBody(req);
    json(res, 200, skillUC.preloadEssentialSkills({
      overwrite: !(body && body.overwrite === false)
    }));
    return true;
  }
  if (url.pathname === '/api/admin/skills/sync-runtime' && req.method === 'POST') {
    const body = await parseBody(req);
    json(res, 200, await syncRuntimeSkills({
      executionGateway,
      skillUC,
      store
    }, {
      force: true,
      pruneMissing: body && body.pruneMissing !== false
    }));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/skills/runtime/') && req.method === 'POST') {
    const action = String(url.pathname.split('/').filter(Boolean)[4] || '').trim().toLowerCase();
    const body = await parseBody(req);
    const result = await executionGateway.runtimeSkillCommand(action, body || {});
    let syncResult = null;
    if (result && result.ok && shouldResyncAfterSkillCommand(action)) {
      try {
        syncResult = await syncRuntimeSkills({
          executionGateway,
          skillUC,
          store
        }, {
          force: true,
          pruneMissing: false
        });
      } catch (error) {
        syncResult = {
          ok: false,
          error: String((error && error.message) || 'runtime sync failed')
        };
      }
    }
    json(res, result && result.ok ? 200 : 400, {
      action,
      result,
      sync: syncResult
    });
    return true;
  }
  if (url.pathname.startsWith('/api/admin/skills/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const skillId = decodeURIComponent(parts[3] || '');
    const action = parts[4] || '';
    if (action === 'link') {
      const body = await parseBody(req);
      json(res, 200, skillUC.linkToEmployee({
        skillId,
        employeeId: body.employeeId
      }));
      return true;
    }
    if (action === 'unlink') {
      const body = await parseBody(req);
      json(res, 200, skillUC.unlinkFromEmployee({
        skillId,
        employeeId: body.employeeId
      }));
      return true;
    }
    if (['approve', 'reject', 'rollback'].includes(action)) {
      const session = currentSession(req);
      const body = await parseBody(req);
      const targetStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'rollback';
      json(res, 200, skillUC.changeProposalStatus(skillId, targetStatus, {
        userId: session ? session.user.id : 'unknown',
        role: session ? session.user.role : '',
        note: body.note || body.reason || ''
      }));
      return true;
    }
  }
  if (url.pathname.startsWith('/api/admin/skills/') && req.method === 'DELETE') {
    const parts = url.pathname.split('/').filter(Boolean);
    const skillId = decodeURIComponent(parts[3] || '');
    json(res, 200, skillUC.deleteSkill(skillId));
    return true;
  }
  if (url.pathname.startsWith('/api/admin/skills/') && url.pathname.endsWith('/restore') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const skillId = decodeURIComponent(parts[3] || '');
    json(res, 200, skillUC.restoreSkill(skillId));
    return true;
  }
  if (url.pathname === '/api/admin/skills/employees' && req.method === 'GET') {
    const employees = adminUC.listEmployees()
      .map((item) => ({
        id: item.id,
        employeeCode: item.employeeCode || '',
        name: item.name || '',
        department: item.department || '',
        role: item.role || ''
      }))
      .sort((a, b) => String(a.name || a.employeeCode || a.id).localeCompare(String(b.name || b.employeeCode || b.id)));
    json(res, 200, employees);
    return true;
  }
  if (url.pathname.startsWith('/api/admin/skills/') && req.method === 'GET') {
    const skillId = decodeURIComponent(url.pathname.split('/')[4] || '');
    json(res, 200, skillUC.getById(skillId));
    return true;
  }
  if (url.pathname === '/api/admin/skills' && req.method === 'GET') {
    try {
      await syncRuntimeSkills({
        executionGateway,
        skillUC,
        store
      }, {
        force: false,
        pruneMissing: String(process.env.SKILL_RUNTIME_SYNC_PRUNE || '0').trim() === '1'
      });
    } catch (error) {
      store.runtimeSkillSyncState = {
        ...(store.runtimeSkillSyncState && typeof store.runtimeSkillSyncState === 'object'
          ? store.runtimeSkillSyncState
          : {}),
        lastError: String((error && error.message) || 'runtime sync failed').slice(0, 500),
        lastErrorAt: new Date().toISOString()
      };
    }
    const status = String(url.searchParams.get('status') || '').trim();
    const source = String(url.searchParams.get('source') || '').trim();
    const name = String(url.searchParams.get('name') || '').trim();
    const employeeId = String(url.searchParams.get('employeeId') || '').trim();
    const sourceLower = source.toLowerCase();
    const nameLower = name.toLowerCase();
    const linkedSkillIdSet = new Set(
      employeeId
        ? adminUC.listEmployees()
          .filter((employee) => String(employee.id || '') === employeeId)
          .flatMap((employee) => (Array.isArray(employee.linkedSkillIds) ? employee.linkedSkillIds : []))
          .map((id) => String(id || ''))
        : []
    );
    const skills = adminUC.listSkills()
      .filter((item) => !status || String(item.status || '') === status)
      .filter((item) => !source || String(item.source || '').toLowerCase() === sourceLower)
      .filter((item) => !name || String(item.name || '').toLowerCase().includes(nameLower))
      .filter((item) => !employeeId || linkedSkillIdSet.has(String(item.id || '')));
    json(res, 200, skills);
    return true;
  }

  return false;
}

module.exports = {
  handleSkillManagementRoutes
};
