import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('src/components/PartnershipPanel.tsx','utf8');
const partnerPortal=readFileSync('src/components/ExternalPartnershipPortal.tsx','utf8');
const careCentral=readFileSync('src/components/ExternalCareNetworkCentral.tsx','utf8');
const careAccess=readFileSync('src/components/ExternalEvolutionShare.tsx','utf8');
const timeline=readFileSync('src/components/ExternalPatientTimeline.tsx','utf8');
test('partner levels derive from server-confirmed 6/9/12 without modifying entitlements',()=>{
  assert.match(source,/currentTermMonths===12\?'Ouro':currentTermMonths===9\?'Prata':'Bronze'/);
  assert.match(source,/nextMilestone=currentTermMonths===12\?null:currentTermMonths===9\?6:3/);
  assert.match(source,/role="progressbar"/);
  assert.match(source,/aria-valuenow=\{Math\.round\(progressPercent\)\}/);
  assert.match(source,/\{name:'Bronze',range:'0–2',term:6\}/);
  assert.match(source,/\{name:'Prata',range:'3–5',term:9\}/);
  assert.match(source,/\{name:'Ouro',range:'6\+',term:12\}/);
  assert.doesNotMatch(source,/POST.*commission/);
});
test('all named external portals retain compact top-left Verto identity',()=>{
  assert.match(source,/<LogoVerto size=\{29\} showText=\{true\} \/>/);
  assert.match(partnerPortal,/<LogoVerto size=\{29\} showText=\{true\}\/>/);
  assert.match(careCentral,/<LogoVerto size=\{29\} showText \/>/);
  assert.match(careAccess,/<LogoVerto size=\{29\} showText \/>/);
  assert.match(timeline,/<LogoVerto size=\{29\} showText \/>/);
});
