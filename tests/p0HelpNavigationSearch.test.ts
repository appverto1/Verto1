import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleHelpArticle, helpThemeIsExpanded } from '../src/help/helpNavigation';

const all = [
  { articleId:'clinical', title:'Coleta clínica', theme:'Atendimento' },
  { articleId:'agenda', title:'Remarcar agenda', theme:'Agenda' },
  { articleId:'finance', title:'Plano financeiro', theme:'Plano financeiro' },
];
assert.equal(visibleHelpArticle(all, all, 'clinical', false)?.articleId,'clinical','existing topic selected');
assert.equal(visibleHelpArticle(all, all, 'unavailable', false)?.articleId,'clinical','ordinary initial navigation selects first authorized topic');
assert.equal(visibleHelpArticle(all, [all[1]], 'clinical', true)?.articleId,'agenda','search does not show an unrelated previously opened article');
assert.equal(visibleHelpArticle(all, [all[1]], 'agenda', true)?.articleId,'agenda','searched topic selectable');
assert.equal(visibleHelpArticle(all, [], 'clinical', true),undefined,'no matches means no unrelated clinical article');
assert.equal(visibleHelpArticle([], [], 'agenda', false),undefined,'no authorized catalog means no article');
assert.equal(helpThemeIsExpanded('Agenda', {Agenda:false},'Atendimento',true),true,'search always expands previously collapsed matching theme');
assert.equal(helpThemeIsExpanded('Agenda', {Agenda:false},'Agenda',false),false,'manual collapse stays closed outside search');
assert.equal(helpThemeIsExpanded('Agenda', {},'Agenda',false),true,'selected theme starts open');
assert.equal(helpThemeIsExpanded('Agenda', {},'Atendimento',false),false,'other themes start closed');
assert.equal(helpThemeIsExpanded('Agenda', {Agenda:true},'Atendimento',false),true,'manual theme toggle can expand');
const source=readFileSync('src/components/HelpCenter.tsx','utf8');
assert.match(source,/visibleHelpArticle\(topics,filtered,selected,searching\)/,'UI must apply search-aware selection');
assert.match(source,/helpThemeIsExpanded\(group\.theme,expandedThemes,article\?\.theme,searching\)/,'UI must show search matches in theme drawer');
assert.match(source,/onClick=\{\(\)=>selectTopic\(item\.articleId\)\}/,'related topics use same route-aware selection');
assert.match(source,/fetch\('\/api\/help\/catalog',\{credentials:'include',cache:'no-store'\}\)/,'topic catalog remains server-authorized, not hardcoded client data');
console.log('p0HelpNavigationSearch: PASS');
