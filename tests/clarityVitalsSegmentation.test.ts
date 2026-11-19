import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installClarityTracking } from '../src/clarity';

function simulate(pathname: string, effectiveType?: string) {
  const events = new Map<string, () => void>();
  const scripts: any[] = [];
  const fakeDocument = {
    readyState: 'loading',
    querySelector: () => null,
    createElement: () => ({ dataset: {} as Record<string, string> }),
    head: { appendChild: (node: any) => scripts.push(node) },
  };
  const fakeWindow = { location: { pathname }, clarity: undefined as any, addEventListener: (type: string, fn: () => void) => events.set(type, fn) };
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  const originalNavigator = (globalThis as any).navigator;
  try {
    (globalThis as any).window = fakeWindow;
    (globalThis as any).document = fakeDocument;
    Object.defineProperty(globalThis, 'navigator', { value: { connection: { effectiveType } }, configurable: true });
    installClarityTracking();
    assert.equal(scripts.length, 0, 'no analytics network on first paint');
    assert.ok(events.has('load'));
    const tags = fakeWindow.clarity.q.filter((item: any[]) => item[0] === 'set');
    assert.equal(tags.length, 2);
    events.get('load')!();
    assert.equal(scripts.length, 1);
    return tags;
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    if (originalNavigator === undefined) delete (globalThis as any).navigator;
    else Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  }
}

assert.deepEqual(simulate('/', '3g'), [
  ['set','verto_page_group','app'],
  ['set','verto_connection_type','3g']
]);
assert.deepEqual(simulate('/evolucao-compartilhada/SECRET-PATIENT-ID?access=token', '4g'), [
  ['set','verto_page_group','shared-timeline'],
  ['set','verto_connection_type','4g']
]);
assert.deepEqual(simulate('/parcerias/lead/partner-secret', 'fast-7g'), [
  ['set','verto_page_group','partners'],
  ['set','verto_connection_type','unknown']
]);
assert.deepEqual(simulate('/user/mateus@email.com/123', undefined), [
  ['set','verto_page_group','other'],
  ['set','verto_connection_type','unknown']
]);
const source = readFileSync('src/clarity.ts','utf8');
assert.match(source,/verto_page_group/);
assert.match(source,/verto_connection_type/);
assert.doesNotMatch(source,/location\.search/);
assert.doesNotMatch(source,/patientId|clinicId|access_token/);
console.log('Clarity privacy-safe page/connection tags: PASS');
