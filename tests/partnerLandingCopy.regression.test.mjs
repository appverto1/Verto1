import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('Sou parceiro > Rede de Cuidado has no clinical data sharing claim',()=>{
  const landing=readFileSync('src/components/LandingPage.tsx','utf8');
  const start=landing.indexOf("openAudienceEntry('care-network')");
  assert.notEqual(start,-1,'care network entry must remain');
  const choice=landing.slice(start,start+900);
  assert.match(choice,/Rede de Cuidado/,'entry title stays intact');
  assert.doesNotMatch(choice,/Conteúdos clínicos compartilhados/i,'sharing claim must not be displayed');
  assert.match(choice,/Programa de Parcerias/,'partner program entry stays intact');
  assert.match(choice,/href="\/parcerias"/,'partner program navigation must remain');
});
