import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
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

// Initialize Supabase Admin Client (using service role for backend access)
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";

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

const supabase = createClient(supabaseUrl, supabaseServiceKey);

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("AVISO: STRIPE_SECRET_KEY não configurada. Pagamentos não funcionarão.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy is required for rate limiting and secure cookies behind Railway's load balancer
  app.set('trust proxy', 1);

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
      event = stripe.webhooks.constructEvent(
        req.body,
        sig as string,
        process.env.STRIPE_WEBHOOK_SECRET || ''
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

  app.use(express.json());
  app.use(cookieParser());

  // Database Session Store
  // Forçamos o uso de memória (MemoryStore) para evitar erros de rede ENETUNREACH (IPv6)
  // que estão derrubando o servidor.
  const sessionStore = undefined; 
  console.log('Usando armazenamento de sessão em memória para garantir estabilidade.');

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'verto-secret-key',
    resave: false,
    saveUninitialized: false,
    name: 'verto-session',
    cookie: { 
      secure: true, 
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, 
      sameSite: 'none'
    }
  }));

  // Auth Middleware
  const checkAuth = (req: any, res: any, next: any) => {
    if (req.session.user) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
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
        const adminEmails = ['appverto1@gmail.com'];
        const isAdmin = adminEmails.includes(email);
        const roleToUse = isAdmin ? 'admin' : (intendedRole || role || 'therapist');
        
        const freeAccessEmails = ['mateus.com96@gmail.com', 'profissionalmateus1@gmail.com', 'appverto1@gmail.com']; 
        const hasFreeAccess = freeAccessEmails.includes(email);

        const planPrices: Record<string, number> = {
          'Essencial': 149.90,
          'Crescimento': 399.90,
          'Avançado': 679.90,
          'Paciente': 4.90
        };

        const finalPlanName = planName || (roleToUse === 'patient' ? 'Paciente' : 'Essencial');
        const finalPlanPrice = planPrices[finalPlanName] || 149.90;

        const newProfile = {
          id: userId,
          email: email,
          name: name || email.split('@')[0],
          role: roleToUse,
          clinic_id: roleToUse === 'coordinator' ? userId : null, // Coordinator is their own clinic owner
          subscription_status: hasFreeAccess ? 'active' : 'pending',
          plan_name: finalPlanName,
          plan_price: finalPlanPrice,
          acquisition_channel: acquisitionChannel || 'organic',
          created_at: new Date().toISOString(),
          first_login_completed: false // Track onboarding status
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

        // Set session
        const userData = {
          id: userId,
          email: email,
          role: roleToUse,
          name: name || email.split('@')[0],
          subscriptionStatus: hasFreeAccess ? 'active' : 'pending',
          planPrice: finalPlanPrice,
          clinicId: newProfile.clinic_id,
          firstLoginCompleted: false
        };

        req.session.user = userData;
        req.session.isFirstLogin = true;
        
        res.json({ success: true, message: "Conta criada com sucesso!", user: userData, isFirstLogin: true });
      }
    } catch (error: any) {
      console.error("Signup bypass error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Dev Login (For testing when Google OAuth is blocked)
  app.post('/api/auth/dev-login', async (req, res) => {
    const { email } = req.body;
    const allowedDevs = ['appverto1@gmail.com', 'mateus.com96@gmail.com'];
    
    if (!allowedDevs.includes(email)) {
      return res.status(403).json({ error: "Acesso restrito a desenvolvedores" });
    }

    try {
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
      const user = users.find(u => u.email === email);

      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado. Por favor, cadastre-se primeiro." });
      }

      // Fetch profile
      const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();

      // Check for 2FA
      if (profile?.two_factor_enabled) {
        return res.json({ success: true, twoFactorRequired: true, email: user.email });
      }

      const userData = {
        id: user.id,
        email: user.email,
        role: profile?.role || 'therapist',
        name: profile?.name || user.email?.split('@')[0],
        subscriptionStatus: 'active', // Always active for dev login
        planPrice: profile?.role === 'patient' ? 4.90 : 149.90
      };

      req.session.user = userData;
      res.json({ success: true, user: userData, isFirstLogin: req.session.isFirstLogin });
      delete req.session.isFirstLogin; // Clear after sending
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Login (receives Supabase access token from client, verifies it, and sets session)
  app.post('/api/auth/login', async (req, res) => {
    const { accessToken, intendedRole } = req.body;
    console.log('Login attempt with token:', !!accessToken, 'intendedRole:', intendedRole);
    if (!accessToken) return res.status(400).json({ error: "Access token required" });

    try {
      // Verify token with Supabase
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      
      if (error || !user) {
        console.error('Supabase auth error:', error);
        return res.status(401).json({ error: "Invalid token" });
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
        throw profileError;
      }

      // Check for 2FA
      if (profile?.two_factor_enabled) {
        return res.json({ success: true, twoFactorRequired: true, email: user.email });
      }

      // Logic for free access (First Client & AIS Agent Testing)
      const freeAccessEmails = ['mateus.com96@gmail.com', 'profissionalmateus1@gmail.com', 'appverto1@gmail.com']; 
      const adminEmails = ['appverto1@gmail.com'];
      const hasFreeAccess = freeAccessEmails.includes(user.email || "");
      const isAdmin = adminEmails.includes(user.email || "");

      // If profile doesn't exist (first time Google login), create it
      if (!profile) {
        let finalRole = isAdmin ? 'admin' : (intendedRole || 'therapist');
        
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
        }

        const newProfile = {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email?.split('@')[0],
          role: finalRole,
          clinic_id: clinicId,
          subscription_status: hasFreeAccess ? 'active' : 'pending',
          plan_name: finalRole === 'patient' ? 'Paciente' : 'Essencial',
          plan_price: finalRole === 'patient' ? 4.90 : 149.90,
          created_at: new Date().toISOString(),
          first_login_completed: false
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
        profile = createdProfile;
        req.session.isFirstLogin = true;
      } else {
        // Ensure appverto1 is ALWAYS admin even if profile was created differently
        if (isAdmin && profile.role !== 'admin') {
          const { data: updatedProfile } = await supabase
            .from('users')
            .update({ role: 'admin' })
            .eq('id', user.id)
            .select()
            .single();
          if (updatedProfile) profile = updatedProfile;
        } else if (hasFreeAccess && intendedRole && profile.role !== intendedRole) {
          // For testing accounts, allow switching roles
          const { data: updatedProfile } = await supabase
            .from('users')
            .update({ 
              role: intendedRole,
              clinic_id: intendedRole === 'coordinator' ? user.id : profile.clinic_id
            })
            .eq('id', user.id)
            .select()
            .single();
          if (updatedProfile) profile = updatedProfile;
        }
      }

      const userData = {
        id: user.id,
        email: user.email,
        role: profile.role,
        name: profile.name,
        subscriptionStatus: profile.subscription_status,
        planPrice: profile.plan_price,
        clinicId: profile.clinic_id,
        firstLoginCompleted: profile.first_login_completed
      };

      req.session.user = userData;
      res.json({ success: true, user: userData, isFirstLogin: req.session.isFirstLogin });
      delete req.session.isFirstLogin;
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

  // Patients
  app.get('/api/patients', checkAuth, async (req: any, res) => {
    try {
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('therapist_id', req.session.user.id);
      
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
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // User Profile
  app.post('/api/profile/:userId/complete-onboarding', checkAuth, async (req: any, res) => {
    const { userId } = req.params;
    const { name, specialty, crp } = req.body;
    
    if (req.session.user.id !== userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const { error } = await supabase
        .from('users')
        .update({ 
          name, 
          specialty, 
          crp, 
          first_login_completed: true 
        })
        .eq('id', userId);

      if (error) throw error;

      req.session.user.name = name;
      req.session.user.firstLoginCompleted = true;
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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

  app.get('/api/history/email/:email', checkAuth, async (req, res) => {
    try {
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

  app.get('/api/admin/dre', checkAuth, checkAdmin, async (req, res) => {
    try {
      // This would ideally aggregate data from a 'transactions' or 'revenue' table
      // For now, we'll aggregate from the 'users' table based on their active plans
      const { data: profiles } = await supabase
        .from('users')
        .select('plan_name, plan_price, acquisition_channel, subscription_status')
        .eq('subscription_status', 'active');

      const dre = {
        revenue: profiles?.reduce((sum, p) => sum + (p.plan_price || 0), 0) || 0,
        byChannel: profiles?.reduce((acc: any, p) => {
          const channel = p.acquisition_channel || 'organic';
          acc[channel] = (acc[channel] || 0) + (p.plan_price || 0);
          return acc;
        }, {}),
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
      console.log('Creating checkout for user:', user.id, user.email, user.role);
      
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
        
        // Try to get plan from profile if not in session
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('plan_name')
          .eq('id', user.id)
          .single();
          
        if (profileError) {
          console.warn('Could not fetch user profile for plan, using default:', profileError.message);
        }
        
        const planName = profile?.plan_name || 'Essencial';
        amount = planPrices[planName] || 14990;
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
        success_url: `${req.headers.origin}/?payment=success`,
        cancel_url: `${req.headers.origin}/?payment=cancel`,
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
