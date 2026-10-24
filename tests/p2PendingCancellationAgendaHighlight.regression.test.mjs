import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const pending = calendar.match(/CANCEL_REQUESTED: \{[\s\S]*?\n    \},/)?.[0] || '';
const cancelled = calendar.match(/CANCELLED: \{[\s\S]*?\n    \},/)?.[0] || '';
assert.ok(pending, 'o estado de solicitação de cancelamento deve existir');
assert.match(pending, /card: 'border-red-400 bg-red-50 text-red-900/, 'pedido pendente deve ser destacado em fundo claro e legível');
assert.match(pending, /text: 'text-red-700'/, 'o nome deve ter cor vermelha de contraste suficiente');
assert.match(cancelled, /card: 'border-red-700 bg-red-700 text-white/, 'sessão efetivamente cancelada conserva estilo próprio');

const eventCard = calendar.slice(calendar.indexOf('const renderEventCard ='), calendar.indexOf('const renderTimeline ='));
assert.match(eventCard, /statusColor\.canonical === 'CANCEL_REQUESTED' \? 'text-red-700'/,
  'nome vermelho deve aparecer nas visões de agenda com cards');
assert.match(eventCard, /\{event\.patientName\}/, 'nome do paciente continua no card');
assert.match(eventCard, /getAppointmentPatientConfirmationVisualState\(event\)/,
  'estilo deriva do estado canônico do servidor, não de flag enviada pelo cliente');

const month = calendar.slice(calendar.indexOf('const dayCells = Array.from({ length: daysInMonth'), calendar.indexOf('const detail = eventDetail'));
assert.match(month, /const isPendingCancellation = statusColor\.canonical === 'CANCEL_REQUESTED'/,
  'visão mensal identifica pedidos de cancelamento pendentes');
assert.match(month, /isPendingCancellation \? 'text-red-700'/, 'nome vermelho também aparece no mês');
assert.match(month, /isPendingReschedule \|\| isPendingCancellation/, 'ícone de alerta aparece no mês');

assert.match(calendar, /detailStatusColor\.canonical === 'CANCEL_REQUESTED' \? 'text-red-700'/,
  'detalhe da sessão destaca o nome sem modificar ações ou dados');
assert.match(calendar, /CANCEL_REQUESTED: 'CANCELAMENTO SOLICITADO'/,
  'rótulo de cancelamento solicitado é preservado');

console.log('p2PendingCancellationAgendaHighlight.regression.test.mjs: OK');
