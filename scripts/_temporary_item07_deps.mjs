import ts from 'typescript';
import {readFileSync,writeFileSync} from 'node:fs';
const cfg=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(cfg.error) throw Error(ts.flattenDiagnosticMessageText(cfg.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,'.');
const opts={...parsed.options,skipLibCheck:true,noEmit:true};
const pair=[
  {module:'services/salesModularCheckoutCore.ts',serverMarker:'// ITEM07_CORE_INJECT',depMarker:'// ITEM07_CORE_DEPS',name:'CORE'},
  {module:'services/publicSalesCheckoutRoutes.ts',serverMarker:'// ITEM07_PUBLIC_INJECT',depMarker:'// ITEM07_PUBLIC_DEPS',name:'PUBLIC'}
];
let server=readFileSync('server.ts','utf8');
for(const section of pair){
 const program=ts.createProgram([section.module],opts);
 const file=program.getSourceFile(section.module);
 if(!file)throw Error('Not in compilation: '+section.module);
 const ds=ts.getPreEmitDiagnostics(program,file);
 const missing=new Set;
 for(const d of ds){
   if(d.code===2304||d.code===2552||d.code===2503){
     const m=ts.flattenDiagnosticMessageText(d.messageText,'\n').match(/(?:name|namespace) '([^']+)'/);
     if(m)missing.add(m[1]);
   }
 }
 missing.add('crypto'); // Node crypto shadows browser crypto in original server.ts.
 const names=[...missing].filter(x=>!['Stripe','SalesSimulationInput','SalesUsageProfile'].includes(x)).sort();
 console.log(section.name+'_UNRESOLVED_RUNTIME_DEPENDENCIES',JSON.stringify(names));
 const imports="import type { SalesSimulationInput, SalesUsageProfile } from '../src/utils/salesProfitability';\n";
 let mod=readFileSync(section.module,'utf8');
 mod=mod.replace("import type Stripe from 'stripe';\n", "import type Stripe from 'stripe';\n"+imports);
 const line="  const { "+names.join(', ')+" } = deps;";
 if(!mod.includes(section.depMarker))throw Error('Missing module marker '+section.depMarker);
 mod=mod.replace('  '+section.depMarker, line);
 writeFileSync(section.module,mod);
 const injections=names.filter(x=>section.name!=='PUBLIC'||x!=='createOrReuseModularCheckout').map(x=>'    '+x+',').join('\n');
 if(!server.includes(section.serverMarker))throw Error('Missing server marker: '+section.serverMarker);
 server=server.replace('    '+section.serverMarker,injections);
}
writeFileSync('server.ts',server);
for(const section of pair){
  const program=ts.createProgram([section.module],opts);
  const file=program.getSourceFile(section.module);
  const diagnostics=ts.getPreEmitDiagnostics(program,file);
  console.log(section.name+'_TYPESCRIPT_DIAGNOSTIC_COUNT',diagnostics.length);
  for(const d of diagnostics.slice(0,16))console.log('MODULE_DIAGNOSTIC',section.name,d.code,ts.flattenDiagnosticMessageText(d.messageText,' '));
  if(diagnostics.length>0)process.exitCode=1;
}
