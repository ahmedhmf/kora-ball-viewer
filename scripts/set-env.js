const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Default fallback password and hash
const DEFAULT_PASSWORD = 'K0rA#9xV$2mQ!7zL%4wP@8bN^3jR&1yF*5tW';
const DEFAULT_HASH = 'd602aa475e6b1b662d94cbe37f6f95e7b161e19c4c0a874dd664e01d80c3c247';

// Try to load .env for local development if dotenv exists
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available, will use process.env directly
}

function getTargetHash() {
  const envPassword = process.env.KORA_APP_PASSWORD;
  const envHash = process.env.KORA_APP_PASSWORD_HASH;

  if (envHash && envHash.trim()) {
    console.log('🔒 Using KORA_APP_PASSWORD_HASH from environment variables.');
    return envHash.trim().toLowerCase();
  }

  if (envPassword && envPassword.trim()) {
    console.log('🔒 Computing SHA-256 hash for KORA_APP_PASSWORD from environment variables.');
    return crypto.createHash('sha256').update(envPassword.trim()).digest('hex').toLowerCase();
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
};
`;

const prodEnvContent = `export const environment = {
  production: true,
  passwordHash: '${targetHash}',
};
`;

fs.writeFileSync(path.join(envDir, 'environment.ts'), devEnvContent, 'utf8');
fs.writeFileSync(path.join(envDir, 'environment.prod.ts'), prodEnvContent, 'utf8');

console.log(`✅ Successfully generated environment files with password hash: ${targetHash}`);
