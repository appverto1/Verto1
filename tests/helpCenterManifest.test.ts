import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HELP_ARTICLES, HELP_MEDIA_BUCKET, projectHelpArticles, publishedHelpProjection, resolveHelpMedia, validateHelpMediaPublication } from '../src/help/helpManifest';
assert.equal(HELP_MEDIA_BUCKET,'help-center-media-private');
assert.equal(resolveHelpMedia('../secret'),null,'path traversal must not resolve');
assert.equal(resolveHelpMedia('unknown'),null,'unknown media must not resolve');
assert.ok(HELP_ARTICLES.every(a=>a.status!=='published'||a.mediaIds.length===0),'fixture-free published slice must not reference unpublished media');
assert.equal(publishedHelpProjection('patient',[]).length,0,'patient audience must not receive professional catalog');
assert.equal(publishedHelpProjection('biller',[],[]).length,0,'billing article must not project without insurance/TISS entitlement');
assert.equal(publishedHelpProjection('biller',[],['insurance_tiss']).length,1,'authorized biller with insurance/TISS module gets representative article');
const dims={width:1280,height:720};
assert.equal(validateHelpMediaPublication({filename:'x.svg',declaredMime:'image/svg+xml',magicMime:'image/svg+xml',bytes:100,kind:'screenshot',...dims}),false,'SVG rejected');
assert.equal(validateHelpMediaPublication({filename:'x.png',declaredMime:'image/png',magicMime:'image/jpeg',bytes:100,kind:'screenshot',...dims}),false,'type spoof rejected');
assert.equal(validateHelpMediaPublication({filename:'x.webp',declaredMime:'image/webp',magicMime:'image/webp',bytes:400*1024,kind:'screenshot',...dims}),true,'screenshot budget boundary accepted');
assert.equal(validateHelpMediaPublication({filename:'x.webp',declaredMime:'image/webp',magicMime:'image/webp',bytes:400*1024+1,kind:'screenshot',...dims}),false,'oversize screenshot rejected');
assert.equal(validateHelpMediaPublication({filename:'x.jpg',declaredMime:'image/jpeg',magicMime:'image/jpeg',bytes:200*1024,kind:'poster',...dims}),true,'poster budget boundary accepted');
assert.equal(validateHelpMediaPublication({filename:'x.jpg',declaredMime:'image/jpeg',magicMime:'image/jpeg',bytes:200*1024+1,kind:'poster',...dims}),false,'oversize poster rejected');
assert.equal(validateHelpMediaPublication({filename:'x.png',declaredMime:'image/png',magicMime:'image/png',bytes:1024,kind:'screenshot',width:1920,height:1081}),false,'oversize dimensions rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:3145729,durationSeconds:8,kind:'video',container:'mp4',codec:'h264',...dims}),false,'oversize video rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,durationSeconds:26,kind:'video',container:'mp4',codec:'h264',...dims}),false,'overlong video rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,durationSeconds:8,kind:'video',container:'webm',codec:'h264',...dims}),false,'container mismatch rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,durationSeconds:8,kind:'video',container:'mp4',codec:'vp9',...dims}),false,'unsupported mp4 codec rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,durationSeconds:8,kind:'video',container:'mp4',codec:'h264',...dims}),true,'valid H.264 MP4 accepted');
assert.equal(validateHelpMediaPublication({filename:'x.webm',declaredMime:'video/webm',magicMime:'video/webm',bytes:1024,durationSeconds:8,kind:'video',container:'webm',codec:'vp9',...dims}),true,'valid WebM accepted');
const lifecycleArticle:any={articleId:'a',slug:'a',status:'published',title:'A',theme:'T',summary:'S',keywords:[],steps:['S'],audiences:['biller'],requiredCapabilities:[],mediaIds:['published','draft','archived']};
const lifecycleMedia:any[]=[
 {mediaId:'published',status:'published',classification:'authenticated_professional',objectKey:'p.png',mimeType:'image/png',bytes:10},
 {mediaId:'draft',status:'draft',classification:'authenticated_professional',objectKey:'d.png',mimeType:'image/png',bytes:10},
 {mediaId:'archived',status:'archived',classification:'authenticated_professional',objectKey:'a.png',mimeType:'image/png',bytes:10}
];
assert.deepEqual(projectHelpArticles([lifecycleArticle],lifecycleMedia,'biller',[])[0].mediaIds,['published'],'draft/archived media never projects from a published article');
const helpCenter=fs.readFileSync('src/components/HelpCenter.tsx','utf8');
assert.match(helpCenter,/body=normalize\(\(topic\.steps\|\|\[\]\)\.join\(' '\)\)/,'search ranking must index article steps/body');
assert.ok(helpCenter.indexOf("setTopics([]);setSelected('');setContextLabel('Atualizando contexto…')")<helpCenter.indexOf("fetch('/api/help/catalog'"),'focus refresh must clear stale projection before network response');
assert.match(helpCenter,/setContextLabel\(String\(payload\?\.clinicName\|\|''\)\.trim\(\)\|\|'Clínica ativa'\)/,'rendered clinic context must come from authoritative catalog response');
console.log('helpCenterManifest.test: PASS');
