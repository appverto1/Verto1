import fs from 'fs';
import path from 'path';

function parseRequiredEnvFromCompliance(markdown) {
  const sectionRegex = /##\s+Variaveis de ambiente obrigatorias[\s\S]*?(?:\n##\s+|$)/i;
  const section = markdown.match(sectionRegex)?.[0] || '';
  const vars = [...section.matchAll(/-\s+`([A-Z0-9_]+)`/g)].map((m) => m[1]);
  return [...new Set(vars)];
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isBase64Of32Bytes(value) {
  try {
    const normalized = value.replace(/\s+/g, '');
    return Buffer.from(normalized, 'base64').length === 32;
  } catch {
    return false;
  }
}

function isDeployEnvironment() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return true;
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.DEPLOY_ENV === 'production') return true;
  return false;
}

const cwd = process.cwd();
const compliancePath = path.join(cwd, 'SECURITY_COMPLIANCE.md');
const fallbackRequired = [
  'SESSION_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATA_ENCRYPTION_KEY',
  'PSEUDONYMIZATION_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

const requiredVars = (() => {
  if (!fs.existsSync(compliancePath)) return fallbackRequired;
  const markdown = fs.readFileSync(compliancePath, 'utf8');
  const parsed = parseRequiredEnvFromCompliance(markdown);
  return parsed.length > 0 ? parsed : fallbackRequired;
})();

const errors = [];
for (const key of requiredVars) {
  const raw = process.env[key];
  if (!raw || !String(raw).trim()) {
    errors.push(`${key}: ausente ou vazio.`);
  }
}

const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
if (supabaseUrl && !isValidUrl(supabaseUrl)) {
  errors.push('SUPABASE_URL: formato invalido de URL.');
}

const encryptionKey = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
if (encryptionKey && !/^[0-9a-fA-F]{64}$/.test(encryptionKey) && !isBase64Of32Bytes(encryptionKey)) {
  errors.push('DATA_ENCRYPTION_KEY: use hex (64 chars) ou base64 (32 bytes).');
}

const sessionSecret = String(process.env.SESSION_SECRET || '').trim();
if (sessionSecret && sessionSecret.length < 32) {
  errors.push('SESSION_SECRET: minimo recomendado de 32 caracteres.');
}

const pseudonymizationKey = String(process.env.PSEUDONYMIZATION_KEY || '').trim();
if (pseudonymizationKey && pseudonymizationKey.length < 32) {
  errors.push('PSEUDONYMIZATION_KEY: minimo recomendado de 32 caracteres.');
}

const stripeSecret = String(process.env.STRIPE_SECRET_KEY || '').trim();
if (stripeSecret && !stripeSecret.startsWith('sk_')) {
  errors.push('STRIPE_SECRET_KEY: prefixo esperado "sk_".');
}

const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('whsec_')) {
  errors.push('STRIPE_WEBHOOK_SECRET: prefixo esperado "whsec_".');
}

if (errors.length > 0) {
  if (isDeployEnvironment()) {
    console.error('[SECURITY] Validacao de ambiente falhou para deploy/producao.');
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  } else {
    console.warn('[SECURITY] Ambiente local com pendencias de variaveis obrigatorias:');
    for (const err of errors) {
      console.warn(`- ${err}`);
    }
    console.warn('[SECURITY] Execucao local permitida. Em deploy/producao isso bloqueia startup.');
  }
}
