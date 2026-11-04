/**
 * Verto's Task 01 server-side extraction. No change without explicit --apply.
 * Restricted to the dedicated staging feature branch and the pinned server blob.
 */
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SERVER=path.join(ROOT,'server.ts');
const TARGET=path.join(ROOT,'services/publicSalesLeadRoutes.ts');
const FEATURE_BRANCH='refactor/critical-sellable-01-public-lead-20261104';
const EXPECTED_SERVER_BLOB='48d27b07f17efff9b60e8d01e3ce28459c256981';
const EXPECTED_ROUTE_FNV='96ec6eef';
const deps=['supabase','publicSalesLeadIpLimiter','publicSalesLeadIdentityLimiter','sanitizeString','sanitizeEmail','normalizeSalesPhone','normalizeSalesInteger','isUuid','isMissingRelationError','notifySalesOwnerForLead','SALES_PUBLIC_PAYLOAD_MAX_BYTES','SALES_ESTIMATED_ACTIVE_PATIENTS_MAX','SALES_ESTIMATED_PROFESSIONALS_MAX','SALES_CONTACT_CONSENT_VERSION','SALES_OPERATION_TYPES','SALES_PREFERRED_CONTACT_PERIODS','BRAZIL_STATE_CODES'];
const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8'}).trim();
const fnv32=(s)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};

export function extractPublicLeadRoute(server){
  const needle='  app.post(\n    "/api/public/sales-leads",';
  const start=server.indexOf(needle);
  const end=server.indexOf('\n  const sanitizePublicOfferDiscount',start);
  if(start<0||end<=start||server.indexOf(needle,start+1)!==-1)throw Error('Route boundary changed');
  if(server.split("import express from 'express';").length!==2)throw Error('Import boundary changed');
  const original=server.slice(start,end);
  if(fnv32(original)!==EXPECTED_ROUTE_FNV)throw Error('Frozen staging route contract changed');
  const relocated=original.replace('async (req: any, res) => {','async (req: any, res: any) => {');
  if(relocated===original)throw Error('Route signature changed');
  const args='  registerPublicSalesLeadRoute(app, {\n'+deps.map(n=>'    '+n+',\n').join('')+'  });\n';
  const modifiedServer=(server.slice(0,start)+args+server.slice(end)).replace("import express from 'express';","import { registerPublicSalesLeadRoute } from './services/publicSalesLeadRoutes';\nimport express from 'express';");
  const module="import crypto from 'crypto';\n\n// Extraction-only: existing backend middleware and RPC remain authoritative.\nexport function registerPublicSalesLeadRoute(app: any, deps: any): void {\n  const {\n"+deps.map(n=>'    '+n+',\n').join('')+'  } = deps;\n\n'+relocated+'\n}\n';
  const reconstructed=module.slice(module.indexOf(needle),module.lastIndexOf('\n}\n')).replace('async (req: any, res: any) => {','async (req: any, res) => {');
  if(reconstructed!==original||modifiedServer.includes(needle))throw Error('Source parity violation');
  return {modifiedServer,module,originalRouteBytes:Buffer.byteLength(original)};
}

function main(){
  const apply=process.argv.includes('--apply');
  if(process.argv.some(x=>x.startsWith('--')&&!['--apply','--dry-run'].includes(x)))throw Error('Unknown argument');
  if(git('branch','--show-current')!==FEATURE_BRANCH)throw Error('Only feature branch may be modified');
  if(git('hash-object','server.ts')!==EXPECTED_SERVER_BLOB)throw Error('Server baseline blob differs');
  if(existsSync(TARGET))throw Error('Target route module already exists');
  if(apply&&git('status','--porcelain')!=='')throw Error('Working tree must be clean');
  const source=readFileSync(SERVER,'utf8');
  const output=extractPublicLeadRoute(source);
  if(!apply){
    console.log(JSON.stringify({status:'DRY_RUN_PASS',oldServerBytes:Buffer.byteLength(source),newServerBytes:Buffer.byteLength(output.modifiedServer),moduleBytes:Buffer.byteLength(output.module),routeBytes:output.originalRouteBytes,paths:['server.ts','services/publicSalesLeadRoutes.ts']}));
    return;
  }
  try{writeFileSync(TARGET,output.module,{flag:'wx'});writeFileSync(SERVER,output.modifiedServer);}
  catch(error){writeFileSync(SERVER,source);if(existsSync(TARGET))unlinkSync(TARGET);throw error;}
  console.log(JSON.stringify({status:'EXTRACTION_APPLIED_UNCOMMITTED',paths:['server.ts','services/publicSalesLeadRoutes.ts']}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main();
