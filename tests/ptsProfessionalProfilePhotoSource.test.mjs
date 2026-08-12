import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');

assert.match(
  server,
  /async function resolveProfessionalProfilePhotoUrl\(profile: any, user\?: any\)[\s\S]*metadata\?\.profilePicturePath[\s\S]*user\?\.profile_picture_path[\s\S]*resolvePatientPhotoUrl/,
  'a foto profissional deve reutilizar o mesmo path persistido nas configurações profissionais',
);
assert.match(
  server,
  /profilesSelect = 'user_id,specialty,council,council_number,profile_photo_url,metadata'/,
  'equipe do caso deve carregar metadata da foto em lote',
);
assert.match(
  server,
  /\.select\('user_id,full_name,specialty,profile_photo_url,metadata'\)/,
  'PTS deve carregar metadata da foto em lote',
);
assert.match(
  server,
  /const user: any = linkedUserById\.get\(String\(professionalId\)\)[\s\S]*profile_photo_url: await resolveProfessionalProfilePhotoUrl\(profile, user\)/,
  'PTS deve resolver a foto canônica com fallback do usuário em lote',
);
assert.doesNotMatch(
  server,
  /profile_photo_url: sanitizeUrl\(profile\?\.profile_photo_url\)/,
  'URLs internas de foto não podem ser descartadas pelo sanitizador de URL externa',
);
assert.match(dashboard, /<SecureImage[\s\S]*professionalPhotoSource\(responsible\)/);
assert.match(dashboard, /<SecureImage[\s\S]*professionalPhotoSource\(professional\)/);

console.log('ptsProfessionalProfilePhotoSource.test.mjs: ok');
