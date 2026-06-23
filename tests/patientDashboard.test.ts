import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const patientDashboardCode = readFileSync(join(root, 'src/components/PatientDashboard.tsx'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function between(startMarker: string, endMarker: string) {
  const start = patientDashboardCode.indexOf(startMarker);
  const end = patientDashboardCode.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return patientDashboardCode.slice(start, end);
}

test('home Kids continua renderizando metricas, graficos, protocolo e diario da familia', () => {
  const kidsBlock = between('if (isKidsProfile) {', 'const dailyReviewTasks = useMemo');
  const requiredMarkers = [
    "portalSection === 'home' &&",
    'Registros 7d',
    'kidsGamification.weekLogs',
    'kidsGamification.stars',
    'Fotos 7d',
    'kidsGamification.weekPhotos',
    'Protocolo ativo atual',
    'selectedBaseDate',
    'selectedCompareDate',
    'EvolutionBarChart',
    'CumulativeGrowthChart',
    'Últimos Registros do Diário da Família',
    'familyDiaryHistory',
    'Diário da Família',
    'handleConfirmFamilyNote',
    'DrawingCanvas'
  ];

  for (const marker of requiredMarkers) {
    assert.ok(kidsBlock.includes(marker), `${marker} deve permanecer na home Kids.`);
  }
});

test('menu Kids usa hamburger e agenda fica fora da home', () => {
  assert.match(patientDashboardCode, /const portalMenu = isKidsProfile \? null : \(/);
  assert.match(patientDashboardCode, /portalMenuItems\.map\(\(item\) =>/);
  assert.match(patientDashboardCode, /onClick=\{\(\) => \{ setPortalSection\(item\.id\); setIsMenuOpen\(false\); \}\}/);
  assert.match(patientDashboardCode, /\.\.\.\(!isKidsProfile \? \[\{ id: 'tasks', label: 'Tarefas'/);
  assert.match(patientDashboardCode, /{!isKidsProfile && \(\s*<div className="mb-6 grid gap-3 sm:grid-cols-2">[\s\S]*setPortalSection\('tasks'\)/);
  const homeSummary = between('const portalAnamnesisTopNotice =', 'const renderPortalAnamnesisField');
  assert.doesNotMatch(homeSummary, /portalKidsAppointmentsSummary/);
  assert.doesNotMatch(homeSummary, /setPortalSection\('appointments'\)/);
  assert.doesNotMatch(homeSummary, /Pr.ximas consultas/);
  assert.match(patientDashboardCode, /\{ id: 'appointments', label: isKidsProfile \? 'Calend.rio' : 'Consultas'/);
});

test('notificacoes Kids priorizam nome e logo da clinica resolvida', () => {
  const notificationName = between('const getPortalNotificationClinicName =', 'const getPortalNotificationMessage');
  assert.match(notificationName, /portalContext\?\.clinicName/);
  assert.match(notificationName, /firstPortalClinicText/);
  assert.match(notificationName, /notification\?\.title/);
  assert.match(patientDashboardCode, /looksLikePortalProfessionalLabel/);
  assert.ok(notificationName.indexOf('portalContext?.clinicName') < notificationName.indexOf('metadata.clinicName'));
  const openNotification = between('const openPortalNotification =', 'const updatePortalAppointmentInList');
  assert.match(openNotification, /clinicName: firstPortalClinicText/);
  assert.match(openNotification, /clinicLogoUrl: portalContext\?\.clinicLogoUrl/);
  const notificationSummary = between('const portalNotificationsSummary =', 'const portalHomeSummary');
  assert.match(notificationSummary, /<span className="font-black text-slate-950">\{clinicName\}<\/span> \{message\}/);
  const appointmentModal = between('const portalAppointmentDetailModal =', 'const portalActionModal =');
  assert.doesNotMatch(appointmentModal, />Status</);
  assert.doesNotMatch(appointmentModal, />Local</);
  assert.doesNotMatch(appointmentModal, />Profissional</);
});

test('persistencia visual Kids continua baseada em dados existentes e nao mocks', () => {
  assert.match(patientDashboardCode, /portalFamilyHistory = useMemo/);
  assert.match(patientDashboardCode, /familyDiaryHistory = useMemo/);
  assert.match(patientDashboardCode, /const isFamily = item\.type === 'family_note' \|\| item\.type === 'photo'/);
  assert.match(patientDashboardCode, /const itemPatientId = String\(item\?\.patientId \|\| item\?\.patient_id \|\| ''\)\.trim\(\)/);
  assert.match(patientDashboardCode, /persistedFamilyDiaryHistory/);
  assert.match(patientDashboardCode, /portalSharedNotes/);
  assert.match(patientDashboardCode, /\[\.\.\.persistedFamilyDiaryHistory, \.\.\.normalizedSharedNotes\]/);
  assert.match(patientDashboardCode, /kidsGamification = useMemo/);
  assert.match(patientDashboardCode, /const stars = portalFamilyHistory\.filter/);
  assert.match(patientDashboardCode, /activeKidsProtocolEvents/);
  assert.match(patientDashboardCode, /patientId=\{portalPatientId \|\| user\.id\}/);
  assert.doesNotMatch(patientDashboardCode, /mock[A-Z]|fake[A-Z]|dummy[A-Z]/);
});

test('diario da familia preserva path de foto e aguarda persistencia do historico', () => {
  assert.match(patientDashboardCode, /const \[familyImagePath, setFamilyImagePath\] = useState<string \| null>\(null\)/);
  assert.match(patientDashboardCode, /const FAMILY_DAILY_PHOTO_LIMIT = 5/);
  assert.match(patientDashboardCode, /const familyPhotoCountToday = useMemo/);
  assert.match(patientDashboardCode, /familyPhotoCountToday >= FAMILY_DAILY_PHOTO_LIMIT/);
  assert.match(patientDashboardCode, /let persistedImagePath: string \| undefined = familyImagePath \|\| undefined/);
  assert.match(patientDashboardCode, /if \(!portalPatientId\) \{\s*throw new Error\('Não encontramos um paciente vinculado/);
  assert.match(patientDashboardCode, /const saveResult = await onAddFamilyNote\(portalPatientId, familyNote, persistedImage, persistedImagePath\)/);
  assert.doesNotMatch(patientDashboardCode, /onAddFamilyNote\(portalPatientId \|\| user\.id/);
  assert.match(patientDashboardCode, /setFamilyImagePath\(result\.path \|\| null\)/);
  assert.match(patientDashboardCode, /setFamilyImagePath\(null\); setIsDrawingMode\(false\)/);
  assert.match(patientDashboardCode, /setFamilyImagePath\(null\);\s*setIsFamilyLogOpen\(false\)/);
  assert.match(patientDashboardCode, /const getFamilyDiaryImageSource = \(entry: any\) =>/);
  assert.match(patientDashboardCode, /entry\?\.image_path/);
  assert.match(patientDashboardCode, /path\.startsWith\('patient-photos\/'\)/);
  assert.match(patientDashboardCode, /<SecureImage\s+src=\{getFamilyDiaryImageSource\(entry\)\}/);
  assert.doesNotMatch(patientDashboardCode, /1 foto\/dia|apenas 1 foto/);
  const kidsBlock = between('if (isKidsProfile) {', 'const dailyReviewTasks = useMemo');
  assert.doesNotMatch(kidsBlock, /<img[\s\S]{0,220}alt="Registro do diário"/);
});

test('estrelinhas Kids contam apenas registros do proprio paciente e comecam em zero', () => {
  assert.match(patientDashboardCode, /const portalStarPatientKeys = new Set/);
  assert.match(patientDashboardCode, /const sharedNoteBelongsToPortalPatient = \(item: any\) =>/);
  assert.match(patientDashboardCode, /return false;\s*\};\s*const scopedSharedNotes = \(Array\.isArray\(sharedNotes\) \? sharedNotes : \[\]\)\.filter\(sharedNoteBelongsToPortalPatient\)/);
  assert.match(patientDashboardCode, /const sharedFamilyStars = scopedSharedNotes\.filter/);
  assert.match(patientDashboardCode, /scopedSharedNotes\.forEach\(\(item: any\) =>/);

  const sharedNotesProp = appCode.slice(
    appCode.indexOf('sharedNotes={therapistNotes.filter'),
    appCode.indexOf('protocols={protocols}', appCode.indexOf('sharedNotes={therapistNotes.filter'))
  );
  assert.match(sharedNotesProp, /const currentPatientIds = new Set/);
  assert.match(sharedNotesProp, /const belongsById =/);
  assert.match(sharedNotesProp, /const belongsByEmail =/);
  assert.match(sharedNotesProp, /return belongsById \|\| belongsByEmail/);
  assert.doesNotMatch(sharedNotesProp, /if \(user\.role === 'patient'\) \{\s*return isPatientNote;\s*\}/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} patient dashboard checks passed`);
