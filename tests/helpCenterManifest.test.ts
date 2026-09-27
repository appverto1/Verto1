import assert from 'node:assert/strict';
import { HELP_ARTICLES, HELP_MEDIA_BUCKET, publishedHelpProjection, resolveHelpMedia } from '../src/help/helpManifest';
assert.equal(HELP_MEDIA_BUCKET,'help-center-media-private');
assert.equal(resolveHelpMedia('../secret'),null,'path traversal must not resolve');
assert.equal(resolveHelpMedia('unknown'),null,'unknown media must not resolve');
assert.ok(HELP_ARTICLES.every(a=>a.status!=='published'||a.mediaIds.length===0),'fixture-free published slice must not reference unpublished media');
assert.equal(publishedHelpProjection('patient',[]).length,0,'patient audience must not receive professional catalog');
assert.equal(publishedHelpProjection('biller',[]).length,1,'authorized biller gets representative article');
console.log('helpCenterManifest.test: PASS');
