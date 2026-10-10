import type { HelpArticle } from '../src/help/helpManifest';
import { publishedHelpProjection } from '../src/help/helpManifest';
import catalog from '../src/help/tutorialCatalog.json';

// Imported only by the server. Never send the unfiltered role catalog to a browser.
export const TUTORIAL_ARTICLES = catalog as HelpArticle[];
export function publishedTutorialHelpProjection(audience:string, capabilities:readonly string[], modules:readonly string[]=[]) {
  const allowed=new Set(capabilities), enabled=new Set(modules);
  const tutorials=TUTORIAL_ARTICLES.filter(article=>
    article.status==='published' && article.audiences.includes(audience) &&
    article.requiredCapabilities.every(cap=>allowed.has(cap)) &&
    (article.requiredModules||[]).every(module=>enabled.has(module))
  );
  return [...tutorials,...publishedHelpProjection(audience,capabilities,modules)];
}
