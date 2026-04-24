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

export const ensureFreshSession = async () => {
  const client = await getSupabase();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getSession();
    if (error) {
      console.warn('Supabase getSession warning:', error.message);
      return null;
    }

    const session = data?.session || null;
    if (!session?.refresh_token) return session;

    const expiresAt = Number(session.expires_at || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const shouldRefresh = expiresAt > 0 && expiresAt - nowSeconds <= 60;
    if (!shouldRefresh) return session;

    const refreshed = await client.auth.refreshSession({ refresh_token: session.refresh_token });
    if (refreshed.error) {
      console.warn('Supabase refreshSession warning:', refreshed.error.message);
      return session;
    }
    return refreshed.data?.session || session;
  } catch (error: any) {
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
          detectSessionInUrl: true
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
