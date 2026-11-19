import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installClarityTracking } from '../src/clarity';

const events = new Map<string, () => void>();
const appended: Array<{ async?: boolean; src?: string; dataset: Record<string, string> }> = [];
const fakeDocument = {
  readyState: 'loading',
  querySelector: (selector: string) => selector.includes('data-clarity-id') && appended.length ? appended[0] : null,
  createElement: () => ({ dataset: {} as Record<string, string>, async: false, src: '' }),
  head: { appendChild: (element: any) => { appended.push(element); } },
};
const fakeWindow = {
  addEventListener: (type: string, handler: () => void) => events.set(type, handler),
  clarity: undefined as any,
};
const priorWindow = (globalThis as any).window;
const priorDocument = (globalThis as any).document;
try {
  (globalThis as any).window = fakeWindow;
  (globalThis as any).document = fakeDocument;
  installClarityTracking();
  assert.equal(appended.length, 0, 'analytics may not compete with the critical rendering path');
  assert.equal(typeof fakeWindow.clarity, 'function', 'queued Clarity calls must be available');
  fakeWindow.clarity('event', 'first-paint');
  assert.equal(fakeWindow.clarity.q.length, 1);
  events.get('load')?.();
  assert.equal(appended.length, 1, 'one asynchronous script after page load');
  assert.equal(appended[0].async, true);
  assert.match(appended[0].src || '', /^https:\/\/www\.clarity\.ms\/tag\//);
  installClarityTracking();
  assert.equal(appended.length, 1, 'repeated mounts must not duplicate tracker');
} finally {
  (globalThis as any).window = priorWindow;
  (globalThis as any).document = priorDocument;
}
const hero = readFileSync('src/components/LandingPage.tsx','utf8');
assert.match(hero, /fetchPriority=\{index === 0 \? 'high' : 'auto'\}/);
assert.match(hero, /loading=\{index === 0 \? 'eager' : 'lazy'\}/);
const css = readFileSync('src/index.css','utf8');
const html = readFileSync('index.html','utf8');
assert.doesNotMatch(css + html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
assert.match(css, /outfit-variable\.woff2/);
assert.match(css, /font-display:\s*swap/);
assert.match(html, /rel="preload" as="font" type="font\/woff2"/);
assert.equal(readFileSync('src/assets/fonts/outfit-variable.woff2').subarray(0,4).toString('ascii'), 'wOF2');
assert.match(readFileSync('src/assets/fonts/OFL-Outfit.txt','utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
console.log('first-paint: PASS (delayed analytics, hero priority, self-hosted WOFF2)');
