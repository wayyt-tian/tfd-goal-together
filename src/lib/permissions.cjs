'use strict';
const COMMON = ['members.manage', 'organization.manage', 'directory.import', 'audit.system', 'system.read'];
const OWNER = [...COMMON, 'roles.assign', 'rules.manage', 'backup.manage', 'audit.all', 'goals.handover'];
function capabilities(user) {
  return user?.active ? user.role === 'owner' ? OWNER : user.role === 'system_admin' ? COMMON : [] : [];
}
function can(user, capability) { return capabilities(user).includes(capability); }
function canManageAccount(actor, target) {
  return actor.role === 'owner' || actor.role === 'system_admin' && target?.role === 'member';
}
module.exports = { capabilities, can, canManageAccount };
