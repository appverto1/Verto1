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

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function normalizeProfessionalPlan(input?: string | null): 'Essencial' | 'Crescimento' | 'AvanÃ§ado' | null {
  if (!input) return null;
  const normalized = input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized === 'essencial') return 'Essencial';
  if (normalized === 'crescimento') return 'Crescimento';
  if (normalized === 'avancado') return 'AvanÃ§ado';
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

function sanitizeString(value: unknown, maxLength = 5000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
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

function sanitizeUrl(value: unknown): string | null {
  const url = sanitizeString(value, 2000);
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) {
    return url;
  }
  return null;
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
  if (!raw) return null;

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
  } catch {
    return null;
  }
}

function pseudonymizeValue(value: string): string {
  const secret = (process.env.PSEUDONYMIZATION_KEY || process.env.SESSION_SECRET || 'verto-dev-key').trim();
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 24);
}

function sanitizeAnamnesisTemplate(input: any) {
  const hiddenFields = Array.isArray(input?.hiddenFields)
    ? input.hiddenFields.map((f: any) => sanitizeString(f, 80)).filter(Boolean).slice(0, 500)
    : [];

  const customQuestions = Array.isArray(input?.customQuestions)
    ? input.customQuestions.slice(0, 300).map((q: any, index: number) => {
        const typeRaw = sanitizeString(q?.type, 40);
        const type = ['dissertativa', 'multipla_escolha', 'multipla_selecao'].includes(typeRaw)
          ? typeRaw
          : 'dissertativa';
        return cleanObject({
          id: sanitizeString(q?.id, 80) || `custom_${Date.now()}_${index}`,
          label: sanitizeString(q?.label, 240),
          type,
          options: Array.isArray(q?.options)
            ? q.options.map((o: any) => sanitizeString(o, 120)).filter(Boolean).slice(0, 30)
            : [],
          active: q?.active !== false,
          required: q?.required === true,
          appliesTo: ['adult', 'child', 'both'].includes(sanitizeString(q?.appliesTo, 20))
            ? sanitizeString(q?.appliesTo, 20)
            : 'both'
        });
      })
    : [];

  return { hiddenFields, customQuestions };
}

function currentClinicId(user: any): string | null {
  const id = sanitizeString(user?.clinicId || user?.clinic_id || user?.id, 120);
  return id || null;
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
      clinicLogoUrl: sanitizeUrl(clinic.logo_url),
      role: ensureRole(membership.role) ? membership.role : 'therapist'
    };
  }).filter((w: any) => w.clinicId);
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
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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
  console.error("- SUPABASE_URL:", (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) ? "✅" : "❌");
  console.error("- SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅" : "❌");
  console.error("-------------------------------------");
  
  if (process.env.NODE_ENV === 'production') {
    console.error("O servidor não pode iniciar sem as credenciais do Supabase.");
    process.exit(1);
  }
}

// Only create client if we have the credentials to avoid crash
let supabase: any = null;
try {
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
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

  // Trust proxy is required for rate limiting and secure cookies behind Railway's load balancer
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  
  console.log('[Config] SESSION_SECRET defined:', !!process.env.SESSION_SECRET);
  console.log('[Config] SUPABASE_SERVICE_ROLE_KEY defined:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Security Headers (Helmet)
  app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for Vite dev mode compatibility
    crossOriginEmbedderPolicy: false
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

  // Stripe Webhook (to handle successful payments) - MUST BE BEFORE express.json()
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const userId = session.metadata.userId;

      console.log(`Payment successful for user: ${userId}`);

      // Update user subscription status in Supabase
      const { error } = await supabase
        .from('users')
        .update({ subscription_status: 'active' })
        .eq('id', userId);
        
      if (error) {
        console.error('Error updating subscription status:', error);
      }
    }

    res.json({ received: true });
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
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
      maxAge: 30 * 24 * 60 * 60 * 1000, 
      sameSite: isProd ? 'none' : 'lax'
    }
  }));

  // Auth Middleware
  const checkAuth = async (req: any, res: any, next: any) => {
    // 1. Check Session (Cookie-based)
    if (req.session && req.session.user) {
      return next();
    }

    // 2. Fallback: Check Authorization Header (Token-based)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          // Re-populate session if missing but token is valid
          const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
          if (profile) {
            const workspaces = await fetchUserWorkspaces(user.id);
            const selectedWorkspace = workspaces.find((w: any) => w.clinicId === profile.clinic_id) || workspaces[0] || null;
            req.session.user = {
              id: user.id,
              email: user.email,
              role: selectedWorkspace?.role || profile.role,
              name: profile.name,
              type: profile.type || user.user_metadata?.type || null,
              age: typeof profile.age === 'number' ? profile.age : null,
              subscriptionStatus: profile.subscription_status,
              planName: profile.plan_name,
              planPrice: profile.plan_price,
              clinicId: selectedWorkspace?.clinicId || profile.clinic_id,
              firstLoginCompleted: profile.first_login_completed || user.user_metadata?.first_login_completed,
              clinicSettings: user.user_metadata?.clinic_settings || null,
              workspaces
            };
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

  // Ownership Middleware (IDOR Protection)
  const checkPatientAccess = async (req: any, res: any, next: any) => {
    const user = req.session.user;
    const patientId = req.params.patientId || req.body.patient_id;

    if (!patientId) return next();

    try {
      // Admin bypass
      if (user.role === 'admin' || user.role === 'coordinator' || user.role === 'receptionist') return next();

      // Check if user is the patient themselves
      if (user.id === patientId) return next();

      // Check if user is the therapist for this patient
      const { data: patient, error } = await supabase
        .from('patients')
        .select('therapist_id, clinic_id')
        .eq('id', patientId)
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
    let url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    if (url && !url.startsWith('http')) {
      url = `https://${url}`;
    }
    
    // Cache config for 1 minute to reduce server load
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    res.json({
      supabaseUrl: url,
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
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
      const user = users.find(u => u.email === email);
      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
      
      const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
      if (!profile || !profile.two_factor_enabled || !profile.two_factor_secret) {
        return res.status(400).json({ error: "2FA não habilitado para este usuário" });
      }
      
      const result = verifySync({ token, secret: profile.two_factor_secret });
      if (!result.valid) return res.status(400).json({ error: 'Codigo invalido' });

      const workspaces = await fetchUserWorkspaces(user.id);
      const selectedWorkspace = workspaces.find((w: any) => w.clinicId === profile.clinic_id) || workspaces[0] || null;

      // Complete login
      const userData = {
        id: user.id,
        email: user.email,
        role: selectedWorkspace?.role || profile.role,
        name: profile.name,
        type: profile.type || user.user_metadata?.type || null,
        age: typeof profile.age === 'number' ? profile.age : null,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        clinicId: selectedWorkspace?.clinicId || profile.clinic_id,
        workspaces
      };
      
      req.session.user = userData;
      res.json({ success: true, user: userData });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Direct Signup (Bypasses email confirmation using Admin API)
  app.post('/api/auth/signup-direct', async (req, res) => {
    const { email, password, name, role, intendedRole, planName, acquisitionChannel } = req.body;
    if (!email || !password) return res.status(400).json({ error: "E-mail e senha são obrigatórios" });

    try {
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name }
      });

      let userId = authUser?.user?.id;

      if (authError) {
        if (authError.message.includes('already been registered')) {
          // User exists in Auth, let's check if they have a profile
          const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
          const existingUser = users.find(u => u.email === email);
          
          if (existingUser) {
            userId = existingUser.id;
            const { data: profile } = await supabase.from('users').select('*').eq('id', userId).single();
            
            if (profile) {
              return res.status(400).json({ error: "Este e-mail já está cadastrado. Por favor, faça login." });
            }
            // If no profile, continue to create one below
          } else {
            throw authError;
          }
        } else {
          throw authError;
        }
      }

      if (userId) {
        // Create profile
        let roleToUse: AppRole = normalizeRequestedRole(intendedRole || role);
        
        // If it's a professional signup and no intended role (like from an invitation), default to coordinator
        if (sanitizeString(role, 40).toLowerCase() === 'professional' && !intendedRole) {
          roleToUse = 'coordinator';
        }
        
        const planPrices: Record<string, number> = {
          'Essencial': 149.90,
          'Crescimento': 399.90,
          'Avançado': 679.90,
          'Paciente': 4.90
        };

        const finalPlanName = roleToUse === 'patient' ? 'Paciente' : normalizeProfessionalPlan(planName);
        const finalPlanPrice = finalPlanName ? (planPrices[finalPlanName] || null) : null;

        const newProfile = {
          id: userId,
          email: email,
          name: name || email.split('@')[0],
          role: roleToUse,
          clinic_id: roleToUse === 'coordinator' ? userId : null, // Workspace ativo inicial
          subscription_status: 'pending', // Default to pending until onboarding/payment
          plan_name: finalPlanName,
          plan_price: finalPlanPrice,
          created_at: new Date().toISOString()
        };

        const { error: insertError } = await supabase.from('users').insert([newProfile]);
        
        if (insertError) {
            console.error("Profile creation error:", insertError);
            // If it's a duplicate key error in 'users' table, it means profile already exists
            if (insertError.code === '23505') {
                return res.status(400).json({ error: "Este e-mail já está cadastrado. Por favor, faça login." });
            }
            throw insertError;
        }

        // Also update user metadata for onboarding tracking
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: { first_login_completed: false }
        });

        if (roleToUse === 'coordinator') {
          await ensureClinicAndMembershipForCoordinator(userId, name || null);
        }

        const workspaces = await fetchUserWorkspaces(userId);

        // Set session
        const userData = {
          id: userId,
          email: email,
          role: roleToUse,
          name: name || email.split('@')[0],
          type: newProfile.type || null,
          age: typeof newProfile.age === 'number' ? newProfile.age : null,
          subscriptionStatus: 'pending',
          planName: finalPlanName,
          planPrice: finalPlanPrice,
          clinicId: newProfile.clinic_id,
          firstLoginCompleted: false,
          workspaces
        };

        req.session.user = userData;
        req.session.isFirstLogin = true;
        
        req.session.save((err) => {
          if (err) {
            console.error("Session save error in signup-direct:", err);
            if (!res.headersSent) {
              return res.status(500).json({ error: "Erro ao salvar sessão" });
            }
            return;
          }
          res.json({ success: true, message: "Conta criada com sucesso!", user: userData, isFirstLogin: true });
        });
      }
    } catch (error: any) {
      console.error("Signup bypass error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- AUTH ROUTES ---
  // Login (receives Supabase access token from client, verifies it, and sets session)
  app.post('/api/auth/login', async (req, res) => {
    const { accessToken, intendedRole } = req.body;
    console.log('Login attempt with token:', !!accessToken, 'intendedRole:', intendedRole);
    if (!accessToken) return res.status(400).json({ error: "Access token required" });

    try {
      // Verify token with Supabase
      if (!supabase || !supabaseServiceKey) {
        console.error('[Auth] Supabase client or service key is missing. Cannot verify token.');
        return res.status(500).json({ error: "Erro de configuração no servidor (Supabase client not initialized)" });
      }

      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      
      if (error || !user) {
        console.error('[Auth] Supabase auth error during token verification:', error?.message || 'No user found');
        return res.status(401).json({ error: "Sessão expirada ou inválida. Por favor, faça login novamente." });
      }

      console.log('[Auth] User verified successfully:', user.id, user.email);

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
      const selectedWorkspace = workspaces.find((w: any) => w.clinicId === profile.clinic_id) || workspaces[0] || null;
      const roleForSession = selectedWorkspace?.role || profile.role;
      const clinicForSession = selectedWorkspace?.clinicId || profile.clinic_id;

      const userData = {
        id: user.id,
        email: user.email,
        role: roleForSession,
        name: profile.name,
        type: profile.type || user.user_metadata?.type || null,
        age: typeof profile.age === 'number' ? profile.age : null,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        clinicId: clinicForSession,
        firstLoginCompleted: profile.first_login_completed || user.user_metadata?.first_login_completed,
        clinicSettings: user.user_metadata?.clinic_settings || null,
        workspaces
      };

      req.session.user = userData;
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

  app.get('/api/auth/me', (req, res) => {
    if (req.session.user) {
      res.json({ user: req.session.user });
    } else {
      res.json({ user: null });
    }
  });

  app.get('/api/workspaces', checkAuth, async (req: any, res) => {
    try {
      const workspaces = await fetchUserWorkspaces(req.session.user.id);
      req.session.user.workspaces = workspaces;
      res.json({ success: true, data: workspaces });
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
      req.session.user.role = selected.role;
      req.session.user.workspaces = workspaces;

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
    } catch (error) {
      res.status(500).json({ error: String(error) });
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
    } catch (error) {
      res.status(500).json({ error: String(error) });
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
      req.session.user.role = invitation.role;
      req.session.user.workspaces = await fetchUserWorkspaces(user.id);

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
          return res.json({ success: true, data: { hiddenFields: [], customQuestions: [] }, warning: 'Tabela de template não criada.' });
        }
        throw error;
      }

      const template = sanitizeAnamnesisTemplate(data?.template_json || {});
      return res.json({ success: true, data: { ...template, updatedAt: data?.updated_at || null } });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/clinic/anamnesis-template', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const clinicId = currentClinicId(req.session.user);
      const template = sanitizeAnamnesisTemplate(req.body?.template);

      const payload = {
        clinic_id: clinicId,
        template_json: template,
        updated_by: sanitizeString(req.session.user?.id, 120),
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

      return res.json({ success: true, data: template });
    } catch (error) {
      return res.status(500).json({ error: String(error) });
    }
  });

  // Create Patient User Account (called by therapist when adding a patient)
  app.post('/api/patients/create-user', checkAuth, async (req: any, res) => {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
      // 1. Check if user already exists in 'users' table
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingUser) {
        return res.json({ success: true, message: 'User already exists', userId: existingUser.id });
      }

      // 2. Create user in Supabase Auth (Admin API)
      // We generate a temporary password or let them use magic link/reset password
      const tempPassword = Math.random().toString(36).slice(-10) + 'Verto123!';
      
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: name }
      });

      if (authError) {
        // If user already exists in Auth but not in our 'users' table (rare but possible)
        if (authError.message.includes('already registered')) {
          // Try to find the user by email in auth to get their ID
          const { data: listUsers, error: listError } = await supabase.auth.admin.listUsers();
          const foundUser = listUsers?.users.find(u => u.email === email);
          if (foundUser) {
            // Create the profile in 'users' table
            const newProfile = {
              id: foundUser.id,
              email: email,
              name: name || email.split('@')[0],
              role: 'patient',
              subscription_status: 'pending',
              plan_price: 4.90,
              created_at: new Date().toISOString()
            };
            await supabase.from('users').insert([newProfile]);
            return res.json({ success: true, userId: foundUser.id });
          }
        }
        throw authError;
      }

      if (authUser?.user) {
        // 3. Create profile in 'users' table
        const newProfile = {
          id: authUser.user.id,
          email: email,
          name: name || email.split('@')[0],
          role: 'patient',
          subscription_status: 'pending',
          plan_price: 4.90,
          created_at: new Date().toISOString()
        };

        const { error: profileError } = await supabase
          .from('users')
          .insert([newProfile]);

        if (profileError) throw profileError;

        return res.json({ success: true, userId: authUser.user.id, tempPassword });
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

      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) throw listError;

      const exists = (buckets || []).find((b: any) => b.name === bucketName);
      if (!exists) {
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: true,
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
          contentType: mimeFromDataUrl
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
      const safeBody = cleanObject({
        id: sanitizeString(req.body?.id, 100) || undefined,
        name: sanitizeString(req.body?.name || req.body?.nome, 160),
        email: sanitizeEmail(req.body?.email),
        phone: sanitizePhone(req.body?.phone || req.body?.telefone),
        age: asSafeNumber(req.body?.age, 0, 130),
        diagnosis: sanitizeString(req.body?.diagnosis, 2000),
        status: sanitizeString(req.body?.status, 40) || undefined,
        clinic_id: sanitizeString(req.session.user.clinicId || req.session.user.id, 100),
        therapist_id: sanitizeString(req.body?.therapist_id || req.session.user.id, 100),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!safeBody.name) {
        return res.status(400).json({ error: 'Nome do paciente é obrigatório.' });
      }

      const { data, error } = await supabase
        .from('patients')
        .upsert([safeBody], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.patch('/api/patients/:id', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const updates = cleanObject({
        name: req.body?.name !== undefined ? sanitizeString(req.body?.name, 160) : undefined,
        email: req.body?.email !== undefined ? sanitizeEmail(req.body?.email) : undefined,
        phone: req.body?.phone !== undefined ? sanitizePhone(req.body?.phone) : undefined,
        age: req.body?.age !== undefined ? asSafeNumber(req.body?.age, 0, 130) : undefined,
        diagnosis: req.body?.diagnosis !== undefined ? sanitizeString(req.body?.diagnosis, 2000) : undefined,
        clinic_id: req.body?.clinic_id !== undefined ? sanitizeString(req.body?.clinic_id, 100) : undefined,
        status: req.body?.status !== undefined ? sanitizeString(req.body?.status, 40) : undefined
      });

      const { error } = await supabase
        .from('patients')
        .update(updates)
        .eq('id', req.params.id);
      
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Secure patient record storage (encrypted JSON payload)
  app.post('/api/patient-records/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.params.patientId, 100);
      if (!patientId) return res.status(400).json({ error: 'patientId inválido' });

      const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
      const encrypted = encryptJsonPayload(payload);
      const pseudonymSeed = [
        sanitizeString(payload?.cpf, 30),
        sanitizeString(payload?.email, 320),
        sanitizePhone(payload?.telefone) || ''
      ].filter(Boolean).join('|') || patientId;

      const row = cleanObject({
        patient_id: patientId,
        clinic_id: sanitizeString(req.session.user?.clinicId || req.session.user?.id, 100),
        therapist_id: sanitizeString(req.session.user?.id, 100),
        pseudonym_id: `pt_${pseudonymizeValue(pseudonymSeed)}`,
        payload_encrypted: encrypted || null,
        payload_preview: cleanObject({
          nome: sanitizeString(payload?.nome, 120),
          nomeSocial: sanitizeString(payload?.nomeSocial, 120),
          grupo: sanitizeString(payload?.grupo, 60),
          convenioNome: sanitizeString(payload?.convenioNome, 120)
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

      res.json({ success: true, encrypted: !!encrypted });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/patient-records/:patientId', checkAuth, checkPatientAccess, async (req: any, res) => {
    try {
      const patientId = sanitizeString(req.params.patientId, 100);
      if (!patientId) return res.status(400).json({ error: 'patientId inválido' });

      const { data, error } = await supabase
        .from('patient_records')
        .select('patient_id, pseudonym_id, payload_encrypted, payload_preview, updated_at')
        .eq('patient_id', patientId)
        .maybeSingle();

      if (error) {
        if (String(error?.message || '').toLowerCase().includes('patient_records')) {
          return res.status(200).json({ success: true, data: null, warning: 'Tabela patient_records não encontrada.' });
        }
        throw error;
      }

      const decryptedPayload = decryptJsonPayload(data?.payload_encrypted);
      res.json({
        success: true,
        data: data
          ? {
              patientId: data.patient_id,
              pseudonymId: data.pseudonym_id,
              payload: decryptedPayload,
              payloadPreview: data.payload_preview,
              updatedAt: data.updated_at
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
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('patient_id', req.params.patientId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/notes/email/:email', checkAuth, async (req: any, res) => {
    try {
      // Only allow if searching for own email OR if therapist
      if (
        req.session.user.role !== 'therapist' &&
        req.session.user.role !== 'coordinator' &&
        req.session.user.role !== 'receptionist' &&
        req.session.user.role !== 'admin' &&
        req.session.user.role !== 'owner' &&
        req.session.user.email !== req.params.email
      ) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('patient_email', req.params.email)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/notes', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'patient', 'admin', 'owner'), async (req: any, res) => {
    try {
      const safeVisibility = new Set(['private', 'shared', 'family', 'professional', 'patient']);
      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: sanitizeString(req.body?.patient_id, 120),
        patient_email: sanitizeEmail(req.body?.patient_email),
        text: sanitizeString(req.body?.text, 12000),
        visibility: safeVisibility.has(String(req.body?.visibility)) ? String(req.body?.visibility) : 'private',
        subject: sanitizeString(req.body?.subject, 100) || 'Geral',
        original_id: sanitizeString(req.body?.original_id, 120) || undefined,
        therapist_id: sanitizeString(req.session.user.id, 120),
        created_at: sanitizeString(req.body?.created_at, 40) || new Date().toISOString()
      });

      if (!payload.patient_id || !payload.text) {
        return res.status(400).json({ error: 'patient_id e texto são obrigatórios.' });
      }

      const { data, error } = await supabase
        .from('notes')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // History
  app.get('/api/history/:patientId', checkAuth, checkPatientAccess, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('history')
        .select('*')
        .eq('patient_id', req.params.patientId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/history/email/:email', checkAuth, async (req: any, res) => {
    try {
      // Only allow if searching for own email OR if therapist/admin
      if (
        req.session.user.role !== 'therapist' &&
        req.session.user.role !== 'coordinator' &&
        req.session.user.role !== 'receptionist' &&
        req.session.user.role !== 'admin' &&
        req.session.user.role !== 'owner' &&
        req.session.user.email !== req.params.email
      ) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { data, error } = await supabase
        .from('history')
        .select('*')
        .eq('patient_email', req.params.email)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/history', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'patient', 'admin', 'owner'), async (req: any, res) => {
    try {
      const safeType = sanitizeString(req.body?.type, 80) || 'task';
      const docData = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: sanitizeString(req.body?.patient_id, 120),
        patient_email: sanitizeEmail(req.body?.patient_email),
        type: safeType,
        title: sanitizeString(req.body?.title, 180),
        score: asSafeNumber(req.body?.score, 0, 100),
        energy: asSafeNumber(req.body?.energy, 0, 100),
        note: sanitizeString(req.body?.note, 12000),
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
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Activity Logs
  app.get('/api/logs', checkAuth, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('user_id', req.session.user.id)
        .order('timestamp', { ascending: false });
      
      if (error) {
        console.error('Supabase logs fetch error:', error);
        throw error;
      }
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Logs route error:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/logs', checkAuth, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .upsert([{
          ...req.body,
          user_id: req.session.user.id
        }], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, id: data.id });
    } catch (error: any) {
      console.error('[Logs] Error saving activity log:', error);
      res.status(500).json({ error: error.message || String(error) });
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

      const address = { cep, logradouro, number, complement, bairro, cidade };

      const { error: userUpdateError } = await supabase
        .from('users')
        .update({
          name: fullName,
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
            sessionDurationMinutes
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

      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...(req.session.user?.clinicSettings ? { clinic_settings: req.session.user.clinicSettings } : {}),
          first_login_completed: true
        }
      });

      req.session.user.name = fullName;
      req.session.user.firstLoginCompleted = true;
      req.session.user.subscriptionStatus = 'active';
      req.session.user.profilePicture = profilePicture || req.session.user.profilePicture || null;
      req.session.user.workspaces = await fetchUserWorkspaces(userId);

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
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('patient_id', req.params.patientId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/tasks/email/:email', checkAuth, async (req: any, res) => {
    try {
      // Only allow if searching for own email OR if therapist/admin
      if (
        req.session.user.role !== 'therapist' &&
        req.session.user.role !== 'coordinator' &&
        req.session.user.role !== 'receptionist' &&
        req.session.user.role !== 'admin' &&
        req.session.user.role !== 'owner' &&
        req.session.user.email !== req.params.email
      ) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('patient_email', req.params.email)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/tasks', checkAuth, requireRoles('coordinator', 'receptionist', 'therapist', 'admin', 'owner'), async (req: any, res) => {
    try {
      const payload = cleanObject({
        id: sanitizeString(req.body?.id, 120) || undefined,
        patient_id: sanitizeString(req.body?.patient_id, 120),
        patient_email: sanitizeEmail(req.body?.patient_email),
        title: sanitizeString(req.body?.title, 180),
        description: sanitizeString(req.body?.description, 4000),
        type: sanitizeString(req.body?.type, 80) || 'task',
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

      const { data, error } = await supabase
        .from('tasks')
        .upsert([payload], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
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
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
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
          userId: user.id
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('FATAL ERROR STARTING SERVER:', err);
  process.exit(1);
});
