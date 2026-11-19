import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadingSkeleton } from '../src/components/ui/LoadingSkeleton';

const scenarios = [
  { variant: 'admin', file: 'AdminDashboard.tsx', blocks: 12 },
  { variant: 'team', file: 'TeamManagement.tsx', blocks: 10 },
  { variant: 'partner', file: 'PartnerMarketplace.tsx', blocks: 12 },
  { variant: 'onboarding', file: 'ProfessionalOnboarding.tsx', blocks: 10 },
  { variant: 'commercial', file: 'CommercialDashboard.tsx', blocks: 12 },
  { variant: 'external-timeline', file: 'ExternalEvolutionShare.tsx', blocks: 5 },
] as const;

for (const { variant, file, blocks } of scenarios) {
  const markup = renderToStaticMarkup(React.createElement(LoadingSkeleton, { variant, label: 'Carregando dados' }));
  assert.match(markup, new RegExp('data-loading-skeleton="' + variant + '"'));
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-label="Carregando dados"/);
  assert.match(markup, /motion-reduce:animate-none/);
  assert.ok((markup.match(/animate-pulse/g) || []).length >= blocks, variant + ' should mirror content structure');
  const source = readFileSync('src/components/' + file, 'utf8');
  assert.match(source, /LoadingSkeleton/, file + ' should render a loading skeleton');
}
console.log('loading skeleton variants and integrations: OK');
