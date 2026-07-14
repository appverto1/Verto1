import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const readSource = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const commonCode = readSource('src/components/Common.tsx');
const coordinatorCode = readSource('src/components/CoordinatorDashboard.tsx');
const affectedSurfaceSources = [
  'src/components/PayerRequirementsPanel.tsx',
  'src/components/TissPreGuideTab.tsx',
  'src/components/CoordinatorDashboard.tsx',
  'src/components/ClinicGlobalSettingsPanel.tsx',
  'src/components/TeamManagement.tsx',
].map(readSource).join('\n');

const channel = (hex: string, offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
const luminance = (hex: string) => {
  const linear = [1, 3, 5].map((offset) => {
    const value = channel(hex, offset);
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
};
const contrastRatio = (foreground: string, background: string) => {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
};

test('tema escuro cobre textos legados e superfícies translúcidas sem alterar o tema claro', () => {
  assert.match(affectedSurfaceSources, /text-slate-(?:800|950)/);
  assert.match(affectedSurfaceSources, /bg-(?:white|slate-50|violet-50|emerald-50)\/(?:40|50|60|70|80)/);

  assert.match(commonCode, /body\.theme-dark \.text-slate-950,[\s\S]*?body\.theme-dark \.text-slate-800/);
  assert.ok(commonCode.includes('body.theme-dark .bg-white\\\\/60'));
  assert.ok(commonCode.includes('body.theme-dark .bg-slate-50\\\\/80'));
  assert.ok(commonCode.includes('body.theme-dark .bg-violet-50\\\\/70'));
  assert.ok(commonCode.includes('body.theme-dark .bg-emerald-50\\\\/80'));
  assert.match(commonCode, /body\.theme-dark \.text-amber-950/);
  assert.match(commonCode, /body\.theme-dark \.text-emerald-950/);
  assert.match(commonCode, /body\.theme-dark \.text-sky-950/);
  assert.match(commonCode, /body\.theme-dark \.text-rose-900/);
  assert.match(commonCode, /body\.theme-dark \.text-violet-950/);
  assert.match(commonCode, /body\.theme-dark \.bg-emerald-400\.text-emerald-950/);
  assert.match(commonCode, /body\.theme-dark \.bg-amber-400\.text-amber-950/);
  assert.match(commonCode, /body\.theme-dark \.bg-sky-400\.text-sky-950/);
});

test('paleta textual do tema escuro mantém contraste legível', () => {
  const darkSurface = '#111b2f';
  ['#e5e7eb', '#cbd5e1', '#c4b5fd', '#7dd3fc', '#fcd34d', '#fda4af', '#6ee7b7'].forEach((color) => {
    assert.ok(contrastRatio(color, darkSurface) >= 4.5, `${color} deve manter contraste AA no fundo escuro`);
  });
});

test('gráficos financeiros preservam cores claras e usam contraste próprio no tema escuro', () => {
  assert.match(coordinatorCode, /financialChartGridColor = theme === "dark" \? "#334155" : "#F1F5F9"/);
  assert.match(coordinatorCode, /financialChartAxisColor = theme === "dark" \? "#CBD5E1" : "#94A3B8"/);
  assert.match(coordinatorCode, /financialChartStrongAxisColor = theme === "dark" \? "#E2E8F0" : "#64748B"/);
  assert.match(coordinatorCode, /financialChartCursorColor = theme === "dark" \? "rgba\(148, 163, 184, 0\.08\)" : "#F8FAFC"/);
  assert.match(coordinatorCode, /stroke=\{financialChartGridColor\}/);
  assert.match(coordinatorCode, /fill: financialChartAxisColor/);
  assert.match(coordinatorCode, /fill: financialChartStrongAxisColor/);
  assert.match(coordinatorCode, /cursor=\{\{ fill: financialChartCursorColor \}\}/);
});
