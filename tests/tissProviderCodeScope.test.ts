import assert from "node:assert/strict";
import fs from "node:fs";

const settings = fs.readFileSync("src/components/ClinicGlobalSettingsPanel.tsx", "utf8");
const coordinator = fs.readFileSync("src/components/CoordinatorDashboard.tsx", "utf8");
const preGuide = fs.readFileSync("src/services/tissPreGuideEngine.ts", "utf8");
const antiGlosa = fs.readFileSync("src/services/tissAntiGlosaChecklist.ts", "utf8");
const generator = fs.readFileSync("src/services/tissOfficial/versions/communication040300/generator.ts", "utf8");

const clinicDataSection = settings.match(/id="clinic-master-data"[\s\S]*?<\/SectionCard>/)?.[0] || "";
assert.doesNotMatch(clinicDataSection, />\s*Código do prestador\s*</);
assert.match(clinicDataSection, /código contratual do prestador é específico de cada operadora/i);
assert.match(clinicDataSection, /navigateToTab\("payers"\)/);
assert.doesNotMatch(coordinator, /clinicProviderCode/);
assert.doesNotMatch(coordinator, /setClinicProviderCode/);
assert.doesNotMatch(
  preGuide,
  /payerProfile\.requires_provider_code && !text\(clinicProfile\.provider_code/,
);
assert.match(preGuide, /PAYER_CONTRACTED_PROVIDER_CODE_MISSING/);
assert.match(antiGlosa, /Configurar o código dentro do convênio/);
assert.match(antiGlosa, /snapshot\.payer\?\.contractedProviderCode/);

const providerIdentifierFunction = generator.match(/function pickProviderIdentifier[\s\S]*?return null;\n}/)?.[0] || "";
assert.match(providerIdentifierFunction, /payer\.contractedProviderCode/);
assert.match(providerIdentifierFunction, /payer\.operatorProviderCode/);
assert.doesNotMatch(providerIdentifierFunction, /provider\.providerCode/);

console.log("tissProviderCodeScope.test.ts: ok");
