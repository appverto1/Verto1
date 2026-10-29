import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const admin=app.indexOf('user?.isPlatformAdmin === true');
const help=app.indexOf('isHelpRoute && isProfessionalClinicRole(user.role)',admin);
assert.ok(admin>=0&&help>admin,'Platform/Super Admin routing must precede professional /ajuda routing');
const helpCenter=fs.readFileSync(new URL('../src/components/HelpCenter.tsx',import.meta.url),'utf8');
assert.ok(helpCenter.indexOf('setTopics([]);')<helpCenter.indexOf("fetch('/api/help/catalog'"),'context refresh clears stale projection before request');
assert.match(helpCenter,/body\.includes\(q\)/,'search ranking includes procedural body/steps');
console.log('helpCenterIntegration.test: PASS');

const helpRoutes=fs.readFileSync(new URL('../services/helpCenterRoutes.ts',import.meta.url),'utf8');
assert.doesNotMatch(helpRoutes,/requireClinicCapability\('clinic\.view'\)/,'tutorial cannot depend on clinic.view');
assert.match(helpRoutes,/requireClinicMembershipContext/,'tutorial validates membership, not privileged clinic permission');


import { publishedHelpProjection } from '../src/help/helpManifest';
import { getDefaultCapabilitiesForRole } from '../src/constants/authorizationModel';
for(const role of ['director','coordinator','therapist','supervisor','receptionist','biller'] as const){
  const topics=publishedHelpProjection(role,[],[]);
  assert.ok(topics.some(article=>article.articleId==='help-getting-started-v1'),
    role+' must receive a general introduction without clinic.view');
}
const billingTopics=publishedHelpProjection('biller',Array.from(getDefaultCapabilitiesForRole('biller')),[]);
assert.ok(billingTopics.some(article=>article.articleId==='billing-orientation-v1'),
  'faturista must have useful billing instructions even without insurance_tiss');
assert.equal(publishedHelpProjection('patient',[],[]).length,0,
  'help for clinic roles must not be exposed to the patient portal');
