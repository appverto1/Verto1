import assert from 'node:assert/strict';
import fs from 'node:fs';

const BRAND_VERSION = '20260818-1';
const HORIZONTAL_LOGO_VERSION = '20261010-1';
const BRAND_DIR = 'public/branding/verto';

const read = (path) => fs.readFileSync(path, 'utf8');
const pngSize = (path) => {
  const buffer = fs.readFileSync(path);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${path} must be a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

const expectedPngs = new Map([
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

for (const [file, [width, height]] of expectedPngs) {
  const path = `${BRAND_DIR}/${file}`;
  assert.ok(fs.existsSync(path), `missing branding asset: ${path}`);
  assert.ok(fs.statSync(path).size > 100, `branding asset unexpectedly small: ${path}`);
  assert.deepEqual(pngSize(path), { width, height }, `unexpected dimensions: ${path}`);
}
assert.ok(fs.existsSync(`${BRAND_DIR}/favicon.ico`), 'missing favicon.ico');
assert.ok(fs.statSync(`${BRAND_DIR}/favicon.ico`).size > 100, 'favicon.ico unexpectedly small');

const branding = read('src/constants/vertoBranding.ts');
assert.match(branding, new RegExp(`VERTO_BRAND_VERSION = '${BRAND_VERSION}'`));
assert.match(branding, new RegExp(`VERTO_HORIZONTAL_LOGO_VERSION = '${HORIZONTAL_LOGO_VERSION}'`));

const index = read('index.html');
assert.match(index, new RegExp(`verto-favicon-16\\.png\\?v=${BRAND_VERSION}`));
assert.match(index, new RegExp(`verto-favicon-32\\.png\\?v=${BRAND_VERSION}`));
assert.match(index, new RegExp(`verto-apple-touch-icon\\.png\\?v=${BRAND_VERSION}`));
const userLogo = `${BRAND_DIR}/verto-logo-user-20261010.svg`;
assert.ok(fs.existsSync(userLogo), 'new Verto horizontal logo missing');
const wrappedLogo = read(userLogo);
assert.match(wrappedLogo, /<svg /);
assert.match(wrappedLogo, /data:image\/webp;base64,/);
assert.ok(fs.statSync(userLogo).size > 2000, 'new horizontal logo is unexpectedly small');
// Social/email clients still get the legacy PNG until a compatible raster
// upload is available. The therapist sidebar is deliberately unchanged.
assert.match(index, /verto-logo-horizontal\.png\?v=20260826-1/);
assert.match(branding, /professionalSidebarHorizontalLogo:/);
assert.match(branding, /verto-logo-user-20261010\.svg/);
assert.match(read('src/components/TherapistDashboard.tsx'), /showText=\{isSidebarExpanded\} preserveProfessionalSidebarBrand/);

const manifest = JSON.parse(read('public/manifest.webmanifest'));
assert.equal(manifest.name, 'Verto');
for (const icon of manifest.icons) {
  assert.match(icon.src, new RegExp(`\\?v=${BRAND_VERSION}$`));
}
assert.ok(manifest.icons.some((icon) => icon.src.includes('verto-icon-192.png')));
assert.ok(manifest.icons.some((icon) => icon.src.includes('verto-icon-512.png')));
assert.ok(manifest.icons.some((icon) => icon.src.includes('verto-maskable-icon.png') && icon.purpose === 'maskable'));

const serviceWorker = read('public/sw.js');
assert.match(serviceWorker, /const SW_VERSION = "verto-branding-v25"/);
assert.match(serviceWorker, new RegExp(`verto-icon-192\\.png\\?v=${BRAND_VERSION}`));
assert.match(serviceWorker, new RegExp(`verto-notification-badge\\.png\\?v=${BRAND_VERSION}`));
assert.match(serviceWorker, /"verto-branding-v15"/);

console.log('vertoBrandingAssets.regression.test.mjs: ok');
