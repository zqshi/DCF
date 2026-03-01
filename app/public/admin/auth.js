(function () {
  const DEFAULT_NAV_ITEMS = [
    { path: '/admin/index.html', label: '总览', permission: 'admin.runtime.page.platform-overview.read' },
    { path: '/admin/employees.html', label: '员工管理', permission: 'admin.employees.page.overview.read' },
    { path: '/admin/skills.html', label: '技能管理', permission: 'admin.skills.page.management.read' },
    { path: '/admin/oss.html', label: '开源检索', permission: 'admin.oss.page.search.read' },
    { path: '/admin/tools.html', label: '工具管理', permission: 'admin.tools.page.assets.read' },
    { path: '/admin/tasks.html', label: '任务台账', permission: 'admin.tasks.page.overview.read' },
    { path: '/admin/runtime.html', label: '运行诊断', permission: 'admin.runtime.page.overview.read' },
    { path: '/admin/strategy-center.html', label: '治理中心', permission: 'admin.runtime.write' },
    { path: '/admin/logs.html', label: '行为日志', permission: 'admin.logs.page.behavior.read' },
    { path: '/admin/auth-members.html', label: '账号权限', permission: 'admin.auth.page.members.read' }
  ];
  const TOOL_PERMISSION_COMPAT = {
    'admin.tools.read': [
      'admin.tools.assets.read',
      'admin.tools.approval.read',
      'admin.tools.policy.read'
    ],
    'admin.tools.write': [
      'admin.tools.assets.write',
      'admin.tools.approval.write',
      'admin.tools.policy.write'
    ],
    'admin.tools.assets.read': ['admin.tools.read'],
    'admin.tools.approval.read': ['admin.tools.read'],
    'admin.tools.policy.read': ['admin.tools.read'],
    'admin.tools.assets.write': ['admin.tools.write'],
    'admin.tools.approval.write': ['admin.tools.write'],
    'admin.tools.policy.write': ['admin.tools.write']
  };
  const ACTION_PERMISSION_COMPAT = {
    'admin.skills.action.debug-toggle': ['admin.skills.debug'],
    'admin.skills.action.unlink-employee': ['admin.skills.delete'],
    'admin.skills.action.delete': ['admin.skills.delete'],
    'admin.skills.debug': ['admin.skills.action.debug-toggle'],
    'admin.skills.delete': ['admin.skills.action.unlink-employee', 'admin.skills.action.delete'],
    'admin.tools.action.create-service': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.update-service': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.delete-service': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.check-health': ['admin.tools.assets.write', 'admin.tools.write'],
    'admin.tools.action.approve-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.tools.action.reject-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.tools.action.rollback-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.tools.action.resubmit-service': ['admin.tools.approval.write', 'admin.tools.write'],
    'admin.oss.action.approve-case': ['admin.oss.write'],
    'admin.oss.action.deploy': ['admin.oss.write'],
    'admin.oss.action.verify': ['admin.oss.write'],
    'admin.oss.action.rollback': ['admin.oss.write'],
    'admin.tools.assets.write': ['admin.tools.action.create-service', 'admin.tools.action.update-service', 'admin.tools.action.delete-service', 'admin.tools.action.check-health'],
    'admin.tools.approval.write': ['admin.tools.action.approve-service', 'admin.tools.action.reject-service', 'admin.tools.action.rollback-service', 'admin.tools.action.resubmit-service'],
    'admin.oss.write': ['admin.oss.action.approve-case', 'admin.oss.action.deploy', 'admin.oss.action.verify', 'admin.oss.action.rollback']
  };
  const PAGE_PERMISSION_COMPAT = {
    'admin.runtime.read': [
      'admin.runtime.page.platform-overview.read',
      'admin.runtime.page.overview.read',
      'admin.runtime.page.health.read',
      'admin.runtime.page.cycles.read',
      'admin.runtime.page.advanced.read',
      'admin.runtime.page.strategy-center.read',
      'admin.runtime.page.prompts.read',
      'admin.runtime.page.autoevolve.read'
    ],
    'admin.tasks.read': [
      'admin.tasks.page.overview.read',
      'admin.tasks.page.runtime.read',
      'admin.tasks.page.governance.read'
    ],
    'admin.employees.read': [
      'admin.employees.page.overview.read',
      'admin.employees.page.contracts.read',
      'admin.employees.page.growth.read'
    ],
    'admin.skills.read': ['admin.skills.page.management.read'],
    'admin.tools.assets.read': ['admin.tools.page.assets.read'],
    'admin.tools.approval.read': ['admin.tools.page.approvals.read'],
    'admin.logs.read': [
      'admin.logs.page.behavior.read',
      'admin.logs.page.agent.read',
      'admin.logs.page.admin.read'
    ],
    'admin.oss.read': ['admin.oss.page.search.read'],
    'admin.auth.read': [
      'admin.auth.page.users.read',
      'admin.auth.page.roles.read',
      'admin.auth.page.members.read'
    ],
    'admin.runtime.page.platform-overview.read': ['admin.runtime.read'],
    'admin.runtime.page.overview.read': ['admin.runtime.read'],
    'admin.runtime.page.health.read': ['admin.runtime.read'],
    'admin.runtime.page.cycles.read': ['admin.runtime.read'],
    'admin.runtime.page.advanced.read': ['admin.runtime.read'],
    'admin.runtime.page.strategy-center.read': ['admin.runtime.read'],
    'admin.runtime.page.prompts.read': ['admin.runtime.read'],
    'admin.runtime.page.autoevolve.read': ['admin.runtime.read'],
    'admin.tasks.page.overview.read': ['admin.tasks.read'],
    'admin.tasks.page.runtime.read': ['admin.tasks.read'],
    'admin.tasks.page.governance.read': ['admin.tasks.read'],
    'admin.employees.page.overview.read': ['admin.employees.read'],
    'admin.employees.page.contracts.read': ['admin.employees.read'],
    'admin.employees.page.growth.read': ['admin.employees.read'],
    'admin.skills.page.management.read': ['admin.skills.read'],
    'admin.tools.page.assets.read': ['admin.tools.assets.read', 'admin.tools.read'],
    'admin.tools.page.approvals.read': ['admin.tools.approval.read', 'admin.tools.read'],
    'admin.logs.page.behavior.read': ['admin.logs.read'],
    'admin.logs.page.agent.read': ['admin.logs.read'],
    'admin.logs.page.admin.read': ['admin.logs.read'],
    'admin.oss.page.search.read': ['admin.oss.read'],
    'admin.auth.page.users.read': ['admin.auth.read'],
    'admin.auth.page.roles.read': ['admin.auth.read'],
    'admin.auth.page.members.read': ['admin.auth.read']
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function getRequiredPermission() {
    return document.body ? document.body.getAttribute('data-required-permission') : null;
  }

  async function request(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {      const next = encodeURIComponent(window.location.pathname);
      window.location.replace(`/admin/login.html?next=${next}`);
      throw new Error('未登录或会话已过期');
    }
    if (!res.ok) throw new Error(body.error || '请求失败');
    return body;
  }

  function renderUser(session) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || !session || !session.user) return;
    const displayName = String(session.user.displayName || session.user.username || '成员');
    const username = String(session.user.username || '');
    const initial = displayName.trim().charAt(0).toUpperCase() || 'U';
    let box = document.querySelector('.admin-user-box');
    if (box) box.remove();
    box = document.createElement('div');
    box.className = 'admin-user-box';
    box.innerHTML = `
      <button type="button" class="admin-user-trigger" data-admin-user-menu-toggle="1" aria-haspopup="menu" aria-expanded="false">
        <span class="admin-user-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
        <span class="admin-user-meta">
          <span class="admin-user-name">${escapeHtml(displayName)}</span>
          <span class="admin-user-account">${escapeHtml(username)}</span>
        </span>
        <span class="admin-user-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="admin-user-menu hidden" data-admin-user-menu="1">
        <button type="button" class="admin-user-menu-item" data-admin-logout="1">退出登录</button>
      </div>
    `;
    sidebar.appendChild(box);
    placeWorkspaceLinkAboveUser(sidebar, box);
  }

  function placeWorkspaceLinkAboveUser(sidebar, userBox) {
    if (!sidebar || !userBox) return;
    const links = Array.from(sidebar.querySelectorAll('.sidebar-workspace-link, a[href="/front.html"]'));
    if (!links.length) return;
    const workspaceLink = links[0];
    links.slice(1).forEach((node) => node.remove());
    workspaceLink.classList.add('sidebar-workspace-link');
    workspaceLink.textContent = '用户工作台';
    sidebar.insertBefore(workspaceLink, userBox);
  }

  function renderSidebarBrand(session) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || !session || !session.user) return;
    const role = String(session.user.role || '');
    const roleLabelMap = {
      super_admin: '系统管理员',
      ops_owner: '运营负责人',
      ops_admin: '运营管理员',
      auditor: '审计员',
      skill_admin: '技能管理员'
    };
    const roleLabel = roleLabelMap[role] || '后台成员';
    let brand = sidebar.querySelector('.sidebar-brand');
    if (!brand) {
      brand = document.createElement('div');
      brand.className = 'sidebar-brand';
      sidebar.prepend(brand);
    }
    brand.innerHTML = `
      <div class="sidebar-brand-head">
        <div class="sidebar-logo" aria-hidden="true">
          <svg viewBox="0 0 72 72" role="img" focusable="false">
            <defs>
              <linearGradient id="dcfLogoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#3b82f6"></stop>
                <stop offset="100%" stop-color="#14b8a6"></stop>
              </linearGradient>
            </defs>
            <circle cx="36" cy="36" r="30" fill="rgba(59,130,246,0.12)" stroke="rgba(59,130,246,0.24)" stroke-width="1.5"></circle>
            <path d="M20 42 L30 30 L42 38 L52 24" fill="none" stroke="url(#dcfLogoGradient)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="20" cy="42" r="4.8" fill="#3b82f6"></circle>
            <circle cx="30" cy="30" r="4.8" fill="#2563eb"></circle>
            <circle cx="42" cy="38" r="4.8" fill="#0ea5e9"></circle>
            <circle cx="52" cy="24" r="4.8" fill="#14b8a6"></circle>
          </svg>
        </div>
        <h2 class="sidebar-title">管理后台</h2>
      </div>
      <div class="sidebar-kicker">Digital Crew Factory</div>
      <p class="sidebar-subtitle">统一运营、治理、审计与运行态观测控制台</p>
      <div class="sidebar-brand-meta">
        <span class="sidebar-role-chip">${escapeHtml(roleLabel)}</span>
        <span class="sidebar-session-chip"><span class="sidebar-session-dot" aria-hidden="true"></span>会话正常</span>
      </div>
    `;
  }

  function renderContentHeader(session, navContext) {
    const content = document.querySelector('.content');
    if (!content || !session || !session.user) return;
    const existingHeader = content.querySelector('.content-topbar');
    const existingContext = content.querySelector('.content-context');
    if (existingHeader) existingHeader.remove();
    if (existingContext) existingContext.remove();
  }

  async function doLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.replace('/admin/login.html');
    }
  }

  function bindGlobalLogout() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const userBox = target.closest('.admin-user-box');
      const toggle = target.closest('[data-admin-user-menu-toggle="1"]');
      const nextExpanded = Boolean(toggle)
        && userBox
        && toggle.getAttribute('aria-expanded') !== 'true';

      document.querySelectorAll('.admin-user-box').forEach((box) => {
        const trigger = box.querySelector('[data-admin-user-menu-toggle="1"]');
        const menu = box.querySelector('[data-admin-user-menu="1"]');
        if (!trigger || !menu) return;
        const expanded = Boolean(nextExpanded) && box === userBox;
        trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        menu.classList.toggle('hidden', !expanded);
      });

      if (toggle) {
        event.preventDefault();
        return;
      }

      if (target.closest('[data-admin-logout="1"]')) {
        event.preventDefault();
        doLogout();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.admin-user-box').forEach((box) => {
        const trigger = box.querySelector('[data-admin-user-menu-toggle="1"]');
        const menu = box.querySelector('[data-admin-user-menu="1"]');
        if (!trigger || !menu) return;
        trigger.setAttribute('aria-expanded', 'false');
        menu.classList.add('hidden');
      });
    });
  }

  function setupSessionHeartbeat() {
    setInterval(async () => {
      try {
        const data = await request('/api/auth/renew', { method: 'POST' });
        const node = document.getElementById('sessionRemaining');
        if (node) node.textContent = `${Math.max(0, Number(data.remainingSeconds || 0))} 秒`;
      } catch {}
    }, 4 * 60 * 1000);
  }

  function canAccess(user, permission) {
    const perms = user && user.permissions ? user.permissions : [];
    if (perms.includes('*') || perms.includes(permission)) return true;
    const fallback = TOOL_PERMISSION_COMPAT[String(permission || '')] || [];
    if (fallback.some((item) => perms.includes(item))) return true;
    const actionFallback = ACTION_PERMISSION_COMPAT[String(permission || '')] || [];
    if (actionFallback.some((item) => perms.includes(item))) return true;
    const pageFallback = PAGE_PERMISSION_COMPAT[String(permission || '')] || [];
    return pageFallback.some((item) => perms.includes(item));
  }

  function applyActionAclForRoot(root, user) {
    if (!root) return;
    const nodes = root.querySelectorAll
      ? Array.from(root.querySelectorAll('[data-required-permission]'))
      : [];
    nodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node === document.body) return;
      const required = String(node.getAttribute('data-required-permission') || '').trim();
      if (!required) return;
      const allowed = canAccess(user, required);
      if (!allowed) {
        node.setAttribute('aria-hidden', 'true');
        node.classList.add('acl-hidden');
        if ('disabled' in node) node.disabled = true;
        node.style.display = 'none';
      } else {
        node.removeAttribute('aria-hidden');
        node.classList.remove('acl-hidden');
        if ('disabled' in node && node.getAttribute('data-acl-force-disabled') !== '1') node.disabled = false;
        if (node.style.display === 'none') node.style.display = '';
      }
    });
  }

  function setupGlobalTablePagination() {
    try {
      if (window.location.pathname === '/admin/login.html') return;
      const PAGE_SIZE = 12;
      const states = new Map();
      let renderScheduled = false;
      let rendering = false;

    function getRows(tbody) {
      return Array.from(tbody.children)
        .filter((row) => !row.classList.contains('empty'));
    }

    function tableKey(tbody, index) {
      const id = tbody.id ? `#${tbody.id}` : `idx-${index}`;
      return `${window.location.pathname}:${id}`;
    }

    function ensurePager(tableWrap, tbody, key) {
      let pager = tableWrap.nextElementSibling;
      if (!pager || !pager.classList.contains('table-pager')) {
        pager = document.createElement('div');
        pager.className = 'table-pager';
        pager.innerHTML = `
          <div class=\"table-pager-meta\" data-role=\"meta\"></div>
          <div class=\"table-pager-controls\">
            <button type=\"button\" class=\"table-pager-btn\" data-role=\"prev\">上一页</button>
            <button type=\"button\" class=\"table-pager-btn\" data-role=\"next\">下一页</button>
          </div>
        `;
        tableWrap.insertAdjacentElement('afterend', pager);
      }
      const prevBtn = pager.querySelector('[data-role=\"prev\"]');
      const nextBtn = pager.querySelector('[data-role=\"next\"]');
      if (prevBtn && !prevBtn.dataset.bound) {
        prevBtn.dataset.bound = '1';
        prevBtn.addEventListener('click', () => {
          const state = states.get(key) || { page: 1 };
          state.page = Math.max(1, state.page - 1);
          states.set(key, state);
          renderOne(tableWrap, tbody, key);
        });
      }
      if (nextBtn && !nextBtn.dataset.bound) {
        nextBtn.dataset.bound = '1';
        nextBtn.addEventListener('click', () => {
          const state = states.get(key) || { page: 1 };
          state.page += 1;
          states.set(key, state);
          renderOne(tableWrap, tbody, key);
        });
      }
      return pager;
    }

    function renderOne(tableWrap, tbody, key) {
      const rows = getRows(tbody);
      const pager = ensurePager(tableWrap, tbody, key);
      const meta = pager.querySelector('[data-role=\"meta\"]');
      const prevBtn = pager.querySelector('[data-role=\"prev\"]');
      const nextBtn = pager.querySelector('[data-role=\"next\"]');
      if (!rows.length) {
        pager.style.display = 'none';
        return;
      }
      pager.style.display = '';
      const total = rows.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const state = states.get(key) || { page: 1 };
      state.page = Math.min(Math.max(1, state.page), totalPages);
      states.set(key, state);
      const start = (state.page - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      rows.forEach((row, idx) => {
        row.style.display = (idx >= start && idx < end) ? '' : 'none';
      });
      if (meta) meta.textContent = `第 ${state.page} / ${totalPages} 页，共 ${total} 条`;
      if (prevBtn) prevBtn.disabled = state.page <= 1;
      if (nextBtn) nextBtn.disabled = state.page >= totalPages;
    }

      function renderAll() {
        if (rendering) return;
        rendering = true;
        try {
          const tableWraps = Array.from(document.querySelectorAll('.content .table-wrap'));
          tableWraps.forEach((wrap, index) => {
            const tbody = wrap.querySelector('tbody');
            if (!tbody) return;
            const key = tableKey(tbody, index);
            renderOne(wrap, tbody, key);
          });
        } finally {
          rendering = false;
        }
      }

      function scheduleRenderAll() {
        if (renderScheduled) return;
        renderScheduled = true;
        window.requestAnimationFrame(() => {
          renderScheduled = false;
          renderAll();
        });
      }

      const content = document.querySelector('.content');
      if (!content) return;
      const observer = new MutationObserver(() => {
        scheduleRenderAll();
      });
      observer.observe(content, { childList: true, subtree: true });
      window.__refreshGlobalTablePagination = scheduleRenderAll;
      scheduleRenderAll();
    } catch {
      // do not block page initialization when pagination enhancer fails
    }
  }

  function applyNavAcl(session, acl) {
    const nav = Array.isArray(acl && acl.navItems) && acl.navItems.length ? acl.navItems : DEFAULT_NAV_ITEMS;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const workspaceLink = sidebar.querySelector('a[href="/front.html"]');
    const workspaceLabel = workspaceLink ? workspaceLink.textContent : '用户工作台';

    sidebar.querySelectorAll('a[href^="/admin/"], a[href="/front.html"], .sidebar-group, .sidebar-tools, .sidebar-nav').forEach((node) => node.remove());
    const navContainer = document.createElement('div');
    navContainer.className = 'sidebar-nav';
    sidebar.appendChild(navContainer);

    const navByPath = new Map(nav.map((item) => [String(item.path || ''), item]));
    const primaryItems = DEFAULT_NAV_ITEMS
      .map((item) => {
        const candidate = navByPath.get(item.path) || item;
        return {
          path: item.path,
          label: item.label,
          permission: candidate.permission || item.permission
        };
      })
      .filter((item) => canAccess(session.user, item.permission));

    const currentPath = window.location.pathname;
    const sectionPathMap = new Map([
      ['/admin/runtime-health.html', '/admin/runtime.html'],
      ['/admin/runtime-cycles.html', '/admin/runtime.html'],
      ['/admin/runtime-advanced.html', '/admin/runtime.html'],
      ['/admin/tasks-runtime.html', '/admin/tasks.html'],
      ['/admin/tasks-governance.html', '/admin/tasks.html'],
      ['/admin/employees-contracts.html', '/admin/employees.html'],
      ['/admin/employees-growth.html', '/admin/employees.html'],
      ['/admin/tools-approvals.html', '/admin/tools.html'],
    ]);
    const resolvedCurrent = sectionPathMap.get(currentPath) || currentPath;

    let currentItemLabel = '';
    const runtimeGroupChildren = [
      { path: '/admin/runtime.html', label: '运行总览', permission: 'admin.runtime.page.overview.read' },
      { path: '/admin/strategy-center.html', label: '治理中心', permission: 'admin.runtime.write' }
    ].filter((item) => canAccess(session.user, item.permission));
    const runtimeChildPaths = new Set(runtimeGroupChildren.map((item) => item.path));
    const taskGroupChildren = [
      { path: '/admin/tasks-runtime.html', label: '运行态', permission: 'admin.tasks.page.runtime.read' },
      { path: '/admin/tasks-governance.html', label: '治理态', permission: 'admin.tasks.page.governance.read' }
    ].filter((item) => canAccess(session.user, item.permission));
    const authGroupChildren = [
      { path: '/admin/auth-users.html', label: '用户管理', permission: 'admin.auth.page.users.read' },
      { path: '/admin/auth-roles.html', label: '角色管理', permission: 'admin.auth.page.roles.read' }
    ].filter((item) => canAccess(session.user, item.permission));
    const toolsGroupChildren = [
      { path: '/admin/tools.html', label: '工具资产', permission: 'admin.tools.assets.read' },
      { path: '/admin/tools-approvals.html', label: '准入审批', permission: 'admin.tools.approval.read' }
    ].filter((item) => canAccess(session.user, item.permission));
    const logsGroupChildren = [
      { path: '/admin/logs-agent.html', label: 'Agent 行为日志', permission: 'admin.logs.page.agent.read' },
      { path: '/admin/logs-admin.html', label: '后台操作日志', permission: 'admin.logs.page.admin.read' }
    ].filter((item) => canAccess(session.user, item.permission));

    for (const item of primaryItems) {
      if (item.path === '/admin/runtime.html' && runtimeGroupChildren.length > 0) {
        const group = document.createElement('div');
        group.className = 'sidebar-group';
        group.innerHTML = `
          <button
            type="button"
            class="sidebar-group-title"
            data-sidebar-group-toggle="runtime"
            aria-expanded="${runtimeGroupChildren.some((x) => x.path === currentPath) ? 'true' : 'false'}"
          >运行管理</button>
          <div class="sidebar-submenu" data-sidebar-group-panel="runtime"></div>
        `;
        const submenu = group.querySelector('[data-sidebar-group-panel="runtime"]');
        if (submenu) {
          runtimeGroupChildren.forEach((child) => {
            const link = document.createElement('a');
            link.href = child.path;
            link.textContent = child.label;
            if (child.path === currentPath) {
              link.classList.add('active');
              link.setAttribute('aria-current', 'page');
              currentItemLabel = `运行诊断 · ${child.label}`;
            }
            submenu.appendChild(link);
          });
          const toggle = group.querySelector('[data-sidebar-group-toggle="runtime"]');
          if (toggle && toggle.getAttribute('aria-expanded') !== 'true') submenu.hidden = true;
        }
        navContainer.appendChild(group);
        continue;
      }
      if (item.path !== '/admin/runtime.html' && runtimeChildPaths.has(item.path)) continue;
      if (item.path === '/admin/tasks.html' && taskGroupChildren.length > 0) {
        const group = document.createElement('div');
        group.className = 'sidebar-group';
        group.innerHTML = `
          <button
            type="button"
            class="sidebar-group-title"
            data-sidebar-group-toggle="tasks"
            aria-expanded="${taskGroupChildren.some((x) => x.path === currentPath) ? 'true' : 'false'}"
          >任务台账</button>
          <div class="sidebar-submenu" data-sidebar-group-panel="tasks"></div>
        `;
        const submenu = group.querySelector('[data-sidebar-group-panel="tasks"]');
        if (submenu) {
          taskGroupChildren.forEach((child) => {
            const link = document.createElement('a');
            link.href = child.path;
            link.textContent = child.label;
            if (child.path === currentPath) {
              link.classList.add('active');
              link.setAttribute('aria-current', 'page');
              currentItemLabel = `任务台账 · ${child.label}`;
            }
            submenu.appendChild(link);
          });
          const toggle = group.querySelector('[data-sidebar-group-toggle="tasks"]');
          if (toggle && toggle.getAttribute('aria-expanded') !== 'true') submenu.hidden = true;
        }
        navContainer.appendChild(group);
        continue;
      }
      if (item.path === '/admin/tools.html' && toolsGroupChildren.length > 0) {
        const group = document.createElement('div');
        group.className = 'sidebar-group';
        group.innerHTML = `
          <button
            type="button"
            class="sidebar-group-title"
            data-sidebar-group-toggle="tools"
            aria-expanded="${toolsGroupChildren.some((x) => x.path === currentPath) ? 'true' : 'false'}"
          >工具管理</button>
          <div class="sidebar-submenu" data-sidebar-group-panel="tools"></div>
        `;
        const submenu = group.querySelector('[data-sidebar-group-panel="tools"]');
        if (submenu) {
          toolsGroupChildren.forEach((child) => {
            const link = document.createElement('a');
            link.href = child.path;
            link.textContent = child.label;
            if (child.path === currentPath) {
              link.classList.add('active');
              link.setAttribute('aria-current', 'page');
              currentItemLabel = `工具管理 · ${child.label}`;
            }
            submenu.appendChild(link);
          });
          const toggle = group.querySelector('[data-sidebar-group-toggle="tools"]');
          if (toggle && toggle.getAttribute('aria-expanded') !== 'true') submenu.hidden = true;
        }
        navContainer.appendChild(group);
        continue;
      }
      if (item.path === '/admin/auth-members.html' && authGroupChildren.length > 0) {
        const group = document.createElement('div');
        group.className = 'sidebar-group';
        group.innerHTML = `
          <button
            type="button"
            class="sidebar-group-title"
            data-sidebar-group-toggle="auth"
            aria-expanded="${authGroupChildren.some((x) => x.path === currentPath) ? 'true' : 'false'}"
          >账号权限</button>
          <div class="sidebar-submenu" data-sidebar-group-panel="auth"></div>
        `;
        const submenu = group.querySelector('[data-sidebar-group-panel="auth"]');
        if (submenu) {
          authGroupChildren.forEach((child) => {
            const link = document.createElement('a');
            link.href = child.path;
            link.textContent = child.label;
            if (child.path === currentPath) {
              link.classList.add('active');
              link.setAttribute('aria-current', 'page');
              currentItemLabel = `账号权限 · ${child.label}`;
            }
            submenu.appendChild(link);
          });
          const toggle = group.querySelector('[data-sidebar-group-toggle="auth"]');
          if (toggle && toggle.getAttribute('aria-expanded') !== 'true') submenu.hidden = true;
        }
        navContainer.appendChild(group);
        continue;
      }
      if (item.path === '/admin/logs.html' && logsGroupChildren.length > 0) {
        const group = document.createElement('div');
        group.className = 'sidebar-group';
        group.innerHTML = `
          <button
            type="button"
            class="sidebar-group-title"
            data-sidebar-group-toggle="logs"
            aria-expanded="${logsGroupChildren.some((x) => x.path === currentPath) ? 'true' : 'false'}"
          >行为日志</button>
          <div class="sidebar-submenu" data-sidebar-group-panel="logs"></div>
        `;
        const submenu = group.querySelector('[data-sidebar-group-panel="logs"]');
        if (submenu) {
          logsGroupChildren.forEach((child) => {
            const link = document.createElement('a');
            link.href = child.path;
            link.textContent = child.label;
            if (child.path === currentPath) {
              link.classList.add('active');
              link.setAttribute('aria-current', 'page');
              currentItemLabel = `行为日志 · ${child.label}`;
            }
            submenu.appendChild(link);
          });
          const toggle = group.querySelector('[data-sidebar-group-toggle="logs"]');
          if (toggle && toggle.getAttribute('aria-expanded') !== 'true') submenu.hidden = true;
        }
        navContainer.appendChild(group);
        continue;
      }
      const link = document.createElement('a');
      link.href = item.path;
      link.textContent = item.label;
      if (item.path === resolvedCurrent) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
        currentItemLabel = item.label;
      }
      navContainer.appendChild(link);
    }

    const foot = document.createElement('a');
    foot.href = '/front.html';
    foot.textContent = workspaceLabel || '用户工作台';
    foot.className = 'sidebar-workspace-link';
    navContainer.appendChild(foot);
    return {
      currentGroupName: '后台',
      currentGroupItems: [],
      currentItemLabel: currentItemLabel || (document.querySelector('.page-title') ? document.querySelector('.page-title').textContent : '')
    };
  }

  window.adminApi = async function adminApi(path, options) {
    return request(path, options);
  };
  window.adminCanAccess = function adminCanAccess(permission) {
    const session = window.__adminSession;
    return Boolean(session && session.user) && canAccess(session.user, permission);
  };
  window.adminApplyActionAclForRoot = function adminApplyActionAclForRoot(root = document) {
    const session = window.__adminSession;
    if (!session || !session.user) return;
    applyActionAclForRoot(root, session.user);
  };
  window.adminLogout = doLogout;

  window.__adminReady = (async () => {
    if (window.location.pathname === '/admin/login.html') return;
    const session = await request('/api/auth/me');
    if (!session.authenticated) {
      const next = encodeURIComponent(window.location.pathname);
      window.location.replace(`/admin/login.html?next=${next}`);
      throw new Error('未登录');
    }
    const required = getRequiredPermission();
    const allowed = !required || canAccess(session.user, required);
    if (!allowed) {
      document.body.innerHTML = '<div style="padding:24px;font-family:IBM Plex Sans,PingFang SC,sans-serif;"><h2>无权限访问</h2><p>当前账号没有该页面权限，请联系管理员分配角色。</p><a href="/admin/index.html">返回后台首页</a></div>';
      throw new Error('无权限访问');
    }
    window.__adminSession = session;
    applyActionAclForRoot(document, session.user);
    const content = document.querySelector('.content');
    if (content) {
      const actionAclObserver = new MutationObserver(() => applyActionAclForRoot(content, session.user));
      actionAclObserver.observe(content, { childList: true, subtree: true });
    }
    try {
      const acl = await request('/api/auth/acl');
      const navContext = applyNavAcl(session, acl);
      renderSidebarBrand(session);
      renderContentHeader(session, navContext);
    } catch {
      const navContext = applyNavAcl(session, { navItems: DEFAULT_NAV_ITEMS });
      renderSidebarBrand(session);
      renderContentHeader(session, navContext);
    }
    renderUser(session);
    setupSessionHeartbeat();
    requestAnimationFrame(() => document.body.classList.add('admin-entered'));
    return session;
  })();
  bindGlobalLogout();
  setupGlobalTablePagination();

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest('[data-sidebar-group-toggle]');
    if (!toggle) return;
    const key = String(toggle.getAttribute('data-sidebar-group-toggle') || '').trim();
    if (!key) return;
    const panel = document.querySelector(`[data-sidebar-group-panel="${key}"]`);
    if (!panel) return;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    panel.hidden = expanded;
  });

  // ── Responsive sidebar toggle (mobile) ──
  (function initMobileSidebar() {
    const shell = document.querySelector('.admin-shell');
    const sidebar = document.querySelector('.sidebar');
    if (!shell || !sidebar) return;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    shell.insertBefore(overlay, shell.firstChild);

    // Create toggle button
    const btn = document.createElement('button');
    btn.className = 'sidebar-toggle';
    btn.setAttribute('aria-label', '菜单');
    btn.textContent = '☰';
    const content = shell.querySelector('.content');
    if (content) content.prepend(btn);

    function closeSidebar() {
      sidebar.classList.remove('sidebar-open');
      overlay.classList.remove('active');
    }

    btn.addEventListener('click', function () {
      const isOpen = sidebar.classList.toggle('sidebar-open');
      overlay.classList.toggle('active', isOpen);
    });

    overlay.addEventListener('click', closeSidebar);

    // Close sidebar when clicking a nav link (mobile)
    sidebar.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' && window.innerWidth <= 900) {
        closeSidebar();
      }
    });
  })();
})();
