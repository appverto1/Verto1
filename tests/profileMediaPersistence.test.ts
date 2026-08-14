import assert from 'node:assert/strict';
import fs from 'node:fs';

const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const patientDashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const settingsMenu = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

assert.match(dataService, /async saveUserProfile[\s\S]*?saveOfflineFirst\(`profile:\$\{userId\}`,[\s\S]*?'profile'/,
  'perfil profissional deve usar outbox durável');
assert.match(dataService, /async updatePatientSelfProfile[\s\S]*?saveOfflineFirst\('profile:self',[\s\S]*?'PATCH'\)/,
  'perfil do paciente deve usar outbox durável e PATCH mesclável');
assert.match(patientDashboard, /profilePicturePath: upload\.path[\s\S]*?updatePatientSelfProfile/,
  'upload da foto deve persistir também o path canônico');
assert.match(server, /app\.get\('\/api\/profile\/:userId\/media'[\s\S]*?profilePicturePath:[\s\S]*?signaturePath:/,
  'leitura de mídia deve devolver paths persistidos, não apenas URLs temporárias');
assert.match(server, /Merge metadata so one partial update does not erase previously persisted media paths\.[\s\S]*?profilePicturePath:[\s\S]*?existingMetadata\?\.profilePicturePath[\s\S]*?signaturePath:[\s\S]*?existingMetadata\?\.signaturePath/,
  'update parcial do perfil deve preservar paths de mídia já gravados');
assert.match(server, /extractPatientPhotosStoragePath\(metadata\.profilePicturePath[\s\S]*?buildPatientPhotoViewUrl/,
  'URLs de visualização devem ser reconstruídas a partir do path persistente');

assert.match(settingsMenu, /SecureImage[\s\S]*?profilePicturePath/,
  'avatar do menu deve aceitar URL segura ou path persistido da foto');
assert.match(server, /function sanitizeSessionUrl[\s\S]*?buildPatientPhotoViewUrl/,
  'sessão deve preservar proxy interno de foto reconstruído a partir do path canônico');
assert.match(server, /profilePicture:[\s\S]*?professionalMetadata\?\.profilePicturePath/,
  'payload de sessão deve recuperar foto também do path do perfil profissional');
assert.match(app, /profilePicturePath:[\s\S]*?profileUpload\.path/,
  'estado frontend deve manter o path persistente imediatamente após upload');

console.log('profileMediaPersistence.test.ts: ok');
