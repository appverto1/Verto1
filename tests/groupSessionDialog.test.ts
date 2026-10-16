import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body><div id="test"></div></body></html>',{url:'https://verto.test'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');
const {dataService}=await import('../src/services/dataService');
const {GroupSessionDialog}=await import('../src/components/GroupSessionDialog');
const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const patients=[{id:id(1),name:'Paciente fictício um'},{id:id(2),name:'Paciente fictício dois'}];
const team=[{id:id(3),label:'Profissional fictício um',clinicSpecialty:'Fonoaudiólogo'},{id:id(4),label:'Profissional fictício dois',clinicSpecialty:'Fonoaudiólogo'}];
const room={id:id(5),name:'Sala fictícia',capacity:3,is_active:true};
const booking={id:id(6),specialty:'Fonoaudiólogo',room_id:room.id,professional_ids:team.map(p=>p.id),scheduled_start_at:'2026-11-02T13:00:00Z',scheduled_end_at:'2026-11-02T13:50:00Z',status:'RESERVED'};
const appointments=patients.map((p,i)=>({id:id(10+i),patientId:p.id,patientName:p.name,status:'scheduled'}));
const detail={success:true,bookings:[booking],appointments,items:appointments,participants:patients.map((p,i)=>({patient_id:p.id,appointment_id:appointments[i].id,unit_amount_cents:8000-i*1000})),financialSnapshots:appointments.map((a,i)=>({appointment_id:a.id,final_amount:80-i*10,late_cancellation_rule:{type:'MANUAL'},cancellation_free_until:'2020-01-01T00:00:00Z'}))};
const creates:any[]=[];const cancels:any[]=[];const persisted:any[]=[];
dataService.getClinicRooms=async()=>({success:true,data:[room]});
dataService.getGroupSession=async()=>detail;
dataService.previewGroupSession=async()=>({success:true,patientRates:patients.map((p,i)=>({patientId:p.id,amountCents:8000-i*1000}))});
dataService.createGroupSessions=async(payload:any)=>{creates.push(payload);return creates.length===1?{success:false,error:'Falha transitória de teste'}:{...detail,action:'created'};};
dataService.cancelGroupSession=async(bookingId:string,payload:any)=>{cancels.push({bookingId,payload});return {...detail,action:'canceled'};};
const root=createRoot(document.getElementById('test')!);
const label=(prefix:string)=>Array.from(document.querySelectorAll('label')).find(el=>el.textContent?.trim().startsWith(prefix))!;
async function check(text:string){await act(async()=>{(label(text).querySelector('input') as HTMLInputElement).click();});}
async function fill(prefix:string,value:string){await act(async()=>{
  const el=label(prefix).querySelector('input,select,textarea') as HTMLInputElement;
  const prototype=el.tagName==='SELECT'?window.HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,value);
  el.dispatchEvent(new window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
});}
async function click(text:string){await act(async()=>{const button=Array.from(document.querySelectorAll('button')).find(el=>el.textContent===text)!;assert.ok(button,text);button.click();});}
async function submit(){await act(async()=>{document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});}
try{
  await act(async()=>root.render(React.createElement(GroupSessionDialog,{patients,professionals:team,specialties:['Fonoaudiólogo'],rooms:[room],onRooms:()=>{},timeZone:'America/Sao_Paulo',initialDate:'2026-11-02',initialTime:'10:00',canCreate:true,canEdit:true,canCancel:true,onClose:()=>{},onIndividual:()=>{},onPersisted:(result:any)=>persisted.push(result),onFinance:()=>{}})));
  await fill('Sala',room.id);await check(team[0].label);await check(team[1].label);await check(patients[0].name);await check(patients[1].name);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  assert.match(document.body.textContent!,/80,00 por sessão em grupo/);assert.match(document.body.textContent!,/70,00 por sessão em grupo/);
  await submit();assert.equal(creates.length,1);assert.match(document.body.textContent!,/Falha transitória/);assert.equal(persisted.length,0,'no optimistic success after failure');
  await submit();assert.equal(creates.length,2);assert.equal(creates[0].idempotencyKey,creates[1].idempotencyKey,'network retry retains action key');
  assert.deepEqual(creates[1].patientIds,patients.map(p=>p.id));assert.deepEqual(creates[1].professionalIds,team.map(p=>p.id));
  assert.equal(creates[1].amountCents,undefined);assert.equal(creates[1].sessionGroupId,undefined);assert.equal(persisted.length,1);
  assert.match(document.body.textContent!,/50 minutos/);assert.match(document.body.textContent!,/80,00/,'detail reads unit_amount_cents');
  await click('Cancelar');await fill('Motivo','Imprevisto da clínica');
  await fill('Cobrança manual de Paciente fictício um','30,00');await fill('Cobrança manual de Paciente fictício dois','25,00');await submit();
  assert.equal(cancels.length,1);assert.equal(cancels[0].bookingId,booking.id);
  assert.deepEqual(cancels[0].payload.policyAmounts,{[patients[0].id]:30,[patients[1].id]:25},'manual decisions use patient IDs expected by the transaction');
  assert.equal(persisted.length,2);
  console.log('groupSessionDialog: mounted patient/team selection, per-patient prices, canonical detail, durable success, retry idempotency and manual cancellation contract passed');
}finally{await act(async()=>root.unmount());dom.window.close();}
