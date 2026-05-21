import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pg from 'pg';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import { Resend } from 'resend';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import webpush from 'web-push';
import { generateSecret, verifySync, generateURI } from 'otplib';
import QRCode from 'qrcode';
import {
  createClinicMeteredSubscription,
  getClinicBillingSummary,
  reportAllClinicsActivePatientUsage,
  syncAllClinicsActivePatientAddonQuantity,
  syncClinicActivePatientAddonQuantity
} from './services/stripeService';
import { startAppointmentReminderCron, triggerAppointmentReminderScan } from './services/cronService';
import {
  removePatientPushSubscription,
  resolvePatientIdsForPush,
  savePatientPushSubscription,
  sendAppointmentNotification
} from './services/pushNotificationService';
import {
  buildActivationEmailTemplate,
  buildPasswordRecoveryEmailTemplate
} from './src/services/emailTemplates';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // ignore when runtime doesn't support this API
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

let resendClient: Resend | null = null;
function getResend() {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

const vapidPublicKey = sanitizeString(process.env.VAPID_PUBLIC_KEY || '', 500);
const vapidPrivateKey = sanitizeString(process.env.VAPID_PRIVATE_KEY || '', 500);
const vapidSubject =
  sanitizeString(process.env.VAPID_EMAIL || process.env.VAPID_SUBJECT || process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '', 500) ||
  'mailto:suporte@appverto.com.br';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
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

function isMeteredActivePatientBilling(): boolean {
  const mode = sanitizeString(process.env.STRIPE_ACTIVE_PATIENT_BILLING_MODE || 'metered', 40).toLowerCase();
  return mode !== 'legacy_quantity';
}

function queueActivePatientSync(clinicId: string | null | undefined, trigger: string) {
  const safeClinicId = sanitizeString(clinicId, 120);
  const activePatientPriceId = resolveActivePatientPriceId();
  if (!safeClinicId || !activePatientPriceId) return;
  if (isMeteredActivePatientBilling()) {
    console.log('[Stripe Usage] Billing metered ativo; sync imediato de quantidade ignorado até o fechamento mensal.', {
      clinicId: safeClinicId,
      trigger
    });
    return;
  }

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

function resolveProfessionalPlanPriceId(planName: string | null | undefined): string {
  const normalizedPlan = normalizeProfessionalPlan(planName || '');
  if (!normalizedPlan) return '';

  const envNames: Record<string, string[]> = {
    Essencial: ['STRIPE_PRICE_ESSENCIAL', 'STRIPE_ESSENCIAL_PRICE_ID'],
    Crescimento: ['STRIPE_PRICE_CRESCIMENTO', 'STRIPE_CRESCIMENTO_PRICE_ID'],
    Avançado: ['STRIPE_PRICE_AVANCADO', 'STRIPE_AVANCADO_PRICE_ID', 'STRIPE_PRICE_AVANÇADO']
  };

  for (const envName of envNames[normalizedPlan] || []) {
    const priceId = sanitizeString(process.env[envName] || '', 160);
    if (priceId) return priceId;
  }

  return '';
}

function resolveProfessionalPlanByPriceId(priceId: string | null | undefined): 'Essencial' | 'Crescimento' | 'Avançado' | null {
  const safePriceId = sanitizeString(priceId, 160);
  if (!safePriceId) return null;

  const planNames: Array<'Essencial' | 'Crescimento' | 'Avançado'> = ['Essencial', 'Crescimento', 'Avançado'];
  for (const planName of planNames) {
    if (resolveProfessionalPlanPriceId(planName) === safePriceId) {
      return planName;
    }
  }

  return null;
}

function generateTemporaryCheckoutPassword(): string {
  return `Verto#${crypto.randomBytes(12).toString('base64url')}9aA!`;
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

async function readOptionalScalarColumn(params: {
  table: 'users' | 'clinics';
  match: { column: string; value: string };
  column: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from(params.table)
      .select(`${params.column}`)
      .eq(params.match.column, params.match.value)
      .maybeSingle();
    if (error) return null;
    const value = sanitizeString((data as any)?.[params.column], 200);
    return value || null;
  } catch {
    return null;
  }
}

async function patchTableSafely(
  table: 'users' | 'clinics' | 'patients',
  matcher: { column: string; value: string },
  patch: Record<string, any>
): Promise<void> {
  let safePatch: Record<string, any> = cleanObject(patch);
  while (Object.keys(safePatch).length > 0) {
    const { error } = await supabase
      .from(table)
      .update(safePatch)
      .eq(matcher.column, matcher.value);
    if (!error) return;
    const missingColumn = extractMissingColumnName(error);
    if (!missingColumn || !(missingColumn in safePatch)) return;
    delete safePatch[missingColumn];
  }
}

async function persistStripeCustomerReference(params: {
  customerId: string;
  email?: string | null;
  userId?: string | null;
  clinicId?: string | null;
}) {
  const customerId = sanitizeString(params.customerId, 200);
  if (!customerId) return;
  const userId = sanitizeString(params.userId, 120);
  const clinicId = sanitizeString(params.clinicId, 120);
  const safeEmail = sanitizeEmail(params.email);

  if (userId) {
    await patchTableSafely('users', { column: 'id', value: userId }, {
      stripe_customer_id: customerId,
      stripe_customer_email: safeEmail || undefined,
      updated_at: new Date().toISOString()
    });
  }
  if (safeEmail) {
    await patchTableSafely('users', { column: 'email', value: safeEmail }, {
      stripe_customer_id: customerId,
      stripe_customer_email: safeEmail,
      updated_at: new Date().toISOString()
    });
  }
  if (clinicId) {
    await patchTableSafely('clinics', { column: 'id', value: clinicId }, {
      stripe_customer_id: customerId,
      stripe_customer_email: safeEmail || undefined,
      updated_at: new Date().toISOString()
    });
  }
}

async function persistStripeSubscriptionReference(params: {
  subscriptionId?: string | null;
  subscriptionItemId?: string | null;
  customerId?: string | null;
  email?: string | null;
  userId?: string | null;
  clinicId?: string | null;
  status?: string | null;
}) {
  const subscriptionId = sanitizeString(params.subscriptionId, 200);
  const subscriptionItemId = sanitizeString(params.subscriptionItemId, 200);
  const customerId = sanitizeString(params.customerId, 200);
  const userId = sanitizeString(params.userId, 120);
  const clinicId = sanitizeString(params.clinicId, 120);
  const safeEmail = sanitizeEmail(params.email);
  const status = normalizeSubscriptionStatusFromStripe(sanitizeString(params.status, 80));
  const patch = cleanObject({
    stripe_subscription_id: subscriptionId || undefined,
    stripe_subscription_item_id: subscriptionItemId || undefined,
    stripe_customer_id: customerId || undefined,
    stripe_customer_email: safeEmail || undefined,
    subscription_status: status,
    updated_at: new Date().toISOString()
  });

  if (clinicId) {
    await patchTableSafely('clinics', { column: 'id', value: clinicId }, patch);
  }
  if (userId) {
    await patchTableSafely('users', { column: 'id', value: userId }, patch);
  } else if (safeEmail) {
    await patchTableSafely('users', { column: 'email', value: safeEmail }, patch);
  }
}

async function markClinicPaymentFailed(params: {
  clinicId?: string | null;
  userId?: string | null;
  email?: string | null;
  invoiceId?: string | null;
}) {
  const blockedAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    subscription_status: 'delinquent',
    stripe_payment_failed_at: new Date().toISOString(),
    stripe_access_block_at: blockedAt,
    stripe_last_failed_invoice_id: sanitizeString(params.invoiceId, 200) || undefined,
    updated_at: new Date().toISOString()
  };
  const clinicId = sanitizeString(params.clinicId, 120);
  const userId = sanitizeString(params.userId, 120);
  const email = sanitizeEmail(params.email);

  if (clinicId) await patchTableSafely('clinics', { column: 'id', value: clinicId }, payload);
  if (userId) await patchTableSafely('users', { column: 'id', value: userId }, payload);
  if (!userId && email) await patchTableSafely('users', { column: 'email', value: email }, payload);
}

async function clearClinicPaymentFailure(params: {
  clinicId?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  const payload = {
    subscription_status: 'active',
    stripe_payment_failed_at: null,
    stripe_access_block_at: null,
    stripe_last_failed_invoice_id: null,
    updated_at: new Date().toISOString()
  };
  const clinicId = sanitizeString(params.clinicId, 120);
  const userId = sanitizeString(params.userId, 120);
  const email = sanitizeEmail(params.email);

  if (clinicId) await patchTableSafely('clinics', { column: 'id', value: clinicId }, payload);
  if (userId) await patchTableSafely('users', { column: 'id', value: userId }, payload);
  if (!userId && email) await patchTableSafely('users', { column: 'email', value: email }, payload);
}

async function resolvePersistedStripeCustomerId(params: {
  userId?: string | null;
  clinicId?: string | null;
  email?: string | null;
}): Promise<string | null> {
  const userId = sanitizeString(params.userId, 120);
  const clinicId = sanitizeString(params.clinicId, 120);
  const email = sanitizeEmail(params.email);

  if (userId) {
    const byUserId = await readOptionalScalarColumn({
      table: 'users',
      match: { column: 'id', value: userId },
      column: 'stripe_customer_id'
    });
    if (byUserId) return byUserId;
  }
  if (clinicId) {
    const byClinicId = await readOptionalScalarColumn({
      table: 'clinics',
      match: { column: 'id', value: clinicId },
      column: 'stripe_customer_id'
    });
    if (byClinicId) return byClinicId;
  }
  if (email) {
    const byEmail = await readOptionalScalarColumn({
      table: 'users',
      match: { column: 'email', value: email },
      column: 'stripe_customer_id'
    });
    if (byEmail) return byEmail;
  }
  return null;
}

function normalizeProtocolKey(input?: string | null): string {
  return sanitizeString(input || '', 180)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function identifyVertoProtocolCandidate(input?: string | null): { canonicalKey: string; canonicalName: string; confidence: number } {
  const key = normalizeProtocolKey(input);
  if (/\bafls\b|assessment functional living skills|functional living skills/.test(key)) {
    return { canonicalKey: 'afls-social-participation-adult', canonicalName: 'AFLS - Habilidades de Participação Social', confidence: 0.94 };
  }
  if (/\bvb\s*mapp\s*2\b|\bvbmapp\s*2\b|\bvb\s*mapp\s*nivel\s*2\b|\bvb\s*mapp\s*level\s*2\b|\b18\s*a\s*30\b|\b18\s*30\b/.test(key)) {
    return { canonicalKey: 'vb-mapp-level-2', canonicalName: 'VB-MAPP - Nivel 2', confidence: 0.92 };
  }
  if (/\bvb\s*mapp\s*3\b|\bvbmapp\s*3\b|\bvb\s*mapp\s*nivel\s*3\b|\bvb\s*mapp\s*level\s*3\b|\b30\s*a\s*48\b|\b30\s*48\b/.test(key)) {
    return { canonicalKey: 'vb-mapp-level-3', canonicalName: 'VB-MAPP - Nivel 3', confidence: 0.92 };
  }
  if (/\bvb\s*mapp\b|\bvbmapp\b|verbal behavior milestones/.test(key)) {
    return { canonicalKey: 'vb-mapp-level-1', canonicalName: 'VB-MAPP - Nivel 1', confidence: 0.9 };
  }
  if (/\bablls\b|\bablls r\b|basic language learning skills/.test(key)) {
    return { canonicalKey: 'ablls-r', canonicalName: 'ABLLS-R', confidence: 0.86 };
  }
  if (/\bvineland\b/.test(key)) {
    return { canonicalKey: 'vineland', canonicalName: 'Vineland', confidence: 0.82 };
  }
  return { canonicalKey: 'manual-review', canonicalName: 'Analise manual necessaria', confidence: 0.35 };
}

function normalizeApprovedProtocolKey(input?: string | null): string {
  const key = sanitizeString(input, 180);
  if (key === 'afls' || key === 'afls-social-participation' || key === 'afls-community') {
    return 'afls-social-participation-adult';
  }
  if (key === 'vb-mapp-level-2' || key === 'vb-mapp-nivel-2' || key === 'vbmapp2' || key === 'vb-mapp2') {
    return 'vb-mapp-level-2';
  }
  if (key === 'vb-mapp-level-3' || key === 'vb-mapp-nivel-3' || key === 'vbmapp3' || key === 'vb-mapp3') {
    return 'vb-mapp-level-3';
  }
  if (key === 'vb-mapp' || key === 'vbmapp' || key === 'vb mapp' || key === 'vb-mapp-nivel-1') {
    return 'vb-mapp-level-1';
  }
  return key;
}

const VERTO_PROTOCOL_CATALOG = [
  {
    key: 'afls-social-participation-adult',
    name: 'AFLS - Habilidades de Participação Social',
    ageMin: 18,
    ageMax: null,
    applicableAgeGroup: 'adult',
    completionPercent: 100,
    statusLabel: 'Completo'
  },
  {
    key: 'vb-mapp-level-1',
    name: 'VB-MAPP - Nivel 1',
    ageMin: 0,
    ageMax: 1.5,
    applicableAgeGroup: 'child',
    completionPercent: 100,
    statusLabel: 'Completo'
  },
  {
    key: 'vb-mapp-level-2',
    name: 'VB-MAPP - Nivel 2',
    ageMin: 1.5,
    ageMax: 2.5,
    applicableAgeGroup: 'child',
    completionPercent: 100,
    statusLabel: 'Completo'
  },
  {
    key: 'vb-mapp-level-3',
    name: 'VB-MAPP - Nivel 3',
    ageMin: 2.5,
    ageMax: 4,
    applicableAgeGroup: 'child',
    completionPercent: 100,
    statusLabel: 'Completo'
  }
];

const VERTO_PROTOCOL_BY_KEY = new Map(VERTO_PROTOCOL_CATALOG.map((protocol) => [protocol.key, protocol]));
const VERTO_PROTOCOL_PANEL_RESET_AT = '2026-05-07T15:38:23.081Z';

function buildProtocolAccessScopeKey(params: { clinicId?: any; requesterUserId?: any; requesterEmail?: any }): string {
  const clinicId = sanitizeString(params.clinicId, 120);
  if (clinicId) return `clinic:${clinicId}`;
  const requesterUserId = sanitizeString(params.requesterUserId, 120);
  if (requesterUserId) return `user:${requesterUserId}`;
  const requesterEmail = sanitizeEmail(params.requesterEmail);
  if (requesterEmail) return `email:${requesterEmail}`;
  return 'unknown';
}

async function loadProtocolAccessMap(): Promise<Map<string, string[]>> {
  const accessMap = new Map<string, string[]>();
  try {
    const { data } = await supabase
      .from('activity_logs')
      .select('payload_details, timestamp')
      .eq('type', 'protocol_access_updated')
      .eq('is_active', true)
      .is('deleted_at', null)
      .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
      .order('timestamp', { ascending: true })
      .limit(1000);

    for (const log of data || []) {
      try {
        const payload = JSON.parse(String((log as any).payload_details || '{}'));
        const scopeKey = sanitizeString(payload.scopeKey, 220);
        if (!scopeKey) continue;
        const protocolKeys = Array.isArray(payload.protocolKeys)
          ? payload.protocolKeys.map((key: any) => normalizeApprovedProtocolKey(key)).filter((key: string) => VERTO_PROTOCOL_BY_KEY.has(key))
          : [];
        accessMap.set(scopeKey, Array.from(new Set(protocolKeys)));
      } catch {
        // Ignore malformed access history entries.
      }
    }
  } catch {
    // Access history is additive; if it is unavailable, callers fall back to no assignments.
  }
  return accessMap;
}

function normalizeBrazilMobilePhone(value: unknown): string | null {
  const digits = sanitizeString(value, 40).replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('55') && digits.length >= 13
    ? digits.slice(2)
    : digits;
  if (!/^\d{11}$/.test(normalized)) return null;
  if (normalized[2] !== '9') return null;
  return normalized;
}

function normalizeCpf(value: unknown): string | null {
  const digits = sanitizeString(value, 32).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== 11) return null;
  return digits;
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

function resolveStoredCrp(input: any): string | null {
  const raw = (
    sanitizeString(input?.crp, 80) ||
    sanitizeString(input?.council_number, 80) ||
    sanitizeString(input?.councilNumber, 80) ||
    sanitizeString(input?.clinicSettings?.councilNumber, 80) ||
    null
  );
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  if (digits.length <= 2) return digits || null;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function resolveStoredCouncil(input: any): string | null {
  return sanitizeString(input?.council, 80) || null;
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

function uuidFromStableString(value: string): string {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  const variant = Number.parseInt(hex[16] || '8', 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function generate6DigitOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function generateTemporaryPassword(length = 20): string {
  const safeLength = Math.max(16, Math.min(length, 64));
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  const symbols = '!@#$%*()-_=+?';
  const all = `${lower}${upper}${numbers}${symbols}`;

  const pick = (chars: string) => chars[crypto.randomInt(0, chars.length)];
  const chars: string[] = [
    pick(lower),
    pick(upper),
    pick(numbers),
    pick(symbols)
  ];
  while (chars.length < safeLength) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
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

function getActivationRedirectUrl(role?: unknown, email?: unknown): string {
  const baseUrl = sanitizeString(
    process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '',
    500
  );
  if (!baseUrl) {
    throw new Error('VERTO_APP_BASE_URL (ou APP_BASE_URL) deve estar definida para ativação de conta.');
  }
  const normalizedRole = sanitizeString(role, 40).toLowerCase();
  const roleParam = normalizedRole === 'patient' ? 'patient' : 'coordinator';
  const safeEmail = sanitizeEmail(email);
  const emailParam = safeEmail ? `&email=${encodeURIComponent(safeEmail)}` : '';
  return `${baseUrl.replace(/\/+$/, '')}/ativar?role=${roleParam}${emailParam}`;
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
  if (!error) return '';
  if (typeof error === 'string') return sanitizeString(error, 1000);
  return sanitizeString(error?.message || error?.details || error?.hint || 'Unexpected error', 1000);
}

async function withTimeoutOrFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });
    const result = await Promise.race([promise, timeoutPromise]);
    if (result === fallback) {
      console.warn(`[Timeout] ${label} excedeu ${timeoutMs}ms; seguindo com fallback.`);
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SENSITIVE_LOG_KEY_REGEX =
  /(password|pass|token|secret|key|authorization|cookie|otp|code|mfa|session|refresh|access|bearer|credential)/i;

function redactForLogs(input: any): any {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    const trimmed = input.length > 500 ? `${input.slice(0, 500)}...[truncated]` : input;
    if (/bearer\s+[a-z0-9\-_\.]+/i.test(trimmed)) return '[redacted]';
    if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(trimmed)) return '[redacted-jwt]';
    if (trimmed.length >= 32 && /^[A-Za-z0-9\-_]+$/.test(trimmed)) return '[redacted]';
    return trimmed;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.slice(0, 20).map((item) => redactForLogs(item));
  if (typeof input === 'object') {
    const output: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      if (SENSITIVE_LOG_KEY_REGEX.test(key)) {
        output[key] = '[redacted]';
        continue;
      }
      output[key] = redactForLogs(value);
    }
    return output;
  }
  return String(input);
}

function isMissingRelationError(error: any): boolean {
  const code = sanitizeString(error?.code, 20).toUpperCase();
  const message = extractSupabaseErrorMessage(error).toLowerCase();
  if (code === '42P01') return true;
  return (
    message.includes('relation') && message.includes('does not exist')
  );
}

function extractMissingColumnName(error: any): string | null {
  const message = extractSupabaseErrorMessage(error);
  if (!message) return null;

  const directMatch = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (directMatch?.[1]) return sanitizeString(directMatch[1], 120).toLowerCase();

  const qualifiedMatch = message.match(/column\s+[a-zA-Z0-9_]+\."?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  if (qualifiedMatch?.[1]) return sanitizeString(qualifiedMatch[1], 120).toLowerCase();

  const postgrestCacheMatch = message.match(/could\s+not\s+find\s+the\s+'?([a-zA-Z0-9_]+)'?\s+column\s+of\s+'?[a-zA-Z0-9_]+'?\s+in\s+the\s+schema\s+cache/i);
  if (postgrestCacheMatch?.[1]) return sanitizeString(postgrestCacheMatch[1], 120).toLowerCase();

  return null;
}

function logRouteDbError(route: string, error: any, context: Record<string, any> = {}) {
  console.error(`[DB:${route}]`, {
    message: extractSupabaseErrorMessage(error),
    code: sanitizeString(error?.code, 40) || null,
    details: sanitizeString(error?.details, 300) || null,
    hint: sanitizeString(error?.hint, 300) || null,
    context: redactForLogs(context)
  });
}

function safeErrorMessageByStatus(statusCode: number): string {
  if (statusCode === 400) return 'Requisição inválida.';
  if (statusCode === 401) return 'Sessão expirada ou inválida. Faça login novamente.';
  if (statusCode === 403) return 'Acesso negado.';
  if (statusCode === 404) return 'Recurso não encontrado.';
  if (statusCode === 409) return 'Conflito de dados.';
  if (statusCode === 413) return 'Payload excede o limite permitido.';
  if (statusCode === 415) return 'Tipo de conteúdo não suportado.';
  if (statusCode === 422) return 'Dados inválidos para processamento.';
  if (statusCode === 429) return 'Muitas tentativas. Tente novamente em alguns instantes.';
  if (statusCode >= 500) return 'Erro interno do servidor.';
  return 'Não foi possível processar a requisição.';
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
  if (!id && kind === 'welcome_professional') {
    return 'bem-vindo-clnica';
  }
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
  const enforceRedirectTarget = (rawLink: string, redirectTo: string): string => {
    try {
      const parsed = new URL(rawLink);
      parsed.searchParams.set('redirect_to', redirectTo);
      return parsed.toString();
    } catch {
      return rawLink;
    }
  };

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
    if (!actionLink) return null;
    return enforceRedirectTarget(actionLink, params.redirectTo);
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
      metadata: redactForLogs(params.metadata || null)
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
const activeSessionByUserId = new Map<string, string>();
let otpTableChecked = false;
let otpTableAvailable = false;

function issueSessionToken(userId: string): string {
  const safeUserId = sanitizeString(userId, 120);
  const token = crypto.randomUUID();
  if (safeUserId) {
    activeSessionByUserId.set(safeUserId, token);
  }
  return token;
}

function invalidateActiveSession(userId?: unknown, expectedToken?: unknown): void {
  const safeUserId = sanitizeString(userId, 120);
  if (!safeUserId) return;
  const safeExpectedToken = sanitizeString(expectedToken, 120);
  const current = activeSessionByUserId.get(safeUserId);
  if (!safeExpectedToken || current === safeExpectedToken) {
    activeSessionByUserId.delete(safeUserId);
  }
}

async function ensureOtpTableAvailability(): Promise<boolean> {
  if (otpTableChecked) return otpTableAvailable;
  otpTableChecked = true;
  try {
    const { error } = await supabase
      .from('otp_challenges')
      .select('key')
      .limit(1);
    otpTableAvailable = !error;
    if (error) {
      console.warn('[OTP] otp_challenges indisponível, usando fallback em memória:', error.message);
    }
  } catch (error: any) {
    otpTableAvailable = false;
    console.warn('[OTP] Falha ao validar tabela otp_challenges, usando fallback em memória:', error?.message || String(error));
  }
  return otpTableAvailable;
}

function fromDbOtpRow(row: any): OtpChallenge | null {
  if (!row) return null;
  const key = sanitizeString(row.key, 200);
  if (!key) return null;
  const channel = sanitizeString(row.channel, 40) as RecoveryChannel;
  const purpose = sanitizeString(row.purpose, 60) as OtpPurpose;
  const identifier = sanitizeString(row.identifier, 320);
  const userId = sanitizeString(row.user_id, 120) || null;
  const codeHash = sanitizeString(row.code_hash, 500);
  const expiresAtIso = sanitizeString(row.expires_at, 80);
  const createdAtIso = sanitizeString(row.created_at, 80);
  const attempts = Math.max(0, Number(row.attempts || 0));
  const consumed = Boolean(row.consumed);
  const expiresAtMs = expiresAtIso ? new Date(expiresAtIso).getTime() : 0;
  const createdAtMs = createdAtIso ? new Date(createdAtIso).getTime() : Date.now();
  if (!identifier || !codeHash || !expiresAtMs) return null;
  return {
    key,
    channel: channel || 'email',
    purpose: purpose || 'password_recovery',
    identifier,
    userId,
    codeHash,
    expiresAt: expiresAtMs,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    consumed,
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now()
  };
}

async function setOtpChallenge(challenge: OtpChallenge): Promise<void> {
  const useDb = await ensureOtpTableAvailability();
  if (!useDb) {
    otpStore.set(challenge.key, challenge);
    return;
  }

  try {
    const payload = {
      key: sanitizeString(challenge.key, 200),
      channel: sanitizeString(challenge.channel, 40),
      purpose: sanitizeString(challenge.purpose, 60),
      identifier: sanitizeString(challenge.identifier, 320).toLowerCase(),
      user_id: sanitizeString(challenge.userId, 120) || null,
      code_hash: sanitizeString(challenge.codeHash, 500),
      expires_at: new Date(challenge.expiresAt).toISOString(),
      attempts: Math.max(0, Number(challenge.attempts || 0)),
      consumed: Boolean(challenge.consumed),
      created_at: new Date(challenge.createdAt || Date.now()).toISOString()
    };
    const { error } = await supabase
      .from('otp_challenges')
      .upsert(payload, { onConflict: 'key' });
    if (error) {
      console.warn('[OTP] Falha no upsert de otp_challenges, fallback memória:', error.message);
      otpStore.set(challenge.key, challenge);
    }
  } catch (error: any) {
    console.warn('[OTP] Exceção no upsert de otp_challenges, fallback memória:', error?.message || String(error));
    otpStore.set(challenge.key, challenge);
  }
}

async function getOtpChallenge(key: string): Promise<OtpChallenge | null> {
  const useDb = await ensureOtpTableAvailability();
  if (!useDb) {
    const challenge = otpStore.get(key);
    if (!challenge) return null;
    if (Date.now() > challenge.expiresAt || challenge.consumed) {
      otpStore.delete(key);
      return null;
    }
    return challenge;
  }

  try {
    const { data, error } = await supabase
      .from('otp_challenges')
      .select('*')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    const challenge = fromDbOtpRow(data);
    if (!challenge) return null;
    if (challenge.consumed || Date.now() > challenge.expiresAt) {
      await consumeOtpChallenge(key);
      return null;
    }
    return challenge;
  } catch {
    return null;
  }
}

async function consumeOtpChallenge(key: string): Promise<void> {
  const useDb = await ensureOtpTableAvailability();
  if (!useDb) {
    otpStore.delete(key);
    return;
  }

  try {
    await supabase
      .from('otp_challenges')
      .update({ consumed: true })
      .eq('key', key)
      .eq('consumed', false);
  } catch (error: any) {
    console.warn('[OTP] Falha ao consumir OTP na base:', error?.message || String(error));
  }
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
  const isSchemaCacheMissing =
    message.includes('could not find the') &&
    message.includes('column') &&
    message.includes('schema cache');

  if (columnName) {
    return (
      (message.includes(columnName.toLowerCase()) && message.includes('does not exist')) ||
      (isSchemaCacheMissing && message.includes(`'${columnName.toLowerCase()}'`))
    );
  }
  return message.includes('does not exist') || isSchemaCacheMissing;
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

function buildPostPaymentActivationEmail(token: string): string {
  const activationUrl = `https://appverto.com.br/register?token=${encodeURIComponent(token)}`;
  return `
    <div style="margin:0;padding:0;background:#f6f8ff;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8ff;padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 18px 45px rgba(17,24,39,0.08);">
              <tr>
                <td style="padding:32px;background:linear-gradient(135deg,#7a32fc 0%,#10b981 100%);color:#ffffff;">
                  <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;font-weight:800;">Verto</p>
                  <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:900;">Bem-vindo à Verto!</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#374151;">
                    Seu pagamento foi confirmado. Clique no botão abaixo para criar sua conta e acessar seu painel.
                  </p>
                  <a href="${activationUrl}" style="display:inline-block;background:#7a32fc;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:15px 22px;border-radius:16px;box-shadow:0 12px 28px rgba(122,50,252,0.25);">
                    Criar minha conta
                  </a>
                  <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
                    Se o botão não funcionar, copie e cole este link no navegador:<br>
                    <a href="${activationUrl}" style="color:#7a32fc;word-break:break-all;">${activationUrl}</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
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

function parseStoredJsonObject(input: any): Record<string, any> {
  if (!input) return {};
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  if (typeof input !== 'string') return {};

  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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
    if (
      (key === 'content' || key === 'dataUrl') &&
      typeof value === 'string' &&
      /^data:(application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel);base64,[a-z0-9+/=\s]+$/i.test(value) &&
      value.length <= 14_000_000
    ) {
      safe[key] = sanitizeString(value, 14_000_000);
      continue;
    }
    if (
      key === 'dataUrl' &&
      typeof value === 'string' &&
      /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(value) &&
      value.length <= 8_000_000
    ) {
      safe[key] = sanitizeString(value, 8_000_000);
      continue;
    }
    safe[key] = sanitizeClinicalPayload(value, depth + 1);
  }
  return safe;
}

function isAllowedScreenshotDataUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
    && value.length <= 8_000_000;
}

function buildScreenshotEvidenceSummary(params: {
  totalPages?: number | null;
  coverageMaxPage?: number | null;
  applicableAgeGroup?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  screenshots: Array<{ pageNumber: number; prompt?: string | null }>;
}): string {
  const pages = params.screenshots.map((shot) => shot.pageNumber).filter((page) => Number.isFinite(page));
  const hasAgeRange = Number.isFinite(Number(params.ageMin));
  const ageLabel = hasAgeRange
    ? `${Number(params.ageMin)} ate ${Number.isFinite(Number(params.ageMax)) ? Number(params.ageMax) : '+'} anos`
    : params.applicableAgeGroup === 'child'
    ? 'Criancas'
    : params.applicableAgeGroup === 'teen'
      ? 'Adolescentes'
      : params.applicableAgeGroup === 'adult'
        ? 'Adultos'
        : 'Todas as idades';
  return [
    `Modo de validacao: screenshots enviados pelo cliente`,
    `Faixa etaria declarada: ${ageLabel}`,
    params.totalPages ? `Paginas totais declaradas: ${params.totalPages}` : null,
    params.coverageMaxPage ? `Janela de amostragem: 1 ate ${params.coverageMaxPage}` : null,
    `Capturas recebidas: ${pages.length}`,
    pages.length ? `Paginas conferidas: ${pages.join(', ')}` : 'Paginas conferidas: nenhuma',
    'Arquivo bruto nao foi aberto. A revisao deve ocorrer pelas miniaturas e pela correspondencia com o protocolo canonico.'
  ].filter(Boolean).join('\n');
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

function sanitizeReceiptUrl(value: unknown): string | null {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return null;
  if (url.startsWith('data:image/') || url.startsWith('data:application/pdf')) {
    if (url.length > 2_000_000) return null;
    return url;
  }
  return sanitizeUrl(url);
}

function sanitizeSessionUrl(value: unknown): string | null {
  const url = sanitizeUrl(value);
  if (!url) return null;
  // Never keep large data URLs inside session payload.
  if (url.startsWith('data:image/')) return null;
  return sanitizeString(url, 1500);
}

function extractPatientPhotosStoragePath(raw: unknown): string | null {
  const value = sanitizeString(raw, 1500);
  if (!value) return null;
  if (value.startsWith('onboarding/')) return value;
  if (value.startsWith('patients/')) return value;
  if (!value.includes('://') && value.includes('/') && !value.startsWith('data:')) return value;
  if (value.startsWith('patient-photos/')) {
    const pathPart = value.slice('patient-photos/'.length);
    return pathPart ? pathPart : null;
  }
  const marker = '/storage/v1/object/sign/patient-photos/';
  if (value.includes(marker)) {
    const encodedPath = value.split(marker)[1]?.split('?')[0] || '';
    if (!encodedPath) return null;
    try {
      return decodeURIComponent(encodedPath);
    } catch {
      return encodedPath;
    }
  }
  return null;
}

async function resolvePatientPhotoUrl(rawUrl: unknown, rawPath?: unknown): Promise<string | null> {
  const storagePath = extractPatientPhotosStoragePath(rawPath) || extractPatientPhotosStoragePath(rawUrl);
  if (storagePath) {
    try {
      const { data } = await supabase.storage.from('patient-photos').createSignedUrl(storagePath, 60 * 60 * 24 * 30);
      if (data?.signedUrl) return data.signedUrl;
    } catch (error: any) {
      console.warn('[PatientProfile] signed photo url warning:', error?.message || String(error));
    }
  }
  return sanitizeSessionUrl(rawUrl);
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
type ProtocolScanStatus = 'clean' | 'blocked';

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

function decodeSafeDataUrl(input: string): { buffer: Buffer; mime: string } | null {
  const match = String(input || '').match(/^data:([^;]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    return buffer.length ? { buffer, mime: normalizeMime(match[1]) } : null;
  } catch {
    return null;
  }
}

function detectProtocolFileKind(buffer: Buffer): 'pdf' | 'xlsx' | 'xls' | 'unknown' {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'xlsx';
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'xls';
  return 'unknown';
}

function sanitizeSafePreviewText(input: string, maxLength = 4000): string {
  return sanitizeString(
    String(input || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    maxLength
  );
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function extractProtocolReadableText(buffer: Buffer, kind: 'pdf' | 'xlsx' | 'xls' | 'unknown'): string {
  if (kind !== 'pdf') return '';

  const rawText = buffer.subarray(0, Math.min(buffer.length, 1_800_000)).toString('latin1');
  const chunkCandidates = rawText
    .replace(/\\[rn]/g, '\n')
    .split(/(?:\r?\n|endstream|endobj|stream|obj|BT|ET)+/i)
    .map((chunk) => sanitizeSafePreviewText(
      chunk
        .replace(/\/[A-Za-z][A-Za-z0-9]+/g, ' ')
        .replace(/[()[\]{}<>]/g, ' ')
        .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9.,;:!?+\-_/ ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      240
    ))
    .filter(Boolean);

  const filtered = chunkCandidates.filter((chunk) => {
    const alphaChars = (chunk.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
    const digitChars = (chunk.match(/[0-9]/g) || []).length;
    const alphaRatio = alphaChars / Math.max(1, chunk.length);
    const noisyPdfInternals = /(catalog|pages|kids|mediabox|procset|font|resources|filter|length|device(rgb|gray)|xref|startxref)/i.test(chunk);
    const mostlyNumbers = digitChars > alphaChars * 1.6;
    return chunk.length >= 20 && alphaRatio >= 0.45 && !noisyPdfInternals && !mostlyNumbers;
  });

  const unique = Array.from(new Set(filtered));
  return sanitizeSafePreviewText(unique.slice(0, 12).join(' | '), 1800);
}

function analyzeProtocolStructure(text: string, kind: 'pdf' | 'xlsx' | 'xls' | 'unknown'): Record<string, any> {
  const normalizedText = sanitizeSafePreviewText(text, 4000).toLowerCase();
  const lines = text.split('|').map((line) => sanitizeSafePreviewText(line, 240)).filter(Boolean);
  const fieldDetectors = [
    { key: 'task', label: 'Tarefa', regex: /\btarefa\b|\bskill\b|\bitem\b/gi },
    { key: 'points', label: 'Pontos', regex: /\bpontos?\b|\bpontuacao\b|\bscore\b|\b0\s*-\s*[1-9]\b/gi },
    { key: 'name', label: 'Nome', regex: /\bnome da tarefa\b|\bnome\b|\btitle\b/gi },
    { key: 'objective', label: 'Objetivo', regex: /\bobjetivo\b|\bmeta\b|\bgoal\b/gi },
    { key: 'question', label: 'Pergunta', regex: /\bpergunta\b|\bquestao\b|\bprompt\b/gi },
    { key: 'example', label: 'Exemplo', regex: /\bexemplo\b|\bexample\b/gi },
    { key: 'criteria', label: 'Criterios', regex: /\bcriterios?\b|\bcrit[eé]rios?\b|\bmastery\b|\bscoring\b/gi },
    { key: 'comment', label: 'Comentario', regex: /\bcomentario\b|\bobservacao\b|\bnota\b/gi }
  ];

  const detectedFields = fieldDetectors
    .map((field) => ({
      ...field,
      hits: (normalizedText.match(field.regex) || []).length
    }))
    .filter((field) => field.hits > 0);

  const taskCodeMatches = normalizedText.match(/\b[a-z]{1,4}\d{1,3}(?:[.-]\d+)?\b/gi) || [];
  const scoringMatches = normalizedText.match(/\b[0-5]\s*(?:-|a)?\s*[0-5]\b/g) || [];
  const questionMarks = (text.match(/\?/g) || []).length;
  const lineCount = lines.length;
  const legibleChars = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const weirdChars = (text.match(/[^\x20-\x7EÀ-ÖØ-öø-ÿ]/g) || []).length;
  const gibberishPenalty = weirdChars > 0 ? Math.min(35, weirdChars / 3) : 0;

  const coverageRatio = detectedFields.length / fieldDetectors.length;
  const taskSignalScore = Math.min(100, (taskCodeMatches.length * 7) + (lineCount * 4) + (questionMarks * 3));
  const structureScore = clampScore((coverageRatio * 55) + (taskSignalScore * 0.45));
  const canonicalReadinessScore = clampScore(
    (coverageRatio * 70) +
    Math.min(20, taskCodeMatches.length * 3) +
    Math.min(10, scoringMatches.length * 2)
  );
  const legibilityScore = clampScore(
    (legibleChars >= 120 ? 72 : legibleChars >= 60 ? 54 : legibleChars >= 20 ? 30 : 12) - gibberishPenalty
  );
  const reliabilityScore = clampScore((legibilityScore * 0.4) + (structureScore * 0.35) + (canonicalReadinessScore * 0.25));

  const warnings: string[] = [];
  const strengths: string[] = [];

  if (!text) warnings.push('Nao foi possivel extrair texto clinico legivel sem abrir o arquivo bruto.');
  if (legibilityScore < 45) warnings.push('O conteudo extraido esta pouco legivel e pode ter vindo de PDF escaneado ou com texto embaralhado.');
  if (detectedFields.length < 3) warnings.push('A estrutura minima de protocolo nao apareceu com clareza na amostra segura.');
  if (taskCodeMatches.length === 0) warnings.push('Nao identifiquei codigos de tarefa de forma confiavel.');
  if (!detectedFields.some((field) => field.key === 'criteria')) warnings.push('Nao encontrei criterios de pontuacao de forma explicita.');
  if (!detectedFields.some((field) => field.key === 'objective')) warnings.push('Nao encontrei objetivos clinicos de forma explicita.');

  if (legibilityScore >= 65) strengths.push('A previa segura trouxe texto suficientemente legivel para triagem.');
  if (detectedFields.length >= 4) strengths.push('A estrutura basica de um protocolo clinico apareceu na amostra.');
  if (taskCodeMatches.length >= 3) strengths.push('Foram encontrados multiplos possiveis codigos de tarefa.');
  if (scoringMatches.length > 0 || detectedFields.some((field) => field.key === 'points')) strengths.push('Existem sinais de rubricacao/pontuacao no material.');

  const suggestedNextStep = reliabilityScore >= 75 && canonicalReadinessScore >= 60
    ? 'Pode seguir para vinculacao com protocolo canonico e montagem estruturada.'
    : reliabilityScore >= 50
      ? 'Revisar a previa segura e completar a montagem canonica antes de aprovar.'
      : 'Nao confiar na estrutura atual. Solicite nova fonte ou reconstrua a partir de tabela limpa.';

  return {
    detectedFields: detectedFields.map((field) => field.label),
    detectedFieldCoverage: {
      found: detectedFields.length,
      total: fieldDetectors.length
    },
    estimatedTaskCodes: taskCodeMatches.slice(0, 12),
    estimatedRows: lineCount,
    scores: {
      legibility: legibilityScore,
      structure: structureScore,
      canonicalReadiness: canonicalReadinessScore,
      reliability: reliabilityScore
    },
    strengths,
    warnings,
    suggestedNextStep
  };
}

function buildProtocolSafePreview(
  buffer: Buffer,
  kind: 'pdf' | 'xlsx' | 'xls' | 'unknown',
  fileName: string
): { text: string; structureReport: Record<string, any> } {
  const sizeKb = Math.max(1, Math.round(buffer.length / 1024));
  const readableText = extractProtocolReadableText(buffer, kind);
  const structureReport = analyzeProtocolStructure(readableText, kind);

  if (kind === 'pdf') {
    const canShowExcerpt = (structureReport.scores?.reliability || 0) >= 55 || (structureReport.detectedFields?.length || 0) >= 2;
    return {
      text: [
        `Arquivo: ${fileName}`,
        'Tipo detectado: PDF',
        `Tamanho: ${sizeKb} KB`,
        `Legibilidade: ${structureReport.scores?.legibility || 0}%`,
        `Estrutura clinica: ${structureReport.scores?.structure || 0}%`,
        `Prontidao canonica: ${structureReport.scores?.canonicalReadiness || 0}%`,
        `Confiabilidade da leitura segura: ${structureReport.scores?.reliability || 0}%`,
        structureReport.detectedFields?.length
          ? `Campos detectados: ${structureReport.detectedFields.join(', ')}`
          : 'Campos detectados: nenhum campo clinico reconhecido com seguranca.',
        readableText && canShowExcerpt
          ? `Trecho clinico seguro: ${sanitizeSafePreviewText(readableText, 1400)}`
          : 'Trecho clinico seguro: leitura textual insuficiente para confiar na estrutura. Use o PDF apenas como comprovante e monte a estrutura a partir de tabela limpa.',
        'Arquivo bruto permanece bloqueado para abertura/download.'
      ].join('\n'),
      structureReport
    };
  }
  if (kind === 'xlsx') {
    return {
      text: [
        `Arquivo: ${fileName}`,
        'Tipo detectado: Excel XLSX',
        `Tamanho: ${sizeKb} KB`,
        'Previa segura: planilha Office detectada. A estrutura tende a ser melhor, mas a leitura completa deve ocorrer em worker isolado.',
        'Arquivo bruto permanece bloqueado para abertura/download.'
      ].join('\n'),
      structureReport: {
        ...structureReport,
        warnings: [
          'A leitura estrutural detalhada de XLSX ainda nao roda neste scanner seguro.',
          ...(Array.isArray(structureReport.warnings) ? structureReport.warnings : [])
        ]
      }
    };
  }
  if (kind === 'xls') {
    return {
      text: [
        `Arquivo: ${fileName}`,
        'Tipo detectado: Excel XLS legado',
        `Tamanho: ${sizeKb} KB`,
        'Previa segura indisponivel: formato legado pode conter macros/OLE e exige sandbox dedicada.',
        'Arquivo bruto permanece bloqueado para abertura/download.'
      ].join('\n'),
      structureReport: {
        ...structureReport,
        warnings: [
          'Formato XLS legado requer analise externa mais restrita.',
          ...(Array.isArray(structureReport.warnings) ? structureReport.warnings : [])
        ]
      }
    };
  }
  return {
    text: [
      `Arquivo: ${fileName}`,
      'Tipo detectado: desconhecido',
      `Tamanho: ${sizeKb} KB`,
      'Previa segura indisponivel.',
      'Arquivo bruto permanece bloqueado para abertura/download.'
    ].join('\n'),
    structureReport: {
      ...structureReport,
      warnings: [
        'Nao foi possivel identificar o formato real do arquivo.',
        ...(Array.isArray(structureReport.warnings) ? structureReport.warnings : [])
      ]
    }
  };
}

function scanProtocolUpload(dataUrl: string, fileName: string, providedMime: string): {
  scanStatus: ProtocolScanStatus;
  quarantineStatus: 'review_ready' | 'blocked';
  safePreviewStatus: 'generated' | 'blocked';
  safePreviewText: string;
  scanReport: Record<string, any>;
} {
  const decoded = decodeSafeDataUrl(dataUrl);
  if (!decoded) {
    return {
      scanStatus: 'blocked',
      quarantineStatus: 'blocked',
      safePreviewStatus: 'blocked',
      safePreviewText: 'Arquivo bloqueado: conteudo base64 invalido.',
      scanReport: { engine: 'verto-basic-static-scan', blockedReason: 'invalid_data_url', flags: ['invalid_data_url'] }
    };
  }

  const kind = detectProtocolFileKind(decoded.buffer);
  const normalizedProvidedMime = normalizeMime(providedMime || decoded.mime);
  const flags: string[] = [];
  const lowerFileName = sanitizeString(fileName, 240).toLowerCase();
  const lowerPdfProbe = kind === 'pdf' ? decoded.buffer.toString('latin1').toLowerCase() : '';
  const pdfIndicators = [
    ['/javascript', 'pdf_javascript'],
    ['/js', 'pdf_js_action'],
    ['/openaction', 'pdf_open_action'],
    ['/aa', 'pdf_additional_action'],
    ['/launch', 'pdf_launch_action'],
    ['/embeddedfile', 'pdf_embedded_file'],
    ['/richmedia', 'pdf_rich_media'],
    ['/xfa', 'pdf_xfa_form']
  ];

  if (kind === 'unknown') flags.push('unknown_magic_bytes');
  if (kind === 'xls') flags.push('legacy_excel_ole_requires_external_sandbox');
  if (lowerFileName.endsWith('.xlsm') || lowerFileName.endsWith('.xltm')) flags.push('macro_enabled_excel_extension');
  if (kind === 'xlsx' && normalizedProvidedMime && !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(normalizedProvidedMime)) {
    flags.push('provided_mime_mismatch');
  }
  if (kind === 'xls' && normalizedProvidedMime && !['application/vnd.ms-excel', 'application/octet-stream'].includes(normalizedProvidedMime)) {
    flags.push('provided_mime_mismatch');
  }
  if (kind === 'pdf' && normalizedProvidedMime && !['application/pdf', 'application/octet-stream'].includes(normalizedProvidedMime)) {
    flags.push('provided_mime_mismatch');
  }
  for (const [indicator, flag] of pdfIndicators) {
    if (lowerPdfProbe.includes(indicator)) flags.push(flag);
  }

  const blockedFlags = new Set([
    'unknown_magic_bytes',
    'legacy_excel_ole_requires_external_sandbox',
    'macro_enabled_excel_extension',
    'provided_mime_mismatch',
    'pdf_javascript',
    'pdf_js_action',
    'pdf_open_action',
    'pdf_additional_action',
    'pdf_launch_action',
    'pdf_embedded_file',
    'pdf_rich_media',
    'pdf_xfa_form'
  ]);
  const blocked = flags.some((flag) => blockedFlags.has(flag));
  const safePreview = buildProtocolSafePreview(decoded.buffer, kind, sanitizeString(fileName, 240) || 'protocolo');

  return {
    scanStatus: blocked ? 'blocked' : 'clean',
    quarantineStatus: blocked ? 'blocked' : 'review_ready',
    safePreviewStatus: blocked ? 'blocked' : 'generated',
    safePreviewText: safePreview.text,
    scanReport: {
      engine: 'verto-basic-static-scan',
      scannedAt: new Date().toISOString(),
      detectedKind: kind,
      detectedMime: decoded.mime,
      providedMime: normalizedProvidedMime || null,
      sizeBytes: decoded.buffer.length,
      flags,
      structure: safePreview.structureReport
    }
  };
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

function effortEmojiForPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const percent = Number(value);
  if (percent < 20) return '😫';
  if (percent < 40) return '😕';
  if (percent < 60) return '😐';
  if (percent < 80) return '🙂';
  return '🤩';
}

function effortLabelForPercent(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const percent = Number(value);
  if (percent < 20) return 'Muito difícil';
  if (percent < 40) return 'Difícil';
  if (percent < 60) return 'Moderado';
  if (percent < 80) return 'Leve';
  return 'Muito leve';
}

function isVbMappTask(taskLike: any): boolean {
  const candidates = [
    taskLike?.protocol_id,
    taskLike?.protocolId,
    taskLike?.protocol_title,
    taskLike?.protocolTitle,
    taskLike?.title,
    taskLike?.name
  ]
    .map((v) => sanitizeString(v, 180).toLowerCase())
    .filter(Boolean);
  return candidates.some((v) => /vb[\s-]?mapp/.test(v));
}

async function resolveVbMappMasteryCriterionByClinicId(clinicId: string | null | undefined): Promise<number> {
  const fallback = 5;
  const safeClinicId = sanitizeString(clinicId, 120);
  if (!safeClinicId) return fallback;
  try {
    const { data, error } = await supabase
      .from('clinics')
      .select('vbmapp_mastery_criterion')
      .eq('id', safeClinicId)
      .maybeSingle();
    if (error) {
      if (/vbmapp_mastery_criterion|relation "clinics"/i.test(String(error?.message || ''))) {
        return fallback;
      }
      return fallback;
    }
    const criterion = asSafeNumber((data as any)?.vbmapp_mastery_criterion, 1, 20);
    if (criterion === 10) return 10;
    return 5;
  } catch {
    return fallback;
  }
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
    user?.activeWorkspaceId || user?.clinicId || user?.clinic_id,
    120
  );
  return id || null;
}

function currentClinicTimeZone(user: any): string {
  return sanitizeString(
    user?.clinicTimeZone ||
      user?.clinic_timezone ||
      user?.timezone ||
      user?.time_zone ||
      process.env.DEFAULT_CLINIC_TIMEZONE ||
      'America/Sao_Paulo',
    80
  ) || 'America/Sao_Paulo';
}

function dateGroupForClinic(value: unknown, user: any): string {
  const date = value ? new Date(String(value)) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: currentClinicTimeZone(user),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(safeDate);
}

function hasGlobalClinicAccess(user: any): boolean {
  const role = sanitizeString(user?.role, 40).toLowerCase();
  return role === 'admin' || role === 'owner';
}

const TEAM_ACCESS_PER_ACTIVE_PATIENT = 10;
const MIN_TEAM_ACCESS_LIMIT = 10;

async function getClinicTeamAccessUsage(clinicId: string) {
  const safeClinicId = sanitizeString(clinicId, 120);
  if (!safeClinicId) {
    return {
      activePatients: 0,
      activeMembers: 0,
      pendingInvitations: 0,
      limit: MIN_TEAM_ACCESS_LIMIT,
      used: 0
    };
  }

  const [patientsResult, membersResult, invitationsResult] = await Promise.all([
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', safeClinicId)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('clinic_memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('clinic_id', safeClinicId)
      .eq('status', 'active')
      .in('role', ['coordinator', 'therapist', 'receptionist']),
    supabase
      .from('invitations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', safeClinicId)
      .eq('status', 'pending')
      .in('role', ['coordinator', 'therapist', 'receptionist'])
  ]);

  const activePatients = Math.max(0, Number(patientsResult.count || 0));
  const activeMembers = Math.max(0, Number(membersResult.count || 0));
  const pendingInvitations = Math.max(0, Number(invitationsResult.count || 0));
  const limit = Math.max(MIN_TEAM_ACCESS_LIMIT, activePatients * TEAM_ACCESS_PER_ACTIVE_PATIENT);
  return {
    activePatients,
    activeMembers,
    pendingInvitations,
    limit,
    used: activeMembers + pendingInvitations
  };
}

async function findDuplicatePatientInClinic(params: {
  clinicId?: unknown;
  email?: unknown;
  cpf?: unknown;
  excludePatientId?: unknown;
}): Promise<{ field: 'email' | 'cpf'; patientId: string; patientName: string; value: string } | null> {
  const safeClinicId = sanitizeString(params.clinicId, 120);
  if (!safeClinicId || !isUuid(safeClinicId)) return null;

  const safeEmail = sanitizeEmail(params.email);
  const safeCpf = normalizeCpf(params.cpf);
  const excludedId = sanitizeString(params.excludePatientId, 120);
  const isExcluded = (candidateId: unknown) =>
    Boolean(excludedId && sanitizeString(candidateId, 120) === excludedId);

  if (safeEmail) {
    const { data: emailRows, error: emailError } = await supabase
      .from('patients')
      .select('id, name, email, status')
      .eq('clinic_id', safeClinicId)
      .eq('email', safeEmail)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(10);
    if (emailError) throw emailError;

    const hit = (emailRows || []).find((row: any) => !isExcluded(row?.id));
    if (hit?.id) {
      return {
        field: 'email',
        patientId: sanitizeString(hit.id, 120),
        patientName: sanitizeString(hit.name, 180) || 'Paciente',
        value: safeEmail
      };
    }
  }

  if (safeCpf) {
    try {
      const { data: cpfRows, error: cpfError } = await supabase
        .from('patients')
        .select('id, name, cpf, status')
        .eq('clinic_id', safeClinicId)
        .eq('cpf', safeCpf)
        .eq('is_active', true)
        .is('deleted_at', null)
        .limit(10);
      if (cpfError) throw cpfError;

      const hit = (cpfRows || []).find((row: any) => !isExcluded(row?.id));
      if (hit?.id) {
        return {
          field: 'cpf',
          patientId: sanitizeString(hit.id, 120),
          patientName: sanitizeString(hit.name, 180) || 'Paciente',
          value: safeCpf
        };
      }
    } catch (rawError: any) {
      const missingColumn = extractMissingColumnName(rawError);
      if (missingColumn !== 'cpf') throw rawError;
    }

    // Fallback de CPF para ambientes legados: busca no payload criptografado.
    const { data: recordRows, error: recordError } = await supabase
      .from('patient_records')
      .select('patient_id, payload_encrypted')
      .eq('clinic_id', safeClinicId)
      .limit(3000);

    if (recordError) {
      const missingTable = String(recordError?.message || '')
        .toLowerCase()
        .includes('patient_records');
      if (!missingTable) throw recordError;
    } else {
      for (const row of recordRows || []) {
        const candidatePatientId = sanitizeString((row as any)?.patient_id, 120);
        if (!candidatePatientId || isExcluded(candidatePatientId)) continue;
        const decryptedPayload = decryptJsonPayload(
          sanitizeString((row as any)?.payload_encrypted, 2_000_000),
        );
        const payloadCpf = normalizeCpf((decryptedPayload as any)?.cpf);
        if (payloadCpf && payloadCpf === safeCpf) {
          const { data: patientRow } = await supabase
            .from('patients')
            .select('id, name')
            .eq('id', candidatePatientId)
            .maybeSingle();
          return {
            field: 'cpf',
            patientId: sanitizeString(patientRow?.id || candidatePatientId, 120),
            patientName: sanitizeString(patientRow?.name, 180) || 'Paciente',
            value: safeCpf
          };
        }
      }
    }
  }

  return null;
}

async function getClinicPatientIdsByEmail(clinicId: string, patientEmail: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('email', patientEmail)
    .eq('is_active', true)
    .is('deleted_at', null)
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
    .ilike('email', safeEmail)
    .eq('is_active', true)
    .is('deleted_at', null)
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

function parseTaskScheduleToMs(value: string | null | undefined): number | null {
  const raw = sanitizeString(value, 80);
  if (!raw) return null;

  const direct = new Date(raw).getTime();
  if (Number.isFinite(direct)) return direct;

  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (brMatch) {
    const [, dd, mm, yyyy, hh = '00', min = '00', ss = '00'] = brMatch;
    const isoLike = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
    const parsed = new Date(isoLike).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
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
  if (isUuid(safeRaw)) {
    const role = sanitizeString(user?.role, 40).toLowerCase();
    const safeEmail = sanitizeEmail(user?.email);
    const clinicId = currentClinicId(user);

    const { data: byId, error: byIdError } = await supabase
      .from('patients')
      .select('id')
      .eq('id', safeRaw)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (!byIdError && byId?.id) return sanitizeString(byId.id, 120);

    // Patient sessions can send auth user UUID instead of patients.id.
    // In this case, resolve by e-mail to keep persistence linked correctly.
    if (role === 'patient' && safeEmail) {
      const resolveByEmailRows = async (scopedToClinic: boolean) => {
        let byEmailQuery = supabase
          .from('patients')
          .select('id')
          .ilike('email', safeEmail)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1);
        if (scopedToClinic && clinicId) {
          byEmailQuery = byEmailQuery.eq('clinic_id', clinicId);
        }
        return await byEmailQuery;
      };

      // 1) Try clinic-scoped match first (when session has clinic context)
      const { data: byEmailScopedRows, error: byEmailScopedError } = await resolveByEmailRows(true);
      if (!byEmailScopedError && Array.isArray(byEmailScopedRows) && byEmailScopedRows[0]?.id) {
        return sanitizeString(byEmailScopedRows[0].id, 120);
      }

      // 2) Fallback to any clinic match for this e-mail
      const { data: byEmailRows, error: byEmailError } = await resolveByEmailRows(false);
      if (!byEmailError && Array.isArray(byEmailRows) && byEmailRows[0]?.id) {
        return sanitizeString(byEmailRows[0].id, 120);
      }
      return null;
    }

    return safeRaw;
  }

  const clinicId = currentClinicId(user);
  if (!clinicId) return null;

  const guessedName = sanitizeString(options.fallbackName, 160) || derivePatientNameFromLegacyId(safeRaw);
  let { data: foundByName } = await supabase
    .from('patients')
    .select('id, name')
    .eq('clinic_id', clinicId)
    .ilike('name', guessedName)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (!foundByName && guessedName) {
    const relaxed = await supabase
      .from('patients')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .ilike('name', `%${guessedName}%`)
      .eq('is_active', true)
      .is('deleted_at', null)
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

function normalizeAppointmentStatusForTable(status: unknown): string {
  const normalized = sanitizeString(status || 'scheduled', 40).toLowerCase();
  if (normalized === 'pending') return 'scheduled';
  if (normalized === 'canceled') return 'cancelled';
  if (normalized === 'reschedule') return 'rescheduled';
  if (normalized === 'confirmed' || normalized === 'completed' || normalized === 'cancelled' || normalized === 'rescheduled') {
    return normalized;
  }
  return 'scheduled';
}

function normalizeAppointmentStatusForUi(status: unknown): string {
  const normalized = sanitizeString(status || 'pending', 40).toLowerCase();
  if (normalized === 'scheduled') return 'pending';
  if (normalized === 'cancelled') return 'canceled';
  if (normalized === 'rescheduled') return 'reschedule';
  return normalized || 'pending';
}

function normalizeAppointmentResponseAction(action: unknown): 'confirmed' | 'reschedule' | 'canceled' | '' {
  const normalized = sanitizeString(action, 40).toLowerCase();
  if (['verto_confirm_appointment', 'confirm', 'confirmed', 'confirmar', 'accepted', 'accept'].includes(normalized)) return 'confirmed';
  if (['verto_reschedule_appointment', 'reschedule', 'rescheduled', 'remarcar', 'remarcado'].includes(normalized)) return 'reschedule';
  if (['cancel', 'canceled', 'cancelled', 'cancelar', 'cancelado'].includes(normalized)) return 'canceled';
  return '';
}

function isTrustedPushNotificationAction(action: unknown): boolean {
  return ['verto_confirm_appointment', 'verto_reschedule_appointment'].includes(
    sanitizeString(action, 80).toLowerCase()
  );
}

function buildAppointmentScheduledAt(appointment: any): string | null {
  const explicit = sanitizeString(appointment?.scheduled_at || appointment?.scheduledAt, 80);
  if (explicit) {
    const parsed = new Date(explicit);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const date = sanitizeDate(appointment?.date);
  const time = sanitizeString(appointment?.time, 10);
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;

  const parsed = new Date(`${date}T${time}:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getAppointmentRecurrenceGroupId(appointment: any): string {
  return sanitizeString(
    appointment?.recurrenceGroupId || appointment?.recurrence_group_id,
    120,
  );
}

function getAppointmentRecurrenceIndex(appointment: any): number {
  const rawValue = Number(
    appointment?.recurrenceIndex ?? appointment?.recurrence_index ?? 0,
  );
  return Number.isFinite(rawValue) ? rawValue : 0;
}

function getAppointmentOccurrenceTime(appointment: any): number {
  const scheduledAt = buildAppointmentScheduledAt(appointment);
  if (scheduledAt) {
    const parsed = new Date(scheduledAt).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }

  const fallbackDate = sanitizeDate(appointment?.date);
  const fallbackTime = sanitizeString(appointment?.time, 10);
  if (fallbackDate && /^\d{2}:\d{2}$/.test(fallbackTime)) {
    const parsed = new Date(`${fallbackDate}T${fallbackTime}:00-03:00`).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }

  return Number.POSITIVE_INFINITY;
}

function isSameOrFutureRecurringAppointment(referenceAppointment: any, candidateAppointment: any): boolean {
  const referenceGroupId = getAppointmentRecurrenceGroupId(referenceAppointment);
  const candidateGroupId = getAppointmentRecurrenceGroupId(candidateAppointment);
  if (!referenceGroupId || referenceGroupId !== candidateGroupId) return false;

  const referenceIndex = getAppointmentRecurrenceIndex(referenceAppointment);
  const candidateIndex = getAppointmentRecurrenceIndex(candidateAppointment);
  if (referenceIndex > 0 && candidateIndex > 0) {
    return candidateIndex >= referenceIndex;
  }

  return getAppointmentOccurrenceTime(candidateAppointment) >= getAppointmentOccurrenceTime(referenceAppointment);
}

function resetAppointmentReminderStateAfterScheduleChange(appointment: any) {
  return {
    ...appointment,
    status: 'pending',
    patientResponse: null,
    patient_response: null,
    patientRespondedAt: null,
    patient_responded_at: null,
    patientConfirmationStatus: null,
    patient_confirmation_status: null,
    patientConfirmationAt: null,
    patient_confirmation_at: null,
    patientConfirmationBy: null,
    patient_confirmation_by: null,
    patientConfirmationSource: null,
    patient_confirmation_source: null,
    notification_24h_sent_at: null,
    notification24hSentAt: null,
    notification_sent_at: null,
    notification_sent: false,
    notification_12h_sent_at: null,
    notification12hSentAt: null,
    notification_12h_sent: false
  };
}

function formatAppointmentLogDate(date: unknown) {
  const safeDate = sanitizeDate(date);
  if (!safeDate) return '';
  const [, month, day] = safeDate.split('-');
  return `${day}/${month}`;
}

function buildAppointmentLogWhen(appointment: any) {
  const dateLabel = formatAppointmentLogDate(appointment?.date);
  const timeLabel = sanitizeString(appointment?.time, 10);
  if (dateLabel && timeLabel) return `para o dia ${dateLabel} às ${timeLabel}`;
  if (dateLabel) return `para o dia ${dateLabel}`;
  if (timeLabel) return `às ${timeLabel}`;
  return '';
}

function appointmentStatusLabelForLog(status: unknown) {
  const normalized = normalizeAppointmentStatusForUi(status);
  if (normalized === 'confirmed') return { title: 'Consulta confirmada', verb: 'confirmou', actionType: 'appointment_confirmed' };
  if (normalized === 'reschedule') return { title: 'Consulta marcada para remarcação', verb: 'solicitou remarcação da', actionType: 'appointment_reschedule_requested' };
  if (normalized === 'canceled') return { title: 'Consulta cancelada', verb: 'cancelou', actionType: 'appointment_cancelled' };
  return { title: 'Consulta atualizada', verb: 'atualizou', actionType: 'appointment_status_updated' };
}

function buildAppointmentStatusLogContent(params: {
  actorName?: string | null;
  isPatientActor?: boolean;
  patientName?: string | null;
  appointment?: any;
  status?: string | null;
  note?: string | null;
}) {
  const patientName = sanitizeString(params.patientName, 180) || 'paciente';
  const when = buildAppointmentLogWhen(params.appointment);
  const statusInfo = appointmentStatusLabelForLog(params.status || params.appointment?.status);
  const note = sanitizeString(params.note, 800);
  const actorName = sanitizeString(params.actorName, 180);
  const content = params.isPatientActor
    ? `Paciente ${patientName} ${statusInfo.verb} consulta${when ? ` ${when}` : ''}.`
    : `${actorName || 'Equipe'} ${statusInfo.verb} a consulta de ${patientName}${when ? ` ${when}` : ''}.`;
  return note ? `${content} Observação: ${note}` : content;
}

function resetRescheduledAppointmentsForNewReminderCycle(nextAppointments: any[], previousAppointments: any[]) {
  const previousById = new Map(
    (previousAppointments || [])
      .map((appointment: any) => [sanitizeString(appointment?.id, 120), appointment])
      .filter(([id]) => Boolean(id))
  );

  return (nextAppointments || []).map((appointment: any) => {
    const appointmentId = sanitizeString(appointment?.id, 120);
    const previous = previousById.get(appointmentId);
    if (!previous) return appointment;

    const previousScheduledAt = buildAppointmentScheduledAt(previous);
    const nextScheduledAt = buildAppointmentScheduledAt(appointment);
    const scheduleChanged =
      Boolean(previousScheduledAt && nextScheduledAt && previousScheduledAt !== nextScheduledAt) ||
      sanitizeDate(previous?.date) !== sanitizeDate(appointment?.date) ||
      sanitizeString(previous?.time, 10) !== sanitizeString(appointment?.time, 10);

    return scheduleChanged
      ? resetAppointmentReminderStateAfterScheduleChange(appointment)
      : appointment;
  });
}

async function upsertAppointmentMirrorRow(row: Record<string, any>, logger: Pick<Console, 'warn'> = console) {
  let payload: Record<string, any> = cleanObject(row);
  let triedLegacyPendingStatus = false;

  while (Object.keys(payload).length > 0) {
    const { error } = await supabase
      .from('appointments')
      .upsert([payload], { onConflict: 'id' });

    if (!error) return true;

    const missingColumn = extractMissingColumnName(error);
    if (missingColumn && missingColumn in payload) {
      delete payload[missingColumn];
      continue;
    }

    if (!triedLegacyPendingStatus && /status|check constraint/i.test(String(error.message || ''))) {
      triedLegacyPendingStatus = true;
      payload.status = normalizeAppointmentStatusForUi(payload.status);
      continue;
    }

    logger.warn('[Appointments] Falha ao espelhar agenda na tabela appointments.', {
      appointmentId: row?.id,
      message: error.message
    });
    return false;
  }

  return false;
}

async function syncAppointmentsTableFromClinicState(params: {
  clinicId: string | null;
  appointments: any[];
  actorId: string;
  specialtySettings?: Record<string, any>;
}) {
  const clinicId = sanitizeString(params.clinicId, 120);
  const actorId = sanitizeString(params.actorId, 120);
  if (!isUuid(clinicId) || !Array.isArray(params.appointments)) return { mirrored: 0, skipped: 0 };

  let mirrored = 0;
  let skipped = 0;
  const appointmentIds = Array.from(
    new Set(
      params.appointments
        .map((appointment: any) => sanitizeString(appointment?.id, 120))
        .filter((id: string) => isUuid(id))
    )
  );
  const existingById = new Map<string, any>();
  if (appointmentIds.length > 0) {
    const { data: existingRows, error: existingError } = await supabase
      .from('appointments')
      .select('id, status, patient_response, patient_responded_at, patient_confirmation_status, patient_confirmation_at, patient_confirmation_by, patient_confirmation_source, notification_24h_sent_at, notification_12h_sent_at, notification_sent, notification_sent_at, notification_12h_sent')
      .in('id', appointmentIds);
    if (!existingError) {
      for (const row of existingRows || []) {
        existingById.set(sanitizeString(row?.id, 120), row);
      }
    }
  }
  const hasOwn = (source: any, key: string) =>
    Object.prototype.hasOwnProperty.call(source || {}, key);
  const hasAnyOwn = (source: any, keys: string[]) =>
    keys.some((key) => hasOwn(source, key));
  const firstOwnValue = (source: any, keys: string[]) => {
    for (const key of keys) {
      if (hasOwn(source, key)) return source?.[key];
    }
    return undefined;
  };

  for (const appointment of params.appointments) {
    const appointmentId = sanitizeString(appointment?.id, 120);
    const scheduledAt = buildAppointmentScheduledAt(appointment);
    const rawPatientId = sanitizeString(appointment?.patientId || appointment?.patient_id, 120);
    const patientEmail = sanitizeEmail(appointment?.patientEmail || appointment?.patient_email);
    const resolvedPatientIds = await resolvePatientIdsForPush({
      supabase,
      patientId: rawPatientId,
      patientEmail,
      clinicId
    });
    const patientId = resolvedPatientIds[0] || '';

    if (!isUuid(appointmentId) || !scheduledAt || !isUuid(patientId)) {
      skipped += 1;
      continue;
    }

    const therapistIdCandidates = [
      appointment?.therapistId,
      appointment?.therapist_id,
      appointment?.professionalId,
      appointment?.professional_id,
      actorId
    ];
    const therapistId = therapistIdCandidates
      .map((value) => sanitizeString(value, 120))
      .find((value) => isUuid(value));
    if (!therapistId) {
      skipped += 1;
      continue;
    }

    const approach = sanitizeString(appointment?.type || appointment?.approach, 120);
    const configuredDuration = Number(params.specialtySettings?.[approach]);
    const duration = Number(appointment?.duration_minutes || appointment?.durationMinutes || configuredDuration || 50);
    const statusForTable = normalizeAppointmentStatusForTable(appointment?.status);
    const patientResponse =
      sanitizeString(appointment?.patient_response || appointment?.patientResponse, 40) ||
      (
        ['confirmed', 'reschedule', 'cancelled', 'canceled'].includes(normalizeAppointmentStatusForUi(appointment?.status))
          ? normalizeAppointmentStatusForUi(appointment?.status)
          : null
      );
    const existing = existingById.get(appointmentId) || {};
    const hasIncomingPatientResponse = hasAnyOwn(appointment, [
      'patient_response',
      'patientResponse',
      'patientConfirmationStatus',
      'patient_confirmation_status',
      'patientRespondedAt',
      'patient_responded_at',
      'patientConfirmationAt',
      'patient_confirmation_at'
    ]) || Boolean(patientResponse);
    const existingResponseStatus =
      normalizeAppointmentResponseAction(existing.patient_response || existing.patient_confirmation_status) ||
      normalizeAppointmentStatusForUi(existing.status);
    const incomingUiStatus = normalizeAppointmentStatusForUi(appointment?.status);
    const shouldPreserveExistingResponseStatus =
      !hasIncomingPatientResponse &&
      ['confirmed', 'reschedule', 'canceled'].includes(existingResponseStatus) &&
      (incomingUiStatus === 'pending' || incomingUiStatus === 'scheduled');
    const effectiveStatusForTable = shouldPreserveExistingResponseStatus
      ? normalizeAppointmentStatusForTable(existingResponseStatus)
      : statusForTable;
    const resolvedPatientResponse = hasIncomingPatientResponse
      ? (patientResponse === 'canceled' ? 'cancelled' : patientResponse)
      : (existing.patient_response || null);
    const resolvedPatientRespondedAt = hasIncomingPatientResponse
      ? (appointment?.patient_responded_at || appointment?.patientRespondedAt || appointment?.patientConfirmationAt || null)
      : (existing.patient_responded_at || null);
    const resolvedPatientConfirmationStatus = hasIncomingPatientResponse
      ? (appointment?.patientConfirmationStatus || appointment?.patient_confirmation_status || patientResponse || null)
      : (existing.patient_confirmation_status || null);
    const resolvedPatientConfirmationAt = hasIncomingPatientResponse
      ? (appointment?.patientConfirmationAt || appointment?.patient_confirmation_at || appointment?.patient_responded_at || null)
      : (existing.patient_confirmation_at || null);
    const resolvedPatientConfirmationBy = hasIncomingPatientResponse
      ? (appointment?.patientConfirmationBy || appointment?.patient_confirmation_by || null)
      : (existing.patient_confirmation_by || null);
    const resolvedPatientConfirmationSource = hasIncomingPatientResponse
      ? (appointment?.patientConfirmationSource || appointment?.patient_confirmation_source || null)
      : (existing.patient_confirmation_source || null);
    const hasIncoming24hMarker = hasAnyOwn(appointment, [
      'notification_24h_sent_at',
      'notification24hSentAt',
      'notification_sent_at',
      'notification_sent'
    ]);
    const incoming24hSentAt = firstOwnValue(appointment, [
      'notification_24h_sent_at',
      'notification24hSentAt',
      'notification_sent_at'
    ]);
    const resolved24hSentAt = hasIncoming24hMarker
      ? (incoming24hSentAt || null)
      : (existing.notification_24h_sent_at || existing.notification_sent_at || null);
    const resolvedNotificationSent = hasIncoming24hMarker
      ? (hasOwn(appointment, 'notification_sent') ? Boolean(appointment.notification_sent) : Boolean(resolved24hSentAt))
      : Boolean(existing.notification_sent || existing.notification_24h_sent_at || existing.notification_sent_at);
    const hasIncoming12hMarker = hasAnyOwn(appointment, [
      'notification_12h_sent_at',
      'notification12hSentAt',
      'notification_12h_sent'
    ]);
    const incoming12hSentAt = firstOwnValue(appointment, [
      'notification_12h_sent_at',
      'notification12hSentAt'
    ]);
    const resolved12hSentAt = hasIncoming12hMarker
      ? (incoming12hSentAt || null)
      : (existing.notification_12h_sent_at || null);
    const resolvedNotification12hSent = hasIncoming12hMarker
      ? (hasOwn(appointment, 'notification_12h_sent') ? Boolean(appointment.notification_12h_sent) : Boolean(resolved12hSentAt))
      : Boolean(existing.notification_12h_sent || existing.notification_12h_sent_at);

    const row = {
      id: appointmentId,
      clinic_id: clinicId,
      patient_id: patientId,
      therapist_id: therapistId,
      scheduled_at: scheduledAt,
      duration_minutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 50,
      status: effectiveStatusForTable,
      notes: sanitizeString(appointment?.notes || appointment?.note, 2000) || null,
      patient_response: resolvedPatientResponse,
      patient_responded_at: resolvedPatientRespondedAt,
      notification_24h_sent_at: resolved24hSentAt,
      notification_12h_sent_at: resolved12hSentAt,
      notification_sent: resolvedNotificationSent,
      notification_sent_at: resolved24hSentAt,
      notification_12h_sent: resolvedNotification12hSent,
      patient_confirmation_status: resolvedPatientConfirmationStatus,
      patient_confirmation_at: resolvedPatientConfirmationAt,
      patient_confirmation_by: resolvedPatientConfirmationBy,
      patient_confirmation_source: resolvedPatientConfirmationSource,
      patient_email: patientEmail || null,
      patient_name: sanitizeString(appointment?.patientName || appointment?.name || appointment?.patient_name, 180) || null,
      therapist_name: sanitizeString(appointment?.therapistName || appointment?.professional || appointment?.therapist_name, 180) || null,
      source_payload: appointment,
      is_active: !['cancelled', 'canceled'].includes(effectiveStatusForTable),
      updated_at: new Date().toISOString()
    };

    const ok = await upsertAppointmentMirrorRow(row);
    if (ok) mirrored += 1;
    else skipped += 1;
  }

  return { mirrored, skipped };
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
    const listResult = await withTimeoutOrFallback(
      supabase.auth.admin.listUsers({ page, perPage }),
      7000,
      { data: { users: [] }, error: null } as any,
      'supabase.auth.admin.listUsers'
    );
    const { data, error } = listResult;
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
    address: sanitizeString(input?.address, 320) || null,
    type: sanitizeString(input?.type, 80) || null,
    age: typeof input?.age === 'number' ? input.age : null,
    subscriptionStatus: sanitizeString(input?.subscriptionStatus, 40) || null,
    planName: sanitizeString(input?.planName, 80) || null,
    planPrice: asSafeNumber(input?.planPrice, 0, 100000) || null,
    treatmentStatus: sanitizeString(input?.treatmentStatus, 40) || null,
    clinicId: selectedWorkspace?.clinicId || sanitizeString(input?.clinicId, 120) || null,
    activeWorkspaceId,
    mustSelectWorkspace,
    sessionToken: sanitizeString(input?.sessionToken, 120) || null,
    emailVerified: Boolean(input?.emailVerified),
    phoneVerified: Boolean(input?.phoneVerified),
    firstLoginCompleted:
      typeof input?.firstLoginCompleted === 'boolean' ? input.firstLoginCompleted : null,
    activationRequired: Boolean(input?.activationRequired),
    crp: resolveStoredCrp(input),
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
      .ilike('email', safeEmail)
      .eq('is_active', true)
      .is('deleted_at', null)
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

  // Regra de vínculo: paciente já vinculado à clínica não deve cair como "sem tratamento ativo"
  // imediatamente após ativação/login, mesmo sem tarefas atribuídas ainda.
  if (hasActivePatientStatus || hasLinkedClinic || hasAssignedTasks) return 'active';
  return 'waiting_treatment';
}

async function resolveProfessionalPlanFromCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<'Essencial' | 'Crescimento' | 'Avançado' | null> {
  const metadataPlan = normalizeProfessionalPlan((session.metadata as any)?.planName);
  if (metadataPlan) return metadataPlan;

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
    for (const lineItem of lineItems.data || []) {
      const planByPriceId = resolveProfessionalPlanByPriceId(
        typeof lineItem.price === 'string' ? lineItem.price : lineItem.price?.id,
      );
      if (planByPriceId) return planByPriceId;
    }
  } catch (error: any) {
    console.warn('[Stripe] Falha ao resolver plano pelos line items da sessao:', {
      sessionId: sanitizeString(session.id, 200),
      message: error?.message || String(error)
    });
  }

  return null;
}

async function canAccessPatientInCurrentClinic(patientId: string, user: any): Promise<boolean> {
  if (!isUuid(patientId)) return false;
  if (hasGlobalClinicAccess(user)) return true;
  const clinicId = currentClinicId(user);
  const role = sanitizeString(user?.role, 40).toLowerCase();
  const userId = sanitizeString(user?.id, 120);
  let query = supabase
    .from('patients')
    .select('id, therapist_id, clinic_id')
    .eq('id', patientId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (clinicId) {
    query = query.eq('clinic_id', clinicId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return false;
  if (data?.id) {
    if (role === 'coordinator') return true;
    if (role === 'therapist' && sanitizeString(data?.therapist_id, 120) === userId) return true;
    return false;
  }

  // Fallback robusto: se contexto de clínica não estiver pronto na sessão,
  // terapeuta responsável ainda pode acessar seu próprio paciente.
  if (role === 'therapist' && isUuid(userId)) {
    const { data: byTherapist, error: byTherapistError } = await supabase
      .from('patients')
      .select('id')
      .eq('id', patientId)
      .eq('therapist_id', userId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (!byTherapistError && byTherapist?.id) return true;
  }

  return false;
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
          .ilike('email', safeEmail)
          .eq('is_active', true)
          .is('deleted_at', null)
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
  const parsedPort = Number.parseInt(String(process.env.PORT || '8080'), 10);
  const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080;
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
    skip: (req) =>
      req.path === '/auth/login' ||
      req.path === '/auth/me' ||
      req.path === '/logs' ||
      req.path === '/patients/create-user',
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

  const authLoginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' }
  });

  const authMeLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Muitas verificações de sessão. Aguarde alguns instantes e tente novamente.' }
  });

  const authSignupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Muitos cadastros em sequência. Aguarde e tente novamente.' }
  });

  const patientCreateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: {
      success: false,
      error: 'Muitos cadastros de pacientes em sequência. Aguarde alguns instantes e tente novamente.'
    }
  });

  const inviteLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Limite temporário de convites atingido. Tente novamente mais tarde.' }
  });

  const uploadLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Muitos uploads em pouco tempo. Aguarde alguns minutos.' }
  });

  const resendActivationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, error: 'Limite de reenvios atingido. Tente novamente mais tarde.' }
  });

  const resendRecoveryLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { success: false, error: 'Limite de reenvios de recuperação atingido. Tente novamente mais tarde.' }
  });

  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()
  app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event: Stripe.Event;

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
      console.error('[Stripe Activation Webhook] Signature verification failed:', err?.message || String(err));
      return res.status(400).send(`Webhook Error: ${err?.message || String(err)}`);
    }

    if (event.type !== 'checkout.session.completed') {
      return res.json({ received: true, ignored: true });
    }

    try {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerEmail = sanitizeEmail(session.customer_details?.email || session.customer_email);
      if (!customerEmail) {
        console.error('[Stripe Activation Webhook] checkout.session.completed sem e-mail de cliente.', {
          sessionId: sanitizeString(session.id, 200)
        });
        return res.status(400).json({ success: false, error: 'E-mail do cliente não encontrado na sessão.' });
      }

      const token = crypto.randomUUID();
      const { error } = await supabase
        .from('pending_activations')
        .insert([{ email: customerEmail, token, used: false }]);
      if (error) throw error;

      try {
        const resend = getResend();
        const from = sanitizeString(process.env.RESEND_FROM_EMAIL || '', 320) || OFFICIAL_FROM_NOREPLY;
        const emailResult = await resend.emails.send({
          from,
          to: customerEmail,
          subject: 'Bem-vindo à Verto: crie sua conta',
          html: buildPostPaymentActivationEmail(token)
        });
        if (emailResult.error) {
          throw new Error(String(emailResult.error.message || JSON.stringify(emailResult.error)));
        }
      } catch (emailError: any) {
        console.error('[Stripe Activation Webhook] Falha ao enviar e-mail de ativação via Resend:', {
          email: maskEmail(customerEmail),
          message: emailError?.message || String(emailError)
        });
      }

      return res.json({ success: true, received: true });
    } catch (webhookError: any) {
      console.error('[Stripe Activation Webhook] Erro ao processar ativação:', {
        message: webhookError?.message || String(webhookError)
      });
      return res.status(500).json({ success: false, error: 'Erro ao processar webhook.' });
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
          const stripeCustomerId = sanitizeString(String(session.customer || ''), 200);
          const resolvedDirectPlan = await resolveProfessionalPlanFromCheckoutSession(stripe, session);

          if (!flowType && !userId && customerEmail && resolvedDirectPlan) {
            try {
              await provisionProfessionalFromDirectStripeCheckout({
                email: customerEmail,
                planName: resolvedDirectPlan,
                customerName: sanitizeString(session.customer_details?.name, 180) || null,
                stripeCustomerId
              });
            } catch (directProvisionError: any) {
              console.error('[Stripe Webhook] Falha ao provisionar conta por payment link direto:', {
                email: maskEmail(customerEmail),
                planName: resolvedDirectPlan,
                message: directProvisionError?.message || String(directProvisionError)
              });
              throw directProvisionError;
            }
            break;
          }

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

          if (stripeCustomerId) {
            await persistStripeCustomerReference({
              customerId: stripeCustomerId,
              email: customerEmail,
              userId,
              clinicId
            });
          }

          if (session.subscription) {
            try {
              const subscriptionId = sanitizeString(String(session.subscription), 120);
              if (subscriptionId) {
                const subscription = await stripe.subscriptions.update(subscriptionId, {
                  metadata: {
                    ...(userId ? { userId } : {}),
                    ...(clinicId ? { clinicId } : {})
                  },
                  expand: ['items.data.price']
                } as any);
                const activePatientPriceId = resolveActivePatientPriceId();
                const subscriptionItem =
                  activePatientPriceId
                    ? subscription.items.data.find((item) => sanitizeString((item.price as any)?.id, 120) === activePatientPriceId)
                    : subscription.items.data[0];
                await persistStripeSubscriptionReference({
                  subscriptionId,
                  subscriptionItemId: sanitizeString(subscriptionItem?.id, 120),
                  customerId: stripeCustomerId,
                  email: customerEmail,
                  userId,
                  clinicId,
                  status: subscription.status
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
                    plan_name: normalizeProfessionalPlan(planNameFromMetadata) || resolvedDirectPlan || undefined,
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
                        redirectTo: getActivationRedirectUrl('coordinator', targetEmail)
                      })) || getActivationRedirectUrl('coordinator', targetEmail);

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
        case 'checkout.session.expired': {
          const session = event.data.object as Stripe.Checkout.Session;
          const flowType = sanitizeString((session.metadata as any)?.flowType, 80);
          if (flowType === 'professional_signup') {
            await trackProfessionalSignupCheckoutCancellation({
              userId: sanitizeString((session.metadata as any)?.userId, 120) || null,
              email: sanitizeEmail(session.customer_details?.email || session.customer_email) || null,
              planName: sanitizeString((session.metadata as any)?.planName, 80) || null,
              checkoutSessionId: sanitizeString(session.id, 200) || null,
              source: 'stripe_checkout_session_expired'
            });
          }
          break;
        }
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId = sanitizeString(String((invoice as any).subscription || ''), 120);
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
          await markClinicPaymentFailed({
            clinicId,
            userId,
            email: customerEmail,
            invoiceId: sanitizeString(invoice.id, 200)
          });
          break;
        }
        case 'invoice.created': {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId = sanitizeString(String((invoice as any).subscription || ''), 120);
          const customerEmail = sanitizeEmail(invoice.customer_email);
          let clinicId = '';
          let userId = '';
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            clinicId = sanitizeString((subscription.metadata as any)?.clinicId, 120);
            userId = sanitizeString((subscription.metadata as any)?.userId, 120);
          }
          console.log('[Stripe Webhook] Fatura criada.', {
            invoiceId: sanitizeString(invoice.id, 200),
            subscriptionId,
            clinicId,
            userId,
            email: customerEmail ? maskEmail(customerEmail) : null,
            amountDue: Number((invoice as any).amount_due || 0),
            currency: sanitizeString((invoice as any).currency, 20)
          });
          if (clinicId || userId || customerEmail) {
            await persistStripeSubscriptionReference({
              subscriptionId,
              customerId: sanitizeString(String((invoice as any).customer || ''), 200),
              email: customerEmail,
              userId,
              clinicId,
              status: 'pending'
            });
          }
          break;
        }
        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          const subscriptionId = sanitizeString(String((invoice as any).subscription || ''), 120);
          const customerEmail = sanitizeEmail(invoice.customer_email);
          let clinicId = '';
          let userId = '';
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
            clinicId = sanitizeString((subscription.metadata as any)?.clinicId, 120);
            userId = sanitizeString((subscription.metadata as any)?.userId, 120);
            const activePatientPriceId = resolveActivePatientPriceId();
            const subscriptionItem =
              activePatientPriceId
                ? subscription.items.data.find((item) => sanitizeString((item.price as any)?.id, 120) === activePatientPriceId)
                : subscription.items.data[0];
            await persistStripeSubscriptionReference({
              subscriptionId,
              subscriptionItemId: sanitizeString(subscriptionItem?.id, 120),
              customerId: sanitizeString(String((invoice as any).customer || subscription.customer || ''), 200),
              email: customerEmail,
              userId,
              clinicId,
              status: subscription.status
            });
          }
          await updateClinicSubscriptionStatus({
            clinicId,
            userId,
            email: customerEmail,
            status: 'active'
          });
          await clearClinicPaymentFailure({ clinicId, userId, email: customerEmail });
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const clinicId = sanitizeString((subscription.metadata as any)?.clinicId, 120);
          const userId = sanitizeString((subscription.metadata as any)?.userId, 120);
          const mappedStatus = normalizeSubscriptionStatusFromStripe(subscription.status);
          const activePatientPriceId = resolveActivePatientPriceId();
          const subscriptionItem =
            activePatientPriceId
              ? subscription.items.data.find((item) => sanitizeString((item.price as any)?.id, 120) === activePatientPriceId)
              : subscription.items.data[0];
          await persistStripeSubscriptionReference({
            subscriptionId: subscription.id,
            subscriptionItemId: sanitizeString(subscriptionItem?.id, 120),
            customerId: sanitizeString(String(subscription.customer || ''), 200),
            userId,
            clinicId,
            status: subscription.status
          });
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
  app.use((req: any, res: any, next: any) => {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      try {
        const statusCode = Number(res.statusCode || 200);
        if (!body || typeof body !== 'object') {
          return originalJson(body);
        }

        const normalized = { ...body };
        if (statusCode >= 500) {
          if ('details' in normalized) delete normalized.details;
          normalized.error = safeErrorMessageByStatus(statusCode);
          if ('stack' in normalized) delete normalized.stack;
          if ('raw' in normalized) delete normalized.raw;
          return originalJson(normalized);
        }

        if (statusCode >= 400 && statusCode < 500 && typeof normalized.error === 'string') {
          normalized.error = sanitizeString(normalized.error, 240) || safeErrorMessageByStatus(statusCode);
        }
        if ('details' in normalized && typeof normalized.details === 'string') {
          normalized.details = sanitizeString(normalized.details, 320);
        }
        return originalJson(normalized);
      } catch {
        return originalJson({ success: false, error: 'Erro interno do servidor.' });
      }
    };
    next();
  });

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
        
        const parsedDbUrl = new URL(dbUrl);
        const { Pool } = pg;
        const pool = new Pool({
          host: parsedDbUrl.hostname,
          port: Number(parsedDbUrl.port || 5432),
          user: decodeURIComponent(parsedDbUrl.username || ''),
          password: decodeURIComponent(parsedDbUrl.password || ''),
          database: (parsedDbUrl.pathname || '').replace(/^\//, ''),
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 8000,
          ssl: isProd ? { rejectUnauthorized: false } : undefined,
          family: 4
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

  // Security hardening:
  // In production, never run auth/session with volatile in-memory store.
  // If persistent PostgreSQL-backed session store is unavailable, fail fast.
  if (isProd && !sessionStore) {
    throw new Error('SESSION_STORE_UNAVAILABLE: PostgreSQL session store is required in production.');
  }

  const sessionMaxAgeDays = Math.max(
    1,
    Math.min(90, Number(process.env.SESSION_MAX_AGE_DAYS || 30) || 30)
  );

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
      maxAge: sessionMaxAgeDays * 24 * 60 * 60 * 1000,
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

  const isBillingAccessBlocked = async (user: any): Promise<boolean> => {
    const role = sanitizeString(user?.role, 40).toLowerCase();
    if (!['coordinator', 'therapist', 'receptionist', 'admin'].includes(role)) return false;
    const userId = sanitizeString(user?.id, 120);
    const clinicId = sanitizeString(currentClinicId(user), 120);
    const now = Date.now();

    const hasExpiredBlock = (row: any) => {
      const status = sanitizeString(row?.subscription_status, 40).toLowerCase();
      const blockAt = sanitizeString(row?.stripe_access_block_at, 80);
      return status === 'delinquent' && blockAt && new Date(blockAt).getTime() <= now;
    };

    try {
      if (clinicId) {
        const { data } = await supabase
          .from('clinics')
          .select('subscription_status,stripe_access_block_at')
          .eq('id', clinicId)
          .maybeSingle();
        if (hasExpiredBlock(data)) return true;
      }
      if (userId) {
        const { data } = await supabase
          .from('users')
          .select('subscription_status,stripe_access_block_at')
          .eq('id', userId)
          .maybeSingle();
        if (hasExpiredBlock(data)) return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  const checkAuth = async (req: any, res: any, next: any) => {
    const isPendingPatientActivation = (candidate: any) => {
      const role = sanitizeString(candidate?.role, 40).toLowerCase();
      const status = sanitizeString(candidate?.status, 60).toLowerCase();
      const firstLoginCompleted = candidate?.firstLoginCompleted;
      return role === 'patient' && (
        Boolean(candidate?.activationRequired) ||
        status === 'pending_activation' ||
        firstLoginCompleted === false
      );
    };

    // 1. Check Session (Cookie-based)
    if (req.session && req.session.user) {
      const sessionUserId = sanitizeString(req.session.user?.id, 120);
      const sessionToken = sanitizeString(req.session.user?.sessionToken, 120);
      const activeToken = sessionUserId ? activeSessionByUserId.get(sessionUserId) : null;
      if (sessionUserId && activeToken && sessionToken && activeToken !== sessionToken) {
        req.session.destroy(() => {});
        return res.status(401).json({
          error: 'SESSION_REVOKED',
          message: 'Sua conta foi acessada em outro dispositivo. Faça login novamente.'
        });
      }
      syncWorkspaceContextInSession(req, res, () => {});
      if (isPendingPatientActivation(req.session.user)) {
        return res.status(403).json({
          error: 'PATIENT_ACTIVATION_REQUIRED',
          message: 'Defina sua senha para ativar a conta, ou entre com Google.'
        });
      }
      if (mustBlockUnverifiedEmail(req, req.session.user)) {
        return res.status(403).json({
          error: 'EMAIL_NOT_CONFIRMED',
          message: 'Confirme seu e-mail para acessar funcionalidades sensíveis.'
        });
      }
      if (await isBillingAccessBlocked(req.session.user)) {
        return res.status(402).json({
          error: 'BILLING_ACCESS_BLOCKED',
          message: 'Acesso bloqueado por inadimplência. Regularize o pagamento para continuar.'
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
                sessionToken: issueSessionToken(sanitizeString(user.id, 120)),
                profilePicture: await resolvePatientPhotoUrl(profile.profile_picture, (profile as any)?.profile_picture_path),
                address: sanitizeString((profile as any)?.address || (profile as any)?.endereco, 320) || null,
                type: profile.type || user.user_metadata?.type || null,
                age: typeof profile.age === 'number' ? profile.age : null,
              subscriptionStatus: profile.subscription_status,
              planName: profile.plan_name,
              planPrice: profile.plan_price,
              status: sanitizeString((profile as any)?.status, 60) || null,
              activationRequired: Boolean((user as any)?.user_metadata?.patient_activation_required),
              clinicId: selectedWorkspace?.clinicId || profile.clinic_id,
              activeWorkspaceId: selectedWorkspace?.clinicId || profile.clinic_id,
              emailVerified: Boolean((user as any)?.email_confirmed_at || (user as any)?.confirmed_at),
              phoneVerified: Boolean((profile as any)?.phone_verified_at),
              firstLoginCompleted: (profile.first_login_completed ?? user.user_metadata?.first_login_completed) ?? null,
              crp: resolveStoredCrp(profile),
              signatureDataUrl: (profile as any)?.signatureDataUrl || (profile as any)?.signature_data_url || null,
              specialties: (profile as any)?.specialties || null,
              miniCurriculum: (profile as any)?.miniCurriculum || (profile as any)?.mini_curriculum || null,
              clinicSettings: user.user_metadata?.clinic_settings || null,
              workspaces
            });
            if (isPendingPatientActivation(req.session.user)) {
              return res.status(403).json({
                error: 'PATIENT_ACTIVATION_REQUIRED',
                message: 'Defina sua senha para ativar a conta, ou entre com Google.'
              });
            }
            if (mustBlockUnverifiedEmail(req, req.session.user)) {
              return res.status(403).json({
                error: 'EMAIL_NOT_CONFIRMED',
                message: 'Confirme seu e-mail para acessar funcionalidades sensíveis.'
              });
            }
            if (await isBillingAccessBlocked(req.session.user)) {
              return res.status(402).json({
                error: 'BILLING_ACCESS_BLOCKED',
                message: 'Acesso bloqueado por inadimplência. Regularize o pagamento para continuar.'
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

  const repairActivityLabelText = (value: unknown) =>
    sanitizeString(value, 220)
      .replace(/Ã§/g, 'ç')
      .replace(/Ã£/g, 'ã')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã©/g, 'é')
      .replace(/Ãª/g, 'ê')
      .replace(/Ã­/g, 'í')
      .replace(/Ã³/g, 'ó')
      .replace(/Ãµ/g, 'õ')
      .replace(/Ãº/g, 'ú')
      .replace(/Ã /g, 'à')
      .replace(/Ã‡/g, 'Ç');

  const normalizeActivityActionLabel = (value: unknown) =>
    repairActivityLabelText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/�/g, '')
      .toLowerCase()
      .trim();

  const toActivityActionSlug = (value: unknown) => {
    const normalized = normalizeActivityActionLabel(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);
    return normalized || 'activity_logged';
  };

  const activityActionByLabel: Record<string, string> = {
    'checkout cancelado lead em recuperacao': 'checkout_cancelled',
    'login de paciente mfa': 'patient_login_mfa',
    'login de paciente': 'patient_login',
    'leitura de historico sem tratamento ativo': 'patient_history_read_without_active_treatment',
    'convite de colaborador reenviado': 'clinic_invite_resent',
    'convite de colaborador enviado': 'clinic_invite_created',
    'convite cancelado': 'clinic_invite_cancelled',
    'convite aceito': 'clinic_invite_accepted',
    'papel de colaborador atualizado': 'team_member_role_updated',
    'membro desvinculado da clinica': 'team_member_unlinked',
    'salas atualizadas': 'update_rooms',
    'agenda clinica atualizada': 'update_appointments',
    'agendamento criado': 'create_appointment',
    'agendamento de sessao': 'create_session',
    'agendamento editado': 'update_appointment',
    'edicao de agendamento': 'update_appointment',
    'status de agenda atualizado': 'update_status',
    'configuracoes de duracao de sessao atualizadas': 'update_session_duration_settings',
    'protocolos atualizados': 'update_protocols',
    'template de anamnese atualizado': 'update_anamnesis_template',
    'ficha de anamnese arquivada': 'archive_anamnesis',
    'ficha de anamnese registrada': 'create_anamnesis',
    'paciente cadastrado atualizado': 'upsert_patient',
    'cadastro de paciente atualizado': 'update_patient',
    'cadastro de paciente': 'create_patient',
    'paciente cadastrado': 'create_patient',
    'novo paciente': 'create_patient',
    'paciente atualizado': 'update_patient',
    'atualizacao de cadastro': 'update_patient',
    'paciente excluido desvinculado': 'archive_patient',
    'paciente excluido': 'delete_patient',
    'paciente desvinculado': 'unlink_patient',
    'desvinculacao de paciente': 'unlink_patient',
    'arquivo salvo no prontuario': 'upload_patient_file',
    'arquivo removido do prontuario': 'delete_patient_file',
    'arquivos do prontuario atualizados': 'update_patient_files',
    'nota registrada no prontuario': 'create_note',
    'compartilhamento de anotacao': 'share_note',
    'remocao de compartilhamento de anotacao': 'unshare_note',
    'registro de evolucao salvo': 'create_history',
    'registro de evolucao': 'create_history',
    'edicao de historico': 'update_history',
    'exclusao de registro': 'delete_history',
    'registro de avaliacao': 'create_assessment',
    'registro da familia': 'create_family_note',
    'tarefa pei salva': 'upsert_task',
    'criacao de tarefa': 'create_task',
    'atualizacao de tarefa': 'update_task',
    'pagamento registrado': 'create_payment',
    'pesquisa do financeiro enviada': 'submit_financial_survey',
    'perfil profissional atualizado': 'update_professional_profile',
    'configuracoes atualizadas': 'update_clinic_settings',
    'reenvio de ativacao': 'resend_patient_activation',
    'reenvio de recuperacao': 'resend_patient_recovery',
    'solicitacao de protocolo importado': 'protocol_import_requested',
    'solicitacao de protocolo excluida': 'protocol_import_request_deleted',
    'acervo de protocolos atualizado': 'protocol_access_updated',
    'protocolo aprovado para uso': 'protocol_import_approved',
    'protocolo recusado': 'protocol_import_rejected',
    'varredura segura de protocolo': 'protocol_import_scanned',
    'protocolo canonico verto salvo': 'verto_protocol_saved',
    'logout do sistema': 'logout'
  };

  const resolveActivityLogAction = ({
    action,
    actionType,
    title,
    type,
  }: {
    action?: unknown;
    actionType?: unknown;
    title?: unknown;
    type?: unknown;
  }) => {
    for (const candidate of [action, actionType, title]) {
      const label = normalizeActivityActionLabel(candidate);
      if (!label) continue;
      if (activityActionByLabel[label]) return activityActionByLabel[label];
    }

    const titleLabel = normalizeActivityActionLabel(title);
    const pathMutation = titleLabel.match(/^(criou|atualizou|removeu|alterou)\s+(.+)$/);
    if (pathMutation) {
      const verb = pathMutation[1] === 'criou'
        ? 'create'
        : pathMutation[1] === 'atualizou'
          ? 'update'
          : pathMutation[1] === 'removeu'
            ? 'delete'
            : 'mutate';
      return `${verb}_${toActivityActionSlug(pathMutation[2])}`.slice(0, 120);
    }

    const auditMutation = titleLabel.match(/^(adicao|edicao|exclusao|atualizacao)\s+registrada\s+em\s+(.+)$/);
    if (auditMutation) {
      const verb = auditMutation[1] === 'adicao'
        ? 'create'
        : auditMutation[1] === 'edicao' || auditMutation[1] === 'atualizacao'
          ? 'update'
          : 'delete';
      return `${verb}_${toActivityActionSlug(auditMutation[2])}`.slice(0, 120);
    }

    const explicitActionType = sanitizeString(actionType, 180);
    if (explicitActionType) return toActivityActionSlug(explicitActionType);

    const explicitAction = sanitizeString(action, 180);
    if (explicitAction) return toActivityActionSlug(explicitAction);

    const fallback = sanitizeString(title || type, 180);
    return toActivityActionSlug(fallback || 'activity_logged');
  };

  const stringifyActivityPayload = (value: unknown) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const isTechnicalActivityLogEntry = (entry: any) => {
    const fields = [
      entry?.title,
      entry?.content,
      entry?.details,
      entry?.action,
      entry?.action_type,
      entry?.payload_details,
      entry?.request_path,
      entry?.request_method
    ]
      .map((value) => sanitizeString(value, 4000).toLowerCase())
      .filter(Boolean);
    const joined = fields.join(' ');
    const title = sanitizeString(entry?.title, 240).toLowerCase();
    const type = sanitizeString(entry?.type, 80).toLowerCase();

    if (joined.includes('/api/clinic/state') || joined.includes('/clinic/state')) return true;
    if (joined.includes('http ') && joined.includes('payload=')) return true;
    if (type === 'audit' && (joined.includes(' no endpoint ') || title.includes('registrada em '))) return true;
    if (/^(criou|atualizou|removeu|alterou)\s+\//i.test(title)) return true;
    return false;
  };

  const appointmentAgendaLogActions = new Set([
    'appointment_confirmed',
    'appointment_reschedule_requested',
    'appointment_cancelled'
  ]);

  const patientNonAgendaLogActions = new Set([
    'patient_history_read_without_active_treatment',
    'patient_login',
    'patient_login_mfa'
  ]);

  const parseActivityPayloadDetails = (entry: any) => {
    const raw = sanitizeString(entry?.payload_details || entry?.payloadDetails, 4000);
    if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  const resolveActivityEntryAction = (entry: any) => {
    const direct = sanitizeString(entry?.action, 180);
    if (direct) return toActivityActionSlug(direct);
    return resolveActivityLogAction({
      action: entry?.action,
      actionType: entry?.action_type || entry?.actionType,
      title: entry?.title,
      type: entry?.type
    });
  };

  const isAppointmentAgendaInteractionLogEntry = (entry: any) => {
    const action = resolveActivityEntryAction(entry);
    if (appointmentAgendaLogActions.has(action)) return true;

    const joined = normalizeActivityActionLabel([
      entry?.title,
      entry?.content,
      entry?.details,
      entry?.action_type,
      entry?.payload_details
    ].map((value) => sanitizeString(value, 1200)).filter(Boolean).join(' '));

    const mentionsAppointment = joined.includes('consulta') || joined.includes('agendamento') || joined.includes('agenda');
    const mentionsAllowedStatus =
      joined.includes('confirm') ||
      joined.includes('remarc') ||
      joined.includes('cancel');

    return mentionsAppointment && mentionsAllowedStatus;
  };

  const isPatientNonAgendaActivityLogEntry = (entry: any, currentUser?: any) => {
    const action = resolveActivityEntryAction(entry);
    if (isAppointmentAgendaInteractionLogEntry(entry)) return false;

    const payload = parseActivityPayloadDetails(entry);
    const actorRole = sanitizeString(
      payload?.actorRole ||
        payload?.actor_role ||
        entry?.actorRole ||
        entry?.actor_role ||
        currentUser?.role,
      40
    ).toLowerCase();
    const joined = normalizeActivityActionLabel([
      entry?.title,
      entry?.content,
      entry?.details,
      entry?.action_type,
      entry?.payload_details
    ].map((value) => sanitizeString(value, 1200)).filter(Boolean).join(' '));

    return (
      actorRole === 'patient' ||
      patientNonAgendaLogActions.has(action) ||
      joined.includes('leitura de historico sem tratamento ativo') ||
      joined.includes('paciente acessou o historico') ||
      joined.includes('login de paciente') ||
      joined.includes('acesso do paciente registrado')
    );
  };

  const filterVisibleActivityLogs = (rows: any[], currentUser?: any) =>
    (Array.isArray(rows) ? rows : [])
      .filter((row: any) => sanitizeString(row?.status, 40).toLowerCase() !== 'archived')
      .filter((row: any) => !isTechnicalActivityLogEntry(row))
      .filter((row: any) => !isPatientNonAgendaActivityLogEntry(row, currentUser));

  const persistActivityLog = async ({
    userId,
    clinicId,
    actorName,
    title,
    content,
    type = 'management',
    action,
    actionType,
    payloadDetails,
    details,
    payload
  }: {
    userId: string;
    clinicId?: string | null;
    actorName?: string | null;
    title: string;
    content?: string;
    type?: string;
    action?: string | null;
    actionType?: string | null;
    payloadDetails?: string | null;
    details?: string | null;
    payload?: unknown;
  }) => {
    try {
      const safeUserId = sanitizeString(userId, 120);
      const safeClinicId = sanitizeString(clinicId, 120);
      const safeTitle = sanitizeString(title, 180) || 'Atividade registrada';
      const safeContent =
        sanitizeString(content || details, 2000) ||
        'Ação registrada no sistema.';
      const resolvedAction = resolveActivityLogAction({
        action,
        actionType,
        title: safeTitle,
        type
      });
      const resolvedPayloadDetails =
        sanitizeString(payloadDetails || stringifyActivityPayload(payload) || details || safeContent, 4000) || null;
      if (
        isTechnicalActivityLogEntry({
          title: safeTitle,
          content: safeContent,
          action,
          action_type: actionType,
          payload_details: resolvedPayloadDetails,
          type
        })
      ) {
        return;
      }
      const basePayload: any = {
        id: crypto.randomUUID(),
        user_id: isUuid(safeUserId) ? safeUserId : null,
        action: resolvedAction,
        title: safeTitle,
        content: safeContent,
        type: sanitizeString(type, 40) || 'management',
        timestamp: new Date().toISOString()
      };

      const extendedPayload = {
        ...basePayload,
        clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
        actor_name: sanitizeString(actorName, 180) || null,
        action_type: sanitizeString(actionType || resolvedAction, 180) || resolvedAction,
        payload_details: resolvedPayloadDetails,
        source: 'server',
        status: 'active',
        is_active: true,
        created_at: basePayload.timestamp,
        updated_at: basePayload.timestamp
      };

      const insert = await writeActivityLogWithFallback(extendedPayload);
      if (!insert.error) return;
      logRouteDbError('persistActivityLog', insert.error, { title: safeTitle, action: resolvedAction, userId, clinicId });
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
        if (/password|pass|token|secret|key|authorization|cookie|otp|code|mfa|session|refresh|access|bearer|credential/i.test(key)) {
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

  const isActivityLogOptionalColumn = (column: string | null) =>
    Boolean(
      column &&
        [
          'clinic_id',
          'actor_name',
          'action',
          'action_type',
          'payload_details',
          'idempotency_key',
          'source',
          'request_path',
          'request_method',
          'ip_address',
          'user_agent',
          'created_at',
          'updated_at',
          'status',
          'deleted_at',
          'is_active'
        ].includes(column)
    );

  const writeActivityLogWithFallback = async (
    payload: Record<string, any>,
    options: { upsert?: boolean; select?: boolean } = {}
  ) => {
    let safePayload: Record<string, any> = cleanObject({ ...payload });
    const removedColumns = new Set<string>();
    let lastError: any = null;

    for (let attempt = 0; attempt < 16 && Object.keys(safePayload).length > 0; attempt += 1) {
      const query = options.upsert
        ? supabase.from('activity_logs').upsert([safePayload], { onConflict: 'id' })
        : supabase.from('activity_logs').insert([safePayload]);
      const result = options.select ? await query.select().single() : await query;
      if (!result.error) return { data: (result as any).data || safePayload, error: null };

      lastError = result.error;
      const errorMessage = String(result.error?.message || '').toLowerCase();
      if (errorMessage.includes('invalid input syntax for type uuid')) {
        if (errorMessage.includes('clinic_id') && safePayload.clinic_id) {
          delete safePayload.clinic_id;
          continue;
        }
        if (errorMessage.includes('user_id') && safePayload.user_id) {
          delete safePayload.user_id;
          continue;
        }
      }
      const missingColumn = extractMissingColumnName(result.error);
      if (!missingColumn || removedColumns.has(missingColumn) || !isActivityLogOptionalColumn(missingColumn)) {
        break;
      }
      removedColumns.add(missingColumn);
      delete safePayload[missingColumn];
    }

    return { data: null, error: lastError };
  };

  const buildActivityLogPayload = (currentUser: any, body: any, req?: any) => {
    const nowIso = new Date().toISOString();
    const safeUserId = sanitizeString(currentUser?.id, 120);
    const safeClinicId = sanitizeString(currentClinicId(currentUser), 120);
    const title =
      sanitizeString(body?.title || body?.action || body?.action_type, 180) ||
      'Atividade registrada';
    const content =
      sanitizeString(body?.content || body?.details || body?.description || body?.message, 4000) ||
      'Ação registrada no sistema.';
    const type = sanitizeString(body?.type || body?.category, 40) || 'management';
    const actionType = sanitizeString(body?.action_type || body?.action || title, 180) || title;
    const action = resolveActivityLogAction({
      action: body?.action,
      actionType: body?.action_type,
      title,
      type
    });
    const idFromBody = sanitizeString(body?.id, 120);
    const idempotencyKey = sanitizeString(
      body?.idempotencyKey || body?.idempotency_key || req?.headers?.['x-idempotency-key'],
      240
    );

    return cleanObject({
      id: isUuid(idFromBody) ? idFromBody : crypto.randomUUID(),
      user_id: isUuid(safeUserId) ? safeUserId : null,
      clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
      actor_name: sanitizeString(currentUser?.name || currentUser?.email || body?.actor_name || body?.professional, 180) || null,
      title,
      content,
      type,
      action,
      action_type: actionType || action,
      payload_details:
        sanitizeString(body?.payload_details || body?.payloadDetails || body?.details || content, 4000) || content,
      timestamp: sanitizeString(body?.timestamp, 40) || nowIso,
      idempotency_key: idempotencyKey || null,
      source: sanitizeString(body?.source, 40) || 'app',
      request_path: sanitizeString(req?.path, 240) || null,
      request_method: sanitizeString(req?.method, 20) || null,
      ip_address: sanitizeString(req?.ip || req?.headers?.['x-forwarded-for'], 120) || null,
      user_agent: sanitizeString(req?.headers?.['user-agent'], 500) || null,
      status: sanitizeString(body?.status, 40) || 'active',
      created_at: nowIso,
      updated_at: nowIso
    });
  };

  const trackProfessionalSignupCheckoutCancellation = async ({
    userId,
    email,
    planName,
    checkoutSessionId,
    source
  }: {
    userId?: string | null;
    email?: string | null;
    planName?: string | null;
    checkoutSessionId?: string | null;
    source?: string | null;
  }) => {
    try {
      const safeUserIdFromBody = sanitizeString(userId, 120);
      const safeEmail = sanitizeEmail(email);
      let resolvedUserId = safeUserIdFromBody || '';

      if (!resolvedUserId && safeEmail) {
        const authUser = await findAuthUserByEmail(safeEmail);
        resolvedUserId = sanitizeString(authUser?.id, 120) || '';
      }
      if (!resolvedUserId) return;

      const { data: profile } = await supabase
        .from('users')
        .select('id, name, email, phone, plan_name, subscription_status')
        .eq('id', resolvedUserId)
        .maybeSingle();
      if (!profile) return;

      const currentStatus = sanitizeString(profile.subscription_status, 40).toLowerCase();
      if (currentStatus === 'active') return;

      const safePlanName = sanitizeString(planName || profile.plan_name, 80);
      const safeSource = sanitizeString(source, 80) || 'cancel_url_return';
      const safeSessionId = sanitizeString(checkoutSessionId, 200);
      const maskedEmail = maskEmail(sanitizeEmail(profile.email) || safeEmail);
      const maskedPhone = profile.phone ? maskPhone(String(profile.phone)) : null;

      await persistActivityLog({
        userId: resolvedUserId,
        clinicId: resolvedUserId,
        actorName: sanitizeString(profile.name || profile.email || 'Lead profissional', 180),
        title: 'Checkout cancelado (lead em recuperação)',
        content: `Lead ${maskedEmail} cancelou checkout${safePlanName ? ` do plano ${safePlanName}` : ''}.`,
        type: 'lead_recovery',
        actionType: 'checkout_cancelled',
        payloadDetails: JSON.stringify({
          email: maskedEmail,
          phone: maskedPhone,
          planName: safePlanName || null,
          checkoutSessionId: safeSessionId || null,
          source: safeSource
        })
      });

      // Optional enrichment when extra columns exist in production schema.
      const leadPatch = cleanObject({
        lead_status: 'checkout_cancelled',
        lead_source: safeSource,
        lead_last_checkout_session_id: safeSessionId || null,
        lead_last_checkout_cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      const leadPatchKeys = Object.keys(leadPatch);
      if (leadPatchKeys.length > 0) {
        const { error: patchError } = await supabase
          .from('users')
          .update(leadPatch)
          .eq('id', resolvedUserId);
        if (patchError) {
          const message = String(patchError?.message || '').toLowerCase();
          if (!message.includes('column') && !message.includes('schema cache')) {
            console.warn('[Lead Recovery] Falha ao atualizar patch de lead:', message);
          }
        }
      }
    } catch (error: any) {
      console.warn('[Lead Recovery] Falha ao registrar cancelamento de checkout:', error?.message || String(error));
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
      path.startsWith('/clinic/state') ||
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
      req.path !== '/clinic/state' &&
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
        // Allow initial clinical record bootstrap flow to resolve/create mapping inside route handler.
        const isPatientRecordWrite =
          req.method?.toUpperCase?.() === 'POST' &&
          String(req.path || '').startsWith('/api/patient-records/');
        if (isPatientRecordWrite) {
          return next();
        }
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

      // Same-clinic access is reserved for clinic coordination.
      const userRole = sanitizeString(user?.role, 40).toLowerCase();
      if (
        patient.clinic_id &&
        patient.clinic_id === currentClinicId(user) &&
        (userRole === 'coordinator' || hasGlobalClinicAccess(user))
      ) {
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

    // Public onboarding/auth endpoints that must work without prior session.
    // Keep this list explicit and minimal.
    const publicStateChangingPaths = new Set<string>([
      '/auth/signup',
      '/auth/signup-direct',
      '/auth/login',
      '/auth/logout',
      '/auth/resend-confirmation',
      '/auth/activation/bootstrap',
      '/auth/password/recovery/bootstrap',
      '/auth/password/recovery/email/request',
      '/auth/password/recovery/verify',
      '/stripe/create-checkout-registration'
    ]);
    if (publicStateChangingPaths.has(req.path)) {
      return next();
    }

    const rawOrigin = sanitizeString(req.headers.origin, 500);
    const rawReferer = sanitizeString(req.headers.referer, 1000);
    const expected = `${req.protocol}://${req.get('host')}`;
    const configuredAppBase =
      sanitizeString(process.env.VERTO_APP_BASE_URL || process.env.APP_BASE_URL || '', 500);

    const allowedOrigins = new Set<string>();
    const pushAllowedOrigin = (value: string) => {
      if (!value) return;
      try {
        const parsed = new URL(value);
        allowedOrigins.add(parsed.origin.toLowerCase());
      } catch {
        // ignore invalid URL
      }
    };

    pushAllowedOrigin(expected);
    pushAllowedOrigin(configuredAppBase);

    const requestOrigin = rawOrigin ? rawOrigin.toLowerCase() : '';
    let refererOrigin = '';
    if (rawReferer) {
      try {
        refererOrigin = new URL(rawReferer).origin.toLowerCase();
      } catch {
        refererOrigin = '';
      }
    }

    const hasSessionCookie =
      Boolean((req.cookies && req.cookies['verto-session']) ||
      String(req.headers.cookie || '').includes('verto-session='));
    const hasBearerAuth = String(req.headers.authorization || '').toLowerCase().startsWith('bearer ');

    if (hasSessionCookie) {
      // Cookie-authenticated requests must present same-origin proof via Origin/Referer.
      const originAllowed = requestOrigin && allowedOrigins.has(requestOrigin);
      const refererAllowed = refererOrigin && allowedOrigins.has(refererOrigin);
      if (!originAllowed && !refererAllowed) {
        return res.status(403).json({
          error: 'Origem inválida para operação sensível.'
        });
      }
      return next();
    }

    // Non-cookie API clients (e.g. bearer token) are allowed without Origin/Referer.
    if (hasBearerAuth) {
      return next();
    }

    // If neither cookie nor bearer is present for a state-changing request, deny.
    if (!hasSessionCookie && !hasBearerAuth) {
      return res.status(403).json({
        error: 'Requisição sensível sem autenticação válida.'
      });
    }
    return next();
  });

  // --- HEALTH CHECK ---
  // Security hardening:
  // - Production must not expose internal env/integration details.
  // - Detailed diagnostics are available only outside production.
  app.get('/api/health', async (req, res) => {
    if (isProd) {
      return res.json({ status: 'ok' });
    }

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
      getStripe();
      status.stripe = 'ok';
    } catch (err: any) {
      status.stripe = `error: ${err.message}`;
    }

    return res.json(status);
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
        sessionToken: issueSessionToken(sanitizeString(user.id, 120)),
        profilePicture: await resolvePatientPhotoUrl(profile.profile_picture, (profile as any)?.profile_picture_path),
        address: sanitizeString((profile as any)?.address || (profile as any)?.endereco, 320) || null,
        type: profile.type || user.user_metadata?.type || null,
        age: typeof profile.age === 'number' ? profile.age : null,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        status: sanitizeString((profile as any)?.status, 60) || null,
        treatmentStatus,
        clinicId: clinicForSession,
        activeWorkspaceId: clinicForSession,
        emailVerified: isEmailVerified,
        phoneVerified: Boolean(profile.phone_verified_at),
        crp: resolveStoredCrp(profile),
        signatureDataUrl: (profile as any)?.signatureDataUrl || (profile as any)?.signature_data_url || null,
        specialties: (profile as any)?.specialties || null,
        miniCurriculum: (profile as any)?.miniCurriculum || (profile as any)?.mini_curriculum || null,
        clinicSettings: user.user_metadata?.clinic_settings || null,
        workspaces
      };

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

    const authRedirectTo = getActivationRedirectUrl(intendedRole || role || 'coordinator', safeEmail);
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

  const provisionProfessionalFromDirectStripeCheckout = async (params: {
    email: string;
    planName: 'Essencial' | 'Crescimento' | 'Avançado';
    customerName?: string | null;
    stripeCustomerId?: string | null;
  }) => {
    const safeEmail = sanitizeEmail(params.email);
    const planName = normalizeProfessionalPlan(params.planName);
    const customerName = sanitizeString(params.customerName, 180);
    const stripeCustomerId = sanitizeString(params.stripeCustomerId, 200);
    if (!safeEmail || !planName) {
      throw new Error('Dados insuficientes para provisionar acesso profissional por checkout direto.');
    }

    const planPrices: Record<'Essencial' | 'Crescimento' | 'Avançado', number> = {
      Essencial: 149.9,
      Crescimento: 399.9,
      Avançado: 679.9
    };

    let authUser = await findAuthUserByEmail(safeEmail);
    let userId = sanitizeString(authUser?.id, 120);
    const displayName = customerName || sanitizeString(authUser?.user_metadata?.full_name, 180) || safeEmail.split('@')[0];

    if (!userId) {
      const signupResult = await registerUserWithEmailConfirmation(
        {
          email: safeEmail,
          password: generateTemporaryCheckoutPassword(),
          name: displayName,
          role: 'professional',
          intendedRole: 'coordinator',
          planName
        },
        { deferActivationEmail: true }
      );

      if (!signupResult.ok) {
        throw new Error(sanitizeString((signupResult.body as any)?.error || 'Falha ao criar conta pós-pagamento.', 300));
      }

      userId = sanitizeString((signupResult.body as any)?.userId, 120);
      authUser = await findAuthUserByEmail(safeEmail);
    }

    if (!userId) {
      throw new Error('Nao foi possivel localizar a conta apos o checkout.');
    }

    const { data: existingProfile } = await supabase
      .from('users')
      .select('id, role, email, name')
      .eq('id', userId)
      .maybeSingle();

    const existingRole = sanitizeString(existingProfile?.role, 40).toLowerCase();
    if (existingRole === 'patient') {
      throw new Error('Este e-mail ja possui cadastro como paciente e nao pode receber plano profissional direto.');
    }

    let profileUpdatePayload = cleanObject({
      email: safeEmail,
      name: displayName,
      role: 'coordinator',
      clinic_id: userId,
      subscription_status: 'active',
      plan_name: planName,
      plan_price: planPrices[planName],
      updated_at: new Date().toISOString()
    });

    const removedColumns = new Set<string>();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { error: updateError } = await supabase
        .from('users')
        .update(profileUpdatePayload)
        .eq('id', userId);

      if (!updateError) break;

      const missingColumn = extractMissingColumnName(updateError);
      if (!missingColumn || removedColumns.has(missingColumn)) {
        throw updateError;
      }

      removedColumns.add(missingColumn);
      const { [missingColumn]: _removed, ...rest } = profileUpdatePayload as any;
      profileUpdatePayload = rest;
    }

    await ensureClinicAndMembershipForCoordinator(userId, displayName || null);
    await updateClinicSubscriptionStatus({
      clinicId: userId,
      userId,
      email: safeEmail,
      status: 'active'
    });

    if (stripeCustomerId) {
      await persistStripeCustomerReference({
        customerId: stripeCustomerId,
        email: safeEmail,
        userId,
        clinicId: userId
      });
    }

    try {
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...((authUser as any)?.user_metadata || {}),
          full_name: displayName,
          role: 'coordinator'
        }
      });
    } catch (metadataError: any) {
      console.warn('[Stripe] Nao foi possivel atualizar metadata do usuario provisionado por link direto:', {
        userId,
        message: metadataError?.message || String(metadataError)
      });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
    if (authError) {
      throw authError;
    }

    const latestAuthUser = authData?.user;
    const isEmailConfirmed = Boolean((latestAuthUser as any)?.email_confirmed_at || (latestAuthUser as any)?.confirmed_at);
    const targetEmail = sanitizeEmail(latestAuthUser?.email) || safeEmail;

    if (!isEmailConfirmed && targetEmail) {
      const activationLink =
        (await generateSupabaseActionLink({
          type: 'signup',
          email: targetEmail,
          redirectTo: getActivationRedirectUrl('coordinator', targetEmail)
        })) ||
        (await generateSupabaseActionLink({
          type: 'recovery',
          email: targetEmail,
          redirectTo: getActivationRedirectUrl('coordinator', targetEmail)
        })) ||
        getActivationRedirectUrl('coordinator', targetEmail);

      const activationEmail = buildActivationEmailTemplate({
        nome: displayName,
        link_ativacao: activationLink,
        perfil: 'professional'
      });

      await sendTransactionalEmailSafe({
        to: targetEmail,
        subject: activationEmail.subject,
        html: activationEmail.html,
        context: 'professional_direct_payment_activation',
        from: OFFICIAL_FROM_CONTACT,
        replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
        templateKind: 'welcome_professional',
        templateData: {
          nome: displayName,
          link_ativacao: activationLink
        },
        metadata: {
          userId,
          email: maskEmail(targetEmail),
          planName
        }
      });
    }

    return { userId, planName, email: targetEmail };
  };

  app.post('/api/auth/signup', authSignupLimiter, async (req, res) => {
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
  app.post('/api/auth/signup-direct', authSignupLimiter, async (req, res) => {
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
          redirectTo: getActivationRedirectUrl(profile?.role, email)
        })) || getActivationRedirectUrl(profile?.role, email);
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

  app.post('/api/auth/activation/bootstrap', async (req, res) => {
    try {
      const email = sanitizeEmail(req.body?.email);
      const role = sanitizeString(req.body?.role, 40).toLowerCase();
      if (!email) {
        return res.status(400).json({ success: false, error: 'E-mail inválido.' });
      }

      const authUser = await findAuthUserByEmail(email);
      if (!authUser?.id) {
        return res.status(404).json({ success: false, error: 'Conta não encontrada para ativação.' });
      }
      const isAlreadyConfirmed = Boolean(
        (authUser as any)?.email_confirmed_at || (authUser as any)?.confirmed_at,
      );
      if (isAlreadyConfirmed) {
        return res.status(409).json({
          success: false,
          code: 'ALREADY_CONFIRMED',
          error: 'Conta já ativada. Use login normal ou recuperação de senha.',
        });
      }

      const profileRole = role === 'patient' ? 'patient' : 'coordinator';
      if (profileRole === 'patient') {
        await supabase.auth.admin.updateUserById(authUser.id, {
          user_metadata: {
            ...((authUser as any)?.user_metadata || {}),
            role: 'patient',
            invited_email: email,
            patient_activation_required: true,
            first_login_completed: false
          }
        });
      }
      const activationLinkFromSignup = await generateSupabaseActionLink({
        type: 'signup',
        email,
        redirectTo: getActivationRedirectUrl(profileRole, email),
      });
      const activationLink =
        activationLinkFromSignup ||
        (await generateSupabaseActionLink({
          type: 'recovery',
          email,
          redirectTo: getActivationRedirectUrl(profileRole, email),
        }));

      if (!activationLink) {
        return res.status(500).json({
          success: false,
          error: 'Não foi possível gerar novo link de ativação no momento.',
        });
      }

      return res.json({ success: true, activationLink });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: sanitizeString(error?.message || 'Falha ao recuperar link de ativação.', 500),
      });
    }
  });

  app.post('/api/auth/password/recovery/bootstrap', async (req, res) => {
    return res.status(410).json({
      success: false,
      error:
        'Bootstrap de recuperação desativado por segurança. Solicite um novo e-mail de recuperação.',
    });
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
      await setOtpChallenge({
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
      // Security hardening: never expose OTP in URL query params.
      // Recovery code must be delivered by e-mail body and entered manually by user.
      const recoveryLink = `${getRecoveryRedirectUrl()}`;
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
        // For recovery we force server-rendered HTML to guarantee fresh link/code delivery.
        templateKind: undefined,
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
      const challenge = await getOtpChallenge(key);
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
        await consumeOtpChallenge(key);
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
        await setOtpChallenge(challenge);
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
        await consumeOtpChallenge(key);
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

      await consumeOtpChallenge(key);
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
  app.post('/api/auth/login', authLoginLimiter, async (req, res) => {
    const { intendedRole } = req.body;
    const activationFlow = Boolean(req.body?.activationFlow);
    const passwordSetupCompleted = Boolean(req.body?.passwordSetupCompleted);
    const authProvider = sanitizeString(req.body?.provider, 40).toLowerCase();
    const activationEmail = sanitizeEmail(req.body?.activationEmail);
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
      const safeAuthEmail = sanitizeEmail(user.email);
      if (
        activationFlow &&
        normalizeRequestedRole(intendedRole) === 'patient' &&
        authProvider === 'google' &&
        (!activationEmail || !safeAuthEmail || activationEmail !== safeAuthEmail)
      ) {
        return res.status(403).json({
          error: 'GOOGLE_EMAIL_MISMATCH',
          message: 'Entre com a mesma conta Google do e-mail cadastrado para este paciente.'
        });
      }
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

      // If profile doesn't exist for this auth user ID, try reconciling by e-mail first.
      if (!profile && user.email) {
        const safeUserEmail = sanitizeEmail(user.email);
        if (safeUserEmail) {
          const { data: profileByEmail, error: profileByEmailError } = await supabase
            .from('users')
            .select('*')
            .ilike('email', safeUserEmail)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (profileByEmailError && profileByEmailError.code !== 'PGRST116') {
            console.warn('[Auth] profileByEmail lookup warning:', profileByEmailError.message || String(profileByEmailError));
          }

          if (profileByEmail) {
            const reconciledProfilePayload = cleanObject({
              id: user.id,
              email: safeUserEmail,
              name: sanitizeString(profileByEmail.name, 180) || user.user_metadata?.full_name || safeUserEmail.split('@')[0],
              role: ensureRole(profileByEmail.role) ? profileByEmail.role : 'patient',
              clinic_id: sanitizeString(profileByEmail.clinic_id, 120) || null,
              subscription_status: sanitizeString(profileByEmail.subscription_status, 40) || 'pending',
              plan_name: sanitizeString(profileByEmail.plan_name, 120) || null,
              plan_price: profileByEmail.plan_price ?? null,
              type: sanitizeString(profileByEmail.type, 80) || null,
              status: sanitizeString(profileByEmail.status, 40) || 'active',
              phone: sanitizeString(profileByEmail.phone, 30) || null,
              created_at: new Date().toISOString()
            });

            let safeReconciledPayload: Record<string, any> = { ...reconciledProfilePayload };
            while (Object.keys(safeReconciledPayload).length > 0) {
              const { error: reconcileUpsertError } = await supabase
                .from('users')
                .upsert([safeReconciledPayload], { onConflict: 'id' });
              if (!reconcileUpsertError) break;
              const missingColumn = extractMissingColumnName(reconcileUpsertError);
              if (!missingColumn || !(missingColumn in safeReconciledPayload)) {
                throw reconcileUpsertError;
              }
              delete safeReconciledPayload[missingColumn];
            }

            const { data: reconciledProfile } = await supabase
              .from('users')
              .select('*')
              .eq('id', user.id)
              .maybeSingle();
            if (reconciledProfile) {
              profile = reconciledProfile;
            }
          }
        }
      }

      // If profile still doesn't exist (first time Google login), create it
      if (!profile) {
        let finalRole: AppRole = normalizeRequestedRole(intendedRole);
        if (finalRole === 'patient' && authProvider === 'google' && activationFlow) {
          return res.status(403).json({
            error: 'PATIENT_INVITE_NOT_FOUND',
            message: 'Não encontramos convite de paciente para esta conta Google.'
          });
        }
        
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
      let authActivationRequired = Boolean((user as any)?.user_metadata?.patient_activation_required);

      if (roleForSession === 'patient') {
        const profileStatus = sanitizeString((profile as any)?.status, 60).toLowerCase();
        const needsActivation =
          authActivationRequired ||
          profileStatus === 'pending_activation' ||
          (profile as any)?.first_login_completed === false;
        if (needsActivation && !activationFlow) {
          return res.status(403).json({
            error: 'PATIENT_ACTIVATION_REQUIRED',
            message: 'Ative sua conta pelo link enviado por e-mail antes de acessar o portal.'
          });
        }

        if (needsActivation && activationFlow) {
          const canActivatePendingPatient =
            authProvider === 'google' ||
            passwordSetupCompleted ||
            hasCredentials;
          if (!canActivatePendingPatient) {
            return res.status(403).json({
              error: 'PATIENT_PASSWORD_SETUP_REQUIRED',
              message: 'Defina sua senha para concluir a ativação, ou entre com Google.'
            });
          }
          const safePatientEmail = sanitizeEmail(user.email);
          const userUpdatesBase = cleanObject({
            status: 'active',
            first_login_completed: true,
            updated_at: new Date().toISOString()
          });
          let safeUserUpdates: Record<string, any> = { ...userUpdatesBase };
          while (Object.keys(safeUserUpdates).length > 0) {
            const { error: activateUserError } = await supabase
              .from('users')
              .update(safeUserUpdates)
              .eq('id', user.id);
            if (!activateUserError) break;
            const missingColumn = extractMissingColumnName(activateUserError);
            if (!missingColumn || !(missingColumn in safeUserUpdates)) throw activateUserError;
            delete safeUserUpdates[missingColumn];
          }

          if (safePatientEmail) {
            const patientUpdates = cleanObject({
              status: 'active',
              updated_at: new Date().toISOString()
            });
            let patientQuery = supabase
              .from('patients')
              .update(patientUpdates)
              .ilike('email', safePatientEmail);
            if (isUuid(clinicForSession)) {
              patientQuery = patientQuery.eq('clinic_id', clinicForSession);
            }
            const { error: activatePatientError } = await patientQuery;
            if (activatePatientError) {
              console.warn('[Auth] Patient activation status update warning:', activatePatientError.message || String(activatePatientError));
            }
          }

          profile = {
            ...profile,
            status: 'active',
            first_login_completed: true
          };
          authActivationRequired = false;
          try {
            await supabase.auth.admin.updateUserById(user.id, {
              user_metadata: {
                ...((user as any)?.user_metadata || {}),
                patient_activation_required: false,
                first_login_completed: true
              }
            });
          } catch (metadataUpdateError: any) {
            console.warn('[Auth] Patient activation metadata update warning:', metadataUpdateError?.message || String(metadataUpdateError));
          }
        }
      }

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
        profilePicture: await resolvePatientPhotoUrl(profile.profile_picture, (profile as any)?.profile_picture_path),
        address: sanitizeString((profile as any)?.address || (profile as any)?.endereco, 320) || null,
        type: profile.type || user.user_metadata?.type || null,
        age: typeof profile.age === 'number' ? profile.age : null,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        activationRequired: authActivationRequired,
        treatmentStatus,
        clinicId: clinicForSession,
        activeWorkspaceId: clinicForSession,
        emailVerified: isEmailVerified,
        phoneVerified: Boolean(profile.phone_verified_at),
        firstLoginCompleted: (profile.first_login_completed ?? user.user_metadata?.first_login_completed) ?? null,
        crp: resolveStoredCrp(profile),
        signatureDataUrl: (profile as any)?.signatureDataUrl || (profile as any)?.signature_data_url || null,
        specialties: (profile as any)?.specialties || null,
        miniCurriculum: (profile as any)?.miniCurriculum || (profile as any)?.mini_curriculum || null,
        clinicSettings: user.user_metadata?.clinic_settings || null,
        workspaces
      };

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
    invalidateActiveSession(req.session?.user?.id, req.session?.user?.sessionToken);
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Logout failed' });
      res.clearCookie('verto-session');
      res.json({ success: true });
    });
  });

  app.get('/api/auth/me', authMeLimiter, syncWorkspaceContextInSession, async (req: any, res: any) => {
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
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
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
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  // Clinic Management & Invitations
  app.get('/api/clinic/members', checkAuth, async (req: any, res) => {
    const user = req.session.user;
    if (user.role !== 'coordinator' && user.role !== 'admin' && user.role !== 'owner') {
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

      const memberIds = Array.from(
        new Set(
          (data || [])
            .map((member: any) => sanitizeString(member?.users?.id || member?.user_id, 120))
            .filter(Boolean),
        ),
      );
      const professionalProfilesByUserId = new Map<string, any>();
      if (memberIds.length > 0) {
        const { data: professionalProfiles } = await supabase
          .from('professional_profiles')
          .select('user_id, full_name, metadata')
          .in('user_id', memberIds);

        (professionalProfiles || []).forEach((profile: any) => {
          const userId = sanitizeString(profile?.user_id, 120);
          if (userId) professionalProfilesByUserId.set(userId, profile);
        });
      }

      const members = (data || []).map((m: any) => ({
        id: m.users?.id || m.user_id,
        name:
          sanitizeString(
            professionalProfilesByUserId.get(sanitizeString(m.users?.id || m.user_id, 120))?.full_name,
            180,
          ) ||
          m.users?.name ||
          'Profissional',
        full_name:
          sanitizeString(
            professionalProfilesByUserId.get(sanitizeString(m.users?.id || m.user_id, 120))?.full_name,
            180,
          ) ||
          m.users?.name ||
          'Profissional',
        email: m.users?.email || '',
        role: m.role,
        profileRole:
          sanitizeString(
            professionalProfilesByUserId.get(sanitizeString(m.users?.id || m.user_id, 120))?.metadata?.role,
            40,
          ) ||
          sanitizeString(m?.role, 40) ||
          null,
        clinic_id: clinicId,
        created_at: m.created_at
      }));
      res.json({ success: true, data: members });
    } catch (error: any) {
      logRouteDbError('/api/notes/:patientId [GET]', error, { patientId: sanitizeString(req.params.patientId, 120) });
      res.status(500).json({ error: 'Falha na operação de dados.' });
    }
  });

  app.post('/api/clinic/invite', inviteLimiter, checkAuth, async (req: any, res) => {
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

      // Check for existing pending invitation.
      const { data: existing } = await supabase
        .from('invitations')
        .select('*')
        .eq('email', email)
        .eq('clinic_id', clinicId)
        .eq('status', 'pending')
        .maybeSingle();
      let reusedExistingInvitation = false;
      let existingInvitationId = sanitizeString(existing?.id, 120);
      if (!existing) {
        const usage = await getClinicTeamAccessUsage(clinicId);
        if (usage.used >= usage.limit) {
          return res.status(409).json({
            success: false,
            code: 'TEAM_ACCESS_LIMIT_REACHED',
            error: `Limite saudável atingido: ${usage.used} de ${usage.limit} acessos de equipe em uso para ${usage.activePatients} paciente(s) ativo(s).`,
            details: {
              activePatients: usage.activePatients,
              activeMembers: usage.activeMembers,
              pendingInvitations: usage.pendingInvitations,
              limit: usage.limit,
              used: usage.used,
              professionalsPerActivePatient: TEAM_ACCESS_PER_ACTIVE_PATIENT
            }
          });
        }
      }
      if (existing) {
        reusedExistingInvitation = true;
        // Keep invitation fresh and allow role correction on resend.
        let patchPayload: Record<string, any> = cleanObject({
          role,
          invited_by: user.id,
          updated_at: new Date().toISOString()
        });
        const removedPatchColumns = new Set<string>();
        let updatedInvitation: any = null;
        let updateError: any = null;

        for (let attempt = 0; attempt < 8; attempt += 1) {
          const updateResult = await supabase
            .from('invitations')
            .update(patchPayload)
            .eq('id', existingInvitationId)
            .select()
            .single();

          updatedInvitation = updateResult.data;
          updateError = updateResult.error;
          if (!updateError) break;

          const missingColumn = extractMissingColumnName(updateError);
          if (!missingColumn || removedPatchColumns.has(missingColumn)) {
            break;
          }

          removedPatchColumns.add(missingColumn);
          const { [missingColumn]: _removed, ...rest } = patchPayload as any;
          patchPayload = rest;
        }

        if (updateError) throw updateError;
        existingInvitationId = sanitizeString(updatedInvitation?.id, 120) || existingInvitationId;
      }

      const invitationBasePayload = cleanObject({
        email,
        clinic_id: clinicId,
        clinic_name: sanitizeString(clinic?.name, 160) || sanitizeString(user.name, 160) || 'Clinica',
        role,
        required_onboarding_fields: requiredOnboardingFields,
        status: 'pending',
        invited_by: user.id,
        created_at: new Date().toISOString()
      });

      let invitePayload: Record<string, any> = { ...invitationBasePayload };
      const removedInvitationColumns = new Set<string>();
      let insertedInvitation: any = null;
      let inviteError: any = null;

      if (!reusedExistingInvitation) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const result = await supabase
            .from('invitations')
            .insert([invitePayload])
            .select()
            .single();
          insertedInvitation = result.data;
          inviteError = result.error;
          if (!inviteError) break;

          const missingColumn = extractMissingColumnName(inviteError);
          if (!missingColumn || removedInvitationColumns.has(missingColumn)) {
            break;
          }

          removedInvitationColumns.add(missingColumn);
          const { [missingColumn]: _removed, ...rest } = invitePayload as any;
          invitePayload = rest;
        }
      } else {
        insertedInvitation = {
          ...(existing || {}),
          id: existingInvitationId,
          role
        };
      }

      if (inviteError) throw inviteError;
      const data = insertedInvitation;

      // Garante usuário Auth para fluxo de ativação por senha/google sem depender do e-mail do Supabase.
      let authUser = await findAuthUserByEmail(email);
      if (!authUser?.id) {
        const tempPassword = generateTemporaryPassword();
        const createResult = await supabase.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: false,
          user_metadata: {
            full_name: email.split('@')[0],
            invited_role: role,
            clinic_id: clinicId
          }
        });
        if (createResult.error) throw createResult.error;
        authUser = createResult.data?.user || null;
      }

      const activationLink =
        (await withTimeoutOrFallback(
          generateSupabaseActionLink({
            type: 'signup',
            email,
            redirectTo: getActivationRedirectUrl('coordinator', email)
          }),
          8000,
          null,
          'generateSupabaseActionLink(clinic_invite)'
        )) || getActivationRedirectUrl('coordinator', email);

      const invitedRoleLabel = role === 'receptionist' ? 'Recepcionista' : 'Terapeuta';
      const clinicName = sanitizeString(clinic?.name, 160) || sanitizeString(user.name, 160) || 'Clinica';
      const activationEmail = buildActivationEmailTemplate({
        nome: email.split('@')[0],
        link_ativacao: activationLink,
        perfil: 'professional'
      });
      const htmlWithInviteContext = activationEmail.html
        .replace(
          '</h1>',
          `</h1><p style="margin:0 0 16px 0;color:#5b21b6;font-size:15px;line-height:1.55;">Você foi convidado(a) para atuar como <strong>${invitedRoleLabel}</strong> na clínica <strong>${clinicName}</strong>.</p>`
        );

      const emailSent = await withTimeoutOrFallback(
        sendTransactionalEmailSafe({
        to: email,
        subject: `Convite para ${clinicName} na Verto`,
        html: htmlWithInviteContext,
        context: 'clinic_invitation',
        from: OFFICIAL_FROM_NOREPLY,
        replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
        templateKind: 'welcome_professional',
        templateData: {
          nome: email.split('@')[0],
          link_ativacao: activationLink
        },
        metadata: {
          invitationId: data?.id || null,
          clinicId,
          invitedRole: role,
          invitedBy: user.id,
          email: maskEmail(email)
        }
        }),
        12000,
        false,
        'sendTransactionalEmailSafe(clinic_invitation)'
      );

      await persistIdentityAuditLog({
        title: 'Convite de colaborador enviado',
        content: `Convite para ${maskEmail(email)} como ${invitedRoleLabel} em ${clinicName}. E-mail oficial ${emailSent ? 'enviado' : 'com falha de envio'}.`,
        identifier: email,
        channel: 'email',
        userId: authUser?.id || null,
        request: req,
        status: emailSent ? 'sent' : 'warning'
      });
      await persistActivityLog({
        userId: sanitizeString(user.id, 120),
        clinicId: sanitizeString(clinicId, 120),
        actorName: sanitizeString(user.name || user.email || 'Coordenador', 180),
        title: reusedExistingInvitation ? 'Convite de colaborador reenviado' : 'Convite de colaborador enviado',
        content: `Convite para ${maskEmail(email)} como ${invitedRoleLabel} em ${clinicName}. E-mail ${emailSent ? 'enviado' : 'com falha de envio'}.`,
        type: 'management',
        actionType: reusedExistingInvitation ? 'clinic_invite_resent' : 'clinic_invite_created',
        payloadDetails: JSON.stringify({
          invitationId: data?.id || null,
          invitedRole: role,
          email: maskEmail(email),
          emailSent
        })
      });

      res.json({
        success: true,
        data,
        invitationEmailSent: emailSent,
        resent: reusedExistingInvitation,
        message: emailSent
          ? reusedExistingInvitation
            ? `Convite reenviado para ${email}.`
            : `Convite enviado para ${email}.`
          : `Convite criado, mas houve falha no envio de e-mail para ${email}.`
      });
    } catch (error: any) {
      logRouteDbError('/api/tasks/:patientId [GET]', error, { patientId: sanitizeString(req.params.patientId, 120) });
      res.status(500).json({ error: 'Falha na operação de dados.' });
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
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      const { data: membershipHistory, error: membershipHistoryError } = await supabase
        .from('clinic_memberships')
        .select(`
          user_id,
          role,
          status,
          updated_at,
          created_at,
          users:user_id (
            id,
            name,
            email
          )
        `)
        .eq('clinic_id', clinicId)
        .eq('status', 'inactive')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (membershipHistoryError) throw membershipHistoryError;

      res.json({
        success: true,
        data,
        membershipHistory: (membershipHistory || []).map((m: any) => ({
          id: `membership-${sanitizeString(m?.user_id, 120)}`,
          user_id: sanitizeString(m?.user_id, 120),
          email: sanitizeEmail(m?.users?.email) || '',
          name: sanitizeString(m?.users?.name, 180) || 'Colaborador',
          role: sanitizeString(m?.role, 40) || 'therapist',
          status: 'unlinked',
          created_at: m?.created_at || null,
          updated_at: m?.updated_at || null
        }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.patch('/api/clinic/invitations/:invitationId/cancel', checkAuth, async (req: any, res) => {
    try {
      const user = req.session.user;
      if (user.role !== 'coordinator' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas coordenadores podem cancelar convites' });
      }

      const clinicId = currentClinicId(user);
      const invitationId = sanitizeString(req.params?.invitationId, 120);
      if (!invitationId) {
        return res.status(400).json({ error: 'Convite inválido' });
      }

      const { data: invitation, error: findError } = await supabase
        .from('invitations')
        .select('id,status,clinic_id,email')
        .eq('id', invitationId)
        .eq('clinic_id', clinicId)
        .maybeSingle();

      if (findError) throw findError;
      if (!invitation) {
        return res.status(404).json({ error: 'Convite não encontrado' });
      }
      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: 'Somente convites pendentes podem ser cancelados' });
      }

      let cancelPayload: Record<string, any> = {
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        canceled_by: user.id,
        updated_at: new Date().toISOString()
      };
      const removedCancelColumns = new Set<string>();
      let cancelError: any = null;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const updateResult = await supabase
          .from('invitations')
          .update(cancelPayload)
          .eq('id', invitationId)
          .eq('clinic_id', clinicId);

        cancelError = updateResult.error;
        if (!cancelError) break;

        const missingColumn = extractMissingColumnName(cancelError);
        if (!missingColumn || removedCancelColumns.has(missingColumn)) {
          break;
        }

        removedCancelColumns.add(missingColumn);
        const { [missingColumn]: _removed, ...rest } = cancelPayload as any;
        cancelPayload = rest;
      }

      if (cancelError) throw cancelError;

      await persistActivityLog({
        title: 'Convite cancelado',
        content: `Convite para ${maskEmail(sanitizeEmail(invitation.email) || '***')} foi cancelado.`,
        type: 'management',
        userId: sanitizeString(user?.id, 120),
        clinicId,
        actorName: sanitizeString(user?.name || user?.email || 'Coordenador', 180)
      });

      res.json({
        success: true,
        message: `Convite cancelado para ${sanitizeString(invitation.email, 160)}.`
      });
    } catch (error: any) {
      logRouteDbError('/api/clinic/invitations/:invitationId/cancel [PATCH]', error, {
        invitationId: sanitizeString(req.params?.invitationId, 120),
        userId: sanitizeString(req.session?.user?.id, 120)
      });
      res.status(500).json({ error: 'Falha na operação de dados.' });
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
      await persistActivityLog({
        title: 'Convite aceito',
        content: `${maskEmail(sanitizeEmail(user.email) || '***')} aceitou convite e entrou na clínica.`,
        type: 'management',
        userId: sanitizeString(user?.id, 120),
        clinicId: sanitizeString(invitation.clinic_id, 120),
        actorName: sanitizeString(user?.name || user?.email || 'Colaborador', 180)
      });

      let acceptPayload: Record<string, any> = {
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const removedAcceptColumns = new Set<string>();
      let acceptError: any = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const acceptResult = await supabase
          .from('invitations')
          .update(acceptPayload)
          .eq('id', invitationId);
        acceptError = acceptResult.error;
        if (!acceptError) break;
        const missingColumn = extractMissingColumnName(acceptError);
        if (!missingColumn || removedAcceptColumns.has(missingColumn)) {
          break;
        }
        removedAcceptColumns.add(missingColumn);
        const { [missingColumn]: _removed, ...rest } = acceptPayload as any;
        acceptPayload = rest;
      }
      if (acceptError) throw acceptError;

      req.session.user.clinicId = invitation.clinic_id;
      req.session.user.activeWorkspaceId = invitation.clinic_id;
      req.session.user.role = invitation.role;
      req.session.user.workspaces = compactWorkspacesForSession(await fetchUserWorkspaces(user.id));
      req.session.user = buildSessionUserPayload(req.session.user);

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      await persistActivityLog({
        title: 'Papel de colaborador atualizado',
        content: `Colaborador ${sanitizeString(memberId, 120)} atualizado para papel ${role}.`,
        type: 'management',
        userId: sanitizeString(adminUser?.id, 120),
        clinicId,
        actorName: sanitizeString(adminUser?.name || adminUser?.email || 'Coordenador', 180)
      });
      res.json({ success: true, message: 'Papel atualizado com sucesso' });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });
  app.patch('/api/clinic/members/:memberId/unlink', checkAuth, async (req: any, res) => {
    const adminUser = req.session.user;
    if (adminUser.role !== 'coordinator' && adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas coordenadores podem desvincular membros' });
    }

    const memberId = sanitizeString(req.params?.memberId, 120);
    if (!memberId) return res.status(400).json({ error: 'Membro inválido' });
    if (memberId === sanitizeString(adminUser?.id, 120)) {
      return res.status(400).json({ error: 'Você não pode desvincular sua própria conta por esta ação' });
    }

    try {
      const clinicId = currentClinicId(adminUser);
      const { data: targetMembership, error: membershipError } = await supabase
        .from('clinic_memberships')
        .select('user_id, clinic_id, role, status')
        .eq('user_id', memberId)
        .eq('clinic_id', clinicId)
        .eq('status', 'active')
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!targetMembership) {
        return res.status(404).json({ error: 'Membro não encontrado nesta clínica' });
      }

      const { error: unlinkError } = await supabase
        .from('clinic_memberships')
        .update({
          status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', memberId)
        .eq('clinic_id', clinicId)
        .eq('status', 'active');

      if (unlinkError) throw unlinkError;

      const { data: remainingMemberships, error: remainingError } = await supabase
        .from('clinic_memberships')
        .select('clinic_id, role, status')
        .eq('user_id', memberId)
        .eq('status', 'active');
      if (remainingError) throw remainingError;

      const nextMembership = (remainingMemberships || [])[0];
      const nextClinicId = sanitizeString(nextMembership?.clinic_id, 120) || null;
      const nextRole = ensureRole(nextMembership?.role) ? nextMembership.role : 'patient';

      const userUpdatePayload: Record<string, any> = {
        updated_at: new Date().toISOString()
      };
      if (nextClinicId) {
        userUpdatePayload.clinic_id = nextClinicId;
        userUpdatePayload.role = nextRole;
      } else {
        userUpdatePayload.clinic_id = null;
        userUpdatePayload.role = 'patient';
      }

      const { error: userUpdateError } = await supabase
        .from('users')
        .update(userUpdatePayload)
        .eq('id', memberId);
      if (userUpdateError) throw userUpdateError;

      await persistActivityLog({
        title: 'Membro desvinculado da clínica',
        content: `Usuário ${memberId} foi desvinculado da clínica ${clinicId}.`,
        type: 'team',
        userId: sanitizeString(adminUser?.id, 120),
        clinicId,
        actorName: sanitizeString(adminUser?.name || adminUser?.email || 'Coordenador', 180)
      });

      return res.json({ success: true, message: 'Membro desvinculado com sucesso.' });
    } catch (error: any) {
      logRouteDbError('/api/clinic/members/:memberId/unlink [PATCH]', error, {
        memberId: sanitizeString(req.params?.memberId, 120),
        userId: sanitizeString(req.session?.user?.id, 120)
      });
      return res.status(500).json({ error: 'Falha na operação de dados.' });
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
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.post('/api/clinic/state', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      const actorId = sanitizeString(req.session.user?.id, 120);
      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);
      const actorRole = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const canManageRooms =
        actorRole === 'coordinator' ||
        actorRole === 'receptionist' ||
        actorRole === 'admin' ||
        actorRole === 'owner';
      const canManageProtocols =
        actorRole === 'coordinator' ||
        actorRole === 'admin' ||
        actorRole === 'owner';
      const canManageSpecialtySettings = canManageProtocols;

      const nextRooms = canManageRooms && Array.isArray(req.body?.rooms) ? req.body.rooms.slice(0, 400) : undefined;
      const nextAppointments = Array.isArray(req.body?.appointments) ? req.body.appointments.slice(0, 5000) : undefined;
      const nextProtocols = canManageProtocols && Array.isArray(req.body?.protocols) ? req.body.protocols.slice(0, 600) : undefined;
      const nextSpecialtySettings =
        canManageSpecialtySettings && req.body?.specialtySettings && typeof req.body.specialtySettings === 'object'
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

      if (nextAppointments !== undefined) {
        const effectiveSpecialtySettings =
          nextSpecialtySettings && typeof nextSpecialtySettings === 'object'
            ? nextSpecialtySettings
            : {};
        const toMinutes = (time: string) => {
          const [hours, minutes] = String(time || '00:00')
            .split(':')
            .map((value) => Number(value) || 0);
          return hours * 60 + minutes;
        };
        const getEndMinutes = (appointment: any) => {
          const startMinutes = toMinutes(sanitizeString(appointment?.time, 10));
          const approach = sanitizeString(appointment?.type || appointment?.approach, 120);
          const duration = Number((effectiveSpecialtySettings as any)?.[approach] || 60);
          return startMinutes + (Number.isFinite(duration) ? duration : 60);
        };

        for (let index = 0; index < nextAppointments.length; index += 1) {
          const current = nextAppointments[index];
          const currentStatus = sanitizeString(current?.status, 40)?.toLowerCase();
          if (currentStatus === 'canceled' || currentStatus === 'cancelled') continue;

          const currentPatientId = sanitizeString(current?.patientId || current?.patient_id, 120);
          const currentDate = sanitizeDate(current?.date);
          const currentTime = sanitizeString(current?.time, 10);
          if (!currentPatientId || !currentDate || !currentTime) continue;

          const currentStart = toMinutes(currentTime);
          const currentEnd = getEndMinutes(current);

          for (let otherIndex = index + 1; otherIndex < nextAppointments.length; otherIndex += 1) {
            const other = nextAppointments[otherIndex];
            const otherStatus = sanitizeString(other?.status, 40)?.toLowerCase();
            if (otherStatus === 'canceled' || otherStatus === 'cancelled') continue;
            if (sanitizeString(other?.patientId || other?.patient_id, 120) !== currentPatientId) continue;
            if (sanitizeDate(other?.date) !== currentDate) continue;

            const otherStart = toMinutes(sanitizeString(other?.time, 10));
            const otherEnd = getEndMinutes(other);
            if (currentStart < otherEnd && currentEnd > otherStart) {
              return res.status(409).json({
                success: false,
                error: 'O paciente já possui um agendamento conflitante nesse intervalo.',
              });
            }
          }
        }
      }

      const previous = await supabase
        .from('clinic_state')
        .select('rooms, appointments, protocols, specialty_settings')
        .eq('clinic_id', clinicId)
        .maybeSingle();

      const appointmentsForPayload =
        nextAppointments !== undefined
          ? resetRescheduledAppointmentsForNewReminderCycle(
              nextAppointments,
              Array.isArray(previous.data?.appointments) ? previous.data.appointments : []
            )
          : undefined;

      const payload = cleanObject({
        clinic_id: clinicId,
        rooms: nextRooms,
        appointments: appointmentsForPayload,
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

      if (nextAppointments !== undefined) {
        void syncAppointmentsTableFromClinicState({
          clinicId,
          appointments: Array.isArray(data.appointments) ? data.appointments : appointmentsForPayload || nextAppointments,
          actorId,
          specialtySettings:
            data.specialty_settings && typeof data.specialty_settings === 'object'
              ? data.specialty_settings
              : nextSpecialtySettings || {}
        })
          .then((summary) => {
            if (summary.mirrored > 0) {
              console.log('[Appointments] Agenda espelhada na tabela appointments.', summary);
            }
            triggerAppointmentReminderScan('clinic_state_saved');
          })
          .catch((mirrorError: any) => {
            console.warn('[Appointments] Espelhamento da agenda falhou sem bloquear salvamento.', mirrorError?.message || String(mirrorError));
          });
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
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  const handleVapidPublicKey = (_req: any, res: any) => {
    if (!vapidPublicKey || !vapidPrivateKey) {
      return res.status(503).json({
        success: false,
        error: 'VAPID_NOT_CONFIGURED',
        message: 'Chaves VAPID ausentes no backend.'
      });
    }
    return res.json({ success: true, publicKey: vapidPublicKey });
  };

  const handlePushSubscribe = async (req: any, res: any) => {
    try {
      const subscription = req.body?.subscription || req.body;
      const endpoint = sanitizeString(subscription?.endpoint, 2000);
      if (!endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ success: false, error: 'Inscrição push inválida.' });
      }

      const user = req.session.user;
      const role = sanitizeString(user?.role, 40).toLowerCase();
      const isPatientRole = role === 'patient';
      if (role !== 'patient') {
        return res.status(403).json({
          success: false,
          error: 'Notificações push de consulta são exclusivas do login do paciente.'
        });
      }

      const requestedPatientId = sanitizeString(req.body?.patientId || req.body?.patient_id, 120);
      const requestedPatientEmail = sanitizeEmail(req.body?.patientEmail || req.body?.patient_email || user?.email);
      const sessionClinicId = currentClinicId(user);
      const lookupClinicId = isPatientRole ? null : sessionClinicId;
      console.log('[Push] subscribe received.', {
        role,
        authUserId: sanitizeString(user?.id, 120) || null,
        authEmail: sanitizeEmail(user?.email) || null,
        requestedPatientId: requestedPatientId || null,
        requestedPatientEmail: requestedPatientEmail || null,
        clinicId: lookupClinicId,
        endpointPrefix: endpoint.slice(0, 80)
      });

      const patientIds = await resolvePatientIdsForPush({
        supabase,
        patientId: requestedPatientId,
        patientEmail: requestedPatientEmail,
        userId: sanitizeString(user?.id, 120),
        clinicId: lookupClinicId,
        logger: console
      });
      const patientId = patientIds[0];

      if (!patientId) {
        console.warn('[Push] subscribe patient not found.', {
          authUserId: sanitizeString(user?.id, 120) || null,
          authEmail: sanitizeEmail(user?.email) || null,
          requestedPatientId: requestedPatientId || null,
          requestedPatientEmail: requestedPatientEmail || null,
          clinicId: lookupClinicId
        });
        return res.status(409).json({
          success: false,
          error: 'Não encontrei o cadastro de paciente vinculado a este login. Verifique se o e-mail do paciente na clínica é o mesmo usado no app.'
        });
      }

      let resolvedPatientClinicId = sessionClinicId;
      if (!resolvedPatientClinicId && isUuid(patientId)) {
        const { data: patientRow, error: patientClinicError } = await supabase
          .from('patients')
          .select('id, clinic_id')
          .eq('id', patientId)
          .maybeSingle();

        if (patientClinicError) {
          console.warn('[Push] Não foi possível resolver clinic_id pelo cadastro do paciente.', {
            patientId,
            message: patientClinicError.message || String(patientClinicError)
          });
        } else {
          resolvedPatientClinicId = sanitizeString(patientRow?.clinic_id, 120) || null;
        }
      }

      console.log('[Push] subscribe resolved patient clinic.', {
        patientId,
        sessionClinicId,
        resolvedPatientClinicId
      });

      const result = await savePatientPushSubscription({
        supabase,
        subscription,
        patientId,
        userId: sanitizeString(user?.id, 120),
        userEmail: sanitizeEmail(user?.email),
        clinicId: sessionClinicId,
        resolvedPatientClinicId,
        role,
        logger: console
      });

      if (!result.success) {
        console.warn('[Push] Não foi possível persistir assinatura push:', result.error);
        return res.status(500).json({ success: false, error: result.error || 'Erro ao salvar inscrição push.' });
      }

      console.log('[Push] subscribe persisted.', {
        patientId,
        clinicId: resolvedPatientClinicId,
        authUserId: sanitizeString(user?.id, 120) || null,
        endpointPrefix: endpoint.slice(0, 80)
      });

      return res.json({ success: true, patientId });
    } catch (error: any) {
      console.error('[Push] subscribe error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao salvar inscrição push.' });
    }
  };

  const handlePushUnsubscribe = async (req: any, res: any) => {
    try {
      const subscription = req.body?.subscription || req.body;
      const endpoint = sanitizeString(subscription?.endpoint, 2000);
      const user = req.session.user;
      const isPatientRole = sanitizeString(user?.role, 40).toLowerCase() === 'patient';
      const patientIds = await resolvePatientIdsForPush({
        supabase,
        patientId: sanitizeString(req.body?.patientId || req.body?.patient_id, 120),
        patientEmail: sanitizeEmail(req.body?.patientEmail || req.body?.patient_email || user?.email),
        userId: sanitizeString(user?.id, 120),
        clinicId: isPatientRole ? null : currentClinicId(user)
      });
      const result = await removePatientPushSubscription({
        supabase,
        patientId: patientIds[0] || '',
        endpoint
      });
      if (!result.success) return res.status(500).json({ success: false, error: result.error });
      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Push] unsubscribe error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao remover inscrição push.' });
    }
  };

  app.get('/api/push/vapid-public-key', handleVapidPublicKey);
  app.get('/api/notifications/vapid-key', handleVapidPublicKey);
  app.post('/api/push/subscribe', checkAuth, handlePushSubscribe);
  app.post('/api/notifications/subscribe', checkAuth, handlePushSubscribe);
  app.delete('/api/push/subscribe', checkAuth, handlePushUnsubscribe);
  app.delete('/api/notifications/subscribe', checkAuth, handlePushUnsubscribe);

  app.patch('/api/patient/self/profile', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const userId = sanitizeString(req.session.user?.id, 120);
      const email = sanitizeEmail(req.session.user?.email);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Sessão inválida.' });
      }

      const name =
        sanitizeString(req.body?.name, 180) ||
        sanitizeString(req.session.user?.name, 180) ||
        'Paciente';
      const address = sanitizeString(req.body?.address || req.body?.endereco, 320) || null;
      const profilePicture =
        sanitizeSessionUrl(req.body?.profilePicture) ||
        sanitizeSessionUrl(req.body?.profile_picture) ||
        sanitizeSessionUrl(req.session.user?.profilePicture) ||
        null;
      const profilePicturePath = sanitizeString(req.body?.profilePicturePath || req.body?.profile_picture_path, 500) || null;
      const updatedAt = new Date().toISOString();

      await patchTableSafely('users', { column: 'id', value: userId }, {
        name,
        address: address || undefined,
        endereco: address || undefined,
        profile_picture: profilePicture || undefined,
        profile_picture_path: profilePicturePath || undefined,
        updated_at: updatedAt
      });

      if (email) {
        await patchTableSafely('patients', { column: 'email', value: email }, {
          name,
          address: address || undefined,
          endereco: address || undefined,
          profile_picture: profilePicture || undefined,
          profile_picture_path: profilePicturePath || undefined,
          updated_at: updatedAt
        });
      }

      try {
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: cleanObject({
            ...((req.session.user as any)?.user_metadata || {}),
            full_name: name,
            address,
            avatar_url: profilePicture || undefined,
            profile_picture: profilePicture || undefined,
            profile_picture_path: profilePicturePath || undefined
          })
        });
      } catch (metadataError: any) {
        console.warn('[PatientProfile] metadata update warning:', metadataError?.message || String(metadataError));
      }

      req.session.user = buildSessionUserPayload({
        ...req.session.user,
        name,
        address,
        profilePicture
      });

      await new Promise<void>((resolve, reject) => {
        req.session.save((sessionError: any) => {
          if (sessionError) {
            reject(sessionError);
            return;
          }
          resolve();
        });
      });

      return res.json({
        success: true,
        data: {
          name,
          address,
          profilePicture
        }
      });
    } catch (error: any) {
      console.error('[PatientProfile] update error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao salvar configurações do paciente.' });
    }
  });

  app.get('/api/appointments/:appointmentId/confirmation', checkAuth, async (req: any, res) => {
    try {
      const appointmentId = sanitizeString(req.params.appointmentId, 120);
      if (!appointmentId) {
        return res.status(400).json({ success: false, error: 'Consulta inválida.' });
      }

      const actor = req.session.user;
      const clinicId = currentClinicId(actor);
      const clinicStateQuery = supabase
        .from('clinic_state')
        .select('clinic_id, appointments');
      const { data, error } = clinicId
        ? await clinicStateQuery.eq('clinic_id', clinicId).maybeSingle()
        : await clinicStateQuery.limit(200);
      if (error) throw error;

      const states = clinicId ? [data].filter(Boolean) : (Array.isArray(data) ? data : []);
      let foundAppointment: any = null;
      for (const state of states) {
        const appointments = Array.isArray(state?.appointments) ? state.appointments : [];
        foundAppointment = appointments.find((appointment: any) => String(appointment?.id) === appointmentId);
        if (foundAppointment) break;
      }

      let foundInAppointmentsTable = false;
      if (!foundAppointment) {
        const { data: tableAppointment, error: tableError } = await supabase
          .from('appointments')
          .select('*')
          .eq('id', appointmentId)
          .maybeSingle();
        if (tableError) {
          console.warn('[Appointments] fallback read from appointments table failed:', tableError.message);
        }
        if (tableAppointment) {
          foundAppointment = tableAppointment;
          foundInAppointmentsTable = true;
        }
      }

      if (!foundAppointment) {
        return res.status(404).json({ success: false, error: 'Consulta não encontrada.' });
      }

      if (sanitizeString(actor?.role, 40) === 'patient') {
        const actorId = sanitizeString(actor?.id, 120);
        const actorEmail = sanitizeEmail(actor?.email);
        const appointmentPatientId = sanitizeString(foundAppointment?.patientId || foundAppointment?.patient_id, 120);
        const appointmentPatientEmail = sanitizeEmail(foundAppointment?.patientEmail || foundAppointment?.patient_email);
        const actorPatientIds = await resolvePatientIdsForPush({
          supabase,
          patientEmail: actorEmail,
          userId: actorId,
          clinicId
        });
        if (
          appointmentPatientId !== actorId &&
          !actorPatientIds.includes(appointmentPatientId) &&
          (!actorEmail || appointmentPatientEmail !== actorEmail)
        ) {
          return res.status(403).json({ success: false, error: 'Consulta não pertence a este paciente.' });
        }
      }

      return res.json({
        success: true,
        appointment: {
          id: foundAppointment.id,
          date: foundAppointment.date || null,
          time: foundAppointment.time || null,
          scheduledAt: foundAppointment.scheduledAt || foundAppointment.scheduled_at || null,
          patientName: foundAppointment.name || foundAppointment.patientName || foundAppointment.patient_name || null,
          status: normalizeAppointmentStatusForUi(foundAppointment.status || 'pending'),
          patientConfirmationStatus:
            foundAppointment.patientResponse ||
            foundAppointment.patient_response ||
            foundAppointment.patientConfirmationStatus ||
            foundAppointment.patient_confirmation_status ||
            null,
          patientConfirmationAt:
            foundAppointment.patientRespondedAt ||
            foundAppointment.patient_responded_at ||
            foundAppointment.patientConfirmationAt ||
            foundAppointment.patient_confirmation_at ||
            null,
          source: foundInAppointmentsTable ? 'appointments' : 'clinic_state'
        }
      });
    } catch (error: any) {
      console.error('[Appointments] confirmation read error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao carregar dados da consulta.' });
    }
  });

  const handleAppointmentStatusUpdate = async (req: any, res: any) => {
    try {
      const appointmentId = sanitizeString(req.params.appointmentId, 120);
      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();
      const normalizedResponseStatus = normalizeAppointmentResponseAction(requestedStatus);
      const allowedStatuses = new Set(['pending', 'scheduled', 'confirmed', 'reschedule', 'rescheduled', 'cancelled', 'canceled']);
      if (!appointmentId || (!allowedStatuses.has(requestedStatus) && !normalizedResponseStatus)) {
        return res.status(400).json({ success: false, error: 'Status de consulta inválido.' });
      }

      const normalizedStatus = normalizedResponseStatus || normalizeAppointmentStatusForUi(requestedStatus);
      const tableStatus = normalizeAppointmentStatusForTable(normalizedStatus);
      const patientResponseForTable =
        normalizedStatus === 'canceled'
          ? 'cancelled'
          : normalizedStatus === 'reschedule' || normalizedStatus === 'confirmed'
            ? normalizedStatus
            : null;
      const actor = req.session.user;
      const actorRole = sanitizeString(actor?.role, 40).toLowerCase();
      const actorId = sanitizeString(actor?.id, 120);
      const isPatientActor = actorRole === 'patient';
      const clinicId = currentClinicId(actor);
      const now = new Date().toISOString();
      const safeSource = sanitizeString(req.body?.source, 80) || 'appointment_confirmation_popup';
      const recurrenceScope =
        sanitizeString(req.body?.recurrenceScope, 20).toLowerCase() === 'future'
          ? 'future'
          : 'single';
      const appointmentNote = sanitizeString(
        req.body?.note || req.body?.notes || req.body?.observation || req.body?.appointmentObservation,
        1200
      );
      const notificationAction = sanitizeString(req.body?.notificationAction || req.body?.action, 80).toLowerCase();
      const isPushNotificationAction = safeSource === 'push_notification_action';
      const isFutureRecurringCancellation =
        normalizedStatus === 'canceled' && recurrenceScope === 'future';

      if (isFutureRecurringCancellation && actorRole !== 'therapist') {
        return res.status(403).json({
          success: false,
          error: 'Somente o profissional pode cancelar esta e as próximas consultas da recorrência.'
        });
      }

      if (
        isPatientActor &&
        isPushNotificationAction &&
        normalizedStatus === 'reschedule' &&
        !isTrustedPushNotificationAction(notificationAction)
      ) {
        console.warn('[Appointments] Ignorando action push legada de remarcacao.', {
          appointmentId,
          notificationAction: notificationAction || null,
          requestedStatus,
          source: safeSource
        });
        return res.status(409).json({
          success: false,
          error: 'Ação de notificação expirada. Abra o app para responder.'
        });
      }

      const updateAppointmentsTableStatuses = async (appointmentIds: string[]) => {
        const validAppointmentIds = appointmentIds.filter((value) => isUuid(value));
        if (validAppointmentIds.length === 0) return new Map<string, any>();
        const patchWithConfirmation: any = {
          status: tableStatus,
          updated_at: now
        };
        if (appointmentNote) {
          patchWithConfirmation.notes = appointmentNote;
        }
        
        // If rescheduled, reset notification markers
        if (normalizedStatus === 'reschedule') {
          patchWithConfirmation.notification_24h_sent_at = null;
          patchWithConfirmation.notification_12h_sent_at = null;
          patchWithConfirmation.notification_sent = false;
          patchWithConfirmation.notification_12h_sent = false;
        }
        
        if (isPatientActor) {
          Object.assign(patchWithConfirmation, {
            patient_response: patientResponseForTable,
            patient_responded_at: now,
            patient_confirmation_status: normalizedStatus,
            patient_confirmation_at: now,
            patient_confirmation_by: actorId,
            patient_confirmation_source: safeSource
          });
        }

        const updatedAppointments = new Map<string, any>();
        let safePatch: Record<string, any> = cleanObject(patchWithConfirmation);
        let triedLegacyStatus = false;
        while (Object.keys(safePatch).length > 0) {
          const { data: updatedRows, error: tableUpdateError } = await supabase
            .from('appointments')
            .update(safePatch)
            .in('id', validAppointmentIds)
            .select('*');

          if (!tableUpdateError) {
            for (const row of Array.isArray(updatedRows) ? updatedRows : []) {
              const rowId = sanitizeString(row?.id, 120);
              if (rowId) updatedAppointments.set(rowId, row);
            }
            return updatedAppointments;
          }

          const missingColumn = extractMissingColumnName(tableUpdateError);
          if (missingColumn && missingColumn in safePatch) {
            delete safePatch[missingColumn];
            continue;
          }

          if (!triedLegacyStatus && /status|check constraint/i.test(String(tableUpdateError.message || ''))) {
            triedLegacyStatus = true;
            safePatch.status = normalizedStatus;
            continue;
          }

          console.warn('[Appointments] status table sync failed:', tableUpdateError.message);
          return updatedAppointments;
        }

        return updatedAppointments;
      };

      const clinicStateQuery = supabase
        .from('clinic_state')
        .select('clinic_id, appointments');
      const { data, error } = clinicId
        ? await clinicStateQuery.eq('clinic_id', clinicId).maybeSingle()
        : await clinicStateQuery.limit(200);
      if (error) throw error;

      const states = clinicId ? [data].filter(Boolean) : (Array.isArray(data) ? data : []);
      let foundAppointment: any = null;
      let foundClinicId = '';
      const ownerState = states.find((state: any) => {
        const appointments = Array.isArray(state?.appointments) ? state.appointments : [];
        const match = appointments.find((appointment: any) => String(appointment?.id) === appointmentId);
        if (!match) return false;
        foundAppointment = match;
        foundClinicId = sanitizeString(state?.clinic_id || clinicId, 120);
        return true;
      });

      if (!foundAppointment) {
        const { data: tableAppointment, error: tableReadError } = await supabase
          .from('appointments')
          .select('*')
          .eq('id', appointmentId)
          .maybeSingle();
        if (tableReadError) {
          console.warn('[Appointments] status fallback read failed:', tableReadError.message);
        }
        if (tableAppointment) {
          foundAppointment = tableAppointment;
        }
      }

      if (!foundAppointment) {
        return res.status(404).json({ success: false, error: 'Consulta não encontrada.' });
      }

      const appointments = Array.isArray(ownerState?.appointments) ? ownerState.appointments : [];
      let affectedAppointments = [foundAppointment];
      if (isFutureRecurringCancellation) {
        const recurrenceGroupId = getAppointmentRecurrenceGroupId(foundAppointment);
        if (!recurrenceGroupId) {
          affectedAppointments = [foundAppointment];
        } else if (appointments.length > 0) {
          affectedAppointments = appointments.filter((appointment: any) =>
            isSameOrFutureRecurringAppointment(foundAppointment, appointment),
          );
        } else {
          const { data: recurringRows, error: recurringReadError } = await supabase
            .from('appointments')
            .select('*')
            .eq('recurrence_group_id', recurrenceGroupId)
            .order('scheduled_at', { ascending: true });
          if (recurringReadError) {
            console.warn('[Appointments] recurring fallback read failed:', recurringReadError.message);
          }
          const recurringAppointments = Array.isArray(recurringRows) ? recurringRows : [];
          affectedAppointments = recurringAppointments.filter((appointment: any) =>
            isSameOrFutureRecurringAppointment(foundAppointment, appointment),
          );
        }
      }
      if (affectedAppointments.length === 0) {
        affectedAppointments = [foundAppointment];
      }
      const affectedAppointmentIds = affectedAppointments
        .map((appointment: any) => sanitizeString(appointment?.id, 120))
        .filter(Boolean);
      const affectedAppointmentIdSet = new Set(affectedAppointmentIds);

      if (isPatientActor) {
        const actorEmail = sanitizeEmail(actor?.email);
        const appointmentPatientId = sanitizeString(foundAppointment?.patientId || foundAppointment?.patient_id, 120);
        const appointmentPatientEmail = sanitizeEmail(foundAppointment?.patientEmail || foundAppointment?.patient_email);
        const actorPatientIds = await resolvePatientIdsForPush({
          supabase,
          patientEmail: actorEmail,
          userId: actorId,
          clinicId
        });
        if (
          appointmentPatientId !== actorId &&
          !actorPatientIds.includes(appointmentPatientId) &&
          (!actorEmail || appointmentPatientEmail !== actorEmail)
        ) {
          return res.status(403).json({ success: false, error: 'Consulta não pertence a este paciente.' });
        }

        const currentStatus = sanitizeString(foundAppointment?.status || 'pending', 40).toLowerCase() || 'pending';
        const isStillAwaitingResponse = currentStatus === 'pending' || currentStatus === 'scheduled';
        const currentPatientResponse = sanitizeString(
          foundAppointment?.patientResponse ||
            foundAppointment?.patient_response ||
            foundAppointment?.patientConfirmationStatus ||
            foundAppointment?.patient_confirmation_status,
          40
        );
        const normalizedCurrentPatientResponse =
          normalizeAppointmentResponseAction(currentPatientResponse) ||
          normalizeAppointmentStatusForUi(currentPatientResponse);
        const canConfirmOverReschedule =
          normalizedStatus === 'confirmed' &&
          (currentStatus === 'reschedule' ||
            currentStatus === 'rescheduled' ||
            normalizedCurrentPatientResponse === 'reschedule');
        if ((!isStillAwaitingResponse || currentPatientResponse) && !canConfirmOverReschedule) {
          return res.json({
            success: true,
            alreadyAnswered: true,
            appointment: foundAppointment,
            appointments
          });
        }
      }

      let nextAppointments = appointments;
      let updatedClinicAppointments: any[] | null = null;

      if (ownerState) {
        nextAppointments = appointments.map((appointment: any) => {
          if (!affectedAppointmentIdSet.has(String(appointment?.id))) return appointment;
          
          const updated = {
            ...appointment,
            status: normalizedStatus,
            statusUpdatedAt: now,
            statusUpdatedBy: actorId,
            notes: appointmentNote || appointment?.notes || appointment?.note || null,
            note: appointmentNote || appointment?.note || appointment?.notes || null,
            observation: appointmentNote || appointment?.observation || null,
            appointmentObservation: appointmentNote || appointment?.appointmentObservation || null,
            appointment_observation: appointmentNote || appointment?.appointment_observation || null,
            patientResponse: isPatientActor
              ? normalizedStatus
              : appointment?.patientResponse,
            patient_response: isPatientActor
              ? patientResponseForTable
              : appointment?.patient_response,
            patientRespondedAt: isPatientActor
              ? now
              : appointment?.patientRespondedAt,
            patient_responded_at: isPatientActor
              ? now
              : appointment?.patient_responded_at,
            patientConfirmationStatus: isPatientActor
              ? normalizedStatus
              : appointment?.patientConfirmationStatus,
            patientConfirmationAt: isPatientActor
              ? now
              : appointment?.patientConfirmationAt,
            patientConfirmationBy: isPatientActor
              ? actorId
              : appointment?.patientConfirmationBy,
            patientConfirmationSource: isPatientActor
              ? safeSource
              : appointment?.patientConfirmationSource
          };
          
          // If appointment was rescheduled, reset notification markers so new 24h/12h reminders are sent
          if (normalizedStatus === 'reschedule') {
            updated.notification_24h_sent_at = null;
            updated.notification24hSentAt = null;
            updated.notification_sent_at = null;
            updated.notification_12h_sent_at = null;
            updated.notification12hSentAt = null;
            updated.notification_sent = false;
            updated.notification_12h_sent = false;
          }
          
          return updated;
        });

        const { data: updated, error: updateError } = await supabase
          .from('clinic_state')
          .update({
            appointments: nextAppointments,
            updated_by: actorId,
            updated_at: now
          })
          .eq('clinic_id', foundClinicId || clinicId)
          .select('appointments')
          .single();
        if (updateError) throw updateError;
        updatedClinicAppointments = Array.isArray(updated?.appointments) ? updated.appointments : nextAppointments;
      }

      const updatedTableAppointments = await updateAppointmentsTableStatuses(affectedAppointmentIds);
      const rawUpdatedAppointment =
        nextAppointments.find((appointment: any) => String(appointment?.id) === appointmentId) ||
        updatedTableAppointments.get(appointmentId) ||
        {
          ...foundAppointment,
          status: normalizedStatus,
          ...(isPatientActor ? {
            patientResponse: normalizedStatus,
            patient_response: patientResponseForTable,
            patientRespondedAt: now,
            patient_responded_at: now,
            patientConfirmationStatus: normalizedStatus,
            patient_confirmation_status: normalizedStatus,
            patientConfirmationAt: now,
            patient_confirmation_at: now,
            patientConfirmationBy: actorId,
            patient_confirmation_by: actorId
          } : {})
        };
      const updatedAppointment = {
        ...rawUpdatedAppointment,
        status: normalizeAppointmentStatusForUi(rawUpdatedAppointment?.status || normalizedStatus)
      };

      const patientName = sanitizeString(
        updatedAppointment?.patientName || updatedAppointment?.patient_name || updatedAppointment?.name || foundAppointment?.patientName || foundAppointment?.name,
        180
      ) || 'paciente';
      const statusInfo = appointmentStatusLabelForLog(normalizedStatus);
      void persistActivityLog({
        userId: actorId || '',
        clinicId: sanitizeString(foundClinicId || clinicId || updatedAppointment?.clinic_id || foundAppointment?.clinic_id, 120),
        actorName: sanitizeString(actor?.name || actor?.email || (isPatientActor ? 'Paciente' : 'Equipe'), 180),
        title: statusInfo.title,
        content: buildAppointmentStatusLogContent({
          actorName: actor?.name || actor?.email || null,
          isPatientActor,
          patientName,
          appointment: updatedAppointment || foundAppointment,
          status: normalizedStatus,
          note: appointmentNote
        }),
        type: 'management',
        actionType: statusInfo.actionType,
        payloadDetails: JSON.stringify({
          appointmentId,
          status: normalizedStatus,
          recurrenceScope,
          affectedAppointmentIds,
          source: safeSource,
          actorRole,
          patientId: updatedAppointment?.patientId || updatedAppointment?.patient_id || null,
          note: appointmentNote || null
        })
      });

      return res.json({
        success: true,
        appointment: updatedAppointment,
        appointments: updatedClinicAppointments || nextAppointments
      });
    } catch (error: any) {
      console.error('[Appointments] status update error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao atualizar status da consulta.' });
    }
  };

  app.patch('/api/appointments/:appointmentId/status', checkAuth, handleAppointmentStatusUpdate);
  app.post('/api/notifications/appointments/:appointmentId/respond', checkAuth, async (req: any, res: any) => {
    const action = sanitizeString(req.body?.action || req.body?.status, 40).toLowerCase();
    const source = sanitizeString(req.body?.source, 80) || 'notification_action';
    const normalizedStatus = normalizeAppointmentResponseAction(action);
    if (!normalizedStatus) {
      return res.status(400).json({ success: false, error: 'Ação inválida.' });
    }
    if (
      source === 'push_notification_action' &&
      normalizedStatus === 'reschedule' &&
      !isTrustedPushNotificationAction(action)
    ) {
      console.warn('[Appointments] Bloqueando resposta push legada de remarcacao.', {
        appointmentId: sanitizeString(req.params.appointmentId, 120),
        action,
        status: sanitizeString(req.body?.status, 40) || null
      });
      return res.status(409).json({
        success: false,
        error: 'Ação de notificação expirada. Abra o app para responder.'
      });
    }
    req.body = {
      ...req.body,
      status: normalizedStatus,
      notificationAction: action,
      source
    };
    return handleAppointmentStatusUpdate(req, res);
  });

  app.post('/api/push/appointment-reminder', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      if (!vapidPublicKey || !vapidPrivateKey) {
        return res.status(503).json({ success: false, error: 'VAPID_NOT_CONFIGURED' });
      }

      const appointmentId = sanitizeString(req.body?.appointmentId, 120);
      const patientId = sanitizeString(req.body?.patientId, 120);
      const patientEmail = sanitizeEmail(req.body?.patientEmail || req.body?.patient_email);
      if (!appointmentId || !patientId) {
        return res.status(400).json({ success: false, error: 'appointmentId e patientId são obrigatórios.' });
      }

      const result = await sendAppointmentNotification({
        supabase,
        patientId,
        patientEmail,
        appointment: {
          id: appointmentId,
          scheduledAt: sanitizeString(req.body?.scheduledAt || req.body?.scheduled_at, 80) || null,
          timeLabel: sanitizeString(req.body?.timeLabel || req.body?.time_label, 80) || null,
          dateLabel: sanitizeString(req.body?.dateLabel || req.body?.date_label, 80) || null,
          reminderKind: 'manual'
        },
        title: 'Lembrete de Consulta - Verto',
        body: 'Voce tem uma consulta agendada. Clique nesta notificacao para confirmar, remarcar ou cancelar.',
        reminderKind: 'manual',
        logger: console
      });

      return res.json({
        success: true,
        sent: result.sent,
        failed: result.failed,
        ...(result.sent === 0 ? { warning: 'Nenhuma assinatura push localizada para este paciente.' } : {})
      });
    } catch (error: any) {
      console.error('[Push] appointment reminder error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Erro ao enviar push.' });
    }
  });

  app.post('/api/patient-anamnesis/:patientId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const rawPatientId = sanitizeString(req.params.patientId, 100);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
      const professionalId = sanitizeString(req.session.user?.id, 100);
      const patientId = await resolvePatientIdForRequest(rawPatientId, req.session.user, {
        createIfMissing: true,
        fallbackName: sanitizeString(req.body?.anamnesisData?.nome, 160) || sanitizeString(req.body?.anamnesisData?.name, 160)
      });
      const title = sanitizeString(req.body?.title, 220) || `Ficha_Anamnese_${rawPatientId}`;
      const referenceDate = sanitizeDate(req.body?.referenceDate) || new Date().toISOString().slice(0, 10);
      const templateVersion = asSafeNumber(req.body?.templateVersion, 1, 10_000);
      const profileType = sanitizeString(req.body?.profileType, 20) === 'child' ? 'child' : 'adult';
      const rawPatientFileId = sanitizeString(req.body?.patientFileId, 120) || null;
      const patientFileId = rawPatientFileId && isUuid(rawPatientFileId) ? rawPatientFileId : null;
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
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/patient-anamnesis/:patientId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
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
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  // Create Patient User Account (called by therapist when adding a patient)
  app.post('/api/patients/create-user', patientCreateLimiter, checkAuth, async (req: any, res) => {
    const { email, name, type, cpf } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
      const safeEmail = sanitizeEmail(email);
      const safeName = sanitizeString(name, 160) || String(safeEmail || email).split('@')[0];
      const safePortalType = sanitizeString(type, 80) || 'adult_conventional';
      const allowedPortalTypes = new Set(['kids_tea', 'adult_tea', 'adult_conventional', 'conventional']);
      const normalizedPortalType = allowedPortalTypes.has(safePortalType) ? safePortalType : 'adult_conventional';
      const safeClinicId = sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120);
      const safeProfessionalId = sanitizeString(req.session.user?.id, 120);
      const normalizedEmail = String(safeEmail || email || '').trim().toLowerCase();
      const normalizedCpf = normalizeCpf(cpf);
      const rawPhone = req.body?.phone ?? req.body?.telefone;
      const normalizedPhone = normalizeBrazilMobilePhone(rawPhone);
      if (!normalizedEmail) {
        return res.status(400).json({ success: false, error: 'Email inválido.' });
      }
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() && !normalizedPhone) {
        return res.status(400).json({
          success: false,
          error: 'Telefone inválido. Informe DDD + 9 dígitos (11 números).'
        });
      }
      if (cpf !== undefined && cpf !== null && String(cpf).trim() && !normalizedCpf) {
        return res.status(400).json({
          success: false,
          error: 'CPF inválido. Informe 11 dígitos.'
        });
      }

      const duplicatePatient = await findDuplicatePatientInClinic({
        clinicId: safeClinicId,
        email: normalizedEmail,
        cpf: normalizedCpf
      });
      if (duplicatePatient) {
        const conflictFieldLabel = duplicatePatient.field === 'cpf' ? 'CPF' : 'e-mail';
        return res.status(409).json({
          success: false,
          code: 'PATIENT_DUPLICATE_IN_CLINIC',
          error: `Já existe um paciente nesta clínica com o mesmo ${conflictFieldLabel}.`,
          details: {
            field: duplicatePatient.field,
            patientId: duplicatePatient.patientId,
            patientName: duplicatePatient.patientName
          }
        });
      }

      const upsertPatientProfile = async (authUserId: string) => {
        const profilePayload = cleanObject({
          id: authUserId,
          email: normalizedEmail,
          name: safeName,
          role: 'patient',
          type: normalizedPortalType,
          subscription_status: 'pending',
          plan_price: 4.90,
          clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
          status: 'pending_activation',
          first_login_completed: false,
          created_at: new Date().toISOString()
        });

        let safeProfilePayload: Record<string, any> = { ...profilePayload };
        while (Object.keys(safeProfilePayload).length > 0) {
          const { error: profileError } = await supabase
            .from('users')
            .upsert([safeProfilePayload], { onConflict: 'id' });

          if (!profileError) {
            await supabase.auth.admin.updateUserById(authUserId, {
              user_metadata: {
                full_name: safeName,
                role: 'patient',
                type: normalizedPortalType,
                clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
                invited_email: normalizedEmail,
                patient_activation_required: true,
                first_login_completed: false
              }
            });
            return;
          }

          const missingColumn = extractMissingColumnName(profileError);
          if (!missingColumn || !(missingColumn in safeProfilePayload)) {
            throw profileError;
          }
          delete safeProfilePayload[missingColumn];
        }
      };

      const ensurePatientLink = async (authUserId: string) => {
          const patientPayloadBase = cleanObject({
            name: safeName,
            email: safeEmail,
            phone: normalizedPhone || undefined,
            status: 'active',
            type: normalizedPortalType,
            clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
            therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined,
            created_at: new Date().toISOString()
        });
        if (!patientPayloadBase.email) return;

        let existingPatientQuery = supabase
          .from('patients')
          .select('id')
          .eq('email', patientPayloadBase.email);
        if (patientPayloadBase.clinic_id) {
          existingPatientQuery = existingPatientQuery.eq('clinic_id', patientPayloadBase.clinic_id);
        }
        const { data: existingPatient } = await existingPatientQuery.limit(1).maybeSingle();

          const upsertPatientData = cleanObject({
            name: safeName,
            email: safeEmail,
            phone: normalizedPhone || undefined,
            status: 'active',
            type: normalizedPortalType,
            clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
            therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined
          });
          const fallbackPatientData = cleanObject({
            name: safeName,
            email: safeEmail,
            phone: normalizedPhone || undefined,
            status: 'active',
            clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
            therapist_id: isUuid(safeProfessionalId) ? safeProfessionalId : undefined
          });

        if (existingPatient?.id) {
          const { error: updatePatientError } = await supabase
            .from('patients')
            .update(upsertPatientData)
            .eq('id', existingPatient.id);
          if (updatePatientError) {
            const schemaMismatch = String(updatePatientError?.message || '').toLowerCase().includes('column');
            if (!schemaMismatch) throw updatePatientError;
            const { error: updateFallbackError } = await supabase
              .from('patients')
              .update(fallbackPatientData)
              .eq('id', existingPatient.id);
            if (updateFallbackError) throw updateFallbackError;
          }
        } else {
          const { error: insertPatientError } = await supabase.from('patients').insert([{
            ...upsertPatientData,
            created_at: new Date().toISOString()
          }]);
          if (insertPatientError) {
            const schemaMismatch = String(insertPatientError?.message || '').toLowerCase().includes('column');
            if (!schemaMismatch) throw insertPatientError;
            const { error: insertFallbackError } = await supabase.from('patients').insert([{
              ...fallbackPatientData,
              created_at: new Date().toISOString()
            }]);
            if (insertFallbackError) throw insertFallbackError;
          }
        }

        let safeUserUpdatePayload: Record<string, any> = cleanObject({
          role: 'patient',
          type: normalizedPortalType,
          clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
          status: 'pending_activation',
          first_login_completed: false
        });

        while (Object.keys(safeUserUpdatePayload).length > 0) {
          const { error: userUpdateError } = await supabase
            .from('users')
            .update(safeUserUpdatePayload)
            .eq('id', authUserId);

          if (!userUpdateError) break;

          const missingColumn = extractMissingColumnName(userUpdateError);
          if (!missingColumn || !(missingColumn in safeUserUpdatePayload)) {
            throw userUpdateError;
          }
          delete safeUserUpdatePayload[missingColumn];
        }
      };

      const sendPatientActivationEmail = async (): Promise<{ sent: boolean; reason?: string }> => {
        const signupLink = await generateSupabaseActionLink({
          type: 'signup',
          email: normalizedEmail,
          redirectTo: getActivationRedirectUrl('patient', normalizedEmail)
        });
        const fallbackRecoveryLink = signupLink
          ? null
          : await generateSupabaseActionLink({
              type: 'recovery',
              email: normalizedEmail,
              redirectTo: getRecoveryRedirectUrl()
            });
        const activationLink = signupLink || fallbackRecoveryLink || getActivationRedirectUrl('patient', normalizedEmail);

        const activationEmail = buildActivationEmailTemplate({
          nome: safeName,
          link_ativacao: activationLink,
          perfil: 'patient'
        });

        let sent = await sendTransactionalEmailSafe({
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
          await new Promise((resolve) => setTimeout(resolve, 500));
          sent = await sendTransactionalEmailSafe({
            to: normalizedEmail,
            subject: activationEmail.subject,
            html: activationEmail.html,
            context: 'patient_create_user_activation_retry',
            from: OFFICIAL_FROM_NOREPLY,
            replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
            templateKind: 'welcome_patient',
            templateData: {
              nome: safeName,
              link_ativacao: activationLink
            },
            metadata: {
              email: maskEmail(normalizedEmail),
              clinicId: isUuid(safeClinicId) ? safeClinicId : null,
              retry: true
            }
          });
        }

        if (!sent) {
          return { sent: false, reason: 'Falha no envio do e-mail de ativação.' };
        }
        return { sent: true };
      };

      // 1. Check if user already exists in 'users' table
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id, role')
        .eq('email', normalizedEmail)
        .limit(1)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingUser) {
        const existingRole = sanitizeString(existingUser.role, 40).toLowerCase();
        if (existingRole && existingRole !== 'patient') {
          return res.status(409).json({
            success: false,
            error: 'Este e-mail já está associado a um usuário profissional.'
          });
        }
        await ensurePatientLink(existingUser.id);
        if (isUuid(safeClinicId)) {
          queueActivePatientSync(safeClinicId, 'patient_create_user_existing');
        }
        const emailResult = await sendPatientActivationEmail();
        return res.json({
          success: true,
          message: emailResult.sent
            ? 'Paciente vinculado e e-mail de ativação enviado.'
            : 'Paciente vinculado, mas não foi possível enviar o e-mail de ativação agora.',
          warning: emailResult.sent ? null : (emailResult.reason || 'Falha no envio de e-mail transacional'),
          activationEmailSent: emailResult.sent,
          userId: existingUser.id,
        });
      }

      // 2. Create user in Supabase Auth (Admin API)
      // Cadastro orientado por ativação via e-mail: senha será definida no link de ativação
      const generatedPassword = `${crypto.randomBytes(10).toString('hex')}V!a9`;
      
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: generatedPassword,
        email_confirm: false,
        user_metadata: {
          full_name: safeName,
          role: 'patient',
          type: normalizedPortalType,
          clinic_id: isUuid(safeClinicId) ? safeClinicId : null,
          invited_email: normalizedEmail,
          patient_activation_required: true,
          first_login_completed: false
        }
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
            if (isUuid(safeClinicId)) {
              queueActivePatientSync(safeClinicId, 'patient_create_user_auth_exists');
            }
            const emailResult = await sendPatientActivationEmail();
            return res.json({
              success: true,
              userId: foundUser.id,
              message: emailResult.sent
                ? 'Paciente vinculado e e-mail de ativação enviado.'
                : 'Paciente vinculado, mas não foi possível enviar o e-mail de ativação agora.',
              warning: emailResult.sent ? null : (emailResult.reason || 'Falha no envio de e-mail transacional'),
              activationEmailSent: emailResult.sent
            });
          }
        }
        throw authError;
      }

      if (authUser?.user) {
        await upsertPatientProfile(authUser.user.id);
        await ensurePatientLink(authUser.user.id);
        if (isUuid(safeClinicId)) {
          queueActivePatientSync(safeClinicId, 'patient_create_user_new');
        }
        const emailResult = await sendPatientActivationEmail();

        return res.json({
          success: true,
          userId: authUser.user.id,
          message: emailResult.sent
            ? 'Paciente criado e e-mail de ativação enviado.'
            : 'Paciente criado, mas não foi possível enviar o e-mail de ativação agora.',
          warning: emailResult.sent ? null : (emailResult.reason || 'Falha no envio de e-mail transacional'),
          activationEmailSent: emailResult.sent
        });
      }

      res.status(500).json({ error: 'Failed to create user' });
    } catch (error) {
      console.error('Error creating patient user:', error);
      res.status(500).json({
        success: false,
        error: 'Falha na operação de dados.',
        details: {
          context: 'patients_create_user',
          email: maskEmail(sanitizeEmail(req.body?.email) || ''),
          code: sanitizeString((error as any)?.code, 40) || null
        }
      });
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

  app.post('/api/storage/upload', uploadLimiter, checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner', 'patient'), async (req: any, res) => {
    try {
      const bucketName = sanitizeString(req.body?.bucket, 80);
      const objectPath = sanitizeString(req.body?.path, 260);
      const contentType = sanitizeString(req.body?.contentType, 120) || 'application/octet-stream';
      const dataUrl = sanitizeString(req.body?.fileBase64, 8_000_000);
      const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const actorId = sanitizeString(req.session.user?.id, 120);
      const isOnboardingUpload = objectPath.startsWith('onboarding/');

      if (bucketName !== 'patient-photos') {
        return res.status(400).json({ success: false, error: 'Bucket inválido para upload.' });
      }
      if (!objectPath || objectPath.includes('..')) {
        return res.status(400).json({ success: false, error: 'Path inválido.' });
      }
      if (isOnboardingUpload) {
        // Onboarding paths: onboarding/{actorId}/...
        const ownerUserId = sanitizeString(objectPath.split('/')[1], 120);
        if (!isUuid(ownerUserId)) {
          return res.status(400).json({ success: false, error: 'Path inválido: usuário de onboarding não identificado.' });
        }
        if (!isUuid(actorId) || actorId !== ownerUserId) {
          return res.status(403).json({ success: false, error: 'Você só pode enviar arquivos do seu próprio onboarding.' });
        }
        if (!['coordinator', 'therapist', 'receptionist', 'admin', 'owner'].includes(role)) {
          return res.status(403).json({ success: false, error: 'Perfil sem permissão para upload de onboarding.' });
        }
      } else {
        const ownerPatientId = sanitizeString(objectPath.split('/')[0], 120);
        if (!isUuid(ownerPatientId)) {
          return res.status(400).json({ success: false, error: 'Path inválido: paciente não identificado.' });
        }
        if (role === 'patient') {
          if (!isUuid(actorId) || actorId !== ownerPatientId) {
            return res.status(403).json({ success: false, error: 'Você só pode enviar fotos para o próprio histórico.' });
          }
        } else {
          const canAccess = await canAccessPatientInCurrentClinic(ownerPatientId, req.session.user);
          if (!canAccess) {
            return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
          }
        }
      }
      if (!dataUrl) {
        return res.status(400).json({ success: false, error: 'Arquivo ausente.' });
      }

      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const base64Payload = matches?.[2] || dataUrl;
      const mimeFromDataUrl = matches?.[1] || contentType;
      const fileBuffer = Buffer.from(base64Payload, 'base64');

      // Guard por tamanho: patient-photos (não-onboarding) máximo 1MB, onboarding máximo 5MB
      const maxSizeBytes = isOnboardingUpload ? 5 * 1024 * 1024 : 1 * 1024 * 1024;
      const maxSizeMb = isOnboardingUpload ? '5MB' : '1MB';
      
      if (!fileBuffer.length || fileBuffer.length > maxSizeBytes) {
        const errorMsg = fileBuffer.length > maxSizeBytes
          ? `Arquivo acima de ${maxSizeMb}. Comprima a imagem antes de enviar (máximo ${maxSizeMb}, qualidade recomendada 0.75-0.80).`
          : 'Arquivo inválido ou vazio.';
        return res.status(fileBuffer.length > maxSizeBytes ? 413 : 400).json({ success: false, error: errorMsg });
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
      } else if (Boolean((exists as any)?.public)) {
        return res.status(500).json({
          success: false,
          error: 'Configuração insegura: bucket patient-photos está público. Ajuste para privado no Supabase.'
        });
      }

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(objectPath, fileBuffer, {
          cacheControl: '3600',
          upsert: false,
          contentType: validation.detectedMime
        });

      if (uploadError) throw uploadError;

      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(uploadData.path, 60 * 10);

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

  app.post(
    '/api/patients/:id/resend-activation',
    resendActivationLimiter,
    checkAuth,
    requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'),
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.params.id, 120);
        if (!isUuid(patientId)) {
          return res.status(400).json({ success: false, error: 'patientId inválido.' });
        }
        const hasAccess = await canAccessPatientInCurrentClinic(patientId, req.session.user);
        if (!hasAccess) {
          return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
        }

        const { data: patient, error: patientError } = await supabase
          .from('patients')
          .select('id, name, email, type, clinic_id, therapist_id')
          .eq('id', patientId)
          .maybeSingle();
        if (patientError) throw patientError;
        const patientEmail = sanitizeEmail(patient?.email);
        if (!patientEmail) {
          return res.status(400).json({ success: false, error: 'Paciente sem e-mail cadastrado.' });
        }
        const authUser = await findAuthUserByEmail(patientEmail);
        const isAlreadyConfirmed = Boolean(
          (authUser as any)?.email_confirmed_at || (authUser as any)?.confirmed_at,
        );
        if (isAlreadyConfirmed) {
          return res.status(409).json({
            success: false,
            code: 'ALREADY_CONFIRMED',
            error: 'Conta já ativada. Use reenvio de recuperação de senha.',
          });
        }

        const profileName = sanitizeString(patient?.name, 180) || patientEmail.split('@')[0];
        if (authUser?.id) {
          await supabase.auth.admin.updateUserById(authUser.id, {
            user_metadata: {
              ...((authUser as any)?.user_metadata || {}),
              full_name: profileName,
              role: 'patient',
              type: sanitizeString(patient?.type, 80) || 'adult_conventional',
              clinic_id: isUuid(patient?.clinic_id) ? patient.clinic_id : null,
              invited_email: patientEmail,
              patient_activation_required: true,
              first_login_completed: false
            }
          });
        }
        const activationLink =
          (await generateSupabaseActionLink({
            type: 'signup',
            email: patientEmail,
            redirectTo: getActivationRedirectUrl('patient', patientEmail)
          })) ||
          (await generateSupabaseActionLink({
            type: 'recovery',
            email: patientEmail,
            redirectTo: getActivationRedirectUrl('patient', patientEmail)
          })) ||
          getActivationRedirectUrl('patient', patientEmail);

        const activationEmail = buildActivationEmailTemplate({
          nome: profileName,
          link_ativacao: activationLink,
          perfil: 'patient'
        });

        const sent = await sendTransactionalEmailSafe({
          to: patientEmail,
          subject: activationEmail.subject,
          html: activationEmail.html,
          context: 'patient_manual_resend_activation',
          from: OFFICIAL_FROM_NOREPLY,
          replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
          templateKind: 'welcome_patient',
          templateData: {
            nome: profileName,
            link_ativacao: activationLink
          },
          metadata: {
            patientId,
            email: maskEmail(patientEmail)
          }
        });

        await persistIdentityAuditLog({
          title: 'Reenvio manual de ativação para paciente',
          content: `Reenvio de ativação solicitado para ${maskEmail(patientEmail)}. E-mail ${sent ? 'enviado' : 'com falha de envio'}.`,
          identifier: patientEmail,
          channel: 'email',
          userId: sanitizeString(req.session.user?.id, 120),
          request: req,
          status: sent ? 'sent' : 'warning'
        });

        return res.json({
          success: true,
          message: sent
            ? 'E-mail de ativação reenviado com sucesso.'
            : 'Reenvio solicitado, mas houve falha no envio do e-mail. Tente novamente.'
        });
      } catch (error: any) {
        console.error('[Patients] resend activation error:', error);
        return res.status(500).json({
          success: false,
          error: sanitizeString(error?.message || 'Falha ao reenviar e-mail de ativação.', 500)
        });
      }
    }
  );

  app.post(
    '/api/patients/:id/resend-recovery',
    resendRecoveryLimiter,
    checkAuth,
    requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'),
    async (req: any, res) => {
      try {
        const patientId = sanitizeString(req.params.id, 120);
        if (!isUuid(patientId)) {
          return res.status(400).json({ success: false, error: 'patientId inválido.' });
        }
        const hasAccess = await canAccessPatientInCurrentClinic(patientId, req.session.user);
        if (!hasAccess) {
          return res.status(403).json({ success: false, error: 'Paciente fora do escopo da clínica.' });
        }

        const { data: patient, error: patientError } = await supabase
          .from('patients')
          .select('id, name, email')
          .eq('id', patientId)
          .maybeSingle();
        if (patientError) throw patientError;
        const patientEmail = sanitizeEmail(patient?.email);
        if (!patientEmail) {
          return res.status(400).json({ success: false, error: 'Paciente sem e-mail cadastrado.' });
        }

        const authUser = await findAuthUserByEmail(patientEmail);
        if (!authUser?.id) {
          return res.status(404).json({ success: false, error: 'Conta de autenticação do paciente não encontrada.' });
        }

        const code = generate6DigitOtp();
        const key = makeOtpChallengeKey('email', 'password_recovery', patientEmail);
        await setOtpChallenge({
          key,
          channel: 'email',
          purpose: 'password_recovery',
          identifier: patientEmail,
          userId: authUser.id,
          codeHash: hashIdentifier(code),
          expiresAt: Date.now() + OTP_TTL_MS,
          attempts: 0,
          consumed: false,
          createdAt: Date.now()
        });

        const profileName = sanitizeString(patient?.name, 180) || patientEmail.split('@')[0];
        // Security hardening: do not leak OTP in query params.
        const recoveryLink = `${getRecoveryRedirectUrl()}`;
        const recoveryEmail = buildPasswordRecoveryEmailTemplate({
          nome: profileName,
          codigo: code,
          link_recuperacao: recoveryLink,
          expira_em_minutos: 15,
          perfil: 'patient'
        });

        const sent = await sendTransactionalEmailSafe({
          to: patientEmail,
          subject: recoveryEmail.subject,
          html: recoveryEmail.html,
          context: 'patient_manual_resend_recovery',
          from: OFFICIAL_FROM_NOREPLY,
          replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
          templateKind: undefined,
          templateData: {
            nome: profileName,
            codigo: code,
            link_recuperacao: recoveryLink,
            expira_em_minutos: 15
          },
          metadata: {
            patientId,
            email: maskEmail(patientEmail)
          }
        });

        await persistIdentityAuditLog({
          title: 'Reenvio manual de recuperação para paciente',
          content: `Reenvio de recuperação solicitado para ${maskEmail(patientEmail)}. E-mail ${sent ? 'enviado' : 'com falha de envio'}.`,
          identifier: patientEmail,
          channel: 'email',
          userId: sanitizeString(req.session.user?.id, 120),
          request: req,
          status: sent ? 'sent' : 'warning'
        });

        return res.json({
          success: true,
          message: sent
            ? 'E-mail de recuperação reenviado com sucesso.'
            : 'Reenvio solicitado, mas houve falha no envio do e-mail. Tente novamente.'
        });
      } catch (error: any) {
        console.error('[Patients] resend recovery error:', error);
        return res.status(500).json({
          success: false,
          error: sanitizeString(error?.message || 'Falha ao reenviar e-mail de recuperação.', 500)
        });
      }
    }
  );

  // Patients
  app.get('/api/patients', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      let query = supabase.from('patients').select('*').eq('is_active', true).is('deleted_at', null);
      const role = req.session.user.role as AppRole;
      const scopedClinicId = currentClinicId(req.session.user);

      if (role === 'coordinator' || role === 'receptionist') {
        if (scopedClinicId) {
          query = query.eq('clinic_id', scopedClinicId);
        }
      } else if (role === 'therapist') {
        if (scopedClinicId) {
          query = query.eq('clinic_id', scopedClinicId);
        }
        const therapistUserId = sanitizeString(req.session.user?.id, 120);
        query = query.or(`therapist_id.eq.${therapistUserId},professional_id.eq.${therapistUserId}`);
      }
      
      let { data, error } = await query;
      if (error && isMissingColumnError(error, 'professional_id') && role === 'therapist') {
        let fallbackQuery = supabase
          .from('patients')
          .select('*')
          .eq('therapist_id', sanitizeString(req.session.user?.id, 120))
          .eq('is_active', true)
          .is('deleted_at', null);
        if (scopedClinicId) {
          fallbackQuery = fallbackQuery.eq('clinic_id', scopedClinicId);
        }
        const fallbackRes = await fallbackQuery;
        data = fallbackRes.data;
        error = fallbackRes.error;
      }
      
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
      const rawEmail = req.body?.email;
      const safeEmail = sanitizeEmail(rawEmail);
      const rawCpf = req.body?.cpf || req.body?.anamnesisData?.cpf;
      const safeCpf = normalizeCpf(rawCpf);
      const rawPhone = req.body?.phone || req.body?.telefone;
      const safePhone = normalizeBrazilMobilePhone(rawPhone);
      const safeBody = cleanObject({
        id: isUuid(sanitizeString(req.body?.id, 120)) ? sanitizeString(req.body?.id, 120) : undefined,
        name: safeName,
        email: safeEmail,
        cpf: safeCpf,
        phone: safePhone || sanitizePhone(rawPhone),
        age: asSafeNumber(req.body?.age, 0, 130),
        diagnosis: sanitizeString(req.body?.diagnosis, 2000),
        status: sanitizeString(req.body?.status, 40) || 'active',
        clinic_id: isUuid(safeClinicId) ? safeClinicId : undefined,
        therapist_id: isUuid(safeTherapistId) ? safeTherapistId : undefined,
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!safeBody.name) {
        return res.status(400).json({ error: 'Nome do paciente é obrigatório.' });
      }
      if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() && !safeEmail) {
        return res.status(400).json({ error: 'E-mail inválido. Informe um domínio válido.' });
      }
      if (rawCpf !== undefined && rawCpf !== null && String(rawCpf).trim() && !safeCpf) {
        return res.status(400).json({ error: 'CPF inválido. Informe 11 dígitos.' });
      }
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() && !safePhone) {
        return res.status(400).json({ error: 'Telefone inválido. Informe DDD + 9 dígitos (11 números).' });
      }

      const duplicatePatient = await findDuplicatePatientInClinic({
        clinicId: safeBody.clinic_id || safeClinicId,
        email: safeBody.email,
        cpf: safeBody.cpf,
        excludePatientId: safeBody.id
      });
      if (duplicatePatient) {
        const fieldLabel = duplicatePatient.field === 'cpf' ? 'CPF' : 'e-mail';
        return res.status(409).json({
          success: false,
          code: 'PATIENT_DUPLICATE_IN_CLINIC',
          error: `Cadastro bloqueado: já existe um paciente nesta clínica com o mesmo ${fieldLabel}.`,
          details: {
            field: duplicatePatient.field,
            patientId: duplicatePatient.patientId,
            patientName: duplicatePatient.patientName
          }
        });
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
          cpf: safeBody.cpf,
          phone: safeBody.phone,
          age: safeBody.age,
          diagnosis: safeBody.diagnosis,
          status: safeBody.status || 'active',
          clinic_id: safeBody.clinic_id,
          therapist_id: safeBody.therapist_id,
        });

        let safeFallbackPayload: Record<string, any> = { ...fallbackRow };
        while (Object.keys(safeFallbackPayload).length > 0) {
          const fallbackResult = await supabase
            .from('patients')
            .upsert([safeFallbackPayload], { onConflict: 'id' })
            .select()
            .single();
          data = fallbackResult.data;
          error = fallbackResult.error;
          if (!error) break;
          const missingColumn = extractMissingColumnName(error);
          if (!missingColumn || !(missingColumn in safeFallbackPayload)) break;
          delete safeFallbackPayload[missingColumn];
        }
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.patch('/api/patients/:id', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const canChangeClinic = hasGlobalClinicAccess(req.session.user);
      const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const scopedClinicId = currentClinicId(req.session.user);
      if (role === 'receptionist') {
        return res.status(403).json({
          success: false,
          error: 'Apenas o coordenador da clínica ou o profissional responsável pode gerenciar este paciente.'
        });
      }
      const rawEmail = req.body?.email;
      const rawPhone = req.body?.phone;
      const safeEmail = rawEmail !== undefined ? sanitizeEmail(rawEmail) : undefined;
      const safePhone = rawPhone !== undefined ? normalizeBrazilMobilePhone(rawPhone) : undefined;
      const rawCpf = req.body?.cpf;
      const safeCpf = rawCpf !== undefined ? normalizeCpf(rawCpf) : undefined;
      const rawTherapistId = req.body?.therapist_id;
      const safeTherapistId = rawTherapistId !== undefined ? sanitizeString(rawTherapistId, 120) : undefined;
      const canAssignTherapist =
        role === 'coordinator' ||
        role === 'admin' ||
        role === 'owner';

      if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() && !safeEmail) {
        return res.status(400).json({ success: false, error: 'E-mail inválido. Informe um domínio válido.' });
      }
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() && !safePhone) {
        return res.status(400).json({ success: false, error: 'Telefone inválido. Informe DDD + 9 dígitos (11 números).' });
      }
      if (rawCpf !== undefined && rawCpf !== null && String(rawCpf).trim() && !safeCpf) {
        return res.status(400).json({ success: false, error: 'CPF inválido. Informe 11 dígitos.' });
      }

      const updates = cleanObject({
        name: req.body?.name !== undefined ? sanitizeString(req.body?.name, 160) : undefined,
        email: safeEmail,
        phone: safePhone !== undefined ? safePhone : undefined,
        cpf: safeCpf !== undefined ? safeCpf : undefined,
        age: req.body?.age !== undefined ? asSafeNumber(req.body?.age, 0, 130) : undefined,
        diagnosis: req.body?.diagnosis !== undefined ? sanitizeString(req.body?.diagnosis, 2000) : undefined,
        therapist_id:
          canAssignTherapist && rawTherapistId !== undefined
            ? (isUuid(safeTherapistId) ? safeTherapistId : null)
            : undefined,
        clinic_id: canChangeClinic && req.body?.clinic_id !== undefined ? sanitizeString(req.body?.clinic_id, 100) : undefined,
        status: req.body?.status !== undefined ? sanitizeString(req.body?.status, 40) : undefined
      });

      let patientUpdateQuery = supabase
        .from('patients')
        .update(updates)
        .eq('id', req.params.id)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
        patientUpdateQuery = patientUpdateQuery.eq('clinic_id', scopedClinicId);
      }
      if (role === 'therapist') {
        patientUpdateQuery = patientUpdateQuery.eq('therapist_id', sanitizeString(req.session.user?.id, 120));
      }
      const { data: updatedPatient, error } = await patientUpdateQuery
        .select('id, clinic_id, status, email, therapist_id')
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

        let safeUserPatch: Record<string, any> = cleanObject({
          status: mappedUserStatus,
          clinic_id: hasClinicLink ? sanitizeString(updatedPatient?.clinic_id, 120) : null,
          updated_at: new Date().toISOString()
        });

        while (Object.keys(safeUserPatch).length > 0) {
          const { error: userPatchError } = await supabase
            .from('users')
            .update(safeUserPatch)
            .eq('email', patientEmail)
            .eq('role', 'patient');
          if (!userPatchError) break;
          const missingColumn = extractMissingColumnName(userPatchError);
          if (!missingColumn || !(missingColumn in safeUserPatch)) {
            throw userPatchError;
          }
          delete safeUserPatch[missingColumn];
        }
      }

      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Cadastro de paciente atualizado',
        content:
          canAssignTherapist && rawTherapistId !== undefined
            ? `Paciente ${sanitizeString(req.params.id, 120)} teve responsável terapêutico atualizado para ${isUuid(safeTherapistId) ? sanitizeString(safeTherapistId, 120) : 'não atribuído'}.`
            : `Paciente ${sanitizeString(req.params.id, 120)} teve dados cadastrais atualizados.`,
        type: 'management'
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  // Secure patient record storage (encrypted JSON payload)
  app.post('/api/patient-records/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 512 * 1024, 'Payload do prontuário')) return;
      const rawPatientId = sanitizeString(req.params.patientId, 100);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
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

      const writeResult = await writePatientRecordSafely({
        patientId,
        clinicId,
        sessionUser: req.session.user,
        row
      });

      if (!writeResult.success) {
        const error = writeResult.error;
        if (String(error?.message || '').toLowerCase().includes('patient_records')) {
          return res.status(200).json({
            success: false,
            warning: 'Tabela patient_records ainda não existe. Execute o SQL de segurança para persistência criptografada.'
          });
        }
        logRouteDbError('/api/patient-records/:patientId [POST]', error, {
          patientId,
          clinicId,
          actorId: sanitizeString(req.session.user?.id, 120)
        });
        throw error;
      }

      const actorId = sanitizeString(req.session.user?.id, 120);
      const actorName = sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180);
      const clinicAuditId = sanitizeString(currentClinicId(req.session.user), 120);
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  const readPatientRecordPayloadForFiles = async (patientId: string, clinicId: string, sessionUser: any) => {
    let query = supabase
      .from('patient_records')
      .select('payload_encrypted, pseudonym_id')
      .eq('patient_id', patientId);
    if (!hasGlobalClinicAccess(sessionUser)) {
      query = query.eq('clinic_id', clinicId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    const encryptedPayload = sanitizeString(data?.payload_encrypted, 2_000_000);
    const payload = decryptJsonPayload(encryptedPayload) || {};
    return {
      payload,
      pseudonymId: sanitizeString(data?.pseudonym_id, 160) || null
    };
  };

  const writePatientRecordSafely = async (params: {
    patientId: string;
    clinicId: string;
    sessionUser: any;
    row: Record<string, any>;
  }) => {
    const { patientId, clinicId, sessionUser } = params;
    let safeRow: Record<string, any> = cleanObject(params.row || {});
    const scopeByClinic = !hasGlobalClinicAccess(sessionUser);

    const existingQuery = (() => {
      let query = supabase
        .from('patient_records')
        .select('patient_id')
        .eq('patient_id', patientId)
        .limit(1);
      if (scopeByClinic) query = query.eq('clinic_id', clinicId);
      return query;
    })();

    const existingResult = await existingQuery;
    if (existingResult.error) {
      return { success: false, error: existingResult.error };
    }

    const runMutation = async (mode: 'insert' | 'update') => {
      while (Object.keys(safeRow).length > 0) {
        const result =
          mode === 'insert'
            ? await supabase.from('patient_records').insert([safeRow])
            : await (() => {
                let query = supabase.from('patient_records').update(safeRow).eq('patient_id', patientId);
                if (scopeByClinic) query = query.eq('clinic_id', clinicId);
                return query;
              })();

        if (!result.error) return { success: true };

        const missingColumn = extractMissingColumnName(result.error);
        if (missingColumn && missingColumn in safeRow) {
          delete safeRow[missingColumn];
          continue;
        }

        return { success: false, error: result.error };
      }

      return { success: false, error: new Error('Nenhuma coluna válida para persistir em patient_records.') };
    };

    const hasExisting = Array.isArray(existingResult.data) && existingResult.data.length > 0;
    let writeResult = await runMutation(hasExisting ? 'update' : 'insert');
    if (writeResult.success) return writeResult;

    const writeMessage = extractSupabaseErrorMessage(writeResult.error).toLowerCase();
    const shouldRetryAsUpdate =
      !hasExisting &&
      (
        sanitizeString(writeResult.error?.code, 20) === '23505' ||
        writeMessage.includes('duplicate key') ||
        writeMessage.includes('on conflict') ||
        writeMessage.includes('unique') ||
        writeMessage.includes('constraint')
      );

    if (shouldRetryAsUpdate) {
      writeResult = await runMutation('update');
    }

    return writeResult;
  };

  const buildPatientFilesFromPayload = async (patientId: string, payloadFiles: any[]) => {
    const mapped: any[] = [];
    for (const rawFile of payloadFiles || []) {
      const path = sanitizeString(rawFile?.path, 500);
      const bucket = sanitizeString(rawFile?.bucket, 120) || 'patient-files-private';
      let signedUrl = sanitizeUrl(rawFile?.signedUrl || rawFile?.url) || null;

      if (path) {
        const { data: signed, error: signedError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 60 * 10);
        if (!signedError && signed?.signedUrl) {
          signedUrl = signed.signedUrl;
        }
      }

      mapped.push({
        id: sanitizeString(rawFile?.id, 120) || crypto.randomUUID(),
        patientId,
        fileName: sanitizeString(rawFile?.fileName || rawFile?.name, 220) || `arquivo_${Date.now()}`,
        path: path || null,
        mimeType: sanitizeString(rawFile?.mimeType || rawFile?.type, 120) || 'application/octet-stream',
        sizeBytes: Number(rawFile?.sizeBytes || rawFile?.size || 0) || 0,
        source: sanitizeString(rawFile?.source, 40) || 'upload',
        createdAt: sanitizeString(rawFile?.createdAt || rawFile?.date, 80) || new Date().toISOString(),
        metadata: rawFile?.metadata && typeof rawFile.metadata === 'object' ? rawFile.metadata : {},
        signedUrl,
        url: signedUrl || sanitizeUrl(rawFile?.url) || null,
        content: sanitizeString(rawFile?.content || rawFile?.dataUrl, 20_000_000) || null
      });
    }
    return mapped;
  };

  const persistPatientFileFallback = async (params: {
    patientId: string;
    clinicId: string;
    sessionUser: any;
    fileEntry: Record<string, any>;
  }) => {
    const { payload, pseudonymId } = await readPatientRecordPayloadForFiles(params.patientId, params.clinicId, params.sessionUser);
    const existingFiles = Array.isArray(payload?.files) ? payload.files : [];
    const nextFiles = [
      params.fileEntry,
      ...existingFiles.filter((item: any) => sanitizeString(item?.id, 120) !== sanitizeString(params.fileEntry?.id, 120))
    ];
    return await persistPatientFileFallbackList({
      patientId: params.patientId,
      clinicId: params.clinicId,
      sessionUser: params.sessionUser,
      pseudonymId,
      payload,
      files: nextFiles
    });
  };

  const persistPatientFileFallbackList = async (params: {
    patientId: string;
    clinicId: string;
    sessionUser: any;
    pseudonymId?: string | null;
    payload?: Record<string, any>;
    files: any[];
  }) => {
    const basePayload = params.payload || (await readPatientRecordPayloadForFiles(params.patientId, params.clinicId, params.sessionUser)).payload || {};
    const mergedPayload = sanitizeClinicalPayload(cleanObject({
      ...basePayload,
      files: params.files
    })) || {};

    const encrypted = encryptJsonPayload(mergedPayload);
    const pseudonymSeed = [
      sanitizeString(mergedPayload?.cpf, 30),
      sanitizeString(mergedPayload?.email, 320),
      sanitizePhone(mergedPayload?.telefone) || ''
    ].filter(Boolean).join('|') || params.patientId;

    const row = cleanObject({
      patient_id: params.patientId,
      clinic_id: params.clinicId,
      therapist_id: sanitizeString(params.sessionUser?.id, 100),
      pseudonym_id: params.pseudonymId || `pt_${pseudonymizeValue(pseudonymSeed)}`,
      payload_encrypted: encrypted || null,
      payload_preview: cleanObject({
        nome: sanitizeString(mergedPayload?.nome, 120),
        nomeSocial: sanitizeString(mergedPayload?.nomeSocial, 120),
        grupo: sanitizeString(mergedPayload?.grupo, 60),
        convenioNome: sanitizeString(mergedPayload?.convenioNome, 120)
      }),
      updated_at: new Date().toISOString()
    });

    const writeResult = await writePatientRecordSafely({
      patientId: params.patientId,
      clinicId: params.clinicId,
      sessionUser: params.sessionUser,
      row
    });
    if (!writeResult.success) throw writeResult.error;
  };

  app.get('/api/patient-files/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      if (!patientId) return res.status(400).json({ success: false, error: 'patientId inválido.' });
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });

      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
      const fallbackPayload = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
      const fallbackFiles = await buildPatientFilesFromPayload(
        patientId,
        Array.isArray(fallbackPayload?.payload?.files) ? fallbackPayload.payload.files : []
      );
      const { data, error } = await supabase
        .from('patient_files')
        .select('id, patient_id, clinic_id, file_name, storage_path, mime_type, file_size_bytes, source, created_at, metadata')
        .eq('patient_id', patientId)
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false });

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_files')) {
          return res.status(200).json({ success: true, data: fallbackFiles, warning: 'Tabela patient_files não criada; usando fallback do prontuário.' });
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

      const merged = new Map<string, any>();
      [...withUrls, ...fallbackFiles].forEach((row: any) => {
        const key = sanitizeString(row?.id, 120) || sanitizeString(row?.path, 500);
        if (!key || merged.has(key)) return;
        merged.set(key, row);
      });

      return res.json({ success: true, data: Array.from(merged.values()) });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post('/api/patient-files/:patientId', checkAuth, checkPatientAccess, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 18 * 1024 * 1024, 'Upload de arquivo do paciente')) return;
      const isMultipart = String(req.headers?.['content-type'] || '').toLowerCase().includes('multipart/form-data');
      const multipart = isMultipart ? await parseMultipartFormData(req) : null;
      const multipartFields = multipart?.fields || {};
      const multipartFile = multipart?.file;

      const rawPatientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 100);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
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
      const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

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
      const storagePath = `${clinicId}/${patientId}/${Date.now()}_${safeName}`;
      if (source === 'anamnesis') {
        const { data: duplicateFile, error: duplicateError } = await supabase
          .from('patient_files')
          .select('*')
          .eq('patient_id', patientId)
          .eq('clinic_id', clinicId)
          .eq('source', 'anamnesis')
          .eq('metadata->>fileSha256', fileSha256)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!duplicateError && duplicateFile) {
          const { data: signedDuplicate } = await supabase.storage
            .from(sanitizeString(duplicateFile?.bucket, 120) || 'patient-files-private')
            .createSignedUrl(sanitizeString(duplicateFile?.storage_path, 800), 60 * 10);
          return res.status(200).json({
            success: true,
            deduped: true,
            data: {
              ...duplicateFile,
              signedUrl: signedDuplicate?.signedUrl || null,
              url: signedDuplicate?.signedUrl || null
            }
          });
        }
      }

      const persistInlineFallback = async (reason: string) => {
        const fallbackId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const inlineContent =
          resolvedMime === 'application/pdf'
            ? `data:application/pdf;base64,${fileBuffer.toString('base64')}`
            : null;
        const fallbackEntry = {
          id: fallbackId,
          fileName: safeName,
          name: safeName,
          path: null,
          bucket: null,
          mimeType: resolvedMime,
          type: resolvedMime,
          sizeBytes: fileBuffer.length,
          size: fileBuffer.length,
          source,
          createdAt,
          metadata: {
            ...metadata,
            fileSha256,
            storageFallbackReason: reason
          },
          ...(inlineContent ? { content: inlineContent, dataUrl: inlineContent } : {})
        };

        try {
          await persistPatientFileFallback({
            patientId,
            clinicId,
            sessionUser: req.session.user,
            fileEntry: fallbackEntry
          });
        } catch (fallbackError: any) {
          console.warn('[PatientFiles] Falha ao persistir fallback em patient_records:', fallbackError?.message || String(fallbackError));
        }

        return res.status(200).json({
          success: true,
          warning: reason,
          data: {
            id: fallbackId,
            patientId,
            fileName: safeName,
            path: null,
            mimeType: resolvedMime,
            sizeBytes: fileBuffer.length,
            source,
            createdAt,
            metadata: fallbackEntry.metadata,
            signedUrl: null,
            url: inlineContent,
            content: inlineContent
          }
        });
      };

      try {
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

        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(storagePath, fileBuffer, {
            cacheControl: '3600',
            upsert: false,
            contentType: resolvedMime
          });
        if (uploadError) throw uploadError;
      } catch (storageError: any) {
        console.warn('[PatientFiles] Storage indisponível; salvando fallback inline:', storageError?.message || String(storageError));
        return await persistInlineFallback('Storage indisponível. Arquivo salvo como fallback no prontuário.');
      }

      const insertPayload = {
        patient_id: patientId,
        clinic_id: clinicId,
        uploaded_by: uploadedBy,
        file_name: safeName,
        storage_path: storagePath,
        mime_type: resolvedMime,
        file_size_bytes: fileBuffer.length,
        source,
        metadata: {
          ...metadata,
          fileSha256
        }
      };

      const { data: inserted, error: insertError } = await supabase
        .from('patient_files')
        .insert([insertPayload])
        .select('*')
        .single();

      if (insertError) {
        const fallbackId = crypto.randomUUID();
        const { data: signedDataFallback, error: signedErrorFallback } = await supabase.storage
          .from(bucketName)
          .createSignedUrl(storagePath, 60 * 10);
        if (signedErrorFallback) {
          console.warn('[PatientFiles] Falha ao assinar URL no fallback:', signedErrorFallback.message);
        }

        const fallbackEntry = {
          id: fallbackId,
          fileName: safeName,
          name: safeName,
          path: storagePath,
          bucket: bucketName,
          mimeType: resolvedMime,
          type: resolvedMime,
          sizeBytes: fileBuffer.length,
          size: fileBuffer.length,
          source,
          createdAt: new Date().toISOString(),
          metadata: {
            ...metadata,
            fileSha256
          }
        };

        try {
          await persistPatientFileFallback({
            patientId,
            clinicId,
            sessionUser: req.session.user,
            fileEntry: fallbackEntry
          });
        } catch (fallbackError: any) {
          console.warn('[PatientFiles] Falha ao persistir fallback após erro de tabela:', fallbackError?.message || String(fallbackError));
        }

        return res.status(200).json({
          success: true,
          warning: `Falha em patient_files. Arquivo salvo via fallback no prontuário: ${insertError.message || 'erro desconhecido'}`,
          data: {
            id: fallbackId,
            patientId,
            fileName: safeName,
            path: storagePath,
            mimeType: resolvedMime,
            sizeBytes: fileBuffer.length,
            source,
            createdAt: fallbackEntry.createdAt,
            metadata,
            signedUrl: signedDataFallback?.signedUrl || null
          }
        });
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(storagePath, 60 * 10);
      if (signedError) {
        console.warn('[PatientFiles] Falha ao assinar URL após upload:', signedError.message);
      }

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
          signedUrl: signedData?.signedUrl || null
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
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
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
      if (existingError && !String(existingError?.message || '').toLowerCase().includes('patient_files')) throw existingError;
      if (existingError && String(existingError?.message || '').toLowerCase().includes('patient_files')) {
        const fallbackPayload = await readPatientRecordPayloadForFiles(patientId, clinicId, req.session.user);
        const existingFiles = Array.isArray(fallbackPayload?.payload?.files) ? fallbackPayload.payload.files : [];
        const existingFallback = existingFiles.find((item: any) => sanitizeString(item?.id, 120) === fileId);
        if (!existingFallback) return res.status(404).json({ success: false, error: 'Arquivo não encontrado.' });

        const storagePath = sanitizeString(existingFallback?.path, 500);
        if (storagePath) {
          const { error: removeStorageError } = await supabase.storage
            .from(sanitizeString(existingFallback?.bucket, 120) || 'patient-files-private')
            .remove([storagePath]);
          if (removeStorageError) {
            console.warn('[PatientFiles] Falha ao remover do storage (fallback):', removeStorageError.message);
          }
        }

        const nextFiles = existingFiles.filter((item: any) => sanitizeString(item?.id, 120) !== fileId);
        await persistPatientFileFallbackList({
          patientId,
          clinicId,
          sessionUser: req.session.user,
          pseudonymId: fallbackPayload?.pseudonymId || null,
          payload: fallbackPayload?.payload || {},
          files: nextFiles
        });
        return res.json({ success: true });
      }
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
      const clinicId = sanitizeString(currentClinicId(req.session.user), 100);
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  const NOTE_VISIBILITY_ALLOWED = new Set(['patient', 'shared', 'family', 'shared_patient']);
  const NOTE_VISIBILITY_CANONICAL = new Set(['private', 'shared_patient', 'shared_clinic']);

  const normalizeNoteVisibility = (input: unknown): 'private' | 'shared_patient' | 'shared_clinic' => {
    const raw = sanitizeString(input, 60).toLowerCase();
    if (!raw) return 'private';
    if (raw === 'shared_clinic' || raw === 'professional') return 'shared_clinic';
    if (raw === 'shared_patient' || raw === 'shared' || raw === 'patient' || raw === 'family') return 'shared_patient';
    if (raw === 'private') return 'private';
    return 'private';
  };

  const noteIsReadableByPatient = (note: any): boolean => {
    const visibility = sanitizeString(note?.visibility, 40).toLowerCase();
    const legacyType = sanitizeString(note?.type, 40).toLowerCase();
    return NOTE_VISIBILITY_ALLOWED.has(visibility) || NOTE_VISIBILITY_ALLOWED.has(legacyType);
  };

  const fetchNotesWithRoleFilter = async (params: {
    patientId?: string;
    patientEmail?: string;
    excludePatientId?: string;
    role: string;
  }) => {
    let query = supabase.from('notes').select('*').eq('is_active', true).is('deleted_at', null);
    if (params.patientId) query = query.eq('patient_id', params.patientId);
    if (params.patientEmail) query = query.eq('patient_email', params.patientEmail);
    if (params.excludePatientId) query = query.neq('patient_id', params.excludePatientId);

    const needsPatientVisibilityFilter = params.role === 'patient';
    if (needsPatientVisibilityFilter) {
      query = query.in('visibility', ['patient', 'shared', 'family', 'shared_patient']);
    }

    let result = await query.order('created_at', { ascending: false });
    if (!result.error) return { data: result.data || [], error: null };

    if (needsPatientVisibilityFilter && isMissingColumnError(result.error, 'visibility')) {
      let fallbackQuery = supabase.from('notes').select('*').eq('is_active', true).is('deleted_at', null);
      if (params.patientId) fallbackQuery = fallbackQuery.eq('patient_id', params.patientId);
      if (params.patientEmail) fallbackQuery = fallbackQuery.eq('patient_email', params.patientEmail);
      if (params.excludePatientId) fallbackQuery = fallbackQuery.neq('patient_id', params.excludePatientId);
      result = await fallbackQuery.order('created_at', { ascending: false });
      if (result.error) return { data: null, error: result.error };
      const filtered = (result.data || []).filter((note: any) => noteIsReadableByPatient(note));
      return { data: filtered, error: null };
    }

    return { data: null, error: result.error };
  };

  const upsertNoteWithSchemaFallback = async (basePayload: Record<string, any>) => {
    let candidate = { ...basePayload };
    const triedMissingColumns = new Set<string>();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, error } = await supabase
        .from('notes')
        .upsert([candidate], { onConflict: 'id' })
        .select()
        .single();

      if (!error) {
        return { data, error: null, payload: candidate };
      }

      const missingColumn = extractMissingColumnName(error);
      if (!missingColumn || triedMissingColumns.has(missingColumn)) {
        return { data: null, error, payload: candidate };
      }

      triedMissingColumns.add(missingColumn);
      const nextCandidate = { ...candidate };
      delete nextCandidate[missingColumn];
      candidate = nextCandidate;
    }

    return { data: null, error: { message: 'Falha ao salvar anotação após fallback de schema.' }, payload: candidate };
  };

  const updateNoteWithSchemaFallback = async (noteId: string, baseUpdates: Record<string, any>) => {
    let candidate = { ...baseUpdates };
    const triedMissingColumns = new Set<string>();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, error } = await supabase
        .from('notes')
        .update(candidate)
        .eq('id', noteId)
        .select('*')
        .single();

      if (!error) {
        return { data, error: null, payload: candidate };
      }

      const missingColumn = extractMissingColumnName(error);
      if (!missingColumn || triedMissingColumns.has(missingColumn)) {
        return { data: null, error, payload: candidate };
      }

      triedMissingColumns.add(missingColumn);
      const nextCandidate = { ...candidate };
      delete nextCandidate[missingColumn];
      candidate = nextCandidate;
    }

    return { data: null, error: { message: 'Falha ao atualizar anotação após fallback de schema.' }, payload: candidate };
  };

  const upsertHistoryWithSchemaFallback = async (basePayload: Record<string, any>) => {
    let candidate = { ...basePayload };
    const triedMissingColumns = new Set<string>();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data, error } = await supabase
        .from('history')
        .upsert([candidate], { onConflict: 'id' })
        .select('*')
        .single();

      if (!error) return { data, error: null, payload: candidate };

      const missingColumn = extractMissingColumnName(error);
      if (!missingColumn || triedMissingColumns.has(missingColumn)) {
        return { data: null, error, payload: candidate };
      }

      triedMissingColumns.add(missingColumn);
      const nextCandidate = { ...candidate };
      delete nextCandidate[missingColumn];
      candidate = nextCandidate;
    }

    return { data: null, error: { message: 'Falha ao salvar histórico após fallback de schema.' }, payload: candidate };
  };

  const updateAssignedTaskWithSchemaFallback = async (taskId: string, baseUpdates: Record<string, any>) => {
    let candidate = { ...baseUpdates };
    const triedMissingColumns = new Set<string>();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { data, error } = await supabase
        .from('assigned_tasks')
        .update(candidate)
        .eq('id', taskId)
        .select('*')
        .single();

      if (!error) return { data, error: null, payload: candidate };

      const missingColumn = extractMissingColumnName(error);
      if (!missingColumn || triedMissingColumns.has(missingColumn)) {
        return { data: null, error, payload: candidate };
      }

      triedMissingColumns.add(missingColumn);
      const nextCandidate = { ...candidate };
      delete nextCandidate[missingColumn];
      candidate = nextCandidate;
    }

    return { data: null, error: { message: 'Falha ao atualizar tarefa adulta após fallback de schema.' }, payload: candidate };
  };

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
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      const patientEmail = sanitizeEmail(patientRow?.email);

      const notesByIdResult = await fetchNotesWithRoleFilter({
        patientId,
        role
      });
      const notesById = notesByIdResult.data;
      const notesByIdError = notesByIdResult.error;
      if (notesByIdError) throw notesByIdError;

      let notesByEmail: any[] = [];
      if (patientEmail) {
        const notesByEmailResult = await fetchNotesWithRoleFilter({
          patientEmail,
          excludePatientId: patientId,
          role: 'patient'
        });
        const notesByEmailData = notesByEmailResult.data;
        const notesByEmailError = notesByEmailResult.error;
        if (notesByEmailError) throw notesByEmailError;
        notesByEmail = Array.isArray(notesByEmailData) ? notesByEmailData : [];
      }

      const merged = [...(Array.isArray(notesById) ? notesById : []), ...notesByEmail];
      const deduped = Array.from(new Map(merged.map((item: any) => [String(item?.id || crypto.randomUUID()), item])).values())
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      res.json({ success: true, data: deduped });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.delete('/api/patients/:id', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.params.id, 120);
      if (!isUuid(patientId)) {
        return res.status(400).json({ success: false, error: 'patientId inválido.' });
      }

      const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
      const scopedClinicId = currentClinicId(req.session.user);
      let findQuery = supabase
        .from('patients')
        .select('id, clinic_id, email, name, therapist_id')
        .eq('id', patientId)
        .eq('is_active', true)
        .is('deleted_at', null);
      if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
        findQuery = findQuery.eq('clinic_id', scopedClinicId);
      }
      const { data: patientRow, error: findError } = await findQuery.maybeSingle();
      if (findError) throw findError;
      if (!patientRow?.id) {
        return res.status(404).json({ success: false, error: 'Paciente não encontrado no escopo da clínica.' });
      }
      if (role === 'therapist' && sanitizeString(patientRow?.therapist_id, 120) !== sanitizeString(req.session.user?.id, 120)) {
        return res.status(403).json({ success: false, error: 'Terapeuta sem permissão para excluir este paciente.' });
      }

      const nowIso = new Date().toISOString();
      const unlinkPayload = cleanObject({
        clinic_id: null,
        status: 'deleted',
        is_active: false,
        // Algumas bases têm `therapist_id` como NOT NULL.
        // Mantemos o vínculo histórico do terapeuta para evitar violação de constraint.
        therapist_id: sanitizeString(patientRow?.therapist_id, 120) || undefined,
        updated_at: nowIso,
        deleted_at: nowIso
      });
      const fallbackUnlinkPayload = cleanObject({
        clinic_id: null,
        status: 'deleted'
      });

      let { error: unlinkError } = await supabase
        .from('patients')
        .update(unlinkPayload)
        .eq('id', patientId);
      if (unlinkError) {
        const missingColumn = extractMissingColumnName(unlinkError);
        if (!missingColumn) throw unlinkError;
        let safeFallbackPayload = { ...fallbackUnlinkPayload };
        delete safeFallbackPayload[missingColumn];
        const fallbackResult = await supabase
          .from('patients')
          .update(safeFallbackPayload)
          .eq('id', patientId);
        unlinkError = fallbackResult.error;
        if (unlinkError) throw unlinkError;
      }

      const patientEmail = sanitizeEmail(patientRow?.email);
      const archiveDependency = async (table: 'notes' | 'history' | 'appointments' | 'activity_logs', column: string, value: string | null) => {
        if (!value) return;
        const payload = table === 'activity_logs'
          ? { deleted_at: nowIso, is_active: false, status: 'archived', updated_at: nowIso }
          : { deleted_at: nowIso, is_active: false };
        const { error } = await supabase
          .from(table)
          .update(payload)
          .eq(column, value);
        if (error) throw error;
      };

      await Promise.all([
        archiveDependency('notes', 'patient_id', patientId),
        archiveDependency('history', 'patient_id', patientId),
        archiveDependency('appointments', 'patient_id', patientId),
        archiveDependency('activity_logs', 'user_id', patientId),
        archiveDependency('notes', 'patient_email', patientEmail),
        archiveDependency('history', 'patient_email', patientEmail)
      ]);

      if (patientEmail) {
        let safeUserPatch: Record<string, any> = cleanObject({
          status: 'waiting_treatment',
          clinic_id: null,
          updated_at: nowIso
        });
        while (Object.keys(safeUserPatch).length > 0) {
          const { error: userPatchError } = await supabase
            .from('users')
            .update(safeUserPatch)
            .eq('email', patientEmail)
            .eq('role', 'patient');
          if (!userPatchError) break;
          const missingColumn = extractMissingColumnName(userPatchError);
          if (!missingColumn || !(missingColumn in safeUserPatch)) {
            throw userPatchError;
          }
          delete safeUserPatch[missingColumn];
        }
      }

      if (sanitizeString(req.session.user?.id, 120) === patientId) {
        await supabase.auth.admin.updateUserById(patientId, {
          ban_duration: '876000h'
        });
      }

      if (scopedClinicId && isUuid(scopedClinicId)) {
        queueActivePatientSync(scopedClinicId, 'patient_delete');
      }
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(scopedClinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: 'Paciente excluído/desvinculado',
        content: `Paciente ${sanitizeString(patientRow?.name || patientId, 180)} foi removido da clínica.`,
        actionType: 'PATIENT_ARCHIVED',
        payloadDetails: JSON.stringify({
          action: 'PATIENT_ARCHIVED',
          patient_id: patientId,
          requested_by: sanitizeString(req.session.user?.id, 120),
          requested_at: nowIso
        }),
        type: 'management'
      });

      return res.json({ success: true, deletedId: patientId });
    } catch (error) {
      console.error('[PatientsDelete] error:', error);
      return res.status(500).json({ success: false, error: 'Falha na operação de dados.' });
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

      const roleForFilter = !isPrivileged && isSelfRequest ? 'patient' : userRole;
      let query = supabase
        .from('notes')
        .select('*')
        .eq('patient_email', safeEmail)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (!hasGlobalClinicAccess(req.session.user) && isPrivileged) {
        const clinicId = currentClinicId(req.session.user);
        if (!clinicId) return res.status(403).json({ error: 'Clínica não identificada.' });
        const clinicPatientIds = await getClinicPatientIdsByEmail(clinicId, safeEmail);
        if (clinicPatientIds.length === 0) {
          return res.json({ success: true, data: [] });
        }
        query = query.in('patient_id', clinicPatientIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      let filtered = Array.isArray(data) ? data : [];
      if (roleForFilter === 'patient') {
        filtered = filtered.filter((note: any) => noteIsReadableByPatient(note));
      }

      res.json({ success: true, data: filtered });
    } catch (error) {
      logRouteDbError('/api/patient-records/:patientId [POST]', error, {
        patientId: sanitizeString(req.params.patientId, 120),
        actorId: sanitizeString(req.session.user?.id, 120)
      });
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      const normalizedVisibility = normalizeNoteVisibility(req.body?.visibility);
      const normalizedType = (() => {
        const providedType = sanitizeString(req.body?.type, 40).toLowerCase();
        if (providedType && NOTE_VISIBILITY_CANONICAL.has(providedType as any)) return providedType;
        if (providedType === 'shared' || providedType === 'patient' || providedType === 'family') return 'shared';
        if (providedType === 'professional') return 'professional';
        if (normalizedVisibility === 'shared_clinic') return 'professional';
        if (normalizedVisibility === 'shared_patient') return 'shared';
        return 'private';
      })();
      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email),
        text: sanitizeTextField(req.body?.text, 12000),
        content: sanitizeTextField(req.body?.text, 12000),
        visibility: normalizedVisibility,
        type: normalizedType,
        subject: sanitizeTextField(req.body?.subject, 100) || 'Geral',
        score: req.body?.score !== undefined ? asSafeNumber(req.body?.score, 0, 100) : undefined,
        image: sanitizeUrl(req.body?.image),
        image_url: sanitizeUrl(req.body?.image_url),
        original_id: sanitizeString(req.body?.original_id, 120) || undefined,
        therapist_id: sanitizeString(req.session.user.id, 120),
        user_id: sanitizeString(req.session.user.id, 120),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!payload.patient_id || !payload.text) {
        return res.status(400).json({ error: 'patient_id e texto são obrigatórios.' });
      }
      if (!isUuid(payload.patient_id)) {
        return res.status(400).json({ error: 'patient_id inválido para salvar anotações.' });
      }

      const { data, error } = await upsertNoteWithSchemaFallback(payload);
      
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
      res.status(500).json({ error: 'Falha na operação de dados.' });
    }
  });

  // History
  app.get('/api/history/:patientId', checkAuth, checkPatientAccess, async (req, res) => {
    try {
      const signHistoryImageUrl = async (row: any) => {
        try {
          const directPath = sanitizeString(row?.image_path, 600);
          const signedUrl = sanitizeString(row?.image, 4000);
          let storagePath = directPath;

          if (!storagePath && signedUrl.includes('/storage/v1/object/sign/patient-photos/')) {
            const marker = '/storage/v1/object/sign/patient-photos/';
            const tail = signedUrl.split(marker)[1] || '';
            const encodedPath = tail.split('?')[0] || '';
            if (encodedPath) storagePath = decodeURIComponent(encodedPath);
          }

          if (!storagePath) return row;

          const { data: signed, error: signedError } = await supabase.storage
            .from('patient-photos')
            .createSignedUrl(storagePath, 60 * 10);
          if (signedError || !signed?.signedUrl) return row;

          return {
            ...row,
            image: signed.signedUrl,
            image_path: storagePath
          };
        } catch {
          return row;
        }
      };

      const patientId = sanitizeString((req as any).resolvedPatientId || req.params.patientId, 120);
      if (!isUuid(patientId)) return res.json({ success: true, data: [] });
      const { data: patientRow } = await supabase
        .from('patients')
        .select('email')
        .eq('id', patientId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      const patientEmail = sanitizeEmail(patientRow?.email);

      const { data: historyById, error: historyByIdError } = await supabase
        .from('history')
        .select('*')
        .eq('patient_id', patientId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (historyByIdError) throw historyByIdError;

      let historyByEmail: any[] = [];
      if (patientEmail) {
        const { data: historyByEmailData, error: historyByEmailError } = await supabase
          .from('history')
          .select('*')
          .eq('patient_email', patientEmail)
          .neq('patient_id', patientId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        if (historyByEmailError) throw historyByEmailError;
        historyByEmail = Array.isArray(historyByEmailData) ? historyByEmailData : [];
      }

      const merged = [...(Array.isArray(historyById) ? historyById : []), ...historyByEmail];
      const deduped = Array.from(new Map(merged.map((item: any) => [String(item?.id || crypto.randomUUID()), item])).values())
        .sort((a: any, b: any) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
      const enriched = await Promise.all(deduped.map(signHistoryImageUrl));
      res.json({ success: true, data: enriched });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
        .eq('is_active', true)
        .is('deleted_at', null)
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
      const enriched = await Promise.all(
        (Array.isArray(data) ? data : []).map(async (row: any) => {
          try {
            const directPath = sanitizeString(row?.image_path, 600);
            const signedUrl = sanitizeString(row?.image, 4000);
            let storagePath = directPath;
            if (!storagePath && signedUrl.includes('/storage/v1/object/sign/patient-photos/')) {
              const marker = '/storage/v1/object/sign/patient-photos/';
              const tail = signedUrl.split(marker)[1] || '';
              const encodedPath = tail.split('?')[0] || '';
              if (encodedPath) storagePath = decodeURIComponent(encodedPath);
            }
            if (!storagePath) return row;
            const { data: signed } = await supabase.storage
              .from('patient-photos')
              .createSignedUrl(storagePath, 60 * 10);
            return { ...row, image: signed?.signedUrl || row?.image, image_path: storagePath };
          } catch {
            return row;
          }
        })
      );
      res.json({ success: true, data: enriched });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/patient/self/history', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const patientEmail = sanitizeEmail(req.session.user?.email);
      if (!patientEmail) {
        return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível.' });
      }

      const sessionUserId = sanitizeString(req.session.user?.id, 120);
      const patientIds = await getPatientIdsByEmailAcrossClinics(patientEmail);
      const scopedPatientIds = Array.from(
        new Set(
          [sessionUserId, ...patientIds]
            .map((id) => sanitizeString(id, 120))
            .filter((id) => isUuid(id))
        )
      );

      const { data: historyByEmail, error: historyByEmailError } = await supabase
        .from('history')
        .select('*')
        .eq('patient_email', patientEmail)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (historyByEmailError) throw historyByEmailError;

      let historyById: any[] = [];
      if (scopedPatientIds.length > 0) {
        const { data: historyByIdData, error: historyByIdError } = await supabase
          .from('history')
          .select('*')
          .in('patient_id', scopedPatientIds)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });
        if (historyByIdError) throw historyByIdError;
        historyById = Array.isArray(historyByIdData) ? historyByIdData : [];
      }

      const mergedHistory = [...(Array.isArray(historyByEmail) ? historyByEmail : []), ...historyById];
      const dedupedHistory = Array.from(
        new Map(
          mergedHistory.map((item: any) => {
            const key = String(item?.id || `${item?.patient_id || ''}|${item?.type || ''}|${item?.title || ''}|${item?.created_at || ''}|${item?.score ?? ''}`);
            return [key, item];
          })
        ).values()
      );

      const assignedRows: any[] = [];
      const { data: assignedByEmail, error: assignedByEmailError } = await supabase
        .from('assigned_tasks')
        .select('*')
        .eq('status', 'completed')
        .eq('patient_email', patientEmail)
        .order('completed_at', { ascending: false });
      if (assignedByEmailError) {
        console.warn('[PatientSelfHistory] assigned_tasks by email warning:', assignedByEmailError.message || String(assignedByEmailError));
      } else if (Array.isArray(assignedByEmail)) {
        assignedRows.push(...assignedByEmail);
      }
      if (scopedPatientIds.length > 0) {
        const { data: assignedById, error: assignedByIdError } = await supabase
          .from('assigned_tasks')
          .select('*')
          .eq('status', 'completed')
          .in('patient_id', scopedPatientIds)
          .order('completed_at', { ascending: false });
        if (assignedByIdError) {
          console.warn('[PatientSelfHistory] assigned_tasks by id warning:', assignedByIdError.message || String(assignedByIdError));
        } else if (Array.isArray(assignedById)) {
          assignedRows.push(...assignedById);
        }
      }

      const mappedAssignedHistory = Array.from(new Map(assignedRows.map((task: any) => [String(task?.id || crypto.randomUUID()), task])).values()).map((task: any) => {
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
          created_at: task.completed_at || task.updated_at || task.created_at,
          assigned_task_id: task.id,
          source: 'assigned_task_completion',
          task_data: cleanObject({
            ...taskData,
            patientEffort: task.patient_effort ?? taskData?.patientEffort ?? null,
            patient_effort: task.patient_effort ?? taskData?.patient_effort ?? null,
            patientEffortEmoji: task.patient_effort_emoji || taskData?.patientEffortEmoji || taskData?.patient_effort_emoji || effortEmojiForPercent(asSafeNumber(task.patient_effort, 0, 100)),
            patient_effort_emoji: task.patient_effort_emoji || taskData?.patient_effort_emoji || taskData?.patientEffortEmoji || effortEmojiForPercent(asSafeNumber(task.patient_effort, 0, 100)),
            patientEffortLabel: task.patient_effort_label || taskData?.patientEffortLabel || taskData?.patient_effort_label || effortLabelForPercent(asSafeNumber(task.patient_effort, 0, 100)),
            patient_effort_label: task.patient_effort_label || taskData?.patient_effort_label || taskData?.patientEffortLabel || effortLabelForPercent(asSafeNumber(task.patient_effort, 0, 100))
          })
        };
      });

      const { data: tasksByEmail, error: tasksByEmailError } = await supabase
        .from('tasks')
        .select('*')
        .ilike('patient_email', patientEmail)
        .order('created_at', { ascending: false });
      if (tasksByEmailError) {
        console.warn('[PatientSelfHistory] tasks by email warning:', tasksByEmailError.message || String(tasksByEmailError));
      }

      let tasksById: any[] = [];
      if (scopedPatientIds.length > 0) {
        const { data: tasksByIdData, error: tasksByIdError } = await supabase
          .from('tasks')
          .select('*')
          .in('patient_id', scopedPatientIds)
          .order('created_at', { ascending: false });
        if (tasksByIdError) {
          console.warn('[PatientSelfHistory] tasks by id warning:', tasksByIdError.message || String(tasksByIdError));
        } else {
          tasksById = Array.isArray(tasksByIdData) ? tasksByIdData : [];
        }
      }

      const taskRows = [
        ...(Array.isArray(tasksByEmail) ? tasksByEmail : []),
        ...tasksById
      ];
      const mappedTaskScoreHistory = Array.from(
        new Map(
          taskRows.map((t: any) => [String(t?.id || crypto.randomUUID()), t])
        ).values()
      )
        .filter((t: any) => t?.pro_score !== null && t?.pro_score !== undefined)
        .map((t: any) => ({
          id: `taskscore:${t.id}`,
          patient_id: t.patient_id,
          patient_email: t.patient_email,
          type: String(t.type || 'task'),
          title: sanitizeTextField(t.title || 'Tarefa avaliada', 180),
          score: asSafeNumber(t.pro_score, 0, 100),
          energy: null,
          note: '',
          icon: sanitizeString(t.icon, 40) || '🎯',
          created_at: t.updated_at || t.created_at
        }));

      const consolidatedHistory = [...dedupedHistory, ...mappedAssignedHistory, ...mappedTaskScoreHistory]
        .sort((a: any, b: any) => {
          const aTs = new Date(a?.created_at || 0).getTime();
          const bTs = new Date(b?.created_at || 0).getTime();
          return bTs - aTs;
        });
      const enrichedHistory = await Promise.all(
        consolidatedHistory.map(async (row: any) => {
          try {
            const directPath = sanitizeString(row?.image_path, 600);
            const signedUrl = sanitizeString(row?.image, 4000);
            let storagePath = directPath;
            if (!storagePath && signedUrl.includes('/storage/v1/object/sign/patient-photos/')) {
              const marker = '/storage/v1/object/sign/patient-photos/';
              const tail = signedUrl.split(marker)[1] || '';
              const encodedPath = tail.split('?')[0] || '';
              if (encodedPath) storagePath = decodeURIComponent(encodedPath);
            }
            if (!storagePath) return row;
            const { data: signed } = await supabase.storage
              .from('patient-photos')
              .createSignedUrl(storagePath, 60 * 10);
            return { ...row, image: signed?.signedUrl || row?.image, image_path: storagePath };
          } catch {
            return row;
          }
        })
      );

      const treatmentStatus = await updatePatientStatusIfNeeded(req.session.user);
      req.session.user.treatmentStatus = treatmentStatus;
      req.session.user = buildSessionUserPayload(req.session.user);
      void req.session.save(() => {});

      res.json({ success: true, data: enrichedHistory, treatmentStatus });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/patient/self/protocols', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const patientEmail = sanitizeEmail(req.session.user?.email);
      if (!patientEmail) {
        return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível.' });
      }

      const { data: patientLinks, error: patientLinksError } = await supabase
        .from('patients')
        .select('clinic_id, status, created_at')
        .eq('email', patientEmail)
        .eq('is_active', true)
        .is('deleted_at', null);

      if (patientLinksError) throw patientLinksError;

      const links = Array.isArray(patientLinks) ? patientLinks : [];
      const activeClinicIds = links
        .filter((row: any) => sanitizeString(row?.status, 40).toLowerCase() === 'active')
        .map((row: any) => sanitizeString(row?.clinic_id, 120))
        .filter((id: string) => isUuid(id));
      const fallbackClinicIds = links
        .map((row: any) => sanitizeString(row?.clinic_id, 120))
        .filter((id: string) => isUuid(id));

      const clinicIds = (activeClinicIds.length > 0 ? activeClinicIds : fallbackClinicIds);
      if (clinicIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const { data: states, error: statesError } = await supabase
        .from('clinic_state')
        .select('clinic_id, protocols, updated_at')
        .in('clinic_id', clinicIds);

      if (statesError) throw statesError;

      const orderedStates = (Array.isArray(states) ? states : [])
        .sort((a: any, b: any) => {
          const aTs = new Date(a?.updated_at || 0).getTime() || 0;
          const bTs = new Date(b?.updated_at || 0).getTime() || 0;
          return bTs - aTs;
        });

      const selectedState = orderedStates.find((s: any) => Array.isArray(s?.protocols) && s.protocols.length > 0) || orderedStates[0];
      const protocols = Array.isArray(selectedState?.protocols) ? selectedState.protocols : [];
      return res.json({ success: true, data: protocols });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
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
      const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
      if (role === 'patient' && safeType === 'photo') {
        const safeEmail = sanitizeEmail(req.body?.patient_email || req.session.user?.email);
        if (!safeEmail) {
          return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível para validação de foto diária.' });
        }
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).toISOString();

        const { data: todayPhotos, error: todayPhotosError } = await supabase
          .from('history')
          .select('id')
          .eq('type', 'photo')
          .eq('patient_email', safeEmail)
          .eq('is_active', true)
          .is('deleted_at', null)
          .gte('created_at', startOfDay)
          .lt('created_at', endOfDay)
          .limit(1);
        if (todayPhotosError) throw todayPhotosError;
        if (Array.isArray(todayPhotos) && todayPhotos.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'Limite diário atingido: apenas 1 foto por dia pode ser enviada no Portal da Família.'
          });
        }
      }
      const docData = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email || req.session.user?.email),
        type: safeType,
        title: sanitizeTextField(req.body?.title, 180),
        score: asSafeNumber(req.body?.score, 0, 100),
        energy: asSafeNumber(req.body?.energy, 0, 100),
        note: sanitizeTextField(req.body?.note, 12000),
        icon: sanitizeString(req.body?.icon, 40),
        image: sanitizeUrl(req.body?.image),
        image_path: sanitizeString(req.body?.image_path, 600) || undefined,
        therapist_id: sanitizeString(req.session.user.id, 120),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });
      const docCreatedAt = sanitizeString(docData.created_at, 40) || new Date().toISOString();
      docData.date_group = dateGroupForClinic(docCreatedAt, req.session.user);

      if (!docData.patient_id || !docData.title) {
        return res.status(400).json({ error: 'patient_id e título são obrigatórios.' });
      }

      let data: any = null;
      let error: any = null;
      {
        const result = await supabase
          .from('history')
          .upsert([docData], { onConflict: 'id' })
          .select()
          .single();
        data = result.data;
        error = result.error;
      }

      if (error && /image_path/i.test(String(error?.message || ''))) {
        const fallbackDocData = { ...docData } as any;
        delete fallbackDocData.image_path;
        const retry = await supabase
          .from('history')
          .upsert([fallbackDocData], { onConflict: 'id' })
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error && /date_group/i.test(String(error?.message || ''))) {
        const fallbackDocData = { ...docData } as any;
        delete fallbackDocData.date_group;
        const retry = await supabase
          .from('history')
          .upsert([fallbackDocData], { onConflict: 'id' })
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;
      if (sanitizeString(req.session.user?.role, 40).toLowerCase() !== 'patient') {
        void persistActivityLog({
          userId: sanitizeString(req.session.user?.id, 120),
          clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
          actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
          title: 'Registro de evolução salvo',
          content: `${docData.title} foi salvo no histórico do paciente ${docData.patient_id}.`,
          type: 'clinical'
        });
      }
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/patient-logs/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.resolvedPatientId || req.params.patientId, 120);
      if (!patientId) return res.status(400).json({ success: false, error: 'patient_id inválido.' });

      const { data, error } = await supabase
        .from('patient_logs')
        .select('*')
        .eq('patient_id', patientId)
        .order('timestamp', { ascending: false });

      if (!error) {
        return res.json({ success: true, data: Array.isArray(data) ? data : [] });
      }

      const { data: historyRows, error: historyError } = await supabase
        .from('history')
        .select('*')
        .eq('patient_id', patientId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (historyError) throw historyError;

      const mapped = (Array.isArray(historyRows) ? historyRows : [])
        .filter((row: any) => ['task', 'intervention', 'reinforcement', 'checkin', 'mood', 'energy'].includes(String(row?.type || '').toLowerCase()))
        .map((row: any) => ({
          id: row.id,
          patient_id: row.patient_id,
          professional_id: row.therapist_id || null,
          type: row.type === 'checkin' ? 'mood' : row.type,
          value: {
            title: row.title,
            score: row.score,
            energy: row.energy,
            note: row.note,
            icon: row.icon
          },
          timestamp: row.created_at,
          created_at: row.created_at,
          source: 'history'
        }));

      return res.json({ success: true, data: mapped, fallback: 'history' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
    }
  });

  app.post('/api/patient-logs', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'patient', 'admin', 'owner'), async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 48 * 1024, 'Payload de log do paciente')) return;
      const resolvedPatientId = await resolvePatientIdForRequest(
        sanitizeString(req.body?.patient_id, 120),
        req.session.user,
        { createIfMissing: true }
      );
      const safeType = sanitizeString(req.body?.type, 40).toLowerCase();
      if (!resolvedPatientId || !['task', 'mood', 'energy'].includes(safeType)) {
        return res.status(400).json({ success: false, error: 'patient_id e type válido são obrigatórios.' });
      }

      const timestamp = sanitizeString(req.body?.timestamp, 40) || new Date().toISOString();
      const rawValue = req.body?.value ?? null;
      const safeValue = typeof rawValue === 'string'
        ? sanitizeTextField(rawValue, 4000)
        : JSON.parse(JSON.stringify(rawValue)).valueOf();
      const professionalId = sanitizeString(
        req.body?.professional_id ||
        req.body?.professionalId ||
        req.session.user?.professional_id ||
        req.session.user?.therapist_id ||
        req.session.user?.id,
        120
      );

      const logData = cleanObject({
        id: sanitizeString(req.body?.id, 120) || crypto.randomUUID(),
        patient_id: resolvedPatientId,
        professional_id: professionalId || null,
        type: safeType,
        value: safeValue,
        timestamp,
        created_at: timestamp
      });

      const { data, error } = await supabase
        .from('patient_logs')
        .upsert([logData], { onConflict: 'id' })
        .select('*')
        .single();

      if (!error) return res.json({ success: true, data });

      const fallbackValue = typeof safeValue === 'object' && safeValue !== null ? safeValue : { value: safeValue };
      const fallbackTitle =
        safeType === 'task'
          ? sanitizeTextField(fallbackValue?.title || 'Tarefa concluída', 180)
          : safeType === 'energy'
            ? 'Registro de energia'
            : 'Registro de humor';
      const fallback = cleanObject({
        id: sanitizeString(req.body?.id, 120) || crypto.randomUUID(),
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.session.user?.email),
        type: safeType,
        title: fallbackTitle,
        score: asSafeNumber(fallbackValue?.score, 0, 100),
        energy: asSafeNumber(fallbackValue?.energy ?? fallbackValue?.value, 0, 100),
        note: sanitizeTextField(fallbackValue?.note || fallbackValue?.comment || '', 12000),
        icon: sanitizeString(fallbackValue?.icon, 40),
        therapist_id: professionalId || null,
        created_at: timestamp,
        date_group: dateGroupForClinic(timestamp, req.session.user)
      });

      const retry = await supabase
        .from('history')
        .upsert([fallback], { onConflict: 'id' })
        .select('*')
        .single();
      if (retry.error) throw retry.error;
      return res.json({ success: true, data: { ...logData, source: 'history' }, fallback: 'history' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Erro interno do servidor.' });
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
      const requestedLimit = asSafeNumber(req.query?.limit, 1, 2000) || 1000;
      const limit = Math.min(Math.max(requestedLimit, 1), 2000);
      let data: any[] = [];
      let error: any = null;
      const isManager = role === 'coordinator' || role === 'admin' || role === 'owner';

      if (isManager && clinicId) {
        try {
          const byClinicRes = await supabase
            .from('activity_logs')
            .select('*')
            .eq('clinic_id', clinicId)
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('timestamp', { ascending: false })
            .limit(limit);

          let byClinic = byClinicRes.data || [];
          if (byClinicRes.error && !isMissingColumnError(byClinicRes.error, 'clinic_id')) {
            error = byClinicRes.error;
          }

          const memberRes = await supabase
            .from('clinic_memberships')
            .select('user_id')
            .eq('clinic_id', clinicId);
          if (memberRes.error && !error) error = memberRes.error;

          const memberIds = Array.from(
            new Set(
              (memberRes.data || [])
                .map((m: any) => sanitizeString(m?.user_id, 120))
                .filter(Boolean),
            ),
          );
          const currentId = sanitizeString(currentUser.id, 120);
          if (currentId) memberIds.push(currentId);

          let byMembers: any[] = [];
          if (!error && memberIds.length > 0) {
            const memberLogsRes = await supabase
              .from('activity_logs')
              .select('*')
              .in('user_id', Array.from(new Set(memberIds)))
              .eq('is_active', true)
              .is('deleted_at', null)
              .order('timestamp', { ascending: false })
              .limit(limit);
            byMembers = memberLogsRes.data || [];
            if (memberLogsRes.error && !error) error = memberLogsRes.error;
          }

          const merged = new Map<string, any>();
          [...byClinic, ...byMembers].forEach((row: any) => {
            const id =
              sanitizeString(row?.id, 120) ||
              `${sanitizeString(row?.user_id, 120)}-${sanitizeString(row?.timestamp, 80)}`;
            if (!id) return;
            if (!merged.has(id)) merged.set(id, row);
          });

          data = filterVisibleActivityLogs(Array.from(merged.values())
            .sort((a: any, b: any) => {
              const ta = new Date(a?.timestamp || a?.created_at || 0).getTime();
              const tb = new Date(b?.timestamp || b?.created_at || 0).getTime();
              return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
            }), currentUser)
            .slice(0, limit);
        } catch (queryError: any) {
          error = queryError;
        }
      } else {
        try {
          const result = await supabase
            .from('activity_logs')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('timestamp', { ascending: false })
            .limit(limit);
          data = filterVisibleActivityLogs(result.data || [], currentUser);
          error = result.error;
        } catch (queryError: any) {
          error = queryError;
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
        return res.status(401).json({
          success: false,
          queued: true,
          warning: 'activity_logs_missing_auth'
        });
      }

      const payload = buildActivityLogPayload(currentUser, req.body, req);
      if (isTechnicalActivityLogEntry(payload)) {
        return res.json({ success: true, ignored: true, reason: 'technical_activity_log' });
      }
      if (isPatientNonAgendaActivityLogEntry(payload, currentUser)) {
        return res.json({ success: true, ignored: true, reason: 'patient_non_agenda_activity_log' });
      }
      const { data, error } = await writeActivityLogWithFallback(payload, { upsert: true, select: true });

      if (error) {
        logRouteDbError('/api/logs', error, { userId: currentUser.id });
        return res.status(200).json({
          success: true,
          queued: true,
          warning: 'activity_logs_write_unavailable',
          details: sanitizeString(error?.message || String(error), 400)
        });
      }
      return res.json({ success: true, id: data?.id || payload.id, data: data || payload });
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

  app.get('/api/logs/:logId', checkAuth, async (req: any, res) => {
    try {
      const logId = sanitizeString(req.params.logId, 120);
      if (!logId) return res.status(400).json({ success: false, error: 'ID do log é obrigatório.' });

      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('id', logId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, error: 'Log não encontrado.' });

      const user = req.session.user;
      const isManager = user.role === 'coordinator' || user.role === 'admin' || user.role === 'owner';
      const sameUser = sanitizeString(data?.user_id, 120) === sanitizeString(user.id, 120);
      const sameClinic =
        sanitizeString(data?.clinic_id, 120) &&
        sanitizeString(data?.clinic_id, 120) === sanitizeString(currentClinicId(user), 120);
      if (!sameUser && !(isManager && sameClinic)) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      if (isTechnicalActivityLogEntry(data)) {
        return res.status(404).json({ success: false, error: 'Log não encontrado.' });
      }

      return res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/logs/:logId [GET]', error, { logId: sanitizeString(req.params.logId, 120) });
      return res.status(500).json({ success: false, error: 'Falha ao consultar log.' });
    }
  });

  app.patch('/api/logs/:logId', checkAuth, async (req: any, res) => {
    try {
      const logId = sanitizeString(req.params.logId, 120);
      if (!logId) return res.status(400).json({ success: false, error: 'ID do log é obrigatório.' });

      const { data: existing, error: findError } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('id', logId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) return res.status(404).json({ success: false, error: 'Log não encontrado.' });

      const user = req.session.user;
      const isManager = user.role === 'coordinator' || user.role === 'admin' || user.role === 'owner';
      const sameUser = sanitizeString(existing?.user_id, 120) === sanitizeString(user.id, 120);
      const sameClinic =
        sanitizeString(existing?.clinic_id, 120) &&
        sanitizeString(existing?.clinic_id, 120) === sanitizeString(currentClinicId(user), 120);
      if (!sameUser && !(isManager && sameClinic)) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const nextTitle =
        req.body?.title !== undefined ? sanitizeString(req.body.title, 180) : sanitizeString(existing?.title, 180);
      const nextType =
        req.body?.type !== undefined ? sanitizeString(req.body.type, 40) : sanitizeString(existing?.type, 40);
      const nextActionType =
        req.body?.action_type !== undefined
          ? sanitizeString(req.body.action_type, 180)
          : sanitizeString(existing?.action_type, 180);
      const actionTouched =
        req.body?.action !== undefined ||
        req.body?.action_type !== undefined ||
        req.body?.title !== undefined ||
        req.body?.type !== undefined;

      let updatePayload: Record<string, any> = cleanObject({
        title: req.body?.title !== undefined ? nextTitle : undefined,
        content: req.body?.content !== undefined ? sanitizeString(req.body.content, 4000) : undefined,
        type: req.body?.type !== undefined ? nextType : undefined,
        action:
          actionTouched
            ? resolveActivityLogAction({
                action: req.body?.action !== undefined ? req.body.action : existing?.action,
                actionType: nextActionType,
                title: nextTitle,
                type: nextType
              })
            : undefined,
        action_type: req.body?.action_type !== undefined ? nextActionType : undefined,
        payload_details:
          req.body?.payload_details !== undefined ? sanitizeString(req.body.payload_details, 4000) : undefined,
        status: req.body?.status !== undefined ? sanitizeString(req.body.status, 40) : undefined,
        updated_at: new Date().toISOString()
      });

      let updated: any = null;
      let updateError: any = null;
      const removedColumns = new Set<string>();
      for (let attempt = 0; attempt < 12 && Object.keys(updatePayload).length > 0; attempt += 1) {
        const result = await supabase
          .from('activity_logs')
          .update(updatePayload)
          .eq('id', logId)
          .select()
          .maybeSingle();
        updated = result.data;
        updateError = result.error;
        if (!updateError) break;
        const missingColumn = extractMissingColumnName(updateError);
        if (!missingColumn || removedColumns.has(missingColumn) || !isActivityLogOptionalColumn(missingColumn)) break;
        removedColumns.add(missingColumn);
        delete updatePayload[missingColumn];
      }
      if (updateError) throw updateError;

      return res.json({ success: true, data: updated || { ...existing, ...updatePayload } });
    } catch (error: any) {
      logRouteDbError('/api/logs/:logId [PATCH]', error, { logId: sanitizeString(req.params.logId, 120) });
      return res.status(500).json({ success: false, error: 'Falha ao atualizar log.' });
    }
  });

  app.delete('/api/logs/:logId', checkAuth, async (req: any, res) => {
    try {
      const logId = sanitizeString(req.params.logId, 120);
      if (!logId) return res.status(400).json({ success: false, error: 'ID do log é obrigatório.' });

      const { data: existing, error: findError } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('id', logId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing) return res.status(404).json({ success: false, error: 'Log não encontrado.' });

      const user = req.session.user;
      const isManager = user.role === 'coordinator' || user.role === 'admin' || user.role === 'owner';
      const sameClinic =
        sanitizeString(existing?.clinic_id, 120) &&
        sanitizeString(existing?.clinic_id, 120) === sanitizeString(currentClinicId(user), 120);
      if (!(isManager && sameClinic)) {
        return res.status(403).json({ success: false, error: 'Apenas coordenação pode arquivar logs da clínica.' });
      }

      let archivePayload: Record<string, any> = {
        status: 'archived',
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      let archiveError: any = null;
      const removedColumns = new Set<string>();
      for (let attempt = 0; attempt < 8 && Object.keys(archivePayload).length > 0; attempt += 1) {
        const result = await supabase.from('activity_logs').update(archivePayload).eq('id', logId);
        archiveError = result.error;
        if (!archiveError) break;
        const missingColumn = extractMissingColumnName(archiveError);
        if (!missingColumn || removedColumns.has(missingColumn) || !isActivityLogOptionalColumn(missingColumn)) break;
        removedColumns.add(missingColumn);
        delete archivePayload[missingColumn];
      }
      if (archiveError) throw archiveError;

      return res.json({ success: true, archivedId: logId });
    } catch (error: any) {
      logRouteDbError('/api/logs/:logId [DELETE]', error, { logId: sanitizeString(req.params.logId, 120) });
      return res.status(500).json({ success: false, error: 'Falha ao arquivar log.' });
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
      const clinicLogoPath = sanitizeString(req.body?.clinicLogoPath, 260);
      const clinicCnpj = sanitizeString(req.body?.clinicCnpj, 24);
      const clinicPhone = sanitizePhone(req.body?.clinicPhone);
      const specialty = sanitizeString(req.body?.specialty, 120);
      const council = sanitizeString(req.body?.council, 80);
      const councilNumber = sanitizeString(req.body?.councilNumber, 80);
      const signatureDataUrl = sanitizeUrl(req.body?.signatureDataUrl);
      const signaturePath = sanitizeString(req.body?.signaturePath, 260);
      const profilePicture = sanitizeUrl(req.body?.profilePicture);
      const profilePicturePath = sanitizeString(req.body?.profilePicturePath, 260);

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
          first_login_completed: true,
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
            clinicCnpj: clinicCnpj || null,
            profilePicturePath: profilePicturePath || null,
            clinicLogoPath: clinicLogoPath || null,
            signaturePath: signaturePath || null
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

        const activePatientPriceId = resolveActivePatientPriceId();
        const coordinatorEmail = sanitizeEmail(req.session.user?.email);
        if (activePatientPriceId && coordinatorEmail) {
          try {
            const subscription = await createClinicMeteredSubscription({
              supabase,
              stripe: getStripe(),
              clinicId,
              coordinatorUserId: userId,
              email: coordinatorEmail,
              clinicName: clinicName || 'Minha Clinica',
              activePatientPriceId,
              logger: console
            });
            if (subscription) {
              await persistStripeSubscriptionReference({
                customerId: subscription.customerId,
                subscriptionId: subscription.subscriptionId,
                subscriptionItemId: subscription.subscriptionItemId,
                email: coordinatorEmail,
                userId,
                clinicId,
                status: subscription.status
              });
            }
          } catch (billingError: any) {
            console.error('[Stripe Billing] Falha ao criar assinatura metered no onboarding (não bloqueante).', {
              clinicId,
              userId,
              message: billingError?.message || String(billingError)
            });
          }
        }
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
      req.session.user.crp = councilNumber || req.session.user?.crp || null;
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
      const profileOut = profileExtra ? { ...profileExtra } : null;
      if (profileOut) {
        profileOut.crp = resolveStoredCrp(profileOut);
        profileOut.council = resolveStoredCouncil(profileOut);
        profileOut.council_number = resolveStoredCrp(profileOut);
        const metadata = (profileOut.metadata && typeof profileOut.metadata === 'object') ? { ...profileOut.metadata } : {};
        const profilePhotoPath = extractPatientPhotosStoragePath(metadata.profilePicturePath || profileOut.profile_photo_url);
        const clinicLogoPath = extractPatientPhotosStoragePath(metadata.clinicLogoPath || profileOut.clinic_logo_url);
        const signaturePath = extractPatientPhotosStoragePath(metadata.signaturePath || profileOut.signature_data_url);

        if (profilePhotoPath) {
          const { data: signed } = await supabase.storage.from('patient-photos').createSignedUrl(profilePhotoPath, 60 * 10);
          if (signed?.signedUrl) profileOut.profile_photo_url = signed.signedUrl;
        }
        if (clinicLogoPath) {
          const { data: signed } = await supabase.storage.from('patient-photos').createSignedUrl(clinicLogoPath, 60 * 10);
          if (signed?.signedUrl) profileOut.clinic_logo_url = signed.signedUrl;
        }
        if (signaturePath) {
          const { data: signed } = await supabase.storage.from('patient-photos').createSignedUrl(signaturePath, 60 * 10);
          if (signed?.signedUrl) profileOut.signature_data_url = signed.signedUrl;
        }
        profileOut.metadata = {
          ...metadata,
          profilePicturePath: profilePhotoPath || metadata.profilePicturePath || null,
          clinicLogoPath: clinicLogoPath || metadata.clinicLogoPath || null,
          signaturePath: signaturePath || metadata.signaturePath || null
        };
      }
      res.json({ success: true, data: { ...data, professional_profile: profileOut } });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/profile/:userId/media', checkAuth, async (req: any, res) => {
    try {
      const requesterId = sanitizeString(req.session?.user?.id, 120);
      const requesterRole = sanitizeString(req.session?.user?.role, 40).toLowerCase();
      const targetUserId = sanitizeString(req.params.userId, 120);
      if (!requesterId || !targetUserId) {
        return res.status(400).json({ success: false, error: 'Parâmetros inválidos.' });
      }
      if (requesterId !== targetUserId && requesterRole !== 'admin' && requesterRole !== 'coordinator') {
        return res.status(403).json({ success: false, error: 'Acesso negado' });
      }

      const { data: profileExtra, error: profileError } = await supabase
        .from('professional_profiles')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (profileError) {
        throw profileError;
      }

      const profileOut = profileExtra ? { ...profileExtra } : null;
      if (profileOut) {
        profileOut.crp = resolveStoredCrp(profileOut);
        profileOut.council = resolveStoredCouncil(profileOut);
        profileOut.council_number = resolveStoredCrp(profileOut);
      }
      const metadata =
        profileOut?.metadata && typeof profileOut.metadata === 'object'
          ? { ...(profileOut.metadata as Record<string, any>) }
          : {};

      const profilePhotoPath = extractPatientPhotosStoragePath(metadata.profilePicturePath || profileOut?.profile_photo_url);
      const clinicLogoPath = extractPatientPhotosStoragePath(metadata.clinicLogoPath || profileOut?.clinic_logo_url);
      const signaturePath = extractPatientPhotosStoragePath(metadata.signaturePath || profileOut?.signature_data_url);

      let profilePictureUrl: string | null = null;
      let clinicLogoUrl: string | null = null;
      let signatureUrl: string | null = null;

      if (profilePhotoPath) {
        const { data: signed } = await supabase.storage.from('patient-photos').createSignedUrl(profilePhotoPath, 60 * 10);
        profilePictureUrl = sanitizeUrl(signed?.signedUrl) || null;
      }
      if (clinicLogoPath) {
        const { data: signed } = await supabase.storage.from('patient-photos').createSignedUrl(clinicLogoPath, 60 * 10);
        clinicLogoUrl = sanitizeUrl(signed?.signedUrl) || null;
      }
      if (signaturePath) {
        const { data: signed } = await supabase.storage.from('patient-photos').createSignedUrl(signaturePath, 60 * 10);
        signatureUrl = sanitizeUrl(signed?.signedUrl) || null;
      }

      return res.json({
        success: true,
        data: {
          profilePictureUrl,
          clinicLogoUrl,
          signatureUrl,
          profilePicturePath: profilePhotoPath || metadata.profilePicturePath || null,
          clinicLogoPath: clinicLogoPath || metadata.clinicLogoPath || null,
          signaturePath: signaturePath || metadata.signaturePath || null
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.post('/api/profile/:userId', checkAuth, async (req: any, res) => {
    try {
      // Only allow own profile or admin
      if (req.session.user.id !== req.params.userId && req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const profilePicturePath = sanitizeString(req.body?.profilePicturePath || req.body?.profile_picture_path, 260);
      const signaturePath = sanitizeString(req.body?.signaturePath || req.body?.signature_path, 260);
      const clinicLogoPath = sanitizeString(req.body?.clinicLogoPath || req.body?.clinic_logo_path, 260);
      const resolvedCrp = sanitizeString(req.body?.crp, 80);
      const resolvedCouncil = sanitizeString(req.body?.council || req.body?.clinicSettings?.council, 80);
      const resolvedCouncilNumber =
        sanitizeString(req.body?.councilNumber || req.body?.clinicSettings?.councilNumber, 80) ||
        resolvedCrp;

      const safePayload = cleanObject({
        id: sanitizeString(req.params.userId, 120),
        name: sanitizeString(req.body?.name, 180) || undefined,
        email: sanitizeEmail(req.body?.email) || undefined,
        role: sanitizeString(req.body?.role, 40) || undefined,
        profile_picture: sanitizeUrl(req.body?.profile_picture) || sanitizeUrl(req.body?.profilePicture) || undefined,
        crp: resolvedCrp || undefined,
        phone: sanitizePhoneE164(req.body?.phone || req.body?.whatsappPhone || req.body?.whatsapp) || undefined,
        signature_url:
          sanitizeUrl(req.body?.signature_url) ||
          sanitizeUrl(req.body?.signatureUrl) ||
          sanitizeUrl(req.body?.signatureDataUrl) ||
          sanitizeUrl(req.body?.clinicSettings?.signatureDataUrl) ||
          undefined,
        specialties: sanitizeString(req.body?.specialties, 1000) || undefined,
        mini_curriculum: sanitizeString(req.body?.mini_curriculum || req.body?.miniCurriculum, 4000) || undefined,
        updated_at: new Date().toISOString()
      });

      let candidate: Record<string, any> = { ...safePayload };
      const removedColumns = new Set<string>();
      let lastError: any = null;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const { error } = await supabase.from('users').upsert(candidate, { onConflict: 'id' });
        if (!error) {
          const role = sanitizeString(req.session.user?.role, 40).toLowerCase();
          const clinicId = currentClinicId(req.session.user);

          const currentProfilePictureUrl =
            sanitizeUrl(req.body?.profile_picture) ||
            sanitizeUrl(req.body?.profilePicture) ||
            undefined;
          const currentSignatureUrl =
            sanitizeUrl(req.body?.signature_url) ||
            sanitizeUrl(req.body?.signatureUrl) ||
            sanitizeUrl(req.body?.signatureDataUrl) ||
            sanitizeUrl(req.body?.clinicSettings?.signatureDataUrl) ||
            undefined;
          const currentClinicLogoUrl =
            sanitizeUrl(req.body?.clinic_logo_url) ||
            sanitizeUrl(req.body?.clinicLogoUrl) ||
            sanitizeUrl(req.body?.clinicSettings?.clinicLogoUrl) ||
            undefined;

          // Merge metadata so one partial update does not erase previously persisted media paths.
          const { data: existingProfile } = await supabase
            .from('professional_profiles')
            .select('metadata, profile_photo_url, signature_data_url, clinic_logo_url')
            .eq('user_id', sanitizeString(req.params.userId, 120))
            .maybeSingle();
          const existingMetadata =
            existingProfile?.metadata && typeof existingProfile.metadata === 'object'
              ? { ...(existingProfile.metadata as Record<string, any>) }
              : {};
          const resolvedProfilePictureUrl =
            currentProfilePictureUrl ||
            sanitizeUrl(existingProfile?.profile_photo_url) ||
            sanitizeSessionUrl(req.session.user?.profilePicture) ||
            null;
          const resolvedSignatureUrl =
            currentSignatureUrl ||
            sanitizeUrl(existingProfile?.signature_data_url) ||
            sanitizeSessionUrl(req.session.user?.signatureDataUrl) ||
            sanitizeSessionUrl(req.session.user?.clinicSettings?.signatureDataUrl) ||
            null;
          const resolvedClinicLogoUrl =
            currentClinicLogoUrl ||
            sanitizeUrl(existingProfile?.clinic_logo_url) ||
            sanitizeSessionUrl(req.session.user?.clinicSettings?.clinicLogoUrl) ||
            null;

          const mergedMetadata = cleanObject({
            ...existingMetadata,
            profilePicturePath: profilePicturePath || existingMetadata?.profilePicturePath || undefined,
            signaturePath: signaturePath || existingMetadata?.signaturePath || undefined,
            clinicLogoPath: clinicLogoPath || existingMetadata?.clinicLogoPath || undefined
          });

          let profileCandidate: Record<string, any> = cleanObject({
            user_id: sanitizeString(req.params.userId, 120),
            clinic_id: clinicId || undefined,
            role: role || undefined,
            council: resolvedCouncil || undefined,
            council_number: resolvedCouncilNumber || undefined,
            crp: resolvedCrp || resolvedCouncilNumber || undefined,
            profile_photo_url: resolvedProfilePictureUrl || undefined,
            signature_data_url: resolvedSignatureUrl || undefined,
            clinic_logo_url: resolvedClinicLogoUrl || undefined,
            metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
            updated_at: new Date().toISOString()
          });
          for (let profileAttempt = 0; profileAttempt < 10; profileAttempt += 1) {
            const { error: profileError } = await supabase
              .from('professional_profiles')
              .upsert([profileCandidate], { onConflict: 'user_id' });
            if (!profileError) break;
            const missingProfileColumn = extractMissingColumnName(profileError);
            if (!missingProfileColumn || !(missingProfileColumn in profileCandidate)) break;
            const { [missingProfileColumn]: _removed, ...rest } = profileCandidate as any;
            profileCandidate = rest;
          }

          const nextClinicSettings = compactClinicSettingsForSession({
            ...(req.session.user?.clinicSettings || {}),
            ...(req.body?.clinicSettings && typeof req.body.clinicSettings === 'object' ? req.body.clinicSettings : {}),
            ...(resolvedCouncil ? { council: resolvedCouncil } : {}),
            ...(resolvedCouncilNumber ? { councilNumber: resolvedCouncilNumber } : {}),
            clinicLogoUrl: resolvedClinicLogoUrl || null,
            signatureDataUrl: resolvedSignatureUrl || null,
            therapistSpecialties:
              sanitizeString(req.body?.specialties || req.body?.clinicSettings?.therapistSpecialties, 240) ||
              req.session.user?.clinicSettings?.therapistSpecialties ||
              null,
            therapistMiniCurriculum:
              sanitizeString(req.body?.miniCurriculum || req.body?.clinicSettings?.therapistMiniCurriculum, 3000) ||
              req.session.user?.clinicSettings?.therapistMiniCurriculum ||
              null,
          });

          if (clinicId && (role === 'coordinator' || role === 'admin' || role === 'owner')) {
            await patchTableSafely('clinics', { column: 'id', value: clinicId }, {
              logo_url: resolvedClinicLogoUrl || undefined,
              signature_data_url: resolvedSignatureUrl || undefined,
              updated_at: new Date().toISOString()
            });
          }

          if (nextClinicSettings) {
            await supabase.auth.admin.updateUserById(sanitizeString(req.params.userId, 120), {
              user_metadata: {
                clinic_settings: nextClinicSettings,
                first_login_completed:
                  typeof req.session.user?.firstLoginCompleted === 'boolean'
                    ? req.session.user.firstLoginCompleted
                    : true
              }
            });
          }

          req.session.user.name =
            sanitizeString(req.body?.name, 180) ||
            req.session.user?.name ||
            req.session.user?.email ||
            'Profissional';
          req.session.user.profilePicture = resolvedProfilePictureUrl;
          req.session.user.signatureDataUrl = resolvedSignatureUrl;
          req.session.user.clinicSettings = nextClinicSettings;
          req.session.user.workspaces = compactWorkspacesForSession(await fetchUserWorkspaces(req.session.user.id));
          req.session.user.crp =
            resolvedCrp ||
            resolvedCouncilNumber ||
            req.session.user?.crp ||
            null;
          req.session.user.specialties =
            sanitizeString(req.body?.specialties, 1000) ||
            req.session.user?.specialties ||
            null;
          req.session.user.miniCurriculum =
            sanitizeString(req.body?.mini_curriculum || req.body?.miniCurriculum, 4000) ||
            req.session.user?.miniCurriculum ||
            null;

          await new Promise<void>((resolve, reject) => {
            req.session.save((sessionError: any) => {
              if (sessionError) {
                reject(sessionError);
                return;
              }
              resolve();
            });
          });

          return res.json({ success: true });
        }

        lastError = error;
        const missingColumn = extractMissingColumnName(error);
        if (!missingColumn || removedColumns.has(missingColumn)) {
          break;
        }

        removedColumns.add(missingColumn);
        const { [missingColumn]: _removed, ...rest } = candidate as any;
        candidate = rest;
      }

      throw lastError || new Error('Falha ao salvar perfil.');
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
          .ilike('patient_email', patientEmail)
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/patient/self/tasks', checkAuth, requireRoles('patient'), async (req: any, res) => {
    try {
      const patientEmail = sanitizeEmail(req.session.user?.email);
      if (!patientEmail) {
        return res.status(400).json({ success: false, error: 'E-mail do paciente não disponível.' });
      }

      const patientIds = await getPatientIdsByEmailAcrossClinics(patientEmail);
      const { data: tasksByEmail, error: tasksByEmailError } = await supabase
        .from('tasks')
        .select('*')
        .eq('patient_email', patientEmail)
        .order('created_at', { ascending: false });
      if (tasksByEmailError) throw tasksByEmailError;

      let tasksById: any[] = [];
      if (patientIds.length > 0) {
        const { data: tasksByIdData, error: tasksByIdError } = await supabase
          .from('tasks')
          .select('*')
          .in('patient_id', patientIds)
          .order('created_at', { ascending: false });
        if (tasksByIdError) throw tasksByIdError;
        tasksById = Array.isArray(tasksByIdData) ? tasksByIdData : [];
      }

      const merged = Array.from(
        new Map(
          [...(Array.isArray(tasksByEmail) ? tasksByEmail : []), ...tasksById].map((row: any) => [
            String(row?.id || crypto.randomUUID()),
            row
          ])
        ).values()
      ).sort((a: any, b: any) => {
        const aTs = new Date(a?.created_at || 0).getTime();
        const bTs = new Date(b?.created_at || 0).getTime();
        return bTs - aTs;
      });

      res.json({ success: true, data: merged });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
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
        scheduled_at: req.body?.scheduled_at !== undefined
          ? sanitizeString(req.body?.scheduled_at, 60)
          : req.body?.scheduledAt !== undefined
            ? sanitizeString(req.body?.scheduledAt, 60)
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

      let safePayload: Record<string, any> = { ...payload };
      let data: any = null;
      while (Object.keys(safePayload).length > 0) {
        const result = await supabase
          .from('tasks')
          .upsert([safePayload], { onConflict: 'id' })
          .select()
          .single();
        if (!result.error) {
          data = result.data;
          break;
        }
        const missingColumn = extractMissingColumnName(result.error);
        if (missingColumn && missingColumn in safePayload) {
          delete safePayload[missingColumn];
          continue;
        }
        throw result.error;
      }
      if (!data) {
        return res.status(500).json({ error: 'Não foi possível persistir tarefa por incompatibilidade de schema.' });
      }
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
      res.status(500).json({ error: 'Falha na operação de dados.' });
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
        scheduled_at:
          req.body?.scheduled_at !== undefined
            ? (sanitizeString(req.body?.scheduled_at, 60) || undefined)
            : req.body?.scheduledAt !== undefined
              ? (sanitizeString(req.body?.scheduledAt, 60) || undefined)
              : undefined,
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
      return res.status(500).json({ success: false, error: 'Falha na operação de dados.' });
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
      return res.status(500).json({ success: false, error: 'Falha na operação de dados.' });
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
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });
      const scopedPatientId = sanitizeString(existing.patient_id, 120);
      const hasDirectAccess = await canAccessPatientInCurrentClinic(scopedPatientId, req.session.user);
      if (!hasDirectAccess) {
        const clinicId = currentClinicId(req.session.user);
        const safeEmail = sanitizeEmail(existing.patient_email);
        let hasEmailAccess = false;
        if (clinicId && safeEmail) {
          const clinicPatientIds = await getClinicPatientIdsByEmail(clinicId, safeEmail);
          hasEmailAccess = clinicPatientIds.length > 0;
        }
        if (!hasEmailAccess) {
          return res.status(403).json({ success: false, error: 'Acesso negado.' });
        }
      }
      const updates = cleanObject({
        title: req.body?.title !== undefined ? sanitizeTextField(req.body?.title, 180) : undefined,
        score: req.body?.score !== undefined ? asSafeNumber(req.body?.score, 0, 100) : undefined,
        energy: req.body?.energy !== undefined ? asSafeNumber(req.body?.energy, 0, 100) : undefined,
        note: req.body?.note !== undefined ? sanitizeTextField(req.body?.note, 12000) : undefined,
        icon: req.body?.icon !== undefined ? sanitizeString(req.body?.icon, 40) : undefined,
        updated_at: new Date().toISOString()
      });
      let data: any = null;
      let error: any = null;
      {
        const result = await supabase
          .from('history')
          .update(updates)
          .eq('id', historyId)
          .select('*')
          .single();
        data = result.data;
        error = result.error;
      }

      // Compatibilidade com produção: alguns ambientes não têm updated_at na history.
      if (error && /updated_at/i.test(String(error?.message || ''))) {
        const fallbackUpdates: any = { ...updates };
        delete fallbackUpdates.updated_at;
        const retry = await supabase
          .from('history')
          .update(fallbackUpdates)
          .eq('id', historyId)
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;
      return res.json({ success: true, data });
    } catch (error: any) {
      logRouteDbError('/api/history/:historyId [PATCH]', error, { historyId: sanitizeString(req.params.historyId, 120) });
      return res.status(500).json({ success: false, error: 'Falha na operação de dados.' });
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
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Registro não encontrado.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const { error } = await supabase
        .from('history')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', historyId);
      if (error) throw error;
      return res.json({ success: true });
    } catch (error: any) {
      logRouteDbError('/api/history/:historyId [DELETE]', error, { historyId: sanitizeString(req.params.historyId, 120) });
      return res.status(500).json({ success: false, error: 'Falha na operação de dados.' });
    }
  });

  app.patch('/api/notes/:noteId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const noteId = sanitizeString(req.params.noteId, 120);
      if (!noteId) return res.status(400).json({ success: false, error: 'noteId inválido.' });
      let existing: any = null;
      let existingError: any = null;

      if (isUuid(noteId)) {
        const result = await supabase
          .from('notes')
          .select('*')
          .eq('id', noteId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle();
        existing = result.data;
        existingError = result.error;
      } else {
        // Fallback for legacy/local IDs: resolve by patient + text/subject and update latest match.
        const fallbackPatientId = sanitizeString(req.body?.patient_id, 120);
        const fallbackText = sanitizeTextField(req.body?.text, 12000);
        const fallbackSubject = sanitizeTextField(req.body?.subject, 100);
        let fallbackQuery = supabase
          .from('notes')
          .select('*')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1);
        if (isUuid(fallbackPatientId)) fallbackQuery = fallbackQuery.eq('patient_id', fallbackPatientId);
        if (fallbackText) fallbackQuery = fallbackQuery.eq('text', fallbackText);
        if (fallbackSubject) fallbackQuery = fallbackQuery.eq('subject', fallbackSubject);
        const fallbackResult = await fallbackQuery.maybeSingle();
        existing = fallbackResult.data;
        existingError = fallbackResult.error;
      }

      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Nota não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const updatedVisibility =
        req.body?.visibility !== undefined
          ? normalizeNoteVisibility(req.body?.visibility)
          : undefined;
      const updatedType =
        updatedVisibility !== undefined
          ? (updatedVisibility === 'shared_clinic'
              ? 'professional'
              : updatedVisibility === 'shared_patient'
                ? 'shared'
                : 'private')
          : undefined;
      const updates = cleanObject({
        text: req.body?.text !== undefined ? sanitizeTextField(req.body?.text, 12000) : undefined,
        content: req.body?.text !== undefined ? sanitizeTextField(req.body?.text, 12000) : undefined,
        visibility: updatedVisibility,
        type: updatedType,
        score: req.body?.score !== undefined ? asSafeNumber(req.body?.score, 0, 100) : undefined,
        image: req.body?.image !== undefined ? sanitizeUrl(req.body?.image) : undefined,
        image_url: req.body?.image_url !== undefined ? sanitizeUrl(req.body?.image_url) : undefined,
        subject: req.body?.subject !== undefined ? (sanitizeTextField(req.body?.subject, 100) || 'Geral') : undefined,
        updated_at: new Date().toISOString()
      });
      const effectiveNoteId = sanitizeString(existing?.id, 120);
      const { data, error } = await updateNoteWithSchemaFallback(effectiveNoteId, updates);
      if (error) throw error;
      return res.json({ success: true, data });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.delete('/api/notes/:noteId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const noteId = sanitizeString(req.params.noteId, 120);
      if (!noteId) return res.status(400).json({ success: false, error: 'noteId inválido.' });
      let existing: any = null;
      let existingError: any = null;
      if (isUuid(noteId)) {
        const result = await supabase
          .from('notes')
          .select('id, patient_id')
          .eq('id', noteId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .maybeSingle();
        existing = result.data;
        existingError = result.error;
      } else {
        const fallbackPatientId = sanitizeString(req.body?.patient_id, 120);
        const fallbackText = sanitizeTextField(req.body?.text, 12000);
        let fallbackQuery = supabase
          .from('notes')
          .select('id, patient_id')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1);
        if (isUuid(fallbackPatientId)) fallbackQuery = fallbackQuery.eq('patient_id', fallbackPatientId);
        if (fallbackText) fallbackQuery = fallbackQuery.eq('text', fallbackText);
        const fallbackResult = await fallbackQuery.maybeSingle();
        existing = fallbackResult.data;
        existingError = fallbackResult.error;
      }
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Nota não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }
      const { error } = await supabase
        .from('notes')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', sanitizeString(existing.id, 120));
      if (error) throw error;
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
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
      const { data: byEmail, error: byEmailError } = await supabase
        .from('assigned_tasks')
        .select('*')
        .ilike('patient_email', patientEmail)
        .order('scheduled_at', { ascending: false });
      if (byEmailError) {
        if (/assigned_tasks/i.test(String(byEmailError?.message || ''))) {
          return res.status(200).json({ success: true, data: [], warning: 'Tabela assigned_tasks não criada.' });
        }
        throw byEmailError;
      }

      const nowIso = new Date().toISOString();
      let byId: any[] = [];
      if (patientIds.length > 0) {
        const { data: byIdData, error: byIdError } = await supabase
          .from('assigned_tasks')
          .select('*')
          .in('patient_id', patientIds)
          .order('scheduled_at', { ascending: false });
        if (byIdError) {
          if (/assigned_tasks/i.test(String(byIdError?.message || ''))) {
            return res.status(200).json({ success: true, data: [], warning: 'Tabela assigned_tasks não criada.' });
          }
          throw byIdError;
        }
        byId = Array.isArray(byIdData) ? byIdData : [];
      }

      const mergedAssigned = Array.from(
        new Map(
          [...(Array.isArray(byEmail) ? byEmail : []), ...byId].map((row: any) => [
            String(row?.id || crypto.randomUUID()),
            row
          ])
        ).values()
      );

      // Fallback robusto: caso assigned_tasks esteja vazio/indisponível para este paciente,
      // também lemos tarefas pendentes da tabela legacy `tasks` com scheduled_at.
      const isPendingLegacyTask = (task: any) => {
        const status = sanitizeString(task?.status, 40).toLowerCase();
        if (status) return status !== 'completed' && status !== 'done';
        if (typeof task?.is_completed === 'boolean') return !task.is_completed;
        if (typeof task?.done === 'boolean') return !task.done;
        if (typeof task?.completed === 'boolean') return !task.completed;
        return true;
      };
      const { data: legacyTasksByEmail, error: legacyTasksByEmailError } = await supabase
        .from('tasks')
        .select('*')
        .ilike('patient_email', patientEmail)
        .order('created_at', { ascending: false });
      if (legacyTasksByEmailError) {
        console.warn('[PatientSelfAssignedTasks] fallback tasks by email warning:', legacyTasksByEmailError.message || String(legacyTasksByEmailError));
      }

      let legacyTasksById: any[] = [];
      if (patientIds.length > 0) {
        const { data: legacyTasksByIdData, error: legacyTasksByIdError } = await supabase
          .from('tasks')
          .select('*')
          .in('patient_id', patientIds)
          .order('created_at', { ascending: false });
        if (legacyTasksByIdError) {
          console.warn('[PatientSelfAssignedTasks] fallback tasks by id warning:', legacyTasksByIdError.message || String(legacyTasksByIdError));
        } else {
          legacyTasksById = Array.isArray(legacyTasksByIdData) ? legacyTasksByIdData : [];
        }
      }

      const mergedLegacyTasks = Array.from(
        new Map(
          [...(Array.isArray(legacyTasksByEmail) ? legacyTasksByEmail : []), ...legacyTasksById].map((row: any) => [
            String(row?.id || crypto.randomUUID()),
            row
          ])
        ).values()
      )
        .filter(isPendingLegacyTask)
        .map((task: any) => ({
        id: String(task?.id || crypto.randomUUID()),
        patient_id: sanitizeString(task?.patient_id, 120) || null,
        patient_email: sanitizeEmail(task?.patient_email),
        professional_id: sanitizeString(task?.therapist_id, 120) || null,
        task_type: sanitizeString(task?.type, 60) || 'task',
        task_data: {
          title: sanitizeString(task?.title, 240) || 'Tarefa agendada',
          description: sanitizeTextField(task?.description, 4000) || '',
          icon: sanitizeString(task?.icon, 40) || '🎯',
          color: sanitizeString(task?.color, 80) || 'bg-blue-100 text-blue-600',
          linkedTask: sanitizeString(task?.linked_task, 120) || undefined,
          maxScore: asSafeNumber(task?.max_score, 1, 100) ?? 4
        },
        scheduled_at: sanitizeString((task as any)?.scheduled_at, 80) || sanitizeString(task?.created_at, 80) || null,
        status: 'pending',
        _source: 'tasks_fallback'
      }));

      const merged = Array.from(
        new Map(
          [...mergedAssigned, ...mergedLegacyTasks].map((row: any) => [
            `${String(row?._source || 'assigned')}::${String(row?.id || crypto.randomUUID())}`,
            row
          ])
        ).values()
      );

      const visibleTasks = merged.filter((task: any) => {
        const scheduledAt = sanitizeString(task?.scheduled_at, 60);
        if (!scheduledAt) return true;
        const scheduledMs = parseTaskScheduleToMs(scheduledAt);
        const nowMs = Date.now();
        if (typeof scheduledMs === 'number' && Number.isFinite(scheduledMs)) return scheduledMs <= nowMs;
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
      const clinicId = currentClinicId(req.session.user);
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

      const incomingScheduledAt = sanitizeString(req.body?.scheduled_at, 60);
      const normalizedScheduledAtMs = parseTaskScheduleToMs(incomingScheduledAt);
      const normalizedScheduledAt =
        typeof normalizedScheduledAtMs === 'number' && Number.isFinite(normalizedScheduledAtMs)
          ? new Date(normalizedScheduledAtMs).toISOString()
          : incomingScheduledAt || new Date().toISOString();

      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        clinic_id: clinicId || undefined,
        patient_id: resolvedPatientId,
        patient_email: sanitizeEmail(req.body?.patient_email),
        professional_id: professionalId || undefined,
        task_type: taskType,
        task_data: safeTaskData,
        scheduled_at: normalizedScheduledAt,
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

  app.patch('/api/assigned-tasks/:taskId', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const taskId = sanitizeString(req.params.taskId, 120);
      if (!taskId) return res.status(400).json({ success: false, error: 'taskId inválido.' });

      const { data: existing, error: existingError } = await supabase
        .from('assigned_tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return res.status(404).json({ success: false, error: 'Tarefa não encontrada.' });
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const existingTaskData = existing?.task_data && typeof existing.task_data === 'object' ? existing.task_data : {};
      const incomingTaskData =
        req.body?.task_data && typeof req.body.task_data === 'object'
          ? req.body.task_data
          : req.body?.taskData && typeof req.body.taskData === 'object'
            ? req.body.taskData
            : null;

      const mergedTaskData = incomingTaskData
        ? {
            ...existingTaskData,
            title: sanitizeString(incomingTaskData?.title, 240) || existingTaskData?.title || undefined,
            description: sanitizeTextField(incomingTaskData?.description, 4000) || existingTaskData?.description || undefined,
            icon: sanitizeString(incomingTaskData?.icon, 40) || existingTaskData?.icon || undefined,
            color: sanitizeString(incomingTaskData?.color, 80) || existingTaskData?.color || undefined,
            linkedTask: sanitizeString(incomingTaskData?.linkedTask, 120) || existingTaskData?.linkedTask || undefined,
            linkedProtocolId: sanitizeString(incomingTaskData?.linkedProtocolId, 120) || existingTaskData?.linkedProtocolId || undefined,
            maxScore: asSafeNumber(incomingTaskData?.maxScore ?? incomingTaskData?.max_score, 1, 10) ?? existingTaskData?.maxScore ?? existingTaskData?.max_score
          }
        : undefined;

      const incomingScheduledAt = req.body?.scheduled_at !== undefined ? sanitizeString(req.body?.scheduled_at, 60) : undefined;
      const normalizedScheduledAtMs = incomingScheduledAt ? parseTaskScheduleToMs(incomingScheduledAt) : null;
      const normalizedScheduledAt =
        incomingScheduledAt === undefined
          ? undefined
          : (typeof normalizedScheduledAtMs === 'number' && Number.isFinite(normalizedScheduledAtMs)
              ? new Date(normalizedScheduledAtMs).toISOString()
              : incomingScheduledAt);

      const updates = cleanObject({
        task_type: req.body?.task_type !== undefined ? sanitizeString(req.body?.task_type, 60) : undefined,
        task_data: mergedTaskData,
        scheduled_at: normalizedScheduledAt,
        status: req.body?.status !== undefined ? sanitizeString(req.body?.status, 40).toLowerCase() : undefined
      });

      const { data, error } = await supabase
        .from('assigned_tasks')
        .update(updates)
        .eq('id', taskId)
        .select('*')
        .single();
      if (error) throw error;

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

      const submittedEffort = asSafeNumber(
        req.body?.patient_effort ?? req.body?.energy ?? req.body?.effort,
        0,
        100
      );
      const submittedComment = sanitizeTextField(req.body?.patient_comment, 4000);
      const hasCompletionDetails =
        submittedEffort !== null ||
        submittedComment.length > 0 ||
        sanitizeString(req.body?.patient_effort_emoji || req.body?.effort_emoji, 20).length > 0;
      if (String(existing?.status || '').toLowerCase() === 'completed' && existing?.completed_at && !hasCompletionDetails) {
        return res.json({ success: true, data: existing, skipped: true });
      }

      const existingTaskData = existing?.task_data && typeof existing.task_data === 'object' ? existing.task_data : {};
      const effortEmoji =
        sanitizeString(req.body?.patient_effort_emoji || req.body?.effort_emoji, 20) ||
        effortEmojiForPercent(submittedEffort) ||
        effortEmojiForPercent(asSafeNumber(existing?.patient_effort, 0, 100));
      const effortLabel =
        sanitizeString(req.body?.patient_effort_label || req.body?.effort_label, 80) ||
        effortLabelForPercent(submittedEffort) ||
        effortLabelForPercent(asSafeNumber(existing?.patient_effort, 0, 100));
      const completedAt = existing?.completed_at || new Date().toISOString();
      const updatePayload = cleanObject({
        patient_effort: submittedEffort,
        patient_effort_emoji: effortEmoji || null,
        patient_effort_label: effortLabel || null,
        patient_comment: submittedComment,
        task_data: {
          ...existingTaskData,
          patientEffort: submittedEffort,
          patient_effort: submittedEffort,
          patientEffortEmoji: effortEmoji || null,
          patient_effort_emoji: effortEmoji || null,
          patientEffortLabel: effortLabel || null,
          patient_effort_label: effortLabel || null
        },
        status: 'completed',
        completed_at: completedAt
      });

      const { data, error } = await updateAssignedTaskWithSchemaFallback(taskId, updatePayload);
      if (error) throw error;

      const taskData = data?.task_data && typeof data.task_data === 'object' ? data.task_data : {};
      let historyEntry: any = null;
      try {
        historyEntry = cleanObject({
          id: uuidFromStableString(`adult-assigned-task-completion-history:${taskId}`),
          patient_id: sanitizeString(data?.patient_id, 120),
          patient_email: sanitizeEmail(data?.patient_email),
          type: sanitizeString(data?.task_type, 80) || 'task',
          title: sanitizeTextField(taskData?.title || 'Tarefa concluída', 180),
          score: null,
          energy: asSafeNumber(data?.patient_effort, 0, 100),
          note: sanitizeTextField(data?.patient_comment, 12000),
          icon: sanitizeString(taskData?.icon, 40) || '📌',
          therapist_id: sanitizeString(data?.professional_id, 120),
          created_at: data?.completed_at || new Date().toISOString(),
          date_group: dateGroupForClinic(data?.completed_at || new Date().toISOString(), req.session.user),
          assigned_task_id: sanitizeString(data?.id, 120),
          source: 'assigned_task_completion',
          task_data: cleanObject({
            ...taskData,
            patientEffortEmoji: effortEmoji || taskData?.patientEffortEmoji || null,
            patient_effort_emoji: effortEmoji || taskData?.patient_effort_emoji || null,
            patientEffortLabel: effortLabel || taskData?.patientEffortLabel || null,
            patient_effort_label: effortLabel || taskData?.patient_effort_label || null
          })
        });
        const historyResult = await upsertHistoryWithSchemaFallback(historyEntry);
        if (historyResult.error) throw historyResult.error;
        historyEntry = historyResult.data || historyEntry;
      } catch (historyInsertError: any) {
        console.warn('[AssignedTasks] Falha ao criar histórico automático:', historyInsertError?.message || String(historyInsertError));
      }

      let patientLogEntry: any = null;
      try {
        patientLogEntry = cleanObject({
          id: crypto.randomUUID(),
          patient_id: sanitizeString(data?.patient_id, 120),
          professional_id: sanitizeString(data?.professional_id, 120),
          type: sanitizeString(data?.task_type, 80) || 'task',
          value: cleanObject({
            task_id: sanitizeString(data?.id, 120),
            title: sanitizeTextField(taskData?.title || 'Tarefa concluída', 180),
            completed: true,
            effort: asSafeNumber(data?.patient_effort, 0, 100),
            energy: asSafeNumber(data?.patient_effort, 0, 100),
            effortEmoji: effortEmoji || null,
            effortLabel: effortLabel || null,
            note: sanitizeTextField(data?.patient_comment, 4000),
            icon: sanitizeString(taskData?.icon, 40) || '📌'
          }),
          timestamp: data?.completed_at || new Date().toISOString()
        });
        await supabase.from('patient_logs').insert([patientLogEntry]);
      } catch (patientLogError: any) {
        console.warn('[AssignedTasks] Falha ao criar log automático do paciente:', patientLogError?.message || String(patientLogError));
      }

      return res.json({ success: true, data, historyEntry, patientLogEntry });
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
      if (!(await canAccessPatientInCurrentClinic(sanitizeString(existing.patient_id, 120), req.session.user))) {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const existingTaskData = existing.task_data && typeof existing.task_data === 'object' ? existing.task_data : {};
      const isVbMapp = isVbMappTask(existingTaskData) || isVbMappTask(existing);
      const taskMasteryCriterion = asSafeNumber(
        existingTaskData?.meta_sucessos ?? existingTaskData?.metaSucessos ?? req.body?.meta_sucessos,
        1,
        1000
      ) || 5;
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
      const existingConsecutive = asSafeNumber(existing?.consecutive_successes, 0, 1000) || 0;
      const nextConsecutive = isVbMapp
        ? (proScore >= 1 ? existingConsecutive + 1 : 0)
        : existingConsecutive;

      const reviewNote = sanitizeTextField(req.body?.pro_review_note, 4000);
      const reviewedAt = new Date().toISOString();
      const patientEffort = asSafeNumber(
        existing?.patient_effort ??
          existingTaskData?.patientEffort ??
          existingTaskData?.patient_effort,
        0,
        100
      );
      const patientEffortEmoji =
        sanitizeString(existing?.patient_effort_emoji || existingTaskData?.patientEffortEmoji || existingTaskData?.patient_effort_emoji, 20) ||
        effortEmojiForPercent(patientEffort);
      const patientEffortLabel =
        sanitizeString(existing?.patient_effort_label || existingTaskData?.patientEffortLabel || existingTaskData?.patient_effort_label, 80) ||
        effortLabelForPercent(patientEffort);
      const reviewMetadata = cleanObject({
        protocolId: sanitizeString(existingTaskData?.protocolId || existingTaskData?.protocol_id, 120) || null,
        protocolTitle: sanitizeTextField(existingTaskData?.protocolTitle || existingTaskData?.protocol_name, 240) || null,
        protocolCategory: sanitizeString(existingTaskData?.protocolCategory, 80) || null,
        domainId: sanitizeString(existingTaskData?.domainId || existingTaskData?.domain_id, 120) || null,
        domainName: sanitizeTextField(existingTaskData?.domainName || existingTaskData?.domain_name || existingTaskData?.sourceDomain || existingTaskData?.source_domain, 240) || null,
        skillId: sanitizeString(existingTaskData?.skillId || existingTaskData?.skill_id, 120) || null,
        skillName: sanitizeTextField(existingTaskData?.skillName || existingTaskData?.skill_name || existingTaskData?.title, 240) || null,
        skillCode: sanitizeString(existingTaskData?.skillCode || existingTaskData?.code, 80) || null,
        sourcePage: existingTaskData?.sourcePage || existingTaskData?.source_page || null
      });
      let reviewPayload: any = {
        pro_score: proScore,
        max_score: maxScoreFromTask,
        pro_review_note: reviewNote,
        task_data: {
          ...existingTaskData,
          maxScore: maxScoreFromTask,
          max_score: maxScoreFromTask,
          proScore,
          pro_score: proScore,
          proReviewNote: reviewNote,
          pro_review_note: reviewNote,
          reviewedAt,
          reviewed_at: reviewedAt,
          patientEffort,
          patient_effort: patientEffort,
          patientEffortEmoji,
          patient_effort_emoji: patientEffortEmoji,
          patientEffortLabel,
          patient_effort_label: patientEffortLabel
        },
        reviewed_at: reviewedAt,
        reviewed_by: sanitizeString(req.session.user?.id, 120)
      };
      if (isVbMapp) {
        reviewPayload.consecutive_successes = nextConsecutive;
      }

      const { data, error } = await updateAssignedTaskWithSchemaFallback(taskId, reviewPayload);
      if (error) throw error;

      const returnedTaskData = data?.task_data && typeof data.task_data === 'object' ? data.task_data : {};
      const savedTaskData = {
        ...existingTaskData,
        ...returnedTaskData,
        maxScore: maxScoreFromTask,
        max_score: maxScoreFromTask,
        proScore,
        pro_score: proScore,
        proReviewNote: reviewNote,
        pro_review_note: reviewNote,
        reviewedAt,
        reviewed_at: reviewedAt,
        patientEffort,
        patient_effort: patientEffort,
        patientEffortEmoji,
        patient_effort_emoji: patientEffortEmoji,
        patientEffortLabel,
        patient_effort_label: patientEffortLabel
      };
      const normalizedReviewedTask = {
        ...existing,
        ...data,
        pro_score: proScore,
        max_score: maxScoreFromTask,
        pro_review_note: reviewNote,
        reviewed_at: reviewedAt,
        reviewed_by: sanitizeString(req.session.user?.id, 120),
        task_data: savedTaskData
      };
      const taskTitle = sanitizeTextField(savedTaskData?.title || existingTaskData?.title || existing?.title || 'Tarefa adulta', 180);
      const historyId = uuidFromStableString(`adult-assigned-task-review-history:${taskId}`);
      const noteId = uuidFromStableString(`adult-assigned-task-review-note:${taskId}`);
      let historyEntry: any = null;
      let privateNote: any = null;

      const reviewTextLines = [
        'REVISÃO PROFISSIONAL DE TAREFA ADULTA',
        `Tarefa: ${taskTitle}`,
        reviewMetadata.protocolTitle ? `Protocolo: ${reviewMetadata.protocolTitle}` : '',
        reviewMetadata.domainName ? `Domínio: ${reviewMetadata.domainName}` : '',
        `Pontuação profissional: ${proScore} / ${maxScoreFromTask}`,
        patientEffort !== null ? `Energia após a atividade: ${patientEffort}% ${patientEffortEmoji || ''}`.trim() : '',
        sanitizeTextField(existing?.patient_comment, 4000) ? `Comentário do paciente: ${sanitizeTextField(existing?.patient_comment, 4000)}` : '',
        reviewNote ? `Anotação técnica: ${reviewNote}` : 'Anotação técnica: Sem anotação técnica registrada.'
      ].filter(Boolean);

      try {
        const historyPayload = cleanObject({
          id: historyId,
          patient_id: sanitizeString(data?.patient_id || existing?.patient_id, 120),
          patient_email: sanitizeEmail(data?.patient_email || existing?.patient_email),
          type: 'task',
          title: taskTitle,
          score: proScore,
          pro_score: proScore,
          max_score: maxScoreFromTask,
          energy: patientEffort,
          note: reviewNote,
          icon: sanitizeString(savedTaskData?.icon || existingTaskData?.icon, 40) || '📋',
          therapist_id: sanitizeString(req.session.user?.id || data?.professional_id || existing?.professional_id, 120),
          created_at: reviewedAt,
          date_group: dateGroupForClinic(reviewedAt, req.session.user),
          assigned_task_id: sanitizeString(taskId, 120),
          source: 'assigned_task_review',
          protocol_id: reviewMetadata.protocolId,
          protocol_title: reviewMetadata.protocolTitle,
          domain_id: reviewMetadata.domainId,
          domain_name: reviewMetadata.domainName,
          skill_id: reviewMetadata.skillId,
          skill_name: reviewMetadata.skillName,
          task_data: {
            ...savedTaskData,
            ...reviewMetadata,
            professionalScore: proScore,
            pro_score: proScore,
            maxScore: maxScoreFromTask,
            max_score: maxScoreFromTask,
            patientEffort,
            patient_effort: patientEffort,
            patientEffortEmoji,
            patient_effort_emoji: patientEffortEmoji,
            patientEffortLabel,
            patient_effort_label: patientEffortLabel,
            reviewNote
          }
        });
        const historyResult = await upsertHistoryWithSchemaFallback(historyPayload);
        if (historyResult.error) throw historyResult.error;
        historyEntry = historyResult.data || historyPayload;
      } catch (historyError: any) {
        console.warn('[AssignedTasks] Falha ao persistir revisão no histórico:', historyError?.message || String(historyError));
      }

      try {
        const notePayload = cleanObject({
          id: noteId,
          patient_id: sanitizeString(data?.patient_id || existing?.patient_id, 120),
          patient_email: sanitizeEmail(data?.patient_email || existing?.patient_email),
          text: reviewTextLines.join('\n'),
          content: reviewTextLines.join('\n'),
          visibility: 'private',
          type: 'private',
          subject: 'Revisão profissional - tarefa adulta',
          score: proScore,
          assigned_task_id: sanitizeString(taskId, 120),
          source: 'assigned_task_review',
          therapist_id: sanitizeString(req.session.user?.id, 120),
          user_id: sanitizeString(req.session.user?.id, 120),
          created_at: reviewedAt
        });
        const noteResult = await upsertNoteWithSchemaFallback(notePayload);
        if (noteResult.error) throw noteResult.error;
        privateNote = noteResult.data || notePayload;
      } catch (noteError: any) {
        console.warn('[AssignedTasks] Falha ao persistir anotação privada da revisão:', noteError?.message || String(noteError));
      }

      try {
        await supabase
          .from('adult_task_reviews')
          .upsert([cleanObject({
            assigned_task_id: sanitizeString(taskId, 120),
            clinic_id: sanitizeString(data?.clinic_id || existing?.clinic_id, 120),
            patient_id: sanitizeString(data?.patient_id || existing?.patient_id, 120),
            patient_email: sanitizeEmail(data?.patient_email || existing?.patient_email),
            professional_id: sanitizeString(req.session.user?.id || data?.professional_id || existing?.professional_id, 120),
            protocol_id: reviewMetadata.protocolId,
            protocol_title: reviewMetadata.protocolTitle,
            domain_id: reviewMetadata.domainId,
            domain_name: reviewMetadata.domainName,
            skill_id: reviewMetadata.skillId,
            skill_name: reviewMetadata.skillName,
            task_title: taskTitle,
            patient_effort: patientEffort,
            patient_effort_emoji: patientEffortEmoji,
            patient_effort_label: patientEffortLabel,
            patient_comment: sanitizeTextField(existing?.patient_comment, 4000),
            pro_score: proScore,
            max_score: maxScoreFromTask,
            pro_review_note: reviewNote,
            completed_at: sanitizeString(data?.completed_at || existing?.completed_at, 40) || null,
            reviewed_at: reviewedAt,
            history_id: historyEntry?.id || historyId,
            note_id: privateNote?.id || noteId,
            review_payload: {
              taskData: savedTaskData,
              metadata: reviewMetadata
            },
            updated_at: reviewedAt
          })], { onConflict: 'assigned_task_id' });
      } catch (reviewAuditError: any) {
        console.warn('[AssignedTasks] Falha ao persistir auditoria adult_task_reviews:', reviewAuditError?.message || String(reviewAuditError));
      }

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

      return res.json({
        success: true,
        data: normalizedReviewedTask,
        suggestedTask,
        historyEntry,
        privateNote,
        mastery_feedback: isVbMapp
          ? {
              protocol: 'VB-MAPP',
              consecutive_successes: nextConsecutive,
              criterion: taskMasteryCriterion,
              progress_text: `Sucesso consecutivo: ${Math.min(nextConsecutive, taskMasteryCriterion)} de ${taskMasteryCriterion}`
            }
          : null
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || String(error) });
    }
  });

  // Payments
  app.get('/api/payments', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const scopedClinicId = currentClinicId(req.session.user);
      let query = supabase
        .from('payments')
        .select('*')
        .order('payment_date', { ascending: false });

      if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
        query = query.eq('clinic_id', scopedClinicId);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.post('/api/payments', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const receiptUrl = sanitizeReceiptUrl(req.body?.receipt_url);
      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();
      const status = receiptUrl
        ? 'paid'
        : paymentStatuses.has(requestedStatus)
          ? requestedStatus
          : 'pending';
      const payloadBase = cleanObject({
        patient_id: sanitizeString(req.body?.patient_id, 120),
        patient_name: sanitizeString(req.body?.patient_name, 160),
        amount: asSafeNumber(req.body?.amount, 0, 1_000_000),
        payment_date: sanitizeDate(req.body?.payment_date) || new Date().toISOString().slice(0, 10),
        due_date: sanitizeDate(req.body?.due_date) || sanitizeDate(req.body?.dueDate),
        method: sanitizeString(req.body?.method, 80),
        status,
        receipt_url: receiptUrl,
        receipt_file_name: sanitizeString(req.body?.receipt_file_name || req.body?.receiptFileName, 240),
        receipt_content_type: sanitizeString(req.body?.receipt_content_type || req.body?.receiptContentType, 120),
        type: sanitizeString(req.body?.type, 80),
        insurance_name: sanitizeString(req.body?.insurance_name, 120),
        specialty: sanitizeString(req.body?.specialty, 120),
        base_amount: req.body?.base_amount !== undefined ? asSafeNumber(req.body?.base_amount, 0, 1_000_000) : undefined,
        additional_amount: req.body?.additional_amount !== undefined ? asSafeNumber(req.body?.additional_amount, 0, 1_000_000) : undefined,
        additional_scope: sanitizeString(req.body?.additional_scope, 40),
        is_recurring: Boolean(req.body?.is_recurring || req.body?.isRecurring),
        recurrence_group_id: sanitizeString(req.body?.recurrence_group_id || req.body?.recurrenceGroupId, 120),
        recurrence_index: req.body?.recurrence_index !== undefined ? asSafeNumber(req.body?.recurrence_index, 0, 10000) : undefined,
        recurrence_total: req.body?.recurrence_total !== undefined ? asSafeNumber(req.body?.recurrence_total, 0, 10000) : undefined,
        recurrence_frequency: sanitizeString(req.body?.recurrence_frequency || req.body?.recurrenceFrequency, 40),
        notes: sanitizeString(req.body?.notes, 1200),
        clinic_id: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        created_by: sanitizeString(req.session.user?.id, 120),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (!payloadBase.patient_id || payloadBase.amount === null) {
        return res.status(400).json({ error: 'patient_id e amount são obrigatórios.' });
      }

      let payload: Record<string, any> = { ...payloadBase };
      let data: any = null;
      while (Object.keys(payload).length > 0) {
        const result = await supabase
          .from('payments')
          .insert([payload])
          .select()
          .single();
        if (!result.error) {
          data = result.data;
          break;
        }
        const missingColumn = extractMissingColumnName(result.error);
        if (missingColumn && missingColumn in payload) {
          delete payload[missingColumn];
          continue;
        }
        throw result.error;
      }
      
      void persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Usuário', 180),
        title: status === 'paid' ? 'Pagamento registrado' : 'Cobrança registrada',
        content: `${status === 'paid' ? 'Pagamento' : 'Cobrança'} de ${payloadBase.amount} para paciente ${payloadBase.patient_name || payloadBase.patient_id} foi salvo (${status}).`,
        type: 'management'
      });
      res.json({ success: true, data: data || payloadBase });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.patch('/api/payments/:paymentId', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const paymentId = sanitizeString(req.params.paymentId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!paymentId) return res.status(400).json({ success: false, error: 'Pagamento inválido.' });

      const receiptUrl = sanitizeReceiptUrl(req.body?.receipt_url);
      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();
      const patchBase = cleanObject({
        amount: req.body?.amount !== undefined ? asSafeNumber(req.body?.amount, 0, 1_000_000) : undefined,
        payment_date: req.body?.payment_date !== undefined ? sanitizeDate(req.body?.payment_date) : undefined,
        due_date: req.body?.due_date !== undefined || req.body?.dueDate !== undefined
          ? sanitizeDate(req.body?.due_date) || sanitizeDate(req.body?.dueDate)
          : undefined,
        method: req.body?.method !== undefined ? sanitizeString(req.body?.method, 80) : undefined,
        status: receiptUrl
          ? 'paid'
          : paymentStatuses.has(requestedStatus)
            ? requestedStatus
            : undefined,
        receipt_url: receiptUrl || undefined,
        receipt_file_name: req.body?.receipt_file_name !== undefined || req.body?.receiptFileName !== undefined
          ? sanitizeString(req.body?.receipt_file_name || req.body?.receiptFileName, 240)
          : undefined,
        receipt_content_type: req.body?.receipt_content_type !== undefined || req.body?.receiptContentType !== undefined
          ? sanitizeString(req.body?.receipt_content_type || req.body?.receiptContentType, 120)
          : undefined,
        type: req.body?.type !== undefined ? sanitizeString(req.body?.type, 80) : undefined,
        insurance_name: req.body?.insurance_name !== undefined ? sanitizeString(req.body?.insurance_name, 120) : undefined,
        specialty: req.body?.specialty !== undefined ? sanitizeString(req.body?.specialty, 120) : undefined,
        base_amount: req.body?.base_amount !== undefined ? asSafeNumber(req.body?.base_amount, 0, 1_000_000) : undefined,
        additional_amount: req.body?.additional_amount !== undefined ? asSafeNumber(req.body?.additional_amount, 0, 1_000_000) : undefined,
        additional_scope: req.body?.additional_scope !== undefined ? sanitizeString(req.body?.additional_scope, 40) : undefined,
        is_recurring: req.body?.is_recurring !== undefined || req.body?.isRecurring !== undefined
          ? Boolean(req.body?.is_recurring || req.body?.isRecurring)
          : undefined,
        recurrence_group_id: req.body?.recurrence_group_id !== undefined || req.body?.recurrenceGroupId !== undefined
          ? sanitizeString(req.body?.recurrence_group_id || req.body?.recurrenceGroupId, 120)
          : undefined,
        recurrence_index: req.body?.recurrence_index !== undefined ? asSafeNumber(req.body?.recurrence_index, 0, 10000) : undefined,
        recurrence_total: req.body?.recurrence_total !== undefined ? asSafeNumber(req.body?.recurrence_total, 0, 10000) : undefined,
        recurrence_frequency: req.body?.recurrence_frequency !== undefined || req.body?.recurrenceFrequency !== undefined
          ? sanitizeString(req.body?.recurrence_frequency || req.body?.recurrenceFrequency, 40)
          : undefined,
        notes: req.body?.notes !== undefined ? sanitizeString(req.body?.notes, 1200) : undefined,
        updated_at: new Date().toISOString()
      });

      let safePatch: Record<string, any> = { ...patchBase };
      while (Object.keys(safePatch).length > 0) {
        let query = supabase
          .from('payments')
          .update(safePatch)
          .eq('id', paymentId);
        if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
        const result = await query.select('*').maybeSingle();
        if (!result.error) return res.json({ success: true, data: result.data || { id: paymentId, ...safePatch } });
        const missingColumn = extractMissingColumnName(result.error);
        if (missingColumn && missingColumn in safePatch) {
          delete safePatch[missingColumn];
          continue;
        }
        throw result.error;
      }

      return res.status(400).json({ success: false, error: 'Nada para atualizar.' });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/financial/professional-payments', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const scopedClinicId = currentClinicId(req.session.user);
      let query = supabase
        .from('professional_payments')
        .select('*')
        .order('due_date', { ascending: false });
      if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
        query = query.eq('clinic_id', scopedClinicId);
      }
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      res.json({ success: true, data: data || [] });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.post('/api/financial/professional-payments', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase() || 'pending';
      const payload = cleanObject({
        clinic_id: sanitizeString(currentClinicId(req.session.user), 120),
        professional_id: sanitizeString(req.body?.professional_id || req.body?.professionalId, 120),
        professional_name: sanitizeString(req.body?.professional_name || req.body?.professionalName, 180),
        amount: asSafeNumber(req.body?.amount, 0, 1_000_000),
        payment_date: sanitizeDate(req.body?.payment_date) || sanitizeDate(req.body?.paymentDate) || new Date().toISOString().slice(0, 10),
        due_date: sanitizeDate(req.body?.due_date) || sanitizeDate(req.body?.dueDate) || sanitizeDate(req.body?.payment_date) || new Date().toISOString().slice(0, 10),
        method: sanitizeString(req.body?.method, 80) || 'pix',
        status: paymentStatuses.has(requestedStatus) ? requestedStatus : 'pending',
        base_amount: req.body?.base_amount !== undefined ? asSafeNumber(req.body?.base_amount, 0, 1_000_000) : undefined,
        additional_amount: req.body?.additional_amount !== undefined ? asSafeNumber(req.body?.additional_amount, 0, 1_000_000) : undefined,
        additional_scope: sanitizeString(req.body?.additional_scope, 40),
        is_recurring: Boolean(req.body?.is_recurring || req.body?.isRecurring),
        recurrence_group_id: sanitizeString(req.body?.recurrence_group_id || req.body?.recurrenceGroupId, 120),
        recurrence_index: req.body?.recurrence_index !== undefined ? asSafeNumber(req.body?.recurrence_index, 0, 10000) : undefined,
        recurrence_total: req.body?.recurrence_total !== undefined ? asSafeNumber(req.body?.recurrence_total, 0, 10000) : undefined,
        recurrence_frequency: sanitizeString(req.body?.recurrence_frequency || req.body?.recurrenceFrequency, 40),
        notes: sanitizeString(req.body?.notes, 1200),
        created_by: sanitizeString(req.session.user?.id, 120),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (!payload.professional_name || payload.amount === null) {
        return res.status(400).json({ success: false, error: 'Profissional e valor são obrigatórios.' });
      }

      let safePayload: Record<string, any> = { ...payload };
      let data: any = null;
      while (Object.keys(safePayload).length > 0) {
        const { data: inserted, error } = await supabase
          .from('professional_payments')
          .insert([safePayload])
          .select()
          .single();
        if (!error) {
          data = inserted;
          break;
        }
        if (hasMissingFinancialSchema(error)) {
          return res.status(503).json({ success: false, error: 'Tabela professional_payments ainda não aplicada.' });
        }
        const missingColumn = extractMissingColumnName(error);
        if (missingColumn && missingColumn in safePayload) {
          delete safePayload[missingColumn];
          continue;
        }
        throw error;
      }
      res.json({ success: true, data: data || payload });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.patch('/api/financial/professional-payments/:paymentId', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const paymentId = sanitizeString(req.params.paymentId, 120);
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      if (!paymentId) return res.status(400).json({ success: false, error: 'Pagamento inválido.' });
      const requestedStatus = sanitizeString(req.body?.status, 40).toLowerCase();
      const patchBase = cleanObject({
        professional_id: req.body?.professional_id !== undefined || req.body?.professionalId !== undefined
          ? sanitizeString(req.body?.professional_id || req.body?.professionalId, 120)
          : undefined,
        professional_name: req.body?.professional_name !== undefined || req.body?.professionalName !== undefined
          ? sanitizeString(req.body?.professional_name || req.body?.professionalName, 180)
          : undefined,
        amount: req.body?.amount !== undefined ? asSafeNumber(req.body?.amount, 0, 1_000_000) : undefined,
        payment_date: req.body?.payment_date !== undefined || req.body?.paymentDate !== undefined
          ? sanitizeDate(req.body?.payment_date) || sanitizeDate(req.body?.paymentDate)
          : undefined,
        due_date: req.body?.due_date !== undefined || req.body?.dueDate !== undefined
          ? sanitizeDate(req.body?.due_date) || sanitizeDate(req.body?.dueDate)
          : undefined,
        method: req.body?.method !== undefined ? sanitizeString(req.body?.method, 80) : undefined,
        status: paymentStatuses.has(requestedStatus) ? requestedStatus : undefined,
        base_amount: req.body?.base_amount !== undefined ? asSafeNumber(req.body?.base_amount, 0, 1_000_000) : undefined,
        additional_amount: req.body?.additional_amount !== undefined ? asSafeNumber(req.body?.additional_amount, 0, 1_000_000) : undefined,
        additional_scope: req.body?.additional_scope !== undefined ? sanitizeString(req.body?.additional_scope, 40) : undefined,
        notes: req.body?.notes !== undefined ? sanitizeString(req.body?.notes, 1200) : undefined,
        updated_at: new Date().toISOString()
      });

      let safePatch: Record<string, any> = { ...patchBase };
      while (Object.keys(safePatch).length > 0) {
        let query = supabase
          .from('professional_payments')
          .update(safePatch)
          .eq('id', paymentId);
        if (!hasGlobalClinicAccess(req.session.user) && clinicId) query = query.eq('clinic_id', clinicId);
        const result = await query.select('*').maybeSingle();
        if (!result.error) return res.json({ success: true, data: result.data || { id: paymentId, ...safePatch } });
        if (hasMissingFinancialSchema(result.error)) {
          return res.status(503).json({ success: false, error: 'Tabela professional_payments ainda não aplicada.' });
        }
        const missingColumn = extractMissingColumnName(result.error);
        if (missingColumn && missingColumn in safePatch) {
          delete safePatch[missingColumn];
          continue;
        }
        throw result.error;
      }
      return res.status(400).json({ success: false, error: 'Nada para atualizar.' });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
    }
  });

  app.get('/api/financial/entries', checkAuth, requireRoles('coordinator', 'receptionist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const scopedClinicId = currentClinicId(req.session.user);
      let query = supabase
        .from('clinic_financial_entries')
        .select('*')
        .order('occurred_on', { ascending: false });
      if (!hasGlobalClinicAccess(req.session.user) && scopedClinicId) {
        query = query.eq('clinic_id', scopedClinicId);
      }
      const { data, error } = await query;
      if (error) {
        if (hasMissingFinancialSchema(error)) return res.json({ success: true, data: [] });
        throw error;
      }
      res.json({ success: true, data: data || [] });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erro interno do servidor.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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

      return res.json({
        success: true,
        data: {
          source: 'unconfigured',
          summary: {
            revenueGross: 0,
            deductions: 0,
            revenueNet: 0,
            variableCosts: 0,
            fixedCosts: 0,
            contributionMarginValue: 0,
            contributionMarginPct: 0,
            ebitda: 0,
            ebitdaPct: 0,
            delinquencyAmount: 0
          },
          monthly: [],
          byPlan: [],
          topCustomers: [],
          delinquentCustomers: []
        }
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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
      return res.json({
        success: true,
        skipped: true,
        message: 'Bootstrap financeiro fictício desativado. Cadastre receitas, custos e pagamentos reais para popular o DRE.'
      });
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
          if (revenueInsertError && hasMissingFinancialSchema(revenueInsertError)) {
            return res.json({
              success: true,
              skipped: true,
              message: 'Schema financeiro ainda nao aplicado. Painel usando fallback automatico.'
            });
          }
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
        if (costsInsertError && hasMissingFinancialSchema(costsInsertError)) {
          return res.json({
            success: true,
            skipped: true,
            message: 'Schema financeiro ainda nao aplicado. Painel usando fallback automatico.'
          });
        }
        if (costsInsertError) throw costsInsertError;
      }

      return res.json({
        success: true,
        message: 'Base financeira inicial criada com sucesso.'
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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

  const checkPlatformAdmin = (req: any, res: any, next: any) => {
    const role = sanitizeString(req.session.user?.role, 40);
    if (role === 'admin' || role === 'owner') {
      return next();
    }
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem acessar esta rota.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.post('/api/admin/grant-complimentary-plan', checkAuth, checkPlatformAdmin, async (req: any, res) => {
    try {
      const email = sanitizeEmail(req.body?.email);
      const requestedPlan = normalizeProfessionalPlan(req.body?.planName || 'Essencial');
      const note = sanitizeString(req.body?.note, 500);

      if (!email) {
        return res.status(400).json({ success: false, error: 'Informe um e-mail valido.' });
      }
      if (!requestedPlan) {
        return res.status(400).json({ success: false, error: 'Plano profissional invalido.' });
      }

      const { data: existingUser, error: findError } = await supabase
        .from('users')
        .select('id, email, name, role, clinic_id, subscription_status, plan_name')
        .eq('email', email)
        .maybeSingle();
      if (findError) throw findError;
      if (!existingUser?.id) {
        return res.status(404).json({
          success: false,
          error: 'Cadastro nao encontrado. Primeiro faca o cadastro dela na landing page ate a etapa de pagamento; depois conceda o acesso gratuito aqui.'
        });
      }

      if (sanitizeString(existingUser.role, 40).toLowerCase() === 'patient') {
        return res.status(409).json({ success: false, error: 'Este e-mail esta cadastrado como paciente.' });
      }

      const userId = sanitizeString(existingUser.id, 120);
      const actor = req.session.user;
      let updatePayload: Record<string, any> = cleanObject({
        role: 'coordinator',
        clinic_id: userId,
        subscription_status: 'active',
        plan_name: requestedPlan,
        plan_price: 0,
        billing_source: 'complimentary',
        complimentary_plan_granted_at: new Date().toISOString(),
        complimentary_plan_granted_by: sanitizeString(actor?.id, 120) || null,
        complimentary_plan_note: note || `Acesso gratuito concedido no plano ${requestedPlan}.`,
        updated_at: new Date().toISOString()
      });

      const removedColumns = new Set<string>();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const { error: updateError } = await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', userId);
        if (!updateError) break;

        const missingColumn = extractMissingColumnName(updateError);
        if (!missingColumn || removedColumns.has(missingColumn) || !(missingColumn in updatePayload)) {
          throw updateError;
        }
        removedColumns.add(missingColumn);
        delete updatePayload[missingColumn];
      }

      await ensureClinicAndMembershipForCoordinator(userId, existingUser.name || null);

      let activationEmailSent = false;
      try {
        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId);
        if (!authError) {
          const authUser = authData?.user;
          const isEmailConfirmed = Boolean((authUser as any)?.email_confirmed_at || (authUser as any)?.confirmed_at);
          const targetEmail = sanitizeEmail(authUser?.email) || email;

          if (!isEmailConfirmed && targetEmail) {
            const activationLink =
              (await generateSupabaseActionLink({
                type: 'signup',
                email: targetEmail,
                redirectTo: getActivationRedirectUrl('coordinator', targetEmail)
              })) || getActivationRedirectUrl('coordinator', targetEmail);

            const activationEmail = buildActivationEmailTemplate({
              nome: sanitizeString(existingUser.name || authUser?.user_metadata?.full_name || targetEmail.split('@')[0], 180),
              link_ativacao: activationLink,
              perfil: 'professional'
            });

            activationEmailSent = await sendTransactionalEmailSafe({
              to: targetEmail,
              subject: activationEmail.subject,
              html: activationEmail.html,
              context: 'complimentary_professional_activation',
              from: OFFICIAL_FROM_CONTACT,
              replyTo: OFFICIAL_TRANSACTIONAL_REPLY_TO,
              templateKind: 'welcome_professional',
              templateData: {
                nome: sanitizeString(existingUser.name || authUser?.user_metadata?.full_name || targetEmail.split('@')[0], 180),
                link_ativacao: activationLink
              },
              metadata: {
                userId,
                email: maskEmail(targetEmail),
                planName: requestedPlan,
                billingSource: 'complimentary'
              }
            });
          }
        }
      } catch (activationError: any) {
        console.warn('[Admin] complimentary activation email failed:', activationError?.message || String(activationError));
      }

      await persistIdentityAuditLog({
        title: 'Plano gratuito concedido',
        content: `Acesso gratuito ${requestedPlan} concedido para ${maskEmail(email)} por ${maskEmail(actor?.email)}. E-mail de ativacao ${activationEmailSent ? 'enviado' : 'nao enviado ou ja confirmado'}.${note ? ` Observacao: ${note}` : ''}`,
        identifier: email,
        channel: 'admin',
        userId,
        status: 'active'
      });

      return res.json({
        success: true,
        data: {
          userId,
          email,
          planName: requestedPlan,
          subscriptionStatus: 'active',
          planPrice: 0,
          activationEmailSent
        }
      });
    } catch (error: any) {
      console.error('[Admin] grant complimentary plan error:', {
        message: error?.message || String(error),
        code: error?.code || null,
        details: error?.details || null
      });
      return res.status(500).json({
        success: false,
        error: error?.message || 'Nao foi possivel conceder o acesso gratuito.'
      });
    }
  });

  app.post('/api/protocol-import-requests', checkAuth, async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 28 * 1024 * 1024, 'Evidencias do protocolo')) return;

      const user = req.session.user;
      const evidenceMode = sanitizeString(req.body?.evidenceMode, 40) || 'screenshots';
      const protocolName = sanitizeString(req.body?.protocolName, 180);
      const applicableAgeGroup = sanitizeString(req.body?.applicableAgeGroup, 40) || 'all';
      const ageMin = asSafeNumber(req.body?.ageMin, 0, 120);
      const rawAgeMax = req.body?.ageMax;
      const ageMax = rawAgeMax === null || rawAgeMax === undefined || rawAgeMax === ''
        ? null
        : asSafeNumber(rawAgeMax, 0, 120);
      const totalPages = asSafeNumber(req.body?.totalPages, 1, 5000) || 0;
      const requestedCoverageMaxPage = asSafeNumber(req.body?.coverageMaxPage, 1, 5000) || 0;
      const fullProtocolConfirmed = Boolean(req.body?.fullProtocolConfirmed);
      const rightsAccepted = Boolean(req.body?.rightsAccepted);
      const rawScreenshotChallenges = Array.isArray(req.body?.screenshotChallenges) ? req.body.screenshotChallenges : [];

      if (evidenceMode !== 'screenshots') {
        return res.status(400).json({ success: false, error: 'A Verto agora aceita somente validacao por screenshots neste fluxo.' });
      }

      if (!protocolName) {
        return res.status(400).json({ success: false, error: 'Informe o nome do protocolo.' });
      }
      if (!fullProtocolConfirmed || !rightsAccepted) {
        return res.status(400).json({ success: false, error: 'Confirme que o protocolo esta completo e que possui direito de uso.' });
      }
      if (ageMin === null || (ageMax !== null && ageMax < ageMin)) {
        return res.status(400).json({ success: false, error: 'Informe uma idade valida para o protocolo.' });
      }

      const maxAllowedCoveragePage = totalPages ? Math.max(1, Math.ceil(totalPages * 0.3)) : 100;
      const coverageMaxPage = requestedCoverageMaxPage || maxAllowedCoveragePage;
      if (coverageMaxPage > maxAllowedCoveragePage + 1) {
        return res.status(400).json({ success: false, error: 'A janela de paginas solicitadas nao confere com a regra de amostragem.' });
      }

      const screenshotChallenges = rawScreenshotChallenges
        .slice(0, 6)
        .map((item: any, index: number) => {
          const pageNumber = asSafeNumber(item?.pageNumber, 1, maxAllowedCoveragePage) || 0;
          const prompt = sanitizeString(item?.prompt, 240) || `Envie um print da pagina ${pageNumber}.`;
          const fileName = sanitizeString(item?.fileName, 240) || `pagina-${pageNumber}.png`;
          const fileType = sanitizeString(item?.fileType, 120) || 'image/png';
          const fileSize = asSafeNumber(item?.fileSize, 0, 8_000_000) || 0;
          const dataUrl = isAllowedScreenshotDataUrl(item?.dataUrl)
            ? sanitizeString(item.dataUrl, 8_000_000)
            : null;
          return pageNumber && dataUrl ? {
            id: `shot-${index + 1}`,
            pageNumber,
            prompt,
            fileName,
            fileType,
            fileSize,
            dataUrl
          } : null;
        })
        .filter(Boolean) as Array<{
          id: string;
          pageNumber: number;
          prompt: string;
          fileName: string;
          fileType: string;
          fileSize: number;
          dataUrl: string;
        }>;

      if (screenshotChallenges.length === 0) {
        return res.status(400).json({ success: false, error: 'Envie ao menos um screenshot valido em PNG, JPG ou WEBP.' });
      }

      const declaredPages = new Set<number>();
      for (const challenge of screenshotChallenges) {
        if (declaredPages.has(challenge.pageNumber)) {
          return res.status(400).json({ success: false, error: 'As paginas solicitadas precisam ser unicas.' });
        }
        declaredPages.add(challenge.pageNumber);
      }

      const candidate = identifyVertoProtocolCandidate(protocolName);
      const clinicId = currentClinicId(user);
      const requestId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const evidenceSummary = buildScreenshotEvidenceSummary({
        totalPages: totalPages || null,
        coverageMaxPage: coverageMaxPage || null,
        applicableAgeGroup,
        ageMin,
        ageMax,
        screenshots: screenshotChallenges
      });
      const screenshotEvidence = {
        mode: 'screenshots',
        applicableAgeGroup,
        ageMin,
        ageMax,
        totalPages: totalPages || null,
        coverageMaxPage,
        screenshots: screenshotChallenges
      };
      const totalEvidenceBytes = screenshotChallenges.reduce((sum, item) => sum + (item.fileSize || 0), 0);
      const payload = sanitizeClinicalPayload({
        id: requestId,
        clinicId,
        requesterUserId: user?.id,
        requesterName: user?.name || user?.email,
        requesterEmail: user?.email,
        evidenceMode: 'screenshots',
        applicableAgeGroup,
        ageMin,
        ageMax,
        protocolName,
        fileName: `${protocolName}.screenshots`,
        fileType: 'screenshots',
        fileSize: totalEvidenceBytes,
        status: 'pending',
        quarantineStatus: 'review_ready',
        scanStatus: 'clean',
        safePreviewStatus: 'generated',
        rawFileAccess: 'blocked',
        canonicalKey: candidate.canonicalKey,
        canonicalName: candidate.canonicalName,
        confidence: candidate.confidence,
        fullProtocolConfirmed,
        rightsAccepted,
        safePreviewText: evidenceSummary,
        scanReport: {
          engine: 'verto-screenshot-intake',
          scannedAt: nowIso,
          evidence: screenshotEvidence,
          flags: [],
          riskNote: 'Imagens raster reduzem bastante o risco em relacao ao PDF bruto, mas ainda exigem revisao humana.'
        },
        createdAt: nowIso
      });
      const auditPayload = sanitizeClinicalPayload({
        ...payload,
        scanReport: {
          engine: 'verto-screenshot-intake',
          scannedAt: nowIso,
            evidence: {
              mode: 'screenshots',
            applicableAgeGroup,
            ageMin,
            ageMax,
            totalPages: totalPages || null,
            coverageMaxPage,
            screenshots: screenshotChallenges.map((item) => ({
              pageNumber: item.pageNumber,
              prompt: item.prompt,
              fileName: item.fileName,
              fileType: item.fileType,
              fileSize: item.fileSize
            }))
          },
          flags: [],
          riskNote: 'Imagens raster reduzem bastante o risco em relacao ao PDF bruto, mas ainda exigem revisao humana.'
        },
        hasFileData: false,
        hasScreenshotEvidence: screenshotChallenges.length > 0,
        previewImage: {
          dataUrl: screenshotChallenges[0]?.dataUrl || null
        }
      });

      let storedInTable = false;
      try {
        const insertPayload: Record<string, any> = {
          id: requestId,
          clinic_id: isUuid(clinicId) ? clinicId : null,
          requester_user_id: sanitizeString(user?.id, 120) || null,
          requester_name: sanitizeString(user?.name || user?.email, 180),
          requester_email: sanitizeEmail(user?.email),
          protocol_name: protocolName,
          file_name: `${protocolName}.screenshots`,
          file_type: 'screenshots',
          file_size: totalEvidenceBytes,
          file_data_url: screenshotChallenges[0]?.dataUrl || null,
          status: 'pending',
          quarantine_status: 'review_ready',
          scan_status: 'clean',
          safe_preview_status: 'generated',
          raw_file_access: 'blocked',
          safe_preview_text: evidenceSummary,
          scan_report: {
            engine: 'verto-screenshot-intake',
            scannedAt: nowIso,
            evidence: screenshotEvidence,
            flags: [],
            riskNote: 'Imagens raster reduzem bastante o risco em relacao ao PDF bruto, mas ainda exigem revisao humana.'
          },
          suggested_canonical_key: candidate.canonicalKey,
          suggested_canonical_name: candidate.canonicalName,
          suggested_confidence: candidate.confidence,
          rights_accepted: rightsAccepted,
          full_protocol_confirmed: fullProtocolConfirmed,
          created_at: nowIso,
          updated_at: nowIso
        };
        let insertError: any = null;
        const removedProtocolColumns = new Set<string>();
        for (let attempt = 0; attempt < 10; attempt += 1) {
          ({ error: insertError } = await supabase.from('protocol_import_requests').insert([insertPayload]));
          if (!insertError) break;

          const missingColumn = extractMissingColumnName(insertError);
          if (!missingColumn || removedProtocolColumns.has(missingColumn) || !(missingColumn in insertPayload)) {
            break;
          }
          removedProtocolColumns.add(missingColumn);
          delete insertPayload[missingColumn];
        }
        storedInTable = !insertError;
        if (insertError) {
          console.warn('[Protocol Import] table insert fallback:', insertError.message || insertError);
        }
      } catch (tableError: any) {
        console.warn('[Protocol Import] table unavailable fallback:', tableError?.message || String(tableError));
      }

      await persistActivityLog({
        userId: sanitizeString(user?.id, 120),
        clinicId: sanitizeString(clinicId, 120),
        actorName: sanitizeString(user?.name || user?.email || 'Profissional', 180),
        title: 'Solicitacao de protocolo importado',
        content: `Protocolo ${protocolName} enviado para validacao. Sugestao Verto: ${candidate.canonicalName}.`,
        type: 'protocol_import_request',
        actionType: 'protocol_import_requested',
        payloadDetails: JSON.stringify(auditPayload)
      });

      return res.json({
        success: true,
        data: {
          id: requestId,
          status: 'pending',
          suggestedCanonicalName: candidate.canonicalName,
          suggestedConfidence: candidate.confidence,
          screenshotCount: screenshotChallenges.length,
          storedInTable
        }
      });
    } catch (error: any) {
      console.error('[Protocol Import] request error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Nao foi possivel enviar o protocolo para validacao.' });
    }
  });

  app.get('/api/protocol-import-requests', checkAuth, async (req: any, res) => {
    try {
      const user = req.session.user;
      const userId = sanitizeString(user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      let requests: any[] = [];

      try {
        let query = supabase
          .from('protocol_import_requests')
          .select('*')
          .gte('created_at', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('created_at', { ascending: false })
          .limit(50);

        if (isUuid(clinicId)) {
          query = query.eq('clinic_id', clinicId);
        } else if (userId) {
          query = query.eq('requester_user_id', userId);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          requests = data.map((row: any) => {
            const scanReport = parseStoredJsonObject(row.scan_report);
            return {
              id: sanitizeString(row.id, 120),
              protocolName: sanitizeString(row.protocol_name, 180),
              fileName: sanitizeString(row.file_name, 240),
              status: sanitizeString(row.status, 40) || 'pending',
              canonicalKey: sanitizeString(row.approved_canonical_key || row.suggested_canonical_key, 180),
              canonicalName: sanitizeString(row.approved_canonical_name || row.suggested_canonical_name, 180),
              confidence: Number(row.suggested_confidence || 0),
              applicableAgeGroup: sanitizeString(scanReport?.evidence?.applicableAgeGroup, 40) || 'all',
              ageMin: asSafeNumber(scanReport?.evidence?.ageMin, 0, 120),
              ageMax: scanReport?.evidence?.ageMax === null || scanReport?.evidence?.ageMax === undefined
                ? null
                : asSafeNumber(scanReport?.evidence?.ageMax, 0, 120),
              createdAt: sanitizeString(row.created_at, 80),
              reviewedAt: sanitizeString(row.reviewed_at, 80) || null
            };
          });
        }
      } catch {
        requests = [];
      }

      if (requests.length === 0) {
        const { data: logs } = await supabase
          .from('activity_logs')
          .select('payload_details, timestamp')
          .eq('type', 'protocol_import_request')
          .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('timestamp', { ascending: false })
          .limit(50);

        requests = (logs || []).map((log: any) => {
          try {
            const payload = JSON.parse(String(log.payload_details || '{}'));
            const requesterUserId = sanitizeString(payload.requesterUserId, 120);
            const payloadClinicId = sanitizeString(payload.clinicId, 120);
            if ((userId && requesterUserId === userId) || (clinicId && payloadClinicId === clinicId)) {
              return {
                id: sanitizeString(payload.id, 120),
                protocolName: sanitizeString(payload.protocolName, 180),
                fileName: sanitizeString(payload.fileName, 240),
                status: sanitizeString(payload.status, 40) || 'pending',
                canonicalName: sanitizeString(payload.canonicalName, 180),
                confidence: Number(payload.confidence || 0),
                applicableAgeGroup: sanitizeString(payload.applicableAgeGroup, 40) || 'all',
                ageMin: asSafeNumber(payload.ageMin, 0, 120),
                ageMax: payload.ageMax === null || payload.ageMax === undefined ? null : asSafeNumber(payload.ageMax, 0, 120),
                createdAt: sanitizeString(payload.createdAt || log.timestamp, 80),
                reviewedAt: null
              };
            }
            return null;
          } catch {
            return null;
          }
        }).filter(Boolean);
      }

      const accessMap = await loadProtocolAccessMap();
      const scopeKey = buildProtocolAccessScopeKey({ clinicId, requesterUserId: userId, requesterEmail: user?.email });
      const authorizedProtocolKeys = accessMap.get(scopeKey) || [];
      const existingAuthorizedKeys = new Set(
        requests
          .filter((request) => String(request.status || '').toLowerCase() === 'approved')
          .map((request) => normalizeApprovedProtocolKey(request.canonicalKey || identifyVertoProtocolCandidate(request.canonicalName).canonicalKey))
      );
      for (const protocolKey of authorizedProtocolKeys) {
        if (existingAuthorizedKeys.has(protocolKey)) continue;
        const protocol = VERTO_PROTOCOL_BY_KEY.get(protocolKey);
        if (!protocol) continue;
        requests.unshift({
          id: `access-${scopeKey}-${protocolKey}`,
          protocolName: protocol.name,
          fileName: 'Acervo Verto',
          status: 'approved',
          canonicalKey: protocol.key,
          canonicalName: protocol.name,
          confidence: 1,
          applicableAgeGroup: protocol.applicableAgeGroup,
          ageMin: protocol.ageMin,
          ageMax: protocol.ageMax,
          completionPercent: protocol.completionPercent,
          statusLabel: protocol.statusLabel,
          createdAt: new Date().toISOString(),
          reviewedAt: new Date().toISOString(),
          fromProtocolAccess: true
        });
      }

      return res.json({ success: true, data: requests });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel listar seus protocolos importados.' });
    }
  });

  app.delete('/api/protocol-import-requests/:requestId', checkAuth, async (req: any, res) => {
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const user = req.session.user;
      const userId = sanitizeString(user?.id, 120);
      const clinicId = sanitizeString(currentClinicId(user), 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      let query = supabase
        .from('protocol_import_requests')
        .delete()
        .eq('id', requestId);

      if (isUuid(clinicId)) {
        query = query.eq('clinic_id', clinicId);
      } else if (userId) {
        query = query.eq('requester_user_id', userId);
      } else {
        return res.status(403).json({ success: false, error: 'Acesso negado.' });
      }

      const { error } = await query;
      if (error) throw error;

      void persistActivityLog({
        type: 'protocol_import_request_deleted',
        title: 'Solicitacao de protocolo excluida',
        details: `Solicitacao de protocolo ${requestId} excluida pelo solicitante.`,
        userId,
        clinicId,
        payload: { requestId }
      });

      return res.json({ success: true });
    } catch (error: any) {
      logRouteDbError('/api/protocol-import-requests/:requestId [DELETE]', error, {
        requestId: sanitizeString(req.params.requestId, 120)
      });
      return res.status(500).json({ success: false, error: 'Nao foi possivel excluir a solicitacao de protocolo.' });
    }
  });

  app.get('/api/admin/protocol-import-requests', checkAuth, checkPlatformAdmin, async (_req: any, res) => {
    try {
      let requests: any[] = [];
      try {
        const { data, error } = await supabase
          .from('protocol_import_requests')
          .select('*')
          .gte('created_at', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('created_at', { ascending: false })
          .limit(200);
        if (!error && Array.isArray(data)) {
          requests = data.map((row: any) => {
            const scanReport = parseStoredJsonObject(row.scan_report);
            return {
              id: sanitizeString(row.id, 120),
              clinicId: sanitizeString(row.clinic_id, 120) || null,
              requesterUserId: sanitizeString(row.requester_user_id, 120) || null,
              requesterName: sanitizeString(row.requester_name, 180),
              requesterEmail: sanitizeEmail(row.requester_email),
              protocolName: sanitizeString(row.protocol_name, 180),
              fileName: sanitizeString(row.file_name, 240),
              fileType: sanitizeString(row.file_type, 120),
              fileSize: Number(row.file_size || 0),
              status: sanitizeString(row.status, 40) || 'pending',
              canonicalKey: sanitizeString(row.approved_canonical_key || row.suggested_canonical_key, 180),
              canonicalName: sanitizeString(row.approved_canonical_name || row.suggested_canonical_name, 180),
              confidence: Number(row.suggested_confidence || 0),
            hasFileData: Boolean(row.file_data_url),
            fileDataUrl: isAllowedScreenshotDataUrl(row.file_data_url) ? sanitizeString(row.file_data_url, 8_000_000) : null,
              quarantineStatus: sanitizeString(row.quarantine_status, 40) || 'quarantined',
              scanStatus: sanitizeString(row.scan_status, 40) || 'pending',
              safePreviewStatus: sanitizeString(row.safe_preview_status, 40) || 'not_generated',
              rawFileAccess: sanitizeString(row.raw_file_access, 40) || 'blocked',
              safePreviewText: sanitizeSafePreviewText(row.safe_preview_text || '', 4000) || null,
              scanReport: sanitizeClinicalPayload(scanReport),
              createdAt: sanitizeString(row.created_at, 80),
              reviewedAt: sanitizeString(row.reviewed_at, 80) || null
            };
          });
        }
      } catch {
        // fallback below
      }

      if (requests.length === 0) {
        const { data: logs } = await supabase
          .from('activity_logs')
          .select('id, payload_details, timestamp')
          .eq('type', 'protocol_import_request')
          .eq('is_active', true)
          .is('deleted_at', null)
          .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('timestamp', { ascending: false })
          .limit(200);
        requests = (logs || []).map((log: any) => {
          try {
            const payload = JSON.parse(String(log.payload_details || '{}'));
            return {
              id: sanitizeString(payload.id || log.id, 120),
              clinicId: sanitizeString(payload.clinicId, 120) || null,
              requesterUserId: sanitizeString(payload.requesterUserId, 120) || null,
              requesterName: sanitizeString(payload.requesterName, 180),
              requesterEmail: sanitizeEmail(payload.requesterEmail),
              protocolName: sanitizeString(payload.protocolName, 180),
              fileName: sanitizeString(payload.fileName, 240),
              fileType: sanitizeString(payload.fileType, 120),
              fileSize: Number(payload.fileSize || 0),
              createdAt: sanitizeString(payload.createdAt || log.timestamp, 80),
              status: sanitizeString(payload.status, 40) || 'pending',
              canonicalKey: sanitizeString(payload.canonicalKey, 180),
              canonicalName: sanitizeString(payload.canonicalName, 180),
              confidence: Number(payload.confidence || 0),
              hasFileData: Boolean(payload.hasFileData),
              fileDataUrl: isAllowedScreenshotDataUrl(payload.previewImage?.dataUrl) ? sanitizeString(payload.previewImage.dataUrl, 8_000_000) : null,
              quarantineStatus: sanitizeString(payload.quarantineStatus, 40) || 'quarantined',
              scanStatus: sanitizeString(payload.scanStatus, 40) || 'pending',
              safePreviewStatus: sanitizeString(payload.safePreviewStatus, 40) || 'not_generated',
              rawFileAccess: 'blocked',
              safePreviewText: sanitizeSafePreviewText(payload.safePreviewText || '', 4000) || null,
              scanReport: sanitizeClinicalPayload(parseStoredJsonObject(payload.scanReport))
            };
          } catch {
            return null;
          }
        }).filter(Boolean);
      }

      try {
        const { data: scanLogs } = await supabase
          .from('activity_logs')
          .select('payload_details, timestamp')
          .eq('type', 'protocol_import_review')
          .eq('is_active', true)
          .is('deleted_at', null)
          .gte('timestamp', VERTO_PROTOCOL_PANEL_RESET_AT)
          .order('timestamp', { ascending: false })
          .limit(300);
        const scansByRequestId = new Map<string, any>();
        for (const log of scanLogs || []) {
          try {
            const payload = JSON.parse(String((log as any).payload_details || '{}'));
            const requestId = sanitizeString(payload.requestId, 120);
            if (!requestId || scansByRequestId.has(requestId) || !payload.scanStatus) continue;
            scansByRequestId.set(requestId, {
              scanStatus: sanitizeString(payload.scanStatus, 40) || 'pending',
              quarantineStatus: sanitizeString(payload.quarantineStatus, 40) || 'quarantined',
              safePreviewStatus: sanitizeString(payload.safePreviewStatus, 40) || 'not_generated',
              rawFileAccess: 'blocked',
              safePreviewText: sanitizeSafePreviewText(payload.safePreviewText || '', 4000) || null,
              scanReport: sanitizeClinicalPayload(parseStoredJsonObject(payload.scanReport)),
              scannedAt: sanitizeString((log as any).timestamp, 80)
            });
          } catch {
            // ignore malformed log payload
          }
        }
        if (scansByRequestId.size) {
          requests = requests.map((request) => {
            const scan = scansByRequestId.get(sanitizeString(request.id, 120));
            return scan ? { ...request, ...scan } : request;
          });
        }
      } catch {
        // The queue must remain visible even if scan log hydration is unavailable.
      }

      const protocolAccessMap = await loadProtocolAccessMap();
      requests = requests.map((request) => {
        const scopeKey = buildProtocolAccessScopeKey({
          clinicId: request.clinicId,
          requesterUserId: request.requesterUserId,
          requesterEmail: request.requesterEmail
        });
        return {
          ...request,
          accessScopeKey: scopeKey,
          authorizedProtocolKeys: protocolAccessMap.get(scopeKey) || []
        };
      });

      return res.json({ success: true, data: requests });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel listar solicitacoes de protocolos.' });
    }
  });

  app.post('/api/admin/protocol-access', checkAuth, checkPlatformAdmin, async (req: any, res) => {
    try {
      const scopeKey = sanitizeString(req.body?.scopeKey, 220);
      const protocolKey = normalizeApprovedProtocolKey(req.body?.protocolKey);
      const enabled = Boolean(req.body?.enabled);
      const requestId = sanitizeString(req.body?.requestId, 120);
      if (!scopeKey || !VERTO_PROTOCOL_BY_KEY.has(protocolKey)) {
        return res.status(400).json({ success: false, error: 'Informe o acervo e o protocolo Verto.' });
      }

      const accessMap = await loadProtocolAccessMap();
      const currentKeys = new Set(accessMap.get(scopeKey) || []);
      if (enabled) currentKeys.add(protocolKey);
      else currentKeys.delete(protocolKey);
      const protocolKeys = Array.from(currentKeys).filter((key) => VERTO_PROTOCOL_BY_KEY.has(key));
      const changedProtocol = VERTO_PROTOCOL_BY_KEY.get(protocolKey);

      if (enabled && requestId && changedProtocol) {
        try {
          await supabase
            .from('protocol_import_requests')
            .update({
              status: 'approved',
              approved_canonical_key: changedProtocol.key,
              approved_canonical_name: changedProtocol.name,
              reviewed_by: sanitizeString(req.session.user?.id, 120) || null,
              reviewed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', requestId);
        } catch {
          // The acervo is the source of truth; keep it updated even if the legacy request row is unavailable.
        }
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Acervo de protocolos atualizado',
        content: `Acervo ${scopeKey} atualizado com ${protocolKeys.length} protocolo(s).`,
        type: 'protocol_access_updated',
        actionType: 'protocol_access_updated',
        payloadDetails: JSON.stringify({
          scopeKey,
          protocolKeys,
          changedProtocolKey: protocolKey,
          requestId: requestId || null,
          enabled,
          updatedAt: new Date().toISOString()
        })
      });

      return res.json({
        success: true,
        data: {
          scopeKey,
          protocolKeys,
          requestStatus: enabled ? 'approved' : undefined,
          canonicalKey: changedProtocol?.key || protocolKey,
          canonicalName: changedProtocol?.name || protocolKey
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel atualizar o acervo de protocolos.' });
    }
  });

  app.post('/api/admin/protocol-import-requests/:requestId/approve', checkAuth, checkPlatformAdmin, async (req: any, res) => {
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      const canonicalName = sanitizeString(req.body?.canonicalName, 180);
      if (!requestId || !canonicalName) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao e o protocolo Verto aprovado.' });
      }
      const requestedCanonicalKey = normalizeApprovedProtocolKey(req.body?.canonicalKey);
      const inferredCanonicalKey = identifyVertoProtocolCandidate(canonicalName).canonicalKey;
      const canonicalKey = VERTO_PROTOCOL_BY_KEY.has(requestedCanonicalKey)
        ? requestedCanonicalKey
        : inferredCanonicalKey;
      if (!VERTO_PROTOCOL_BY_KEY.has(canonicalKey)) {
        return res.status(400).json({ success: false, error: 'Selecione um protocolo existente na Biblioteca Verto.' });
      }

      let updatedTable = false;
      try {
        const { data: currentRequest } = await supabase
          .from('protocol_import_requests')
          .select('scan_status, quarantine_status, file_type, file_data_url, scan_report')
          .eq('id', requestId)
          .maybeSingle();
        const currentScanReport = parseStoredJsonObject((currentRequest as any)?.scan_report);
        const screenshotEvidence = currentScanReport?.evidence?.mode === 'screenshots'
          ? (currentScanReport?.evidence?.screenshots || [])
          : [];
        const hasScreenshotImage = screenshotEvidence.some((shot: any) => isAllowedScreenshotDataUrl(shot?.dataUrl))
          || isAllowedScreenshotDataUrl((currentRequest as any)?.file_data_url);
        const canApproveScreenshotEvidence = sanitizeString((currentRequest as any)?.file_type, 80) === 'screenshots' && hasScreenshotImage;
        if ((currentRequest as any)?.scan_status && (currentRequest as any)?.scan_status !== 'clean' && !canApproveScreenshotEvidence) {
          return res.status(409).json({
            success: false,
            error: 'Este protocolo ainda nao passou por uma varredura segura limpa.'
          });
        }
        const { error } = await supabase
          .from('protocol_import_requests')
          .update({
            status: 'approved',
            approved_canonical_key: canonicalKey,
            approved_canonical_name: canonicalName,
            reviewed_by: sanitizeString(req.session.user?.id, 120) || null,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId);
        updatedTable = !error;
      } catch {
        updatedTable = false;
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Protocolo aprovado para uso',
        content: `Solicitacao ${requestId} aprovada e vinculada ao protocolo Verto ${canonicalName}.`,
        type: 'protocol_import_review',
        actionType: 'protocol_import_approved',
        payloadDetails: JSON.stringify({ requestId, canonicalKey, canonicalName, updatedTable })
      });

      return res.json({ success: true, data: { requestId, status: 'approved', canonicalKey, canonicalName } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel aprovar o protocolo.' });
    }
  });

  app.post('/api/admin/protocol-import-requests/:requestId/reject', checkAuth, checkPlatformAdmin, async (req: any, res) => {
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      let updatedTable = false;
      try {
        const { error } = await supabase
          .from('protocol_import_requests')
          .update({
            status: 'rejected',
            reviewed_by: sanitizeString(req.session.user?.id, 120) || null,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId);
        updatedTable = !error;
      } catch {
        updatedTable = false;
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Protocolo recusado',
        content: `Solicitacao ${requestId} foi recusada pela Verto.`,
        type: 'protocol_import_review',
        actionType: 'protocol_import_rejected',
        payloadDetails: JSON.stringify({ requestId, status: 'rejected', updatedTable })
      });

      return res.json({ success: true, data: { requestId, status: 'rejected' } });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel recusar o protocolo.' });
    }
  });

  app.post('/api/admin/protocol-import-requests/:requestId/scan', checkAuth, checkPlatformAdmin, async (req: any, res) => {
    try {
      const requestId = sanitizeString(req.params.requestId, 120);
      if (!requestId) {
        return res.status(400).json({ success: false, error: 'Informe a solicitacao de protocolo.' });
      }

      const { data: requestRow, error: fetchError } = await supabase
        .from('protocol_import_requests')
        .select('id, protocol_name, file_name, file_type, file_size, file_data_url')
        .eq('id', requestId)
        .maybeSingle();
      if (fetchError || !requestRow) {
        return res.status(404).json({ success: false, error: 'Solicitacao de protocolo nao encontrada.' });
      }

      const dataUrl = sanitizeString((requestRow as any).file_data_url, 14_000_000);
      if (!dataUrl) {
        return res.status(409).json({ success: false, error: 'Arquivo bruto nao esta disponivel para varredura.' });
      }

      const scan = scanProtocolUpload(
        dataUrl,
        sanitizeString((requestRow as any).file_name || (requestRow as any).protocol_name, 240),
        sanitizeString((requestRow as any).file_type, 120)
      );
      const nowIso = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        scan_status: scan.scanStatus,
        quarantine_status: scan.quarantineStatus,
        safe_preview_status: scan.safePreviewStatus,
        raw_file_access: 'blocked',
        safe_preview_text: scan.safePreviewText,
        scan_report: scan.scanReport,
        updated_at: nowIso
      };
      let updateError: any = null;
      let updatedTable = false;
      const removedProtocolColumns = new Set<string>();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        ({ error: updateError } = await supabase
          .from('protocol_import_requests')
          .update(updatePayload)
          .eq('id', requestId));
        if (!updateError) {
          updatedTable = true;
          break;
        }

        const missingColumn = extractMissingColumnName(updateError);
        if (!missingColumn || removedProtocolColumns.has(missingColumn) || !(missingColumn in updatePayload)) {
          break;
        }
        removedProtocolColumns.add(missingColumn);
        delete updatePayload[missingColumn];
      }
      if (updateError) {
        console.warn('[Protocol Import] scan table update fallback:', updateError.message || updateError);
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Varredura segura de protocolo',
        content: `Solicitacao ${requestId} processada com status ${scan.scanStatus}.`,
        type: 'protocol_import_review',
        actionType: 'protocol_import_scanned',
        payloadDetails: JSON.stringify({
          requestId,
          scanStatus: scan.scanStatus,
          quarantineStatus: scan.quarantineStatus,
          safePreviewStatus: scan.safePreviewStatus,
          safePreviewText: sanitizeSafePreviewText(scan.safePreviewText, 4000),
          updatedTable,
          scanReport: scan.scanReport
        })
      });

      return res.json({
        success: true,
        data: {
          id: requestId,
          scanStatus: scan.scanStatus,
          quarantineStatus: scan.quarantineStatus,
          safePreviewStatus: scan.safePreviewStatus,
          rawFileAccess: 'blocked',
          safePreviewText: sanitizeSafePreviewText(scan.safePreviewText, 4000),
          scanReport: sanitizeClinicalPayload(scan.scanReport)
        }
      });
    } catch (error: any) {
      console.error('[Protocol Import] scan error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Nao foi possivel processar a varredura segura do protocolo.' });
    }
  });

  app.get('/api/admin/verto-protocols', checkAuth, checkPlatformAdmin, async (_req: any, res) => {
    try {
      let protocols: any[] = [];
      try {
        const { data, error } = await supabase
          .from('verto_canonical_protocols')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(500);
        if (!error && Array.isArray(data)) {
          protocols = data.map((row: any) => ({
            id: sanitizeString(row.id, 120),
            canonicalKey: sanitizeString(row.canonical_key, 180),
            title: sanitizeString(row.title, 180),
            category: sanitizeString(row.category, 80) || 'evaluation',
            sourceLabel: sanitizeString(row.source_label, 180) || null,
            versionLabel: sanitizeString(row.version_label, 120) || null,
            status: sanitizeString(row.status, 40) || 'draft',
            protocol: sanitizeClinicalPayload(row.protocol_json),
            createdAt: sanitizeString(row.created_at, 80),
            updatedAt: sanitizeString(row.updated_at, 80)
          }));
        }
      } catch {
        protocols = [];
      }
      return res.json({ success: true, data: protocols });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Nao foi possivel listar protocolos Verto.' });
    }
  });

  app.post('/api/admin/verto-protocols', checkAuth, checkPlatformAdmin, async (req: any, res) => {
    try {
      if (!enforcePayloadLimit(req, res, 6 * 1024 * 1024, 'Protocolo estruturado')) return;
      const rawProtocol = req.body?.protocol || {};
      const title = sanitizeString(rawProtocol?.title || req.body?.title, 180);
      const canonicalKey = sanitizeString(
        req.body?.canonicalKey || rawProtocol?.canonicalKey || normalizeProtocolKey(title),
        180
      );
      const category = sanitizeString(rawProtocol?.category || req.body?.category || 'evaluation', 80) || 'evaluation';
      const sourceLabel = sanitizeString(req.body?.sourceLabel || rawProtocol?.sourceLabel, 180);
      const versionLabel = sanitizeString(req.body?.versionLabel || rawProtocol?.versionLabel, 120);
      const status = sanitizeString(req.body?.status || rawProtocol?.status || 'draft', 40) || 'draft';
      const protocolJson = sanitizeClinicalPayload({
        ...rawProtocol,
        title,
        canonicalKey,
        category,
        sourceLabel,
        versionLabel,
        status
      });

      if (!title || !canonicalKey || !Array.isArray(protocolJson?.data) || protocolJson.data.length === 0) {
        return res.status(400).json({ success: false, error: 'Protocolo precisa de titulo, chave canonica e ao menos um dominio.' });
      }

      const protocolId = sanitizeString(req.body?.id || rawProtocol?.id, 120) || crypto.randomUUID();
      const nowIso = new Date().toISOString();
      let storedInTable = false;
      try {
        const { error } = await supabase
          .from('verto_canonical_protocols')
          .upsert([{
            id: protocolId,
            canonical_key: canonicalKey,
            title,
            category,
            source_label: sourceLabel || null,
            version_label: versionLabel || null,
            status,
            protocol_json: protocolJson,
            created_by: sanitizeString(req.session.user?.id, 120) || null,
            updated_at: nowIso,
            created_at: nowIso
          }], { onConflict: 'canonical_key' });
        storedInTable = !error;
        if (error) console.warn('[Verto Protocols] table upsert fallback:', error.message || error);
      } catch (tableError: any) {
        console.warn('[Verto Protocols] table unavailable fallback:', tableError?.message || String(tableError));
      }

      await persistActivityLog({
        userId: sanitizeString(req.session.user?.id, 120),
        clinicId: sanitizeString(currentClinicId(req.session.user), 120),
        actorName: sanitizeString(req.session.user?.name || req.session.user?.email || 'Admin Verto', 180),
        title: 'Protocolo canonico Verto salvo',
        content: `Protocolo ${title} salvo como ${canonicalKey} com ${protocolJson.data.length} dominios.`,
        type: 'verto_protocol_library',
        actionType: 'verto_protocol_saved',
        payloadDetails: JSON.stringify({
          id: protocolId,
          canonicalKey,
          title,
          category,
          status,
          domains: protocolJson.data.length,
          storedInTable
        })
      });

      return res.json({ success: true, data: { id: protocolId, canonicalKey, title, storedInTable } });
    } catch (error: any) {
      console.error('[Verto Protocols] save error:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Nao foi possivel salvar o protocolo canonico.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  });

  app.post('/api/admin/charge', checkAuth, checkAdmin, async (req, res) => {
    const { userId } = req.body;
    try {
      // Logic to trigger a manual charge or retry via Stripe
      res.json({ success: true, message: 'Cobrança iniciada com sucesso (Simulado)' });
    } catch (error) {
      res.status(500).json({ error: 'Erro interno do servidor.' });
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
      const safePhone = sanitizePhoneE164(req.body?.phone || req.body?.whatsappPhone || req.body?.whatsapp);
      const requestedPlan = normalizeProfessionalPlan(req.body?.planName || '') || sanitizeString(req.body?.planName, 80);

      if (!safeEmail || !password || !safeName || !requestedPlan || !safePhone) {
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
        let profileUpdatePayload = cleanObject({
          name: safeName,
          role: 'coordinator',
          phone: safePhone,
          plan_name: requestedPlan,
          plan_price: planPricesDecimal[requestedPlan] || null,
          subscription_status: 'pending',
          crp: safeCrp || undefined,
          updated_at: new Date().toISOString()
        });

        const alreadyRemoved = new Set<string>();
        let updateSucceeded = false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const { error: updateExistingError } = await supabase
            .from('users')
            .update(profileUpdatePayload)
            .eq('id', userId);
          if (!updateExistingError) {
            updateSucceeded = true;
            break;
          }

          const missingColumn = extractMissingColumnName(updateExistingError);
          if (!missingColumn || alreadyRemoved.has(missingColumn)) {
            throw updateExistingError;
          }

          alreadyRemoved.add(missingColumn);
          const { [missingColumn]: _removed, ...rest } = profileUpdatePayload as any;
          profileUpdatePayload = rest;
        }
        if (!updateSucceeded) {
          throw new Error('Não foi possível atualizar cadastro existente para checkout.');
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
            crp: safeCrp,
            phone: safePhone
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
      const activePatientPriceId = resolveActivePatientPriceId();
      const stripePriceId = activePatientPriceId || resolveProfessionalPlanPriceId(requestedPlan);
      const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = stripePriceId
        ? activePatientPriceId
          ? {
              price: stripePriceId
            }
          : {
              price: stripePriceId,
              quantity: 1
            }
        : {
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
          };

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [lineItem],
        mode: 'subscription',
        success_url: `${origin}/?payment=success&mode=professional-signup&signup=check-email&checkout_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?payment=cancel&mode=professional-signup&lead_ref=${encodeURIComponent(userId)}&plan=${encodeURIComponent(requestedPlan)}&checkout_session_id={CHECKOUT_SESSION_ID}`,
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

  app.get('/api/owner/leads/recovery', checkAuth, checkOwner, async (_req: any, res) => {
    try {
      const pendingStatuses = ['pending', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'checkout_abandoned'];
      const { data: candidates, error: usersError } = await supabase
        .from('users')
        .select('id, name, email, phone, plan_name, subscription_status, created_at, updated_at')
        .eq('role', 'coordinator')
        .in('subscription_status', pendingStatuses)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (usersError) throw usersError;

      const candidateIds = (candidates || []).map((user: any) => sanitizeString(user.id, 120)).filter(Boolean);
      let leadLogs: any[] = [];
      if (candidateIds.length > 0) {
        const { data: logsData, error: logsError } = await supabase
          .from('activity_logs')
          .select('id, user_id, title, content, action_type, payload_details, timestamp')
          .eq('type', 'lead_recovery')
          .in('user_id', candidateIds)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('timestamp', { ascending: false })
          .limit(5000);
        if (!logsError) {
          leadLogs = logsData || [];
        } else {
          const { data: fallbackLogs } = await supabase
            .from('activity_logs')
            .select('id, user_id, title, content, action_type, payload_details, timestamp')
            .in('user_id', candidateIds)
            .ilike('title', '%Checkout cancelado%')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('timestamp', { ascending: false })
            .limit(5000);
          leadLogs = fallbackLogs || [];
        }
      }

      const grouped = new Map<string, { lastAt: string | null; cancelCount: number; source: string | null }>();
      for (const log of leadLogs) {
        const userId = sanitizeString(log?.user_id, 120);
        if (!userId) continue;
        const rawSource = (() => {
          try {
            const payload = JSON.parse(String(log?.payload_details || '{}'));
            return sanitizeString(payload?.source, 80);
          } catch {
            return null;
          }
        })();
        const existing = grouped.get(userId);
        const timestamp = sanitizeString(log?.timestamp, 80) || null;
        if (!existing) {
          grouped.set(userId, { lastAt: timestamp, cancelCount: 1, source: rawSource || null });
        } else {
          existing.cancelCount += 1;
          if (!existing.lastAt && timestamp) existing.lastAt = timestamp;
          if (!existing.source && rawSource) existing.source = rawSource;
          grouped.set(userId, existing);
        }
      }

      const data = (candidates || []).map((user: any) => {
        const leadMeta = grouped.get(sanitizeString(user.id, 120));
        return {
          userId: sanitizeString(user.id, 120),
          name: sanitizeString(user.name, 180) || 'Lead sem nome',
          email: sanitizeEmail(user.email),
          phone: sanitizeString(user.phone, 40) || null,
          planName: sanitizeString(user.plan_name, 80) || null,
          subscriptionStatus: sanitizeString(user.subscription_status, 40) || 'pending',
          createdAt: sanitizeString(user.created_at, 80) || null,
          lastUpdatedAt: sanitizeString(user.updated_at, 80) || null,
          lastCheckoutCancelAt: leadMeta?.lastAt || null,
          cancelCount: Number(leadMeta?.cancelCount || 0),
          lastCancelSource: leadMeta?.source || null
        };
      });

      return res.json({
        success: true,
        data
      });
    } catch (error) {
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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
      let checkoutPlanName = '';
      
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
        const activePatientPriceId = resolveActivePatientPriceId();
        
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

        if (!planName && !activePatientPriceId) {
          return res.status(400).json({ error: 'Selecione um plano para continuar.' });
        }

        if (planName && !planPrices[planName]) {
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
        
        amount = planName ? planPrices[planName] : 0;
        description = activePatientPriceId ? 'Cobrança por paciente ativo - Verto' : `Plano ${planName} - Verto`;
        checkoutPlanName = planName || 'Pacientes Ativos';
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

      const persistedCustomerId = await resolvePersistedStripeCustomerId({
        userId: sanitizeString(user.id, 120),
        clinicId,
        email: sanitizeEmail(user.email)
      });

      const activePatientPriceId = user.role === 'patient' ? '' : resolveActivePatientPriceId();
      const professionalPriceId = user.role === 'patient' ? '' : (activePatientPriceId || resolveProfessionalPlanPriceId(checkoutPlanName));
      const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = professionalPriceId
        ? activePatientPriceId
          ? {
              price: professionalPriceId
            }
          : {
              price: professionalPriceId,
              quantity: 1
            }
        : {
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
          };

      const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ['card'],
        line_items: [lineItem],
        mode: 'subscription',
        success_url: `${origin}/?payment=success`,
        cancel_url: `${origin}/?payment=cancel`,
        metadata: {
          userId: user.id,
          clinicId,
          ...(user.role === 'patient' ? {} : { planName: checkoutPlanName })
        },
        subscription_data: {
          metadata: {
            userId: user.id,
            clinicId,
            ...(user.role === 'patient' ? {} : { planName: checkoutPlanName })
          }
        }
      };

      if (persistedCustomerId) {
        checkoutPayload.customer = persistedCustomerId;
      } else {
        checkoutPayload.customer_email = user.email;
      }

      const session = await stripe.checkout.sessions.create(checkoutPayload);

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

  app.post('/api/stripe/customer-portal-session', checkAuth, requireRoles('coordinator', 'admin', 'owner'), async (req: any, res) => {
    try {
      const stripe = getStripe();
      const sessionUser = req.session?.user || {};
      const safeEmail = sanitizeEmail(sessionUser?.email);
      if (!safeEmail) {
        return res.status(400).json({ success: false, error: 'E-mail da sessão não encontrado para abrir portal de faturamento.' });
      }

      const clinicId = sanitizeString(
        sessionUser.activeWorkspaceId || sessionUser.clinicId || sessionUser.id,
        120
      );
      const persistedCustomerId = await resolvePersistedStripeCustomerId({
        userId: sanitizeString(sessionUser.id, 120),
        clinicId,
        email: safeEmail
      });

      let customerId = persistedCustomerId;
      if (!customerId) {
        const customers = await stripe.customers.list({ email: safeEmail, limit: 10 });
        customerId = sanitizeString(customers.data?.[0]?.id, 200);
      }
      if (!customerId) {
        return res.status(404).json({
          success: false,
          error: 'Cliente Stripe não encontrado para este e-mail. Faça o primeiro checkout antes de abrir o portal.'
        });
      }

      const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/?billing=return`
      });

      await persistStripeCustomerReference({
        customerId,
        email: safeEmail,
        userId: sanitizeString(sessionUser.id, 120),
        clinicId
      });

      return res.json({ success: true, url: portalSession.url });
    } catch (error: any) {
      console.error('[Stripe] customer-portal-session error:', {
        message: error?.message || String(error),
        code: sanitizeString(error?.code, 60) || null
      });
      return res.status(500).json({
        success: false,
        error: sanitizeString(error?.message || 'Falha ao abrir portal de faturamento.', 500)
      });
    }
  });

  app.post('/api/stripe/checkout-cancelled', async (req, res) => {
    try {
      const leadRef = sanitizeString(req.body?.leadRef || req.body?.userId, 120);
      const email = sanitizeEmail(req.body?.email);
      const planName = sanitizeString(req.body?.planName, 80);
      const checkoutSessionId = sanitizeString(req.body?.checkoutSessionId || req.body?.sessionId, 200);
      const source = sanitizeString(req.body?.source, 80) || 'frontend_cancel_event';

      if (!leadRef && !email) {
        return res.status(400).json({ success: false, error: 'leadRef ou email é obrigatório.' });
      }

      await trackProfessionalSignupCheckoutCancellation({
        userId: leadRef || null,
        email: email || null,
        planName: planName || null,
        checkoutSessionId: checkoutSessionId || null,
        source
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.warn('[Stripe] checkout-cancelled tracking error:', error?.message || String(error));
      return res.status(200).json({ success: true });
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
        error: 'Falha ao carregar resumo de cobrança.'
      });
    }
  });

  app.post('/api/billing/report-usage', async (req: any, res) => {
    try {
      const cronSecret = sanitizeString(process.env.BILLING_CRON_SECRET || '', 240);
      const providedSecret = sanitizeString(req.headers['x-cron-secret'] || req.body?.secret, 240);
      const sessionRole = sanitizeString(req.session?.user?.role, 40).toLowerCase();
      const authorizedBySecret = Boolean(
        cronSecret &&
        providedSecret &&
        Buffer.byteLength(cronSecret) === Buffer.byteLength(providedSecret) &&
        crypto.timingSafeEqual(Buffer.from(cronSecret), Buffer.from(providedSecret))
      );
      const authorizedBySession = ['owner', 'admin'].includes(sessionRole);
      if (!authorizedBySecret && !authorizedBySession) {
        return res.status(403).json({ success: false, error: 'Acesso negado para reportar uso de billing.' });
      }

      const activePatientPriceId = resolveActivePatientPriceId();
      if (!activePatientPriceId) {
        return res.status(400).json({ success: false, error: 'STRIPE_ACTIVE_PATIENT_PRICE_ID não configurado.' });
      }

      const results = await reportAllClinicsActivePatientUsage({
        supabase,
        stripe: getStripe(),
        activePatientPriceId,
        trigger: sanitizeString(req.body?.trigger, 80) || 'manual_endpoint',
        allowOverNegotiationLimit: sanitizeString(process.env.STRIPE_ALLOW_OVER_299_USAGE || process.env.STRIPE_ALLOW_OVER_50_USAGE || '', 10).toLowerCase() === 'true',
        logger: console
      });

      return res.json({
        success: true,
        reported: results.filter((item) => item.reported).length,
        skipped: results.filter((item) => !item.reported).length,
        results
      });
    } catch (error: any) {
      console.error('[Stripe Usage] Endpoint report-usage falhou:', {
        message: error?.message || String(error)
      });
      return res.status(500).json({ success: false, error: 'Falha ao reportar uso mensal.' });
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
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (normalizedPath.endsWith('/index.html') || normalizedPath.endsWith('/sw.js')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          return;
        }
        if (normalizedPath.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('/assets/*', (_req, res) => {
      res.status(404).type('text/plain').send('Asset não encontrado. Atualize a página para carregar a versão mais recente.');
    });
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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
      success: false,
      error: 'Erro interno do servidor.'
    });
  });

  const activePatientPriceId = resolveActivePatientPriceId();
  if (activePatientPriceId) {
    const runMonthlyUsageReport = async (trigger: string) => {
      try {
        const results = await reportAllClinicsActivePatientUsage({
          supabase,
          stripe: getStripe(),
          activePatientPriceId,
          trigger,
          allowOverNegotiationLimit: sanitizeString(process.env.STRIPE_ALLOW_OVER_299_USAGE || process.env.STRIPE_ALLOW_OVER_50_USAGE || '', 10).toLowerCase() === 'true',
          logger: console
        });
        console.log('[Stripe Usage] Reporte mensal concluído.', {
          trigger,
          reported: results.filter((item) => item.reported).length,
          skipped: results.filter((item) => !item.reported).length
        });
      } catch (error: any) {
        console.error('[CRITICAL] Falha no reporte mensal de uso Stripe (não bloqueante).', {
          trigger,
          message: error?.message || String(error)
        });
      }
    };

    const runLegacyDailyBillingSync = async (trigger: string) => {
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

    if (isMeteredActivePatientBilling()) {
      let lastMonthlyUsageReportKey = '';
      const shouldRunMonthlyUsageReport = () => {
        const now = new Date();
        const saoPauloDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const tomorrow = new Date(saoPauloDate);
        tomorrow.setDate(saoPauloDate.getDate() + 1);
        const isLastDay = tomorrow.getMonth() !== saoPauloDate.getMonth();
        const isReportWindow = saoPauloDate.getHours() === 23 && saoPauloDate.getMinutes() < 15;
        const key = `${saoPauloDate.getFullYear()}-${String(saoPauloDate.getMonth() + 1).padStart(2, '0')}`;
        if (!isLastDay || !isReportWindow || lastMonthlyUsageReportKey === key) return false;
        lastMonthlyUsageReportKey = key;
        return true;
      };

      setInterval(() => {
        if (shouldRunMonthlyUsageReport()) {
          void runMonthlyUsageReport('monthly_last_day_23h');
        }
      }, 15 * 60 * 1000);
    } else {
      setTimeout(() => {
        void runLegacyDailyBillingSync('startup_warmup');
      }, 90 * 1000);

      setInterval(() => {
        void runLegacyDailyBillingSync('daily_interval');
      }, 24 * 60 * 60 * 1000);
    }
  } else {
    console.warn('[Stripe Sync] STRIPE_ACTIVE_PATIENT_PRICE_ID não configurado. Sync de pacientes ativos desabilitado.');
  }

  startAppointmentReminderCron({
    supabase,
    vapidPublicKey,
    vapidPrivateKey,
    logger: console
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('FATAL ERROR STARTING SERVER:', err);
  process.exit(1);
});
