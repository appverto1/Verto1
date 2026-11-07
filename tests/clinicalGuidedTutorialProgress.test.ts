import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CLINICAL_GUIDED_TUTORIAL_REVISION,
  clinicalGuidedTutorialKeys,
  readClinicalGuidedTutorial,
  persistClinicalGuidedTutorial,
} from '../src/utils/clinicalGuidedTutorialProgress.mjs';

const context = {
  userId: 'actor-director',
  clinicId: 'clinic-a',
  role: 'director',
  moduleAccessMode: 'contract',
  moduleSignature: 'calendar,clinical',
};

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    entries: () => Array.from(map.entries()),
  };
}

test('clinical completion keys are stable by user, clinic and role, independent of modules', () => {
  const a = clinicalGuidedTutorialKeys(context);
  const b = clinicalGuidedTutorialKeys({
    ...context, moduleAccessMode: 'preview', moduleSignature: 'financial,clinical',
  });
  assert.equal(CLINICAL_GUIDED_TUTORIAL_REVISION, 'p0-contextual-v1');
  assert.equal(a.roleKey, b.roleKey);
  assert.notEqual(a.contextKey, b.contextKey);
  assert.equal(a.roleKey,
    'verto:guided-tutorial:role:p0-contextual-v1:actor-director:clinic-a:director');
  assert.equal(a.contextKey,
    'verto:guided-tutorial:p0-contextual-v1:actor-director:clinic-a:director:contract:calendar,clinical');
  const others = [
    { ...context, userId:'actor-other' },
    { ...context, clinicId:'clinic-b' },
    { ...context, role:'therapist' },
    { ...context, role:'receptionist' },
    { ...context, role:'supervisor' },
  ].map(clinicalGuidedTutorialKeys);
  assert.equal(new Set([a.roleKey, ...others.map(x => x.roleKey)]).size, 6);
  assert.deepEqual(clinicalGuidedTutorialKeys({...context,userId:''}),{roleKey:'',contextKey:''});
});

test('completion is preserved across reload, logout/login and module entitlement change', () => {
  const s = memoryStorage();
  const a = clinicalGuidedTutorialKeys(context);
  const b = clinicalGuidedTutorialKeys({...context,moduleSignature:'new-modules'});
  assert.equal(readClinicalGuidedTutorial(s,a.roleKey,a.contextKey),null);
  assert.equal(persistClinicalGuidedTutorial(s,a.roleKey,a.contextKey,'active',0),true);
  assert.deepEqual(readClinicalGuidedTutorial(s,a.roleKey,a.contextKey),{status:'active',step:0});
  assert.equal(persistClinicalGuidedTutorial(s,a.roleKey,a.contextKey,'completed',0),true);
  assert.equal(readClinicalGuidedTutorial(s,b.roleKey,b.contextKey)?.status,'completed');
  assert.equal(s.entries().length,2,'write once to the stable and legacy keys, no database calls');
  const refreshed = {getItem:s.getItem,setItem:s.setItem};
  assert.equal(readClinicalGuidedTutorial(refreshed,b.roleKey,b.contextKey)?.status,'completed');
  for(const value of [
    {...context,userId:'different'},
    {...context,clinicId:'clinic-b'},
    {...context,role:'therapist'},
  ]) {
    const k = clinicalGuidedTutorialKeys(value);
    assert.equal(readClinicalGuidedTutorial(s,k.roleKey,k.contextKey),null);
  }
});

test('legacy context-key completion is safely migrated to stable role key', () => {
  const s=memoryStorage();
  const keys=clinicalGuidedTutorialKeys(context);
  s.setItem(keys.contextKey,JSON.stringify({
    revision:CLINICAL_GUIDED_TUTORIAL_REVISION,status:'skipped',step:0,
  }));
  assert.deepEqual(readClinicalGuidedTutorial(s,keys.roleKey,keys.contextKey),{status:'skipped',step:0});
  assert.ok(s.getItem(keys.roleKey),'migrate only locally and do not reset a skipped tutorial');
  assert.equal(readClinicalGuidedTutorial(s,keys.roleKey,keys.contextKey)?.status,'skipped');
  assert.equal(s.entries().length,2);
});

test('untrusted storage cannot inject a role, turn a tutorial into authorization or break UI', () => {
  const k=clinicalGuidedTutorialKeys(context);
  const s=memoryStorage();
  assert.equal(persistClinicalGuidedTutorial(s,'',k.contextKey,'completed',0),false);
  assert.equal(persistClinicalGuidedTutorial(s,k.roleKey,k.contextKey,'admin',0),false);
  assert.equal(s.entries().length,0);
  s.setItem(k.roleKey,'{broken JSON');
  assert.equal(readClinicalGuidedTutorial(s,k.roleKey,k.contextKey),null);
  s.setItem(k.roleKey,JSON.stringify({revision:'unexpected',status:'completed'}));
  assert.equal(readClinicalGuidedTutorial(s,k.roleKey,k.contextKey),null);
  s.setItem(k.roleKey,JSON.stringify({revision:CLINICAL_GUIDED_TUTORIAL_REVISION,status:'admin'}));
  assert.equal(readClinicalGuidedTutorial(s,k.roleKey,k.contextKey),null);
  s.setItem(k.roleKey,JSON.stringify({revision:CLINICAL_GUIDED_TUTORIAL_REVISION,status:'active',step:'NaN'}));
  assert.deepEqual(readClinicalGuidedTutorial(s,k.roleKey,k.contextKey),{status:'active',step:0});
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readClinicalGuidedTutorial(blocked,k.roleKey,k.contextKey),null);
  assert.equal(persistClinicalGuidedTutorial(blocked,k.roleKey,k.contextKey,'completed',0),false);
  assert.equal(persistClinicalGuidedTutorial(null,k.roleKey,k.contextKey,'completed',0),false);
});

test('clinical hook gates overlays on current identity before effects; all data stays browser-local',()=>{
  const hook=readFileSync('src/hooks/useClinicalGuidedTutorial.ts','utf8');
  const coordinator=readFileSync('src/components/CoordinatorDashboard.tsx','utf8');
  assert.match(hook,/authorizationHydrated && identity && roleKey && stepCount > 0/);
  assert.match(hook,/portalGuidedTutorialIsVisible\(tutorialState, roleKey\)/);
  assert.match(hook,/if \(initializedRoleKeyRef\.current === roleKey\) return;/);
  assert.match(hook,/persistClinicalGuidedTutorial\(window\.localStorage, roleKey, contextKey, status, step\)/);
  assert.match(hook,/readClinicalGuidedTutorial\(window\.localStorage, roleKey, contextKey\)/);
  assert.match(coordinator,/useClinicalGuidedTutorial\(\{/);
  assert.match(coordinator,/role: normalizedRole,/);
  assert.match(coordinator,/clinicId: workspaceScopeKey,/);
  assert.match(coordinator,/authorizationHydrated,/);
  assert.equal((coordinator.match(/\{runGuidedTutorial && \(/g)||[]).length,2,'both desktop and mobile conditional overlays preserved');
  assert.doesNotMatch(hook,/fetch\(|supabase\.|stripe\.|setRole\(|clinic\.update\(/i);
  assert.doesNotMatch(coordinator,/setRunGuidedTutorial\(/);
});
