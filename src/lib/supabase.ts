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
  if (config && config.supabaseUrl && config.supabaseAnonKey) {
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
  } else {
    // Fallback to env vars if API fails (useful for local dev if not using proxy)
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key);
    }
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
