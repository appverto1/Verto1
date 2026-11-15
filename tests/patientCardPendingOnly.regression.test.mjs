import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const teamPanel = readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const anamnesisModal = readFileSync('src/components/Anamnesis.tsx', 'utf8');

const header = card.slice(card.indexOf('id="patient-header-info"'), card.indexOf('id="patient-care-context"'));
assert.match(header, /canViewAnamnesis && !hasCompletedAnamnesis && \(/, 'anamnesis status must only show when outstanding');
assert.match(header, /canViewAnamnesis && !hasCompletedAnamnesis && anamnesisFlowMessage/, 'finished status messages must not linger in the card');
assert.match(header, /canViewAnamnesis && hasCompletedAnamnesis && \([\s\S]*?Ver anamnese/, 'completed anamnesis has one view action');
assert.match(header, /canEditAnamnesis && !hasCompletedAnamnesis && \([\s\S]*?Ficha Anamnese/, 'pending anamnesis can still be completed');
assert.match(header, /canEditAnamnesis && !hasCompletedAnamnesis && \([\s\S]*?Enviar anamnese/, 'pending anamnesis can still be sent');
assert.doesNotMatch(header, /Ver ficha enviada|onClick=\{openSubmittedAnamnesisForFiles\}/, 'no duplicate completed anamnesis action in card');

assert.match(card, /readOnly=\{showAnamnesisReadOnly\}/, 'viewer must be read-only initially');
assert.match(card, /onEdit=\{showAnamnesisReadOnly && canEditAnamnesis/, 'editor can be reached only when authorized');
assert.match(card, /onReview=\{showAnamnesisReadOnly && canEditAnamnesis/, 'review remains available to authorized staff inside viewer');
assert.match(anamnesisModal, /<fieldset disabled=\{readOnly\}/, 'view-only mode must disable question inputs');
assert.match(anamnesisModal, /!readOnly \? \(/, 'read-only viewer must not show a save button');
assert.match(anamnesisModal, /onClick=\{handleSubmitForm\}/, 'editor must retain the explicit Save action');

assert.match(card, /assignedPrimaryProfessionalId=\{selectedTherapistId\}/, 'card uses existing assigned primary professional');
assert.match(teamPanel, /!hasAssignedPrimaryProfessional \? \([\s\S]*?Nenhum vínculo ativo\./, 'resolved missing-professional notice must disappear');
assert.match(teamPanel, /integrityIssueCount > 0/, 'real team-integrity problems must remain visible');
assert.match(teamPanel, /\{error \? <p role="alert"/, 'real link errors must remain visible');

console.log('patientCardPendingOnly.regression.test.mjs: ok');
