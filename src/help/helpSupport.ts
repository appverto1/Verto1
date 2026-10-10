import type { HelpArticle } from './helpManifest';

export const normalizeHelp=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const ignored=new Set('a o as os de do da dos das e em no na nos nas um uma para por com que quero queria gostaria aprender entender saber como fazer preciso ajuda meu minha sobre'.split(' '));
export const supportCategory=(article:Pick<HelpArticle,'articleId'|'theme'>)=>{
  const id=article.articleId;
  if(id.startsWith('agenda-'))return 'Gestão de agenda';
  if(id.startsWith('financeiro-')||id.startsWith('recebimento-'))return 'Módulo financeiro';
  if(id.startsWith('atendimento-')||id.startsWith('evolucao-'))return 'Prontuários e evolução';
  if(id.startsWith('paciente-'))return 'Cadastro de pacientes';
  if(id.startsWith('equipe-'))return 'Equipe e acessos';
  if(id.startsWith('clin-')||id.startsWith('salas-'))return 'Clínica e salas';
  if(id.startsWith('prof-'))return 'Meu perfil profissional';
  return article.theme;
};
export const pausedSupportQuery=(query:string)=>/\b(recorr\w*|cancel\w*|estorn\w*|cortesia|desconto\w*|tiss|xml|convenio\w*|escola\w*)\b/.test(normalizeHelp(query));
export function findSupportTopics<T extends HelpArticle>(articles:readonly T[],query:string,category=''):T[]{
  const candidates=normalizeHelp(query).split(/[^a-z0-9]+/).filter(word=>word.length>2&&!ignored.has(word)).map(word=>word.length>4?word.replace(/s$/,''):word);
  const generic=new Set(['paciente','sessao','agenda','financeiro','modulo','dado']);
  const specific=candidates.filter(word=>!generic.has(word));
  const words=specific.length?specific:candidates;
  if(!words.length||pausedSupportQuery(query))return [];
  return articles.filter(article=>article.contentRevision&&(!category||supportCategory(article)===category))
    .map(article=>{
      const title=normalizeHelp(article.title),curated=normalizeHelp([...(article.keywords||[]),...(article.synonyms||[])].join(' '));
      const labels=normalizeHelp((article.tutorialSteps||[]).map(step=>step.label).join(' '));
      const score=words.reduce((sum,word)=>sum+(title.includes(word)?8:curated.includes(word)?6:labels.includes(word)?2:0),0);
      return {article,score};
    }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.article.title.localeCompare(b.article.title,'pt-BR')).slice(0,4).map(item=>item.article);
}
