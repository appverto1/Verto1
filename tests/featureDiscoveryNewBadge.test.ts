import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FEATURE_METADATA,
  shouldShowNewBadge,
} from '../src/constants/featureMetadata';

const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const badge = fs.readFileSync('src/components/NewBadge.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const server = readModularServerSource();
const migration = fs.readFileSync('supabase/migrations/20260820101500_user_feature_discovery_v1.sql', 'utf8');

assert.equal(FEATURE_METADATA.clinic_notices.releasedAt, '2026-08-20T00:00:00-03:00');
assert.equal(FEATURE_METADATA.clinic_notices.newForDays, 14);

// A: dentro dos 14 dias + acesso + nunca abriu => visível.
assert.equal(shouldShowNewBadge({
  featureKey: 'clinic_notices',
  hasAccess: true,
  firstAccessedAt: null,
  now: new Date('2026-08-25T12:00:00-03:00'),
}), true);

// B: primeiro acesso já persistido => invisível.
assert.equal(shouldShowNewBadge({
  featureKey: 'clinic_notices',
  hasAccess: true,
  firstAccessedAt: '2026-08-21T12:00:00-03:00',
  now: new Date('2026-08-25T12:00:00-03:00'),
}), false);

// C: janela de 14 dias encerrada => invisível.
assert.equal(shouldShowNewBadge({
  featureKey: 'clinic_notices',
  hasAccess: true,
  firstAccessedAt: null,
  now: new Date('2026-09-03T00:00:00-03:00'),
}), false);

// D: sem acesso ao módulo/capability => invisível.
assert.equal(shouldShowNewBadge({
  featureKey: 'clinic_notices',
  hasAccess: false,
  firstAccessedAt: null,
  now: new Date('2026-08-25T12:00:00-03:00'),
}), false);

// E/H: estado persistido é carregado uma vez e primeiro acesso atualiza a UI sem F5.
assert.match(dashboard, /dataService\.getFeatureAccess\(trackedNewFeatureKeys\)/);
assert.match(dashboard, /activeTab !== "notices"/);
assert.match(dashboard, /setFeatureAccessByKey\(\(current\) => \(\{ \.\.\.current, clinic_notices: optimisticAccessedAt \}\)\)/);
assert.match(dashboard, /dataService\.markFeatureAccessed\("clinic_notices"\)/);
assert.match(dashboard, /newFeatureKey: "clinic_notices"/);
assert.match(dashboard, /featureKey === "clinic_notices" \? canAccessNotices : false/);

// Nenhum request N+1 por badge: o menu lê o mesmo estado em memória.
assert.match(dataService, /\/api\/user\/feature-access\?keys=/);
assert.doesNotMatch(badge, /fetch\(|dataService|supabase/i);

// Visual global discreto e sem semibold.
assert.match(badge, /border-violet-300/);
assert.match(badge, /bg-slate-50/);
assert.match(badge, /font-medium/);
assert.doesNotMatch(badge, /font-semibold/);

// F: concorrência/idempotência garantida por PK + ON CONFLICT DO NOTHING.
assert.match(migration, /primary key \(user_id, feature_key\)/i);
assert.match(migration, /on conflict \(user_id, feature_key\) do nothing/i);
assert.match(migration, /mark_user_feature_accessed_v1/i);

// G: RLS explícita; apenas leitura/inserção própria, sem update/delete para authenticated.
assert.match(migration, /enable row level security/i);
assert.match(migration, /for select[\s\S]*user_id = auth\.uid\(\)/i);
assert.match(migration, /for insert[\s\S]*user_id = auth\.uid\(\)/i);
assert.match(migration, /grant select, insert on table public\.user_feature_access to authenticated/i);
assert.doesNotMatch(migration, /grant[^;]*(update|delete)[^;]*authenticated/i);

// Backend valida feature conhecida e entitlement real antes de ler/gravar.
assert.match(server, /isKnownNewFeatureKey/);
assert.match(server, /context\.modules\.has\('appointments_communication'\)/);
assert.match(server, /context\.capabilities\.has\('communication\.clinic_notifications\.manage'\)/);
assert.match(server, /select\('feature_key,first_accessed_at'\)/);
assert.match(server, /mark_user_feature_accessed_v1/);

console.log('featureDiscoveryNewBadge.test.ts: ok');
