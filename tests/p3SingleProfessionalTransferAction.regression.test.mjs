import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const openTransferModal = 'onClick={() => setIsProfessionalPaymentModalOpen(true)}';

// One explicit creation action remains in the professional transfers panel.
// The duplicate header action must not return on a later layout change.
assert.equal(
  dashboard.split(openTransferModal).length - 1,
  1,
  'A seção de repasses deve ter exatamente uma ação de abrir o modal.',
);
assert.equal(
  dashboard.split('Registrar repasse').length - 1,
  2,
  'Somente o título do modal e o botão interno devem conter Registrar repasse.',
);
assert.match(dashboard, /isProfessionalTransfersSection\s*&&\s*\(/);
assert.match(dashboard, /onClick=\{handleAddProfessionalPayment\}/);
assert.match(dashboard, /Salvar repasse/);
assert.match(dashboard, /disabled=\{isProfessionalPaymentSaving\}/);

console.log('P3-17: ação única de repasse, modal e salvamento preservados.');
