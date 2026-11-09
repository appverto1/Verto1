import assert from 'node:assert/strict';
import { calculateDomainMastery } from '../src/utils/clinicalMath';

const rows = (scores: number[]) => scores.map((score, index) => ({
  title: 'Responder ao nome',
  score,
  created_at: new Date(Date.UTC(2026, 10, 1, 13, index)).toISOString(),
}));
const skill = (metaSucessos?: number, criterionMode?: 'total_independent' | 'consecutive_independent') => ([{
  name: 'Responder ao nome', maxScore: 1, ...(metaSucessos ? { metaSucessos } : {}),
  ...(criterionMode ? { criterionMode } : {}),
}]);

const score = (scores: number[], metaSucessos?: number, criterionMode?: 'total_independent' | 'consecutive_independent') =>
  calculateDomainMastery(rows(scores), skill(metaSucessos, criterionMode), { protocolKind: 'vbmapp', vbmappMasteryCriterion: 5 });

assert.equal(score([1, 1, 1, 1, 1], 10), 50, '5 de 10 independentes: critério ainda NÃO atingido, crédito 0,5');
assert.equal(score([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 10), 100, '10 de 10 independentes: critério atingido, crédito 1');
assert.equal(score([1, 1, 0.5, 1, 1, 1, 1, 1, 1, 1], 10), 50, '9 independentes + 1 assistido não é 10 independentes');
assert.equal(score([0, 0, 0], 10), 0, 'nenhum sucesso não gera crédito parcial');
assert.equal(score([1, 1, 1, 0, 1, 1], 5), 100, 'critério explícito de total independente não exige sequência');
assert.equal(score([1, 1, 1, 0, 1, 1], 5, 'consecutive_independent'), 50, 'critério de sequência explícito não reutiliza acertos isolados');
assert.equal(score([1, 1, 1, 1, 1], 5), 100, 'limiar de cinco só é válido quando configurado para o alvo');
assert.equal(score([1, 1], undefined), 70, 'sem meta individual explícita, preserve cálculo legado VB-MAPP');
assert.equal(calculateDomainMastery(rows([0.5]), skill(10), { protocolKind: 'other' }), 50, 'pontuação não VB-MAPP permanece inalterada');

console.log('clinicalMathCriterionScore.test.ts: PASS');
