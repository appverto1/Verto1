import assert from 'node:assert/strict';
import { HELP_ARTICLES, HELP_MEDIA_BUCKET, projectHelpArticles, publishedHelpProjection, resolveHelpMedia, validateHelpMediaPublication } from '../src/help/helpManifest';
assert.equal(HELP_MEDIA_BUCKET,'help-center-media-private');
assert.equal(resolveHelpMedia('../secret'),null,'path traversal must not resolve');
assert.equal(resolveHelpMedia('unknown'),null,'unknown media must not resolve');
assert.ok(HELP_ARTICLES.every(a=>a.status!=='published'||a.mediaIds.length===0),'fixture-free published slice must not reference unpublished media');
assert.equal(publishedHelpProjection('patient',[]).length,0,'patient audience must not receive professional catalog');
assert.equal(publishedHelpProjection('biller',[]).length,0,'billing article hidden without entitlement');
assert.equal(publishedHelpProjection('biller',['reports.billing.view'],['insurance_tiss']).length,1,'authorized biller gets representative article');
assert.equal(validateHelpMediaPublication({kind:'screenshot',filename:'x.svg',declaredMime:'image/svg+xml',magicMime:'image/svg+xml',bytes:100,width:800,height:600}),false,'SVG rejected');
assert.equal(validateHelpMediaPublication({kind:'screenshot',filename:'x.png',declaredMime:'image/png',magicMime:'image/jpeg',bytes:100,width:800,height:600}),false,'type spoof rejected');
assert.equal(validateHelpMediaPublication({kind:'video',filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:3145729,width:1280,height:720,durationSeconds:8,codec:'h264'}),false,'oversize rejected');
assert.equal(validateHelpMediaPublication({kind:'video',filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,width:1280,height:720,durationSeconds:26,codec:'h264'}),false,'overlong video rejected');
assert.equal(validateHelpMediaPublication({kind:'screenshot',filename:'x.webp',declaredMime:'image/webp',magicMime:'image/webp',bytes:1024,width:1280,height:720}),true,'valid raster accepted');
const lifecycleArticle:any={articleId:'a',slug:'a',status:'published',title:'A',theme:'T',summary:'S',keywords:[],steps:['S'],audiences:['biller'],requiredCapabilities:[],mediaIds:['published','draft','archived']};
const lifecycleMedia:any[]=[
 {mediaId:'published',status:'published',classification:'authenticated_professional',objectKey:'p.png',mimeType:'image/png',bytes:10},
 {mediaId:'draft',status:'draft',classification:'authenticated_professional',objectKey:'d.png',mimeType:'image/png',bytes:10},
 {mediaId:'archived',status:'archived',classification:'authenticated_professional',objectKey:'a.png',mimeType:'image/png',bytes:10}
];
assert.deepEqual(projectHelpArticles([lifecycleArticle],lifecycleMedia,'biller',[])[0].mediaIds,['published'],'draft/archived media never projects from a published article');
assert.equal(validateHelpMediaPublication({kind:'screenshot',filename:'x.webp',declaredMime:'image/webp',magicMime:'image/webp',bytes:409601,width:1280,height:720}),false,'screenshot budget enforced');
assert.equal(validateHelpMediaPublication({kind:'poster',filename:'x.webp',declaredMime:'image/webp',magicMime:'image/webp',bytes:204801,width:1280,height:720}),false,'poster budget enforced');
assert.equal(validateHelpMediaPublication({kind:'video',filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,width:1280,height:720,durationSeconds:8,codec:'vp9'}),false,'MP4 requires H.264');
assert.equal(validateHelpMediaPublication({kind:'video',filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,width:2560,height:1440,durationSeconds:8,codec:'h264'}),false,'delivery dimensions bounded');
console.log('helpCenterManifest.test: PASS');
