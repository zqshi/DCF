/**
 * DCF 事件目录 — 所有事件类型的唯一真相来源。
 * 新增事件必须先在此文件注册。
 */

const EVENT_TYPES = Object.freeze({
  // 任务生命周期
  'task.created': { domain: 'task', severity: 'info' },
  'task.risk.classified': { domain: 'task', severity: 'info' },
  'task.validating': { domain: 'task', severity: 'info' },
  'task.approval.required': { domain: 'task', severity: 'warn' },
  'task.approved': { domain: 'task', severity: 'info' },
  'task.running': { domain: 'task', severity: 'info' },
  'task.succeeded': { domain: 'task', severity: 'info' },
  'task.failed': { domain: 'task', severity: 'error' },
  'task.aborted': { domain: 'task', severity: 'warn' },
  'task.corrected': { domain: 'task', severity: 'info' },
  'task.requeued': { domain: 'task', severity: 'info' },
  'task.corrective.requeued': { domain: 'task', severity: 'warn' },
  'task.execution.unproven': { domain: 'task', severity: 'warn' },
  'task.capability.prechecked': { domain: 'task', severity: 'info' },
  'task.rollback.triggered': { domain: 'task', severity: 'error' },
  'task.rolled_back': { domain: 'task', severity: 'error' },
  'task.rollback.skipped': { domain: 'task', severity: 'info' },
  // 运行时
  'runtime.task.synced': { domain: 'runtime', severity: 'info' },
  'runtime.raw.event': { domain: 'runtime', severity: 'info' },
  'runtime.loop.error': { domain: 'runtime', severity: 'error' },
  'runtime.tools.discovered': { domain: 'runtime', severity: 'info' },
  'runtime.task.abort.synced': { domain: 'runtime', severity: 'info' },
  'runtime.shadow.skipped': { domain: 'runtime', severity: 'info' },
  'runtime.shadow.compared': { domain: 'runtime', severity: 'info' },
  'runtime.shadow.failed': { domain: 'runtime', severity: 'warn' },
  'runtime.shadow.policy.updated': { domain: 'runtime', severity: 'info' },
  // 补偿链
  'integration.compensation.queued': { domain: 'compensation', severity: 'warn' },
  'integration.compensation.running': { domain: 'compensation', severity: 'info' },
  'integration.compensation.succeeded': { domain: 'compensation', severity: 'info' },
  'integration.compensation.deferred': { domain: 'compensation', severity: 'warn' },
  'integration.compensation.dead_lettered': { domain: 'compensation', severity: 'critical' },
  'integration.compensation.retry_scheduled': { domain: 'compensation', severity: 'info' },
  'integration.compensation.retry_requested': { domain: 'compensation', severity: 'info' },
  'integration.compensation.crash_recovered': { domain: 'compensation', severity: 'warn' },
  // 自举循环
  'bootstrap.phase.advanced': { domain: 'bootstrap', severity: 'info' },
  'bootstrap.corrective.triggered': { domain: 'bootstrap', severity: 'warn' },
  'bootstrap.manual.review.required': { domain: 'bootstrap', severity: 'critical' },
  // 员工
  'employee.created': { domain: 'employee', severity: 'info' },
  'employee.runtime.provisioned': { domain: 'employee', severity: 'info' },
  'employee.runtime.reprovisioned': { domain: 'employee', severity: 'info' },
  'employee.runtime.file.updated': { domain: 'employee', severity: 'info' },
  'employee.runtime.file.appended': { domain: 'employee', severity: 'info' },
  'employee.daily_memory.appended': { domain: 'employee', severity: 'info' },
  'employee.policy.updated': { domain: 'employee', severity: 'info' },
  'employee.approval_policy.updated': { domain: 'employee', severity: 'info' },
  'employee.profile.updated': { domain: 'employee', severity: 'info' },
  'employee.retrieval_policy.rollout': { domain: 'employee', severity: 'info' },
  'employee.retrieval_policy.rollback': { domain: 'employee', severity: 'warn' },
  'employee.policy.optimized': { domain: 'employee', severity: 'info' },
  // 技能
  'skill.created': { domain: 'skill', severity: 'info' },
  'skill.proposed': { domain: 'skill', severity: 'info' },
  'skill.preloaded': { domain: 'skill', severity: 'info' },
  'skill.essential.preloaded': { domain: 'skill', severity: 'info' },
  'skill.status.changed': { domain: 'skill', severity: 'info' },
  'skill.linked': { domain: 'skill', severity: 'info' },
  'skill.unlinked': { domain: 'skill', severity: 'info' },
  'skill.deleted': { domain: 'skill', severity: 'warn' },
  'skill.restored': { domain: 'skill', severity: 'info' },
  'skill.preloaded.deleted': { domain: 'skill', severity: 'warn' },
  'skill.preloaded.restored': { domain: 'skill', severity: 'info' },
  'skill.imported': { domain: 'skill', severity: 'info' },
  'skill.runtime.synced': { domain: 'skill', severity: 'info' },
  'skill.search.performed': { domain: 'skill', severity: 'info' },
  'skill.auto.proposed': { domain: 'skill', severity: 'info' },
  'skill.auto.created': { domain: 'skill', severity: 'info' },
  'skill.auto.linked': { domain: 'skill', severity: 'info' },
  'skill.sedimentation.decision': { domain: 'skill', severity: 'info' },
  'skill.sedimentation.rejected': { domain: 'skill', severity: 'info' },
  'skill.sedimentation.skipped': { domain: 'skill', severity: 'info' },
  'skill.sedimentation.model.error': { domain: 'skill', severity: 'error' },
  'skill.sedimentation.policy.updated': { domain: 'skill', severity: 'info' },
  // OSS 开源治理
  'oss.research.queued': { domain: 'oss', severity: 'info' },
  'oss.research.done': { domain: 'oss', severity: 'info' },
  'oss.research.failed': { domain: 'oss', severity: 'error' },
  'oss.research.skipped': { domain: 'oss', severity: 'info' },
  'oss.case.identified': { domain: 'oss', severity: 'info' },
  'oss.case.user_confirmation.required': { domain: 'oss', severity: 'warn' },
  'oss.case.decision.completed': { domain: 'oss', severity: 'info' },
  'oss.case.auto.deferred': { domain: 'oss', severity: 'info' },
  'oss.case.auto.proposed': { domain: 'oss', severity: 'info' },
  'oss.case.auto.rejected': { domain: 'oss', severity: 'info' },
  'oss.case.auto.approved': { domain: 'oss', severity: 'info' },
  'oss.case.rejected': { domain: 'oss', severity: 'info' },
  'oss.case.approved': { domain: 'oss', severity: 'info' },
  'oss.case.user.confirmed': { domain: 'oss', severity: 'info' },
  'oss.case.user.rejected': { domain: 'oss', severity: 'info' },
  'oss.case.reviewed': { domain: 'oss', severity: 'info' },
  'oss.case.retired': { domain: 'oss', severity: 'info' },
  'oss.deploy.auto.started': { domain: 'oss', severity: 'info' },
  'oss.deploy.started': { domain: 'oss', severity: 'info' },
  'oss.verify.auto.completed': { domain: 'oss', severity: 'info' },
  'oss.verify.completed': { domain: 'oss', severity: 'info' },
  'oss.rollback.completed': { domain: 'oss', severity: 'warn' },
  'oss.evaluate.completed': { domain: 'oss', severity: 'info' },
  'oss.assessment.build_vs_buy.completed': { domain: 'oss', severity: 'info' },
  'oss.hard_gate.blocked': { domain: 'oss', severity: 'error' },
  // 知识沉淀
  'knowledge.base.created': { domain: 'knowledge', severity: 'info' },
  'knowledge.ingest.completed': { domain: 'knowledge', severity: 'info' },
  'knowledge.search.completed': { domain: 'knowledge', severity: 'info' },
  'knowledge.asset.reviewed': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.failed': { domain: 'knowledge', severity: 'error' },
  'knowledge.sedimentation.deduplicated': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.candidate.created': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.auto.published': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.review.queued': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.rejected': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.reviewed': { domain: 'knowledge', severity: 'info' },
  'knowledge.sedimentation.policy.updated': { domain: 'knowledge', severity: 'info' },
  // 订阅与检索
  'subscription.created': { domain: 'subscription', severity: 'info' },
  'subscription.updated': { domain: 'subscription', severity: 'info' },
  'subscription.paused': { domain: 'subscription', severity: 'info' },
  'subscription.resumed': { domain: 'subscription', severity: 'info' },
  'subscription.retrieval.completed': { domain: 'subscription', severity: 'info' },
  'subscription.retrieval.failed': { domain: 'subscription', severity: 'error' },
  // 检索策略
  'retrieval.policy.decided': { domain: 'retrieval', severity: 'info' },
  'retrieval.policy.mode.updated': { domain: 'retrieval', severity: 'info' },
  // 策略与 Prompt 管理
  'strategy.center.updated': { domain: 'admin', severity: 'info' },
  'prompt.center.updated': { domain: 'admin', severity: 'info' },
  'prompt.version.published': { domain: 'admin', severity: 'info' },
  'prompt.version.rolled_back': { domain: 'admin', severity: 'warn' },
  'prompt.version.approved': { domain: 'admin', severity: 'info' },
  'autoevolve.run.created': { domain: 'admin', severity: 'info' },
  'autoevolve.run.promoted': { domain: 'admin', severity: 'info' },
  'autoevolve.run.reverted': { domain: 'admin', severity: 'warn' },
  // 会话与消息
  'conversation.created': { domain: 'conversation', severity: 'info' },
  'message.created': { domain: 'conversation', severity: 'info' },
  // Agent 路由与权限
  'agent.route.decided': { domain: 'agent', severity: 'info' },
  'assistant.claim.rewritten': { domain: 'agent', severity: 'info' },
  'permission.requested': { domain: 'agent', severity: 'warn' },
  'permission.granted': { domain: 'agent', severity: 'info' },
  'child.agent.created': { domain: 'agent', severity: 'info' },
  // 注册中心
  'registry.tool.registered': { domain: 'registry', severity: 'info' },
  'registry.skill.registered': { domain: 'registry', severity: 'info' },
  // 审计
  'audit.anchor.created': { domain: 'audit', severity: 'info' },
  'audit.anchor.requested': { domain: 'audit', severity: 'info' },
  // 会话与消息
  'conversation.deleted': { domain: 'conversation', severity: 'info' },
  'conversation.deleted.purged': { domain: 'conversation', severity: 'warn' },
  // HTTP 层 Auth 审计事件
  'auth.login.succeeded': { domain: 'auth', severity: 'info' },
  'auth.login.failed': { domain: 'auth', severity: 'warn' },
  'auth.logout': { domain: 'auth', severity: 'info' },
  'auth.sso.token_exchange.login.succeeded': { domain: 'auth', severity: 'info' },
  'auth.sso.token_exchange.login.failed': { domain: 'auth', severity: 'warn' },
  'auth.sso.login.succeeded': { domain: 'auth', severity: 'info' },
  'auth.sso.login.failed': { domain: 'auth', severity: 'warn' },
  'auth.role.permission_matrix.exported': { domain: 'auth', severity: 'info' },
  'auth.user.created': { domain: 'auth', severity: 'info' },
  'auth.user.deleted': { domain: 'auth', severity: 'warn' },
  'auth.user.updated': { domain: 'auth', severity: 'info' },
  'auth.user.password.reset': { domain: 'auth', severity: 'warn' },
  'auth.role.created': { domain: 'auth', severity: 'info' },
  'auth.role.deleted': { domain: 'auth', severity: 'warn' },
  'auth.role.updated': { domain: 'auth', severity: 'info' },
  // HTTP 层 Admin 审计事件
  'admin.runtime.shadow_policy.updated': { domain: 'admin', severity: 'info' },
  'admin.runtime.retrieval_policy.updated': { domain: 'admin', severity: 'info' },
  'admin.runtime.skill_sedimentation_policy.updated': { domain: 'admin', severity: 'info' },
  'admin.runtime.knowledge_sedimentation_policy.updated': { domain: 'admin', severity: 'info' },
  'admin.runtime.strategy_center.updated': { domain: 'admin', severity: 'info' },
  'admin.runtime.prompt_center.updated': { domain: 'admin', severity: 'info' },
  'admin.runtime.prompt_version.published': { domain: 'admin', severity: 'info' },
  'admin.runtime.prompt_version.approved': { domain: 'admin', severity: 'info' },
  'admin.runtime.prompt_version.rolled_back': { domain: 'admin', severity: 'warn' },
  'admin.runtime.autoevolve.run.created': { domain: 'admin', severity: 'info' },
  'admin.runtime.autoevolve.run.promoted': { domain: 'admin', severity: 'info' },
  'admin.runtime.autoevolve.run.reverted': { domain: 'admin', severity: 'warn' },
  // HTTP 层 Tools 审计事件
  'admin.tools.mcp.created': { domain: 'admin', severity: 'info' },
  'admin.tools.mcp.deleted': { domain: 'admin', severity: 'warn' },
  'admin.tools.mcp.health_checked': { domain: 'admin', severity: 'info' },
  'admin.tools.mcp.updated': { domain: 'admin', severity: 'info' },
  'admin.tools.mcp.status_changed': { domain: 'admin', severity: 'info' },
});

/**
 * 严格模式下校验事件类型是否已注册。
 * 生产环境建议开启，开发环境可关闭以便快速迭代。
 */
function assertEventType(type) {
  if (!EVENT_TYPES[type]) {
    const msg = `[EventCatalog] unregistered event type: "${type}"`;
    if (process.env.NODE_ENV === 'production') throw new Error(msg);
    if (process.env.EVENT_CATALOG_STRICT === '1') throw new Error(msg);
    // dev environment: warn via logger if available, else stderr
    try {
      const { logger } = require('./logger');
      logger.warn(msg, { eventType: type });
    } catch {
      process.stderr.write(msg + '\n');
    }
  }
}

/**
 * 获取事件的严重级别。
 */
function getEventSeverity(type) {
  const entry = EVENT_TYPES[type];
  return entry ? entry.severity : 'info';
}

/**
 * 获取 critical 级别的事件类型列表（用于告警消费）。
 */
const CRITICAL_EVENT_TYPES = Object.freeze(
  Object.entries(EVENT_TYPES)
    .filter(([, meta]) => meta.severity === 'critical')
    .map(([type]) => type)
);

module.exports = { EVENT_TYPES, assertEventType, getEventSeverity, CRITICAL_EVENT_TYPES };
