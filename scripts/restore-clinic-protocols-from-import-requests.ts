import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL } from '../src/constants/aflsProtocol';
import { VBMAPP_LEVEL_1_CANONICAL_PROTOCOL } from '../src/constants/vbmappLevel1Protocol';
import { VBMAPP_LEVEL_2_CANONICAL_PROTOCOL } from '../src/constants/vbmappLevel2Protocol';
import { VBMAPP_LEVEL_3_CANONICAL_PROTOCOL } from '../src/constants/vbmappLevel3Protocol';

dotenv.config({ path: '.env' });

const args = new Map<string, string | boolean>();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, true);
  } else {
    args.set(key, next);
    index += 1;
  }
}

const clinicId = String(args.get('clinic-id') || '').trim();
const apply = args.has('apply');
const performedBy = String(args.get('performed-by') || 'system').trim();
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!clinicId) throw new Error('Use --clinic-id <uuid>.');
if (!supabaseUrl || !serviceRoleKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios no .env.');

const canonicalProtocols = new Map<string, any>([
  ['afls-social-participation-adult', AFLS_ADULT_SOCIAL_PARTICIPATION_PROTOCOL],
  ['vb-mapp-level-1', VBMAPP_LEVEL_1_CANONICAL_PROTOCOL],
  ['vb-mapp-level-2', VBMAPP_LEVEL_2_CANONICAL_PROTOCOL],
  ['vb-mapp-level-3', VBMAPP_LEVEL_3_CANONICAL_PROTOCOL]
]);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function normalizeText(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeApprovedProtocolKey(value: any) {
  const key = String(value || '').trim();
  if (['afls', 'afls-social-participation', 'afls-community'].includes(key)) return 'afls-social-participation-adult';
  if (['vb-mapp', 'vbmapp', 'vb mapp', 'vb-mapp-nivel-1'].includes(key)) return 'vb-mapp-level-1';
  if (['vb-mapp-nivel-2', 'vbmapp2', 'vb-mapp2'].includes(key)) return 'vb-mapp-level-2';
  if (['vb-mapp-nivel-3', 'vbmapp3', 'vb-mapp3'].includes(key)) return 'vb-mapp-level-3';
  return key;
}

function inferCanonicalKey(row: any) {
  const explicit = normalizeApprovedProtocolKey(row?.approved_canonical_key || row?.suggested_canonical_key);
  if (canonicalProtocols.has(explicit)) return explicit;
  const source = normalizeText(`${row?.approved_canonical_name || ''} ${row?.suggested_canonical_name || ''} ${row?.protocol_name || ''}`);
  if (source.includes('afls')) return 'afls-social-participation-adult';
  if (source.includes('vb mapp 2') || source.includes('vbmapp 2') || source.includes('nivel 2')) return 'vb-mapp-level-2';
  if (source.includes('vb mapp 3') || source.includes('vbmapp 3') || source.includes('nivel 3')) return 'vb-mapp-level-3';
  if (source.includes('vb mapp') || source.includes('vbmapp')) return 'vb-mapp-level-1';
  return explicit;
}

function identityKeys(protocol: any) {
  return Array.from(new Set([
    protocol?.canonicalKey,
    protocol?.canonical_key,
    protocol?.id,
    protocol?.title,
    protocol?.name,
    protocol?.protocolName
  ].map((value) => normalizeText(normalizeApprovedProtocolKey(value))).filter(Boolean)));
}

function clone(value: any) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function buildProtocol(row: any) {
  const canonicalKey = inferCanonicalKey(row);
  const canonical = canonicalProtocols.get(canonicalKey);
  if (!canonical || !Array.isArray(canonical.data) || canonical.data.length === 0) return null;
  const protocol = clone(canonical);
  const approvedAt = row?.reviewed_at || row?.updated_at || row?.created_at || new Date().toISOString();
  return {
    ...protocol,
    id: protocol.canonicalKey || canonicalKey,
    canonicalKey,
    origin: 'verto_approved_import',
    source: 'protocol_import_requests',
    sourceRequestId: row.id,
    importedAt: row.created_at || approvedAt,
    approvedAt,
    status: 'approved',
    requestStatus: 'approved',
    isApprovedImport: false,
    isManualProtocol: false,
    isLicensed: true
  };
}

function mergeProtocols(existing: any[], approved: any[]) {
  const merged = Array.isArray(existing) ? clone(existing) : [];
  const indexByKey = new Map<string, number>();
  const register = (protocol: any, index: number) => {
    for (const key of identityKeys(protocol)) {
      if (!indexByKey.has(key)) indexByKey.set(key, index);
    }
  };
  merged.forEach(register);
  let added = 0;
  let refreshed = 0;
  for (const protocol of approved) {
    const existingIndex = identityKeys(protocol)
      .map((key) => indexByKey.get(key))
      .find((index) => typeof index === 'number');
    if (typeof existingIndex === 'number') {
      merged[existingIndex] = { ...merged[existingIndex], ...protocol };
      refreshed += 1;
      register(merged[existingIndex], existingIndex);
    } else {
      merged.push(protocol);
      added += 1;
      register(protocol, merged.length - 1);
    }
  }
  return { protocols: merged, added, refreshed };
}

function redactRequestForBackup(row: any) {
  const redacted = { ...row };
  if (redacted.file_data_url) {
    redacted.file_data_url = `[redacted-data-url:${String(redacted.file_data_url).length}]`;
  }
  return redacted;
}

const { data: clinicState, error: stateError } = await supabase
  .from('clinic_state')
  .select('*')
  .eq('clinic_id', clinicId)
  .maybeSingle();
if (stateError) throw stateError;

const { data: requests, error: requestError } = await supabase
  .from('protocol_import_requests')
  .select('*')
  .eq('clinic_id', clinicId)
  .order('created_at', { ascending: true });
if (requestError) throw requestError;

const approvedByKey = new Map<string, any>();
for (const row of requests || []) {
  if (String(row?.status || '').toLowerCase() !== 'approved') continue;
  const key = inferCanonicalKey(row);
  if (!canonicalProtocols.has(key)) continue;
  approvedByKey.set(key, row);
}

const approvedProtocols = Array.from(approvedByKey.values()).map(buildProtocol).filter(Boolean);
const currentProtocols = Array.isArray(clinicState?.protocols) ? clinicState.protocols : [];
const merged = mergeProtocols(currentProtocols, approvedProtocols);
const sourceRequestIds = Array.from(approvedByKey.values()).map((row) => row.id);
const backupDir = path.resolve('backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(
  backupDir,
  `clinic-protocol-restore-${clinicId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
const backup = {
  createdAt: new Date().toISOString(),
  mode: apply ? 'apply' : 'dry-run',
  clinicId,
  before: {
    clinicState,
    protocols: currentProtocols,
    updatedAt: clinicState?.updated_at || null
  },
  protocolImportRequests: (requests || []).map(redactRequestForBackup),
  restorePlan: {
    approvedRequestIds: sourceRequestIds,
    pendingRequestIds: (requests || []).filter((row) => String(row?.status || '').toLowerCase() === 'pending').map((row) => row.id),
    restoredProtocolKeys: approvedProtocols.map((protocol: any) => protocol.canonicalKey),
    previousProtocolCount: currentProtocols.length,
    nextProtocolCount: merged.protocols.length,
    added: merged.added,
    refreshed: merged.refreshed
  }
};
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

if (apply) {
  const nowIso = new Date().toISOString();
  const payload = {
    protocols: merged.protocols,
    updated_at: nowIso,
    updated_by: /^[0-9a-f-]{36}$/i.test(performedBy) ? performedBy : null
  };
  const write = clinicState
    ? await supabase.from('clinic_state').update(payload).eq('clinic_id', clinicId)
    : await supabase.from('clinic_state').insert([{
        clinic_id: clinicId,
        rooms: [],
        appointments: [],
        protocols: merged.protocols,
        specialty_settings: {},
        updated_at: nowIso,
        updated_by: payload.updated_by
      }]);
  if (write.error) throw write.error;

  const auditInsert = await supabase.from('activity_logs').insert([{
    id: crypto.randomUUID(),
    user_id: payload.updated_by || (/^[0-9a-f-]{36}$/i.test(clinicId) ? clinicId : null),
    clinic_id: clinicId,
    action: 'restore_clinic_protocols_from_import_requests',
    action_type: 'restore_clinic_protocols_from_import_requests',
    title: 'Protocolos da clinica restaurados',
    content: `Restaurados ${approvedProtocols.length} protocolo(s) aprovados a partir de protocol_import_requests.`,
    type: 'clinical',
    payload_details: JSON.stringify({
      action: 'restore_clinic_protocols_from_import_requests',
      clinicId,
      restoredProtocols: approvedProtocols.map((protocol: any) => ({
        id: protocol.id,
        canonicalKey: protocol.canonicalKey,
        title: protocol.title
      })),
      sourceRequestIds,
      performedAt: nowIso,
      performedBy
    }),
    source: 'manual_script',
    status: 'active',
    is_active: true,
    timestamp: nowIso,
    created_at: nowIso,
    updated_at: nowIso
  }]);
  if (auditInsert.error) throw auditInsert.error;
}

console.log(JSON.stringify({
  ok: true,
  applied: apply,
  backupPath,
  clinicId,
  approvedRequests: sourceRequestIds.length,
  pendingRequestsIgnored: (requests || []).filter((row) => String(row?.status || '').toLowerCase() === 'pending').length,
  restoredProtocolKeys: approvedProtocols.map((protocol: any) => protocol.canonicalKey),
  previousProtocolCount: currentProtocols.length,
  nextProtocolCount: merged.protocols.length,
  added: merged.added,
  refreshed: merged.refreshed
}, null, 2));
