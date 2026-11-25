'use strict';
const crypto = require('node:crypto');
const scrypt = require('node:util').promisify(crypto.scrypt);
const fs = require('node:fs');
const path = require('node:path');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(value, salt, 32)).toString('hex');
}
async function verifyPassword(value, hash) {
  const [salt, expected] = (hash || '0'.repeat(32) + ':' + '0'.repeat(64)).split(':');
  const actual = await scrypt(typeof value === 'string' && value.length <= 128 ? value : '', salt, 32);
  return /^[a-f0-9]{64}$/.test(expected || '') && crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex')) && Boolean(hash);
}
function passwordValue(value, requireCondition) {
  requireCondition(typeof value === 'string' && value.length >= 10 && value.length <= 128, '密码长度应为 10 至 128 个字符。');
  return value;
}
function setupCredential(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'setup-token.json');
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!saved || saved.expires <= Date.now()) {
    saved = { token: crypto.randomBytes(32).toString('hex'), expires: Date.now() + 86400000 };
    fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  }
  fs.chmodSync(file, 0o600);
  return { file, valid(token) {
    return typeof token === 'string' && saved.expires > Date.now() && digest(token) === digest(saved.token);
  }};
}
async function issueToken(db, userId, actor) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('UPDATE account_tokens SET used_at=now() WHERE user_id=? AND used_at IS NULL', userId);
  await db.run("INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at,created_by) VALUES (?,?,'password',?,?)", digest(token), userId, new Date(Date.now()+1800000).toISOString(), actor);
  return token;
}
module.exports = { hashPassword, verifyPassword, passwordValue, digest, setupCredential, issueToken };
