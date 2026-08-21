import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const landing = fs.readFileSync(new URL('../src/components/LandingPage.tsx', import.meta.url), 'utf8');
const patientDashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const viewportUtil = fs.readFileSync(new URL('../src/utils/patientPortalViewport.ts', import.meta.url), 'utf8');
const viewportBootstrap = fs.readFileSync(new URL('../public/patient-viewport-bootstrap.js', import.meta.url), 'utf8');
const manifestBootstrap = fs.readFileSync(new URL('../public/pwa-manifest-bootstrap.js', import.meta.url), 'utf8');
const prodManifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const stagingManifest = JSON.parse(fs.readFileSync(new URL('../public/manifest-staging.webmanifest', import.meta.url), 'utf8'));
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

const fixedViewport = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover';

assert.match(html, new RegExp(fixedViewport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.doesNotMatch(html, /patient-viewport-bootstrap\.js/);
assert.match(html, /id="verto-manifest" rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(html, /pwa-manifest-bootstrap\.js\?v=20260821-1/);

assert.doesNotMatch(app, /resolvePatientPortalViewportWidth/);
assert.doesNotMatch(app, /buildPatientPortalViewportContent/);
assert.doesNotMatch(app, /PATIENT_VIEWPORT_BOOTSTRAP_RELOAD_KEY/);
assert.doesNotMatch(app, /__VERTO_PATIENT_VIEWPORT_BOOTSTRAPPED__/);
assert.doesNotMatch(app, /window\.screen\?\.(?:width|height|availWidth|availHeight)/);
assert.doesNotMatch(app, /root\.style\.(?:zoom|transform)/);
assert.match(app, /const isAccessGatewayRoute =/);
assert.ok(app.includes("/^\\/entrar\\/?$/i.test(window.location.pathname)"));
assert.match(app, /accessOnly=\{isAccessGatewayRoute \|\| isRunningStandalone\(\)\}/);
assert.match(app, /if \(isRunningStandalone\(\)\) \{[\s\S]*?replaceState\(\{\}, document\.title, '\/entrar'\)/);

assert.match(landing, /accessOnly = false/);
assert.match(landing, /Acesse sua área/);
assert.match(landing, /Área do profissional/);
assert.match(landing, /Área do paciente/);
assert.match(landing, /min-h-\[100dvh\]/);
assert.match(landing, /env\(safe-area-inset-top\)/);
assert.match(landing, /env\(safe-area-inset-bottom\)/);
assert.match(landing, /\{accessOnly \? \(/);
assert.match(landing, /\{!accessOnly && \(/);

assert.equal(prodManifest.start_url, '/entrar');
assert.equal(prodManifest.scope, '/');
assert.equal(prodManifest.display, 'standalone');
assert.equal(prodManifest.name, 'Verto');
assert.equal(stagingManifest.start_url, '/entrar');
assert.equal(stagingManifest.name, 'Verto Staging');
assert.equal(stagingManifest.short_name, 'Verto Staging');
assert.match(server, /normalizedPath\.endsWith\('\.webmanifest'\)/);
assert.match(server, /application\/manifest\+json/);

assert.doesNotMatch(viewportUtil, /Math\.min|screenWidth\s*,\s*params\.screenHeight|width=\$\{/);
assert.match(viewportUtil, /VERTO_FIXED_VIEWPORT_CONTENT/);
assert.match(viewportUtil, /resolveMobileAppViewportWidth = \(_params\?: MobileAppViewportParams\): null => null/);
assert.match(viewportUtil, /buildPatientPortalViewportContent = \(_params\?: MobileAppViewportParams\) =>[\s\S]*VERTO_FIXED_VIEWPORT_CONTENT/);

let viewportContent = '';
vm.runInNewContext(viewportBootstrap, {
  document: {
    querySelector: () => ({
      setAttribute: (name, value) => {
        if (name === 'content') viewportContent = value;
      },
    }),
  },
});
assert.equal(viewportContent, fixedViewport);
assert.doesNotMatch(viewportBootstrap, /screen\?\.|availWidth|mobileAppWidth|__VERTO_MOBILE_APP_VIEWPORT_WIDTH__/);

const runManifestBootstrap = (hostname) => {
  let manifestHref = '/manifest.webmanifest';
  let applicationName = 'Verto';
  let appleName = 'Verto';
  const dataset = {};
  vm.runInNewContext(manifestBootstrap, {
    window: { location: { hostname } },
    document: {
      documentElement: { dataset },
      getElementById: (id) => id === 'verto-manifest'
        ? { setAttribute: (name, value) => { if (name === 'href') manifestHref = value; } }
        : null,
      querySelector: (selector) => {
        if (selector === 'meta[name="application-name"]') {
          return { setAttribute: (_name, value) => { applicationName = value; } };
        }
        if (selector === 'meta[name="apple-mobile-web-app-title"]') {
          return { setAttribute: (_name, value) => { appleName = value; } };
        }
        return null;
      },
    },
    String,
  });
  return { manifestHref, applicationName, appleName, dataset };
};

const production = runManifestBootstrap('appverto.com.br');
assert.equal(production.manifestHref, '/manifest.webmanifest');
assert.equal(production.applicationName, 'Verto');
assert.equal(production.dataset.vertoEnvironment, 'production');

const staging = runManifestBootstrap('api.appverto.com.br');
assert.equal(staging.manifestHref, '/manifest-staging.webmanifest');
assert.equal(staging.applicationName, 'Verto Staging');
assert.equal(staging.appleName, 'Verto Staging');
assert.equal(staging.dataset.vertoEnvironment, 'staging');

assert.match(patientDashboard, /min-h-screen w-full max-w-full/);
assert.doesNotMatch(patientDashboard, /document\.querySelector\('meta\[name="viewport"\]'/);

console.log('patientPortalViewportWidth.regression.test.mjs: ok');
