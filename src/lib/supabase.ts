import { createClient } from '@supabase/supabase-js';

// Fetch the Supabase configuration from the server to keep it out of the bundle
const fetchConfig = async (retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('/api/config');
      if (response.status === 429) {
        console.warn(`Config fetch rate limited (429). Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        continue;
      }
      if (!response.ok) {
        console.error(`Config fetch failed with status: ${response.status}`);
        return null;
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Config fetch returned non-JSON content: ${contentType}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch Supabase config:', error);
      if (i === retries - 1) return null;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  return null;
};

let supabaseClient: any = null;
let initPromise: Promise<any> | null = null;
let sessionRetryPromise: Promise<any> | null = null;

const isSupabaseLockContention = (error: any): boolean => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('lock "') && message.includes('stole it');
};

const shouldDetectSessionInUrl = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const search = window.location.search.toLowerCase();
  const authSignals = ['access_token=', 'refresh_token=', 'code=', 'token_hash='];
  const hasAuthSignal = authSignals.some((signal) => hash.includes(signal) || search.includes(signal));
  if (hasAuthSignal) return true;
  return path.includes('/auth/callback') || path.includes('/ativar') || path.includes('/reset-password');
};

export const ensureFreshSession = async () => {
  const client = await getSupabase();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      console.warn('Supabase getSession warning:', error.message);
      return null;
    }
    // We keep this lightweight and avoid forced manual refresh here.
    // Supabase autoRefreshToken handles renewal internally; forcing refresh with a stale
    // token can trigger SIGNED_OUT loops in production.
    return data?.session || null;
  } catch (error: any) {
    if (isSupabaseLockContention(error)) {
      try {
        if (!sessionRetryPromise) {
          sessionRetryPromise = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return client.auth.getSession();
          })();
        }
        const retried = await sessionRetryPromise;
        sessionRetryPromise = null;
        return retried?.data?.session || null;
      } catch (retryError: any) {
        sessionRetryPromise = null;
        console.warn('ensureFreshSession retry failed:', retryError?.message || String(retryError));
        return null;
      }
    }
    console.warn('ensureFreshSession failed:', error?.message || String(error));
    return null;
  }
};

export const getSupabase = async () => {
  if (supabaseClient) return supabaseClient;
  
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const config = await fetchConfig();
    const isProd = import.meta.env.PROD;
    const url = isProd
      ? config?.supabaseUrl
      : (config?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL);
    const key = isProd
      ? config?.supabaseAnonKey
      : (config?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY);

    if (url && key) {
      supabaseClient = createClient(url, key, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: shouldDetectSessionInUrl()
        }
      });
      
      return supabaseClient;
    } else {
      console.error('ERRO CRÍTICO: Configurações do Supabase não encontradas!', {
        hasUrl: !!url,
        hasKey: !!key,
        configError: config?.error || null,
        origin: window.location.origin
      });
      initPromise = null; // Allow retry
      throw new Error(
        isProd
          ? 'Falha de configuração segura do ambiente de autenticação (AUTH_CONFIG_PROD_MISSING).'
          : 'O sistema não pôde inicializar a conexão com o banco de dados.'
      );
    }
  })();

  return initPromise;
};

// Legacy export for compatibility (will be null until initialized)
export const supabase = {} as any;

export const testSupabaseConnection = async () => {
  try {
    const client = await getSupabase();
    if (!client) return { success: false, error: 'Supabase client not initialized' };
    
    const { data, error } = await client.auth.getSession();
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};
