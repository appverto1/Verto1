import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {summarizePortalMonthSessions,summarizePortalMonthCharges} from '../services/patientPortalMonthlySummary';

const patient='11111111-1111-4111-8111-111111111111';
const clinic='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';

test('monthly time uses only completed actual durations for the scoped patient and clinic',()=>{
  const sessions=[
    {id:'a',patientId:patient,clinicId:clinic,status:'COMPLETED',date:'2026-11-05',actualDurationMinutes:50},
    {id:'a',patientId:patient,clinicId:clinic,status:'COMPLETED',date:'2026-11-05',actualDurationMinutes:50},
    {id:'b',patientId:patient,clinicId:clinic,status:'COMPLETED',date:'2026-11-08',scheduledDurationMinutes:50},
    {id:'c',patientId:patient,clinicId:clinic,status:'CANCELLED',date:'2026-11-10',actualDurationMinutes:90},
    {id:'d',patientId:patient,clinicId:clinic,status:'CONFIRMED',date:'2026-11-22',scheduledAt:'2026-11-22T18:00:00Z',scheduledDurationMinutes:45},
    {id:'e',patientId:other,clinicId:clinic,status:'COMPLETED',date:'2026-11-03',actualDurationMinutes:70},
    {id:'f',patientId:patient,clinicId:other,status:'COMPLETED',date:'2026-11-03',actualDurationMinutes:70},
    {id:'g',patientId:patient,clinicId:clinic,status:'COMPLETED',date:'2026-10-31',actualDurationMinutes:70},
  ];
  const actual=summarizePortalMonthSessions(sessions,patient,clinic,'2026-11',new Date('2026-11-14T12:00:00Z'));
  assert.deepEqual(actual,{completedSessions:2,completedMinutes:50,withoutActualMinutes:1,upcomingSessions:1,upcomingMinutes:45});
});

test('amounts come from unique private receivables and exclude insurer/void rows',()=>{
  const charges=[
    {id:'m1',type:'particular',status:'forecast',amount:400,paid_amount:0,balance_amount:400},
    {id:'m1',type:'particular',status:'forecast',amount:400,paid_amount:0,balance_amount:400},
    {id:'p2',type:'private',status:'partial',amount:120,paid_amount:20,balance_amount:100},
    {id:'c3',type:'convenio',status:'forecast',amount:1200,balance_amount:1200},
    {id:'x4',type:'particular',status:'cancelled',amount:80},
    {id:'e5',type:'particular',status:'paid',amount:30,paid_amount:30,refunded_amount:0,balance_amount:0},
  ];
  assert.deepEqual(summarizePortalMonthCharges(charges),{
    hasCharges:true,chargeCount:3,needsReview:false,totalCents:55000,paidCents:5000,openCents:50000
  });
});

test('never invent a zero invoice or a confident amount without canonical charges',()=>{
  const none=summarizePortalMonthCharges([]);
  assert.equal(none.hasCharges,false);
  assert.equal(none.totalCents,0);
  assert.equal(summarizePortalMonthCharges([{id:'1',type:'particular',status:'forecast',amount:100,monthly_adjustment_required:true}]).totalCents,null);
  assert.equal(summarizePortalMonthCharges([{id:'1',type:'particular',status:'forecast',amount:100}],1).needsReview,true);
  assert.equal(summarizePortalMonthCharges([{id:'1',type:'particular',status:'forecast',amount:'not calculated'}]).needsReview,true);
});

test('portal finance read is coupled to server-authorized patient/clinic and its entitlement',()=>{
  const source=readFileSync(new URL('../services/portalAppointmentReadHandlers.ts',import.meta.url),'utf8');
  assert.match(source,/req\.portalContext\?\.resolvedPatientId/);
  assert.match(source,/req\.portalContext\?\.clinicId/);
  assert.match(source,/authorizedPatientIdSet\.has\(patientId\)/);
  assert.match(source,/sanitizeString\(patient\?\.clinic_id,120\)===clinicId/);
  assert.match(source,/hasOrganizationModule\(moduleAccess.mode,moduleAccess.modules,'financial_management'\)/);
  assert.match(source,/\.eq\('patient_id',patientId\)\.eq\('clinic_id',clinicId\)/);
  assert.match(source,/\.in\('type',\['particular','private'\]\)/);
  assert.doesNotMatch(source,/\.from\('patient_financial_plans'\)/,'no speculative plan-rate multiplication in portal');
});
