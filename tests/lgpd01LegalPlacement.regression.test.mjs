import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const docs = [
  ['politica-privacidade-verto-v1.1.html', 'POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS PESSOAIS'],
  ['termos-pacientes-responsaveis-verto-v1.1.html', 'TERMOS DE USO DO PORTAL DO PACIENTE'],
  ['dpa-verto-v1.0-modelo.html', 'ACORDO DE TRATAMENTO DE DADOS PESSOAIS'],
];

test('LGPD-02: páginas exibem o texto jurídico sem capas ou avisos de homologação', () => {
  for (const [file, heading] of docs) {
    const html = read(`public/legal/${file}`);
    assert.match(html, /<html lang="pt-BR">/);
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
    assert.ok(html.includes(heading), file);
    assert.match(html, /<body><main><pre>[\s\S]*<\/pre><\/main><\/body>/);
    assert.doesNotMatch(html, /Documento em homologação|Disponível somente para homologação|Voltar à Verto|Verto · Documentação jurídica/i);
    assert.doesNotMatch(html, /<script\b|<form\b/i);
  }
  const privacy = read('public/legal/politica-privacidade-verto-v1.1.html');
  assert.doesNotMatch(privacy, /\[(?:RAZÃO SOCIAL DA VERTO|E-MAIL\/CANAL|CANAL DE PRIVACIDADE|●)\]/);
  assert.doesNotMatch(privacy, /25\.1\. Razão social:/);
  assert.match(privacy, /23\. Canal de privacidade e encarregado/);
  assert.match(privacy, /24\. Alterações/);
});

test('LGPD-03: remove visual-only versions and faux acceptance boxes without deleting substantive clauses', () => {
  for (const [file] of docs) {
    const html = read(`public/legal/${file}`);
    const body = html.match(/<body><main><pre>([\s\S]*?)<\/pre><\/main><\/body>/)?.[1];
    assert.ok(body, file);
    assert.doesNotMatch(body, /(?:^|\n)Versão:\s*v\d+\.\d+/i, file);
    assert.doesNotMatch(body, /☐|Li e aceito os Termos de Uso do Portal|Li e aceito os Termos de Uso dos Profissionais/i, file);
  }

  const professional = read('services/legal/professional-terms-v1.1.html');
  assert.match(professional, /11\. Automação e IA/);
  assert.match(professional, /20\.2\. Quando novo aceite for juridicamente necessário/);
  assert.doesNotMatch(professional, /21\. Aceite/);
  const patient = read('public/legal/termos-pacientes-responsaveis-verto-v1.1.html');
  assert.match(patient, /20\.2\. Estes Termos não impedem reclamação à clínica/);
  assert.doesNotMatch(patient, /21\. Aceite/);
});

test('LGPD-03: homepage footer discloses only public privacy policy while login links are portal-specific', () => {
  const page = read('src/components/LandingPage.tsx');
  const footer = page.slice(page.indexOf('{/* Footer */}'));
  assert.match(footer, /href="\/legal\/politica-privacidade-verto-v1\.1\.html"/);
  assert.doesNotMatch(footer, /\/legal\/termos-(?:profissionais|pacientes)/);
  const modal = page.slice(page.indexOf('{/* Login Modal */}'), page.indexOf('{/* Footer */}'));
  assert.match(modal, /loginType === 'patient'[\s\S]*?termos-pacientes-responsaveis-verto-v1\.1\.html/);
  assert.doesNotMatch(modal, /\/legal\/termos-profissionais-verto-v1\.1\.html/);
});

test('LGPD-01: landing and login publish privacy and audience-specific terms without granting consent by silence', () => {
  const page = read('src/components/LandingPage.tsx');
  assert.match(page, /href="\/legal\/politica-privacidade-verto-v1\.1\.html"/);
  assert.doesNotMatch(page, /href="\/legal\/termos-profissionais-verto-v1\.1\.html"/);
  assert.match(page, /href="\/legal\/termos-pacientes-responsaveis-verto-v1\.1\.html"/);
  assert.match(page, /loginType === 'patient'/);
  assert.match(page, /loginType === 'professional'/);
  assert.doesNotMatch(page, /aceito a LGPD/i);
  assert.doesNotMatch(page, /Documentos disponíveis para consulta em homologação/i);
});

test('LGPD-01: invitation and patient relationship confirmation expose legal documents without altering authorization gates', () => {
  const invite = read('src/components/ClinicInvitationAcceptance.tsx');
  assert.match(invite, /dataService\.acceptInvitation\(invitationId, acceptProfessionalTerms\)/);
  assert.match(invite, /\/api\/legal\/professional-terms\?invitation_id=/);
  const confirmation = read('src/components/PortalRelationshipConfirmation.tsx');
  assert.match(confirmation, /href="\/legal\/termos-pacientes-responsaveis-verto-v1\.1\.html"/);
});

test('LGPD-04: terms are served only by an authenticated professional or verified invite recipient', () => {
  const routes = read('services/legalProfessionalTermsRoutes.ts');
  const server = read('server.ts');
  const menu = read('src/components/SettingsMenu.tsx');
  assert.match(routes, /isProfessionalLegalSession\(req\.session\?\.user\)/);
  assert.match(routes, /\.from\('invitations'\)/);
  assert.match(routes, /\.select\('email,status,expires_at'\)/);
  assert.match(routes, /deps\.checkAuth, authorizeDocument/);
  assert.match(routes, /deps\.checkAuth, authorizeProfessional/);
  assert.match(routes, /Cache-Control', 'private, no-store/);
  assert.match(server, /registerProfessionalTermsRoutes\(app, \{ supabase, checkAuth \}\)/);
  assert.match(menu, /window\.open\('\/api\/legal\/professional-terms'/);
  assert.doesNotMatch(read('src/components/LandingPage.tsx'), /\/legal\/termos-profissionais-verto-v1\.1\.html/);
});

test('LGPD-04: invitation acceptance and professional onboarding persist legal proof on the server', () => {
  const server = read('server.ts');
  const migration = read('supabase/migrations/20261120180000_professional_terms_acceptance_v1.sql');
  const invite = read('src/components/ClinicInvitationAcceptance.tsx');
  const onboarding = read('src/components/ProfessionalOnboarding.tsx');
  assert.match(server, /req\.body\?\.acceptProfessionalTerms !== true/);
  assert.match(server, /termsConfirmed: true/);
  assert.match(server, /accept_clinic_invitation_with_terms_v1/);
  assert.match(server, /ensureProfessionalTermsAccepted\(/);
  assert.match(server, /error: 'PROFESSIONAL_TERMS_REQUIRED'/);
  assert.match(onboarding, /dataService\.getProfessionalTermsStatus\(\)/);
  assert.match(onboarding, /acceptProfessionalTerms: !previousTermsAcceptance && acceptProfessionalTerms/);
  assert.match(invite, /checked=\{acceptProfessionalTerms\}/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.user_legal_acceptances from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.accept_clinic_invitation_with_terms_v1/);
  assert.match(migration, /on conflict on constraint user_legal_acceptances_unique_v1 do nothing/);
});

test('LGPD-01: contract-master v2.2 acceptance artifact remains unchanged', () => {
  const source = read('src/constants/salesContractDocument.ts');
  assert.match(source, /version: 'contract-master-v2\.2'/);
  assert.match(source, /sourceTextSha256: 'f0becc983a98be9e0b4466a0f22727fd946b608a1f7325696f36a5b4051e4ea3'/);
});
