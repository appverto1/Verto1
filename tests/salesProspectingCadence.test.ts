import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRecordSalesAttemptNow, nextSalesCadenceSlots } from '../src/utils/salesProspectingCadence';

const formatDay=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const formatTime=(date:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);

test('ten suggestions alternate work dates and different office hours in Brasília',()=>{
  const slots=nextSalesCadenceSlots([],new Date('2026-10-27T13:00:00Z'));
  assert.equal(slots.length,10);
  const days=new Set(slots.map(formatDay));
  assert.equal(days.size,10);
  assert.ok(new Set(slots.map(formatTime)).size>=8);
  for(const slot of slots){
    const time=formatTime(slot);
    const weekday=new Date(slot.toLocaleDateString('en-US',{timeZone:'America/Sao_Paulo'})).getDay();
    assert.ok(weekday!==0&&weekday!==6,'no weekends');
    assert.ok(time>='09:00'&&time<='17:30', 'business hours only');
    assert.ok(slot.getTime()>Date.parse('2026-10-27T13:00:00Z'));
  }
});

test('next suggestion skips today after an actual attempt, even if it was early',()=>{
  const now=new Date('2026-10-27T13:00:00Z');
  const prior=[{occurred_at:'2026-10-27T12:10:00Z'}];
  const next=nextSalesCadenceSlots(prior,now);
  assert.equal(next.length,9);
  assert.notEqual(formatDay(next[0]),formatDay(now));
  assert.equal(canRecordSalesAttemptNow(prior,now),false);
});

test('manual attempts are only enabled in weekday daytime with no attempt on same date',()=>{
  assert.equal(canRecordSalesAttemptNow([],new Date('2026-10-27T13:00:00Z')),true);
  assert.equal(canRecordSalesAttemptNow([],new Date('2026-10-31T13:00:00Z')),false);
  assert.equal(canRecordSalesAttemptNow([],new Date('2026-10-27T10:30:00Z')),false);
  assert.equal(canRecordSalesAttemptNow([],new Date('2026-10-27T22:00:00Z')),false);
  assert.equal(canRecordSalesAttemptNow([{occurred_at:'2026-10-27T12:00:00Z'}],new Date('2026-10-27T13:00:00Z')),false);
});
