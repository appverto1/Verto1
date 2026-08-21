import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const patientDashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const viewportUtil = fs.readFileSync(new URL('../src/utils/patientPortalViewport.ts', import.meta.url), 'utf8');
const viewportBootstrap = fs.readFileSync(new URL('../public/patient-viewport-bootstrap.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const viewportEffectStart = app.indexOf('const patientPortalViewportActive');
const viewportEffectEnd = app.indexOf('const getLastActiveAccessContextId', viewportEffectStart);
assert.ok(viewportEffectStart >= 0 && viewportEffectEnd > viewportEffectStart, 'patient portal viewport effect must exist');
const viewportEffect = app.slice(viewportEffectStart, viewportEffectEnd);

assert.match(viewportEffect, /buildPatientPortalViewportContent/);
assert.doesNotMatch(viewportEffect, /lockScale/);
assert.match(viewportEffect, /root\.style\.width = '100%'/);
assert.match(viewportEffect, /root\.style\.maxWidth = '100%'/);
assert.match(viewportEffect, /root\.style\.removeProperty\('zoom'\)/);
assert.doesNotMatch(viewportEffect, /root\.style\.transform/);
assert.doesNotMatch(viewportEffect, /layoutWidth\s*\/\s*screenWidth/);
assert.match(viewportEffect, /body\.style\.touchAction = 'pan-y pinch-zoom'/);
assert.match(viewportEffect, /const defaultViewport = VERTO_FIXED_VIEWPORT_CONTENT/);

assert.match(viewportUtil, /screenWidth < MOBILE_VIEWPORT_MIN_WIDTH/);
assert.match(viewportUtil, /screenWidth > MOBILE_VIEWPORT_MAX_WIDTH/);
assert.match(viewportUtil, /width=device-width, initial-scale=1/);
assert.match(viewportUtil, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.doesNotMatch(viewportUtil, /width=\$\{width\}/);

assert.match(viewportBootstrap, /verto\.patient-portal-session-hint\.v1/);
assert.match(viewportBootstrap, /window\.screen\?\.width/);
assert.match(viewportBootstrap, /width=device-width, initial-scale=1/);
assert.doesNotMatch(viewportBootstrap, /`width=\$\{screenWidth\}, initial-scale=1/);
assert.match(html, /<script src="\/patient-viewport-bootstrap\.js\?v=20260821-1"><\/script>/);
assert.match(html, /width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes/);


let bootstrapViewportContent = '';
vm.runInNewContext(viewportBootstrap, {
  localStorage: { getItem: () => 'patient-session' },
  navigator: { maxTouchPoints: 1 },
  window: {
    screen: { width: 344 },
    matchMedia: () => ({ matches: true }),
  },
  document: {
    querySelector: () => ({
      setAttribute: (name, value) => {
        if (name === 'content') bootstrapViewportContent = value;
      },
    }),
  },
  Number,
  Math,
  Boolean,
});
assert.match(bootstrapViewportContent, /^width=device-width, initial-scale=1/);
assert.match(bootstrapViewportContent, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.match(viewportBootstrap, /__VERTO_PATIENT_VIEWPORT_BOOTSTRAPPED__/);
assert.match(app, /PATIENT_VIEWPORT_BOOTSTRAP_RELOAD_KEY/);
assert.match(app, /window\.location\.replace\(window\.location\.href\)/);
assert.match(app, /resolvePatientPortalViewportWidth/);

assert.match(patientDashboard, /min-h-screen w-full max-w-full/);
assert.doesNotMatch(patientDashboard, /document\.querySelector\('meta\[name="viewport"\]'/);
assert.match(patientDashboard, /viewport global do portal é controlado exclusivamente por App\.tsx/);

console.log('patientPortalViewportWidth.regression.test.mjs: ok');
