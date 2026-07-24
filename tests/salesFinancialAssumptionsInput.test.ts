import assert from 'node:assert/strict';
import {
  formatFinancialAssumptionInput,
  isValidFinancialAssumptionDraft,
  parseFinancialAssumptionInput,
} from '../src/components/SalesFinancialAssumptionsPanel.tsx';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('aceita virgula decimal durante a digitacao', () => {
  assert.equal(isValidFinancialAssumptionDraft('5,', 'percent'), true);
  assert.equal(isValidFinancialAssumptionDraft('5,65', 'percent'), true);
  assert.equal(parseFinancialAssumptionInput('5,65', 'percent'), 565);
});

test('aceita ponto decimal como alternativa de teclado', () => {
  assert.equal(isValidFinancialAssumptionDraft('0.49', 'currency'), true);
  assert.equal(parseFinancialAssumptionInput('0.49', 'currency'), 49);
});

test('preserva centavos e basis points sem alterar formulas', () => {
  assert.equal(parseFinancialAssumptionInput('58,90', 'currency'), 5890);
  assert.equal(parseFinancialAssumptionInput('12,34', 'percent'), 1234);
  assert.equal(formatFinancialAssumptionInput(5890, 'currency'), '58,9');
  assert.equal(formatFinancialAssumptionInput(1234, 'percent'), '12,34');
});

test('campos inteiros continuam aceitando somente digitos', () => {
  assert.equal(isValidFinancialAssumptionDraft('120', 'count'), true);
  assert.equal(isValidFinancialAssumptionDraft('12,5', 'count'), false);
  assert.equal(parseFinancialAssumptionInput('120', 'count'), 120);
});

test('rejeita formatos ambiguos ou com mais de duas casas', () => {
  assert.equal(isValidFinancialAssumptionDraft('1,234', 'currency'), false);
  assert.equal(isValidFinancialAssumptionDraft('1,2,3', 'currency'), false);
  assert.equal(isValidFinancialAssumptionDraft('-1,00', 'currency'), false);
  assert.equal(isValidFinancialAssumptionDraft('abc', 'percent'), false);
});

test('valor vazio permanece indisponivel', () => {
  assert.equal(isValidFinancialAssumptionDraft('', 'currency'), true);
  assert.equal(parseFinancialAssumptionInput('', 'currency'), null);
  assert.equal(formatFinancialAssumptionInput(null, 'currency'), '');
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] Sales financial decimal input checks: ${passed}/${tests.length}`);
