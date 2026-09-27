import assert from 'node:assert/strict';
import { HELP_ARTICLES, HELP_MEDIA_BUCKET, projectHelpArticles, publishedHelpProjection, resolveHelpMedia, validateHelpMediaPublication } from '../src/help/helpManifest';
assert.equal(HELP_MEDIA_BUCKET,'help-center-media-private');
assert.equal(resolveHelpMedia('../secret'),null,'path traversal must not resolve');
assert.equal(resolveHelpMedia('unknown'),null,'unknown media must not resolve');
assert.ok(HELP_ARTICLES.every(a=>a.status!=='published'||a.mediaIds.length===0),'fixture-free published slice must not reference unpublished media');
assert.equal(publishedHelpProjection('patient',[]).length,0,'patient audience must not receive professional catalog');
assert.equal(publishedHelpProjection('biller',[]).length,1,'authorized biller gets representative article');
assert.equal(validateHelpMediaPublication({filename:'x.svg',declaredMime:'image/svg+xml',magicMime:'image/svg+xml',bytes:100}),false,'SVG rejected');
assert.equal(validateHelpMediaPublication({filename:'x.png',declaredMime:'image/png',magicMime:'image/jpeg',bytes:100}),false,'type spoof rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:3145729,durationSeconds:8}),false,'oversize rejected');
assert.equal(validateHelpMediaPublication({filename:'x.mp4',declaredMime:'video/mp4',magicMime:'video/mp4',bytes:1024,durationSeconds:26}),false,'overlong video rejected');
assert.equal(validateHelpMediaPublication({filename:'x.webp',declaredMime:'image/webp',magicMime:'image/webp',bytes:1024}),true,'valid raster accepted');
const lifecycleArticle:any={articleId:'a',slug:'a',status:'published',title:'A',theme:'T',summary:'S',keywords:[],steps:['S'],audiences:['biller'],requiredCapabilities:[],mediaIds:['published','draft','archived']};
const lifecycleMedia:any[]=[
 {mediaId:'published',status:'published',classification:'authenticated_professional',objectKey:'p.png',mimeType:'image/png',bytes:10},
 {mediaId:'draft',status:'draft',classification:'authenticated_professional',objectKey:'d.png',mimeType:'image/png',bytes:10},
 {mediaId:'archived',status:'archived',classification:'authenticated_professional',objectKey:'a.png',mimeType:'image/png',bytes:10}
];
assert.deepEqual(projectHelpArticles([lifecycleArticle],lifecycleMedia,'biller',[])[0].mediaIds,['published'],'draft/archived media never projects from a published article');
console.log('helpCenterManifest.test: PASS');
