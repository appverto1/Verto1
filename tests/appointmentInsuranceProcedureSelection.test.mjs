import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const coordinator = read('src/components/CoordinatorDashboard.tsx');
const app = read('src/App.tsx');
const server = read('server.ts');
const dataService = read('src/services/dataService.ts');

// Clinical classification remains separate from the canonical billable procedure.
assert.match(coordinator, /Especialidade \/ tipo clínico/);
assert.match(coordinator, /Procedimento faturável do convênio/);
assert.match(coordinator, /A especialidade clínica continua separada acima/);
assert.match(coordinator, /const \[sessionInsuranceServiceCatalogId, setSessionInsuranceServiceCatalogId\]/);
assert.match(coordinator, /billableServiceOptions/);
assert.match(coordinator, /suggestion: current\.suggestion/);
assert.match(coordinator, /serviceCatalogId: sessionInsuranceServiceCatalogId \|\| undefined/);
assert.match(coordinator, /procedureCode: selectedSessionProcedureCode \|\| undefined/);
assert.match(coordinator, /insuranceServiceCatalogId: sessionFinancialContextType === "INSURANCE"/);
assert.match(coordinator, /service_catalog_id: sessionFinancialContextType === "INSURANCE"/);
assert.match(coordinator, /Selecione o procedimento faturável do convênio antes de confirmar/);

// The selected canonical procedure survives appointment persistence, including recurrence.
assert.match(app, /const insuranceServiceCatalogId = usesInsuranceContext/);
assert.match(app, /insurance_service_catalog_id: usesInsuranceContext \? insuranceServiceCatalogId \|\| null : null/);
assert.match(app, /procedure_code: usesInsuranceContext \? insuranceProcedureCode \|\| null : null/);

// Backend resolves the exact tenant-scoped catalog item and lists payer De\/Para choices in batch.
assert.match(server, /async function listPayerBillableServiceOptionsForAppointmentTissBilling/);
assert.match(server, /\.from\('payer_tuss_mappings'\)/);
assert.match(server, /requestedServiceCatalogId/);
assert.match(server, /fetchTussServiceCatalogByIdForAppointmentTissBilling/);
assert.match(server, /serviceCatalogId: isUuid\(resolvedServiceCatalogId\) \? resolvedServiceCatalogId : null/);
assert.match(server, /billableServiceOptions/);
assert.match(server, /resolveBillingContextServiceCatalogId\(billingContext\)/);
assert.match(server, /resolveUniqueTissServiceCatalogOptionByCode/);
assert.match(server, /service_catalog_id: requestedServiceCatalogId \|\| appliedTissAuthorization\?\.serviceCatalogId \|\| undefined/);
assert.match(server, /O procedimento faturável selecionado não está ativo no De\/Para deste convênio/);

// API client sends the exact catalog UUID on both suggestion and context reads.
const serviceCatalogIdOccurrences = dataService.match(/serviceCatalogId: options\.serviceCatalogId/g) || [];
assert.ok(serviceCatalogIdOccurrences.length >= 2);

console.log('appointmentInsuranceProcedureSelection: ok');
