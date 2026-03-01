const { handleSystemManagementRoutes } = require('./adminCore/systemManagementRoutes');
const { handleAuthManagementRoutes } = require('./adminCore/authManagementRoutes');
const { handleEmployeeManagementRoutes } = require('./adminCore/employeeManagementRoutes');
const { handleSkillManagementRoutes } = require('./adminCore/skillManagementRoutes');
const { handleTaskManagementRoutes } = require('./adminCore/taskManagementRoutes');
const { handleKnowledgeManagementRoutes } = require('./adminCore/knowledgeManagementRoutes');
const { handleOssManagementRoutes } = require('./adminCore/ossManagementRoutes');

async function handleAdminCoreRoutes(context) {
  if (await handleSystemManagementRoutes(context)) return true;
  if (await handleAuthManagementRoutes(context)) return true;
  if (await handleEmployeeManagementRoutes(context)) return true;
  if (await handleSkillManagementRoutes(context)) return true;
  if (await handleTaskManagementRoutes(context)) return true;
  if (await handleKnowledgeManagementRoutes(context)) return true;
  if (await handleOssManagementRoutes(context)) return true;
  return false;
}

module.exports = {
  handleAdminCoreRoutes
};
