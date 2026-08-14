import assert from 'node:assert/strict';
import fs from 'node:fs';

const matrix = fs.readFileSync('src/components/RoleCapabilityMatrix.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260814120000_authorization_bulk_override_v1.sql', 'utf8');

assert.match(matrix, /Gerenciar profissionais/, 'cada capability delegável deve abrir gestão por profissionais');
assert.match(matrix, /Selecionar profissionais visíveis/, 'gestão deve suportar seleção coletiva');
assert.match(matrix, /Conceder acesso/, 'gestão deve permitir grant explícito');
assert.match(matrix, /Bloquear/, 'gestão deve permitir deny explícito');
assert.match(matrix, /Usar padrão/, 'gestão deve permitir remover override e voltar ao papel');
assert.match(matrix, /registrado no log de autorização/, 'UI deve deixar explícito que a mudança é auditada');

assert.match(dataService, /getClinicCapabilityMembers/, 'frontend deve carregar membros para uma capability em uma única chamada');
assert.match(dataService, /updateClinicCapabilityMembers/, 'frontend deve aplicar lote em uma única chamada');
assert.match(server, /\/api\/clinic\/authorization\/capabilities\/:permissionKey\/members'[\s\S]*?\[GET\]/, 'backend deve expor leitura batch por capability');
assert.match(server, /set_clinic_membership_permission_overrides_bulk_v1/, 'backend deve usar RPC batch em vez de loop de updates');
assert.match(server, /CLINIC_MODULE_NOT_ENTITLED/, 'capabilities de módulos não contratados devem falhar fechado');

assert.match(migration, /security definer/i, 'RPC batch deve ser SECURITY DEFINER');
assert.match(migration, /for update/i, 'RPC batch deve travar memberships alvo durante a mutação');
assert.match(migration, /authorization_audit_events/, 'RPC batch deve registrar auditoria append-only');
assert.match(migration, /existing\.effect is distinct from p_effect/, 'retry idempotente não deve duplicar eventos sem mudança de estado');
assert.match(migration, /on conflict \(membership_id, permission_key\)/i, 'upsert deve ser protegido por unicidade canônica');
assert.doesNotMatch(server, /for\s*\([^)]*memberIds[^)]*\)[\s\S]{0,300}supabase\.rpc\('set_clinic_membership_permission_override_v1'/, 'batch não pode virar N+1 de RPC individual');

console.log('authorizationBulkPermissionManagement.test.ts: ok');
