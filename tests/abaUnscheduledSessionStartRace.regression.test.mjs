import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260825123000_clinical_plan_context_link_and_unscheduled_session_claim.sql', 'utf8');

assert.match(migration, /add column if not exists start_claim_key text/, 'sessão sem agenda deve possuir chave persistente de claim');
assert.match(migration, /create unique index if not exists ux_aba_sessions_active_start_claim_v1[\s\S]*lower\(status\) in \('active', 'in_progress'\)/, 'banco deve impedir duas sessões sem agenda ativas com o mesmo claim');
assert.doesNotMatch(migration, /update\s+public\.aba_sessions[\s\S]*start_claim_key/i, 'migration não deve alterar retrospectivamente sessões antigas');

assert.match(server, /unscheduledStartClaimKey[\s\S]*unscheduled:\$\{clinicId\}:\$\{patientId\}:\$\{resolvedProfessionalId\}/, 'claim deve ser determinístico por clínica, paciente e profissional');
assert.match(server, /\.eq\('start_claim_key', unscheduledStartClaimKey\)[\s\S]*\.in\('status', \['active', 'in_progress', 'IN_PROGRESS'\]\)/, 'nova tentativa deve reutilizar sessão vigente pelo claim exato');
assert.match(server, /criticalColumns:\s*unscheduledStartClaimKey \? \['start_claim_key'\] : \[\]/, 'fallback de schema não pode remover silenciosamente a proteção de corrida');
assert.match(server, /23505\|ux_aba_sessions_active_start_claim_v1\|start_claim_key/, 'corrida concorrente deve reconhecer a violação de unicidade');
assert.match(server, /winnerResult[\s\S]*idempotent:\s*true/, 'perdedor da corrida deve retornar a sessão vencedora como replay idempotente');

console.log('abaUnscheduledSessionStartRace.regression.test.mjs: ok');
