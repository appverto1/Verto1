import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  beginClinicalPortalOAuth,
  clearClinicalPortalOAuthIntent,
  completeClinicalPortalOAuth,
  consumeClinicalPortalOAuthError,
  failClinicalPortalOAuth,
  isClinicalPortalOAuthBlocked,
  readClinicalPortalOAuthIntent,
} from '../src/lib/clinicalPortalOAuth';

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('explicit patient Google login is tracked across redirect and cleared only on authorized success', () => {
  const store = storage();
  beginClinicalPortalOAuth(store, 'patient');
  assert.equal(readClinicalPortalOAuthIntent(store), 'patient');
  assert.equal(isClinicalPortalOAuthBlocked(store), false);
  completeClinicalPortalOAuth(store);
  assert.equal(readClinicalPortalOAuthIntent(store), null);
  assert.equal(isClinicalPortalOAuthBlocked(store), false);
  assert.equal(consumeClinicalPortalOAuthError(store), null);
});

test('denied patient access never falls back to a previous professional session', () => {
  const store = storage();
  beginClinicalPortalOAuth(store, 'patient');
  failClinicalPortalOAuth(store, 'patient', 'INVALID_CREDENTIALS');
  assert.equal(readClinicalPortalOAuthIntent(store), null);
  assert.equal(isClinicalPortalOAuthBlocked(store), true);
  assert.deepEqual(consumeClinicalPortalOAuthError(store), {
    portal: 'patient',
    message: 'Acesso não disponível para este portal com esta conta e método de autenticação.',
  });
  assert.equal(isClinicalPortalOAuthBlocked(store), true, 'reading a UX error must not re-enable stale session restoration');
  assert.equal(consumeClinicalPortalOAuthError(store), null);
  beginClinicalPortalOAuth(store, 'patient');
  assert.equal(isClinicalPortalOAuthBlocked(store), false, 'only a fresh explicit login clears the failed-attempt block');
  clearClinicalPortalOAuthIntent(store);
  assert.equal(readClinicalPortalOAuthIntent(store), null);
  // A fresh, explicitly selected professional login must still work after
  // the patient denial for an account that is a legitimate clinic director.
  beginClinicalPortalOAuth(store, 'professional');
  assert.equal(isClinicalPortalOAuthBlocked(store), false);
  assert.equal(readClinicalPortalOAuthIntent(store), 'professional');
  clearClinicalPortalOAuthIntent(store);
  assert.equal(isClinicalPortalOAuthBlocked(store), false);
});

test('temporary OAuth failures do not enumerate accounts, roles or clinics', () => {
  const store = storage();
  beginClinicalPortalOAuth(store, 'patient');
  failClinicalPortalOAuth(store, 'patient', 'SESSION_STATE_UNAVAILABLE');
  const failure = consumeClinicalPortalOAuthError(store);
  assert.equal(failure?.portal, 'patient');
  assert.equal(failure?.message, 'Não foi possível concluir a autenticação neste portal. Tente novamente.');
  assert.equal(isClinicalPortalOAuthBlocked(store), true);
});

test('the browser blocks session restoration while the selected patient login is pending or denied', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const landing = readFileSync('src/components/LandingPage.tsx', 'utf8');
  const server = readFileSync('server.ts', 'utf8');

  assert.match(landing, /!showRegister && \(rawRole === 'patient' \|\| rawRole === 'professional'\)/);
  assert.match(landing, /beginClinicalPortalOAuth\(window\.sessionStorage, rawRole\)/);
  assert.match(app, /clearClinicalPortalOAuthIntent\(window\.sessionStorage\)/);
  assert.match(landing, /consumeClinicalPortalOAuthError\(window\.sessionStorage\)/);
  assert.match(app, /const patientOAuthPending = readClinicalPortalOAuthIntent\(window\.sessionStorage\) === 'patient'/);
  assert.match(app, /const authProvider = patientOAuthPending\s*\? 'google'/);
  assert.match(app, /provider: patientOAuthPending \? 'google' :/);
  assert.match(app, /if \(readClinicalPortalOAuthIntent\(window\.sessionStorage\) === 'patient' \|\|[\s\S]*?isClinicalPortalOAuthBlocked\(window\.sessionStorage\)\) return;/);
  assert.match(app, /failClinicalPortalOAuth\(window\.sessionStorage, 'patient', loginResult\?\.code\)/);
  assert.match(app, /await fetch\('\/api\/auth\/logout', \{ method: 'POST', credentials: 'include' \}\)/);
  assert.match(app, /isClinicalPortalOAuthBlocked\(window\.sessionStorage\)\) \{\s*setOauthCallbackPending\(false\)/);
  assert.match(server, /!matchesClinicalLoginPortal\(intendedRole, profile\.role\)/);
  assert.match(server, /message: INVALID_PORTAL_CREDENTIALS_MESSAGE/);
});
