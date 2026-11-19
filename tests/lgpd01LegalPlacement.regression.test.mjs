import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const docs = [
  ['politica-privacidade-verto-v1.1.html', 'POLÍTICA DE PRIVACIDADE E PROTEÇÃO DE DADOS PESSOAIS'],
  ['termos-profissionais-verto-v1.1.html', 'TERMOS DE USO DOS PROFISSIONAIS'],
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

test('LGPD-01: landing and login publish privacy and audience-specific terms without granting consent by silence', () => {
  const page = read('src/components/LandingPage.tsx');
  assert.match(page, /href="\/legal\/politica-privacidade-verto-v1\.1\.html"/);
  assert.match(page, /href="\/legal\/termos-profissionais-verto-v1\.1\.html"/);
  assert.match(page, /href="\/legal\/termos-pacientes-responsaveis-verto-v1\.1\.html"/);
  assert.match(page, /loginType === 'patient'/);
  assert.match(page, /loginType === 'professional'/);
  assert.doesNotMatch(page, /aceito a LGPD/i);
  assert.doesNotMatch(page, /Documentos disponíveis para consulta em homologação/i);
});

test('LGPD-01: invitation and patient relationship confirmation expose legal documents without altering authorization gates', () => {
  const invite = read('src/components/ClinicInvitationAcceptance.tsx');
  assert.match(invite, /dataService\.acceptInvitation\(invitationId\)/);
  assert.match(invite, /href="\/legal\/termos-profissionais-verto-v1\.1\.html"/);
  const confirmation = read('src/components/PortalRelationshipConfirmation.tsx');
  assert.match(confirmation, /href="\/legal\/termos-pacientes-responsaveis-verto-v1\.1\.html"/);
});

test('LGPD-01: contract-master v2.2 acceptance artifact remains unchanged', () => {
  const source = read('src/constants/salesContractDocument.ts');
  assert.match(source, /version: 'contract-master-v2\.2'/);
  assert.match(source, /sourceTextSha256: 'f0becc983a98be9e0b4466a0f22727fd946b608a1f7325696f36a5b4051e4ea3'/);
});
