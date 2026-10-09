import assert from 'node:assert/strict';
import fs from 'node:fs';

const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const tutorial = fs.readFileSync('src/components/Tutorial.tsx', 'utf8');
const settings = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const help = fs.readFileSync('src/components/HelpButton.tsx', 'utf8');
const hint = fs.readFileSync('src/components/HelpButtonHint.tsx', 'utf8');

assert.match(coordinator, /GUIDED_TUTORIAL_REVISION = "p0-contextual-v1"/);
assert.match(coordinator, /guidedTutorialContextKey = \[[\s\S]*user\?\.id[\s\S]*workspaceScopeKey[\s\S]*normalizedRole[\s\S]*moduleAccessMode[\s\S]*guidedTutorialModuleSignature/);
assert.match(coordinator, /Array\.from\(organizationModules\)\.sort\(\)\.join\(","\)/);
assert.match(coordinator, /canAccessTab\("patients"\)/);
assert.match(coordinator, /canAccessTab\("agenda"\)/);
assert.match(coordinator, /canAccessTab\("protocols"\)/);
assert.match(coordinator, /canAccessTab\("team"\)/);
assert.doesNotMatch(coordinator, /guidedTutorialSteps[\s\S]{0,6000}requiredModules/, 'guided tour must reuse canonical tab authorization rather than inventing a second module policy');

assert.match(coordinator, /data-tutorial-anchor=\{`nav-\$\{item\.id\}`\}/);
assert.match(help, /data-tutorial-anchor="help-center"/);
assert.match(settings, /data-tutorial-anchor="account-menu"/);
assert.match(settings, /Reiniciar tutorial guiado/);
assert.match(settings, /onOpenGuidedTutorial/);

assert.match(coordinator, /persistGuidedTutorial\("active", safeStep\)/);
assert.match(coordinator, /stored\.status === "active"/);
assert.match(coordinator, /if \(stored\.status === "active"\) setShowHelpHint\(true\)/);
assert.match(coordinator, /setShowHelpHint\(true\)/);
assert.match(coordinator, /setRunGuidedTutorial\(false\)/);
assert.match(coordinator, /<HelpButtonHint onClose=\{dismissHelpHint\} \/>/);
assert.doesNotMatch(coordinator, /stored\.status === "active"[\s\S]{0,240}setRunGuidedTutorial\(true\)/);
assert.match(hint, /data-tutorial-anchor="help-center"/);
assert.match(hint, /createPortal/);
assert.match(hint, /role="region"/);
assert.doesNotMatch(hint, /aria-modal|boxShadow:.*9999px/);
assert.match(coordinator, /reason === "skip" \? "skipped" : reason === "complete" \? "completed" : "active"/);
assert.match(coordinator, /onOpenGuidedTutorial=\{startGuidedTutorial\}/);
assert.match(coordinator, /window\.matchMedia\("\(max-width: 1023px\)"\)/);
assert.match(coordinator, /setIsMobileMenuOpen\(step\.targetId\.startsWith\("nav-"\)\)/);

assert.match(tutorial, /findVisibleTutorialTarget/);
assert.match(tutorial, /data-tutorial-anchor/);
assert.match(tutorial, /onClose\('pause'\)/);
assert.match(tutorial, /onClose\('skip'\)/);
assert.match(tutorial, /onClose\('complete'\)/);
assert.match(tutorial, />\s*Pular tutorial\s*</);
assert.match(tutorial, /aria-label="Pausar tutorial"/);

console.log('contextualGuidedTutorialP0.regression.test.mjs: ok');
