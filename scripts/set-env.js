const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Default fallback password and hash
const DEFAULT_PASSWORD = 'K0rA#9xV$2mQ!7zL%4wP@8bN^3jR&1yF*5tW';
const DEFAULT_HASH = '59effd941b55ad51da68fd97a0ae04c522ee0b05e7fec9d0794871a60ca250eb';

// Built-in .env parser (zero external dependencies required)
function loadDotEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.substring(0, idx).trim();
          let val = trimmed.substring(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1).trim();
          }
          if (key) {
            process.env[key] = val;
          }
        }
      });
      console.log('📄 Parsed local .env file successfully.');
    } catch (err) {
      console.warn('⚠️ Could not parse .env file:', err.message);
    }
  }
}

loadDotEnv();

function cleanVal(val) {
  if (!val) return '';
  let str = val.trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

function getTargetHash() {
  const envPassword = cleanVal(process.env.KORA_APP_PASSWORD);
  const envHash = cleanVal(process.env.KORA_APP_PASSWORD_HASH);

  // KORA_APP_PASSWORD takes priority!
  if (envPassword) {
    const hash = crypto.createHash('sha256').update(envPassword).digest('hex').toLowerCase();
    console.log(`🔒 Computed SHA-256 hash for KORA_APP_PASSWORD ("${envPassword}"): ${hash}`);
    return hash;
  }

  if (envHash) {
    console.log(`🔒 Using explicit KORA_APP_PASSWORD_HASH: ${envHash}`);
    return envHash.toLowerCase();
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

console.log(`✅ Environment files updated. Active Target Hash: ${targetHash}`);
