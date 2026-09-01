import { createClient } from '@supabase/supabase-js';

import { sanitizeTechnicalErrorMessage } from '../utils/displayLabels';

// Fetch the Supabase configuration from the server to keep it out of the bundle
const fetchConfig = async (retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('/api/config');
      if (response.status === 429) {
        if (import.meta.env.DEV) console.warn(`Config fetch rate limited (429). Retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        continue;
      }
      if (!response.ok) {
        if (import.meta.env.DEV) console.error(`Config fetch failed with status: ${response.status}`);
        return null;
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        if (import.meta.env.DEV) console.error(`Config fetch returned non-JSON content: ${contentType}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Falha ao buscar configuracao de autenticacao:', sanitizeTechnicalErrorMessage(error));
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
let authUrlExchangePromise: Promise<any> | null = null;
let authUrlExchangeCode = '';

const AUTH_SESSION_READ_TIMEOUT_MS = 1600;
const AUTH_URL_EXCHANGE_TIMEOUT_MS = 8000;

const isSupabaseLockContention = (error: any): boolean => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('lock "') && message.includes('stole it');
};

const withAuthTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallbackValue), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
};

const currentOAuthCodeFromUrl = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const code = String(url.searchParams.get('code') || '').trim();
    if (!code) return '';
    const authAction = String(url.searchParams.get('auth_action') || '').trim().toLowerCase();
    const path = url.pathname.toLowerCase();
    const isKnownAuthCallback =
      path === '/' ||
      path.startsWith('/ativar') ||
      path.startsWith('/reset-password') ||
      path.startsWith('/ativacao-comercial/') ||
      authAction === 'activate' ||
      authAction === 'recovery' ||
      authAction === 'accept_invitation';
    return isKnownAuthCallback ? code : '';
  } catch {
    return '';
  }
};

const removeOAuthCodeFromUrl = (expectedCode: string) => {
  if (typeof window === 'undefined' || !expectedCode) return;
  try {
    const currentUrl = new URL(window.location.href);
    if (String(currentUrl.searchParams.get('code') || '').trim() !== expectedCode) return;
    currentUrl.searchParams.delete('code');
    const next = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}` || '/';
    window.history.replaceState(window.history.state, document.title, next);
  } catch {
    // URL cleanup is UX-only; the authenticated session remains authoritative.
  }
};

const exchangeOAuthCodeOnce = async (client: any, timeoutMs: number) => {
  const code = currentOAuthCodeFromUrl();
  if (!code) return null;

  if (!authUrlExchangePromise || authUrlExchangeCode !== code) {
    authUrlExchangeCode = code;
    const exchangePromise = client.auth
      .exchangeCodeForSession(code)
      .then((result: any) => {
        if (!result?.error && result?.data?.session) removeOAuthCodeFromUrl(code);
        return result;
      })
      .catch((error: any) => ({ data: { session: null }, error }));
    authUrlExchangePromise = exchangePromise.finally(() => {
      if (authUrlExchangePromise === exchangePromise || authUrlExchangeCode === code) {
        authUrlExchangePromise = null;
        authUrlExchangeCode = '';
      }
    });
  }

  const result = await withAuthTimeout(authUrlExchangePromise, timeoutMs, null as any);
  if (!result) {
    if (import.meta.env.DEV) console.warn('Troca OAuth ainda em andamento; liberando a interface sem aguardar indefinidamente.');
    return null;
  }
  if (result?.error) {
    if (import.meta.env.DEV) console.warn('Troca OAuth falhou:', sanitizeTechnicalErrorMessage(result.error?.message || String(result.error)));
    return null;
  }
  return result?.data?.session || null;
};

export const ensureFreshSession = async (
  options: { sessionTimeoutMs?: number; urlExchangeTimeoutMs?: number } = {},
) => {
  const client = await getSupabase();
  if (!client) return null;

  const sessionTimeoutMs = Math.max(250, Number(options.sessionTimeoutMs || AUTH_SESSION_READ_TIMEOUT_MS));
  const urlExchangeTimeoutMs = Math.max(1000, Number(options.urlExchangeTimeoutMs || AUTH_URL_EXCHANGE_TIMEOUT_MS));

  try {
    // OAuth/PKCE URL exchange has a single owner. Supabase automatic URL detection is
    // disabled below so an activation callback cannot race a second manual exchange.
    const urlSession = await exchangeOAuthCodeOnce(client, urlExchangeTimeoutMs);
    if (urlSession) return urlSession;

    // A stalled refresh request must never block ordinary app mutations. The backend
    // also authenticates the existing HTTP-only session cookie, so a short local
    // session timeout can safely fall back to cookie auth.
    const result = await withAuthTimeout(client.auth.getSession(), sessionTimeoutMs, null as any);
    if (!result) {
      if (import.meta.env.DEV) console.warn('Leitura da sessão Supabase excedeu o limite; seguindo com sessão HTTP quando disponível.');
      return null;
    }
    const { data, error } = result;
    if (error) {
      if (import.meta.env.DEV) console.warn('Aviso ao validar sessao:', sanitizeTechnicalErrorMessage(error.message));
      return null;
    }
    return data?.session || null;
  } catch (error: any) {
    if (isSupabaseLockContention(error)) {
      try {
        if (!sessionRetryPromise) {
          sessionRetryPromise = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return withAuthTimeout(client.auth.getSession(), sessionTimeoutMs, null as any);
          })();
        }
        const retried = await sessionRetryPromise;
        sessionRetryPromise = null;
        return retried?.data?.session || null;
      } catch (retryError: any) {
        sessionRetryPromise = null;
        if (import.meta.env.DEV) console.warn('Retry de sessao falhou:', sanitizeTechnicalErrorMessage(retryError?.message || String(retryError)));
        return null;
      }
    }
    if (import.meta.env.DEV) console.warn('Validacao de sessao falhou:', sanitizeTechnicalErrorMessage(error?.message || String(error)));
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
          detectSessionInUrl: false
        }
      });
      
      return supabaseClient;
    } else {
      if (import.meta.env.DEV) {
        console.error('ERRO CRITICO: Configuracoes de autenticacao nao encontradas.', {
          hasUrl: !!url,
          hasKey: !!key,
          configError: sanitizeTechnicalErrorMessage(config?.error || null),
          origin: window.location.origin
        });
      }
      initPromise = null; // Allow retry
      throw new Error(
        isProd
          ? 'Nao foi possivel carregar os dados agora. Tente novamente em alguns instantes.'
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
    if (!client) return { success: false, error: 'Servico de autenticacao indisponivel' };

    const result = await withAuthTimeout(client.auth.getSession(), AUTH_SESSION_READ_TIMEOUT_MS, null as any);
    if (!result) return { success: false, error: 'Tempo esgotado ao validar o serviço de autenticação.' };
    const { error } = result;
    if (error) return { success: false, error: sanitizeTechnicalErrorMessage(error.message) };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: sanitizeTechnicalErrorMessage(err.message) };
  }
};
