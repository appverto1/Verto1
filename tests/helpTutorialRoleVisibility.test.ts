import assert from 'node:assert/strict';
import {TUTORIAL_ARTICLES,publishedTutorialHelpProjection} from '../services/helpTutorialCatalog';

const sourceUnique=new Set(TUTORIAL_ARTICLES.map(a=>a.articleId));
assert.equal(sourceUnique.size,56,'regression: all 56 unique source tutorials remain intact');
const completeRoles=['director','coordinator','therapist','supervisor','biller'];
for (const role of completeRoles) {
  const projected=publishedTutorialHelpProjection(role,[],[]);
  const tutorials=projected.filter(article=>sourceUnique.has(article.articleId));
  assert.equal(tutorials.length,sourceUnique.size,role+' should see every source topic without requiring privileged capabilities/modules');
  assert.equal(new Set(tutorials.map(article=>article.articleId)).size,sourceUnique.size,role+' must not get duplicated variants');
  assert.ok(projected.some(article=>article.articleId==='clinic-notices-guide-v1'),role+' must see Avisos');
  assert.ok(projected.some(article=>article.articleId==='financeiro-particular'),role+' must see financial plan guidance');
  assert.ok(projected.some(article=>article.articleId==='atendimento-evolucao'),role+' must see clinical-session guidance');
}
const professional=publishedTutorialHelpProjection('therapist',[],[]);
const checkPreferred=(id:string,audience:string)=>{
  const article=professional.find(a=>a.articleId===id);
  assert.ok(article,'missing '+id);
  assert.ok(article.audiences.includes(audience),'must prefer the correct role-specific screenshots for '+id);
};
checkPreferred('como-acessar','therapist');
checkPreferred('paciente-acesso','therapist');
checkPreferred('atendimento-proximos','therapist');

const front=publishedTutorialHelpProjection('receptionist',[],[]);
const frontTutorials=front.filter(article=>sourceUnique.has(article.articleId));
const allowedThemes=new Set(['Comece aqui','Primeiro paciente','Responsáveis','Agenda','Plano financeiro','Recebimento particular','Rotina da recepção']);
assert.equal(frontTutorials.length,22,'reception should have 19 existing tutorials and three financial-plan tutorials');
for(const article of frontTutorials){
  assert.ok(allowedThemes.has(article.theme) || article.articleId==='atendimento-proximos','out of scope topic '+article.articleId);
  assert.ok(!article.articleId.startsWith('clin-'),'reception must not receive clinic administration');
  assert.ok(!article.articleId.startsWith('equipe-'),'reception must not receive team administration');
}
for(const id of ['financeiro-acesso','financeiro-particular','financeiro-mensal','recebimento-registrar','recebimento-parcial','agenda-remarcar','paciente-identificacao','recepcao-rotina']){
  assert.ok(front.some(article=>article.articleId===id),'reception must receive '+id);
}
assert.ok(front.some(article=>article.articleId==='clinic-notices-guide-v1'),'reception must receive Avisos');
assert.ok(!front.some(article=>article.articleId==='atendimento-evolucao'),'reception cannot see specialist clinical session instructions');
assert.ok(!front.some(article=>article.articleId==='equipe-papeis'),'reception cannot see permissions-management instructions');
assert.ok(!front.some(article=>article.articleId==='clin-fiscal-anamnese'),'reception cannot see clinic tax/anamnesis settings');
assert.ok(!front.some(article=>article.articleId==='billing-orientation-v1'),'billing specialist guide stays specific to biller');
assert.ok(front.find(a=>a.articleId==='como-acessar')?.audiences.includes('receptionist'),'reception variants retained');

const patient=publishedTutorialHelpProjection('patient',[],[]);
assert.equal(patient.length,0,'the patient portal is isolated from clinic staff tutorials');
const unknown=publishedTutorialHelpProjection('assistant-unknown',[],[]);
assert.equal(unknown.length,0,'unknown roles fail closed');

const ids=new Set<string>();
for(const article of front){
  assert.ok(!ids.has(article.articleId),'unique topic IDs also required for reception');
  ids.add(article.articleId);
}
console.log('helpTutorialRoleVisibility.test.ts: PASS (all clinic roles, reception scope, no permissions bypass)');
