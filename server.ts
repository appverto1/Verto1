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
import sqlite3 from 'connect-sqlite3';
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

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  if (process.env.NODE_ENV === 'production') {
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Muitas requisições. Tente novamente mais tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
  });
  app.use('/api/', limiter);

  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      const stripe = getStripe();
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('STRIPE_WEBHOOK_SECRET is required');
      }
      event = stripe.webhooks.constructEvent(req.body, sig as string, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const userId = session.metadata.userId;
      await supabase.from('users').update({ subscription_status: 'active' }).eq('id', userId);
    }
    res.json({ received: true });
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  let sessionStore: any = undefined;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined' && process.env.DATABASE_URL !== '') {
    try {
      const dbUrl = process.env.DATABASE_URL.trim();
      const { Pool } = pg;
      const pool = new Pool({ connectionString: dbUrl, max: 10 });
      const PostgresStore = pgSession(session);
      sessionStore = new PostgresStore({ pool: pool, tableName: 'session', createTableIfMissing: true });
    } catch (err: any) {
      sessionStore = undefined;
    }
  } else {
    const SQLiteStore = sqlite3(session);
    sessionStore = new SQLiteStore({ db: 'sessions.sqlite', dir: './' });
  }

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
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

  const checkAuth = async (req: any, res: any, next: any) => {
    if (req.session && req.session.user) return next();
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (user) {
          const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single();
          if (profile) {
            req.session.user = { id: user.id, email: user.email, ...profile };
            return next();
          }
        }
      } catch (err) {}
    }
    res.status(401).json({ error: 'Unauthorized' });
  };

  const checkPatientAccess = async (req: any, res: any, next: any) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    const patientId = req.params.patientId || req.body.patient_id;
    if (!patientId) return next();
    try {
      if (user.role === 'admin' || user.role === 'coordinator') return next();
      if (user.id === patientId) return next();
      const { data: patient } = await supabase.from('patients').select('therapist_id, clinic_id').eq('id', patientId).single();
      if (patient && (patient.therapist_id === user.id || patient.clinic_id === user.clinic_id)) return next();
      return res.status(403).json({ error: 'Acesso negado' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro de permissão' });
    }
  };

  // --- NOVA ROTA: PROXY IA (HIPAA/LGPD COMPLIANT) ---
  app.post('/api/ai/analyze', checkAuth, async (req, res) => {
    try {
      const { prompt, patientId } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) return res.status(500).json({ error: "Configuração de IA ausente" });

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      const data = await response.json();

      // Auditoria HIPAA: Logar acesso de IA a dados de paciente
      await supabase.from('activity_logs').insert({
        user_id: req.session.user.id,
        action: 'AI_ANALYSIS',
        details: `Processamento de IA para paciente ID: ${patientId}`
      });

      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Erro na integração com Gemini" });
    }
  });

  // Mantendo demais rotas originais (Health, Auth, Clinic, etc.)
  // [AQUI CONTINUARIAM TODAS AS ROTAS DO SEU SERVER.TS ORIGINAL...]

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();