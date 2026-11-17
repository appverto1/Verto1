import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// This legacy aggregate was intentionally retired, not merely hidden for one
// role: never reintroduce it through a dashboard role/viewport branch.
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const audit = readFileSync('ABA_CLINICAL_CHARTS_EPIC12_AUDIT.md', 'utf8');

assert.equal(existsSync('src/components/StackedDomainStatusChart.tsx'), false,
  'retired skills-by-domain chart must not remain as dead implementation');
assert.doesNotMatch(dashboard, /StackedDomainStatusChart|Status das habilidades por domínio/i,
  'no director, coordinator, supervisor, or professional may render the retired chart');
assert.match(dashboard, /\{hasAppointmentsCommunicationModule && \(/,
  'the clinic agenda remains present');
assert.match(dashboard, /\{renderAgendaContent\(\)\}/,
  'agenda rendering is not removed with the chart');
assert.match(dashboard, /<TeamManagement\s/,
  'team management remains intact');
assert.match(audit, /Status das habilidades por domínio \(descontinuado em 2026-11-16\)/,
  'historical audit must record the removal rather than request rebuilding');
console.log('retiredDomainStatusChart.regression.test.mjs: PASS');
