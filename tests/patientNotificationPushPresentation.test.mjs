import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Simulate delivery on an Android-like service worker without a real device.
// Assert that BOTH announcements and appointment reminders omit large images.
const source = fs.readFileSync('public/sw.js', 'utf8');
const handlers = new Map();
const calls = [];
let forceFirstFailure = false;
const self = {
  location: { origin: 'https://api.appverto.com.br' },
  addEventListener(name, handler) { handlers.set(name, handler); },
  registration: {
    async showNotification(title, options) {
      calls.push({title,options});
      if(forceFirstFailure && calls.length === 1) throw new Error('BAD_REMOTE_ICON');
    },
  },
  clients: { async matchAll() { return []; } },
};
vm.runInNewContext(source, { self, console, URL, URLSearchParams, Set, Date, Uint8Array, JSON, Promise, String }, {filename:'sw.js'});
assert.equal(typeof handlers.get('push'), 'function');
const push=async(payload)=>{
  let delivery;
  handlers.get('push')({
    data:{json:()=>payload},
    waitUntil(task){delivery=task},
  });
  await delivery;
};
await push({
  title:'Clínica Diretoria', body:'Aviso de teste da clínica',
  image:'https://example.invalid/large-photo.png', // legacy payload must be ignored
  icon:'/icon.png',branding:{displayName:'Clínica Diretoria',logoUrl:'/icon.png'},
  tag:'clinic-announcement-123',data:{notificationType:'clinic_announcement',announcementId:'123'},
});
assert.equal(calls.length,1);
assert.equal('image' in calls[0].options,false);
assert.match(calls[0].options.icon,/\/icon\.png$/);
assert.equal(calls[0].options.tag,'clinic-announcement-123');
assert.equal(calls[0].options.body,'Aviso de teste da clínica');
assert.equal(calls[0].options.data.announcementId,'123');

calls.length=0;
await push({ title:'Clínica Diretoria', body:'Lembrete de sessão',
  image:'https://example.invalid/large-logo.png',
  branding:{displayName:'Clínica Diretoria',logoUrl:'/clinic.png'},
  appointmentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  data:{notificationType:'appointment_reminder'},
});
assert.equal(calls.length,1);
assert.equal('image' in calls[0].options,false);
assert.match(calls[0].options.icon,/\/clinic\.png$/);

calls.length=0;forceFirstFailure=true;
await push({title:'Clínica Diretoria',body:'Aviso legível',tag:'clinic-announcement-456',
  icon:'https://example.invalid/broken.png',data:{notificationType:'clinic_announcement'}});
assert.equal(calls.length,2,'falha no ícone deve tentar fallback de texto');
assert.equal('image' in calls[1].options,false);
assert.equal('icon' in calls[1].options,false);
assert.equal(calls[1].options.body,'Aviso legível');
assert.equal(calls[1].options.tag,'clinic-announcement-456');

// Android/FCM can accept a Web Push at 06:00 but awaken much later. Do not
// display a stale notice/reminder long after its scheduled time.
calls.length=0;forceFirstFailure=false;
await push({title:'Clínica Diretoria',body:'Aviso vencido',
  data:{notificationType:'clinic_announcement',scheduledFor:new Date(Date.now()-16*60*1000).toISOString()}});
assert.equal(calls.length,0,'aviso entregue ao dispositivo 16 minutos atrasado deve ser descartado');
await push({title:'Clínica Diretoria',body:'Lembrete vencido',
  data:{notificationType:'appointment_reminder',scheduledFor:new Date(Date.now()-31*60*1000).toISOString()}});
assert.equal(calls.length,0,'lembrete 31 minutos atrasado não deve notificar');
await push({title:'Clínica Diretoria',body:'Aviso pontual',
  data:{notificationType:'clinic_announcement',scheduledFor:new Date(Date.now()-30*1000).toISOString()}});
assert.equal(calls.length,1,'aviso pontual deve aparecer');
await push({title:'Clínica Diretoria',body:'Lembrete pontual',
  data:{notificationType:'appointment_reminder',scheduledFor:new Date(Date.now()-30*1000).toISOString()}});
assert.equal(calls.length,2,'lembrete pontual deve aparecer');
await push({title:'Clínica Diretoria',body:'Lembrete adiado',
  data:{notificationType:'appointment_reminder',scheduledFor:new Date(Date.now()-10*60*1000).toISOString()}});
assert.equal(calls.length,3,'lembrete 10 minutos atrasado deve permanecer visível');
assert.match(calls[2].options.body,/Entregue com atraso/, 'atraso não deve ser apresentado como pontual');


    
// Render a wide clinic mark into a centered square, preserving proportions,
// with no external resizing service and no expanded Android notification.
const normalizedCalls = [];
const drawArgs = [];
const rasterHandlers = new Map();
class FakeOffscreenCanvas {
  constructor(width,height) { assert.equal(width,192); assert.equal(height,192); }
  getContext() { return { clearRect(){}, drawImage(...args){ drawArgs.push(args); } }; }
  async convertToBlob() { return { type:'image/png', size:3, async arrayBuffer(){ return Uint8Array.from([137,80,78]).buffer; } }; }
}
const rasterSelf = {
  location:{origin:'https://api.appverto.com.br'},
  addEventListener(name,handler){ rasterHandlers.set(name,handler); },
  registration:{async showNotification(title,options){ normalizedCalls.push({title,options}); }},
  clients:{async matchAll(){return [];}},
};
vm.runInNewContext(source,{
  self:rasterSelf, console,URL,URLSearchParams,Set,Date,Uint8Array,JSON,Promise,String,
  OffscreenCanvas:FakeOffscreenCanvas,
  createImageBitmap:async()=>({width:400,height:100,close(){}}),
  fetch:async()=>({ok:true,headers:{get:()=>null},async blob(){return {type:'image/png',size:200};}}),
  btoa:(data)=>Buffer.from(data,'binary').toString('base64'),
},{filename:'sw-compact-logo.js'});
let normalizedDelivery;
rasterHandlers.get('push')({
  data:{json:()=>({ title:'Espaço Guiar',body:'Aviso',branding:{displayName:'Espaço Guiar',logoUrl:'/clinic-wide.png'},
    data:{notificationType:'clinic_announcement'} })},
  waitUntil(task){normalizedDelivery=task;},
});
await normalizedDelivery;
assert.equal(normalizedCalls.length,1);
assert.match(normalizedCalls[0].options.icon,/^data:image\/png;base64,/);
assert.equal('image' in normalizedCalls[0].options,false);
assert.equal(drawArgs.length,1);
assert.equal(drawArgs[0][1],12);
assert.equal(drawArgs[0][2],75);
assert.equal(drawArgs[0][3],168);
assert.equal(drawArgs[0][4],42);

// Rejection of an inline image does not drop the push: retry the original URL.
const recoveryCalls=[];
rasterSelf.registration.showNotification=async(title,options)=>{
  recoveryCalls.push({title,options});
  if(recoveryCalls.length===1) throw new Error('DATA_URL_UNSUPPORTED');
};
rasterHandlers.get('push')({
  data:{json:()=>({title:'Espaço Guiar',body:'Lembrete',branding:{displayName:'Espaço Guiar',logoUrl:'/clinic-wide.png'},
    data:{notificationType:'appointment_reminder'} })},
  waitUntil(task){normalizedDelivery=task;},
});
await normalizedDelivery;
assert.equal(recoveryCalls.length,2);
assert.match(recoveryCalls[0].options.icon,/^data:image\/png;base64,/);
assert.match(recoveryCalls[1].options.icon,/\/clinic-wide\.png$/);
assert.equal('image' in recoveryCalls[1].options,false);

console.log('patientNotificationPushPresentation: aviso e lembrete compactos; fallback textual em falha de ícone');
