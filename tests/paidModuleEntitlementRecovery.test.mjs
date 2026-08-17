import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260814172000_repair_empty_paid_module_entitlements.sql', import.meta.url),
  'utf8',
);
const dashboard = fs.readFileSync(
  new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url),
  'utf8',
);

assert.match(migration, /p\.mode = 'contract'/, 'reparo deve atingir apenas perfis contract');
assert.match(
  migration,
  /o\.offer_type = 'modular'[\s\S]*?o\.status = 'paid'[\s\S]*?o\.accepted_at is not null[\s\S]*?o\.revoked_at is null/,
  'reparo deve exigir proposta modular paga, aceita e não revogada',
);
assert.match(
  migration,
  /i\.item_key in \([\s\S]*?'clinical_core'[\s\S]*?'appointments_communication'[\s\S]*?'financial_management'[\s\S]*?'insurance_tiss'[\s\S]*?'school_management'[\s\S]*?\)/,
  'módulos devem vir somente do conjunto operacional conhecido',
);
assert.doesNotMatch(
  migration,
  /platform_foundation|onboarding/,
  'fundação e implantação não podem virar entitlements operacionais',
);
assert.match(
  migration,
  /not exists \([\s\S]*?organization_module_entitlement_events[\s\S]*?'SUSPENDED'[\s\S]*?'CANCELLED'/,
  'reparo não pode ressuscitar contrato explicitamente suspenso/cancelado',
);
assert.match(
  dashboard,
  /verifiedAuthorizationKeyRef/,
  'UI deve preservar contexto já verificado do mesmo workspace em falha transitória',
);
assert.match(
  dashboard,
  /nextMode === "contract" && nextModules\.size === 0/,
  'contract vazio deve ser tratado como provisionamento incompleto, não plano legítimo',
);
assert.match(
  dashboard,
  /retryDelaysMs = \[0, 350, 900\]/,
  'autorização deve ter retry curto somente em falhas',
);

console.log('paidModuleEntitlementRecovery.test.mjs: ok');
