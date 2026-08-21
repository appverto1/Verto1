import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const patientDashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const viewportUtil = fs.readFileSync(new URL('../src/utils/patientPortalViewport.ts', import.meta.url), 'utf8');
const viewportBootstrap = fs.readFileSync(new URL('../public/patient-viewport-bootstrap.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const viewportEffectStart = app.indexOf('const mobileAppViewportWidth');
const viewportEffectEnd = app.indexOf('const getLastActiveAccessContextId', viewportEffectStart);
assert.ok(viewportEffectStart >= 0 && viewportEffectEnd > viewportEffectStart, 'mobile app viewport effect must exist');
const viewportEffect = app.slice(viewportEffectStart, viewportEffectEnd);

assert.match(viewportEffect, /buildPatientPortalViewportContent/);
assert.match(viewportEffect, /if \(!mobileAppViewportWidth\) return/);
assert.doesNotMatch(viewportEffect, /patientPortalViewportActive/);
assert.doesNotMatch(viewportEffect, /lockScale/);
assert.match(viewportEffect, /root\.style\.width = '100%'/);
assert.match(viewportEffect, /root\.style\.maxWidth = '100%'/);
assert.match(viewportEffect, /root\.style\.removeProperty\('zoom'\)/);
assert.doesNotMatch(viewportEffect, /root\.style\.transform/);
assert.doesNotMatch(viewportEffect, /layoutWidth\s*\/\s*screenWidth/);
assert.match(viewportEffect, /body\.style\.touchAction = 'pan-y pinch-zoom'/);
assert.match(viewportEffect, /const defaultViewport = VERTO_FIXED_VIEWPORT_CONTENT/);

assert.match(viewportUtil, /resolveMobileAppViewportWidth/);
assert.match(viewportUtil, /MOBILE_VIEWPORT_MIN_WIDTH/);
assert.match(viewportUtil, /MOBILE_VIEWPORT_MAX_WIDTH/);
assert.match(viewportUtil, /width=\$\{mobileAppWidth\}, initial-scale=1/);
assert.match(viewportUtil, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.match(viewportUtil, /resolvePatientPortalViewportWidth = resolveMobileAppViewportWidth/);

assert.doesNotMatch(viewportBootstrap, /verto\.patient-portal-session-hint\.v1/);
assert.match(viewportBootstrap, /window\.screen\?\.width/);
assert.match(viewportBootstrap, /window\.screen\?\.availWidth/);
assert.match(viewportBootstrap, /`width=\$\{mobileAppWidth\}, initial-scale=1/);
assert.match(viewportBootstrap, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.match(viewportBootstrap, /__VERTO_MOBILE_APP_VIEWPORT_WIDTH__/);
assert.match(viewportBootstrap, /dataset\.vertoMobileApp = 'true'/);
assert.match(html, /<script src="\/patient-viewport-bootstrap\.js\?v=20260821-2"><\/script>/);
assert.match(html, /width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes/);

let mobileViewportContent = '';
const mobileDocument = {
  documentElement: { dataset: {} },
  querySelector: () => ({
    setAttribute: (name, value) => {
      if (name === 'content') mobileViewportContent = value;
    },
  }),
};
const mobileWindow = {
  screen: { width: 344, height: 720, availWidth: 344, availHeight: 700 },
  matchMedia: () => ({ matches: true }),
};
vm.runInNewContext(viewportBootstrap, {
  navigator: { maxTouchPoints: 1 },
  window: mobileWindow,
  document: mobileDocument,
  Number,
  Math,
  Boolean,
});
assert.match(mobileViewportContent, /^width=344, initial-scale=1/);
assert.match(mobileViewportContent, /minimum-scale=1, maximum-scale=5, user-scalable=yes/);
assert.equal(mobileDocument.documentElement.dataset.vertoMobileApp, 'true');
assert.equal(mobileDocument.documentElement.dataset.vertoMobileAppWidth, '344');
assert.equal(mobileWindow.__VERTO_PATIENT_VIEWPORT_BOOTSTRAPPED__, 344);
assert.equal(mobileWindow.__VERTO_MOBILE_APP_VIEWPORT_WIDTH__, 344);

let landscapeViewportContent = '';
vm.runInNewContext(viewportBootstrap, {
  navigator: { maxTouchPoints: 1 },
  window: {
    screen: { width: 720, height: 344, availWidth: 700, availHeight: 344 },
    matchMedia: () => ({ matches: true }),
  },
  document: {
    documentElement: { dataset: {} },
    querySelector: () => ({
      setAttribute: (name, value) => {
        if (name === 'content') landscapeViewportContent = value;
      },
    }),
  },
  Number,
  Math,
  Boolean,
});
assert.match(landscapeViewportContent, /^width=344, initial-scale=1/, 'phone app viewport must remain mobile-sized in landscape');

let desktopViewportWrites = 0;
vm.runInNewContext(viewportBootstrap, {
  navigator: { maxTouchPoints: 0 },
  window: {
    screen: { width: 1440, height: 900, availWidth: 1440, availHeight: 860 },
    matchMedia: () => ({ matches: false }),
  },
  document: {
    documentElement: { dataset: {} },
    querySelector: () => ({
      setAttribute: () => { desktopViewportWrites += 1; },
    }),
  },
  Number,
  Math,
  Boolean,
});
assert.equal(desktopViewportWrites, 0, 'desktop viewport must remain untouched');

assert.match(app, /PATIENT_VIEWPORT_BOOTSTRAP_RELOAD_KEY/);
assert.match(app, /resolvePatientPortalViewportWidth/);
assert.match(patientDashboard, /min-h-screen w-full max-w-full/);
assert.doesNotMatch(patientDashboard, /document\.querySelector\('meta\[name="viewport"\]'/);
assert.match(patientDashboard, /viewport global do portal é controlado exclusivamente por App\.tsx/);

console.log('patientPortalViewportWidth.regression.test.mjs: ok');
