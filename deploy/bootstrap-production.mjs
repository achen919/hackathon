import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { hashAdminPassword } from '../server/admin-auth.mjs';

const environmentPath = process.env.HACKATHON_ENV_PATH ?? '/etc/hackathon-chat.env';
const credentialPath = process.env.HACKATHON_ADMIN_CREDENTIAL_PATH ?? '/root/hackathon-admin-password';

async function optionalRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

function hasSetting(source, name) {
  return new RegExp(`^${name}=.+$`, 'm').test(source);
}

async function atomicWrite(path, content, mode) {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' });
  await rename(temporaryPath, path);
  await chmod(path, mode);
}

let environment = await optionalRead(environmentPath);
const additions = [];

if (!hasSetting(environment, 'CONFIG_ENCRYPTION_KEY')) {
  additions.push(`CONFIG_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}`);
}

if (!hasSetting(environment, 'ADMIN_PASSWORD_HASH')) {
  let password = (await optionalRead(credentialPath)).trim();
  if (!password) {
    password = randomBytes(24).toString('base64url');
    await atomicWrite(credentialPath, `${password}\n`, 0o600);
  }
  additions.push(`ADMIN_PASSWORD_HASH=${await hashAdminPassword(password)}`);
}

if (additions.length > 0) {
  environment = `${environment.trimEnd()}${environment.trim() ? '\n' : ''}${additions.join('\n')}\n`;
  await atomicWrite(environmentPath, environment, 0o600);
  console.info(`Production secrets initialized: ${additions.map((line) => line.split('=')[0]).join(', ')}`);
} else {
  await chmod(environmentPath, 0o600);
  console.info('Production secrets already initialized; no changes made.');
}

console.info(`Administrator credential file: ${credentialPath}`);
