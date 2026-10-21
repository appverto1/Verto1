import assert from 'node:assert/strict';
import fs from 'node:fs';

const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const tutorial = fs.readFileSync('src/components/Tutorial.tsx', 'utf8');
const settings = fs.readFileSync('src/components/SettingsMenu.tsx', 'utf8');
const help = fs.readFileSync('src/components/HelpButton.tsx', 'utf8');

assert.match(coordinator, /GUIDED_TUTORIAL_REVISION = "p0-contextual-v1"/);
assert.match(coordinator, /guidedTutorialContextKey = \[[\s\S]*user\?\.id[\s\S]*workspaceScopeKey[\s\S]*normalizedRole[\s\S]*moduleAccessMode[\s\S]*guidedTutorialModuleSignature/);
assert.match(coordinator, /Array\.from\(organizationModules\)\.sort\(\)\.join\(","\)/);
assert.doesNotMatch(coordinator, /guidedTutorialSteps[\s\S]{0,6000}requiredModules/, 'guided tour must reuse canonical tab authorization rather than inventing a second module policy');

assert.match(coordinator, /data-tutorial-anchor=\{`nav-\$\{item\.id\}`\}/);
// Only one onboarding balloon is permitted. Menu items differ between mobile
// drawer and desktop sidebar, so none of them may become a guided-tour step.
const tutorialStart = coordinator.indexOf('  const guidedTutorialSteps = [');
const tutorialEnd = coordinator.indexOf('  const persistGuidedTutorial =', tutorialStart);
assert.ok(tutorialStart > 0 && tutorialEnd > tutorialStart, 'tutorial source located');
const tutorialSteps = coordinator.slice(tutorialStart, tutorialEnd);
assert.equal((tutorialSteps.match(/targetId:/g) || []).length, 1, 'exactly one tutorial step');
assert.match(tutorialSteps, /targetId: "help-center"/);
assert.ok(tutorialSteps.includes('interrogação (?)'), 'the balloon explains the help button');
assert.ok(!tutorialSteps.includes('targetId: "nav-')
  && !tutorialSteps.includes('targetId: "account-menu"')
  && !tutorialSteps.includes('canAccessTab('),
  'no sidebar, navigation or account menu steps on desktop/mobile');
assert.ok(coordinator.includes('Math.min(guidedTutorialSteps.length - 1, Number(stored.step || 0))'),
  'old active multistep state must safely resume on the only help step');
assert.ok(coordinator.includes('const guidedTutorialTargetId = guidedTutorialSteps[guidedTutorialStep]?.targetId || "";'),
  'guided help uses the stable target ID rather than the recreated step array');
assert.match(coordinator, /\}, \[guidedTutorialTargetId, runGuidedTutorial\]\);/,
  'opening the mobile drawer manually must not retrigger the tutorial drawer synchronization');
assert.doesNotMatch(coordinator, /\}, \[guidedTutorialStep, guidedTutorialSteps, runGuidedTutorial\]\);/,
  'a freshly allocated guidedTutorialSteps array must never force-close an opened drawer');
assert.ok(tutorial.includes('steps.length > 1 && (')
  && tutorial.includes('Passo {currentStepIndex + 1} de {steps.length}'),
  'one-step help must not show a meaningless step counter');
assert.ok(tutorial.includes('steps.length > 1 && (')
  && tutorial.includes('Pular tutorial'),
  'one-step help must not offer a skip action');
assert.ok(tutorial.includes("steps.length === 1 ? 'Entendi' : 'Concluir'"));
assert.ok(tutorial.includes("onClose('complete')"));

assert.match(help, /data-tutorial-anchor="help-center"/);
assert.match(settings, /data-tutorial-anchor="account-menu"/);
assert.match(settings, /Reiniciar tutorial guiado/);
assert.match(settings, /onOpenGuidedTutorial/);

assert.match(coordinator, /persistGuidedTutorial\("active", safeStep\)/);
assert.match(coordinator, /stored\.status === "active"/);
assert.match(coordinator, /reason === "skip" \? "skipped" : reason === "complete" \? "completed" : "active"/);
assert.match(coordinator, /onOpenGuidedTutorial=\{startGuidedTutorial\}/);
assert.match(coordinator, /window\.matchMedia\("\(max-width: 1023px\)"\)/);
assert.match(coordinator, /setIsMobileMenuOpen\(guidedTutorialTargetId\.startsWith\("nav-"\)\)/);

// Render outside sticky, transformed or animated headers: a local z-index
// cannot escape its parent's stacking context over the patient record drawer.
assert.match(tutorial, /import \{ createPortal \} from 'react-dom'/);
assert.match(tutorial, /return createPortal\(/);
assert.match(tutorial, /document\.body,/);
const tutorialLayer = Number(tutorial.match(/className="fixed inset-0 z-\[(\d+)\] overflow-hidden"/)?.[1]);
assert.ok(tutorialLayer > 205 && tutorialLayer < 9500,
  'tutorial must sit above clinical dialogs, but below global safety overlays');
assert.match(tutorial, /role="dialog" aria-modal="true" aria-label="Tutorial guiado da Verto"/);
assert.match(tutorial, /maxWidth: 'calc\(100vw - 24px\)'/);
assert.match(tutorial, /maxHeight: 'calc\(100dvh - 24px\)'/);
assert.match(tutorial, /onClick=\{\(\) => onClose\('pause'\)\}/);
assert.match(tutorial, /onClick=\{\(\) => onClose\('skip'\)\}/);
assert.match(tutorial, /onStepChange\(currentStepIndex \+ 1\)/);
assert.match(coordinator, /<TutorialOverlay/);
const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
assert.match(detail, /<TutorialOverlay/,
  'the same portal fixes the coordinator and patient-level tutorials');

assert.match(tutorial, /findVisibleTutorialTarget/);
assert.match(tutorial, /data-tutorial-anchor/);
assert.match(tutorial, /onClose\('pause'\)/);
assert.match(tutorial, /onClose\('skip'\)/);
assert.match(tutorial, /onClose\('complete'\)/);
assert.match(tutorial, />\s*Pular tutorial\s*</);
assert.match(tutorial, /aria-label="Pausar tutorial"/);

console.log('contextualGuidedTutorialP0.regression.test.mjs: ok');
