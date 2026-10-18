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

console.log('patientNotificationPushPresentation: aviso e lembrete compactos; fallback textual em falha de ícone');
