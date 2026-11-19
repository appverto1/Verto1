import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'scripts/image-webp-report.json'), 'utf8'));
assert.equal(report.version, 1);
assert.equal(report.images.length, 71, 'image inventory must be regenerated if sources change');

let sourceBytes = 0, desktopBytes = 0, totalDerivatives = 0;
for (const image of report.images) {
  const original = path.join(root, image.source);
  assert.ok(fs.existsSync(original), `original fallback exists: ${image.source}`);
  assert.equal(fs.statSync(original).size, image.originalBytes);
  assert.ok(image.derivatives.length > 0);
  sourceBytes += image.originalBytes;
  desktopBytes += image.derivatives.at(-1).bytes;
  for (const derivative of image.derivatives) {
    const file = path.join(root, derivative.file);
    assert.ok(fs.existsSync(file), `missing WebP: ${derivative.file}`);
    const buffer = fs.readFileSync(file);
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
    assert.equal(buffer.length, derivative.bytes);
    assert.ok(derivative.bytes < image.originalBytes, `unnecessary bytes: ${derivative.file}`);
    assert.ok(derivative.width <= image.originalWidth, 'no upscaled images');
    totalDerivatives++;
  }
}
assert.ok(desktopBytes < sourceBytes * 0.55, 'webp variants should reduce transfer');
assert.equal(report.images.filter(x => x.source.startsWith('services/help-media/')).length, 65);
for (const asset of ['verto-icon-192.png','verto-icon-512.png','verto-maskable-icon.png','verto-notification-badge.png','verto-favicon-16.png','verto-favicon-32.png','verto-apple-touch-icon.png']) {
  assert.ok(fs.existsSync(path.join(root, 'public/branding/verto', asset)), 'PWA assets must remain PNG');
}
const logo = fs.readFileSync(path.join(root,'src/components/Common.tsx'),'utf8');
assert.match(logo, /<picture/);
assert.match(logo, /type="image\/webp"/);
assert.match(logo, /verto-symbol-128\.webp 128w/);
assert.match(logo, /preserveProfessionalSidebarBrand/);
const tutorial = fs.readFileSync(path.join(root, 'src/components/HelpTutorialArticle.tsx'),'utf8');
assert.match(tutorial, /srcSet=/);
assert.match(tutorial, /w=640 640w/);
assert.match(tutorial, /width=\{1363\} height=\{936\}/);
const routes = fs.readFileSync(path.join(root,'services/helpCenterRoutes.ts'),'utf8');
assert.match(routes, /HELP_MEDIA_NOT_FOUND/);
assert.match(routes, /private, no-store/);
assert.match(routes, /image\/webp/);
assert.match(routes, /\?\.w/);
console.log('image WebP audit PASS:', report.images.length, 'sources,', totalDerivatives, 'derivatives,', Math.round((1-desktopBytes/sourceBytes)*100), '% smaller desktop variants');
