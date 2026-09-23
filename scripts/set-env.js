const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Default fallback password and hash
const DEFAULT_PASSWORD = 'K0rA#9xV$2mQ!7zL%4wP@8bN^3jR&1yF*5tW';
const DEFAULT_HASH = 'd602aa475e6b1b662d94cbe37f6f95e7b161e19c4c0a874dd664e01d80c3c247';

// Load .env for local development if present
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available in production build
}

function cleanVal(val) {
  if (!val) return '';
  let str = val.trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

function getTargetHash() {
  const envHash = cleanVal(process.env.KORA_APP_PASSWORD_HASH);
  const envPassword = cleanVal(process.env.KORA_APP_PASSWORD);

  if (envHash) {
    console.log('🔒 Using KORA_APP_PASSWORD_HASH from environment.');
    return envHash.toLowerCase();
  }

  if (envPassword) {
    console.log('🔒 Computing SHA-256 hash for KORA_APP_PASSWORD from environment.');
    return crypto.createHash('sha256').update(envPassword).digest('hex').toLowerCase();
  }

  console.log('🔒 Using default high-entropy password hash.');
  return DEFAULT_HASH;
}

const targetHash = getTargetHash();

const envDir = path.join(__dirname, '../src/environments');
if (!fs.existsSync(envDir)) {
  fs.mkdirSync(envDir, { recursive: true });
}

const devEnvContent = `export const environment = {
  production: false,
  passwordHash: '${targetHash}',
  defaultHash: '${DEFAULT_HASH}',
};
`;

const prodEnvContent = `export const environment = {
  production: true,
  passwordHash: '${targetHash}',
  defaultHash: '${DEFAULT_HASH}',
};
`;

fs.writeFileSync(path.join(envDir, 'environment.ts'), devEnvContent, 'utf8');
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), prodEnvContent, 'utf8');

console.log(`✅ Successfully updated environment files with password hash: ${targetHash}`);
