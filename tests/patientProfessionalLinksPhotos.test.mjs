import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const linksUtil = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const panel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');

assert.match(
  server,
  /const usersSelect = 'id,name,email,profile_picture,profile_picture_path'/,
  'a equipe do caso deve carregar a mesma foto persistida no cadastro global do usuário',
);
assert.match(
  server,
  /resolveProfessionalProfilePhotoUrl\(profile, professionalById\.get\(String\(profile\.user_id\)\)\)/,
  'a foto do cadastro global deve ser normalizada para a URL interna de visualização',
);
assert.match(
  server,
  /profile\?\.profile_photo_url \|\| user\?\.profile_picture/,
  'o perfil profissional continua prioritário e o cadastro global funciona como fallback canônico',
);
assert.match(
  linksUtil,
  /profile_photo_url: profile\?\.profile_photo_url \?\? user\?\.profile_picture \?\? null/,
  'a resposta da equipe do caso deve expor a foto sem nova consulta por profissional',
);
assert.match(panel, /<SecureImage src=\{photoSource\}/);

console.log('patientProfessionalLinksPhotos.test.mjs: ok');
