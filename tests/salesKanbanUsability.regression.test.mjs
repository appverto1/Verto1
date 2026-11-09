import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source=readFileSync('src/components/CommercialKanban.tsx','utf8');
const acquisitionTransport=readFileSync('src/services/salesKanbanAcquisition.ts','utf8');
const drawer=source.split('{selected&&<div className="fixed inset-0')[1];

test('opening a card shows editable lead fields and notes with an explicit Save, not an edit toggle',()=>{
  assert.ok(drawer,'the opportunity drawer is present');
  assert.match(drawer,/Dados da oportunidade e observações/);
  assert.match(drawer,/value=\{leadDraft\.notes\}/);
  assert.match(drawer,/onClick=\{\(\)=>void saveLeadDetails\(\)\}/);
  assert.doesNotMatch(drawer,/openLeadEditor|Editar oportunidade|editingLead/);
  assert.match(source,/request\('\/api\/owner\/sales\/kanban\/opportunities\/'\+selectedId\)/);
  assert.match(source,/let active=true;[\s\S]*if\(!active\)return;/);
  assert.match(source,/leadDetailsError&&<button/);
  assert.match(source,/disabled=\{savingLead\|\|loadingLeadDetails\|\|leadDetailsError/);
  assert.match(source,/method:'PATCH',headers:\{'X-Idempotency-Key':key\}/);
});

test('acquisition channels are visible and edited in the drawer, but only Save persists',()=>{
  assert.match(drawer,/fieldset disabled=\{savingAcquisition\|\|acquisitionCatalogUnavailable\}/);
  assert.match(drawer,/checked=\{inlineChannelIds\.includes\(channel\.id\)\}/);
  assert.match(drawer,/onClick=\{\(\)=>void saveAcquisition\(\{leadId:selected\.id,channelIds:inlineChannelIds\}\)\}/);
  assert.match(source,/persistSalesKanbanAcquisition\(request/);
  assert.match(acquisitionTransport,/method: 'PUT', headers: \{ 'X-Idempotency-Key': key \}/);
  assert.match(source,/setInlineChannelIds\(\[\.\.\.\(acquisitionByLead\[leadId\]\|\|\[\]\)\]\)/);
});

test('the duplicate failed-call actions are gone but existing attempt recording is preserved',()=>{
  assert.doesNotMatch(source,/\+ Registrar ligação operadora sem falar com decisor/);
  assert.doesNotMatch(source,/\+ Registrar ligação WhatsApp sem falar com decisor/);
  assert.match(drawer,/Contabilizar operadora/);
  assert.match(drawer,/Contabilizar WhatsApp/);
  assert.match(source,/setAttemptDialog\(\{leadId:lead\.id,channel/);
  assert.match(drawer,/Salvar contato com decisor/);
});

test('columns show pencil editing and a trailing add control with separate drag types for cards',()=>{
  assert.doesNotMatch(source,/Editar colunas|setEditing\(/);
  assert.match(source,/aria-label=\{'Editar '\+col\.title\}/);
  assert.match(source,/aria-label="Adicionar coluna"/);
  assert.match(source,/onClick=\{\(\)=>\{setDraftTitle\('Nova etapa'\)/);
  assert.match(source,/application\/x-verto-kanban-column/);
  assert.match(source,/if\(sourceColumn\)\{moveColumnTo\(sourceColumn,col\.id\);return;\}/);
  assert.match(source,/const lead=leads\.find\(x=>x\.id===id\);if\(lead\)moveLead\(lead,col\);/);
  assert.match(source,/saveColumnOrder\(next\)/);
  assert.match(source,/aria-label="Mover coluna para a esquerda"/);
});

test('agenda collapses without discarding selected filters; production sidebar is untouched',()=>{
  assert.match(source,/<details className="group rounded-xl border border-violet-200/);
  assert.match(source,/<summary className="flex cursor-pointer/);
  assert.match(source,/agendaActive\?'Filtro ativo':'Filtros'/);
  assert.match(source,/setAgendaFilter\('date'\)/);
  assert.match(source,/Limpar agenda/);
});

test('board cards can expand read-only up-to-date notes without opening the editor',()=>{
  const card=source.split('{cards.map(lead=>{')[1]?.split('</article>;')[0];
  assert.ok(card,'the Kanban board card exists');
  assert.match(card,/aria-label=\{'Visualizar observações de '/);
  assert.match(card,/aria-expanded=\{notesPreviewId===lead\.id\}/);
  assert.match(card,/onClick=\{\(\)=>setNotesPreviewId\(current=>current===lead\.id\?null:lead\.id\)\}/);
  assert.match(card,/role="region"/);
  assert.match(card,/notesPreviewText\.trim\(\)\|\|'Sem observações registradas\.'/);
  assert.match(card,/notesPreviewLoading/);
  assert.match(card,/notesPreviewError/);
  assert.match(card,/Tentar novamente/);
  assert.match(source,/request\('\/api\/owner\/sales\/kanban\/opportunities\/'\+notesPreviewId\)/);
  assert.match(source,/return \(\)=>\{active=false;\}/);
  assert.match(source,/if\(notesPreviewId===selected\.id\)setNotesPreviewText/);
  assert.doesNotMatch(card,/textarea|saveLeadDetails/);
});
