import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const patientDashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const viewportEffectStart = app.indexOf('const patientPortalViewportActive');
const viewportEffectEnd = app.indexOf('const getLastActiveAccessContextId', viewportEffectStart);
assert.ok(viewportEffectStart >= 0 && viewportEffectEnd > viewportEffectStart, 'patient portal viewport effect must exist');
const viewportEffect = app.slice(viewportEffectStart, viewportEffectEnd);

assert.match(viewportEffect, /root\.style\.width = '100%'/);
assert.match(viewportEffect, /root\.style\.maxWidth = '100%'/);
assert.match(viewportEffect, /root\.style\.removeProperty\('zoom'\)/);
assert.match(viewportEffect, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.match(viewportEffect, /const resetViewport = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no/);
assert.match(viewportEffect, /viewport\.setAttribute\('content', resetViewport\)/);
assert.match(viewportEffect, /window\.setTimeout\(\(\) => \{[\s\S]*viewport\.setAttribute\('content', stableViewport\)/);
assert.match(viewportEffect, /window\.clearTimeout\(resetTimer\)/);
assert.doesNotMatch(viewportEffect, /constrainedWidth/);
assert.doesNotMatch(viewportEffect, /layoutWidth\s*\/\s*screenWidth/);
assert.doesNotMatch(viewportEffect, /100\s*\/\s*correction/);
assert.doesNotMatch(viewportEffect, /setProperty\('zoom', String\(correction\)\)/);
assert.doesNotMatch(viewportEffect, /visualViewport\?\.addEventListener\('resize'/);

assert.match(patientDashboard, /min-h-screen w-full max-w-full/);
assert.match(patientDashboard, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.match(html, /width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes/);

console.log('patientPortalViewportWidth.regression.test.mjs: ok');
