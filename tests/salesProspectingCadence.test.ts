import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRecordSalesAttemptNow, nextSalesCadenceSlots } from '../src/utils/salesProspectingCadence';

const formatDay=(date:Date)=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=(type:string)=>parts.find(part=>part.type===type)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
};
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

test('next attempt starts two calendar days after a real call with a different time window',()=>{
  const recorded=[{occurred_at:'2026-10-27T13:30:00Z',channel:'phone' as const}]; // Tue 10:30 BRT
  const next=nextSalesCadenceSlots(recorded,new Date('2026-10-27T14:00:00Z'));
  assert.equal(formatDay(next[0]),'2026-10-29'); // Thu after the intervening Wednesday
  assert.notEqual(formatTime(next[0]),'10:30');
  assert.ok(next[0].getTime()>Date.parse('2026-10-27T13:30:00Z')+86400000);
});

test('recommendations do not produce consecutive-day calls or weekend slots',()=>{
  const now=new Date('2026-10-29T13:00:00Z'); // Thursday
  const prior=[{occurred_at:'2026-10-29T13:00:00Z',channel:'phone' as const}];
  const next=nextSalesCadenceSlots(prior,now);
  assert.equal(formatDay(next[0]),'2026-11-02'); // Saturday is ineligible, Monday is next
  for(let i=1;i<next.length;i++){
    const gap=(next[i].getTime()-next[i-1].getTime())/86400000;
    assert.ok(gap>=1.5,'minimum two calendar days apart, allowing differing clock times');
  }
});

test('a missed suggestion stays anchored and visible as overdue rather than drifting every day',()=>{
  const past=[{occurred_at:'2026-10-27T13:30:00Z',channel:'phone' as const}];
  const expected=nextSalesCadenceSlots(past,new Date('2026-10-27T18:00:00Z'))[0];
  const late=nextSalesCadenceSlots(past,new Date('2026-11-05T18:00:00Z'))[0];
  assert.equal(late.toISOString(),expected.toISOString());
});

test('WhatsApp text is not a phone attempt and more than 10 calls do not block suggestions',()=>{
  const now=new Date('2026-10-27T12:00:00Z');
  const byText=nextSalesCadenceSlots([{occurred_at:'2026-10-27T11:00:00Z',channel:'whatsapp_message'}],now);
  assert.equal(byText.length,10);
  assert.equal(formatDay(byText[0]),formatDay(now));
  const many=Array.from({length:11},(_,index)=>({
    occurred_at:new Date(Date.parse('2026-10-01T13:00:00Z')+index*86400000).toISOString(),
    channel:'phone' as const,
  }));
  const remaining=nextSalesCadenceSlots(many,new Date('2026-10-20T13:00:00Z'));
  assert.equal(remaining.length,1);
  assert.equal(formatDay(remaining[0]),'2026-10-13'); // anchored after October 11
});

test('new leads receive the next viable office-time suggestion, including after hours',()=>{
  const daytime=new Date('2026-10-27T14:00:00Z'); // 11:00 BRT
  const first=nextSalesCadenceSlots([],daytime)[0];
  assert.equal(formatDay(first),formatDay(daytime));
  assert.ok(first.getTime()>daytime.getTime());
  const late=new Date('2026-10-30T21:00:00Z'); // Friday 18:00 BRT
  const following=nextSalesCadenceSlots([],late)[0];
  assert.equal(formatDay(following),'2026-11-02'); // Monday
});
