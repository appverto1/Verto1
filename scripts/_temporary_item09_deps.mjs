import ts from 'typescript';
import fs from 'node:fs';
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'.');
const opts={...parsed.options,noEmit:true,skipLibCheck:true};
const groups=[
{id:'eventState',path:'services/stripeWebhookEventState.ts',factory:'createStripeWebhookEventState'},
{id:'discount',path:'services/salesSubscriptionDiscountSync.ts',factory:'createSalesSubscriptionDiscountSync'},
{id:'paid',path:'services/salesAssistedCheckoutPaymentProcessor.ts',factory:'createSalesAssistedCheckoutPaymentProcessor'},
{id:'financial',path:'services/salesSubscriptionFinancialReconciliation.ts',factory:'createSalesSubscriptionFinancialReconciliation'},
{id:'schedule',path:'services/salesModularSubscriptionSchedule.ts',factory:'createSalesModularSubscriptionSchedule'},
{id:'entitlements',path:'services/salesSubscriptionEntitlementTransitions.ts',factory:'createSalesSubscriptionEntitlementTransitions'},
];
let server=fs.readFileSync('server.ts','utf8');
const allPaths=groups.map(g=>g.path);
const program=ts.createProgram(allPaths,opts);
for(const g of groups){
 const sf=program.getSourceFile(g.path);
 if(!sf)throw Error('Missing module '+g.path);
 const diags=ts.getPreEmitDiagnostics(program,sf);
 const missing=new Set();
 for(const d of diags){
  if([2304,2503,2552].includes(d.code)){
    const m=ts.flattenDiagnosticMessageText(d.messageText,' ').match(/(?:name|namespace) '([^']+)'/);
    if(m)missing.add(m[1]);
  }
 }
 missing.delete('crypto');missing.delete('Stripe');
 const names=[...missing].sort();
 let content=fs.readFileSync(g.path,'utf8');
 const marker='  // ITEM09_'+g.id+'_DEPS';
 if(!content.includes(marker))throw Error('Missing dependency marker '+marker);
 content=content.replace(marker,'  const { '+names.join(', ')+' } = deps;');
 fs.writeFileSync(g.path,content);
 const serverMarker='// ITEM09_'+g.id+'_INJECT';
 if(!server.includes(serverMarker))throw Error('Missing server injection '+serverMarker);
 const originalPos=server.indexOf(g.factory+'({');
 const injections=names.map(name=>{
   const depDecl=new RegExp('(^|\\n)\\s*(?:const|let|(?:async )?function)\\s+'+name+'\\b','g');
   const m=depDecl.exec(server);
   if(m && m.index>originalPos && g.id!=='eventState') {
     console.log('ITEM09_LAZY_LATE_DEPENDENCY',g.id,name,m.index,originalPos);
     const tail=server.slice(m.index,m.index+150);
     if(!new RegExp('\\b'+name+'\\s*(?:=\\s*(?:async\\s*)?\\(|=\\s*async\\b|\\()').test(tail))
       throw Error('Late constant dependency cannot be silently wrapped: '+g.id+':'+name);
     return '    '+name+': (...args: any[]) => ('+name+' as any)(...args),';
   }
   return '    '+name+',';
 }).join('\n');
 server=server.replace('    '+serverMarker,injections).replace('  '+serverMarker,injections);
 console.log('ITEM09_RUNTIME_DEPENDENCIES',g.id,JSON.stringify(names));
}
fs.writeFileSync('server.ts',server);
const revisedProgram=ts.createProgram(allPaths,opts);
let total=0;
for(const g of groups){
 const sf=revisedProgram.getSourceFile(g.path);
 const ds=ts.getPreEmitDiagnostics(revisedProgram,sf);
 console.log('ITEM09_MODULE_TYPE_DIAGNOSTICS',g.id,ds.length);
 for(const d of ds.slice(0,16)){
  const where=d.file?.getLineAndCharacterOfPosition(d.start||0);
  console.log('ITEM09_DIAG',g.id,d.code,where?where.line+1:0,ts.flattenDiagnosticMessageText(d.messageText,' '));
 }
 total+=ds.length;
}
if(total>0)process.exitCode=1;
