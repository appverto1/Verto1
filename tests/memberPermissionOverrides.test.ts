import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const team = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const editor = fs.readFileSync('src/components/MemberPermissionEditor.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260811230000_authorization_override_rpc_v1.sql', 'utf8');

assert.match(server, /\/api\/clinic\/members\/:memberId\/authorization'[\s\S]{0,180}requireClinicCapability\('team\.permissions\.manage'\)/);
assert.match(server, /canDelegateClinicCapability\(\{/);
assert.match(server, /set_clinic_membership_permission_override_v1/);
assert.match(server, /SELF_PERMISSION_CHANGE_DENIED/);

assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = pg_catalog, public/i);
assert.match(migration, /for update/i);
assert.match(migration, /authorization_audit_events/i);
assert.match(migration, /revoke all on function[\s\S]*authenticated/i);
assert.match(migration, /grant execute on function[\s\S]*service_role/i);

assert.match(team, /capabilities\?\.has\('team\.permissions\.manage'\)/);
assert.match(team, /Ajustar acessos/);
assert.match(editor, /type="checkbox"/);
assert.match(editor, /Usar padrão do perfil/);
assert.doesNotMatch(editor, /ALLOW\/DENY/);


assert.match(server, /requestedEffect: effect/);
assert.match(server, /scopeLimited: !defaultEnabled && !canEnable/);
assert.match(editor, /Não disponível para este perfil/);
assert.match(editor, /Mostrar indisponíveis/);
assert.doesNotMatch(editor, /authorization\.scopes\.join/);
console.log('memberPermissionOverrides.test.ts: ok');
