import { createClient } from '@supabase/supabase-js';

// Fetch the Supabase configuration from the server to keep it out of the bundle
const fetchConfig = async () => {
  try {
    const response = await fetch('/api/config');
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch Supabase config:', error);
    return null;
  }
};

let supabaseClient: any = null;

export const getSupabase = async () => {
  if (supabaseClient) return supabaseClient;
  
  const config = await fetchConfig();
  const url = config?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
  const key = config?.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (url && key) {
    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: true
      }
    });
    
    // Check if session is valid, if not clear it to avoid "Invalid Refresh Token" errors
    supabaseClient.auth.getSession().then(({ data: { session }, error }: any) => {
      if (error && error.message.includes('Refresh Token Not Found')) {
        console.warn('Stale session detected, clearing Supabase storage...');
        supabaseClient.auth.signOut();
      }
    });
  } else {
    console.error('ERRO CRÍTICO: Configurações do Supabase não encontradas!', {
      hasUrl: !!url,
      hasKey: !!key,
      origin: window.location.origin
    });
    throw new Error('O sistema não pôde inicializar a conexão com o banco de dados. Verifique as variáveis de ambiente no Railway.');
  }
  
  return supabaseClient;
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
