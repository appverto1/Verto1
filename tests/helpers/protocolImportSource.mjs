import { readFileSync } from 'node:fs';
import { extractedClinicalArrow } from './clinicalReadSource.mjs';

export const protocolImportManifest = JSON.parse(readFileSync('docs/backend-modularization/20261015-protocol-import-extraction.json', 'utf8'));
export { extractedClinicalArrow as extractedProtocolArrow };
export function readProtocolImportServerSource() {
  let source = readFileSync('server.ts', 'utf8');
  for (const route of protocolImportManifest.routes) {
    if (source.split(route.replacement).length !== 2) throw new Error(`Missing/duplicate protocol registration ${route.name}`);
    source = source.replace(route.replacement, extractedClinicalArrow(route));
  }
  return source.replace(protocolImportManifest.imports, '');
}
