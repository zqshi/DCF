const { handleAdminToolsAssetsRoutes } = require('./tools/adminToolsAssetsRoutes');
const { handleAdminToolsApprovalRoutes } = require('./tools/adminToolsApprovalRoutes');
const { handleAdminToolsPolicyRoutes } = require('./tools/adminToolsPolicyRoutes');

async function handleAdminToolsRoutes(context) {
  if (await handleAdminToolsPolicyRoutes(context)) return true;
  if (await handleAdminToolsApprovalRoutes(context)) return true;
  if (await handleAdminToolsAssetsRoutes(context)) return true;
  return false;
}

module.exports = {
  handleAdminToolsRoutes
};
