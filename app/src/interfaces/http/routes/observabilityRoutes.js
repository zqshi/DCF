const { buildCorsHeaders } = require('../../../shared/http');

const MAX_SSE_CONNECTIONS = Number(process.env.MAX_SSE_CONNECTIONS) || 50;
let activeSseConnections = 0;

function buildDefaultRetrievalMetrics() {
  return {
    busyDecisions: 0,
    idleDecisions: 0,
    internalTools: 0,
    platformContext: 0,
    externalSearch: 0,
    skippedExternal: 0,
    queuedExternal: 0
  };
}

function listEventsSince(store, since, limit) {
  if (since > 0) {
    return store.events
      .filter((ev) => Number(ev.seq || 0) > since)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
      .slice(0, limit);
  }
  return store.events.slice(0, limit);
}

function handleObservabilityRoutes(context) {
  const {
    req,
    res,
    url,
    json,
    store
  } = context;

  if (url.pathname === '/api/events' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));
    json(res, 200, listEventsSince(store, since, limit));
    return true;
  }

  if (url.pathname === '/api/events/stream' && req.method === 'GET') {
    if (activeSseConnections >= MAX_SSE_CONNECTIONS) {
      json(res, 503, { error: 'Too many SSE connections' });
      return true;
    }
    activeSseConnections++;
    const since = Number(url.searchParams.get('since') || 0);
    let lastSeq = since > 0 ? since : 0;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...buildCorsHeaders()
    });

    const writeEvent = (event) => {
      const seq = Number(event.seq || 0);
      if (seq <= lastSeq) return;
      lastSeq = seq;
      res.write(`id: ${seq}\n`);
      res.write('event: task_event\n');
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    listEventsSince(store, lastSeq, Number.MAX_SAFE_INTEGER).forEach(writeEvent);

    const timer = setInterval(() => {
      listEventsSince(store, lastSeq, Number.MAX_SAFE_INTEGER).forEach(writeEvent);
      res.write(': keepalive\n\n');
    }, 1000);

    const cleanup = () => {
      clearInterval(timer);
      activeSseConnections--;
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    return true;
  }

  if (url.pathname === '/api/metrics/prometheus' && req.method === 'GET') {
    const m = store.metrics || {};
    const cbState = (context.executionGateway && typeof context.executionGateway.circuitState === 'function')
      ? context.executionGateway.circuitState() : 'closed';
    const cbGauge = cbState === 'open' ? 1 : (cbState === 'half-open' ? 2 : 0);
    const activeEmployees = store.employees ? store.employees.filter((e) => e && e.status === 'active').length : 0;
    const eventBufferSize = store.events ? store.events.length : 0;

    const lines = [
      '# HELP dcf_tasks_total Total tasks created',
      '# TYPE dcf_tasks_total counter',
      `dcf_tasks_total ${Number(m.totalTasks || 0)}`,
      '# HELP dcf_tasks_succeeded_total Total tasks succeeded',
      '# TYPE dcf_tasks_succeeded_total counter',
      `dcf_tasks_succeeded_total ${Number(m.succeededTasks || 0)}`,
      '# HELP dcf_tasks_failed_total Total tasks failed',
      '# TYPE dcf_tasks_failed_total counter',
      `dcf_tasks_failed_total ${Number(m.failedTasks || 0)}`,
      '# HELP dcf_p1_incidents_total Total P1 incidents',
      '# TYPE dcf_p1_incidents_total counter',
      `dcf_p1_incidents_total ${Number(m.p1Incidents || 0)}`,
      '# HELP dcf_employees_active Currently active employees',
      '# TYPE dcf_employees_active gauge',
      `dcf_employees_active ${activeEmployees}`,
      '# HELP dcf_event_buffer_size Current event buffer size',
      '# TYPE dcf_event_buffer_size gauge',
      `dcf_event_buffer_size ${eventBufferSize}`,
      '# HELP dcf_circuit_state Circuit breaker state (0=closed, 1=open, 2=half-open)',
      '# TYPE dcf_circuit_state gauge',
      `dcf_circuit_state ${cbGauge}`,
      ''
    ];
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
    });
    res.end(lines.join('\n'));
    return true;
  }

  if (url.pathname === '/api/metrics' && req.method === 'GET') {
    const m = store.metrics;
    const successRate = m.totalTasks ? Math.round((m.succeededTasks / m.totalTasks) * 100) : 0;
    const retrieval = (m && m.retrieval && typeof m.retrieval === 'object')
      ? m.retrieval
      : buildDefaultRetrievalMetrics();
    const truncationAnchor = store._lastTruncationAnchor || null;
    json(res, 200, { ...m, retrieval, successRate, truncationAnchor });
    return true;
  }

  return false;
}

module.exports = {
  buildDefaultRetrievalMetrics,
  handleObservabilityRoutes,
  listEventsSince
};
