import type { HelpArticle } from '../src/help/helpManifest';
import { publishedHelpProjection } from '../src/help/helpManifest';
import catalog from '../src/help/tutorialCatalog.json';

// Server-only catalog. Tutorial visibility is informational: it never grants
// API, patient, financial or clinic permissions to the authenticated user.
export const TUTORIAL_ARTICLES = catalog as HelpArticle[];

// Only the receptionist/assistant role has a reduced tutorial catalog.
// All other verified clinic roles, including every clinical specialty and
// legacy supervisor, can read all topics (not necessarily execute the actions).
const FULL_TUTORIAL_ROLES = new Set(['director', 'coordinator', 'therapist', 'supervisor', 'biller']);
const RECEPTION_THEMES = new Set([
  'Comece aqui', 'Primeiro paciente', 'Responsáveis', 'Agenda',
  'Plano financeiro', 'Recebimento particular', 'Rotina da recepção',
]);
const RECEPTION_FINANCIAL_PLANS = new Set([
  'financeiro-acesso', 'financeiro-particular', 'financeiro-mensal',
]);

// Multiple tailored versions of a topic share articleId. Return a single
// version per subject, preferring the professional's own screenshots/steps.
function uniqueTutorialsForRole(audience: string, candidates: readonly HelpArticle[]): HelpArticle[] {
  const byId = new Map<string, HelpArticle>();
  for (const article of candidates) {
    if (article.status !== 'published') continue;
    const previous = byId.get(article.articleId);
    if (!previous || (!previous.audiences.includes(audience) && article.audiences.includes(audience))) {
      byId.set(article.articleId, article);
    }
  }
  return [...byId.values()];
}

export function publishedTutorialHelpProjection(audience:string, capabilities:readonly string[], modules:readonly string[]=[]) {
  const role=String(audience||'').trim().toLowerCase();
  let tutorialArticles: HelpArticle[]=[];
  if (FULL_TUTORIAL_ROLES.has(role)) {
    tutorialArticles=uniqueTutorialsForRole(role,TUTORIAL_ARTICLES);
  } else if (role==='receptionist') {
    tutorialArticles=uniqueTutorialsForRole(role,TUTORIAL_ARTICLES.filter(article=>
      // Use reception-specific instructions, never the director's general
      // administrative / clinical material. The only fallback is the three
      // patient financial-plan subjects requested for reception.
      (article.audiences.includes('receptionist') && (
        RECEPTION_THEMES.has(article.theme) ||
        (article.articleId==='atendimento-proximos' && article.theme==='Continuidade')
      )) ||
      (RECEPTION_FINANCIAL_PLANS.has(article.articleId) &&
        article.audiences.includes('director') && article.theme==='Plano financeiro')
    ));
  }
  // Regular help articles retain their existing role/capability/module rules.
  // The tutorial projection intentionally does not grant underlying access.
  return [...tutorialArticles,...publishedHelpProjection(role,capabilities,modules)];
}
