import { createClient, SupabaseClient } from '@supabase/supabase-js';

const GUARDED_SCHEMA_TABLES = new Set(['users', 'clinics', 'appointments']);
const guardedClientPrototypes = new WeakSet<object>();

export type RouteSchemaCatalog = {
  schemaVersion?: number;
  [key: string]: unknown;
};

type LoggerLike = Pick<Console, 'log' | 'warn'>;

type GuardInstallParams = {
  clientPrototype: any;
  targetSupabaseUrl: string;
  catalog: RouteSchemaCatalog;
  logger?: LoggerLike;
};

type StartupInstallParams = {
  deploymentEnv: string | null | undefined;
  env?: NodeJS.ProcessEnv;
  logger?: LoggerLike;
  clientPrototype?: any;
  createCatalogClient?: typeof createClient;
};

const normalizeUrl = (value: unknown) => String(value ?? '').trim().replace(/\/+$/, '');

function availableColumnsForTable(catalog: RouteSchemaCatalog, table: string): Set<string> | null {
  const tableEntry = catalog?.[table];
  if (!tableEntry || typeof tableEntry !== 'object' || Array.isArray(tableEntry)) return null;
  const columns = (tableEntry as any).columns;
  if (!columns || typeof columns !== 'object' || Array.isArray(columns)) return null;
  return new Set(
    Object.entries(columns)
      .filter(([, available]) => available === true)
      .map(([column]) => column),
  );
}

export function filterFlatSelectColumnsForSchema(
  selectColumns: unknown,
  availableColumns: Set<string>,
): string {
  const original = String(selectColumns ?? '*').trim() || '*';
  if (original === '*' || original.includes('(') || original.includes(')')) return original;

  const tokens = original
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return original;

  let removed = 0;
  const filtered = tokens.filter((token) => {
    // Only rewrite plain top-level column names. Aliases, casts, JSON paths and
    // relationship expressions remain untouched so the guard cannot change
    // PostgREST semantics it does not understand.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) return true;
    if (availableColumns.has(token)) return true;
    removed += 1;
    return false;
  });

  return removed > 0 && filtered.length > 0 ? filtered.join(',') : original;
}

export function installSupabaseSchemaSelectGuard(params: GuardInstallParams) {
  const prototype = params.clientPrototype;
  const targetSupabaseUrl = normalizeUrl(params.targetSupabaseUrl);
  if (!prototype || typeof prototype.from !== 'function' || !targetSupabaseUrl) {
    return { installed: false, guardedTables: [] as string[] };
  }
  if (guardedClientPrototypes.has(prototype)) {
    return { installed: true, guardedTables: Array.from(GUARDED_SCHEMA_TABLES) };
  }

  const tableColumns = new Map<string, Set<string>>();
  for (const table of GUARDED_SCHEMA_TABLES) {
    const available = availableColumnsForTable(params.catalog, table);
    if (available && available.size > 0) tableColumns.set(table, available);
  }
  if (tableColumns.size === 0) {
    return { installed: false, guardedTables: [] as string[] };
  }

  const originalFrom = prototype.from;
  prototype.from = function guardedFrom(relation: string) {
    const builder = originalFrom.call(this, relation);
    const currentSupabaseUrl = normalizeUrl((this as any)?.supabaseUrl);
    const availableColumns = tableColumns.get(String(relation || ''));
    if (
      currentSupabaseUrl !== targetSupabaseUrl ||
      !availableColumns ||
      !builder ||
      typeof builder.select !== 'function'
    ) {
      return builder;
    }

    const originalSelect = builder.select.bind(builder);
    builder.select = (columns = '*', options?: any) => {
      const compatibleSelect = filterFlatSelectColumnsForSchema(columns, availableColumns);
      return originalSelect(compatibleSelect, options);
    };
    return builder;
  };

  guardedClientPrototypes.add(prototype);
  params.logger?.log?.('[Schema Catalog] SELECT guard instalado para staging.', {
    guardedTables: Array.from(tableColumns.keys()),
  });
  return { installed: true, guardedTables: Array.from(tableColumns.keys()) };
}

export async function installStagingSupabaseSchemaSelectGuard(params: StartupInstallParams) {
  const deploymentEnv = String(params.deploymentEnv || '').trim().toLowerCase();
  if (deploymentEnv !== 'staging') {
    return { installed: false, guardedTables: [] as string[], reason: 'environment' as const };
  }

  const env = params.env || process.env;
  const supabaseUrl = normalizeUrl(env.SUPABASE_URL);
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    params.logger?.warn?.('[Schema Catalog] Guard não instalado: credenciais server-side indisponíveis.');
    return { installed: false, guardedTables: [] as string[], reason: 'configuration' as const };
  }

  try {
    const createCatalogClient = params.createCatalogClient || createClient;
    const catalogClient = createCatalogClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await catalogClient.rpc('get_verto_route_schema_capabilities');
    if (error) throw error;
    if (!data || typeof data !== 'object' || Number((data as any).schemaVersion || 0) < 2) {
      throw new Error('ROUTE_SCHEMA_CAPABILITIES_V2_REQUIRED');
    }

    const result = installSupabaseSchemaSelectGuard({
      clientPrototype: params.clientPrototype || SupabaseClient.prototype,
      targetSupabaseUrl: supabaseUrl,
      catalog: data as RouteSchemaCatalog,
      logger: params.logger,
    });
    return { ...result, reason: result.installed ? 'catalog' as const : 'catalog_empty' as const };
  } catch (error: any) {
    // Fail safe for rolling deploy/transient metadata failures: do not change
    // query semantics if the catalog cannot be trusted. Existing route-level
    // fallbacks remain available and Auth/RLS errors are never swallowed here.
    params.logger?.warn?.('[Schema Catalog] Guard não instalado; fallback legado preservado.', {
      message: String(error?.message || error || '').slice(0, 240),
    });
    return { installed: false, guardedTables: [] as string[], reason: 'catalog_unavailable' as const };
  }
}
