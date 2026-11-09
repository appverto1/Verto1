import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const passwordRoute = fs.readFileSync('services/publicSalesActivationPasswordRoute.ts', 'utf8');

assert.match(ui, /Eye, EyeOff/);
assert.match(ui, /aria-label=\{showPassword \? 'Ocultar senha' : 'Mostrar senha'\}/);
assert.match(ui, /aria-label=\{showPasswordConfirmation \? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'\}/);
assert.match(ui, /validateActivationPassword\(password\)/);
assert.match(ui, /const finishPasswordLogin = async/);
assert.match(ui, /const serverLoginResult = await onLogin\(\s*null,/);
assert.match(ui, /passwordSaved\s*\? 'Entrar com a senha criada'/);
assert.match(ui, /payload\?\.passwordSaved === true/);

assert.match(passwordRoute, /let passwordSaved = false/);
assert.match(passwordRoute, /passwordSaved = true/);
assert.match(passwordRoute, /passwordSaved: true/);
assert.match(passwordRoute, /role: \"director\"/);
assert.match(passwordRoute, /modules: loaded\.contractedModules/);
assert.match(passwordRoute, /ensureClinicAndMembershipForCoordinator\(authUser\.id, \"director\"\)/);
assert.match(passwordRoute, /finalizeSalesActivationForUser\(/);
assert.doesNotMatch(passwordRoute, /\.update\(\{ used: true \}\)/);
assert.match(passwordRoute, /error: provisioningFailure[\s\S]*?SALES_ACTIVATION_PROVISIONING_FAILED/);

console.log('salesActivationPasswordFirstAccess.test.mjs: OK');
