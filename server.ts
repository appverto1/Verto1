import express from 'express';
import path from 'path';
import fs from 'fs';
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

// Initialize Supabase Admin Client (using service role for backend access)
const supabaseUrl = process.env.SUPABASE_URL || "";
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
  console.error("- SUPABASE_URL:", process.env.SUPABASE_URL ? "✅" : "❌");
  console.error("- VITE_SUPABASE_URL:", process.env.VITE_SUPABASE_URL ? "✅" : "❌");
  console.error("- SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅" : "❌");
  console.error("-------------------------------------");
  
  if (process.env.NODE_ENV === 'production') {
    console.error("O servidor não pode iniciar sem as credenciais do Supabase.");
    process.exit(1);
  }
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("AVISO: STRIPE_SECRET_KEY não configurada. Pagamentos não funcionarão.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy is required for rate limiting and secure cookies behind Railway's load balancer
  app.set('trust proxy', true);
  
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
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Muitas requisições. Tente novamente mais tarde.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    validate: false, // Disable all validation checks for proxy headers
  });
  app.use('/api/', limiter);

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
      secure: true, 
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, 
      sameSite: 'none'
    }
  }));

  // Auth Middleware
  const checkAuth = async (req: any, res: any, next: any) => {
    // 1. Check Session (Cookie-based)
    if (req.session && req.session.user) {
      console.log(`[Auth] Session found for ${req.session.user.email} (Path: ${req.path})`);
      return next();
    }

    const cookieHeader = req.headers.cookie;
    console.log(`[Auth] No session found for ${req.path}. Cookies present:`, !!cookieHeader);
    if (cookieHeader) {
      console.log(`[Auth] Cookie names:`, cookieHeader.split(';').map((c: string) => c.split('=')[0].trim()));
    }

    // 2. Fallback: Check Authorization Header (Token-based)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          console.log(`[Auth] Token verified for ${user.email}`);
          // Re-populate session if missing but token is valid
          const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
          if (profile) {
            req.session.user = {
              id: user.id,
              email: user.email,
              role: profile.role,
              name: profile.name,
              subscriptionStatus: profile.subscription_status,
              planName: profile.plan_name,
              planPrice: profile.plan_price,
              clinicId: profile.clinic_id,
              firstLoginCompleted: profile.first_login_completed || user.user_metadata?.first_login_completed,
              clinicSettings: user.user_metadata?.clinic_settings || null
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
      if (user.role === 'admin' || user.role === 'coordinator') return next();

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
      if (patient.clinic_id && patient.clinic_id === user.clinic_id) {
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
    
    res.json({
      supabaseUrl: url,
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    });
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
      if (!result.valid) return res.status(400).json({ error: "Código inválido" });
      
      // Complete login
      const userData = {
        id: user.id,
        email: user.email,
        role: profile.role,
        name: profile.name,
        subscriptionStatus: profile.subscription_status,
        planPrice: profile.plan_price,
        clinicId: profile.clinic_id
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
        let roleToUse = intendedRole || role || 'therapist';
        
        // If it's a professional signup and no intended role (like from an invitation), default to coordinator
        if (role === 'professional' && !intendedRole) {
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
          clinic_id: roleToUse === 'coordinator' ? userId : null, // Coordinator is their own clinic owner
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

        // Set session
        const userData = {
          id: userId,
          email: email,
          role: roleToUse,
          name: name || email.split('@')[0],
          subscriptionStatus: 'pending',
          planName: finalPlanName,
          planPrice: finalPlanPrice,
          clinicId: newProfile.clinic_id,
          firstLoginCompleted: false
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
  app.post('/api/auth/mock-login', async (req: any, res: any) => {
    const { email, password } = req.body;
    console.log(`[Auth] Mock login attempt for ${email}`);
    
    // Mock passwords are all 123456 for these test accounts
    if (password !== '123456') {
      return res.status(401).json({ error: "Senha incorreta para conta de teste." });
    }

    let mockUser: any = null;

    if (email === 'alexandre@verto.com') {
      mockUser = {
        id: 'mock-alexandre-123',
        email: 'alexandre@verto.com',
        name: 'Alexandre',
        role: 'patient',
        age: 8,
        subscriptionStatus: 'active',
        planName: 'Paciente',
        firstLoginCompleted: true
      };
    } else if (email === 'joao@verto.com') {
      mockUser = {
        id: 'mock-joao-123',
        email: 'joao@verto.com',
        name: 'João',
        role: 'patient',
        age: 28,
        subscriptionStatus: 'active',
        planName: 'Paciente',
        firstLoginCompleted: true
      };
    } else if (email === 'pedro@verto.com') {
      mockUser = {
        id: 'mock-pedro-123',
        email: 'pedro@verto.com',
        name: 'Pedro',
        role: 'patient',
        age: 35,
        subscriptionStatus: 'active',
        planName: 'Paciente',
        firstLoginCompleted: true
      };
    } else if (email === 'coordenador@verto.com') {
      mockUser = {
        id: 'mock-coordenador-123',
        email: 'coordenador@verto.com',
        name: 'Coordenador Verto',
        role: 'coordinator',
        clinicId: 'mock-coordenador-123',
        subscriptionStatus: 'active',
        planName: 'Premium',
        firstLoginCompleted: true
      };
    }

    if (mockUser) {
      req.session.user = mockUser;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error in mock-login:", err);
          return res.status(500).json({ error: "Erro ao salvar sessão de teste" });
        }
        res.json({ success: true, user: mockUser });
      });
    } else {
      res.status(404).json({ error: "Conta de teste não encontrada." });
    }
  });

  // Login (receives Supabase access token from client, verifies it, and sets session)
  app.post('/api/auth/login', async (req, res) => {
    const { accessToken, intendedRole } = req.body;
    console.log('Login attempt with token:', !!accessToken, 'intendedRole:', intendedRole);
    if (!accessToken) return res.status(400).json({ error: "Access token required" });

    try {
      // Verify token with Supabase
      if (!supabaseServiceKey) {
        console.error('[Auth] SUPABASE_SERVICE_ROLE_KEY is missing. Cannot verify token.');
        return res.status(500).json({ error: "Erro de configuração no servidor (Supabase Key)" });
      }

      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      
      if (error || !user) {
        console.error('Supabase auth error:', error?.message || 'No user found');
        return res.status(401).json({ error: "Sessão expirada ou inválida. Por favor, faça login novamente." });
      }

      console.log('User verified:', user.id, user.email);

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
        let finalRole = intendedRole || 'therapist';
        
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
          finalRole = invitation.role;
          
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

        profile = createdProfile;
        req.session.isFirstLogin = true;
      }

      const userData = {
        id: user.id,
        email: user.email,
        role: profile.role,
        name: profile.name,
        subscriptionStatus: profile.subscription_status,
        planName: profile.plan_name,
        planPrice: profile.plan_price,
        clinicId: profile.clinic_id,
        firstLoginCompleted: profile.first_login_completed || user.user_metadata?.first_login_completed,
        clinicSettings: user.user_metadata?.clinic_settings || null
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

  // Clinic Management & Invitations
  app.get('/api/clinic/members', checkAuth, async (req: any, res) => {
    const user = req.session.user;
    if (user.role !== 'coordinator' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas coordenadores podem gerenciar a equipe' });
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('clinic_id', user.clinicId || user.id);
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/clinic/invite', checkAuth, async (req: any, res) => {
    try {
      const { email, role } = req.body;
      const user = req.session.user;

      if (user.role !== 'coordinator' && user.role !== 'admin') {
        return res.status(403).json({ error: 'Apenas coordenadores podem convidar membros' });
      }

      // Check for existing invitation
      const { data: existing } = await supabase
        .from('invitations')
        .select('*')
        .eq('email', email)
        .eq('clinic_id', user.clinicId || user.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existing) {
        return res.status(400).json({ error: 'Já existe um convite pendente para este e-mail' });
      }

      const { data, error } = await supabase
        .from('invitations')
        .insert([{
          email,
          clinic_id: user.clinicId || user.id,
          clinic_name: user.name,
          role,
          status: 'pending',
          invited_by: user.id,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get('/api/clinic/invitations', checkAuth, async (req: any, res) => {
    try {
      const user = req.session.user;
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('clinic_id', user.clinicId || user.id)
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

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/clinic/assign-role', checkAuth, async (req: any, res) => {
    const adminUser = req.session.user;
    if (adminUser.role !== 'coordinator') {
      return res.status(403).json({ error: 'Apenas coordenadores podem atribuir papéis' });
    }

    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'Email e papel são obrigatórios' });

    try {
      // Find user by email
      const { data: targetUser, error: findError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (findError) throw findError;
      if (!targetUser) return res.status(404).json({ error: 'Usuário não encontrado' });

      // Update role and clinic_id
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
          role, 
          clinic_id: adminUser.clinicId || adminUser.id 
        })
        .eq('id', targetUser.id);

      if (updateError) throw updateError;
      res.json({ success: true, message: `Papel ${role} atribuído com sucesso!` });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.patch('/api/clinic/members/:memberId/role', checkAuth, async (req: any, res) => {
    const adminUser = req.session.user;
    if (adminUser.role !== 'coordinator' && adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas coordenadores podem atualizar papéis' });
    }

    const { memberId } = req.params;
    const { role } = req.body;

    if (!role) return res.status(400).json({ error: 'Papel é obrigatório' });

    try {
      const { error } = await supabase
        .from('users')
        .update({ role })
        .eq('id', memberId)
        .eq('clinic_id', adminUser.clinicId || adminUser.id);

      if (error) throw error;
      res.json({ success: true, message: 'Papel atualizado com sucesso' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
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

  app.post('/api/storage/create-bucket', checkAuth, async (req, res) => {
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
        public: true,
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

  // Patients
  app.get('/api/patients', checkAuth, async (req: any, res) => {
    try {
      let query = supabase.from('patients').select('*');
      
      if (req.session.user.role === 'coordinator') {
        query = query.eq('clinic_id', req.session.user.clinicId);
      } else {
        query = query.eq('therapist_id', req.session.user.id);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Supabase patients fetch error:', error);
        throw error;
      }
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Patients route error:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/patients', checkAuth, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .upsert([{ 
          ...req.body, 
          therapist_id: req.session.user.id,
          created_at: req.body.created_at || new Date().toISOString()
        }], { onConflict: 'id' })
        .select()
        .single();
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.patch('/api/patients/:id', checkAuth, async (req, res) => {
    try {
      const { error } = await supabase
        .from('patients')
        .update(req.body)
        .eq('id', req.params.id);
      
      if (error) throw error;
      res.json({ success: true });
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
      if (req.session.user.role !== 'therapist' && req.session.user.role !== 'admin' && req.session.user.email !== req.params.email) {
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

  app.post('/api/notes', checkAuth, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('notes')
        .upsert([{
          ...req.body,
          therapist_id: req.session.user.id,
          created_at: req.body.created_at || new Date().toISOString()
        }], { onConflict: 'id' })
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
      if (req.session.user.role !== 'therapist' && req.session.user.role !== 'admin' && req.session.user.email !== req.params.email) {
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

  app.post('/api/history', checkAuth, async (req: any, res) => {
    try {
      const docData = {
        ...req.body,
        created_at: req.body.created_at || new Date().toISOString(),
        therapist_id: req.session.user.id
      };
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
    const { name, specialty, crp, profilePicture, clinicSettings } = req.body;
    
    console.log(`[Onboarding] Starting for userId: ${userId}`);

    if (req.session.user.id !== userId) {
      console.error(`[Onboarding] ID Mismatch. URL: ${userId}, Session: ${req.session.user.id}`);
      return res.status(401).json({ error: "Unauthorized - ID Mismatch" });
    }

    try {
      // 1. Try to update the profile in Supabase
      // We do this in a way that doesn't fail if columns are missing
      console.log(`[Onboarding] Updating Supabase for ${userId}...`);
      
      const updateData: any = { 
        name,
        subscription_status: 'active'
      };

      // Only add these if they are provided and likely to exist
      if (specialty) updateData.specialty = specialty;
      if (crp) updateData.crp = crp;
      if (profilePicture) updateData.profile_picture = profilePicture;

      try {
        const { error } = await supabase
          .from('users')
          .update(updateData)
          .eq('id', userId);

        if (error) {
          console.warn("[Onboarding] Supabase update had issues, attempting minimal fallback:", error.message);
          // Minimal fallback: just the name
          const { error: fallbackError } = await supabase
            .from('users')
            .update({ 
              name
            })
            .eq('id', userId);
            
          if (fallbackError) {
            console.error("[Onboarding] Fallback also failed:", fallbackError.message);
          }
        }

        // Update user metadata for onboarding tracking - This is our reliable source now
        await supabase.auth.admin.updateUserById(userId, {
          user_metadata: { 
            first_login_completed: true,
            clinic_settings: clinicSettings || null
          }
        });
      } catch (dbErr) {
        console.error("[Onboarding] Database exception (likely schema mismatch):", dbErr);
      }

      // 2. Update the session - This is the most important part for the UI to proceed
      console.log(`[Onboarding] Updating session for ${userId}`);
      if (req.session.user) {
        req.session.user.name = name;
        if (profilePicture) req.session.user.profilePicture = profilePicture;
        req.session.user.firstLoginCompleted = true;
        req.session.user.subscriptionStatus = 'active';
        
        req.session.save((err) => {
          if (err) {
            console.error("[Onboarding] Session save error:", err);
            if (!res.headersSent) {
              return res.status(500).json({ error: "Erro ao salvar sessão" });
            }
            return;
          }
          console.log(`[Onboarding] Success for ${userId}`);
          res.json({ success: true });
        });
      } else {
        console.error("[Onboarding] No session user found during update");
        res.status(401).json({ error: "Sessão expirada" });
      }
    } catch (error: any) {
      console.error("[Onboarding] Critical error:", error);
      res.status(500).json({ error: error.message || "Erro interno no servidor" });
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
      res.json({ success: true, data });
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
      if (req.session.user.role !== 'therapist' && req.session.user.role !== 'admin' && req.session.user.email !== req.params.email) {
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

  app.post('/api/tasks', checkAuth, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('tasks')
        .upsert([{
          ...req.body,
          therapist_id: req.session.user.id,
          created_at: req.body.created_at || new Date().toISOString()
        }], { onConflict: 'id' })
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

startServer();
