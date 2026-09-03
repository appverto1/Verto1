import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260903033000_external_care_network_collaboration_v1.sql', import.meta.url), 'utf8');
const external = fs.readFileSync(new URL('../src/components/ExternalEvolutionShare.tsx', import.meta.url), 'utf8');
const central = fs.readFileSync(new URL('../src/components/ExternalCareNetworkCentral.tsx', import.meta.url), 'utf8');
const care = fs.readFileSync(new URL('../src/components/PatientCareNetworkPanel.tsx', import.meta.url), 'utf8');
const timeline = fs.readFileSync(new URL('../src/components/PatientEvolutionTimelinePanel.tsx', import.meta.url), 'utf8');
const bell = fs.readFileSync(new URL('../src/components/ClinicalMentionNotifications.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const inviteContract = fs.readFileSync(new URL('../src/utils/externalEvolutionInviteContract.mjs', import.meta.url), 'utf8');

// Identity is global by normalized email/Auth UID, separate from clinic role/membership.
assert.match(migration, /external_professional_accounts_auth_user_uidx/);
assert.match(migration, /external_professional_accounts_email_uidx/);
assert.match(migration, /FOREIGN KEY \(auth_user_id\) REFERENCES auth\.users\(id\)/);
assert.doesNotMatch(server, /role\s*:\s*['"]external_professional/);
assert.doesNotMatch(server, /\.update\(\{[^}]*role[^}]*external_professional/s);
assert.match(server, /ensureExternalProfessionalAccountForAuthUser/);
assert.match(server, /findAuthUserByEmail\(email\)/);
assert.match(server, /supabase\.auth\.admin\.createUser/);


// Staging drift: migration bootstraps the canonical care-network directory when the historical migration is absent.
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.patient_care_network_contacts/);
assert.match(migration, /EXTERNAL_CARE_NETWORK_PREFLIGHT_ACTIVE_EMAIL_DUPLICATE/);
assert.match(migration, /EXTERNAL_CARE_NETWORK_PREFLIGHT_NONEMPTY_PARTIAL_TABLE/);
assert.match(migration, /idx_patient_care_network_active_patient/);
assert.match(migration, /idx_patient_care_network_active_email/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.patient_care_network_contacts TO service_role/);

// Existing Supabase Auth identities (including Google-only users) are reused without role/membership mutation.
assert.match(server, /app\.post\('\/api\/external\/auth\/session'/);
assert.match(server, /getUserFromAccessToken\(accessToken\)/);
assert.match(server, /tokenMatchesCurrentProject\(accessToken\)/);
assert.match(external, /signInWithOAuth/);
assert.match(external, /provider: 'google'/);
assert.match(external, /Esqueci minha senha/);
assert.match(central, /signInWithOAuth/);
assert.match(app, /External care-network routes own their authenticated context/);
assert.doesNotMatch(server, /\.ilike\('recipient_email', normalizedEmail\)/);

// Activation link is high entropy, hash-only, one-time, expiring, and never OTP.
assert.match(server, /crypto\.randomBytes\(32\)/);
assert.match(server, /createHash\('sha256'\)/);
assert.match(inviteContract, /activation_token/);
assert.match(migration, /token_hash text NOT NULL/);
assert.match(migration, /consumed_at timestamptz/);
assert.match(migration, /invalidated_at timestamptz/);
assert.match(migration, /EXTERNAL_ACTIVATION_TOKEN_EXPIRED_OR_USED/);
assert.match(server, /EXTERNAL_TIMELINE_OTP_RETIRED/);
assert.doesNotMatch(external, /one-time-code/);

// Multi-tenant clinic routes stay scoped; only authenticated external identity gets cross-clinic Central.
assert.match(server, /\.eq\('external_account_id', accountId\)[\s\S]*\.eq\('status', 'ACTIVE'\)/);
assert.match(server, /\.eq\('clinic_id', clinicId\)[\s\S]*\.eq\('patient_id', patientId\)/);
assert.match(server, /checkPatientAccess/);
assert.doesNotMatch(server, /list.*patients.*external.*professional/i);
assert.match(central, /Compartilhados comigo/);
assert.match(central, /Notificações/);
assert.match(central, /Meu perfil/);
assert.match(central, /Carregar mais/);
assert.match(app, /\/rede-de-cuidado/);

// Network membership is only selectable identity; grants remain exact per timeline item.
assert.match(migration, /patient_care_network_contacts_active_email_uidx/);
assert.match(migration, /upsert_patient_evolution_share_grant_v2/);
assert.match(migration, /EVOLUTION_SHARE_CARE_LINK_INACTIVE/);
assert.match(server, /ensureExternalEvolutionGrantCareContact/);
assert.match(timeline, /Estar na Rede de cuidado não concede acesso automático/);
assert.match(timeline, /canComment/);
assert.match(timeline, /Gerenciar compartilhamento/);
assert.match(care, /CARE_NETWORK_PATIENT_REVOCATION_CONFIRMATION_REQUIRED/);

// First view and comment are atomic/idempotent and notify the grant sender only.
assert.match(migration, /record_external_evolution_view_v1/);
assert.match(migration, /WHERE id=p_grant_id FOR UPDATE/);
assert.match(migration, /first_viewed_at=coalesce\(first_viewed_at,v_now\)/);
assert.match(migration, /view_count=coalesce\(view_count,0\)\+1/);
assert.match(migration, /'external-first-view:'\|\|v_grant\.id::text/);
assert.match(migration, /append_external_evolution_comment_v1/);
assert.match(migration, /NOT v_grant\.can_comment/);
assert.match(migration, /ON CONFLICT \(grant_id,idempotency_key\) DO NOTHING/);
assert.match(migration, /recipient_user_id,v_grant\.created_by_user_id|v_grant\.created_by_user_id,v_grant\.timeline_item_id/);
assert.match(server, /EXTERNAL_EVOLUTION_COMMENT_MAX_LENGTH = 4000/);
assert.match(server, /portalActionLimiter[\s\S]*\/comments/);

// Revocation is scoped to clinic+patient and patient lifecycle revokes defensively.
assert.match(migration, /archive_patient_care_network_contact_v2/);
assert.match(migration, /clinic_id = p_clinic_id AND patient_id = p_patient_id AND status = 'ACTIVE'/);
assert.match(migration, /revocation_reason='PATIENT_LEFT_CLINIC'/);
assert.match(migration, /AFTER UPDATE OF is_active, deleted_at, archived_at, status ON public\.patients/);
assert.match(migration, /CARE_NETWORK_PATIENT_REVOCATION_CONFIRMATION_REQUIRED/);

// Exact file/item boundary and no pre-auth PHI.
assert.match(server, /itemId !== sanitizeString\(loaded\.item\?\.id, 120\)/);
assert.match(server, /\.eq\('clinic_id', loaded\.grant\.clinic_id\)\.eq\('patient_id', loaded\.grant\.patient_id\)/);
const preauthStart = server.indexOf("app.get('/api/external/evolution/:publicId'");
const preauthEnd = server.indexOf("app.post('/api/external/evolution/:publicId/access-state'", preauthStart);
const preauth = server.slice(preauthStart, preauthEnd);
for (const leaked of [/patientName:/, /clinicName:/, /subject:/, /content:/, /patient_file_id/]) assert.doesNotMatch(preauth, leaked);

// Same bell, dedicated additive inbox; no Agenda push/portal notification reuse.
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.clinical_inbox_notifications/);
assert.match(migration, /clinical_inbox_notifications_recipient_user_fk/);
assert.match(bell, /clinical_inbox/);
assert.match(bell, /Evolução visualizada/);
assert.match(bell, /Novo comentário em evolução/);
assert.doesNotMatch(migration, /portal_notifications/);

// Migration is additive and backend-only.
assert.match(migration, /^BEGIN;/);
assert.match(migration, /REVOKE ALL ON TABLE public\.external_professional_accounts FROM PUBLIC, anon, authenticated/);
assert.match(migration, /TO service_role/);
assert.match(migration, /pg_notify\('pgrst', 'reload schema'\)/);
assert.match(migration, /COMMIT;\s*$/);
assert.doesNotMatch(migration, /DROP TABLE/i);
assert.doesNotMatch(migration, /TRUNCATE/i);

console.log('externalCareNetworkCollaboration20260903.regression: PASS');
