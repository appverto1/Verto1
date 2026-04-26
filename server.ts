import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pg from 'pg';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { generateSecret, verifySync, generateURI } from 'otplib';
import QRCode from 'qrcode';
import {
  getClinicBillingSummary,
  syncAllClinicsActivePatientAddonQuantity,
  syncClinicActivePatientAddonQuantity
} from './services/stripeService';
import {
  buildActivationEmailTemplate,
  buildPasswordRecoveryEmailTemplate
} from './src/services/emailTemplates';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isValidDataEncryptionKey(raw: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return true;
  try {
    return Buffer.from(raw, 'base64').length === 32;
  } catch {
    return false;
  }
}

function validateRequiredEnvForDeploy(): void {
  const isDeploy = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  if (!isDeploy) return;

  const required = [
    'SESSION_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATA_ENCRYPTION_KEY',
    'PSEUDONYMIZATION_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET'
  ] as const;

  const missing = required.filter((key) => !String(process.env[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Ambiente inseguro para deploy. Variaveis ausentes: ${missing.join(', ')}`);
  }

  const dataEncryptionKey = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!isValidDataEncryptionKey(dataEncryptionKey)) {
    throw new Error('DATA_ENCRYPTION_KEY invalida. Use hex com 64 caracteres ou base64 com 32 bytes.');
  }
}

validateRequiredEnvForDeploy();

// Initialize Stripe lazily to prevent crash on startup if key is missing
let stripeClient: Stripe | null = null;
function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function normalizeSubscriptionStatusFromStripe(status: string): 'active' | 'pending' | 'delinquent' | 'canceled' {
  const normalized = sanitizeString(status, 50).toLowerCase();
  if (normalized === 'active' || normalized === 'trialing') return 'active';
  if (normalized === 'past_due' || normalized === 'unpaid') return 'delinquent';
  if (normalized === 'canceled' || normalized === 'incomplete_expired') return 'canceled';
  return 'pending';
}

async function updateClinicSubscriptionStatus(params: {
  clinicId?: string | null;
  userId?: string | null;
  email?: string | null;
  status: 'active' | 'pending' | 'delinquent' | 'canceled';
}) {
  const safeClinicId = sanitizeString(params.clinicId, 120);
  const safeUserId = sanitizeString(params.userId, 120);
  const safeEmail = sanitizeEmail(params.email);

  if (safeClinicId) {
    const { error } = await supabase
      .from('users')
      .update({ subscription_status: params.status })
      .eq('clinic_id', safeClinicId)
      .in('role', ['coordinator', 'therapist', 'receptionist']);
    if (error) {
      console.error('[Stripe Webhook] Falha ao atualizar status por clínica:', {
        clinicId: safeClinicId,
        status: params.status,
        message: error.message
      });
    }
  }

  if (safeUserId) {
    const { error } = await supabase
      .from('users')
      .update({ subscription_status: params.status })
      .eq('id', safeUserId);
    if (error) {
      console.error('[Stripe Webhook] Falha ao atualizar status por userId:', {
        userId: safeUserId,
        status: params.status,
        message: error.message
      });
    }
  } else if (!safeClinicId && safeEmail) {
    const { error } = await supabase
      .from('users')
      .update({ subscription_status: params.status })
      .eq('email', safeEmail);
    if (error) {
      console.error('[Stripe Webhook] Falha ao atualizar status por email:', {
        email: safeEmail,
        status: params.status,
        message: error.message
      });
    }
  }
}

function resolveActivePatientPriceId(): string {
  return sanitizeString(process.env.STRIPE_ACTIVE_PATIENT_PRICE_ID || '', 120);
}

function queueActivePatientSync(clinicId: string | null | undefined, trigger: string) {
  const safeClinicId = sanitizeString(clinicId, 120);
  const activePatientPriceId = resolveActivePatientPriceId();
  if (!safeClinicId || !activePatientPriceId) return;

  try {
    const stripe = getStripe();
    void syncClinicActivePatientAddonQuantity({
      supabase,
      stripe,
      clinicId: safeClinicId,
      trigger,
      activePatientPriceId,
      logger: console
    }).catch((error: any) => {
      console.error('[CRITICAL] Falha ao sincronizar adicional de pacientes ativos (não bloqueante).', {
        clinicId: safeClinicId,
        trigger,
        message: error?.message || String(error)
      });
    });
  } catch (error: any) {
    console.error('[CRITICAL] Stripe indisponível para sincronização de pacientes ativos.', {
      clinicId: safeClinicId,
      trigger,
      message: error?.message || String(error)
    });
  }
}

function normalizeProfessionalPlan(input?: string | null): 'Essencial' | 'Crescimento' | 'Avançado' | null {
  if (!input) return null;
  const normalized = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized === 'essencial') return 'Essencial';
  if (normalized === 'crescimento') return 'Crescimento';
  if (normalized === 'avancado') return 'Avançado';
  return null;
}

type AppRole = 'owner' | 'admin' | 'coordinator' | 'receptionist' | 'therapist' | 'patient';
type ClinicRole = 'coordinator' | 'therapist' | 'receptionist';

const ALL_ROLES: AppRole[] = ['owner', 'admin', 'coordinator', 'receptionist', 'therapist', 'patient'];
const CLINIC_ROLES: ClinicRole[] = ['coordinator', 'therapist', 'receptionist'];
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENCRYPTION_ALGO = 'aes-256-gcm';
const paymentStatuses = new Set(['paid', 'pending', 'canceled', 'refunded', 'delinquent']);
const OTP_TTL_MS = 15 * 60 * 1000;

function sanitizeString(value: unknown, maxLength = 5000): string {
  if (typeof value !== 'string') return '';
  const withoutScriptTags = value.replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, ' ');
  const withoutDangerousProtocols = withoutScriptTags
    .replace(/javascript\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/data\s*:\s*text\/html/gi, '');
  return withoutDangerousProtocols
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .normalize('NFC')
    .trim()
    .slice(0, maxLength);
}

function sanitizeEmail(value: unknown): string | null {
  const email = sanitizeString(value, 320).toLowerCase();
  if (!email) return null;
  return EMAIL_REGEX.test(email) ? email : null;
}

function sanitizePhone(value: unknown): string | null {
  const digits = sanitizeString(value, 40).replace(/\D/g, '');
  if (!digits) return null;
  return digits.slice(0, 20);
}

function sanitizeDate(value: unknown): string | null {
  const date = sanitizeString(value, 10);
  if (!DATE_ONLY_REGEX.test(date)) return null;
  return date;
}

function sanitizePhoneE164(value: unknown): string | null {
  const raw = sanitizeString(value, 30);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return null;
  if (!/^\+\d{8,15}$/.test(digits)) return null;
  return digits;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function hashIdentifier(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generate6DigitOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function getAuthRedirectUrl(): string {
  const baseUrl = sanitizeString(
    process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '',
    500
  );
  if (!baseUrl) {
    throw new Error('VERTO_APP_BASE_URL (ou APP_BASE_URL) deve estar definida para redirecionamentos de autenticação.');
  }
  return `${baseUrl.replace(/\/+$/, '')}/auth/callback`;
}

function getRecoveryRedirectUrl(): string {
  const baseUrl = sanitizeString(
    process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '',
    500
  );
  if (!baseUrl) {
    throw new Error('VERTO_APP_BASE_URL (ou APP_BASE_URL) deve estar definida para recuperação de senha.');
  }
  return `${baseUrl.replace(/\/+$/, '')}/reset-password`;
}

function extractSupabaseErrorMessage(error: any): string {
  return sanitizeString(
    error?.message ||
      error?.details ||
      error?.hint ||
      (typeof error === 'string' ? error : JSON.stringify(error || {})),
    1000
  );
}

function isMissingRelationError(error: any): boolean {
  const message = extractSupabaseErrorMessage(error).toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('relation') ||
    message.includes('schema cache') ||
    message.includes('42p01')
  );
}

function logRouteDbError(route: string, error: any, context: Record<string, any> = {}) {
  console.error(`[DB:${route}]`, {
    message: extractSupabaseErrorMessage(error),
    code: sanitizeString(error?.code, 40) || null,
    details: sanitizeString(error?.details, 300) || null,
    hint: sanitizeString(error?.hint, 300) || null,
    context
  });
}

const OFFICIAL_FROM_CONTACT = 'Verto <contato@appverto.com.br>';
const OFFICIAL_FROM_NOREPLY = 'Verto <naoresponda@appverto.com.br>';
const OFFICIAL_TRANSACTIONAL_REPLY_TO = 'contato@appverto.com.br';
type ResendTemplateKind =
  | 'welcome_professional'
  | 'welcome_patient'
  | 'recovery_professional'
  | 'recovery_patient';

function resolveResendTemplateId(kind?: ResendTemplateKind): string | null {
  if (!kind) return null;
  const keyByKind: Record<ResendTemplateKind, string> = {
    welcome_professional: 'RESEND_TEMPLATE_WELCOME_PROFESSIONAL_ID',
    welcome_patient: 'RESEND_TEMPLATE_WELCOME_PATIENT_ID',
    recovery_professional: 'RESEND_TEMPLATE_RECOVERY_PROFESSIONAL_ID',
    recovery_patient: 'RESEND_TEMPLATE_RECOVERY_PATIENT_ID'
  };
  const envKey = keyByKind[kind];
  const id = sanitizeString(process.env[envKey] || '', 200);
  return id || null;
}

function resolveTemplateProfileByRole(role: unknown): 'professional' | 'patient' {
  const normalized = sanitizeString(role, 40).toLowerCase();
  return normalized === 'patient' ? 'patient' : 'professional';
}

async function generateSupabaseActionLink(params: {
  type: 'signup' | 'recovery';
  email: string;
  redirectTo: string;
}): Promise<string | null> {
  try {
    const admin = (supabase as any)?.auth?.admin;
    if (!admin?.generateLink) return null;
    const { data, error } = await admin.generateLink({
      type: params.type,
      email: params.email,
      options: { redirectTo: params.redirectTo }
    });
    if (error) throw error;
    const actionLink = sanitizeString(
      data?.properties?.action_link || data?.action_link || '',
      2000
    );
    return actionLink || null;
  } catch (error: any) {
    console.warn('[Auth] generate action link warning:', {
      type: params.type,
      email: maskEmail(params.email),
      message: error?.message || String(error)
    });
    return null;
  }
}

async function sendTransactionalEmailSafe(params: {
  to: string;
  subject: string;
  html: string;
  context: string;
  from?: string;
  replyTo?: string;
  templateKind?: ResendTemplateKind;
  templateData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await sendEmailViaResend({
      to: params.to,
      subject: params.subject,
      html: params.html,
      from: params.from || OFFICIAL_FROM_NOREPLY,
      replyTo: params.replyTo || OFFICIAL_TRANSACTIONAL_REPLY_TO,
      templateId: resolveResendTemplateId(params.templateKind),
      templateData: params.templateData
    });
    return true;
  } catch (error: any) {
    console.error('[Email] transactional send failed:', {
      context: params.context,
      message: error?.message || String(error),
      metadata: params.metadata || null
    });
    return false;
  }
}

type RecoveryChannel = 'email';
type OtpPurpose = 'password_recovery' | 'phone_verification';

type OtpChallenge = {
  key: string;
  channel: RecoveryChannel;
  purpose: OtpPurpose;
  identifier: string;
  userId: string | null;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
  createdAt: number;
};

const otpStore = new Map<string, OtpChallenge>();

function setOtpChallenge(challenge: OtpChallenge): void {
  otpStore.set(challenge.key, challenge);
}

function getOtpChallenge(key: string): OtpChallenge | null {
  const challenge = otpStore.get(key);
  if (!challenge) return null;
  if (Date.now() > challenge.expiresAt) {
    otpStore.delete(key);
    return null;
  }
  return challenge;
}

function consumeOtpChallenge(key: string): void {
  otpStore.delete(key);
}

function makeOtpChallengeKey(channel: RecoveryChannel, purpose: OtpPurpose, identifier: string): string {
  return hashIdentifier(`${channel}:${purpose}:${identifier.toLowerCase()}`);
}

function validateStrongPassword(password: unknown): string | null {
  if (typeof password !== 'string') return null;
  if (password.length < 12 || password.length > 128) return null;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) return null;
  return password;
}

function isMissingColumnError(error: any, columnName?: string): boolean {
  const code = sanitizeString(error?.code, 20);
  const message = sanitizeString(error?.message, 500).toLowerCase();
  if (code === '42703') return true;
  if (!message) return false;
  if (columnName) {
    return message.includes(columnName.toLowerCase()) && message.includes('does not exist');
  }
  return message.includes('does not exist');
}

async function sendEmailViaResend({
  to,
  subject,
  html,
  from,
  replyTo,
  templateId,
  templateData
}: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  templateId?: string | null;
  templateData?: Record<string, unknown>;
}): Promise<void> {
  const apiKey = sanitizeString(process.env.RESEND_API_KEY || '', 500);
  const defaultFrom = sanitizeString(process.env.RESEND_FROM_EMAIL || '', 320);
  const effectiveFrom = sanitizeString(from || defaultFrom, 320);
  const effectiveReplyTo = sanitizeString(replyTo || '', 320);
  if (!apiKey || !effectiveFrom) {
    throw new Error('RESEND_API_KEY e RESEND_FROM_EMAIL são obrigatórios para envio de e-mails transacionais.');
  }

  const payload: Record<string, any> = {
    from: effectiveFrom,
    to: [to],
    subject,
    html,
    ...(effectiveReplyTo ? { reply_to: [effectiveReplyTo] } : {})
  };
  if (templateId) {
    payload.template = {
      id: templateId,
      variables: templateData || {}
    };
    delete payload.html;
  }

  let response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  // Fallback seguro para HTML caso template remoto não esteja disponível/configurado corretamente.
  if (!response.ok && templateId) {
    const fallbackPayload = {
      from: effectiveFrom,
      to: [to],
      subject,
      html,
      ...(effectiveReplyTo ? { reply_to: [effectiveReplyTo] } : {})
    };
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fallbackPayload)
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha no envio de e-mail via Resend: ${response.status} ${body}`);
  }
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

function sanitizeTextField(value: unknown, maxLength = 5000): string {
  return escapeHtml(sanitizeString(value, maxLength));
}

function approximateBodySizeBytes(body: any): number {
  try {
    return Buffer.byteLength(JSON.stringify(body || {}), 'utf8');
  } catch {
    return 0;
  }
}

function enforcePayloadLimit(req: any, res: any, maxBytes: number, label: string): boolean {
  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    res.status(413).json({ error: `${label} excede o limite permitido.` });
    return false;
  }

  const actualBytes = approximateBodySizeBytes(req.body);
  if (actualBytes > maxBytes) {
    res.status(413).json({ error: `${label} excede o limite permitido.` });
    return false;
  }
  return true;
}

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function sanitizeClinicalPayload(input: any, depth = 0): any {
  if (depth > 8) return null;
  if (input === null || input === undefined) return null;

  if (typeof input === 'string') {
    return sanitizeTextField(input, 4000);
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 200).map((item) => sanitizeClinicalPayload(item, depth + 1));
  }
  if (typeof input !== 'object') return null;

  const safe: Record<string, any> = {};
  const entries = Object.entries(input).slice(0, 300);
  for (const [rawKey, value] of entries) {
    const key = sanitizeString(rawKey, 120);
    if (!key || DANGEROUS_OBJECT_KEYS.has(key)) continue;
    safe[key] = sanitizeClinicalPayload(value, depth + 1);
  }
  return safe;
}

function getTrustedMediaHosts(): Set<string> {
  const hosts = new Set<string>();
  const envHosts = sanitizeString(process.env.TRUSTED_MEDIA_HOSTS || '', 2000)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  for (const host of envHosts) hosts.add(host);

  try {
    if (process.env.SUPABASE_URL) {
      hosts.add(new URL(process.env.SUPABASE_URL).hostname.toLowerCase());
    }
  } catch {
    // no-op
  }

  hosts.add('localhost');
  hosts.add('127.0.0.1');
  return hosts;
}

const trustedMediaHosts = getTrustedMediaHosts();

function isTrustedRemoteMediaUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    if (protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    if (trustedMediaHosts.has(host)) return true;
    if (host.endsWith('.supabase.co')) return true;
    return false;
  } catch {
    return false;
  }
}

function sanitizeUrl(value: unknown): string | null {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const safe = sanitizeString(url, 4000);
    return isTrustedRemoteMediaUrl(safe) ? safe : null;
  }
  if (url.startsWith('data:image/')) {
    // Data URLs (logo/assinatura/foto) podem passar de 2k caracteres.
    // Mantemos limite de 1MB para evitar payloads abusivos.
    if (url.length > 1_000_000) return null;
    return url;
  }
  return null;
}

function sanitizeSessionUrl(value: unknown): string | null {
  const url = sanitizeUrl(value);
  if (!url) return null;
  // Never keep large data URLs inside session payload.
  if (url.startsWith('data:image/')) return null;
  return sanitizeString(url, 1500);
}

type DetectedUploadMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'application/pdf'
  | 'text/html'
  | 'application/json';
type UploadContext = 'image-only' | 'image-or-pdf' | 'anamnesis-document';

function normalizeMime(input?: string | null): string {
  const lower = sanitizeString(input, 120).toLowerCase().split(';')[0].trim();
  if (!lower) return '';
  if (lower === 'image/jpg') return 'image/jpeg';
  return lower;
}

function detectMimeByMagicBytes(buffer: Buffer): DetectedUploadMime | null {
  if (buffer.length >= 8) {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (isPng) return 'image/png';
  }

  if (buffer.length >= 3) {
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (isJpeg) return 'image/jpeg';
  }

  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }

  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }

  if (buffer.length >= 5) {
    const pdf = buffer.subarray(0, 5).toString('ascii');
    if (pdf === '%PDF-') return 'application/pdf';
  }

  // Suporte para ficha de anamnese em HTML (gerada no frontend e enviada em base64)
  // Apenas quando o conteúdo realmente parece um documento HTML válido.
  const textProbe = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('utf8').trim().toLowerCase();
  if (textProbe.startsWith('<!doctype html') || textProbe.startsWith('<html') || textProbe.includes('<body')) {
    return 'text/html';
  }
  if (buffer.length >= 4) {
    const isUtf16Le = buffer[0] === 0xff && buffer[1] === 0xfe;
    const isUtf16Be = buffer[0] === 0xfe && buffer[1] === 0xff;
    if (isUtf16Le || isUtf16Be) {
      const utf16Probe = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf16le').trim().toLowerCase();
      if (utf16Probe.startsWith('<!doctype html') || utf16Probe.startsWith('<html') || utf16Probe.includes('<body')) {
        return 'text/html';
      }
    }
  }

  if (textProbe.startsWith('{') || textProbe.startsWith('[')) {
    try {
      JSON.parse(textProbe);
      return 'application/json';
    } catch {
      // ignore invalid json probe
    }
  }

  return null;
}

function isAllowedDetectedMime(mime: DetectedUploadMime, context: UploadContext): boolean {
  if (context === 'image-only') {
    return mime.startsWith('image/');
  }
  if (context === 'anamnesis-document') {
    return mime === 'application/pdf' || mime === 'text/html' || mime === 'application/json' || mime.startsWith('image/');
  }
  return mime.startsWith('image/') || mime === 'application/pdf' || mime === 'application/json';
}

function validateBinaryUpload(
  fileBuffer: Buffer,
  providedMime: string | null | undefined,
  context: UploadContext
): { ok: true; detectedMime: DetectedUploadMime } | { ok: false; error: string } {
  const detectedMime = detectMimeByMagicBytes(fileBuffer);
  if (!detectedMime) {
    return { ok: false, error: 'Tipo real do arquivo não reconhecido. Envie imagem válida ou PDF clínico.' };
  }

  if (!isAllowedDetectedMime(detectedMime, context)) {
    return { ok: false, error: 'Arquivo bloqueado pela política de mídia segura.' };
  }

  const normalizedProvidedMime = normalizeMime(providedMime);
  if (normalizedProvidedMime && normalizedProvidedMime !== 'application/octet-stream' && normalizedProvidedMime !== detectedMime) {
    return { ok: false, error: 'MIME informado divergente do tipo real (magic bytes).' };
  }

  return { ok: true, detectedMime };
}

async function parseMultipartFormData(req: any): Promise<{
  fields: Record<string, string>;
  file: { fileName: string; contentType: string; buffer: Buffer } | null;
}> {
  const contentType = String(req.headers?.['content-type'] || '');
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) {
    throw new Error('Boundary multipart ausente.');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 12 * 1024 * 1024) {
        reject(new Error('Payload multipart excede 12MB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve());
    req.on('error', (error: any) => reject(error));
  });

  const raw = Buffer.concat(chunks).toString('latin1');
  const boundaryToken = `--${boundary}`;
  const fields: Record<string, string> = {};
  let file: { fileName: string; contentType: string; buffer: Buffer } | null = null;

  for (const rawPart of raw.split(boundaryToken)) {
    const part = rawPart.trim();
    if (!part || part === '--') continue;

    const headerEndIndex = part.indexOf('\r\n\r\n');
    if (headerEndIndex <= 0) continue;

    const headersRaw = part.slice(0, headerEndIndex);
    let bodyRaw = part.slice(headerEndIndex + 4);
    bodyRaw = bodyRaw.replace(/\r\n$/, '');
    bodyRaw = bodyRaw.replace(/--$/, '');

    const contentDispositionLine =
      headersRaw
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-disposition:')) || '';
    const contentTypeLine =
      headersRaw
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-type:')) || '';

    const nameMatch = contentDispositionLine.match(/name="([^"]+)"/i);
    const fileNameMatch = contentDispositionLine.match(/filename="([^"]*)"/i);
    const fieldName = sanitizeString(nameMatch?.[1] || '', 120);
    if (!fieldName) continue;

    const bodyBuffer = Buffer.from(bodyRaw, 'latin1');
    if (fileNameMatch && bodyBuffer.length) {
      const uploadedName = sanitizeString(fileNameMatch[1] || 'arquivo.bin', 220) || 'arquivo.bin';
      const uploadedType = sanitizeString(
        contentTypeLine.replace(/^content-type:\s*/i, ''),
        120
      ) || 'application/octet-stream';
      file = {
        fileName: uploadedName,
        contentType: uploadedType,
        buffer: bodyBuffer
      };
      continue;
    }

    fields[fieldName] = Buffer.from(bodyRaw, 'latin1').toString('utf8');
  }

  return { fields, file };
}

function asSafeNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, num));
}

function cleanObject<T extends Record<string, any>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function ensureRole(role: unknown): role is AppRole {
  return typeof role === 'string' && (ALL_ROLES as string[]).includes(role);
}

function ensureClinicRole(role: unknown): role is ClinicRole {
  return typeof role === 'string' && (CLINIC_ROLES as string[]).includes(role);
}

function normalizeRequestedRole(role: unknown): AppRole {
  const safe = sanitizeString(role, 40).toLowerCase();
  if (safe === 'coordinator' || safe === 'admin' || safe === 'therapist' || safe === 'receptionist' || safe === 'patient' || safe === 'owner') {
    return safe as AppRole;
  }
  if (safe === 'professional') return 'coordinator';
  return 'therapist';
}

function requireRoles(...allowedRoles: AppRole[]) {
  const allowed = new Set<AppRole>(allowedRoles);
  return (req: any, res: any, next: any) => {
    const role = req.session?.user?.role;
    if (!ensureRole(role) || !allowed.has(role)) {
      return res.status(403).json({ error: 'Acesso negado para este perfil.' });
    }
    return next();
  };
}

function getEncryptionKey(): Buffer | null {
  const raw = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    const sessionSecret = (process.env.SESSION_SECRET || '').trim();
    if (!sessionSecret) return null;
    return crypto.createHash('sha256').update(sessionSecret).digest();
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    return null;
  }

  return null;
}

const encryptionKey = getEncryptionKey();

function encryptJsonPayload(payload: Record<string, any>): string | null {
  if (!encryptionKey) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, encryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptJsonPayload(payload: string | null | undefined): Record<string, any> | null {
  if (!encryptionKey || !payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;

    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, encryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (error: any) {
    console.error('[Encryption] Falha ao descriptografar payload clínico:', error?.message || String(error));
    return null;
  }
}

function pseudonymizeValue(value: string): string {
  const secret = (process.env.PSEUDONYMIZATION_KEY || process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('PSEUDONYMIZATION_KEY (ou SESSION_SECRET em dev) deve estar definido.');
  }
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 24);
}

function getDefaultAnamnesisTemplate() {
  const commonSections = [
    { id: 'identificacao', title: 'Identificacao', order: 1, active: true },
    { id: 'cadastro_operacional', title: 'Cadastro Operacional (MVP)', order: 2, active: true },
    { id: 'responsavel_legal', title: 'Responsavel Legal (menor de idade)', order: 3, active: true },
    { id: 'personalizadas', title: 'Perguntas Personalizadas', order: 99, active: true }
  ];

  const commonQuestions = [
    { id: 'nome', sectionId: 'identificacao', label: 'Nome completo', type: 'dissertativa', required: true, active: true, order: 1 },
    { id: 'email', sectionId: 'identificacao', label: 'E-mail do paciente', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'dataNascimento', sectionId: 'identificacao', label: 'Nascimento', type: 'data', required: false, active: true, order: 3 },
    { id: 'idade', sectionId: 'identificacao', label: 'Idade', type: 'numero', required: false, active: true, order: 4 },
    { id: 'genero', sectionId: 'identificacao', label: 'Genero', type: 'multipla_escolha', options: ['Feminino', 'Masculino', 'Nao-binario', 'Prefere nao informar'], required: false, active: true, order: 5 },
    { id: 'nomeSocial', sectionId: 'cadastro_operacional', label: 'Nome social', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'telefone', sectionId: 'cadastro_operacional', label: 'Telefone', type: 'telefone', required: false, active: true, order: 2 },
    { id: 'grupo', sectionId: 'cadastro_operacional', label: 'Grupo', type: 'multipla_escolha', options: ['Infantil', 'Adolescente', 'Adulto', 'Idoso'], required: false, active: true, order: 3 },
    { id: 'convenioTipo', sectionId: 'cadastro_operacional', label: 'Convenio ou particular', type: 'multipla_escolha', options: ['Particular', 'Convenio'], required: false, active: true, order: 4 },
    { id: 'convenioNome', sectionId: 'cadastro_operacional', label: 'Convenio', type: 'dissertativa', required: false, active: true, order: 5 },
    { id: 'convenioCarteirinha', sectionId: 'cadastro_operacional', label: 'Numero da carteirinha', type: 'dissertativa', required: false, active: true, order: 6 },
    { id: 'comoConheceu', sectionId: 'cadastro_operacional', label: 'Como conheceu a clinica', type: 'multipla_escolha', options: ['Google', 'Indicacao', 'Email', 'WhatsApp', 'Rede social', 'Evento', 'Convenio', 'Outro'], required: false, active: true, order: 7 },
    { id: 'rg', sectionId: 'cadastro_operacional', label: 'RG', type: 'dissertativa', required: false, active: true, order: 8 },
    { id: 'cpf', sectionId: 'cadastro_operacional', label: 'CPF', type: 'dissertativa', required: false, active: true, order: 9 },
    { id: 'cep', sectionId: 'cadastro_operacional', label: 'CEP', type: 'dissertativa', required: false, active: true, order: 10 },
    { id: 'logradouro', sectionId: 'cadastro_operacional', label: 'Logradouro', type: 'dissertativa', required: false, active: true, order: 11 },
    { id: 'numero', sectionId: 'cadastro_operacional', label: 'Numero', type: 'dissertativa', required: false, active: true, order: 12 },
    { id: 'complemento', sectionId: 'cadastro_operacional', label: 'Complemento', type: 'dissertativa', required: false, active: true, order: 13 },
    { id: 'bairro', sectionId: 'cadastro_operacional', label: 'Bairro', type: 'dissertativa', required: false, active: true, order: 14 },
    { id: 'cidade', sectionId: 'cadastro_operacional', label: 'Cidade', type: 'dissertativa', required: false, active: true, order: 15 },
    { id: 'outrasInformacoes', sectionId: 'cadastro_operacional', label: 'Outras informacoes', type: 'dissertativa', required: false, active: true, order: 16 },
    { id: 'menorDeIdade', sectionId: 'responsavel_legal', label: 'Paciente menor de idade?', type: 'sim_nao', required: false, active: true, order: 1 },
    { id: 'responsavelNome', sectionId: 'responsavel_legal', label: 'Nome do responsavel', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'responsavelDataNascimento', sectionId: 'responsavel_legal', label: 'Nascimento do responsavel', type: 'data', required: false, active: true, order: 3 },
    { id: 'responsavelCpf', sectionId: 'responsavel_legal', label: 'CPF do responsavel', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'responsavelTelefone', sectionId: 'responsavel_legal', label: 'Telefone do responsavel', type: 'telefone', required: false, active: true, order: 5 }
  ];

  const adultSections = [
    { id: 'historia_clinica', title: 'Historia Atual e Motivo da Consulta', order: 10, active: true },
    { id: 'familia_ambiente', title: 'Familia e Ambiente', order: 11, active: true },
    { id: 'saude_rotina', title: 'Saude, Habitos e Rotina', order: 12, active: true },
    { id: 'processos_previos', title: 'Processos Terapeuticos Previos', order: 13, active: true }
  ];

  const adultQuestions = [
    { id: 'estadoCivil', sectionId: 'historia_clinica', label: 'Estado civil', type: 'multipla_escolha', options: ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Uniao estavel', 'Outro'], required: false, active: true, order: 1 },
    { id: 'profissao', sectionId: 'historia_clinica', label: 'Profissao', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'motivoConsulta', sectionId: 'historia_clinica', label: 'Motivo da consulta', type: 'dissertativa', required: true, active: true, order: 3 },
    { id: 'iniciativaTratamento', sectionId: 'historia_clinica', label: 'Iniciativa do tratamento', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'expectativa', sectionId: 'historia_clinica', label: 'Expectativa com o processo terapeutico', type: 'dissertativa', required: false, active: true, order: 5 },
    { id: 'familiaConstituicao', sectionId: 'familia_ambiente', label: 'Constituicao familiar', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'familiaClima', sectionId: 'familia_ambiente', label: 'Clima familiar atual', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'vidaSocialGeral', sectionId: 'familia_ambiente', label: 'Como descreve a vida social', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'dificuldadesSociais', sectionId: 'familia_ambiente', label: 'Dificuldades sociais percebidas', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'sonoSonho', sectionId: 'saude_rotina', label: 'Qualidade do sono', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'alimentacao', sectionId: 'saude_rotina', label: 'Alimentacao', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'exercicio', sectionId: 'saude_rotina', label: 'Atividade fisica', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'habitosNocivos', sectionId: 'saude_rotina', label: 'Habitos nocivos', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'previoTipo', sectionId: 'processos_previos', label: 'Tipo de tratamento anterior', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'previoDuracao', sectionId: 'processos_previos', label: 'Duracao do tratamento anterior', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'previoMotivo', sectionId: 'processos_previos', label: 'Motivo da consulta anterior', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'previoInterrupcao', sectionId: 'processos_previos', label: 'Motivo da interrupcao anterior', type: 'dissertativa', required: false, active: true, order: 4 }
  ];

  const childSections = [
    { id: 'escola', title: 'Escola e Aprendizagem', order: 10, active: true },
    { id: 'desenvolvimento', title: 'Desenvolvimento e Comportamento', order: 11, active: true },
    { id: 'saude_geral', title: 'Saude e Acompanhamentos', order: 12, active: true },
    { id: 'contexto_familiar', title: 'Contexto Familiar', order: 13, active: true }
  ];

  const childQuestions = [
    { id: 'nomeEscola', sectionId: 'escola', label: 'Nome da escola', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'tipoEscola', sectionId: 'escola', label: 'Tipo de escola', type: 'multipla_escolha', options: ['Publica', 'Privada', 'Mista'], required: false, active: true, order: 2 },
    { id: 'serie', sectionId: 'escola', label: 'Serie', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'desenvolvimentoGestacional', sectionId: 'desenvolvimento', label: 'Resumo do desenvolvimento gestacional', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'desenvolvimentoSocial', sectionId: 'desenvolvimento', label: 'Desenvolvimento social', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'estereotipias', sectionId: 'desenvolvimento', label: 'Estereotipias observadas', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'sensibilidades', sectionId: 'desenvolvimento', label: 'Sensibilidades sensoriais', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'dificuldadesHabilidades', sectionId: 'desenvolvimento', label: 'Dificuldades e habilidades', type: 'dissertativa', required: false, active: true, order: 5 },
    { id: 'temDiagnostico', sectionId: 'saude_geral', label: 'Ja possui diagnostico?', type: 'sim_nao', required: false, active: true, order: 1 },
    { id: 'diagnosticoQual', sectionId: 'saude_geral', label: 'Qual diagnostico', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'acompanhamentoMedico', sectionId: 'saude_geral', label: 'Acompanhamento medico atual', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'medicacaoAtual', sectionId: 'saude_geral', label: 'Medicacao atual', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'acompanhamentoMultidisciplinar', sectionId: 'saude_geral', label: 'Acompanhamento multidisciplinar', type: 'dissertativa', required: false, active: true, order: 5 },
    { id: 'nomeMae', sectionId: 'contexto_familiar', label: 'Nome da mae', type: 'dissertativa', required: false, active: true, order: 1 },
    { id: 'nomePaiBiologico', sectionId: 'contexto_familiar', label: 'Nome do pai', type: 'dissertativa', required: false, active: true, order: 2 },
    { id: 'irmaosIdade', sectionId: 'contexto_familiar', label: 'Irmaos e idades', type: 'dissertativa', required: false, active: true, order: 3 },
    { id: 'estadoCivilPais', sectionId: 'contexto_familiar', label: 'Estado civil dos pais', type: 'dissertativa', required: false, active: true, order: 4 },
    { id: 'pessoasMoramCrianca', sectionId: 'contexto_familiar', label: 'Quem mora com a crianca', type: 'dissertativa', required: false, active: true, order: 5 }
  ];

  return {
    version: 1,
    profiles: {
      adult: {
        sections: [...commonSections, ...adultSections],
        questions: [...commonQuestions, ...adultQuestions]
      },
      child: {
        sections: [...commonSections, ...childSections],
        questions: [...commonQuestions, ...childQuestions]
      }
    }
  };
}

function sanitizeAnamnesisTemplate(input: any) {
  const safeType = (value: any) => {
    const parsed = sanitizeString(value, 40);
    return ['dissertativa', 'multipla_escolha', 'multipla_selecao', 'data', 'numero', 'telefone', 'sim_nao'].includes(parsed)
      ? parsed
      : 'dissertativa';
  };

  const sanitizeSection = (section: any, fallbackOrder: number) => cleanObject({
    id: sanitizeString(section?.id, 120) || `section_${fallbackOrder}`,
    title: sanitizeString(section?.title, 220) || `Seção ${fallbackOrder}`,
    order: Number.isFinite(Number(section?.order)) ? Number(section?.order) : fallbackOrder,
    active: section?.active !== false
  });

  const sanitizeQuestion = (question: any, fallbackOrder: number) => {
    const type = safeType(question?.type);
    const options =
      type === 'multipla_escolha' || type === 'multipla_selecao'
        ? Array.isArray(question?.options)
          ? question.options.map((option: any) => sanitizeString(option, 120)).filter(Boolean).slice(0, 30)
          : []
        : undefined;
    return cleanObject({
      id: sanitizeString(question?.id, 120) || `q_${Date.now()}_${fallbackOrder}`,
      sectionId: sanitizeString(question?.sectionId, 120),
      label: sanitizeString(question?.label, 240),
      type,
      options,
      required: question?.required === true,
      active: question?.active !== false,
      order: Number.isFinite(Number(question?.order)) ? Number(question?.order) : fallbackOrder
    });
  };

  const sanitizeProfile = (profileInput: any, profileFallback: any) => {
    const sections = (Array.isArray(profileInput?.sections) ? profileInput.sections : profileFallback.sections)
      .slice(0, 120)
      .map((section: any, index: number) => sanitizeSection(section, index + 1))
      .filter((section: any) => section.id && section.title);
    const sectionIds = new Set(sections.map((section: any) => section.id));

    const questions = (Array.isArray(profileInput?.questions) ? profileInput.questions : profileFallback.questions)
      .slice(0, 1000)
      .map((question: any, index: number) => sanitizeQuestion(question, index + 1))
      .filter((question: any) => question.id && question.sectionId && sectionIds.has(question.sectionId) && question.label);

    return {
      sections: sections.sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0)),
      questions: questions.sort((a: any, b: any) => Number(a.order || 0) - Number(b.order || 0))
    };
  };

  const defaultTemplate = getDefaultAnamnesisTemplate();
  const legacyHidden = new Set(Array.isArray(input?.hiddenFields) ? input.hiddenFields.map((f: any) => sanitizeString(f, 120)) : []);
  const legacyDeleted = new Set(Array.isArray(input?.deletedFields) ? input.deletedFields.map((f: any) => sanitizeString(f, 120)) : []);
  const legacyCustom = Array.isArray(input?.customQuestions) ? input.customQuestions.slice(0, 300) : [];
  const looksLegacy = legacyHidden.size > 0 || legacyDeleted.size > 0 || legacyCustom.length > 0;

  const mergedInput = looksLegacy
    ? {
        ...defaultTemplate,
        profiles: {
          adult: {
            ...defaultTemplate.profiles.adult,
            questions: [
              ...defaultTemplate.profiles.adult.questions.map((question: any) => ({
                ...question,
                active: !(legacyHidden.has(question.id) || legacyDeleted.has(question.id))
              })),
              ...legacyCustom
                .filter((question: any) => ['both', 'adult', ''].includes(sanitizeString(question?.appliesTo, 20)))
                .map((question: any, index: number) => ({
                  id: sanitizeString(question?.id, 120) || `legacy_adult_${index + 1}`,
                  sectionId: 'personalizadas',
                  label: sanitizeString(question?.label, 240) || `Pergunta personalizada ${index + 1}`,
                  type: safeType(question?.type),
                  options: Array.isArray(question?.options) ? question.options : [],
                  required: question?.required === true,
                  active: question?.active !== false,
                  order: 900 + index
                }))
            ]
          },
          child: {
            ...defaultTemplate.profiles.child,
            questions: [
              ...defaultTemplate.profiles.child.questions.map((question: any) => ({
                ...question,
                active: !(legacyHidden.has(question.id) || legacyDeleted.has(question.id))
              })),
              ...legacyCustom
                .filter((question: any) => ['both', 'child', ''].includes(sanitizeString(question?.appliesTo, 20)))
                .map((question: any, index: number) => ({
                  id: sanitizeString(question?.id, 120) || `legacy_child_${index + 1}`,
                  sectionId: 'personalizadas',
                  label: sanitizeString(question?.label, 240) || `Pergunta personalizada ${index + 1}`,
                  type: safeType(question?.type),
                  options: Array.isArray(question?.options) ? question.options : [],
                  required: question?.required === true,
                  active: question?.active !== false,
                  order: 900 + index
                }))
            ]
          }
        }
      }
    : input;

  const version = Number.isFinite(Number(mergedInput?.version)) ? Math.max(1, Number(mergedInput.version)) : 1;
  const profileType = sanitizeString(mergedInput?.profileType, 20) === 'child' ? 'child' : 'adult';

  return {
    version,
    profileType,
    profiles: {
      adult: sanitizeProfile(mergedInput?.profiles?.adult, defaultTemplate.profiles.adult),
      child: sanitizeProfile(mergedInput?.profiles?.child, defaultTemplate.profiles.child)
    }
  };
}

function listAnamnesisTemplateChanges(previousTemplate: any, nextTemplate: any): string[] {
  const changes: string[] = [];
  const safePrev = sanitizeAnamnesisTemplate(previousTemplate || {});
  const safeNext = sanitizeAnamnesisTemplate(nextTemplate || {});

  (['adult', 'child'] as Array<'adult' | 'child'>).forEach((profileType) => {
    const prevProfile = safePrev.profiles?.[profileType];
    const nextProfile = safeNext.profiles?.[profileType];

    const prevSections = new Map((prevProfile?.sections || []).map((section: any) => [section.id, section]));
    const nextSections = new Map((nextProfile?.sections || []).map((section: any) => [section.id, section]));

    nextSections.forEach((section: any, sectionId: string) => {
      const prevSection = prevSections.get(sectionId);
      if (!prevSection) {
        changes.push(`[${profileType}] Seção criada: ${section.title}`);
        return;
      }
      if (prevSection.title !== section.title) {
        changes.push(`[${profileType}] Seção editada: ${prevSection.title} -> ${section.title}`);
      }
      if (prevSection.active !== section.active) {
        changes.push(`[${profileType}] Seção ${section.active ? 'reativada' : 'desativada'}: ${section.title}`);
      }
    });

    const prevQuestions = new Map((prevProfile?.questions || []).map((question: any) => [question.id, question]));
    const nextQuestions = new Map((nextProfile?.questions || []).map((question: any) => [question.id, question]));

    nextQuestions.forEach((question: any, questionId: string) => {
      const prevQuestion = prevQuestions.get(questionId);
      if (!prevQuestion) {
        changes.push(`[${profileType}] Pergunta criada: ${question.label}`);
        return;
      }
      if (prevQuestion.label !== question.label || prevQuestion.type !== question.type || prevQuestion.required !== question.required) {
        changes.push(`[${profileType}] Pergunta editada: ${question.label}`);
      }
      if (prevQuestion.active !== question.active) {
        changes.push(`[${profileType}] Pergunta ${question.active ? 'reativada' : 'desativada'}: ${question.label}`);
      }
    });
  });

  if (safePrev.version !== safeNext.version) {
    changes.push(`Publicação de versão da anamnese: v${safePrev.version} -> v${safeNext.version}`);
  }

  return Array.from(new Set(changes)).slice(0, 40);
}

function currentClinicId(user: any): string | null {
  const id = sanitizeString(
    user?.activeWorkspaceId || user?.clinicId || user?.clinic_id || user?.id,
    120
  );
  return id || null;
}

function hasGlobalClinicAccess(user: any): boolean {
  const role = sanitizeString(user?.role, 40).toLowerCase();
  return role === 'admin' || role === 'owner';
}

async function getClinicPatientIdsByEmail(clinicId: string, patientEmail: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('email', patientEmail)
    .limit(500);

  if (error) return [];
  return (data || [])
    .map((row: any) => sanitizeString(row?.id, 120))
    .filter((id: string) => isUuid(id));
}

async function getPatientIdsByEmailAcrossClinics(patientEmail: string): Promise<string[]> {
  const safeEmail = sanitizeEmail(patientEmail);
  if (!safeEmail) return [];
  const { data, error } = await supabase
    .from('patients')
    .select('id')
    .eq('email', safeEmail)
    .limit(1000);
  if (error) return [];
  return (data || [])
    .map((row: any) => sanitizeString(row?.id, 120))
    .filter((id: string) => isUuid(id));
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return UUID_REGEX.test(value);
}

function derivePatientNameFromLegacyId(rawId: string): string {
  const base = rawId
    .replace(/^mock-/i, '')
    .replace(/-\d+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) return 'Paciente';
  return base
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

async function resolvePatientIdForRequest(
  rawPatientId: string,
  user: any,
  options: { createIfMissing?: boolean; fallbackName?: string } = {}
): Promise<string | null> {
  const safeRaw = sanitizeString(rawPatientId, 120);
  if (!safeRaw) return null;
  if (isUuid(safeRaw)) return safeRaw;

  const clinicId = currentClinicId(user);
  if (!clinicId) return null;

  const guessedName = sanitizeString(options.fallbackName, 160) || derivePatientNameFromLegacyId(safeRaw);
  let { data: foundByName } = await supabase
    .from('patients')
    .select('id, name')
    .eq('clinic_id', clinicId)
    .ilike('name', guessedName)
    .limit(1)
    .maybeSingle();

  if (!foundByName && guessedName) {
    const relaxed = await supabase
      .from('patients')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .ilike('name', `%${guessedName}%`)
      .limit(1)
      .maybeSingle();
    foundByName = relaxed.data || null;
  }

  if (foundByName?.id) return sanitizeString(foundByName.id, 120);
  if (!options.createIfMissing) return null;

  const role = sanitizeString(user?.role, 40).toLowerCase();
  if (!['owner', 'admin', 'coordinator', 'receptionist', 'therapist'].includes(role)) return null;

  const insertPayload = {
    name: guessedName || 'Paciente',
    email: null,
    phone: null,
    age: null,
    diagnosis: null,
    status: 'active',
    clinic_id: clinicId,
    therapist_id: sanitizeString(user?.id, 120) || null,
    created_at: new Date().toISOString()
  };

  const { data: created, error: createError } = await supabase
    .from('patients')
    .insert([insertPayload])
    .select('id')
    .single();

  if (createError || !created?.id) return null;
  return sanitizeString(created.id, 120);
}

async function fetchUserWorkspaces(userId: string) {
  const { data, error } = await supabase
    .from('clinic_memberships')
    .select(`
      clinic_id,
      role,
      status,
      clinics:clinic_id (
        id,
        name,
        logo_url
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) {
    return [];
  }

  return (data || []).map((membership: any) => {
    const clinic = membership.clinics || {};
    return {
      clinicId: sanitizeString(clinic.id || membership.clinic_id, 120),
      clinicName: sanitizeString(clinic.name, 160) || 'Clinica',
      clinicLogoUrl: sanitizeSessionUrl(clinic.logo_url),
      role: ensureRole(membership.role) ? membership.role : 'therapist'
    };
  }).filter((w: any) => w.clinicId);
}

async function findAuthUserByEmail(email: string): Promise<any | null> {
  if (!supabase) return null;
  const target = sanitizeEmail(email);
  if (!target) return null;

  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users || [];
    const found = users.find((u: any) => sanitizeEmail(u.email) === target);
    if (found) return found;
    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break;
  }
  return null;
}

function compactClinicSettingsForSession(settings: any) {
  if (!settings || typeof settings !== 'object') return null;
  return cleanObject({
    clinicName: sanitizeString(settings.clinicName, 160) || null,
    clinicCnpj: sanitizeString(settings.clinicCnpj, 30) || null,
    clinicPhone: sanitizeString(settings.clinicPhone, 30) || null,
    specialty: sanitizeString(settings.specialty, 160) || null,
    council: sanitizeString(settings.council, 80) || null,
    councilNumber: sanitizeString(settings.councilNumber, 80) || null,
    clinicAddress: sanitizeString(settings.clinicAddress, 240) || null,
    clinicLogoUrl: sanitizeSessionUrl(settings.clinicLogoUrl),
    signatureDataUrl: sanitizeSessionUrl(settings.signatureDataUrl),
    therapistSpecialties: sanitizeString(settings.therapistSpecialties, 240) || null,
    therapistMiniCurriculum: sanitizeString(settings.therapistMiniCurriculum, 3000) || null,
    defaultSessionDuration: asSafeNumber(settings.defaultSessionDuration, 20, 240) || 50,
    workStart: sanitizeString(settings.workStart, 5) || '08:00',
    workEnd: sanitizeString(settings.workEnd, 5) || '18:00'
  });
}

function compactWorkspacesForSession(workspaces: any[]) {
  if (!Array.isArray(workspaces)) return [];
  return workspaces.slice(0, 30).map((w: any) => ({
    clinicId: sanitizeString(w?.clinicId, 120),
    clinicName: sanitizeString(w?.clinicName, 160) || 'Clinica',
    clinicLogoUrl: sanitizeSessionUrl(w?.clinicLogoUrl),
    role: ensureRole(w?.role) ? w.role : 'therapist'
  })).filter((w: any) => w.clinicId);
}

function resolveActiveWorkspaceId(
  workspaces: any[],
  preferredWorkspaceId?: string | null,
  fallbackClinicId?: string | null
): string | null {
  const compacted = compactWorkspacesForSession(workspaces);
  const preferred = sanitizeString(preferredWorkspaceId, 120);
  const fallback = sanitizeString(fallbackClinicId, 120);

  if (preferred && compacted.some((w: any) => w.clinicId === preferred)) {
    return preferred;
  }
  if (fallback && compacted.some((w: any) => w.clinicId === fallback)) {
    return fallback;
  }
  if (compacted.length === 1) return compacted[0].clinicId;
  return null;
}

function buildSessionUserPayload(input: any) {
  const workspaces = compactWorkspacesForSession(input?.workspaces || []);
  const activeWorkspaceId = resolveActiveWorkspaceId(
    workspaces,
    input?.activeWorkspaceId,
    input?.clinicId || input?.clinic_id
  );
  const selectedWorkspace = activeWorkspaceId
    ? workspaces.find((w: any) => w.clinicId === activeWorkspaceId) || null
    : null;
  const resolvedRole = selectedWorkspace?.role || input?.role;
  const mustSelectWorkspace = workspaces.length > 1 && !activeWorkspaceId;

  return {
    id: sanitizeString(input?.id, 120),
    email: sanitizeEmail(input?.email) || sanitizeString(input?.email, 320),
    role: ensureRole(resolvedRole) ? resolvedRole : 'therapist',
    name: sanitizeString(input?.name, 180),
    profilePicture: sanitizeSessionUrl(input?.profilePicture),
    type: sanitizeString(input?.type, 80) || null,
    age: typeof input?.age === 'number' ? input.age : null,
    subscriptionStatus: sanitizeString(input?.subscriptionStatus, 40) || null,
    planName: sanitizeString(input?.planName, 80) || null,
    planPrice: asSafeNumber(input?.planPrice, 0, 100000) || null,
    treatmentStatus: sanitizeString(input?.treatmentStatus, 40) || null,
    clinicId: selectedWorkspace?.clinicId || sanitizeString(input?.clinicId, 120) || null,
    activeWorkspaceId,
    mustSelectWorkspace,
    emailVerified: Boolean(input?.emailVerified),
    phoneVerified: Boolean(input?.phoneVerified),
    firstLoginCompleted: Boolean(input?.firstLoginCompleted),
    crp: sanitizeString(input?.crp || input?.clinicSettings?.councilNumber, 80) || null,
    signatureDataUrl:
      sanitizeSessionUrl(input?.signatureDataUrl) ||
      sanitizeSessionUrl(input?.clinicSettings?.signatureDataUrl) ||
      null,
    specialties:
      sanitizeString(input?.specialties || input?.clinicSettings?.therapistSpecialties || input?.clinicSettings?.specialty, 240) ||
      null,
    miniCurriculum:
      sanitizeString(input?.miniCurriculum || input?.clinicSettings?.therapistMiniCurriculum, 3000) ||
      null,
    clinicSettings: compactClinicSettingsForSession(input?.clinicSettings),
    workspaces
  };
}

async function derivePatientTreatmentStatus(user: any): Promise<'active' | 'inactive' | 'waiting_treatment'> {
  const role = sanitizeString(user?.role, 40).toLowerCase();
  if (role !== 'patient') return 'active';

  const safeEmail = sanitizeEmail(user?.email);
  const fallbackHasClinic = Boolean(sanitizeString(user?.clinicId || user?.activeWorkspaceId, 120));
  const hasWorkspace = Array.isArray(user?.workspaces) && user.workspaces.length > 0;
  if (hasWorkspace) return 'active';

  let patientRows: any[] = [];
  if (safeEmail) {
    const { data } = await supabase
      .from('patients')
      .select('id, clinic_id, status')
      .eq('email', safeEmail)
      .limit(1000);
    patientRows = Array.isArray(data) ? data : [];
  }

  const hasLinkedClinic = patientRows.some((row: any) => Boolean(sanitizeString(row?.clinic_id, 120))) || fallbackHasClinic;
  const hasActivePatientStatus = patientRows.some((row: any) => sanitizeString(row?.status, 40).toLowerCase() === 'active');
  const patientIds = patientRows
    .map((row: any) => sanitizeString(row?.id, 120))
    .filter((id: string) => isUuid(id));

  let hasAssignedTasks = false;
  if (patientIds.length > 0) {
    const { count } = await supabase
      .from('assigned_tasks')
      .select('id', { count: 'exact', head: true })
      .in('patient_id', patientIds);
    hasAssignedTasks = Number(count || 0) > 0;
  }
  if (!hasAssignedTasks && safeEmail) {
    const { count } = await supabase
      .from('assigned_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('patient_email', safeEmail);
    hasAssignedTasks = Number(count || 0) > 0;
  }

  if (hasActivePatientStatus || (hasLinkedClinic && hasAssignedTasks) || hasAssignedTasks) return 'active';
  if (hasLinkedClinic) return 'inactive';
  return 'waiting_treatment';
}

async function canAccessPatientInCurrentClinic(patientId: string, user: any): Promise<boolean> {
  if (!isUuid(patientId)) return false;
  if (hasGlobalClinicAccess(user)) return true;
  const clinicId = currentClinicId(user);
  if (!clinicId) return false;
  const { data, error } = await supabase
    .from('patients')
    .select('id')
    .eq('id', patientId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

async function updatePatientStatusIfNeeded(user: any): Promise<'active' | 'inactive' | 'waiting_treatment'> {
  const status = await derivePatientTreatmentStatus(user);
  if (sanitizeString(user?.role, 40).toLowerCase() !== 'patient' || !sanitizeString(user?.id, 120)) {
    return status;
  }
  try {
    const safeEmail = sanitizeEmail(user?.email);
    await supabase
      .from('users')
      .update({ status })
      .eq('id', sanitizeString(user.id, 120));
    if (status === 'active' && safeEmail) {
      await supabase
        .from('patients')
        .update({ status: 'active' })
        .eq('email', safeEmail)
        .in('status', ['pending', 'waiting_treatment', 'inactive']);
    }
  } catch (error) {
    console.warn('[Auth] Não foi possível atualizar status clínico do paciente:', (error as any)?.message || error);
  }
  return status;
}

async function ensureClinicAndMembershipForCoordinator(userId: string, clinicName?: string | null) {
  const safeClinicName = sanitizeString(clinicName, 160) || 'Minha Clinica';

  await supabase
    .from('clinics')
    .upsert([{
      id: userId,
      owner_user_id: userId,
      name: safeClinicName,
      created_at: new Date().toISOString()
    }], { onConflict: 'id' });

  await supabase
    .from('clinic_memberships')
    .upsert([{
      user_id: userId,
      clinic_id: userId,
      role: 'coordinator',
      status: 'active',
      created_at: new Date().toISOString()
    }], { onConflict: 'user_id,clinic_id' });
}

// Initialize Supabase Admin Client (using service role for backend access)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const supabasePublicClientKey = supabasePublishableKey || supabaseAnonKey;

function getProjectRefFromSupabaseUrl(url: string): string | null {
  try {
    const host = new URL(url).host.toLowerCase();
    if (!host.endsWith('.supabase.co')) return null;
    const ref = host.split('.')[0];
    return ref || null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function tokenMatchesCurrentProject(token: string): { ok: boolean; reason?: string } {
  const payload = decodeJwtPayload(token);
  const iss = String(payload?.iss || '');
  const refFromToken = (() => {
    const m = iss.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\/auth\/v1/i);
    return m?.[1]?.toLowerCase() || null;
  })();
  const refFromServer = getProjectRefFromSupabaseUrl(supabaseUrl)?.toLowerCase() || null;
  if (!refFromToken || !refFromServer) {
    return { ok: true };
  }
  if (refFromToken !== refFromServer) {
    return { ok: false, reason: `token_ref=${refFromToken}, server_ref=${refFromServer}` };
  }
  return { ok: true };
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("--- ERRO DE CONFIGURAÇÃO CRÍTICO ---");
  console.error("Data/Hora:", new Date().toISOString());
  console.error("NODE_ENV:", process.env.NODE_ENV);
  
  // Lista TODAS as chaves que começam com SUPABASE, VITE_ ou STRIPE (sem mostrar os valores)
  const relevantKeys = Object.keys(process.env).filter(k => 
    k.startsWith('SUPABASE') || 
    k.startsWith('VITE_') || 
    k.startsWith('STRIPE') ||
    k.startsWith('SESSION')
  );
  
  console.error("Variáveis de configuração detectadas no sistema:", relevantKeys.length > 0 ? relevantKeys.join(', ') : "NENHUMA");
  
  console.error("Detalhes específicos:");
  console.error("- SUPABASE_URL:", process.env.SUPABASE_URL ? "✅" : "❌");
  console.error("- SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅" : "❌");
  console.error("-------------------------------------");
  
  if (process.env.NODE_ENV === 'production') {
    console.error("O servidor não pode iniciar sem as credenciais do Supabase.");
    process.exit(1);
  }
}

// Only create client if we have the credentials to avoid crash
let supabase: any = null;
let supabaseAuthClient: any = null;
try {
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  if (supabaseUrl && supabasePublicClientKey) {
    supabaseAuthClient = createClient(supabaseUrl, supabasePublicClientKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  } else {
    console.warn("Supabase client NOT initialized due to missing credentials.");
  }
} catch (err: any) {
  console.error("Failed to create Supabase client:", err.message);
}

async function getUserFromAccessToken(accessToken: string) {
  if (!accessToken) return { user: null, error: 'Token ausente' };

  const clients = [supabase, supabaseAuthClient].filter(Boolean);
  let lastError = 'Falha ao validar token.';

  for (const client of clients) {
    try {
      const { data: { user }, error } = await client.auth.getUser(accessToken);
      if (!error && user) {
        return { user, error: null };
      }
      if (error?.message) {
        lastError = error.message;
      }
    } catch (err: any) {
      if (err?.message) {
        lastError = err.message;
      }
    }
  }

  return { user: null, error: lastError };
}

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("AVISO: STRIPE_SECRET_KEY não configurada. Pagamentos não funcionarão.");
}
if (!encryptionKey) {
  console.warn("AVISO: DATA_ENCRYPTION_KEY ausente/inválida. O endpoint de prontuário criptografado ficará desabilitado.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  const validateCoreDataTables = async () => {
    const tablesToProbe: Array<{ name: string; columns: string[] }> = [
      { name: 'tasks', columns: ['id', 'patient_id', 'therapist_id', 'created_at'] },
      { name: 'notes', columns: ['id', 'patient_id', 'therapist_id', 'created_at'] },
      { name: 'assigned_tasks', columns: ['id', 'patient_id', 'professional_id', 'status'] },
      { name: 'activity_logs', columns: ['id', 'user_id', 'timestamp'] }
    ];

    for (const table of tablesToProbe) {
      try {
        const { error } = await supabase
          .from(table.name)
          .select(table.columns.join(','))
          .limit(1);
        if (error) {
          logRouteDbError('startup/schema-check', error, { table: table.name, columns: table.columns });
        }
      } catch (error) {
        logRouteDbError('startup/schema-check', error, { table: table.name, columns: table.columns });
      }
    }
  };

  // Trust proxy is required for rate limiting and secure cookies behind Railway's load balancer
  app.set('trust proxy', true);
  void validateCoreDataTables();
  app.disable('x-powered-by');
  
  console.log('[Config] SESSION_SECRET defined:', !!process.env.SESSION_SECRET);
  console.log('[Config] SUPABASE_SERVICE_ROLE_KEY defined:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Security Headers (Helmet)
  const connectSrc = ["'self'", "https://*.supabase.co", "wss://*.supabase.co"];
  if (!isProd) {
    connectSrc.push("ws://localhost:*", "http://localhost:*");
  }

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://*.supabase.co", "https://*.googleusercontent.com", "https://www.gstatic.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc,
        frameSrc: ["'self'", "blob:", "data:", "https://*.supabase.co", "https://accounts.google.com", "https://*.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
  }));

  // Rate Limiting (Prevent Brute Force)
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Increased from 100 to 1000 to be more generous for complex SPAs
    message: { error: 'Muitas requisições. Tente novamente mais tarde.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    validate: false, // Disable all validation checks for proxy headers
  });

  const recoveryLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: {
      success: true,
      message: 'Se este contato estiver cadastrado, você receberá instruções.'
    }
  });

  // Stripe Webhook - MUST BE BEFORE express.json()
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      const stripe = getStripe();
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('STRIPE_WEBHOOK_SECRET is required');
      }
      event = stripe.webhooks.constructEvent(
        req.body,
        sig as string,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      const stripe = getStripe();
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = sanitizeString((session.metadata as any)?.userId, 120);
          const clinicId = sanitizeString((session.metadata as any)?.clinicId, 120);
          const flowType = sanitizeString((session.metadata as any)?.flowType, 80);
          const planNameFromMetadata = sanitizeString((session.metadata as any)?.planName, 80);
          const customerEmail = sanitizeEmail(session.customer_details?.email || session.customer_email);

          await updateClinicSubscriptionStatus({
            clinicId,
            userId,
            email: customerEmail,
            status: 'active'
          });

          const activePatientPriceId = resolveActivePatientPriceId();
          if (clinicId && activePatientPriceId) {
            queueActivePatientSync(clinicId, 'checkout.session.completed');
          }

          if (session.subscription) {
            try {
              const subscriptionId = sanitizeString(String(session.subscription), 120);
              if (subscriptionId) {
                await stripe.subscriptions.update(subscriptionId, {
                  metadata: {
                    ...(userId ? { userId } : {}),
                    ...(clinicId ? { clinicId } : {})
                  }
                });
              }
            } catch (metadataError: any) {
              console.error('[Stripe Webhook] Falha ao atualizar metadata da subscription:', {
                message: metadataError?.message || String(metadataError)
              });
            }
          }

          // Fluxo de onboarding profissional: ativação só após pagamento confirmado.
          if (flowType === 'professional_signup' && (userId || customerEmail)) {
            try {
              let effectiveUserId = userId;
              let effectiveEmail = customerEmail;
              let profile: any = null;

              if (effectiveUserId) {
                const { data: profileByUser } = await supabase
                  .from('users')
                  .select('id, email, name, role')
                  .eq('id', effectiveUserId)
                  .maybeSingle();
                profile = profileByUser || null;
              }

              if (!profile && effectiveEmail) {
                const { data: profileByEmail } = await supabase
                  .from('users')
                  .select('id, email, name, role')
                  .eq('email', effectiveEmail)
                  .maybeSingle();
                profile = profileByEmail || null;
              }

              if (profile?.id) {
                effectiveUserId = sanitizeString(profile.id, 120);
                effectiveEmail = sanitizeEmail(profile.email) || effectiveEmail;
                await supabase
                  .from('users')
                  .update({
                    subscription_status: 'active',
                    plan_name: normalizeProfessionalPlan(planNameFromMetadata) || undefined,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', effectiveUserId);
              }

              if (effectiveUserId) {
                const { data: authData, error: authError } = await supabase.auth.admin.getUserById(effectiveUserId);
                if (!authError) {
                  const authUser = authData?.user;
                  const isEmailConfirmed = Boolean((authUser as any)?.email_confirmed_at || (authUser as any)?.confirmed_at);
                  const authEmail = sanitizeEmail(authUser?.email);
                  const targetEmail = authEmail || effectiveEmail;

                  if (!isEmailConfirmed && targetEmail) {
                    const activationLink =
                      (await generateSupabaseActionLink({
                        type: 'signup',
                        email: targetEmail,
                        redirectTo: getAuthRedirectUrl()
                      })) || getAuthRedirectUrl();

                    const activationEmail = buildActivationEmailTemplate({
                      nome: sanitizeString(profile?.name || authUser?.user_metadata?.full_name || targetEmail.split('@')[0], 180),
                      link_ativacao: activationLink,
                      perfil: 'professional'
                    });

                    await sendTransactionalEmailSafe({
                      to: targetEmail,
                      subject: activationEmail.subject,
                      html: activationEmail.html,
                      context: 'professional_signup_after_payment',
                      from: OFFICIAL_FROM_CONTACT,
                      replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
                      templateKind: 'welcome_professional',
                      templateData: {
                        nome: sanitizeString(profile?.name || authUser?.user_metadata?.full_name || targetEmail.split('@')[0], 180),
                        link_ativacao: activationLink
                      },
                      metadata: {
                        userId: effectiveUserId,
                        email: maskEmail(targetEmail)
                      }
                    });
                  }
                }
              }
            } catch (postPaymentEmailError: any) {
              console.error('[Stripe Webhook] Falha ao enviar ativação pós-pagamento:', {
                message: postPaymentEmailError?.message || String(postPaymentEmailError)
              });
            }
          }
          break;
        }
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId = sanitizeString(String(invoice.subscription || ''), 120);
          const customerEmail = sanitizeEmail(invoice.customer_email);
          let clinicId = '';
          let userId = '';
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            clinicId = sanitizeString((subscription.metadata as any)?.clinicId, 120);
            userId = sanitizeString((subscription.metadata as any)?.userId, 120);
          }
          await updateClinicSubscriptionStatus({
            clinicId,
            userId,
            email: customerEmail,
            status: 'delinquent'
          });
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId = sanitizeString(String(invoice.subscription || ''), 120);
          const customerEmail = sanitizeEmail(invoice.customer_email);
          let clinicId = '';
          let userId = '';
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            clinicId = sanitizeString((subscription.metadata as any)?.clinicId, 120);
            userId = sanitizeString((subscription.metadata as any)?.userId, 120);
          }
          await updateClinicSubscriptionStatus({
            clinicId,
            userId,
            email: customerEmail,
            status: 'active'
          });
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const clinicId = sanitizeString((subscription.metadata as any)?.clinicId, 120);
          const userId = sanitizeString((subscription.metadata as any)?.userId, 120);
          const mappedStatus = normalizeSubscriptionStatusFromStripe(subscription.status);
          await updateClinicSubscriptionStatus({
            clinicId,
            userId,
            status: mappedStatus
          });
          break;
        }
        default:
          break;
      }
    } catch (webhookProcessingError: any) {
      console.error('[Stripe Webhook] Erro ao processar evento:', {
        type: event?.type,
        message: webhookProcessingError?.message || String(webhookProcessingError)
      });
    }

    res.json({ received: true });
  });

  app.use((req, res, next) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const expectsUtf8Body =
      contentType.includes('application/json') ||
      contentType.includes('application/x-www-form-urlencoded');
    if (!expectsUtf8Body) return next();

    const hasExplicitCharset = contentType.includes('charset=');
    if (hasExplicitCharset && !contentType.includes('charset=utf-8')) {
      return res.status(415).json({
        success: false,
        error: 'Charset inválido. Use UTF-8.'
      });
    }
    return next();
  });

  app.use(express.json({
    limit: '10mb',
    type: ['application/json', 'application/*+json']
  }));
  app.use(express.urlencoded({
    limit: '10mb',
    extended: true,
    type: 'application/x-www-form-urlencoded'
  }));
  app.use(cookieParser());

  // Database Session Store
  // Use PostgreSQL store in production if DATABASE_URL is available
  let sessionStore: any = undefined;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined' && process.env.DATABASE_URL !== '') {
    try {
      const dbUrl = process.env.DATABASE_URL.trim();
      
      // Basic validation to prevent TypeError: Invalid URL
      if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
        // Try parsing it to ensure it's a valid URL format for Node's URL constructor
        try {
          new URL(dbUrl);
        } catch (urlErr) {
          throw new Error(`Invalid DATABASE_URL format: ${dbUrl.substring(0, 20)}...`);
        }
        
        const { Pool } = pg;
        const pool = new Pool({ 
          connectionString: dbUrl,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000, // 5 seconds timeout
        });

        // Test the connection before using it for sessions
        try {
          console.log('Testing PostgreSQL connection for session store...');
          const client = await pool.connect();
          console.log('PostgreSQL connection successful.');
          client.release();

          const PostgresStore = pgSession(session);
          sessionStore = new PostgresStore({
            pool: pool,
            tableName: 'session',
            createTableIfMissing: true
          });
          console.log('Using PostgreSQL session store.');
        } catch (connErr: any) {
          console.error('Failed to connect to PostgreSQL for session store. Falling back to MemoryStore.', connErr.message);
          sessionStore = undefined;
          await pool.end().catch(() => {});
        }
      } else {
        console.warn('DATABASE_URL provided but is not a valid PostgreSQL connection string. Falling back to MemoryStore.');
      }
    } catch (err: any) {
      console.error('Error initializing PostgreSQL session store:', err.message);
      sessionStore = undefined; // Ensure fallback to MemoryStore
    }
  } else {
    console.log('Usando armazenamento de sessão em memória (MemoryStore).');
  }

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || (() => { throw new Error('SESSION_SECRET must be set'); })(),
    resave: false, 
    saveUninitialized: false, 
    rolling: true, 
    name: 'verto-session',
    proxy: true,
    cookie: { 
      secure: isProd,
      httpOnly: true,
      maxAge: 15 * 60 * 1000, 
      sameSite: 'lax'
    }
  }));

  // Auth Middleware
  const emailVerificationExemptPaths = new Set([
    '/auth/login',
    '/auth/logout',
    '/auth/me',
    '/auth/resend-confirmation',
    '/auth/password/recovery/email/request',
    '/auth/password/recovery/verify',
    '/auth/2fa/login',
    '/auth/config'
  ]);

  const mustBlockUnverifiedEmail = (req: any, user: any): boolean => {
    const path = sanitizeString(req.path, 240);
    if (!path) return false;
    if (emailVerificationExemptPaths.has(path)) return false;
    return user?.emailVerified === false;
  };

  const syncWorkspaceContextInSession = (req: any, _res: any, next: any) => {
    if (!req.session?.user) return next();
    req.session.user = buildSessionUserPayload(req.session.user);
    return next();
  };

  const checkAuth = async (req: any, res: any, next: any) => {
    // 1. Check Session (Cookie-based)
    if (req.session && req.session.user) {
      syncWorkspaceContextInSession(req, res, () => {});
      if (mustBlockUnverifiedEmail(req, req.session.user)) {
        return res.status(403).json({
          error: 'EMAIL_NOT_CONFIRMED',
          message: 'Confirme seu e-mail para acessar funcionalidades sensíveis.'
        });
      }
      return next();
    }

    // 2. Fallback: Check Authorization Header (Token-based)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const tokenMatch = tokenMatchesCurrentProject(token);
      if (!tokenMatch.ok) {
        console.error('[Auth] Project mismatch during checkAuth:', tokenMatch.reason);
        return res.status(401).json({
          error: 'AUTH_PROJECT_MISMATCH',
          message: 'Token emitido por outro projeto Supabase.'
        });
      }
      try {
        const { user, error } = await getUserFromAccessToken(token);
        if (!error && user) {
          // Re-populate session if missing but token is valid
          const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
          if (profile) {
            const workspaces = await fetchUserWorkspaces(user.id);
            const selectedWorkspace = workspaces.find((w: any) => w.clinicId === profile.clinic_id) || workspaces[0] || null;
            req.session.user = buildSessionUserPayload({
              id: user.id,
              email: user.email,
              role: selectedWorkspace?.role || profile.role,
              name: profile.name,
              profilePicture: sanitizeUrl(profile.profile_picture) || null,
              type: profile.type || user.user_metadata?.type || null,
              age: typeof profile.age === 'number' ? profile.age : null,
              subscriptionStatus: profile.subscription_status,
              planName: profile.plan_name,
              planPrice: profile.plan_price,
              clinicId: selectedWorkspace?.clinicId || profile.clinic_id,
              activeWorkspaceId: selectedWorkspace?.clinicId || profile.clinic_id,
              emailVerified: Boolean((user as any)?.email_confirmed_at || (user as any)?.confirmed_at),
              phoneVerified: Boolean((profile as any)?.phone_verified_at),
              firstLoginCompleted: profile.first_login_completed || user.user_metadata?.first_login_completed,
              crp: (profile as any)?.crp || null,
              signatureDataUrl: (profile as any)?.signatureDataUrl || (profile as any)?.signature_data_url || null,
              specialties: (profile as any)?.specialties || null,
              miniCurriculum: (profile as any)?.miniCurriculum || (profile as any)?.mini_curriculum || null,
              clinicSettings: user.user_metadata?.clinic_settings || null,
              workspaces
            });
            if (mustBlockUnverifiedEmail(req, req.session.user)) {
              return res.status(403).json({
                error: 'EMAIL_NOT_CONFIRMED',
                message: 'Confirme seu e-mail para acessar funcionalidades sensíveis.'
              });
            }
            return next();
          }
        }
      } catch (err) {
        console.error('[Auth] Token verification error:', err);
      }
    }

    console.warn(`[Auth] Unauthorized access attempt to ${req.path}`);
    res.status(401).json({ error: 'Unauthorized - No valid session or token' });
  };

  const persistActivityLog = async ({
    userId,
    clinicId,
    actorName,
    title,
    content,
    type = 'management',
    actionType,
    payloadDetails
  }: {
    userId: string;
    clinicId?: string | null;
    actorName?: string | null;
    title: string;
    content: string;
    type?: string;
    actionType?: string | null;
    payloadDetails?: string | null;
  }) => {
    try {
      const basePayload: any = {
        id: crypto.randomUUID(),
        user_id: sanitizeString(userId, 120),
        title: sanitizeString(title, 180),
        content: sanitizeString(content, 2000),
        type: sanitizeString(type, 40) || 'management',
        timestamp: new Date().toISOString()
      };

      const extendedPayload = {
        ...basePayload,
        clinic_id: sanitizeString(clinicId, 120) || null,
        actor_name: sanitizeString(actorName, 180) || null,
        action_type: sanitizeString(actionType || title, 180) || null,
        payload_details: sanitizeString(payloadDetails || content, 4000) || null
      };

      const insert = await supabase.from('activity_logs').insert([extendedPayload]);
      if (!insert.error) return;

      // Backward compatibility if clinic_id/actor_name columns don't exist yet.
      await supabase.from('activity_logs').insert([basePayload]);
    } catch (error) {
      console.warn('[ActivityLog] Failed to persist audit event:', String(error));
    }
  };

  const summarizePayloadForAudit = (input: any): string => {
    const redact = (value: any): any => {
      if (typeof value === 'string') {
        return value.length > 180 ? `${value.slice(0, 180)}...[truncated]` : value;
      }
      if (Array.isArray(value)) return value.slice(0, 20).map(redact);
      if (!value || typeof value !== 'object') return value;
      const output: Record<string, any> = {};
      for (const [key, nested] of Object.entries(value)) {
        if (/password|token|secret|key|authorization|cookie/i.test(key)) {
          output[key] = '[redacted]';
          continue;
        }
        output[key] = redact(nested);
      }
      return output;
    };
    try {
      return JSON.stringify(redact(input)).slice(0, 1200);
    } catch {
      return '';
    }
  };

  const mutationActionLabel = (method: string, path: string) => {
    const verb =
      method === 'POST' ? 'Criou' :
      method === 'PATCH' || method === 'PUT' ? 'Atualizou' :
      method === 'DELETE' ? 'Removeu' :
      'Alterou';
    const normalizedPath = sanitizeString(path.replace(/^\/api/i, ''), 220) || path;
    return `${verb} ${normalizedPath}`;
  };

  app.use('/api', (req: any, res: any, next: any) => {
    const method = String(req.method || '').toUpperCase();
    const shouldAuditMethod = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    const path = String(req.path || '');
    const isExcludedPath =
      path.startsWith('/logs') ||
      path.startsWith('/tasks') ||
      path.startsWith('/notes') ||
      path.startsWith('/stripe/webhook') ||
      path.startsWith('/health');
    if (!shouldAuditMethod || isExcludedPath) return next();

    const startedAt = Date.now();
    const requestPayload = summarizePayloadForAudit(req.body || {});
    res.on('finish', () => {
      try {
        const userId = sanitizeString(req.session?.user?.id, 120);
        if (!userId) return;
        const actorName = sanitizeString(req.session?.user?.name || req.session?.user?.email || 'Usuário', 180);
        const clinicId = sanitizeString(req.session?.user?.clinicId || req.session?.user?.id, 120);
        const statusCode = Number(res.statusCode || 0);
        const elapsedMs = Date.now() - startedAt;
        void persistActivityLog({
          userId,
          clinicId,
          actorName,
          title: mutationActionLabel(method, `/api${path}`),
          content: `HTTP ${statusCode} em ${elapsedMs}ms | payload=${requestPayload || '{}'}`,
          actionType: mutationActionLabel(method, `/api${path}`),
          payloadDetails: requestPayload || '{}',
          type: statusCode >= 400 ? 'system' : 'management'
        });
      } catch (auditError: any) {
        console.warn('[ActivityLog] Middleware audit failed:', auditError?.message || String(auditError));
      }
    });
    return next();
  });

  const persistIdentityAuditLog = async ({
    title,
    content,
    identifier,
    channel,
    userId,
    request,
    status
  }: {
    title: string;
    content: string;
    identifier?: string | null;
    channel?: string | null;
    userId?: string | null;
    request?: any;
    status?: string;
  }) => {
    const actorId = sanitizeString(userId || 'anonymous', 120) || 'anonymous';
    const actorName = sanitizeString(channel || 'identity', 80) || 'identity';
    const identifierHash = identifier ? hashIdentifier(identifier) : null;
    const ipRaw = request?.headers?.['x-forwarded-for'] || request?.ip || '';
    const ip = sanitizeString(Array.isArray(ipRaw) ? ipRaw[0] : String(ipRaw), 120) || 'unknown';
    const userAgent = sanitizeString(request?.headers?.['user-agent'] || '', 280);

    const detail = cleanObject({
      identifier_hash: identifierHash,
      status: sanitizeString(status, 40) || 'attempt',
      ip,
      user_agent: userAgent
    });

    await persistActivityLog({
      userId: actorId,
      clinicId: null,
      actorName,
      title: sanitizeString(title, 180),
      content: `${sanitizeString(content, 1200)} | detail=${JSON.stringify(detail)}`,
      type: 'security'
    });
  };

  app.use('/api', (req: any, res: any, next: any) => {
    const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
    const shouldAudit = isMutation &&
      req.path !== '/auth/login' &&
      req.path !== '/auth/logout' &&
      req.path !== '/auth/signup-direct' &&
      req.path !== '/auth/verify-2fa' &&
      req.path !== '/logs' &&
      req.path !== '/config';

    if (!shouldAudit) return next();

    const startedAt = Date.now();
    const actor = req.session?.user || null;
    const actorName = sanitizeString(actor?.name || actor?.email || 'Usuário', 180);
    const actorId = sanitizeString(actor?.id, 120);
    const clinicId = sanitizeString(actor?.clinicId || actor?.clinic_id || actor?.id, 120);

    res.on('finish', () => {
      if (!actorId) return;
      if (res.statusCode < 200 || res.statusCode >= 400) return;
      const pathSafe = sanitizeString(req.path, 180);
      const durationMs = Date.now() - startedAt;
      const action = req.method === 'POST' ? 'adição' : req.method === 'PATCH' ? 'edição' : req.method === 'DELETE' ? 'exclusão' : 'atualização';
      void persistActivityLog({
        userId: actorId,
        clinicId,
        actorName,
        title: `${action.toUpperCase()} registrada em ${pathSafe}`,
        content: `${actorName} realizou ${action} no endpoint ${pathSafe} em ${new Date().toLocaleString('pt-BR')} (${durationMs} ms).`,
        type: 'audit'
      });
    });

    return next();
  });

  // Ownership Middleware (IDOR Protection)
  const checkPatientAccess = async (req: any, res: any, next: any) => {
    const user = req.session.user;
    const rawPatientId = sanitizeString(req.params.patientId || req.body.patient_id, 120);

    if (!rawPatientId) return next();

    try {
      const resolvedPatientId = await resolvePatientIdForRequest(rawPatientId, user, { createIfMissing: false });
      req.resolvedPatientId = resolvedPatientId || rawPatientId;

      // Global backoffice bypass only
      if (hasGlobalClinicAccess(user)) return next();

      // Check if user is the patient themselves
      if (user.id === rawPatientId || (resolvedPatientId && user.id === resolvedPatientId)) return next();
      if (!resolvedPatientId) {
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      // Check if user is the therapist for this patient
      const { data: patient, error } = await supabase
        .from('patients')
        .select('therapist_id, clinic_id')
        .eq('id', resolvedPatientId)
        .single();

      if (error || !patient) {
        return res.status(404).json({ error: 'Paciente não encontrado' });
      }

      if (patient.therapist_id === user.id) {
        return next();
      }

      // If in the same clinic, allow access (for coordination)
      if (patient.clinic_id && patient.clinic_id === currentClinicId(user)) {
        return next();
      }

      return res.status(403).json({ error: 'Acesso negado a este prontuário' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
  };

  app.get('/api/config', (req, res) => {
    let url = process.env.SUPABASE_URL || "";
    if (url && !url.startsWith('http')) {
      url = `https://${url}`;
    }
    const publicKey =
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      "";

    if (!url || !publicKey) {
      return res.status(500).json({
        error: 'CONFIG_MISSING',
        message: 'Configuração de autenticação incompleta no servidor.'
      });
    }
    
    // Cache config for 1 minute to reduce server load
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    res.json({
      supabaseUrl: url,
      supabaseAnonKey: publicKey,
      projectRef: getProjectRefFromSupabaseUrl(url)
    });
  });

  // Apply rate limiter to all other API routes
  app.use('/api', limiter);

  // Basic CSRF mitigation for state-changing API routes.
  app.use('/api', (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    if (req.path === '/stripe/webhook') {
      return next();
    }

    const origin = req.headers.origin;
    if (!origin) return next();

    const expected = `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) {
      return res.status(403).json({ error: 'Origem inválida para operação sensível.' });
    }
    return next();
  });

  // --- HEALTH CHECK ---
  app.get('/api/health', async (req, res) => {
    const status: any = {
      supabase: 'unknown',
      stripe: 'unknown',
      env: {
        NODE_ENV: process.env.NODE_ENV,
        HAS_SUPABASE_URL: !!process.env.SUPABASE_URL,
        HAS_SUPABASE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        HAS_STRIPE_KEY: !!process.env.STRIPE_SECRET_KEY,
        HAS_DATABASE_URL: !!process.env.DATABASE_URL
      }
    };

    try {
      const { error } = await supabase.from('users').select('count', { count: 'exact', head: true });
      status.supabase = error ? `error: ${error.message}` : 'ok';
    } catch (err: any) {
      status.supabase = `exception: ${err.message}`;
    }

    try {
      const stripe = getStripe();
      status.stripe = 'ok';
    } catch (err: any) {
      status.stripe = `error: ${err.message}`;
    }

    res.json(status);
  });

  // --- API ROUTES ---
  
  // 2FA Setup - Generate Secret and QR Code
  app.post('/api/auth/2fa/setup', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Não autenticado" });
    
    const userEmail = req.session.user.email;
    const secret = generateSecret();
    const otpauth = generateURI({ issuer: 'Verto', label: userEmail, secret });
    
    try {
      const qrCodeUrl = await QRCode.toDataURL(otpauth);
      
      // Store secret temporarily in session (not enabled yet)
      req.session.temp2faSecret = secret;
      
      res.json({ secret, qrCodeUrl });
    } catch (err) {
      res.status(500).json({ error: "Erro ao gerar QR Code" });
    }
  });

  // 2FA Verify - Enable 2FA after first verification
  app.post('/api/auth/2fa/verify', async (req, res) => {
    if (!req.session.user || !req.session.temp2faSecret) {
      return res.status(401).json({ error: "Sessão inválida para setup de 2FA" });
    }
    
    const { token } = req.body;
    const result = verifySync({ token, secret: req.session.temp2faSecret });
    
    if (!result.valid) {
      return res.status(400).json({ error: "Código inválido" });
    }
    
    try {
      // Save secret to database and enable 2FA
      const { error } = await supabase
        .from('users')
        .update({ 
          two_factor_secret: req.session.temp2faSecret,
          two_factor_enabled: true 
        })
        .eq('id', req.session.user.id);
        
      if (error) throw error;
      
      delete req.session.temp2faSecret;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2FA Login Verification
  app.post('/api/auth/2fa/login', async (req, res) => {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ error: "E-mail e código são obrigatórios" });
    
    try {
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const user = users.find(u => sanitizeEmail(u.email) === sanitizeEmail(email));
      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
      const isEmailVerified = Boolean((user as any)?.email_confirmed_at || (user as any)?.confirmed_at);
      if (!isEmailVerified) {
        return res.status(403).json({
          error: 'EMAIL_NOT_CONFIRMED',
          message: 'Confirme seu e-mail antes de concluir o login.'
        });
      }
      
      const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
      if (!profile || !profile.two_factor_enabled || !profile.two_factor_secret) {
        return res.status(400).json({ error: "2FA não habilitado para este usuário" });
      }
      
      const result = verifySync({ token, secret: profile.two_factor_secret });
      if (!result.valid) return res.status(400).json({ error: 'Codigo invalido' });

      const workspaces = await fetchUserWorkspaces(user.id);
      const selectedWorkspace = workspaces.find((w: any) => w.clinicId === profile.clinic_id) || workspaces[0] || null;
      const roleForSession = selectedWorkspace?.role || profile.role;
      const clinicForSession = selectedWorkspace?.clinicId || profile.clinic_id;
      const treatmentStatus = await updatePatientStatusIfNeeded({
        id: user.id,
        role: roleForSession,
        clinicId: clinicForSession,
        activeWorkspaceId: clinicForSession,
        workspaces
      });

      // Complete login
      const userData = {
        id: user.id,
        email: user.email,
        role: roleForSession,
        name: profile.name,
        profilePicture: sanitizeUrl(profile.profile_picture) || null,
        type: profile.type || user.user_metadata?.type || null,
        age: typeof profile.age === 'number' ? profile.age : null,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        treatmentStatus,
        clinicId: clinicForSession,
        activeWorkspaceId: clinicForSession,
        emailVerified: isEmailVerified,
        phoneVerified: Boolean(profile.phone_verified_at),
        crp: (profile as any)?.crp || null,
        signatureDataUrl: (profile as any)?.signatureDataUrl || (profile as any)?.signature_data_url || null,
        specialties: (profile as any)?.specialties || null,
        miniCurriculum: (profile as any)?.miniCurriculum || (profile as any)?.mini_curriculum || null,
        clinicSettings: user.user_metadata?.clinic_settings || null,
        workspaces
      };

      if (roleForSession === 'patient') {
        void persistActivityLog({
          userId: sanitizeString(user.id, 120),
          clinicId: sanitizeString(clinicForSession || user.id, 120),
          actorName: sanitizeString(profile.name || user.email || 'Paciente', 180),
          title: 'Login de paciente (MFA)',
          content: `Acesso do paciente via MFA registrado com status ${treatmentStatus}.`,
          type: 'security'
        });
      }
      
      req.session.user = buildSessionUserPayload(userData);
      res.json({ success: true, user: userData });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const registerUserWithEmailConfirmation = async (
    payload: any,
    options: { deferActivationEmail?: boolean } = {}
  ) => {
    if (!supabaseAuthClient) {
      return {
        ok: false,
        status: 500,
        body: { error: 'AUTH_CONFIG_MISSING_PUBLIC_KEY' }
      };
    }
    if (!supabase) {
      return {
        ok: false,
        status: 500,
        body: { error: 'AUTH_CONFIG_MISSING_SERVICE_ROLE' }
      };
    }
    const safeEmail = sanitizeEmail(payload?.email);
    const rawPassword = typeof payload?.password === 'string' ? payload.password : '';
    const password = validateStrongPassword(rawPassword);
    const name = sanitizeString(payload?.name, 180);
    const role = sanitizeString(payload?.role, 40);
    const intendedRole = sanitizeString(payload?.intendedRole, 40);
    const planName = sanitizeString(payload?.planName, 80);
    const phone = sanitizePhoneE164(payload?.phone);
    const phoneMasked = phone ? maskPhone(phone) : null;

    if (!safeEmail || !password) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'E-mail válido e senha forte são obrigatórios (mín. 12 chars com maiúscula, minúscula, número e símbolo).'
        }
      };
    }

    const authRedirectTo = getAuthRedirectUrl();
    const existingAuthUser = await findAuthUserByEmail(safeEmail);
    if (existingAuthUser?.id) {
      return {
        ok: false,
        status: 400,
        body: { error: 'Este e-mail já está cadastrado. Por favor, faça login.' }
      };
    }

    const createUserRes = await supabase.auth.admin.createUser({
      email: safeEmail,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: name || safeEmail.split('@')[0]
      }
    });
    if (createUserRes.error) {
      const normalizedCreateError = String(createUserRes.error.message || '').toLowerCase();
      if (normalizedCreateError.includes('already')) {
        return {
          ok: false,
          status: 400,
          body: { error: 'Este e-mail já está cadastrado. Por favor, faça login.' }
        };
      }
      throw createUserRes.error;
    }
    let authUser = createUserRes.data?.user || null;
    if (!authUser?.id) {
      throw new Error('Falha ao criar usuário no Auth.');
    }

    let roleToUse: AppRole = normalizeRequestedRole(intendedRole || role);
    if (sanitizeString(role, 40).toLowerCase() === 'professional' && !intendedRole) {
      roleToUse = 'coordinator';
    }

    const planPrices: Record<string, number> = {
      'Essencial': 149.90,
      'Crescimento': 399.90,
      'Avançado': 679.90,
      'Paciente': 4.90
    };

    const normalizedPlanName = roleToUse === 'patient' ? 'Paciente' : normalizeProfessionalPlan(planName);
    const finalPlanPrice = normalizedPlanName ? (planPrices[normalizedPlanName] || null) : null;

    const newProfile = cleanObject({
      id: authUser.id,
      email: safeEmail,
      name: name || safeEmail.split('@')[0],
      role: roleToUse,
      clinic_id: roleToUse === 'coordinator' ? authUser.id : null,
      subscription_status: 'pending',
      plan_name: normalizedPlanName,
      plan_price: finalPlanPrice,
      phone: phone || null,
      phone_verified_at: null,
      created_at: new Date().toISOString()
    });

    const { error: insertError } = await supabase.from('users').upsert([newProfile], { onConflict: 'id' });
    if (insertError) {
      if (isMissingColumnError(insertError, 'phone_verified_at') || isMissingColumnError(insertError, 'phone')) {
        const fallbackProfile = cleanObject({
          id: authUser.id,
          email: safeEmail,
          name: name || safeEmail.split('@')[0],
          role: roleToUse,
          clinic_id: roleToUse === 'coordinator' ? authUser.id : null,
          subscription_status: 'pending',
          plan_name: normalizedPlanName,
          plan_price: finalPlanPrice,
          created_at: new Date().toISOString()
        });
        const { error: fallbackInsertError } = await supabase.from('users').upsert([fallbackProfile], { onConflict: 'id' });
        if (fallbackInsertError) throw fallbackInsertError;
      } else {
        throw insertError;
      }
    }

    if (roleToUse === 'coordinator') {
      await ensureClinicAndMembershipForCoordinator(authUser.id, name || null);
    }

    let activationEmailSent = false;
    if (!options.deferActivationEmail) {
      const activationLink =
        (await generateSupabaseActionLink({
          type: 'signup',
          email: safeEmail,
          redirectTo: authRedirectTo
        })) || authRedirectTo;
      const activationEmail = buildActivationEmailTemplate({
        nome: name || safeEmail.split('@')[0],
        link_ativacao: activationLink,
        perfil: resolveTemplateProfileByRole(roleToUse)
      });
      activationEmailSent = await sendTransactionalEmailSafe({
        to: safeEmail,
        subject: activationEmail.subject,
        html: activationEmail.html,
        context: 'signup_activation',
        from: roleToUse === 'patient' ? OFFICIAL_FROM_NOREPLY : OFFICIAL_FROM_CONTACT,
        replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
        templateKind: roleToUse === 'patient' ? 'welcome_patient' : 'welcome_professional',
        templateData: {
          nome: name || safeEmail.split('@')[0],
          link_ativacao: activationLink
        },
        metadata: {
          email: maskEmail(safeEmail),
          role: roleToUse
        }
      });
    }

    await persistIdentityAuditLog({
      title: 'Cadastro iniciado com confirmação de e-mail',
      content: options.deferActivationEmail
        ? `Cadastro de ${maskEmail(safeEmail)} iniciado em modo pendente de pagamento.${phoneMasked ? ` Telefone para validação: ${phoneMasked}.` : ''} E-mail de ativação será enviado após confirmação de pagamento.`
        : `Cadastro de ${maskEmail(safeEmail)} iniciado. Confirmação de e-mail pendente.${phoneMasked ? ` Telefone para validação: ${phoneMasked}.` : ''} E-mail oficial de ativação ${activationEmailSent ? 'enviado' : 'com falha de envio'}.`,
      identifier: safeEmail,
      channel: 'email',
      userId: authUser.id,
      status: options.deferActivationEmail ? 'pending' : activationEmailSent ? 'pending_confirmation' : 'warning'
    });

    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        userId: authUser.id,
        pendingEmailVerification: true,
        pendingPhoneVerification: false,
        message: options.deferActivationEmail
          ? 'Conta criada em modo pendente de pagamento. O e-mail de ativação será enviado após confirmação no Stripe.'
          : 'Conta criada. Enviamos um link de confirmação para seu e-mail. Confirme antes de acessar funcionalidades sensíveis.'
      }
    };
  };

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const result = await registerUserWithEmailConfirmation(req.body || {});
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      const payload = req.body || {};
      const safeEmail = sanitizeEmail(payload?.email);
      const safeRole = sanitizeString(payload?.role, 40);
      console.error('[Auth] Signup error (detailed):', {
        message: error?.message || String(error),
        code: error?.code || null,
        details: error?.details || null,
        hint: error?.hint || null,
        stack: error?.stack || null,
        env: {
          hasSupabaseUrl: !!process.env.SUPABASE_URL,
          hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          hasSupabaseAnonOrPublishable:
            !!process.env.SUPABASE_PUBLISHABLE_KEY ||
            !!process.env.SUPABASE_ANON_KEY ||
            !!process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
            !!process.env.VITE_SUPABASE_ANON_KEY
        },
        request: {
          email: safeEmail || null,
          role: safeRole || null
        }
      });
      return res.status(500).json({
        error: error?.message || 'Não foi possível iniciar o cadastro.'
      });
    }
  });

  // Backward compatibility endpoint (now secure and confirmation-based)
  app.post('/api/auth/signup-direct', async (req, res) => {
    try {
      const result = await registerUserWithEmailConfirmation(req.body || {});
      return res.status(result.status).json(result.body);
    } catch (error: any) {
      console.error('[Auth] signup-direct error:', error);
      return res.status(500).json({ error: 'Não foi possível iniciar o cadastro.' });
    }
  });

  app.get('/api/auth/config', (_req, res) => {
    try {
      res.json({
        success: true,
        authRedirectUrl: getAuthRedirectUrl(),
        recoveryRedirectUrl: getRecoveryRedirectUrl(),
        productionBaseUrl: sanitizeString(process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '', 500)
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || 'Configuração de Auth indisponível.' });
    }
  });

  app.post('/api/auth/resend-confirmation', async (req, res) => {
    try {
      const email = sanitizeEmail(req.body?.email);
      if (!email) return res.status(400).json({ error: 'E-mail inválido.' });
      const genericResponse = {
        success: true,
        message: 'Se este e-mail estiver cadastrado, você receberá instruções.'
      };

      const authUser = await findAuthUserByEmail(email);
      if (!authUser?.id) {
        await persistIdentityAuditLog({
          title: 'Reenvio de confirmação de e-mail solicitado',
          content: `Reenvio de confirmação solicitado para identificador não encontrado (${maskEmail(email)}).`,
          identifier: email,
          channel: 'email',
          request: req,
          status: 'not_found'
        });
        return res.json(genericResponse);
      }

      const { data: profile } = await supabase
        .from('users')
        .select('name, role')
        .eq('id', authUser.id)
        .maybeSingle();

      const activationLink =
        (await generateSupabaseActionLink({
          type: 'signup',
          email,
          redirectTo: getAuthRedirectUrl()
        })) || getAuthRedirectUrl();
      const activationEmail = buildActivationEmailTemplate({
        nome: sanitizeString(profile?.name || authUser.user_metadata?.full_name || email.split('@')[0], 180),
        link_ativacao: activationLink,
        perfil: resolveTemplateProfileByRole(profile?.role)
      });
      const emailSent = await sendTransactionalEmailSafe({
        to: email,
        subject: activationEmail.subject,
        html: activationEmail.html,
        context: 'resend_confirmation',
        from: resolveTemplateProfileByRole(profile?.role) === 'patient' ? OFFICIAL_FROM_NOREPLY : OFFICIAL_FROM_CONTACT,
        replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
        templateKind: resolveTemplateProfileByRole(profile?.role) === 'patient' ? 'welcome_patient' : 'welcome_professional',
        templateData: {
          nome: sanitizeString(profile?.name || authUser.user_metadata?.full_name || email.split('@')[0], 180),
          link_ativacao: activationLink
        },
        metadata: {
          email: maskEmail(email),
          userId: authUser.id
        }
      });

      await persistIdentityAuditLog({
        title: 'Reenvio de confirmação de e-mail solicitado',
        content: `Reenvio de confirmação para ${maskEmail(email)} solicitado. E-mail oficial ${emailSent ? 'enviado' : 'com falha de envio'}.`,
        identifier: email,
        channel: 'email',
        userId: authUser.id,
        request: req,
        status: emailSent ? 'sent' : 'warning'
      });

      return res.json(genericResponse);
    } catch (error) {
      return res.json({
        success: true,
        message: 'Se este e-mail estiver cadastrado, você receberá instruções.'
      });
    }
  });

  app.post('/api/auth/password/recovery/email/request', recoveryLimiter, async (req, res) => {
    const email = sanitizeEmail(req.body?.email);
    const genericResponse = {
      success: true,
      message: 'Se este e-mail estiver cadastrado, você receberá instruções.'
    };

    try {
      if (!email) return res.json(genericResponse);
      const authUser = await findAuthUserByEmail(email);
      if (!authUser?.id) {
        await persistIdentityAuditLog({
          title: 'Recuperação por e-mail solicitada',
          content: `Tentativa de recuperação por e-mail para identificador não encontrado (${maskEmail(email)}).`,
          identifier: email,
          channel: 'email',
          request: req,
          status: 'not_found'
        });
        return res.json(genericResponse);
      }

      const code = generate6DigitOtp();
      const key = makeOtpChallengeKey('email', 'password_recovery', email);
      setOtpChallenge({
        key,
        channel: 'email',
        purpose: 'password_recovery',
        identifier: email,
        userId: authUser.id,
        codeHash: hashIdentifier(code),
        expiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
        consumed: false,
        createdAt: Date.now()
      });

      const { data: profile } = await supabase
        .from('users')
        .select('name, role')
        .eq('id', authUser.id)
        .maybeSingle();
      const recoveryLink = await generateSupabaseActionLink({
        type: 'recovery',
        email,
        redirectTo: getRecoveryRedirectUrl()
      });
      const recoveryEmail = buildPasswordRecoveryEmailTemplate({
        nome: sanitizeString(profile?.name || authUser.user_metadata?.full_name || email.split('@')[0], 180),
        codigo: code,
        link_recuperacao: recoveryLink,
        expira_em_minutos: 15,
        perfil: resolveTemplateProfileByRole(profile?.role)
      });
      const recoveryEmailSent = await sendTransactionalEmailSafe({
        to: email,
        subject: recoveryEmail.subject,
        html: recoveryEmail.html,
        context: 'password_recovery_request',
        from: OFFICIAL_FROM_NOREPLY,
        replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
        templateKind: resolveTemplateProfileByRole(profile?.role) === 'patient' ? 'recovery_patient' : 'recovery_professional',
        templateData: {
          nome: sanitizeString(profile?.name || authUser.user_metadata?.full_name || email.split('@')[0], 180),
          codigo: code,
          link_recuperacao: recoveryLink || '',
          expira_em_minutos: 15
        },
        metadata: {
          email: maskEmail(email),
          userId: authUser.id
        }
      });

      await persistIdentityAuditLog({
        title: 'Recuperação por e-mail solicitada',
        content: `Código de recuperação gerado para ${maskEmail(email)}. E-mail oficial ${recoveryEmailSent ? 'enviado' : 'com falha de envio'}.`,
        identifier: email,
        channel: 'email',
        userId: authUser.id,
        request: req,
        status: recoveryEmailSent ? 'sent' : 'warning'
      });
      return res.json(genericResponse);
    } catch (error: any) {
      console.warn('[Auth] password recovery email request warning:', error.message);
      return res.json(genericResponse);
    }
  });

  app.post('/api/auth/password/recovery/verify', async (req, res) => {
    const channel: RecoveryChannel = 'email';
    const code = sanitizeString(req.body?.code, 12);
    const newPassword = validateStrongPassword(req.body?.newPassword);
    const mfaToken = sanitizeString(req.body?.mfaToken, 12);
    const genericError = { error: 'Código inválido ou expirado.' };
    const identifier = sanitizeEmail(req.body?.email);

    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ error: 'Dados inválidos para recuperação.' });
    }

    try {
      const key = makeOtpChallengeKey(channel, 'password_recovery', identifier);
      const challenge = getOtpChallenge(key);
      if (!challenge || challenge.consumed) {
        await persistIdentityAuditLog({
          title: 'Tentativa de verificação de recuperação inválida',
          content: `Código de recuperação inválido/expirado via ${channel}.`,
          identifier,
          channel,
          request: req,
          status: 'invalid'
        });
        return res.status(400).json(genericError);
      }

      challenge.attempts += 1;
      if (challenge.attempts > 5) {
        consumeOtpChallenge(key);
        await persistIdentityAuditLog({
          title: 'Recuperação bloqueada por tentativas excedidas',
          content: `Tentativas excedidas para recuperação por ${channel}.`,
          identifier,
          channel,
          userId: challenge.userId,
          request: req,
          status: 'blocked'
        });
        return res.status(429).json({ error: 'Muitas tentativas. Solicite um novo código.' });
      }

      const hash = hashIdentifier(code);
      if (hash !== challenge.codeHash || Date.now() > challenge.expiresAt) {
        setOtpChallenge(challenge);
        await persistIdentityAuditLog({
          title: 'Tentativa de verificação de recuperação inválida',
          content: `Código incorreto informado via ${channel}.`,
          identifier,
          channel,
          userId: challenge.userId,
          request: req,
          status: 'invalid_code'
        });
        return res.status(400).json(genericError);
      }

      if (!challenge.userId) {
        consumeOtpChallenge(key);
        return res.status(400).json(genericError);
      }

      const { data: profile } = await supabase
        .from('users')
        .select('id, two_factor_enabled, two_factor_secret')
        .eq('id', challenge.userId)
        .maybeSingle();

      if (profile?.two_factor_enabled) {
        if (!mfaToken) {
          await persistIdentityAuditLog({
            title: 'Recuperação bloqueada por MFA ausente',
            content: `Recuperação via ${channel} exigiu MFA e foi bloqueada.`,
            identifier,
            channel,
            userId: challenge.userId,
            request: req,
            status: 'mfa_required'
          });
          return res.status(401).json({ error: 'MFA_REQUIRED', message: 'Validação MFA obrigatória para concluir a recuperação.' });
        }
        const mfaResult = verifySync({ token: mfaToken, secret: profile.two_factor_secret });
        if (!mfaResult?.valid) {
          await persistIdentityAuditLog({
            title: 'Recuperação bloqueada por MFA inválido',
            content: `Token MFA inválido em recuperação via ${channel}.`,
            identifier,
            channel,
            userId: challenge.userId,
            request: req,
            status: 'mfa_invalid'
          });
          return res.status(401).json({ error: 'MFA_INVALID', message: 'Código MFA inválido.' });
        }
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(challenge.userId, {
        password: newPassword
      });
      if (updateError) throw updateError;

      consumeOtpChallenge(key);
      await persistIdentityAuditLog({
        title: 'Senha redefinida por recuperação',
        content: `Senha redefinida com sucesso via ${channel}.`,
        identifier,
        channel,
        userId: challenge.userId,
        request: req,
        status: 'success'
      });

      return res.json({ success: true, message: 'Senha redefinida com sucesso.' });
    } catch (error: any) {
      console.error('[Auth] recovery verify error:', error.message);
      return res.status(500).json({ error: 'Falha ao concluir recuperação.' });
    }
  });

  // --- AUTH ROUTES ---
  // Login (receives Supabase access token from client, verifies it, and sets session)
  app.post('/api/auth/login', async (req, res) => {
    const { intendedRole } = req.body;
    let accessToken = sanitizeString(req.body?.accessToken, 8000);
    const credentialEmail = sanitizeEmail(req.body?.email);
    const credentialPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const hasCredentials = Boolean(credentialEmail && credentialPassword);
    console.log('Login attempt with token:', !!accessToken, 'intendedRole:', intendedRole, 'hasCredentials:', hasCredentials);

    try {
      if ((!accessToken || !tokenMatchesCurrentProject(accessToken).ok) && hasCredentials) {
        if (!supabaseAuthClient) {
          return res.status(500).json({
            error: "AUTH_CONFIG_MISSING_PUBLIC_KEY",
            message: "Configuração de autenticação pública ausente no servidor."
          });
        }

        const { data: credData, error: credError } = await supabaseAuthClient.auth.signInWithPassword({
          email: credentialEmail as string,
          password: credentialPassword
        });

        if (credError || !credData?.session?.access_token) {
          return res.status(401).json({
            error: "INVALID_CREDENTIALS",
            message: "E-mail ou senha inválidos."
          });
        }

        accessToken = credData.session.access_token;
      }

      if (!accessToken) return res.status(400).json({ error: "Access token required" });

      const tokenMatch = tokenMatchesCurrentProject(accessToken);
      if (!tokenMatch.ok) {
        console.error('[Auth] Project mismatch in /api/auth/login:', tokenMatch.reason);
        return res.status(401).json({
          error: "AUTH_PROJECT_MISMATCH",
          message: "Token de autenticação não pertence a este ambiente."
        });
      }

      if (!supabase) {
        console.error('[Auth] Supabase client is missing. Cannot continue login.');
        return res.status(500).json({ error: "Erro de configuração no servidor (Supabase client not initialized)" });
      }

      // 1) Primary verification path (service-side).
      let { user, error } = await getUserFromAccessToken(accessToken);

      // 2) Fallback: verify token with public auth client (avoids hard dependency on service verification path).
      if ((error || !user) && supabaseAuthClient) {
        const publicUserRes = await supabaseAuthClient.auth.getUser(accessToken);
        if (!publicUserRes.error && publicUserRes.data?.user) {
          user = publicUserRes.data.user;
          error = null;
        }
      }

      // 3) Final fallback: if credentials exist, sign in server-side and use returned user/session.
      if ((error || !user) && hasCredentials) {
        console.warn('[Auth] Token verification failed. Retrying with server-side credentials sign-in...');

        if (!supabaseAuthClient) {
          return res.status(500).json({
            error: "AUTH_CONFIG_MISSING_PUBLIC_KEY",
            message: "Configuração de autenticação pública ausente no servidor."
          });
        }

        const { data: retryCredData, error: retryCredError } = await supabaseAuthClient.auth.signInWithPassword({
          email: credentialEmail as string,
          password: credentialPassword
        });

        if (!retryCredError && retryCredData?.session?.access_token && retryCredData?.user) {
          accessToken = retryCredData.session.access_token;
          user = retryCredData.user;
          error = null;
        }
      }

      if (error || !user) {
        console.error('[Auth] Supabase auth error during token verification:', error || 'No user found');
        return res.status(401).json({ error: "Sessão expirada ou inválida. Por favor, faça login novamente." });
      }

      console.log('[Auth] User verified successfully:', user.id, user.email);
      const isEmailVerified = Boolean((user as any)?.email_confirmed_at || (user as any)?.confirmed_at);
      if (!isEmailVerified) {
        await persistIdentityAuditLog({
          title: 'Tentativa de login com e-mail não confirmado',
          content: `Login bloqueado para ${maskEmail(sanitizeEmail(user.email) || '***')} por e-mail pendente de confirmação.`,
          identifier: sanitizeEmail(user.email) || null,
          channel: 'email',
          userId: sanitizeString(user.id, 120),
          request: req,
          status: 'blocked'
        });
        return res.status(403).json({
          error: 'EMAIL_NOT_CONFIRMED',
          message: 'Confirme seu e-mail para continuar.'
        });
      }

      // Fetch user profile from 'users' table
      let { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('Profile fetch error:', profileError);
        return res.status(500).json({ error: "Erro ao buscar perfil do usuário", details: profileError.message });
      }

      // Check for 2FA
      if (profile?.two_factor_enabled) {
        return res.json({ success: true, twoFactorRequired: true, email: user.email });
      }

      // If profile doesn't exist (first time Google login), create it
      if (!profile) {
        let finalRole: AppRole = normalizeRequestedRole(intendedRole);
        
        // Check for pending invitations for this email
        const { data: invitations, error: inviteError } = await supabase
          .from('invitations')
          .select('*')
          .eq('email', user.email)
          .eq('status', 'pending');

        let clinicId = (finalRole === 'coordinator' || finalRole === 'admin') ? user.id : null;

        if (!inviteError && invitations && invitations.length > 0) {
          const invitation = invitations[0];
          clinicId = invitation.clinic_id;
          finalRole = ensureRole(invitation.role) ? invitation.role : 'therapist';
          
          // Mark as accepted
          await supabase
            .from('invitations')
            .update({ status: 'accepted' })
            .eq('id', invitation.id);
        } else if (!intendedRole) {
          // If no invitation and no intended role, default to coordinator for new professional
          finalRole = 'coordinator';
          clinicId = user.id;
        }

        const newProfile = {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email?.split('@')[0],
          role: finalRole,
          clinic_id: clinicId,
          subscription_status: 'pending',
          plan_name: finalRole === 'patient' ? 'Paciente' : null,
          plan_price: finalRole === 'patient' ? 4.90 : null,
          created_at: new Date().toISOString()
        };

        const { data: createdProfile, error: insertError } = await supabase
          .from('users')
          .insert([newProfile])
          .select()
          .single();

        if (insertError) {
          console.error("Error creating profile during login:", insertError);
          throw insertError;
        }

        // Also update user metadata for onboarding tracking
        await supabase.auth.admin.updateUserById(user.id, {
          user_metadata: { first_login_completed: false }
        });

        if (finalRole === 'coordinator') {
          await ensureClinicAndMembershipForCoordinator(user.id, user.user_metadata?.full_name || null);
        } else if (clinicId && ensureClinicRole(finalRole)) {
          await supabase
            .from('clinic_memberships')
            .upsert([{
              user_id: user.id,
              clinic_id: clinicId,
              role: finalRole,
              status: 'active',
              created_at: new Date().toISOString()
            }], { onConflict: 'user_id,clinic_id' });
        }

        profile = createdProfile;
        req.session.isFirstLogin = true;
      }

      // Legacy compatibility: ensure coordinator always has clinic membership
      if (profile.role === 'coordinator') {
        await ensureClinicAndMembershipForCoordinator(user.id, profile.name || null);
      } else if (profile.clinic_id && ensureClinicRole(profile.role)) {
        await supabase
          .from('clinic_memberships')
          .upsert([{
            user_id: user.id,
            clinic_id: profile.clinic_id,
            role: profile.role,
            status: 'active',
            created_at: new Date().toISOString()
          }], { onConflict: 'user_id,clinic_id' });
      }

      let workspaces = await fetchUserWorkspaces(user.id);
      if (workspaces.length === 0 && user.email) {
        const { data: pendingInvite } = await supabase
          .from('invitations')
          .select('*')
          .eq('email', user.email)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (pendingInvite && ensureClinicRole(pendingInvite.role)) {
          await supabase
            .from('clinic_memberships')
            .upsert([{
              user_id: user.id,
              clinic_id: pendingInvite.clinic_id,
              role: pendingInvite.role,
              status: 'active',
              invited_by: pendingInvite.invited_by,
              created_at: new Date().toISOString()
            }], { onConflict: 'user_id,clinic_id' });

          await supabase
            .from('invitations')
            .update({ status: 'accepted' })
            .eq('id', pendingInvite.id);

          await supabase
            .from('users')
            .update({ clinic_id: pendingInvite.clinic_id, role: pendingInvite.role })
            .eq('id', user.id);

          profile.clinic_id = pendingInvite.clinic_id;
          profile.role = pendingInvite.role;
          workspaces = await fetchUserWorkspaces(user.id);
        }
      }
      const preferredWorkspaceId = sanitizeString(
        req.session?.user?.activeWorkspaceId || req.session?.user?.clinicId,
        120
      );
      const selectedWorkspace =
        workspaces.find((w: any) => w.clinicId === preferredWorkspaceId) ||
        workspaces.find((w: any) => w.clinicId === profile.clinic_id) ||
        workspaces[0] ||
        null;
      const roleForSession = selectedWorkspace?.role || profile.role;
      const clinicForSession = selectedWorkspace?.clinicId || profile.clinic_id;
      const treatmentStatus = await updatePatientStatusIfNeeded({
        id: user.id,
        role: roleForSession,
        clinicId: clinicForSession,
        activeWorkspaceId: clinicForSession,
        workspaces
      });

      const userData = {
        id: user.id,
        email: user.email,
        role: roleForSession,
        name: profile.name,
        profilePicture: sanitizeUrl(profile.profile_picture) || null,
        type: profile.type || user.user_metadata?.type || null,
        age: typeof profile.age === 'number' ? profile.age : null,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        treatmentStatus,
        clinicId: clinicForSession,
        activeWorkspaceId: clinicForSession,
        emailVerified: isEmailVerified,
        phoneVerified: Boolean(profile.phone_verified_at),
        firstLoginCompleted: profile.first_login_completed || user.user_metadata?.first_login_completed,
        crp: (profile as any)?.crp || null,
        signatureDataUrl: (profile as any)?.signatureDataUrl || (profile as any)?.signature_data_url || null,
        specialties: (profile as any)?.specialties || null,
        miniCurriculum: (profile as any)?.miniCurriculum || (profile as any)?.mini_curriculum || null,
        clinicSettings: user.user_metadata?.clinic_settings || null,
        workspaces
      };

      if (roleForSession === 'patient') {
        void persistActivityLog({
          userId: sanitizeString(user.id, 120),
          clinicId: sanitizeString(clinicForSession || user.id, 120),
          actorName: sanitizeString(profile.name || user.email || 'Paciente', 180),
          title: 'Login de paciente',
          content: `Acesso do paciente registrado com status ${treatmentStatus}.`,
          type: 'security'
        });
      }

      req.session.user = buildSessionUserPayload(userData);
      console.log(`[Auth] Saving session for ${user.email}. Session ID: ${req.sessionID}`);
      req.session.save((err) => {
        if (err) {
          console.error("Session save error in login:", err);
          if (!res.headersSent) {
            return res.status(500).json({ error: "Erro ao salvar sessão" });
          }
          return;
        }
        res.json({ success: true, user: userData, isFirstLogin: req.session.isFirstLogin });
        delete req.session.isFirstLogin;
      });
    } catch (error) {
      console.error("Login verification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Logout failed' });
      res.clearCookie('verto-session');
      res.json({ success: true });
    });
  });

  app.get('/api/auth/me', syncWorkspaceContextInSession, async (req: any, res: any) => {
    if (req.session.user) {
      return res.json({ user: req.session.user });
    }

    const authHeader = sanitizeString(req.headers?.authorization, 9000);
    if (authHeader && authHeader.startsWith('Bearer ')) {
      let didRespond = false;
      await checkAuth(req, {
        status: (code: number) => ({
          json: (payload: any) => {
            didRespond = true;
            if (code === 401) {
              return res.json({ user: null });
            }
            return res.status(code).json(payload);
          }
        })
      }, () => {});

      if (didRespond) return;
      if (req.session?.user) {
        req.session.user = buildSessionUserPayload(req.session.user);
        return res.json({ user: req.session.user });
      }
    }

    return res.json({ user: null });
  });

  app.get('/api/workspaces', checkAuth, async (req: any, res) => {
    try {
      const workspaces = await fetchUserWorkspaces(req.session.user.id);
      req.session.user = buildSessionUserPayload({
        ...req.session.user,
        workspaces,
      });
      res.json({ success: true, data: workspaces, user: req.session.user });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/workspaces/select', checkAuth, async (req: any, res) => {
    try {
      const clinicId = sanitizeString(req.body?.clinicId, 120);
      if (!clinicId) {
        return res.status(400).json({ success: false, error: 'clinicId obrigatorio' });
      }

      const workspaces = await fetchUserWorkspaces(req.session.user.id);
      const selected = workspaces.find((w: any) => w.clinicId === clinicId);
      if (!selected) {
        return res.status(403).json({ success: false, error: 'Workspace nao autorizado' });
      }

      await supabase
        .from('users')
        .update({
          clinic_id: clinicId,
          role: selected.role
        })
        .eq('id', req.session.user.id);

      req.session.user.clinicId = clinicId;
      req.session.user.activeWorkspaceId = clinicId;
      req.session.user.role = selected.role;
      req.session.user.workspaces = compactWorkspacesForSession(workspaces);
      req.session.user = buildSessionUserPayload(req.session.user);

      req.session.save((err: any) => {
        if (err) {
          return res.status(500).json({ success: false, error: 'Erro ao salvar sessao' });
        }
        res.json({ success: true, user: req.session.user });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Clinic Management & Invitations
  app.get('/api/clinic/members', checkAuth, async (req: any, res) => {
    const user = req.session.user;
    if (user.role !== 'coordinator' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas coordenadores podem gerenciar a equipe' });
    }

    try {
      const clinicId = currentClinicId(user);
      const { data, error } = await supabase
        .from('clinic_memberships')
        .select(`
          user_id,
          role,
          status,
          created_at,
          users:user_id (
            id,
            name,
            email
          )
        `)
        .eq('clinic_id', clinicId)
        .eq('status', 'active');
      
      if (error) throw error;

      const members = (data || []).map((m: any) => ({
        id: m.users?.id || m.user_id,
        name: m.users?.name || 'Profissional',
        email: m.users?.email || '',
        role: m.role,
        clinic_id: clinicId,
        created_at: m.created_at
      }));
      res.json({ success: true, data: members });
    } catch (error: any) {
      logRouteDbError('/api/notes/:patientId [GET]', error, { patientId: sanitizeString(req.params.patientId, 120) });
      res.status(500).json({ error: extractSupabaseErrorMessage(error) });
    }
  });

  app.post('/api/clinic/invite', checkAuth, async (req: any, res) => {
    try {
      const email = sanitizeEmail(req.body?.email);
      const roleRaw = sanitizeString(req.body?.role, 30);
      const role = ensureClinicRole(roleRaw) ? roleRaw : null;
      const requiredOnboardingFields = typeof req.body?.requiredOnboardingFields === 'object' && req.body?.requiredOnboardingFields
        ? req.body.requiredOnboardingFields
        : {};
      const user = req.session.user;

      if (user.role !== 'coordinator' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas coordenadores podem convidar membros' });
      }
      if (!email || !role) {
        return res.status(400).json({ error: 'Email e papel validos sao obrigatorios' });
      }

      const clinicId = currentClinicId(user);
      const { data: clinic } = await supabase
        .from('clinics')
        .select('name')
        .eq('id', clinicId)
        .maybeSingle();

      // Check for existing invitation
      const { data: existing } = await supabase
        .from('invitations')
        .select('*')
        .eq('email', email)
        .eq('clinic_id', clinicId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) {
        return res.status(400).json({ error: 'Já existe um convite pendente para este e-mail' });
      }

      const { data, error } = await supabase
        .from('invitations')
        .insert([{
          email,
          clinic_id: clinicId,
          clinic_name: sanitizeString(clinic?.name, 160) || sanitizeString(user.name, 160) || 'Clinica',
          role,
          required_onboarding_fields: requiredOnboardingFields,
          status: 'pending',
          invited_by: user.id,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      try {
        const { error: inviteEmailError } = await supabase.auth.admin.inviteUserByEmail(email, {
          data: {
            invited_role: role,
            clinic_id: clinicId,
            clinic_name: sanitizeString(clinic?.name, 160) || sanitizeString(user.name, 160) || 'Clinica'
          }
        });
        if (inviteEmailError) {
          console.warn('Falha no envio de convite por e-mail (Supabase Auth):', inviteEmailError.message);
        }
      } catch (inviteMailError) {
        console.warn('Nao foi possivel enviar e-mail de convite automatico:', inviteMailError);
      }
      res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/tasks/:patientId [GET]', error, { patientId: sanitizeString(req.params.patientId, 120) });
      res.status(500).json({ error: extractSupabaseErrorMessage(error) });
    }
  });

  app.get('/api/clinic/invitations', checkAuth, async (req: any, res) => {
    try {
      const user = req.session.user;
      const clinicId = currentClinicId(user);
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('status', 'pending');

      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/clinic/accept-invite', checkAuth, async (req: any, res) => {
    try {
      const { invitationId } = req.body;
      const user = req.session.user;

      const { data: invitation, error: fetchError } = await supabase
        .from('invitations')
        .select('*')
        .eq('id', invitationId)
        .single();

      if (fetchError || !invitation) {
        return res.status(404).json({ error: 'Convite não encontrado' });
      }

      if (invitation.email !== user.email) {
        return res.status(403).json({ error: 'Este convite não é para você' });
      }

      await supabase
        .from('clinic_memberships')
        .upsert([{
          user_id: user.id,
          clinic_id: invitation.clinic_id,
          role: invitation.role,
          status: 'active',
          invited_by: invitation.invited_by,
          created_at: new Date().toISOString()
        }], { onConflict: 'user_id,clinic_id' });

      const { error: updateError } = await supabase
        .from('users')
        .update({
          clinic_id: invitation.clinic_id,
          role: invitation.role
        })
        .eq('id', user.id);

      if (updateError) throw updateError;

      await supabase
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitationId);

      req.session.user.clinicId = invitation.clinic_id;
      req.session.user.activeWorkspaceId = invitation.clinic_id;
      req.session.user.role = invitation.role;
      req.session.user.workspaces = compactWorkspacesForSession(await fetchUserWorkspaces(user.id));
      req.session.user = buildSessionUserPayload(req.session.user);

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/clinic/assign-role', checkAuth, async (req: any, res) => {
    const adminUser = req.session.user;
    if (adminUser.role !== 'coordinator') {
      return res.status(403).json({ error: 'Apenas coordenadores podem atribuir papeis' });
    }

    const email = sanitizeEmail(req.body?.email);
    const roleRaw = sanitizeString(req.body?.role, 30);
    const role = ensureClinicRole(roleRaw) ? roleRaw : null;
    if (!email || !role) return res.status(400).json({ error: 'Email e papel sao obrigatorios' });

    try {
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (findError) throw findError;
      if (!targetUser) return res.status(404).json({ error: 'Usuario nao encontrado' });

      const clinicId = currentClinicId(adminUser);
      const { error: updateError } = await supabase
        .from('clinic_memberships')
        .upsert([{
          user_id: targetUser.id,
          clinic_id: clinicId,
          role,
          status: 'active',
          invited_by: adminUser.id,
          created_at: new Date().toISOString()
        }], { onConflict: 'user_id,clinic_id' });

      if (updateError) throw updateError;
      res.json({ success: true, message: `Papel ${role} atribuido com sucesso!` });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  app.patch('/api/clinic/members/:memberId/role', checkAuth, async (req: any, res) => {
    const adminUser = req.session.user;
    if (adminUser.role !== 'coordinator' && adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas coordenadores podem atualizar papeis' });
    }

    const { memberId } = req.params;
    const roleRaw = sanitizeString(req.body?.role, 30);
    const role = ensureClinicRole(roleRaw) ? roleRaw : null;

    if (!role) return res.status(400).json({ error: 'Papel e obrigatorio' });

    try {
      const clinicId = currentClinicId(adminUser);
      const { error } = await supabase
        .from('clinic_memberships')
        .update({ role })
        .eq('user_id', memberId)
        .eq('clinic_id', clinicId)
        .eq('status', 'active');

      if (error) throw error;
      res.json({ success: true, message: 'Papel atualizado com sucesso' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
  app.get('/api/clinic/anamnesis-template', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      const { data, error } = await supabase
        .from('clinic_anamnesis_templates')
        .select('template_json, updated_at')
        .eq('clinic_id', clinicId)
        .maybeSingle();

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('clinic_anamnesis_templates')) {
          return res.json({ success: true, data: getDefaultAnamnesisTemplate(), warning: 'Tabela de template não criada.' });
        }
        throw error;
      }

      const template = sanitizeAnamnesisTemplate(data?.template_json || {});
      return res.json({ success: true, data: { ...template, updatedAt: data?.updated_at || null } });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/clinic/anamnesis-template/defaults', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (_req: any, res) => {
    return res.json({ success: true, data: getDefaultAnamnesisTemplate() });
  });

  app.post('/api/clinic/anamnesis-template', checkAuth, requireRoles('coordinator', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);

      const previousResult = await supabase
        .from('clinic_anamnesis_templates')
        .select('template_json')
        .eq('clinic_id', clinicId)
        .maybeSingle();
      const previousTemplate = sanitizeAnamnesisTemplate(previousResult?.data?.template_json || getDefaultAnamnesisTemplate());
      const nextTemplate = sanitizeAnamnesisTemplate(req.body?.template || {});
      nextTemplate.version = Math.max(1, Number(previousTemplate?.version || 0) + 1);
      const templateChanges = listAnamnesisTemplateChanges(previousTemplate, nextTemplate);

      const payload = {
        clinic_id: clinicId,
        template_json: nextTemplate,
        updated_by: actorId,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('clinic_anamnesis_templates')
        .upsert([payload], { onConflict: 'clinic_id' });

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('clinic_anamnesis_templates')) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela clinic_anamnesis_templates não existe. Rode o SQL de foundation.'
          });
        }
        throw error;
      }

      if (actorId) {
        for (const item of templateChanges.length > 0 ? templateChanges : ['Template de anamnese publicado sem alterações detectadas.']) {
          void persistActivityLog({
            userId: actorId,
            clinicId,
            actorName,
            title: 'Template de anamnese atualizado',
            content: item,
            type: 'audit'
          });
        }
      }

      return res.json({ success: true, data: nextTemplate });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/clinic/state', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      const { data, error } = await supabase
        .from('clinic_state')
        .select('clinic_id, rooms, appointments, protocols, specialty_settings, updated_at')
        .eq('clinic_id', clinicId)
        .maybeSingle();

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('clinic_state')) {
          return res.json({
            success: true,
            data: {
              clinicId,
              rooms: [],
              appointments: [],
              protocols: [],
              specialtySettings: {},
              updatedAt: null
            },
            warning: 'Tabela clinic_state não criada.'
          });
        }
        throw error;
      }

      return res.json({
        success: true,
        data: {
          clinicId,
          rooms: Array.isArray(data?.rooms) ? data.rooms : [],
          appointments: Array.isArray(data?.appointments) ? data.appointments : [],
          protocols: Array.isArray(data?.protocols) ? data.protocols : [],
          specialtySettings: data?.specialty_settings && typeof data.specialty_settings === 'object' ? data.specialty_settings : {},
          updatedAt: data?.updated_at || null
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/clinic/state', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);

      const nextRooms = Array.isArray(req.body?.rooms) ? req.body.rooms.slice(0, 400) : undefined;
      const nextAppointments = Array.isArray(req.body?.appointments) ? req.body.appointments.slice(0, 5000) : undefined;
      const nextProtocols = Array.isArray(req.body?.protocols) ? req.body.protocols.slice(0, 600) : undefined;
      const nextSpecialtySettings =
        req.body?.specialtySettings && typeof req.body.specialtySettings === 'object'
          ? req.body.specialtySettings
          : undefined;

      if (
        nextRooms === undefined &&
        nextAppointments === undefined &&
        nextProtocols === undefined &&
        nextSpecialtySettings === undefined
      ) {
        return res.status(400).json({ success: false, error: 'Nenhum payload de estado enviado.' });
      }

      const previous = await supabase
        .from('clinic_state')
        .select('rooms, appointments, protocols, specialty_settings')
        .eq('clinic_id', clinicId)
        .maybeSingle();

      const payload = cleanObject({
        clinic_id: clinicId,
        rooms: nextRooms,
        appointments: nextAppointments,
        protocols: nextProtocols,
        specialty_settings: nextSpecialtySettings,
        updated_by: actorId,
        updated_at: new Date().toISOString()
      });

      const { data, error } = await supabase
        .from('clinic_state')
        .upsert([payload], { onConflict: 'clinic_id' })
        .select('clinic_id, rooms, appointments, protocols, specialty_settings, updated_at')
        .single();

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('clinic_state')) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela clinic_state não existe. Rode a migração de ativação do Supabase.'
          });
        }
        throw error;
      }

      const prevData = previous.data || {};
      if (nextRooms !== undefined && JSON.stringify(prevData.rooms || []) !== JSON.stringify(nextRooms)) {
        void persistActivityLog({
          userId: actorId,
          clinicId,
          actorName,
          title: 'Salas atualizadas',
          content: `${actorName} atualizou as salas da clínica (${Array.isArray(nextRooms) ? nextRooms.length : 0} itens).`,
          type: 'management'
        });
      }
      if (nextAppointments !== undefined && JSON.stringify(prevData.appointments || []) !== JSON.stringify(nextAppointments)) {
        void persistActivityLog({
          userId: actorId,
          clinicId,
          actorName,
          title: 'Agenda clínica atualizada',
          content: `${actorName} atualizou os agendamentos da clínica (${Array.isArray(nextAppointments) ? nextAppointments.length : 0} itens).`,
          type: 'management'
        });
      }
      if (nextProtocols !== undefined && JSON.stringify(prevData.protocols || []) !== JSON.stringify(nextProtocols)) {
        void persistActivityLog({
          userId: actorId,
          clinicId,
          actorName,
          title: 'Protocolos atualizados',
          content: `${actorName} atualizou os protocolos/PEIs da clínica (${Array.isArray(nextProtocols) ? nextProtocols.length : 0} itens).`,
          type: 'clinical'
        });
      }
      if (nextSpecialtySettings !== undefined && JSON.stringify(prevData.specialty_settings || {}) !== JSON.stringify(nextSpecialtySettings)) {
        void persistActivityLog({
          userId: actorId,
          clinicId,
          actorName,
          title: 'Configurações de duração de sessão atualizadas',
          content: `${actorName} atualizou as durações por abordagem/profissional.`,
          type: 'management'
        });
      }

      return res.json({
        success: true,
        data: {
          clinicId: data.clinic_id,
          rooms: Array.isArray(data.rooms) ? data.rooms : [],
          appointments: Array.isArray(data.appointments) ? data.appointments : [],
          protocols: Array.isArray(data.protocols) ? data.protocols : [],
          specialtySettings: data.specialty_settings && typeof data.specialty_settings === 'object' ? data.specialty_settings : {},
          updatedAt: data.updated_at || null
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/patient-anamnesis/:patientId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const rawPatientId = sanitizeString(req.params.patientId, 100);
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      const professionalId = sanitizeString(req.session.user?.id, 100);
      const patientId = await resolvePatientIdForRequest(rawPatientId, req.session.user, {
        createIfMissing: true,
        fallbackName: sanitizeString(req.body?.anamnesisData?.nome, 160) || sanitizeString(req.body?.anamnesisData?.name, 160)
      });
      const title = sanitizeString(req.body?.title, 220) || `Ficha_Anamnese_${rawPatientId}`;
      const referenceDate = sanitizeDate(req.body?.referenceDate) || new Date().toISOString().slice(0, 10);
      const templateVersion = asSafeNumber(req.body?.templateVersion, 1, 10_000);
      const profileType = sanitizeString(req.body?.profileType, 20) === 'child' ? 'child' : 'adult';
      const patientFileId = sanitizeString(req.body?.patientFileId, 120) || null;
      const anamnesisData = req.body?.anamnesisData && typeof req.body.anamnesisData === 'object' ? req.body.anamnesisData : {};

      if (!patientId || !clinicId || !professionalId) {
        return res.status(400).json({ success: false, error: 'Dados obrigatórios ausentes.' });
      }

      const payload = {
        patient_id: patientId,
        clinic_id: clinicId,
        professional_id: professionalId,
        title,
        reference_date: referenceDate,
        profile_type: profileType,
        template_version: templateVersion,
        anamnesis_data: anamnesisData,
        patient_file_id: patientFileId,
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('patient_anamnesis_submissions')
        .insert([payload])
        .select('*')
        .single();

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_anamnesis_submissions')) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela patient_anamnesis_submissions não existe. Rode a migração de ativação.'
          });
        }
        throw error;
      }

      void persistActivityLog({
        userId: professionalId,
        clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Ficha de anamnese arquivada',
        content: `${title} foi registrada para o paciente ${patientId} em ${referenceDate}.`,
        type: 'clinical'
      });

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/api/patient-anamnesis/:patientId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { data, error } = await supabase
        .from('patient_anamnesis_submissions')
        .select('*')
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_anamnesis_submissions')) {
          return res.json({ success: true, data: [], warning: 'Tabela patient_anamnesis_submissions não criada.' });
        }
        throw error;
      }

      return res.json({ success: true, data: data || [] });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Create Patient User Account (called by therapist when adding a patient)
  app.post('/api/patients/create-user', checkAuth, async (req: any, res) => {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
      const safeEmail = sanitizeEmail(email);
      const safeName = sanitizeString(name, 160) || String(safeEmail || email).split('@')[0];
      const safeClinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120);
      const safeProfessionalId = sanitizeString(req.session.user?.id, 120);
      const normalizedEmail = String(safeEmail || email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ success: false, error: 'Email inválido.' });
      }

      const upsertPatientProfile = async (authUserId: string) => {
        const profilePayload = cleanObject({
          id: authUserId,
          email: normalizedEmail,
          name: safeName,
          role: 'patient',
          subscription_status: 'pending',
          plan_price: 4.90,
          clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
          status: 'active',
          created_at: new Date().toISOString()
        });

        const { error: profileError } = await supabase
          .from('users')
          .upsert([profilePayload], { onConflict: 'id' });

        if (!profileError) return;

        const profileErrorMessage = String(profileError?.message || '');
        const isSchemaMismatch =
          profileErrorMessage.toLowerCase().includes('column') ||
          profileErrorMessage.toLowerCase().includes('schema');

        if (!isSchemaMismatch) {
          throw profileError;
        }

        const fallbackProfilePayload = cleanObject({
          id: authUserId,
          email: normalizedEmail,
          name: safeName,
          role: 'patient',
          clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
          status: 'active',
          created_at: new Date().toISOString()
        });

        const { error: fallbackProfileError } = await supabase
          .from('users')
          .upsert([fallbackProfilePayload], { onConflict: 'id' });

        if (fallbackProfileError) throw fallbackProfileError;
      };

      const ensurePatientLink = async (authUserId: string) => {
        const patientPayload = cleanObject({
          name: safeName,
          email: safeEmail,
          status: 'active',
          clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
          therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined,
          created_at: new Date().toISOString()
        });
        if (!patientPayload.email) return;

        let existingPatientQuery = supabase
          .from('patients')
          .select('id')
          .eq('email', patientPayload.email);
        if (patientPayload.clinic_id) {
          existingPatientQuery = existingPatientQuery.eq('clinic_id', patientPayload.clinic_id);
        }
        const { data: existingPatient } = await existingPatientQuery.limit(1).maybeSingle();

        if (existingPatient?.id) {
          await supabase
            .from('patients')
            .update({
              status: 'active',
              therapist_id: patientPayload.therapist_id || null
            })
            .eq('id', existingPatient.id);
        } else {
          await supabase.from('patients').insert([patientPayload]);
        }

        await supabase
          .from('users')
          .update({
            role: 'patient',
            clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
            status: 'active'
          })
          .eq('id', authUserId);
      };

      const sendPatientActivationEmailOrFail = async () => {
        const signupLink = await generateSupabaseActionLink({
          type: 'signup',
          email: normalizedEmail,
          redirectTo: getAuthRedirectUrl()
        });
        const fallbackRecoveryLink = signupLink
          ? null
          : await generateSupabaseActionLink({
              type: 'recovery',
              email: normalizedEmail,
              redirectTo: getRecoveryRedirectUrl()
            });
        const activationLink = signupLink || fallbackRecoveryLink;
        if (!activationLink) {
          throw new Error('Não foi possível gerar link de ativação do paciente.');
        }

        const activationEmail = buildActivationEmailTemplate({
          nome: safeName,
          link_ativacao: activationLink,
          perfil: 'patient'
        });

        const sent = await sendTransactionalEmailSafe({
          to: normalizedEmail,
          subject: activationEmail.subject,
          html: activationEmail.html,
          context: 'patient_create_user_activation',
          from: OFFICIAL_FROM_NOREPLY,
          replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
          templateKind: 'welcome_patient',
          templateData: {
            nome: safeName,
            link_ativacao: activationLink
          },
          metadata: {
            email: maskEmail(normalizedEmail),
            clinicId: isUuid(safeClinicId) ? safeClinicId : null
          }
        });

        if (!sent) {
          throw new Error('Error sending confirmation email');
        }
      };

      // 1. Check if user already exists in 'users' table
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('email', normalizedEmail)
        .limit(1)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingUser) {
        await ensurePatientLink(existingUser.id);
        await sendPatientActivationEmailOrFail();
        return res.json({
          success: true,
          message: 'Paciente vinculado e e-mail de ativação enviado.',
          userId: existingUser.id
        });
      }

      // 2. Create user in Supabase Auth (Admin API)
      // We generate a temporary password or let them use magic link/reset password
      const tempPassword = Math.random().toString(36).slice(-10) + 'Verto123!';
      
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: false,
        user_metadata: { full_name: safeName }
      });

      if (authError) {
        // If user already exists in Auth but not in our 'users' table (rare but possible)
        if (authError.message.includes('already registered')) {
          // Try to find the user by email in auth to get their ID
          const { data: listUsers, error: listError } = await supabase.auth.admin.listUsers();
          if (listError) throw listError;
          const foundUser = listUsers?.users.find(
            (u) => String(u.email || '').trim().toLowerCase() === normalizedEmail
          );
          if (foundUser) {
            await upsertPatientProfile(foundUser.id);
            await ensurePatientLink(foundUser.id);
            await sendPatientActivationEmailOrFail();
            return res.json({
              success: true,
              userId: foundUser.id,
              message: 'Paciente vinculado e e-mail de ativação enviado.'
            });
          }
        }
        throw authError;
      }

      if (authUser?.user) {
        await upsertPatientProfile(authUser.user.id);
        await ensurePatientLink(authUser.user.id);
        await sendPatientActivationEmailOrFail();

        return res.json({
          success: true,
          userId: authUser.user.id,
          tempPassword,
          message: 'Paciente criado e e-mail de ativação enviado.'
        });
      }

      res.status(500).json({ error: 'Failed to create user' });
    } catch (error) {
      console.error('Error creating patient user:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/storage/create-bucket', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req, res) => {
    const { bucketName } = req.body;
    if (!bucketName) return res.status(400).json({ error: 'Bucket name is required' });

    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;

      const exists = buckets.find(b => b.name === bucketName);
      if (exists) {
        return res.json({ success: true, message: 'Bucket already exists' });
      }

      // Create bucket
      const { data, error } = await supabase.storage.createBucket(bucketName, {
        public: false,
        fileSizeLimit: 5242880, // 5MB
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif']
      });

      if (error) throw error;
      res.json({ success: true, message: 'Bucket created successfully', data });
    } catch (error: any) {
      console.error(`Error creating bucket ${bucketName}:`, error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/storage/upload', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner', 'patient'), async (req: any, res) => {
    try {
      const bucketName = sanitizeString(req.body?.bucket, 80);
      const objectPath = sanitizeString(req.body?.path, 260);
      const contentType = sanitizeString(req.body?.contentType, 120) || 'application/octet-stream';
      const dataUrl = sanitizeString(req.body?.fileBase64, 8_000_000);

      if (bucketName !== 'patient-photos') {
        return res.status(400).json({ success: false, error: 'Bucket inválido para upload.' });
      }
      if (!objectPath || objectPath.includes('..')) {
        return res.status(400).json({ success: false, error: 'Path inválido.' });
      }
      if (!dataUrl) {
        return res.status(400).json({ success: false, error: 'Arquivo ausente.' });
      }

      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const base64Payload = matches?.[2] || dataUrl;
      const mimeFromDataUrl = matches?.[1] || contentType;
      const fileBuffer = Buffer.from(base64Payload, 'base64');

      if (!fileBuffer.length || fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'Arquivo inválido ou acima de 5MB.' });
      }

      const validation = validateBinaryUpload(fileBuffer, mimeFromDataUrl, 'image-only');
      if (!validation.ok) {
        return res.status(415).json({ success: false, error: validation.error });
      }

      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;

      const exists = (buckets || []).find((b: any) => b.name === bucketName);
      if (!exists) {
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: false,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
        });
        if (createError) throw createError;
      }

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(objectPath, fileBuffer, {
          cacheControl: '3600',
          upsert: true,
          contentType: validation.detectedMime
        });

      if (uploadError) throw uploadError;

      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(uploadData.path, 60 * 60 * 24 * 30);

      if (signedError) throw signedError;

      return res.json({
        success: true,
        url: signedData.signedUrl,
        path: uploadData.path
      });
    } catch (error: any) {
      console.error('Storage upload fallback error:', error);
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  // Patients
  app.get('/api/patients', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      let query = supabase.from('patients').select('*');
      const role = req.session.user.role as AppRole;

      if (role === 'coordinator' || role === 'receptionist') {
        if (req.session.user.clinicId) {
          query = query.eq('clinic_id', req.session.user.clinicId);
        }
      } else if (role === 'therapist') {
        query = query.eq('therapist_id', req.session.user.id);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase patients fetch error:', JSON.stringify(error));
        throw error;
      }
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Patients route error:', JSON.stringify(error));
      res.status(500).json({ error: error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error)) });
    }
  });

  app.post('/api/patients', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const safeName = sanitizeString(req.body?.name || req.body?.nome, 160);
      const safeClinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      const safeTherapistId = sanitizeString(req.body?.therapist_id || req.session.user?.id, 100);
      const safeBody = cleanObject({
        id: isUuid(sanitizeString(req.body?.id, 120)) ? sanitizeString(req.body?.id, 120) : undefined,
        name: safeName,
        email: sanitizeEmail(req.body?.email),
        phone: sanitizePhone(req.body?.phone || req.body?.telefone),
        age: asSafeNumber(req.body?.age, 0, 130),
        diagnosis: sanitizeString(req.body?.diagnosis, 2000),
        status: sanitizeString(req.body?.status, 40) || undefined,
        clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
        therapist_id: isUuid(safeTherapistId) ? safeTherapistId : undefined,
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!safeBody.name) {
        return res.status(400).json({ error: 'Nome do paciente é obrigatório.' });
      }

      let { data, error } = await supabase
        .from('patients')
        .upsert([safeBody], { onConflict: 'id' })
        .select()
        .single();

      // Fallback defensivo para bases legadas com colunas divergentes (evita 500 no cadastro).
      if (error) {
        const fallbackRow = cleanObject({
          id: safeBody.id,
          name: safeBody.name,
          email: safeBody.email,
          phone: safeBody.phone,
          age: safeBody.age,
          diagnosis: safeBody.diagnosis
        });

        const fallbackResult = await supabase
          .from('patients')
          .upsert([fallbackRow], { onConflict: 'id' })
          .select()
          .single();

        data = fallbackResult.data;
        error = fallbackResult.error;
      }
      
      if (error) throw error;
      const clinicForSync = sanitizeString(
        (data as any)?.clinic_id || safeBody.clinic_id || currentClinicId(req.session.user),
        120
      );
      if (isUuid(clinicForSync)) {
        queueActivePatientSync(clinicForSync, 'patient_upsert');
      }
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Paciente cadastrado/atualizado',
        content: `Paciente ${safeBody.name} (${data?.id || safeBody.id || 'sem-id'}) foi salvo no sistema.`,
        type: 'management'
      });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.patch('/api/patients/:id', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const canChangeClinic = hasGlobalClinicAccess(req.session.user);
      const updates = cleanObject({
        name: req.body?.name !== undefined ? sanitizeString(req.body?.name, 160) : undefined,
        email: req.body?.email !== undefined ? sanitizeEmail(req.body?.email) : undefined,
        phone: req.body?.phone !== undefined ? sanitizePhone(req.body?.phone) : undefined,
        age: req.body?.age !== undefined ? asSafeNumber(req.body?.age, 0, 130) : undefined,
        diagnosis: req.body?.diagnosis !== undefined ? sanitizeString(req.body?.diagnosis, 2000) : undefined,
        clinic_id: canChangeClinic && req.body?.clinic_id !== undefined ? sanitizeString(req.body?.clinic_id, 100) : undefined,
        status: req.body?.status !== undefined ? sanitizeString(req.body?.status, 40) : undefined
      });

      const { data: updatedPatient, error } = await supabase
        .from('patients')
        .update(updates)
        .eq('id', req.params.id)
        .select('id, clinic_id, status, email')
        .maybeSingle();
      
      if (error) throw error;
      const clinicForSync = sanitizeString(
        updates?.clinic_id || updatedPatient?.clinic_id || currentClinicId(req.session.user),
        120
      );
      if (isUuid(clinicForSync)) {
        queueActivePatientSync(clinicForSync, 'patient_patch');
      }

      const patientEmail = sanitizeEmail(updatedPatient?.email);
      if (patientEmail) {
        const nextPatientStatus = sanitizeString(
          updates?.status !== undefined ? updates.status : updatedPatient?.status,
          40
        ).toLowerCase();
        const hasClinicLink = Boolean(sanitizeString(updatedPatient?.clinic_id, 120));
        const mappedUserStatus =
          nextPatientStatus === 'inactive' || !hasClinicLink
            ? 'waiting_treatment'
            : nextPatientStatus || 'active';

        await supabase
          .from('users')
          .update({
            status: mappedUserStatus,
            clinic_id: hasClinicLink ? sanitizeString(updatedPatient?.clinic_id, 120) : null,
            updated_at: new Date().toISOString()
          })
          .eq('email', patientEmail)
          .eq('role', 'patient');
      }

      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Cadastro de paciente atualizado',
        content: `Paciente ${sanitizeString(req.params.id, 120)} teve dados cadastrais atualizados.`,
        type: 'management'
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Secure patient record storage (encrypted JSON payload)
  app.post('/api/patient-records/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 512 * 1024, 'Payload do prontuário')) return;
      const rawPatientId = sanitizeString(req.params.patientId, 100);
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      if (!clinicId) return res.status(400).json({ error: 'clinicId inválido' });
      const patientId = await resolvePatientIdForRequest(rawPatientId, req.session.user, {
        createIfMissing: true,
        fallbackName: sanitizeString(req.body?.payload?.nome, 160) || sanitizeString(req.body?.payload?.name, 160)
      });
      if (!patientId) return res.status(400).json({ error: 'patientId inválido' });

      const payloadRaw = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
      const payload = sanitizeClinicalPayload(payloadRaw);
      let existingQuery = supabase
        .from('patient_records')
        .select('payload_encrypted')
        .eq('patient_id', patientId);
      if (!hasGlobalClinicAccess(req.session.user)) {
        existingQuery = existingQuery.eq('clinic_id', clinicId);
      }
      const { data: existingRow } = await existingQuery.maybeSingle();
      const existingEncryptedPayload = String(existingRow?.payload_encrypted || '').trim();
      const existingPayload = decryptJsonPayload(existingEncryptedPayload) || {};
      if (existingEncryptedPayload && !existingPayload) {
        console.error('[PatientRecords] Bloqueando overwrite: payload existente não pôde ser descriptografado.', {
          patientId,
          clinicId,
          actorId: sanitizeString(req.session.user?.id, 120)
        });
        return res.status(409).json({
          success: false,
          error: 'Não foi possível descriptografar o prontuário existente com a chave atual. Nenhum dado foi sobrescrito.'
        });
      }
      const mergedPayload = sanitizeClinicalPayload(cleanObject({
        ...existingPayload,
        ...payload
      })) || {};

      const encrypted = encryptJsonPayload(mergedPayload);
      const pseudonymSeed = [
        sanitizeString(mergedPayload?.cpf, 30),
        sanitizeString(mergedPayload?.email, 320),
        sanitizePhone(mergedPayload?.telefone) || ''
      ].filter(Boolean).join('|') || patientId;

      const row = cleanObject({
        patient_id: patientId,
        clinic_id: clinicId,
        therapist_id: sanitizeString(req.session.user?.id, 100),
        pseudonym_id: `pt_${pseudonymizeValue(pseudonymSeed)}`,
        payload_encrypted: encrypted || null,
        payload_preview: cleanObject({
          nome: sanitizeString(mergedPayload?.nome, 120),
          nomeSocial: sanitizeString(mergedPayload?.nomeSocial, 120),
          grupo: sanitizeString(mergedPayload?.grupo, 60),
          convenioNome: sanitizeString(mergedPayload?.convenioNome, 120)
        }),
        updated_at: new Date().toISOString()
      });

      const { error } = await supabase
        .from('patient_records')
        .upsert([row], { onConflict: 'patient_id' });

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_records')) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela patient_records ainda não existe. Execute o SQL de segurança para persistência criptografada.'
          });
        }
        throw error;
      }

      const actorId = sanitizeString(req.session.user?.id, 120);
      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);
      const clinicAuditId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120);
      const hasFilesPayload = Array.isArray(mergedPayload?.files);
      const hasAnamnesisPayload = Boolean(mergedPayload?.template_version || mergedPayload?.anamnesisTemplateVersion || mergedPayload?.anamnese);
      const filesCount = hasFilesPayload ? mergedPayload.files.length : 0;
      if (actorId) {
        if (hasAnamnesisPayload) {
          void persistActivityLog({
            userId: actorId,
            clinicId: clinicAuditId,
            actorName,
            title: 'Ficha de anamnese registrada',
            content: `${actorName} registrou/atualizou a ficha de anamnese do paciente ${patientId} em ${new Date().toLocaleString('pt-BR')}.`,
            type: 'clinical'
          });
        }
        if (hasFilesPayload) {
          void persistActivityLog({
            userId: actorId,
            clinicId: clinicAuditId,
            actorName,
            title: 'Arquivos do prontuário atualizados',
            content: `${actorName} atualizou os arquivos do paciente ${patientId}. Total de arquivos armazenados: ${filesCount}.`,
            type: 'clinical'
          });
        }
      }

      res.json({ success: true, encrypted: !!encrypted });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/patient-files/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      if (!patientId) return res.status(400).json({ success: false, error: 'patientId inválido.' });
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });

      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      const { data, error } = await supabase
        .from('patient_files')
        .select('id, patient_id, clinic_id, file_name, storage_path, mime_type, file_size_bytes, source, created_at, metadata')
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false });

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_files')) {
          return res.status(200).json({ success: true, data: [], warning: 'Tabela patient_files não criada.' });
        }
        throw error;
      }

      const withUrls: any[] = [];
      for (const row of data || []) {
        const { data: signed, error: signedError } = await supabase.storage
          .from('patient-files-private')
          .createSignedUrl(row.storage_path, 60 * 10);
        if (signedError) {
          console.warn('[PatientFiles] Falha ao assinar URL:', signedError.message);
        }
        withUrls.push({
          id: row.id,
          patientId: row.patient_id,
          fileName: row.file_name,
          path: row.storage_path,
          mimeType: row.mime_type,
          sizeBytes: row.file_size_bytes,
          source: row.source || 'upload',
          createdAt: row.created_at,
          metadata: row.metadata || {},
          signedUrl: signed?.signedUrl || null
        });
      }

      return res.json({ success: true, data: withUrls });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post('/api/patient-files/:patientId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const isMultipart = String(req.headers?.['content-type'] || '').toLowerCase().includes('multipart/form-data');
      const multipart = isMultipart ? await parseMultipartFormData(req) : null;
      const multipartFields = multipart?.fields || {};
      const multipartFile = multipart?.file;

      const rawPatientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      const uploadedBy = sanitizeString(req.session.user?.id, 120);
      const rawName =
        sanitizeString(multipartFile?.fileName || multipartFields.fileName || req.body?.fileName, 220) ||
        `arquivo_${Date.now()}`;
      const safeName = rawName.replace(/[^\w.\-() ]+/g, '_').slice(0, 220);
      const source = sanitizeString(multipartFields.source || req.body?.source, 40) || 'upload';
      const contentType = sanitizeString(
        multipartFile?.contentType || multipartFields.contentType || req.body?.contentType,
        120
      ) || 'application/octet-stream';
      const dataUrl = sanitizeString(req.body?.fileBase64, 20_000_000);
      const metadataRaw = multipartFields.metadata || req.body?.metadata;
      const metadata =
        typeof metadataRaw === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(metadataRaw);
                return parsed && typeof parsed === 'object' ? parsed : {};
              } catch {
                return {};
              }
            })()
          : metadataRaw && typeof metadataRaw === 'object'
            ? metadataRaw
            : {};

      const patientId = await resolvePatientIdForRequest(rawPatientId, req.session.user, {
        createIfMissing: true,
        fallbackName: sanitizeString(req.body?.metadata?.patientName, 160)
      });

      if (!patientId || !clinicId || !uploadedBy) {
        return res.status(400).json({ success: false, error: 'Dados obrigatórios ausentes.' });
      }
      if (!dataUrl && !multipartFile?.buffer?.length) {
        return res.status(400).json({ success: false, error: 'Arquivo ausente.' });
      }

      const matches = dataUrl ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
      const base64Payload = matches?.[2] || dataUrl;
      const mimeFromDataUrl = matches?.[1] || contentType;
      const fileBuffer =
        multipartFile?.buffer?.length
          ? multipartFile.buffer
          : Buffer.from(String(base64Payload || ''), 'base64');
      if (!fileBuffer.length || fileBuffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, error: 'Arquivo inválido ou acima de 10MB.' });
      }

      const uploadContext: UploadContext = source === 'anamnesis' ? 'anamnesis-document' : 'image-or-pdf';
      const validation = validateBinaryUpload(fileBuffer, mimeFromDataUrl, uploadContext);
      let resolvedMime: DetectedUploadMime | null = validation.ok ? validation.detectedMime : null;
      if (!resolvedMime && uploadContext === 'anamnesis-document') {
        const normalizedProvidedMime = normalizeMime(mimeFromDataUrl);
        const lowerFileName = safeName.toLowerCase();
        const utf8Probe = fileBuffer.subarray(0, Math.min(fileBuffer.length, 4096)).toString('utf8').trim().toLowerCase();

        if (
          normalizedProvidedMime === 'application/octet-stream' ||
          normalizedProvidedMime === 'text/html' ||
          normalizedProvidedMime === 'application/pdf'
        ) {
          if (lowerFileName.endsWith('.pdf')) {
            resolvedMime = 'application/pdf';
          } else if (
            lowerFileName.endsWith('.html') ||
            lowerFileName.endsWith('.htm') ||
            utf8Probe.startsWith('<!doctype html') ||
            utf8Probe.startsWith('<html') ||
            utf8Probe.includes('<body')
          ) {
            resolvedMime = 'text/html';
          }
        }
      }
      if (!resolvedMime) {
        return res.status(415).json({ success: false, error: validation.ok ? 'Formato de arquivo inválido.' : validation.error });
      }

      const bucketName = 'patient-files-private';
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;
      const exists = (buckets || []).find((b: any) => b.name === bucketName);
      if (!exists) {
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: false,
          fileSizeLimit: 10 * 1024 * 1024
        });
        if (createError) throw createError;
      }

      const storagePath = `${clinicId}/${patientId}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(storagePath, fileBuffer, {
          cacheControl: '3600',
          upsert: false,
          contentType: resolvedMime
        });
      if (uploadError) throw uploadError;

      const insertPayload = {
        patient_id: patientId,
        clinic_id: clinicId,
        uploaded_by: uploadedBy,
        file_name: safeName,
        storage_path: storagePath,
        mime_type: resolvedMime,
        file_size_bytes: fileBuffer.length,
        source,
        metadata
      };

      const { data: inserted, error: insertError } = await supabase
        .from('patient_files')
        .insert([insertPayload])
        .select('*')
        .single();

      if (insertError) {
        if (String(insertError?.message || '').toLowerCase().includes('patient_files')) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela patient_files não existe. Rode a migração de arquivos.'
          });
        }
        throw insertError;
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(storagePath, 60 * 10);
      if (signedError) throw signedError;

      try {
        void persistActivityLog({
          userId: uploadedBy,
          clinicId,
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
          title: 'Arquivo salvo no prontuário',
          content: `${safeName} foi salvo na pasta segura do paciente ${patientId}.`,
          type: 'clinical'
        });
      } catch (logError: any) {
        console.warn('[PatientFiles] Falha ao registrar log de auditoria (não bloqueante):', logError?.message || String(logError));
      }

      return res.json({
        success: true,
        data: {
          id: inserted.id,
          patientId: inserted.patient_id,
          fileName: inserted.file_name,
          path: inserted.storage_path,
          mimeType: inserted.mime_type,
          sizeBytes: inserted.file_size_bytes,
          source: inserted.source || 'upload',
          createdAt: inserted.created_at,
          metadata: inserted.metadata || {},
          signedUrl: signedData.signedUrl
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.delete('/api/patient-files/:patientId/:fileId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'admin', 'owner'), async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const fileId = sanitizeString(req.params.fileId, 120);
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      if (!patientId || !fileId || !clinicId) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos.' });
      }
      if (!isUuid(patientId)) return res.status(404).json({ success: false, error: 'Paciente não encontrado.' });

      const { data: existing, error: existingError } = await supabase
        .from('patient_files')
        .select('id, storage_path, file_name')
        .eq('id', fileId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });

      const { error: removeStorageError } = await supabase.storage
        .from('patient-files-private')
        .remove([existing.storage_path]);
      if (removeStorageError) {
        console.warn('[PatientFiles] Falha ao remover do storage:', removeStorageError.message);
      }

      const { error: deleteRowError } = await supabase
        .from('patient_files')
        .delete()
        .eq('id', fileId)
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId);
      if (deleteRowError) throw deleteRowError;

      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId,
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Arquivo removido do prontuário',
        content: `${existing.file_name} foi removido da pasta segura do paciente ${patientId}.`,
        type: 'clinical'
      });

      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.get('/api/patient-records/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100);
      if (!patientId) return res.status(400).json({ error: 'patientId inválido' });
      if (!isUuid(patientId)) return res.json({ success: true, data: null });
      if (!clinicId && !hasGlobalClinicAccess(req.session.user)) {
        return res.status(400).json({ error: 'clinicId inválido' });
      }

      let query = supabase
        .from('patient_records')
        .select('patient_id, pseudonym_id, payload_encrypted, payload_preview, updated_at')
        .eq('patient_id', patientId);
      if (!hasGlobalClinicAccess(req.session.user)) {
        query = query.eq('clinic_id', clinicId);
      }
      const { data, error } = await query.maybeSingle();

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_records')) {
          return res.status(200).json({ success: true, data: null, warning: 'Tabela patient_records não encontrada.' });
        }
        throw error;
      }

      const encryptedPayload = String(data?.payload_encrypted || '').trim();
      const decryptedPayload = decryptJsonPayload(encryptedPayload);
      if (encryptedPayload && !decryptedPayload) {
        console.error('[PatientRecords] Falha de descriptografia ao consultar prontuário.', {
          patientId,
          clinicId,
          actorId: sanitizeString(req.session.user?.id, 120)
        });
      }
      res.json({
        success: true,
        data: data
          ? {
              patientId: data.patient_id,
              pseudonymId: data.pseudonym_id,
              payload: decryptedPayload,
              payloadPreview: data.payload_preview,
              updatedAt: data.updated_at,
              decryptionError: Boolean(encryptedPayload && !decryptedPayload)
            }
          : null
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Notes
  app.get('/api/notes/:patientId', checkAuth, checkPatientAccess, async (req, res) => {
    try {
      const patientId = sanitizeString((req as any).resolvedPatientId || req.params.patientId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const role = sanitizeString((req as any).session?.user?.role, 40).toLowerCase();
      const { data: patientRow } = await supabase
        .from('patients')
        .select('email')
        .eq('id', patientId)
        .maybeSingle();
      const patientEmail = sanitizeEmail(patientRow?.email);

      let query = supabase
        .from('notes')
        .select('*')
        .eq('patient_id', patientId);
      if (role === 'patient') {
        query = query.in('visibility', ['patient', 'shared', 'family']);
      }
      const { data: notesById, error: notesByIdError } = await query.order('created_at', { ascending: false });
      if (notesByIdError) throw notesByIdError;

      let notesByEmail: any[] = [];
      if (patientEmail) {
        let emailQuery = supabase
          .from('notes')
          .select('*')
          .eq('patient_email', patientEmail)
          .neq('patient_id', patientId);

        // Em novo vínculo entre clínicas, só compartilhamos notas marcadas como compartilháveis.
        emailQuery = emailQuery.in('visibility', ['shared', 'family', 'patient']);
        if (role === 'patient') {
          emailQuery = emailQuery.in('visibility', ['patient', 'shared', 'family']);
        }

        const { data: notesByEmailData, error: notesByEmailError } = await emailQuery.order('created_at', { ascending: false });
        if (notesByEmailError) throw notesByEmailError;
        notesByEmail = Array.isArray(notesByEmailData) ? notesByEmailData : [];
      }

      const merged = [...(Array.isArray(notesById) ? notesById : []), ...notesByEmail];
      const deduped = Array.from(new Map(merged.map((item: any) => [String(item?.id || crypto.randomUUID()), item])).values())
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      res.json({ success: true, data: deduped });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/notes/email/:email', checkAuth, async (req: any, res) => {
    try {
      const safeEmail = sanitizeEmail(req.params.email);
      if (!safeEmail) return res.status(400).json({ error: 'E-mail inválido.' });
      const userRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const isPrivileged = ['therapist', 'coordinator', 'receptionist', 'admin', 'owner'].includes(userRole);
      const isSelfRequest = sanitizeEmail(req.session.user?.email) === safeEmail;

      // Only allow if searching for own email OR if therapist
      if (!isPrivileged && !isSelfRequest) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      let query = supabase
        .from('notes')
        .select('*')
        .eq('patient_email', safeEmail)
        .order('created_at', { ascending: false });

      if (!hasGlobalClinicAccess(req.session.user) && isPrivileged) {
        const clinicId = currentClinicId(req.session.user);
        if (!clinicId) return res.status(403).json({ error: 'Clínica não identificada.' });
        const clinicPatientIds = await getClinicPatientIdsByEmail(clinicId, safeEmail);
        if (clinicPatientIds.length === 0) return res.json({ success: true, data: [] });
        query = query.in('patient_id', clinicPatientIds);
      }
      
      if (!isPrivileged && isSelfRequest) {
        query = query.in('visibility', ['patient', 'shared', 'family']);
      }

      const { data, error } = await query;
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/notes', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'patient', 'admin', 'owner'), async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 64 * 1024, 'Payload de anotações')) return;
      const resolvedPatientId = await resolvePatientIdForRequest(
        sanitizeString(req.body?.patient_id, 120),
        req.session.user,
        { createIfMissing: true, fallbackName: sanitizeString(req.body?.patient_name, 160) }
      );
      const safeVisibility = new Set(['private', 'shared', 'family', 'professional', 'patient']);
      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email),
        text: sanitizeTextField(req.body?.text, 12000),
        visibility: safeVisibility.has(String(req.body?.visibility)) ? String(req.body?.visibility) : 'private',
        subject: sanitizeTextField(req.body?.subject, 100) || 'Geral',
        original_id: sanitizeString(req.body?.original_id, 120) || undefined,
        therapist_id: sanitizeString(req.session.user.id, 120),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!payload.patient_id || !payload.text) {
        return res.status(400).json({ error: 'patient_id e texto são obrigatórios.' });
      }
      if (!isUuid(payload.patient_id)) {
        return res.status(400).json({ error: 'patient_id inválido para salvar anotações.' });
      }

      const { data, error } = await supabase
        .from('notes')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      try {
        await persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
          title: 'Nota registrada no prontuário',
          content: `Nota salva para paciente ${payload.patient_id}. Visibilidade: ${payload.visibility || 'privada'}.`,
          type: 'clinical'
        });
      } catch (logError) {
        logRouteDbError('/api/notes', logError, { phase: 'persistActivityLog' });
      }
      res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/notes', error, {
        patient_id: sanitizeString(req.body?.patient_id, 120),
        has_text: Boolean(sanitizeTextField(req.body?.text, 12000))
      });
      if (isMissingRelationError(error)) {
        return res.status(503).json({
          error: 'Estrutura de banco para notes indisponível. Verifique migrações em produção.',
          details: extractSupabaseErrorMessage(error)
        });
      }
      res.status(500).json({ error: extractSupabaseErrorMessage(error) });
    }
  });

  // History
  app.get('/api/history/:patientId', checkAuth, checkPatientAccess, async (req, res) => {
    try {
      const patientId = sanitizeString((req as any).resolvedPatientId || req.params.patientId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { data: patientRow } = await supabase
        .from('patients')
        .select('email')
        .eq('id', patientId)
        .maybeSingle();
      const patientEmail = sanitizeEmail(patientRow?.email);

      const { data: historyById, error: historyByIdError } = await supabase
        .from('history')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (historyByIdError) throw historyByIdError;

      let historyByEmail: any[] = [];
      if (patientEmail) {
        const { data: historyByEmailData, error: historyByEmailError } = await supabase
          .from('history')
          .select('*')
          .eq('patient_email', patientEmail)
          .neq('patient_id', patientId)
          .order('created_at', { ascending: false });
        if (historyByEmailError) throw historyByEmailError;
        historyByEmail = Array.isArray(historyByEmailData) ? historyByEmailData : [];
      }

      const merged = [...(Array.isArray(historyById) ? historyById : []), ...historyByEmail];
      const deduped = Array.from(new Map(merged.map((item: any) => [String(item?.id || crypto.randomUUID()), item])).values())
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      res.json({ success: true, data: deduped });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/history/email/:email', checkAuth, async (req: any, res) => {
    try {
      const safeEmail = sanitizeEmail(req.params.email);
      if (!safeEmail) return res.status(400).json({ error: 'E-mail inválido.' });
      const userRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const isPrivileged = ['therapist', 'coordinator', 'receptionist', 'admin', 'owner'].includes(userRole);
      const isSelfRequest = sanitizeEmail(req.session.user?.email) === safeEmail;

      // Only allow if searching for own email OR if therapist/admin
      if (!isPrivileged && !isSelfRequest) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      let query = supabase
        .from('history')
        .select('*')
        .eq('patient_email', safeEmail)
        .order('created_at', { ascending: false });

      if (!hasGlobalClinicAccess(req.session.user) && isPrivileged) {
        const clinicId = currentClinicId(req.session.user);
        if (!clinicId) return res.status(403).json({ error: 'Clínica não identificada.' });
        const clinicPatientIds = await getClinicPatientIdsByEmail(clinicId, safeEmail);
        if (clinicPatientIds.length === 0) return res.json({ success: true, data: [] });
        query = query.in('patient_id', clinicPatientIds);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/patient/self/history', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const patientEmail = sanitizeEmail(req.session.user?.email);
      if (!patientEmail) {
        return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível.' });
      }

      const patientIds = await getPatientIdsByEmailAcrossClinics(patientEmail);
      let query = supabase
        .from('history')
        .select('*')
        .eq('patient_email', patientEmail);

      if (patientIds.length > 0) {
        query = query.in('patient_id', patientIds);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      const { data: assignedCompleted, error: assignedError } = await supabase
        .from('assigned_tasks')
        .select('*')
        .eq('status', 'completed')
        .eq('patient_email', patientEmail)
        .order('completed_at', { ascending: false });
      if (assignedError) {
        console.warn('[PatientSelfHistory] assigned_tasks fallback warning:', assignedError.message || String(assignedError));
      }

      const mappedAssignedHistory = (assignedCompleted || []).map((task: any) => {
        const taskData = task?.task_data && typeof task.task_data === 'object' ? task.task_data : {};
        return {
          id: `assigned:${task.id}`,
          patient_id: task.patient_id,
          patient_email: task.patient_email,
          type: task.task_type || 'task',
          title: taskData.title || 'Tarefa concluída',
          score: task.pro_score ?? null,
          energy: task.patient_effort ?? null,
          note: task.patient_comment || task.pro_review_note || '',
          icon: taskData.icon || '📌',
          created_at: task.completed_at || task.updated_at || task.created_at
        };
      });
      const consolidatedHistory = [...(data || []), ...mappedAssignedHistory]
        .sort((a: any, b: any) => {
          const aTs = new Date(a?.created_at || 0).getTime();
          const bTs = new Date(b?.created_at || 0).getTime();
          return bTs - aTs;
        });

      const treatmentStatus = await updatePatientStatusIfNeeded(req.session.user);
      req.session.user.treatmentStatus = treatmentStatus;
      req.session.user = buildSessionUserPayload(req.session.user);
      void req.session.save(() => {});

      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Paciente', 180),
        title: 'Leitura de histórico sem tratamento ativo',
        content: `Paciente acessou o histórico consolidado com status ${treatmentStatus}.`,
        type: 'security'
      });

      res.json({ success: true, data: consolidatedHistory, treatmentStatus });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
  app.post('/api/history', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'patient', 'admin', 'owner'), async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 96 * 1024, 'Payload de relatório/evolução')) return;
      const resolvedPatientId = await resolvePatientIdForRequest(
        sanitizeString(req.body?.patient_id, 120),
        req.session.user,
        { createIfMissing: true, fallbackName: sanitizeString(req.body?.patient_name, 160) }
      );
      const safeType = sanitizeString(req.body?.type, 80) || 'task';
      const docData = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email),
        type: safeType,
        title: sanitizeTextField(req.body?.title, 180),
        score: asSafeNumber(req.body?.score, 0, 100),
        energy: asSafeNumber(req.body?.energy, 0, 100),
        note: sanitizeTextField(req.body?.note, 12000),
        icon: sanitizeString(req.body?.icon, 40),
        image: sanitizeUrl(req.body?.image),
        therapist_id: sanitizeString(req.session.user.id, 120),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!docData.patient_id || !docData.title) {
        return res.status(400).json({ error: 'patient_id e título são obrigatórios.' });
      }

      const { data, error } = await supabase
        .from('history')
        .upsert([docData], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Registro de evolução salvo',
        content: `${docData.title} foi salvo no histórico do paciente ${docData.patient_id}.`,
        type: 'clinical'
      });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Activity Logs
  app.get('/api/logs', async (req: any, res) => {
    try {
      let currentUser = req.session?.user || null;
      if (!currentUser) {
        const authHeader = sanitizeString(req.headers?.authorization, 9000);
        if (authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7).trim();
          const tokenMatch = tokenMatchesCurrentProject(token);
          if (tokenMatch.ok) {
            const { user, error } = await getUserFromAccessToken(token);
            if (!error && user?.id) {
              const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
              if (profile) {
                currentUser = buildSessionUserPayload({
                  id: user.id,
                  email: user.email,
                  role: profile.role,
                  name: profile.name,
                  clinicId: profile.clinic_id,
                  activeWorkspaceId: profile.clinic_id
                });
              }
            }
          }
        }
      }

      if (!currentUser?.id) {
        return res.status(200).json({ success: true, data: [], warning: 'activity_logs_missing_auth' });
      }

      const role = currentUser.role as AppRole;
      const clinicId = currentClinicId(currentUser);
      let query = supabase
        .from('activity_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(500);

      if ((role === 'coordinator' || role === 'admin' || role === 'owner') && clinicId) {
        query = query.eq('clinic_id', clinicId);
      } else {
        query = query.eq('user_id', currentUser.id);
      }

      let data: any = [];
      let error: any = null;
      try {
        const result = await query;
        data = result.data;
        error = result.error;
      } catch (queryError: any) {
        error = queryError;
      }
      if (error && /clinic_id/i.test(String(error?.message || ''))) {
        try {
          const fallback = await supabase
            .from('activity_logs')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('timestamp', { ascending: false })
            .limit(500);
          data = fallback.data;
          error = fallback.error;
        } catch (fallbackError: any) {
          error = fallbackError;
        }
      }
      
      if (error) {
        console.error('Supabase logs fetch error:', error);
        return res.status(200).json({
          success: true,
          data: [],
          warning: 'activity_logs_unavailable',
          details: sanitizeString(error?.message || String(error), 400)
        });
      }
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Logs route error:', error);
      return res.status(200).json({
        success: true,
        data: [],
        warning: 'activity_logs_route_error',
        details: sanitizeString(error?.message || String(error), 400)
      });
    }
  });

  app.post('/api/logs', async (req: any, res) => {
    try {
      let currentUser = req.session?.user || null;
      if (!currentUser) {
        const authHeader = sanitizeString(req.headers?.authorization, 9000);
        if (authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7).trim();
          const tokenMatch = tokenMatchesCurrentProject(token);
          if (tokenMatch.ok) {
            const { user, error } = await getUserFromAccessToken(token);
            if (!error && user?.id) {
              const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
              if (profile) {
                currentUser = buildSessionUserPayload({
                  id: user.id,
                  email: user.email,
                  role: profile.role,
                  name: profile.name,
                  clinicId: profile.clinic_id,
                  activeWorkspaceId: profile.clinic_id
                });
              }
            }
          }
        }
      }

      if (!currentUser?.id) {
        return res.status(200).json({
          success: true,
          queued: true,
          warning: 'activity_logs_missing_auth'
        });
      }

      const actorName = sanitizeString(currentUser?.name || currentUser?.email || 'Usuário', 180);
      let data: any = null;
      let error: any = null;
      try {
        const result = await supabase
          .from('activity_logs')
          .upsert([{
            ...req.body,
            user_id: currentUser.id,
            actor_name: actorName,
            clinic_id: currentClinicId(currentUser),
            timestamp: req.body?.timestamp || new Date().toISOString()
          }], { onConflict: 'id' })
          .select()
          .single();
        data = result.data;
        error = result.error;
      } catch (upsertError: any) {
        error = upsertError;
      }
      
      if (error && /actor_name|clinic_id/i.test(String(error?.message || ''))) {
        try {
          const fallback = await supabase
            .from('activity_logs')
            .upsert([{
              ...req.body,
              user_id: currentUser.id,
              timestamp: req.body?.timestamp || new Date().toISOString()
            }], { onConflict: 'id' })
            .select()
            .single();
          data = fallback.data;
          error = fallback.error;
        } catch (fallbackError: any) {
          error = fallbackError;
        }
      }

      if (error) {
        logRouteDbError('/api/logs', error, { userId: currentUser.id });
        return res.status(200).json({
          success: true,
          queued: true,
          warning: 'activity_logs_write_unavailable',
          details: sanitizeString(error?.message || String(error), 400)
        });
      }
      return res.json({ success: true, id: data?.id || null });
    } catch (error: any) {
      logRouteDbError('/api/logs', error, { route: 'post' });
      return res.status(200).json({
        success: true,
        queued: true,
        warning: 'activity_logs_route_error',
        details: sanitizeString(error?.message || String(error), 400)
      });
    }
  });

  // User Profile
  app.post('/api/profile/:userId/complete-onboarding', checkAuth, async (req: any, res) => {
    const { userId } = req.params;

    if (req.session.user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized - ID mismatch' });
    }

    try {
      const role = req.session.user.role as AppRole;
      const clinicId = currentClinicId(req.session.user);

      const fullName = sanitizeString(req.body?.fullName || req.body?.name, 180);
      const birthDate = sanitizeDate(req.body?.birthDate);
      const gender = sanitizeString(req.body?.gender, 40);
      const cep = sanitizeString(req.body?.cep, 20);
      const logradouro = sanitizeString(req.body?.logradouro, 180);
      const number = sanitizeString(req.body?.number, 20);
      const complement = sanitizeString(req.body?.complement, 120);
      const bairro = sanitizeString(req.body?.bairro, 120);
      const cidade = sanitizeString(req.body?.cidade, 120);
      const sessionDurationMinutes = asSafeNumber(req.body?.sessionDurationMinutes, 20, 240) || 50;
      const countryCode = sanitizeString(req.body?.countryCode, 8);
      const phone = sanitizePhone(req.body?.phone);
      const clinicName = sanitizeString(req.body?.clinicName, 160);
      const clinicLogoUrl = sanitizeUrl(req.body?.clinicLogoUrl);
      const clinicCnpj = sanitizeString(req.body?.clinicCnpj, 24);
      const clinicPhone = sanitizePhone(req.body?.clinicPhone);
      const specialty = sanitizeString(req.body?.specialty, 120);
      const council = sanitizeString(req.body?.council, 80);
      const councilNumber = sanitizeString(req.body?.councilNumber, 80);
      const signatureDataUrl = sanitizeUrl(req.body?.signatureDataUrl);
      const profilePicture = sanitizeUrl(req.body?.profilePicture);

      if (!fullName) {
        return res.status(400).json({ error: 'Nome completo e obrigatorio.' });
      }

      if (role === 'therapist' && (!council || !councilNumber)) {
        return res.status(400).json({ error: 'Terapeuta precisa informar conselho e numero do conselho.' });
      }

      const address = { cep, logradouro, number, complement, bairro, cidade, cnpj: clinicCnpj || null };

      const { error: userUpdateError } = await supabase
        .from('users')
        .update({
          name: fullName,
          profile_picture: profilePicture,
          subscription_status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      if (userUpdateError) throw userUpdateError;

      await supabase
        .from('professional_profiles')
        .upsert([{
          user_id: userId,
          full_name: fullName,
          birth_date: birthDate,
          gender,
          country_code: countryCode || null,
          phone,
          profile_photo_url: profilePicture,
          clinic_name: clinicName || null,
          clinic_logo_url: clinicLogoUrl,
          clinic_phone: clinicPhone,
          specialty,
          council,
          council_number: councilNumber,
          signature_data_url: signatureDataUrl,
          requires_onboarding: false,
          onboarding_completed_at: new Date().toISOString(),
          address,
          metadata: {
            role,
            sessionDurationMinutes,
            clinicCnpj: clinicCnpj || null
          },
          updated_at: new Date().toISOString()
        }], { onConflict: 'user_id' });

      if (clinicId && (role === 'coordinator' || role === 'admin')) {
        await supabase
          .from('clinics')
          .upsert([{
            id: clinicId,
            owner_user_id: req.session.user.id,
            name: clinicName || 'Minha Clinica',
            logo_url: clinicLogoUrl,
            phone_commercial: clinicPhone,
            session_duration_minutes: sessionDurationMinutes,
            specialty,
            council,
            council_number: councilNumber,
            signature_data_url: signatureDataUrl,
            country_code: countryCode || null,
            address,
            updated_at: new Date().toISOString()
          }], { onConflict: 'id' });
      }

      const nextClinicSettings = cleanObject({
        ...(req.session.user?.clinicSettings || {}),
        clinicName: clinicName || null,
        clinicLogoUrl: clinicLogoUrl || null,
        clinicCnpj: clinicCnpj || null,
        clinicPhone: clinicPhone || null,
        specialty: specialty || null,
        council: council || null,
        councilNumber: councilNumber || null,
        signatureDataUrl: signatureDataUrl || null,
        defaultSessionDuration: sessionDurationMinutes,
        workStart: req.session.user?.clinicSettings?.workStart || '08:00',
        workEnd: req.session.user?.clinicSettings?.workEnd || '18:00',
        clinicAddress: [logradouro, number, bairro, cidade].filter(Boolean).join(', ')
      });

      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          clinic_settings: nextClinicSettings,
          first_login_completed: true
        }
      });

      req.session.user.name = fullName;
      req.session.user.firstLoginCompleted = true;
      req.session.user.subscriptionStatus = 'active';
      req.session.user.profilePicture = sanitizeSessionUrl(profilePicture) || req.session.user.profilePicture || null;
      req.session.user.clinicSettings = compactClinicSettingsForSession(nextClinicSettings);
      req.session.user.workspaces = compactWorkspacesForSession(await fetchUserWorkspaces(userId));

      req.session.save((err: any) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao salvar sessao' });
        }
        res.json({ success: true });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro interno no servidor' });
    }
  });
  app.get('/api/profile/:userId', checkAuth, async (req: any, res) => {
    try {
      // Only allow own profile or admin
      if (req.session.user.id !== req.params.userId && req.session.user.role !== 'admin' && req.session.user.role !== 'coordinator') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.params.userId)
        .single();
      
      if (error) throw error;
      const { data: profileExtra } = await supabase
        .from('professional_profiles')
        .select('*')
        .eq('user_id', req.params.userId)
        .maybeSingle();
      res.json({ success: true, data: { ...data, professional_profile: profileExtra || null } });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/profile/:userId', checkAuth, async (req: any, res) => {
    try {
      // Only allow own profile or admin
      if (req.session.user.id !== req.params.userId && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { error } = await supabase
        .from('users')
        .upsert({
          ...req.body,
          id: req.params.userId,
          updated_at: new Date().toISOString()
        });
      
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Tasks
  app.get('/api/tasks/:patientId', checkAuth, checkPatientAccess, async (req, res) => {
    try {
      const patientId = sanitizeString((req as any).resolvedPatientId || req.params.patientId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { data: patientRow } = await supabase
        .from('patients')
        .select('email')
        .eq('id', patientId)
        .maybeSingle();
      const patientEmail = sanitizeEmail(patientRow?.email);

      const { data: tasksById, error: tasksByIdError } = await supabase
        .from('tasks')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (tasksByIdError) throw tasksByIdError;

      let tasksByEmail: any[] = [];
      if (patientEmail) {
        const { data: tasksByEmailData, error: tasksByEmailError } = await supabase
          .from('tasks')
          .select('*')
          .eq('patient_email', patientEmail)
          .neq('patient_id', patientId)
          .order('created_at', { ascending: false });
        if (tasksByEmailError) throw tasksByEmailError;
        tasksByEmail = Array.isArray(tasksByEmailData) ? tasksByEmailData : [];
      }

      const merged = [...(Array.isArray(tasksById) ? tasksById : []), ...tasksByEmail];
      const deduped = Array.from(new Map(merged.map((item: any) => [String(item?.id || crypto.randomUUID()), item])).values())
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      res.json({ success: true, data: deduped });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/tasks/email/:email', checkAuth, async (req: any, res) => {
    try {
      const safeEmail = sanitizeEmail(req.params.email);
      if (!safeEmail) return res.status(400).json({ error: 'E-mail inválido.' });
      const userRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const isPrivileged = ['therapist', 'coordinator', 'receptionist', 'admin', 'owner'].includes(userRole);
      const isSelfRequest = sanitizeEmail(req.session.user?.email) === safeEmail;

      // Only allow if searching for own email OR if therapist/admin
      if (!isPrivileged && !isSelfRequest) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      let query = supabase
        .from('tasks')
        .select('*')
        .eq('patient_email', safeEmail)
        .order('created_at', { ascending: false });

      if (!hasGlobalClinicAccess(req.session.user) && isPrivileged) {
        const clinicId = currentClinicId(req.session.user);
        if (!clinicId) return res.status(403).json({ error: 'Clínica não identificada.' });
        const clinicPatientIds = await getClinicPatientIdsByEmail(clinicId, safeEmail);
        if (clinicPatientIds.length === 0) return res.json({ success: true, data: [] });
        query = query.in('patient_id', clinicPatientIds);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/patient/self/tasks', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const patientEmail = sanitizeEmail(req.session.user?.email);
      if (!patientEmail) {
        return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível.' });
      }

      const patientIds = await getPatientIdsByEmailAcrossClinics(patientEmail);
      let query = supabase
        .from('tasks')
        .select('*')
        .eq('patient_email', patientEmail);

      if (patientIds.length > 0) {
        query = query.in('patient_id', patientIds);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
  app.post('/api/tasks', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const resolvedPatientId = await resolvePatientIdForRequest(
        sanitizeString(req.body?.patient_id, 120),
        req.session.user,
        { createIfMissing: true, fallbackName: sanitizeString(req.body?.patient_name, 160) }
      );
      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email),
        title: sanitizeString(req.body?.title, 180),
        description: sanitizeString(req.body?.description, 4000),
        type: sanitizeString(req.body?.type, 80) || 'task',
        pro_score: req.body?.pro_score !== undefined ? asSafeNumber(req.body?.pro_score, 0, 100) : undefined,
        max_score: req.body?.max_score !== undefined
          ? asSafeNumber(req.body?.max_score, 1, 100)
          : req.body?.maxScore !== undefined
            ? asSafeNumber(req.body?.maxScore, 1, 100)
            : undefined,
        icon: sanitizeString(req.body?.icon, 40),
        color: sanitizeString(req.body?.color, 80),
        completed: Boolean(req.body?.completed),
        is_daily_reminder: Boolean(req.body?.is_daily_reminder),
        linked_task: sanitizeString(req.body?.linked_task, 120) || undefined,
        therapist_id: sanitizeString(req.session.user.id, 120),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!payload.patient_id || !payload.title) {
        return res.status(400).json({ error: 'patient_id e título são obrigatórios.' });
      }
      if (!isUuid(payload.patient_id)) {
        return res.status(400).json({ error: 'patient_id inválido para salvar tarefas.' });
      }

      const { data, error } = await supabase
        .from('tasks')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      try {
        await persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
          title: 'Tarefa/PEI salva',
          content: `Tarefa "${payload.title}" registrada para paciente ${payload.patient_id}.`,
          type: 'clinical'
        });
      } catch (logError) {
        logRouteDbError('/api/tasks', logError, { phase: 'persistActivityLog' });
      }
      res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/tasks', error, {
        patient_id: sanitizeString(req.body?.patient_id, 120),
        therapist_id: sanitizeString(req.session?.user?.id, 120),
        title: sanitizeString(req.body?.title, 180)
      });
      if (isMissingRelationError(error)) {
        return res.status(503).json({
          error: 'Estrutura de banco para tasks indisponível. Verifique migrações em produção.',
          details: extractSupabaseErrorMessage(error)
        });
      }
      res.status(500).json({ error: extractSupabaseErrorMessage(error) });
    }
  });

  app.patch('/api/tasks/:taskId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const taskId = sanitizeString(req.params.taskId, 120);
      if (!taskId) return res.status(400).json({ success: false, error: 'taskId inválido.' });
      const { data: existing, error: existingError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Tarefa não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const updates = cleanObject({
        title: req.body?.title !== undefined ? sanitizeString(req.body?.title, 180) : undefined,
        description: req.body?.description !== undefined ? sanitizeTextField(req.body?.description, 4000) : undefined,
        type: req.body?.type !== undefined ? sanitizeString(req.body?.type, 80) : undefined,
        pro_score: req.body?.pro_score !== undefined ? asSafeNumber(req.body?.pro_score, 0, 100) : undefined,
        max_score:
          req.body?.max_score !== undefined
            ? asSafeNumber(req.body?.max_score, 1, 100)
            : req.body?.maxScore !== undefined
              ? asSafeNumber(req.body?.maxScore, 1, 100)
              : undefined,
        icon: req.body?.icon !== undefined ? sanitizeString(req.body?.icon, 40) : undefined,
        color: req.body?.color !== undefined ? sanitizeString(req.body?.color, 80) : undefined,
        completed: req.body?.completed !== undefined ? Boolean(req.body?.completed) : undefined,
        is_daily_reminder: req.body?.is_daily_reminder !== undefined ? Boolean(req.body?.is_daily_reminder) : undefined,
        linked_task: req.body?.linked_task !== undefined ? sanitizeString(req.body?.linked_task, 120) : undefined,
        updated_at: new Date().toISOString()
      });
      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', taskId)
        .select('*')
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/tasks/:taskId [PATCH]', error, { taskId: sanitizeString(req.params.taskId, 120) });
      return res.status(500).json({ success: false, error: extractSupabaseErrorMessage(error) });
    }
  });

  app.delete('/api/tasks/:taskId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const taskId = sanitizeString(req.params.taskId, 120);
      if (!taskId) return res.status(400).json({ success: false, error: 'taskId inválido.' });
      const { data: existing, error: existingError } = await supabase
        .from('tasks')
        .select('id, patient_id')
        .eq('id', taskId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Tarefa não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
      return res.json({ success: true });
    } catch (error: any) {
      logRouteDbError('/api/tasks/:taskId [DELETE]', error, { taskId: sanitizeString(req.params.taskId, 120) });
      return res.status(500).json({ success: false, error: extractSupabaseErrorMessage(error) });
    }
  });

  app.patch('/api/history/:historyId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const historyId = sanitizeString(req.params.historyId, 120);
      if (!historyId) return res.status(400).json({ success: false, error: 'historyId inválido.' });
      const { data: existing, error: existingError } = await supabase
        .from('history')
        .select('*')
        .eq('id', historyId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const updates = cleanObject({
        title: req.body?.title !== undefined ? sanitizeTextField(req.body?.title, 180) : undefined,
        score: req.body?.score !== undefined ? asSafeNumber(req.body?.score, 0, 100) : undefined,
        energy: req.body?.energy !== undefined ? asSafeNumber(req.body?.energy, 0, 100) : undefined,
        note: req.body?.note !== undefined ? sanitizeTextField(req.body?.note, 12000) : undefined,
        icon: req.body?.icon !== undefined ? sanitizeString(req.body?.icon, 40) : undefined,
        updated_at: new Date().toISOString()
      });
      const { data, error } = await supabase
        .from('history')
        .update(updates)
        .eq('id', historyId)
        .select('*')
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/history/:historyId [PATCH]', error, { historyId: sanitizeString(req.params.historyId, 120) });
      return res.status(500).json({ success: false, error: extractSupabaseErrorMessage(error) });
    }
  });

  app.delete('/api/history/:historyId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const historyId = sanitizeString(req.params.historyId, 120);
      if (!historyId) return res.status(400).json({ success: false, error: 'historyId inválido.' });
      const { data: existing, error: existingError } = await supabase
        .from('history')
        .select('id, patient_id')
        .eq('id', historyId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const { error } = await supabase.from('history').delete().eq('id', historyId);
      if (error) throw error;
      return res.json({ success: true });
    } catch (error: any) {
      logRouteDbError('/api/history/:historyId [DELETE]', error, { historyId: sanitizeString(req.params.historyId, 120) });
      return res.status(500).json({ success: false, error: extractSupabaseErrorMessage(error) });
    }
  });

  app.patch('/api/notes/:noteId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const noteId = sanitizeString(req.params.noteId, 120);
      if (!noteId) return res.status(400).json({ success: false, error: 'noteId inválido.' });
      const { data: existing, error: existingError } = await supabase
        .from('notes')
        .select('*')
        .eq('id', noteId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Nota não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const safeVisibility = new Set(['private', 'shared', 'family', 'professional', 'patient']);
      const updates = cleanObject({
        text: req.body?.text !== undefined ? sanitizeTextField(req.body?.text, 12000) : undefined,
        visibility:
          req.body?.visibility !== undefined
            ? (safeVisibility.has(String(req.body?.visibility)) ? String(req.body?.visibility) : undefined)
            : undefined,
        subject: req.body?.subject !== undefined ? (sanitizeTextField(req.body?.subject, 100) || 'Geral') : undefined,
        updated_at: new Date().toISOString()
      });
      const { data, error } = await supabase
        .from('notes')
        .update(updates)
        .eq('id', noteId)
        .select('*')
        .single();
      if (error) throw error;
      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.delete('/api/notes/:noteId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const noteId = sanitizeString(req.params.noteId, 120);
      if (!noteId) return res.status(400).json({ success: false, error: 'noteId inválido.' });
      const { data: existing, error: existingError } = await supabase
        .from('notes')
        .select('id, patient_id')
        .eq('id', noteId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Nota não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const { error } = await supabase.from('notes').delete().eq('id', noteId);
      if (error) throw error;
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Assigned Tasks (adult homework workflow)
  app.get('/api/assigned-tasks/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });

      const clinicId = currentClinicId(req.session.user);
      let query = supabase
        .from('assigned_tasks')
        .select('*')
        .eq('patient_id', patientId)
        .order('scheduled_at', { ascending: false });

      if (clinicId && !hasGlobalClinicAccess(req.session.user)) {
        query = query.eq('clinic_id', clinicId);
      }

      const { data, error } = await query;
      if (error) {
        if (/assigned_tasks/i.test(String(error?.message || ''))) {
          return res.status(200).json({ success: true, data: [], warning: 'Tabela assigned_tasks não criada.' });
        }
        throw error;
      }

      return res.json({ success: true, data: data || [] });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  app.get('/api/patient/self/assigned-tasks', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const patientEmail = sanitizeEmail(req.session.user?.email);
      if (!patientEmail) {
        return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível.' });
      }

      const patientIds = await getPatientIdsByEmailAcrossClinics(patientEmail);
      let query = supabase
        .from('assigned_tasks')
        .select('*')
        .eq('patient_email', patientEmail);

      if (patientIds.length > 0) {
        query = query.in('patient_id', patientIds);
      }

      const nowIso = new Date().toISOString();
      const { data, error } = await query.order('scheduled_at', { ascending: false });
      if (error) {
        if (/assigned_tasks/i.test(String(error?.message || ''))) {
          return res.status(200).json({ success: true, data: [], warning: 'Tabela assigned_tasks não criada.' });
        }
        throw error;
      }

      const visibleTasks = (data || []).filter((task: any) => {
        const scheduledAt = sanitizeString(task?.scheduled_at, 60);
        if (!scheduledAt) return true;
        return scheduledAt <= nowIso;
      });

      return res.json({ success: true, data: visibleTasks });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  app.post('/api/assigned-tasks', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const resolvedPatientId = await resolvePatientIdForRequest(
        sanitizeString(req.body?.patient_id, 120),
        req.session.user,
        { createIfMissing: true, fallbackName: sanitizeString(req.body?.patient_name, 160) }
      );
      const clinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120);
      const professionalId = sanitizeString(req.session.user?.id, 120);
      const taskType = sanitizeString(req.body?.task_type || req.body?.type, 60) || 'task';
      const status = sanitizeString(req.body?.status, 40).toLowerCase();
      const safeStatus = status === 'completed' ? 'completed' : 'pending';
      const safeTaskData =
        req.body?.task_data && typeof req.body.task_data === 'object'
          ? req.body.task_data
          : req.body?.taskData && typeof req.body.taskData === 'object'
            ? req.body.taskData
            : {};

      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        clinic_id: clinicId || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email),
        professional_id: professionalId || undefined,
        task_type: taskType,
        task_data: safeTaskData,
        scheduled_at: sanitizeString(req.body?.scheduled_at, 40) || new Date().toISOString(),
        status: safeStatus,
        parent_assigned_task_id: sanitizeString(req.body?.parent_assigned_task_id, 120) || undefined
      });

      if (!payload.patient_id || !payload.professional_id) {
        return res.status(400).json({ success: false, error: 'patient_id e professional_id são obrigatórios.' });
      }

      const { data, error } = await supabase
        .from('assigned_tasks')
        .upsert([payload], { onConflict: 'id' })
        .select('*')
        .single();

      if (error) {
        if (/assigned_tasks/i.test(String(error?.message || ''))) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela assigned_tasks não existe. Execute o SQL de migração.'
          });
        }
        throw error;
      }

      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  app.post('/api/assigned-tasks/:taskId/complete', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const taskId = sanitizeString(req.params.taskId, 120);
      if (!taskId) return res.status(400).json({ success: false, error: 'taskId inválido.' });

      const { data: existing, error: fetchError } = await supabase
        .from('assigned_tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!existing) return res.status(404).json({ success: false, error: 'Tarefa não encontrada.' });

      const sessionEmail = sanitizeEmail(req.session.user?.email);
      const linkedPatientIds = sessionEmail ? await getPatientIdsByEmailAcrossClinics(sessionEmail) : [];
      const canAccessByEmail = sessionEmail && sessionEmail === sanitizeEmail(existing.patient_email);
      const canAccessByPatientId = linkedPatientIds.includes(String(existing.patient_id));
      if (!canAccessByEmail && !canAccessByPatientId) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const updatePayload = cleanObject({
        patient_effort: asSafeNumber(req.body?.patient_effort, 0, 100),
        patient_comment: sanitizeTextField(req.body?.patient_comment, 4000),
        status: 'completed',
        completed_at: new Date().toISOString()
      });

      const { data, error } = await supabase
        .from('assigned_tasks')
        .update(updatePayload)
        .eq('id', taskId)
        .select('*')
        .single();
      if (error) throw error;

      const taskData = data?.task_data && typeof data.task_data === 'object' ? data.task_data : {};
      try {
        await supabase
          .from('history')
          .insert([cleanObject({
            id: crypto.randomUUID(),
            patient_id: sanitizeString(data?.patient_id, 120),
            patient_email: sanitizeEmail(data?.patient_email),
            type: sanitizeString(data?.task_type, 80) || 'task',
            title: sanitizeTextField(taskData?.title || 'Tarefa concluída', 180),
            score: null,
            energy: asSafeNumber(data?.patient_effort, 0, 100),
            note: sanitizeTextField(data?.patient_comment, 12000),
            icon: sanitizeString(taskData?.icon, 40) || '📌',
            therapist_id: sanitizeString(data?.professional_id, 120),
            created_at: data?.completed_at || new Date().toISOString()
          })]);
      } catch (historyInsertError: any) {
        console.warn('[AssignedTasks] Falha ao criar histórico automático:', historyInsertError?.message || String(historyInsertError));
      }

      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  app.post('/api/assigned-tasks/:taskId/review', checkAuth, requireRoles('coordinator', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const taskId = sanitizeString(req.params.taskId, 120);
      if (!taskId) return res.status(400).json({ success: false, error: 'taskId inválido.' });

      const { data: existing, error: fetchError } = await supabase
        .from('assigned_tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!existing) return res.status(404).json({ success: false, error: 'Tarefa não encontrada.' });

      const existingTaskData = existing.task_data && typeof existing.task_data === 'object' ? existing.task_data : {};
      const maxScoreFromTask =
        asSafeNumber(
          existingTaskData?.maxScore ??
            existingTaskData?.max_score ??
            req.body?.max_score,
          1,
          10
        ) || 4;
      const proScore = asSafeNumber(req.body?.pro_score, 0, maxScoreFromTask);
      if (proScore === null) {
        return res.status(400).json({ success: false, error: `pro_score deve estar entre 0 e ${maxScoreFromTask}.` });
      }

      const reviewNote = sanitizeTextField(req.body?.pro_review_note, 4000);
      const { data, error } = await supabase
        .from('assigned_tasks')
        .update({
          pro_score: proScore,
          pro_review_note: reviewNote,
          task_data: {
            ...existingTaskData,
            maxScore: maxScoreFromTask
          },
          reviewed_at: new Date().toISOString()
        })
        .eq('id', taskId)
        .select('*')
        .single();
      if (error) throw error;

      let suggestedTask: any = null;
      if (proScore <= 2) {
        const linkedProtocolId = sanitizeString(
          existingTaskData?.linkedProtocolId || existingTaskData?.linkedInterventionProtocolId,
          120
        );
        const originalTitle = sanitizeString(existingTaskData?.title || existing.title || 'Habilidade', 180);
        const suggestionTitle = sanitizeString(
          existingTaskData?.linkedInterventionTitle ||
            `Intervenção sugerida: ${originalTitle}`,
          180
        );
        const suggestionDescription = sanitizeTextField(
          existingTaskData?.linkedInterventionDescription ||
            `Pontuação profissional ≤ 2 para "${originalTitle}". Considere agendar intervenção guiada.`,
          4000
        );

        suggestedTask = {
          clinic_id: sanitizeString(existing.clinic_id, 120) || sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
          patient_id: sanitizeString(existing.patient_id, 120),
          patient_email: sanitizeEmail(existing.patient_email),
          professional_id: sanitizeString(req.session.user?.id, 120),
          task_type: 'intervention',
          task_data: {
            title: suggestionTitle,
            description: suggestionDescription,
            linkedProtocolId: linkedProtocolId || undefined,
            autoSuggested: true,
            sourceAssignedTaskId: taskId
          },
          scheduled_at: null,
          status: 'pending',
          parent_assigned_task_id: taskId
        };
      }

      return res.json({ success: true, data, suggestedTask });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  // Payments
  app.get('/api/payments', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('payment_date', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/payments', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const status = sanitizeString(req.body?.status, 40).toLowerCase() || 'paid';
      const payload = cleanObject({
        patient_id: sanitizeString(req.body?.patient_id, 120),
        patient_name: sanitizeString(req.body?.patient_name, 160),
        amount: asSafeNumber(req.body?.amount, 0, 1_000_000),
        payment_date: sanitizeDate(req.body?.payment_date) || new Date().toISOString().slice(0, 10),
        method: sanitizeString(req.body?.method, 80),
        status: paymentStatuses.has(status) ? status : 'pending',
        receipt_url: sanitizeUrl(req.body?.receipt_url),
        type: sanitizeString(req.body?.type, 80),
        insurance_name: sanitizeString(req.body?.insurance_name, 120),
        clinic_id: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        created_by: sanitizeString(req.session.user?.id, 120),
        created_at: new Date().toISOString()
      });

      if (!payload.patient_id || payload.amount === null) {
        return res.status(400).json({ error: 'patient_id e amount são obrigatórios.' });
      }

      const { data, error } = await supabase
        .from('payments')
        .insert([payload])
        .select()
        .single();
      
      if (error) throw error;
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Pagamento registrado',
        content: `Pagamento de ${payload.amount} para paciente ${payload.patient_name || payload.patient_id} foi salvo (${payload.status}).`,
        type: 'management'
      });
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/financial/feature-survey', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const user = req.session.user;
      const clinicId = currentClinicId(user);
      if (!clinicId) return res.json({ success: true, submitted: false, data: null });

      const { data, error } = await supabase
        .from('financial_module_feedback')
        .select('*')
        .eq('clinic_id', clinicId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
      res.json({ success: true, submitted: !!data, data: data || null });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post('/api/financial/feature-survey', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const user = req.session.user;
      const clinicId = currentClinicId(user);
      if (!clinicId) return res.status(400).json({ success: false, error: 'Clínica não identificada.' });

      const selectedFeaturesRaw = Array.isArray(req.body?.selectedFeatures) ? req.body.selectedFeatures : [];
      const selectedFeatures = selectedFeaturesRaw
        .map((f: any) => sanitizeString(f, 140))
        .filter((f: string) => Boolean(f));
      const notes = sanitizeString(req.body?.notes, 1200);

      if (selectedFeatures.length === 0) {
        return res.status(400).json({ success: false, error: 'Selecione ao menos uma funcionalidade.' });
      }

      const { error } = await supabase
        .from('financial_module_feedback')
        .upsert([{
          clinic_id: clinicId,
          user_id: user.id,
          user_email: sanitizeEmail(user.email),
          selected_features: selectedFeatures,
          notes: notes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }], { onConflict: 'clinic_id,user_id' });

      if (error) throw error;

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  const checkOwner = (req: any, res: any, next: any) => {
    if (req.session.user?.role === 'owner') {
      return next();
    }
    return res.status(403).json({ error: 'Acesso negado. Apenas super admins podem acessar esta rota.' });
  };

  const hasMissingFinancialSchema = (error: any) => {
    const message = (error?.message || '').toLowerCase();
    return message.includes('schema cache') || message.includes('does not exist') || message.includes('relation');
  };

  // Owner-only stats (CEO dashboard)
  app.get('/api/owner/stats', checkAuth, checkOwner, async (req: any, res) => {
    try {
      const { count: totalUsers } = await supabase
        .from('users').select('*', { count: 'exact', head: true });

      const { count: activeUsers } = await supabase
        .from('users').select('*', { count: 'exact', head: true })
        .eq('subscription_status', 'active');

      const { data: activeProfiles } = await supabase
        .from('users').select('plan_price')
        .eq('subscription_status', 'active');

      const mrr = activeProfiles?.reduce((sum, p) => sum + (p.plan_price || 0), 0) || 0;

      res.json({ success: true, stats: { totalUsers, activeUsers, mrr } });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/owner/clients', checkAuth, checkOwner, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email, plan_name, plan_price, subscription_status, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return res.json({ success: true, data: data || [] });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/owner/financial-overview', checkAuth, checkOwner, async (req: any, res) => {
    try {
      const [summaryRes, monthlyRes, byPlanRes, profitabilityRes, delinquentRes] = await Promise.all([
        supabase.from('vw_owner_dre_summary').select('*').single(),
        supabase.from('vw_owner_dre_monthly').select('*').order('period_month', { ascending: true }),
        supabase.from('vw_owner_revenue_by_plan').select('*').order('revenue_net', { ascending: false }),
        supabase.from('vw_owner_customer_profitability').select('*').order('profit', { ascending: true }).limit(20),
        supabase.from('vw_owner_delinquent_customers').select('*').order('delinquency_amount', { ascending: false }).limit(20)
      ]);

      const missingSchema =
        hasMissingFinancialSchema(summaryRes.error) ||
        hasMissingFinancialSchema(monthlyRes.error) ||
        hasMissingFinancialSchema(byPlanRes.error) ||
        hasMissingFinancialSchema(profitabilityRes.error) ||
        hasMissingFinancialSchema(delinquentRes.error);

      if (!missingSchema && !summaryRes.error && !monthlyRes.error && !byPlanRes.error && !profitabilityRes.error && !delinquentRes.error) {
        const monthly = (monthlyRes.data || []).map((row: any) => ({
          monthLabel: new Date(row.period_month).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
          revenueNet: Number(row.revenue_net || 0),
          variableCosts: Number(row.variable_costs || 0),
          fixedCosts: Number(row.fixed_costs || 0),
          ebitda: Number(row.ebitda || 0),
          contributionMarginPct: Number(row.contribution_margin_pct || 0),
          delinquencyAmount: Number(row.delinquency_amount || 0)
        }));

        return res.json({
          success: true,
          data: {
            source: 'supabase_financial_views',
            summary: {
              revenueGross: Number(summaryRes.data?.revenue_gross || 0),
              deductions: Number(summaryRes.data?.deductions || 0),
              revenueNet: Number(summaryRes.data?.revenue_net || 0),
              variableCosts: Number(summaryRes.data?.variable_costs || 0),
              fixedCosts: Number(summaryRes.data?.fixed_costs || 0),
              contributionMarginValue: Number(summaryRes.data?.contribution_margin_value || 0),
              contributionMarginPct: Number(summaryRes.data?.contribution_margin_pct || 0),
              ebitda: Number(summaryRes.data?.ebitda || 0),
              ebitdaPct: Number(summaryRes.data?.ebitda_pct || 0),
              delinquencyAmount: Number(summaryRes.data?.delinquency_amount || 0)
            },
            monthly,
            byPlan: (byPlanRes.data || []).map((row: any) => ({
              planName: row.plan_name || 'Nao definido',
              customers: Number(row.customers || 0),
              revenueNet: Number(row.revenue_net || 0)
            })),
            topCustomers: (profitabilityRes.data || []).map((row: any) => ({
              customerId: row.customer_id,
              name: row.name,
              email: row.email,
              revenueNet: Number(row.revenue_net || 0),
              totalCost: Number(row.variable_cost || 0) + Number(row.fixed_cost_allocated || 0),
              profit: Number(row.profit || 0),
              marginPct: Number(row.margin_pct || 0),
              status: row.subscription_status || 'active'
            })),
            delinquentCustomers: (delinquentRes.data || []).map((row: any) => ({
              customerId: row.customer_id,
              name: row.name,
              email: row.email,
              delinquencyAmount: Number(row.delinquency_amount || 0),
              openTitles: Number(row.open_titles || 0)
            }))
          }
        });
      }

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name, email, plan_name, plan_price, subscription_status, created_at');

      if (usersError) throw usersError;

      const dataset = users || [];
      const revenueNet = dataset
        .filter((u: any) => u.subscription_status === 'active')
        .reduce((acc: number, u: any) => acc + Number(u.plan_price || 0), 0);
      const delinquentUsers = dataset.filter((u: any) => u.subscription_status === 'delinquent');
      const delinquencyAmount = delinquentUsers.reduce((acc: number, u: any) => acc + Number(u.plan_price || 0), 0);
      const variableCosts = revenueNet * 0.22;
      const fixedCosts = revenueNet * 0.18;
      const contributionMarginValue = revenueNet - variableCosts;
      const ebitda = contributionMarginValue - fixedCosts;

      const byPlanMap = dataset
        .filter((u: any) => u.subscription_status === 'active')
        .reduce((acc: any, u: any) => {
          const key = u.plan_name || 'Nao definido';
          if (!acc[key]) acc[key] = { planName: key, customers: 0, revenueNet: 0 };
          acc[key].customers += 1;
          acc[key].revenueNet += Number(u.plan_price || 0);
          return acc;
        }, {});

      const now = new Date();
      const monthly = Array.from({ length: 6 }).map((_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
        const monthFactor = 0.85 + index * 0.04;
        return {
          monthLabel: date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
          revenueNet: Number((revenueNet * monthFactor).toFixed(2)),
          variableCosts: Number((variableCosts * monthFactor).toFixed(2)),
          fixedCosts: Number((fixedCosts * monthFactor).toFixed(2)),
          ebitda: Number((ebitda * monthFactor).toFixed(2)),
          contributionMarginPct: Number((((contributionMarginValue * monthFactor) / ((revenueNet * monthFactor) || 1)) * 100).toFixed(2)),
          delinquencyAmount: Number((delinquencyAmount * monthFactor).toFixed(2))
        };
      });

      const topCustomers = dataset
        .map((u: any) => {
          const customerRevenue = Number(u.subscription_status === 'active' ? u.plan_price || 0 : 0);
          const estimatedCost = customerRevenue * 0.95 + (u.subscription_status === 'delinquent' ? Number(u.plan_price || 0) : 0);
          const profit = customerRevenue - estimatedCost;
          return {
            customerId: u.id,
            name: u.name,
            email: u.email,
            revenueNet: customerRevenue,
            totalCost: Number(estimatedCost.toFixed(2)),
            profit: Number(profit.toFixed(2)),
            marginPct: customerRevenue > 0 ? Number(((profit / customerRevenue) * 100).toFixed(2)) : 0,
            status: u.subscription_status
          };
        })
        .sort((a: any, b: any) => a.profit - b.profit)
        .slice(0, 20);

      return res.json({
        success: true,
        data: {
          source: 'fallback_users',
          summary: {
            revenueGross: revenueNet,
            deductions: 0,
            revenueNet,
            variableCosts: Number(variableCosts.toFixed(2)),
            fixedCosts: Number(fixedCosts.toFixed(2)),
            contributionMarginValue: Number(contributionMarginValue.toFixed(2)),
            contributionMarginPct: revenueNet > 0 ? Number(((contributionMarginValue / revenueNet) * 100).toFixed(2)) : 0,
            ebitda: Number(ebitda.toFixed(2)),
            ebitdaPct: revenueNet > 0 ? Number(((ebitda / revenueNet) * 100).toFixed(2)) : 0,
            delinquencyAmount: Number(delinquencyAmount.toFixed(2))
          },
          monthly,
          byPlan: Object.values(byPlanMap),
          topCustomers,
          delinquentCustomers: delinquentUsers.map((u: any) => ({
            customerId: u.id,
            name: u.name,
            email: u.email,
            delinquencyAmount: Number(u.plan_price || 0),
            openTitles: 1
          }))
        }
      });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/owner/financial-feature-surveys', checkAuth, checkOwner, async (_req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('financial_module_feedback')
        .select('clinic_id,user_id,user_email,selected_features,notes,created_at');

      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post('/api/owner/bootstrap-finance', checkAuth, checkOwner, async (req: any, res) => {
    try {
      const ownerId = req.session.user?.id;
      const today = new Date();
      const periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const periodStartStr = periodStart.toISOString().split('T')[0];
      const periodEndStr = periodEnd.toISOString().split('T')[0];

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, plan_name, plan_price, subscription_status')
        .not('plan_price', 'is', null);

      if (usersError) throw usersError;

      const { data: existingRevenue, error: existingRevenueError } = await supabase
        .schema('finance')
        .from('revenue_entries')
        .select('id')
        .eq('notes', '[AUTO_BOOTSTRAP]')
        .gte('billed_on', periodStartStr)
        .lte('billed_on', periodEndStr)
        .limit(1);

      if (existingRevenueError && !hasMissingFinancialSchema(existingRevenueError)) {
        throw existingRevenueError;
      }

      if ((existingRevenue || []).length === 0) {
        const revenueRows = (users || [])
          .filter((u: any) => Number(u.plan_price || 0) > 0)
          .map((u: any) => ({
            customer_id: u.id,
            plan_name: u.plan_name || 'Nao definido',
            billed_on: periodStartStr,
            due_date: periodEndStr,
            gross_amount: Number(u.plan_price || 0),
            discounts: 0,
            taxes: 0,
            status: u.subscription_status === 'active' ? 'paid' : u.subscription_status === 'delinquent' ? 'delinquent' : 'pending',
            notes: '[AUTO_BOOTSTRAP]',
            created_by: ownerId
          }));

        if (revenueRows.length > 0) {
          const { error: revenueInsertError } = await supabase
            .schema('finance')
            .from('revenue_entries')
            .insert(revenueRows);
          if (revenueInsertError) throw revenueInsertError;
        }
      }

      const { data: existingCosts, error: existingCostsError } = await supabase
        .schema('finance')
        .from('cost_entries')
        .select('id')
        .eq('notes', '[AUTO_BOOTSTRAP]')
        .gte('occurred_on', periodStartStr)
        .lte('occurred_on', periodEndStr)
        .limit(1);

      if (existingCostsError && !hasMissingFinancialSchema(existingCostsError)) {
        throw existingCostsError;
      }

      if ((existingCosts || []).length === 0) {
        const fixedCostRows = [
          {
            cost_type: 'fixed',
            description: 'Infraestrutura cloud e ferramentas',
            occurred_on: periodStartStr,
            amount: 1200,
            is_operational: true,
            notes: '[AUTO_BOOTSTRAP]',
            created_by: ownerId
          },
          {
            cost_type: 'fixed',
            description: 'Operacoes administrativas',
            occurred_on: periodStartStr,
            amount: 900,
            is_operational: true,
            notes: '[AUTO_BOOTSTRAP]',
            created_by: ownerId
          }
        ];

        const variableCostRows = (users || [])
          .filter((u: any) => Number(u.plan_price || 0) > 0)
          .map((u: any) => ({
            cost_type: 'variable',
            customer_id: u.id,
            description: 'Custo variavel estimado por cliente',
            occurred_on: periodStartStr,
            amount: Number((Number(u.plan_price || 0) * 0.25).toFixed(2)),
            is_operational: true,
            notes: '[AUTO_BOOTSTRAP]',
            created_by: ownerId
          }));

        const { error: costsInsertError } = await supabase
          .schema('finance')
          .from('cost_entries')
          .insert([...fixedCostRows, ...variableCostRows]);
        if (costsInsertError) throw costsInsertError;
      }

      return res.json({
        success: true,
        message: 'Base financeira inicial criada com sucesso.'
      });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  // --- ADMIN ROUTES ---
  const checkAdmin = (req: any, res: any, next: any) => {
    if (req.session.user && req.session.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ error: 'Acesso negado. Apenas administradores podem acessar esta rota.' });
    }
  };

  app.get('/api/admin/stats', checkAuth, checkAdmin, async (req, res) => {
    try {
      // Get total users
      const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
      
      // Get active subscriptions
      const { count: activeUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_status', 'active');

      // Get delinquent users
      const { count: delinquentUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_status', 'delinquent');

      // Calculate MRR (Monthly Recurring Revenue)
      const { data: activeProfiles } = await supabase
        .from('users')
        .select('plan_price')
        .eq('subscription_status', 'active');
      
      const mrr = activeProfiles?.reduce((sum, p) => sum + (p.plan_price || 0), 0) || 0;

      res.json({
        success: true,
        stats: {
          totalUsers,
          activeUsers,
          delinquentUsers,
          mrr
        }
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/admin/clients', checkAuth, checkAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/clinic/dre', checkAuth, async (req, res) => {
    try {
      const user = req.session.user;
      const clinicId = user.clinic_id || user.id; // If they are the owner/coordinator, their ID might be the clinicId
      
      // Aggregate data for the clinic
      // In a real app, we'd query sessions, payments, and expenses filtered by clinic_id
      
      // Mock data for now, but scoped to the clinic
      const dre = {
        revenue: 25450.00,
        costs: 12300.00,
        expenses: 4500.00,
        profit: 8650.00,
        byProfessional: {
          'Dra. Raísa': 8500.00,
          'Dr. Marcos': 7200.00,
          'Dra. Ana': 6800.00,
          'Outros': 2950.00
        },
        byService: {
          'ABA': 12400.00,
          'TCC': 8200.00,
          'Fonoaudiologia': 4850.00
        },
        monthly: [
          { month: 'Jan', revenue: 22000, profit: 7200 },
          { month: 'Fev', revenue: 23500, profit: 7800 },
          { month: 'Mar', revenue: 25450, profit: 8650 }
        ]
      };
      
      res.json({ success: true, data: dre });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/admin/dre', checkAuth, checkAdmin, async (req, res) => {
    try {
      // This would ideally aggregate data from a 'transactions' or 'revenue' table
      // For now, we'll aggregate from the 'users' table based on their active plans
      const { data: profiles } = await supabase
        .from('users')
        .select('plan_name, plan_price, subscription_status')
        .eq('subscription_status', 'active');

      const dre = {
        revenue: profiles?.reduce((sum, p) => sum + (p.plan_price || 0), 0) || 0,
        byPlan: profiles?.reduce((acc: any, p) => {
          const plan = p.plan_name || 'Desconhecido';
          acc[plan] = (acc[plan] || 0) + (p.plan_price || 0);
          return acc;
        }, {})
      };

      res.json({ success: true, data: dre });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/admin/refund', checkAuth, checkAdmin, async (req, res) => {
    const { stripeSessionId, amount } = req.body;
    try {
      const stripe = getStripe();
      // In a real app, we'd find the charge ID from the session
      // For now, this is a placeholder for the Stripe API call
      // const refund = await stripe.refunds.create({ charge: chargeId, amount: amount * 100 });
      res.json({ success: true, message: 'Reembolso processado com sucesso (Simulado)' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/admin/charge', checkAuth, checkAdmin, async (req, res) => {
    const { userId } = req.body;
    try {
      // Logic to trigger a manual charge or retry via Stripe
      res.json({ success: true, message: 'Cobrança iniciada com sucesso (Simulado)' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // --- STRIPE ROUTES ---
  app.post('/api/stripe/create-checkout-registration', async (req, res) => {
    try {
      const safeEmail = sanitizeEmail(req.body?.email);
      const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
      const password = validateStrongPassword(rawPassword);
      const safeName = sanitizeString(req.body?.name, 180);
      const safeCrp = sanitizeString(req.body?.crp, 80);
      const requestedPlan = normalizeProfessionalPlan(req.body?.planName || '') || sanitizeString(req.body?.planName, 80);

      if (!safeEmail || !password || !safeName || !requestedPlan) {
        return res.status(400).json({ error: 'Dados obrigatórios ausentes para checkout do cadastro profissional.' });
      }
      if (!['Essencial', 'Crescimento', 'Avançado'].includes(requestedPlan)) {
        return res.status(400).json({ error: 'Plano profissional inválido.' });
      }

      const planPricesCents: Record<string, number> = {
        Essencial: 14990,
        Crescimento: 39990,
        Avançado: 67990
      };
      const planPricesDecimal: Record<string, number> = {
        Essencial: 149.90,
        Crescimento: 399.90,
        Avançado: 679.90
      };

      let userId: string | null = null;
      const existingAuthUser = await findAuthUserByEmail(safeEmail);
      if (existingAuthUser?.id) {
        const { data: existingProfile } = await supabase
          .from('users')
          .select('id, role, subscription_status')
          .eq('id', existingAuthUser.id)
          .maybeSingle();

        const existingRole = sanitizeString(existingProfile?.role, 40).toLowerCase();
        const existingSub = sanitizeString(existingProfile?.subscription_status, 40).toLowerCase();
        if (existingRole === 'patient') {
          return res.status(409).json({ error: 'Este e-mail já está cadastrado como paciente.' });
        }
        if (existingSub === 'active') {
          return res.status(409).json({ error: 'Este e-mail já possui assinatura ativa. Faça login.' });
        }

        userId = sanitizeString(existingAuthUser.id, 120);
        const { error: updateExistingError } = await supabase
          .from('users')
          .update({
            name: safeName,
            role: 'coordinator',
            plan_name: requestedPlan,
            plan_price: planPricesDecimal[requestedPlan] || null,
            subscription_status: 'pending',
            crp: safeCrp || undefined,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);
        if (updateExistingError) {
          const fallbackMissingCrp = String(updateExistingError?.message || '').toLowerCase().includes('crp');
          if (!fallbackMissingCrp) throw updateExistingError;
          const { error: fallbackUpdateError } = await supabase
            .from('users')
            .update({
              name: safeName,
              role: 'coordinator',
              plan_name: requestedPlan,
              plan_price: planPricesDecimal[requestedPlan] || null,
              subscription_status: 'pending',
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);
          if (fallbackUpdateError) throw fallbackUpdateError;
        }
      } else {
        const signupResult = await registerUserWithEmailConfirmation(
          {
            email: safeEmail,
            password,
            name: safeName,
            role: 'professional',
            intendedRole: 'coordinator',
            planName: requestedPlan,
            crp: safeCrp
          },
          { deferActivationEmail: true }
        );

        if (!signupResult.ok) {
          return res.status(signupResult.status).json(signupResult.body);
        }
        userId = sanitizeString((signupResult.body as any)?.userId, 120);
      }

      if (!userId) {
        return res.status(500).json({ error: 'Não foi possível preparar o cadastro para pagamento.' });
      }

      const stripe = getStripe();
      const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'brl',
              product_data: {
                name: `Plano ${requestedPlan} - Verto`
              },
              unit_amount: planPricesCents[requestedPlan],
              recurring: {
                interval: 'month'
              }
            },
            quantity: 1
          }
        ],
        mode: 'subscription',
        success_url: `${origin}/?payment=success&mode=professional-signup`,
        cancel_url: `${origin}/?payment=cancel&mode=professional-signup`,
        customer_email: safeEmail,
        metadata: {
          flowType: 'professional_signup',
          userId,
          clinicId: userId,
          planName: requestedPlan
        },
        subscription_data: {
          metadata: {
            flowType: 'professional_signup',
            userId,
            clinicId: userId,
            planName: requestedPlan
          }
        }
      });

      return res.json({ success: true, url: session.url });
    } catch (error: any) {
      console.error('[Stripe] create-checkout-registration error:', {
        message: error?.message || String(error),
        code: error?.code || null,
        details: error?.details || null
      });
      return res.status(500).json({
        error: error?.message || 'Erro ao iniciar pagamento do cadastro profissional.'
      });
    }
  });

  app.post('/api/stripe/create-checkout', checkAuth, async (req, res) => {
    try {
      const user = req.session.user;
      const { planName: requestedPlan } = req.body;
      
      console.log('Creating checkout for user:', user.id, user.email, user.role, requestedPlan);
      
      // Determine price
      let amount = 0;
      let description = '';
      
      if (user.role === 'patient') {
        amount = 490; // R$ 4,90 in cents
        description = 'Assinatura Mensal Paciente - Verto';
      } else {
        // Professional plans
        const planPrices: Record<string, number> = {
          'Essencial': 14990,
          'Crescimento': 39990,
          'Avançado': 67990
        };
        
        let planName = normalizeProfessionalPlan(requestedPlan) || requestedPlan;
        
        if (!planName) {
          // Try to get plan from profile if not in session
          const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('plan_name')
            .eq('id', user.id)
            .single();
            
          if (profileError) {
            console.warn('Could not fetch user profile for plan:', profileError.message);
          }
          planName = normalizeProfessionalPlan(profile?.plan_name) || profile?.plan_name || null;
        }

        if (!planName) {
          return res.status(400).json({ error: 'Selecione um plano para continuar.' });
        }

        if (!planPrices[planName]) {
          return res.status(400).json({ error: 'Plano invalido para checkout.' });
        }

        if (requestedPlan) {
          // Update user profile with selected plan if it was passed in body
          const planPrice = planName === 'Essencial' ? 149.90 : planName === 'Crescimento' ? 399.90 : 679.90;
          const { error: updateError } = await supabase
            .from('users')
            .update({ plan_name: planName, plan_price: planPrice })
            .eq('id', user.id);
            
          if (updateError) {
            console.error('Error updating user plan before checkout:', updateError);
          }
          
          // Also update session user
          if (req.session.user) {
            req.session.user.planName = planName;
            req.session.user.planPrice = planPrice;
          }
        }
        
        amount = planPrices[planName];
        description = `Plano ${planName} - Verto`;
      }

      console.log('Checkout details:', { amount, description });

      let stripe;
      try {
        stripe = getStripe();
      } catch (stripeInitError: any) {
        console.error('Stripe initialization failed:', stripeInitError.message);
        return res.status(500).json({ 
          error: 'O Stripe não está configurado corretamente no servidor.',
          details: stripeInitError.message 
        });
      }

      const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
      
      const clinicId = sanitizeString(
        user.activeWorkspaceId || user.clinicId || user.id,
        120
      );

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'brl',
              product_data: {
                name: description,
              },
              unit_amount: amount,
              recurring: {
                interval: 'month',
              },
            },
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: `${origin}/?payment=success`,
        cancel_url: `${origin}/?payment=cancel`,
        customer_email: user.email,
        metadata: {
          userId: user.id,
          clinicId
        },
        subscription_data: {
          metadata: {
            userId: user.id,
            clinicId
          }
        }
      });

      console.log('Stripe session created:', session.id);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error('Stripe checkout error:', error);
      res.status(500).json({ 
        error: error.message || 'Erro ao criar sessão de pagamento',
        details: process.env.NODE_ENV === 'production' ? undefined : error.stack
      });
    }
  });

  app.get('/api/stripe/clinic-billing-summary', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      if (!clinicId || !isUuid(clinicId)) {
        return res.status(400).json({ error: 'Workspace da clínica não identificado.' });
      }

      const summary = await getClinicBillingSummary({
        supabase,
        clinicId
      });

      res.json({
        success: true,
        data: summary
      });
    } catch (error: any) {
      console.error('[Billing Summary] Erro ao gerar resumo da clínica:', error);
      res.status(500).json({
        success: false,
        error: error?.message || 'Falha ao carregar resumo de cobrança.'
      });
    }
  });

  // Catch-all for API routes that don't exist to prevent falling through to Vite/SPA fallback
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Frontend não encontrado. Certifique-se de que o build foi executado corretamente.');
      }
    });
  }

  // Global Error Handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('SERVER ERROR:', err);
    
    if (res.headersSent) {
      return next(err);
    }
    
    res.status(500).json({ 
      error: err.message || 'Ocorreu um erro no servidor.',
      details: err.stack
    });
  });

  const activePatientPriceId = resolveActivePatientPriceId();
  if (activePatientPriceId) {
    const runDailyBillingSync = async (trigger: string) => {
      try {
        await syncAllClinicsActivePatientAddonQuantity({
          supabase,
          stripe: getStripe(),
          activePatientPriceId,
          logger: console
        });
        console.log('[Stripe Sync] Lote diário concluído.', { trigger });
      } catch (error: any) {
        console.error('[CRITICAL] Falha no lote diário de sync Stripe (não bloqueante).', {
          trigger,
          message: error?.message || String(error)
        });
      }
    };

    setTimeout(() => {
      void runDailyBillingSync('startup_warmup');
    }, 90 * 1000);

    setInterval(() => {
      void runDailyBillingSync('daily_interval');
    }, 24 * 60 * 60 * 1000);
  } else {
    console.warn('[Stripe Sync] STRIPE_ACTIVE_PATIENT_PRICE_ID não configurado. Sync de pacientes ativos desabilitado.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('FATAL ERROR STARTING SERVER:', err);
  process.exit(1);
});





