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
  const PostgresStore = pgSession(session);
  let sessionStore;
  console.log('DATABASE_URL presente:', !!process.env.DATABASE_URL);
  try {
    if (process.env.DATABASE_URL) {
      sessionStore = new PostgresStore({ 
        conString: process.env.DATABASE_URL, 
        createTableIfMissing: true,
        schemaName: 'public',
        tableName: 'sessions'
      });
      console.log('Armazenamento de sessão no banco de dados configurado.');
    }
  } catch (err) {
    console.error('ERRO AO INICIALIZAR PG-SESSION:', err);
  }

  console.log('Session store initialized:', !!sessionStore);
  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'verto-secret-key',
    resave: false,
    saveUninitialized: false,
    name: 'verto-session',
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
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

  // --- API ROUTES ---
  
  // Direct Signup (Bypasses email confirmation using Admin API)
  app.post('/api/auth/signup-direct', async (req, res) => {
    const { email, password, name, role, intendedRole } = req.body;
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
        const roleToUse = intendedRole || role || 'therapist';
        const freeAccessEmails = ['mateus.com96@gmail.com', 'profissionalmateus1@gmail.com', 'appverto1@gmail.com']; 
        const hasFreeAccess = freeAccessEmails.includes(email);

        const newProfile = {
          id: userId,
          email: email,
          name: name || email.split('@')[0],
          role: roleToUse,
          clinic_id: roleToUse === 'coordinator' ? userId : null, // Coordinator is their own clinic owner
          subscription_status: hasFreeAccess ? 'active' : 'pending',
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
        
        res.json({ success: true, message: "Conta criada e confirmada com sucesso!" });
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
    if (!accessToken) return res.status(400).json({ error: "Access token required" });

    try {
      // Verify token with Supabase
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      
      if (error || !user) {
        return res.status(401).json({ error: "Invalid token" });
      }

      // Fetch user profile from 'users' table
      let { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      // Logic for free access (First Client & AIS Agent Testing)
      const freeAccessEmails = ['mateus.com96@gmail.com', 'profissionalmateus1@gmail.com', 'appverto1@gmail.com']; 
      const hasFreeAccess = freeAccessEmails.includes(user.email || "");

      // If profile doesn't exist (first time Google login), create it
      if (!profile) {
        const roleToUse = intendedRole || 'therapist';
        
        // Check for pending invitations for this email
        const { data: invitations, error: inviteError } = await supabase
          .from('invitations')
          .select('*')
          .eq('email', user.email)
          .eq('status', 'pending');

        let clinicId = roleToUse === 'coordinator' ? user.id : null;
        let finalRole = roleToUse;

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
          plan_price: finalRole === 'patient' ? 4.90 : 149.90,
          plan_name: finalRole === 'patient' ? 'Paciente' : 'Essencial',
          created_at: new Date().toISOString()
        };
        
        const { data: createdProfile, error: createError } = await supabase
          .from('users')
          .insert([newProfile])
          .select()
          .single();
          
        if (!createError) {
          profile = createdProfile;
          req.session.isFirstLogin = true; // Flag for frontend
        } else {
          console.error("Error creating profile during login:", createError);
        }
      } else if (profile && hasFreeAccess && intendedRole && profile.role !== intendedRole) {
        // For first client, allow switching roles for testing
        const { data: updatedProfile, error: updateError } = await supabase
          .from('users')
          .update({ 
            role: intendedRole,
            clinic_id: intendedRole === 'coordinator' ? user.id : profile.clinic_id
          })
          .eq('id', user.id)
          .select()
          .single();
          
        if (!updateError) {
          profile = updatedProfile;
        }
      }
      
      const userData = {
        id: user.id,
        email: user.email,
        role: profile?.role || 'therapist',
        name: profile?.name || user.email?.split('@')[0],
        age: profile?.age,
        clinicId: profile?.clinic_id,
        subscriptionStatus: hasFreeAccess ? 'active' : (profile?.subscription_status || 'pending'),
        planPrice: (profile?.role === 'patient' || intendedRole === 'patient') ? 4.90 : (profile?.plan_price || 149.90)
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
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
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
      
      if (error) throw error;
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ error: String(error) });
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

  // --- STRIPE ROUTES ---
  app.post('/api/stripe/create-checkout', checkAuth, async (req, res) => {
    try {
      const user = req.session.user;
      
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
        const { data: profile } = await supabase
          .from('users')
          .select('plan_name')
          .eq('id', user.id)
          .single();
          
        const planName = profile?.plan_name || 'Essencial';
        amount = planPrices[planName] || 14990;
        description = `Plano ${planName} - Verto`;
      }

      const stripe = getStripe();
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

      res.json({ url: session.url });
    } catch (error) {
      console.error('Stripe checkout error:', error);
      res.status(500).json({ error: 'Erro ao criar sessão de pagamento' });
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
    res.status(500).send('Internal Server Error: ' + (process.env.NODE_ENV === 'production' ? 'Ocorreu um erro no servidor.' : err.message));
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
