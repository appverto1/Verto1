import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  buildPatientReminderNotificationPayload,
  resolveBrandingContext,
  VERTO_NOTIFICATION_ICON_URL,
} from '../src/services/notificationBranding';
import { VERTO_BRAND_ASSETS, VERTO_BRAND_VERSION } from '../src/constants/vertoBranding';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const asset = (file: string) => join(root, 'public', 'branding', 'verto', file);

const readPngInfo = (file: string) => {
  const buffer = readFileSync(file);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  const idatChunks: Buffer[] = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idatChunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const colorType = buffer[25];
  const scanlines = inflateSync(Buffer.concat(idatChunks));
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType,
    cornerAlpha: colorType === 6 ? scanlines[4] : 255,
  };
};

const requiredPngs = new Map<string, [number, number]>([
  ['verto-symbol.png', [1000, 1000]],
  ['verto-logo-horizontal.png', [1000, 286]],
  ['verto-favicon-16.png', [16, 16]],
  ['verto-favicon-32.png', [32, 32]],
  ['verto-apple-touch-icon.png', [180, 180]],
  ['verto-icon-192.png', [192, 192]],
  ['verto-icon-512.png', [512, 512]],
  ['verto-maskable-icon.png', [512, 512]],
  ['verto-notification-badge.png', [96, 96]],
]);

for (const [file, [width, height]] of requiredPngs) {
  const path = asset(file);
  assert.equal(existsSync(path), true, `${file} precisa existir`);
  assert.ok(statSync(path).size > 100, `${file} nao pode estar vazio`);
  const info = readPngInfo(path);
  assert.deepEqual({ width: info.width, height: info.height }, { width, height });
  assert.equal(info.colorType, 6, `${file} precisa preservar canal alpha`);
  assert.equal(
    info.cornerAlpha,
    file === 'verto-maskable-icon.png' ? 255 : 0,
    `${file} precisa ter o fundo tecnico correto`,
  );
}

const favicon = readFileSync(asset('favicon.ico'));
assert.equal(favicon.readUInt16LE(0), 0);
assert.equal(favicon.readUInt16LE(2), 1);
assert.equal(favicon.readUInt16LE(4), 2);
assert.equal(favicon[6], 16);
assert.equal(favicon[22], 32);

assert.equal(VERTO_BRAND_VERSION, '20260716-2');
assert.match(VERTO_BRAND_ASSETS.symbol, /\/branding\/verto\/verto-symbol\.png\?v=20260716-2$/);
assert.match(VERTO_BRAND_ASSETS.horizontalLogo, /\/branding\/verto\/verto-logo-horizontal\.png\?v=20260716-2$/);

const common = read('src/components/Common.tsx');
assert.match(common, /showText \? VERTO_BRAND_ASSETS\.horizontalLogo : VERTO_BRAND_ASSETS\.symbol/);
assert.doesNotMatch(common, /assets\/Logoverto|<span[^>]*>\s*verto\s*<\/span>/i);

const index = read('index.html');
assert.match(index, /\/branding\/verto\/favicon\.ico\?v=20260716-2/);
assert.match(index, /\/branding\/verto\/verto-favicon-16\.png\?v=20260716-2/);
assert.match(index, /\/branding\/verto\/verto-favicon-32\.png\?v=20260716-2/);
assert.match(index, /\/branding\/verto\/verto-apple-touch-icon\.png\?v=20260716-2/);

const manifest = JSON.parse(read('public/manifest.webmanifest'));
assert.deepEqual(
  manifest.icons.map((icon: any) => [icon.src, icon.sizes, icon.purpose]),
  [
    ['/branding/verto/verto-icon-192.png?v=20260716-2', '192x192', 'any'],
    ['/branding/verto/verto-icon-512.png?v=20260716-2', '512x512', 'any'],
    ['/branding/verto/verto-maskable-icon.png?v=20260716-2', '512x512', 'maskable'],
  ],
);

const clinicBranding = resolveBrandingContext({
  clinic: { id: 'clinic-a', displayName: 'Clinica A', logoUrl: 'https://cdn.example.com/clinic-a.png' },
});
const clinicPush = buildPatientReminderNotificationPayload({ appointmentId: 'appointment-a', branding: clinicBranding });
assert.equal(clinicPush.icon, 'https://cdn.example.com/clinic-a.png');
assert.equal(clinicPush.data.brandLogoUrl, 'https://cdn.example.com/clinic-a.png');

const fallbackBranding = resolveBrandingContext({ clinic: { id: 'clinic-b', logoUrl: VERTO_BRAND_ASSETS.symbol } });
const fallbackPush = buildPatientReminderNotificationPayload({ appointmentId: 'appointment-b', branding: fallbackBranding });
assert.equal(fallbackPush.icon, VERTO_NOTIFICATION_ICON_URL);
assert.equal(fallbackPush.data.brandLogoUrl, null);

const patientDashboard = read('src/components/PatientDashboard.tsx');
assert.match(patientDashboard, /const safeLogoUrl = firstPortalLogoUrl\(logoUrl\)/);
assert.match(patientDashboard, /return safeLogoUrl \? \(/);
assert.match(patientDashboard, /<SecureImage[\s\S]*?src=\{safeLogoUrl\}[\s\S]*?fallback=\{fallback\}/);
assert.match(patientDashboard, /VERTO_BRAND_ASSETS\.symbol/);

const serviceWorker = read('public/sw.js');
assert.match(serviceWorker, /brandLogo \|\| payloadIcon \|\| VERTO_NOTIFICATION_ICON/);
assert.match(serviceWorker, /const badgeUrl = asNotificationAssetUrl\(VERTO_NOTIFICATION_BADGE\)/);
assert.match(serviceWorker, /LEGACY_VERTO_CACHE_NAMES\.has\(cacheName\)/);
assert.doesNotMatch(serviceWorker, /cacheNames\s*\.map\(\(cacheName\) => self\.caches\.delete/);

const emailTemplates = read('src/services/emailTemplates.ts');
const server = read('server.ts');
assert.match(emailTemplates, /VERTO_EMAIL_HORIZONTAL_LOGO_URL/);
assert.doesNotMatch(emailTemplates, /resend-attachments\.s3\.amazonaws\.com/);
assert.match(server, /VERTO_EMAIL_HORIZONTAL_LOGO_URL/);

for (const legacyPath of [
  'public/icon-192.png',
  'public/icon-512.png',
  'public/apple-touch-icon.png',
  'public/verto-3d-transparent.png',
  'public/verto-3d.png',
  'src/assets/Logoverto.png',
]) {
  assert.equal(existsSync(join(root, legacyPath)), false, `${legacyPath} nao deve permanecer duplicado`);
}

console.log('verto rebranding checks passed');
