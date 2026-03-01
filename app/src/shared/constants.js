/**
 * DCF 系统级共享常量。所有枚举值的唯一真相来源。
 * 任何消费方（Schema、Validator、Runtime、前端）必须引用此文件，禁止硬编码。
 */

const RUNTIME_EVENT_SOURCES = Object.freeze(['openclaw', 'self-hosted', 'skills-runtime']);
const RUNTIME_EVENT_SOURCES_SET = new Set(RUNTIME_EVENT_SOURCES);

const VALID_TASK_STATUSES = Object.freeze([
  'pending',
  'validating',
  'approved',
  'running',
  'succeeded',
  'failed',
  'rolled_back',
  'aborted'
]);
const VALID_TASK_STATUSES_SET = new Set(VALID_TASK_STATUSES);

const ACTIVE_TASK_STATUSES = Object.freeze(['pending', 'validating', 'approved', 'running']);
const ACTIVE_TASK_STATUSES_SET = new Set(ACTIVE_TASK_STATUSES);

const TERMINAL_TASK_STATUSES = Object.freeze(['succeeded', 'failed', 'rolled_back', 'aborted']);
const TERMINAL_TASK_STATUSES_SET = new Set(TERMINAL_TASK_STATUSES);

module.exports = {
  RUNTIME_EVENT_SOURCES,
  RUNTIME_EVENT_SOURCES_SET,
  VALID_TASK_STATUSES,
  VALID_TASK_STATUSES_SET,
  ACTIVE_TASK_STATUSES,
  ACTIVE_TASK_STATUSES_SET,
  TERMINAL_TASK_STATUSES,
  TERMINAL_TASK_STATUSES_SET
};
