import ts from 'typescript';
import fs from 'node:fs';
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,'.');
const opts={...parsed.options,skipLibCheck:true,noEmit:true};
const groups=[
 {id:'bootstrap',path:'services/paidDirectorSessionBootstrap.ts',factory:'createPaidDirectorSessionBootstrap'},
 {id:'reconciliation',path:'services/publicSalesPostPaymentReconciliationRoute.ts',factory:'registerPublicSalesPostPaymentReconciliationRoute'},
 {id:'contract',path:'services/salesDirectorContractAccess.ts',factory:'createSalesDirectorContractAccess'},
 {id:'provisioning',path:'services/salesPaidDirectorAccountProvisioning.ts',factory:'createSalesPaidDirectorAccountProvisioning'}
];
let server=fs.readFileSync('server.ts','utf8');
const original=ts.createProgram(groups.map(g=>g.path),opts);
for(const g of groups){
 const source=original.getSourceFile(g.path);
 if(!source)throw Error('Missing '+g.path);
 const diagnostics=ts.getPreEmitDiagnostics(original,source);
 const missing=new Set();
 for(const d of diagnostics){
   if([2304,2503,2552,18004].includes(d.code)){
     const msg=ts.flattenDiagnosticMessageText(d.messageText,' ');
     const m=msg.match(/(?:name|namespace|property) '([^']+)'/);
     if(m)missing.add(m[1]);
   }
 }
 missing.delete('Stripe');
 const names=[...missing].sort();
 let code=fs.readFileSync(g.path,'utf8');
 const marker='  // ITEM10_'+g.id+'_DEPS';
 if(!code.includes(marker))throw Error('Missing service marker '+marker);
 code=code.replace(marker,'  const { '+names.join(', ')+' } = deps;');
 fs.writeFileSync(g.path,code);
 const injection='// ITEM10_'+g.id+'_INJECT';
 if(!server.includes(injection))throw Error('Missing server marker '+injection);
 const position=server.indexOf(g.factory+'({');
 let late=[];
 const items=names.map(name=>{
   const re=new RegExp('(^|\\n)\\s*(?:(?:export )?(?:const|let|var|(?:async )?function))\\s+'+name+'\\b','g');
   const found=re.exec(server);
   if(found && found.index>position){
     late.push({name,declaredAt:found.index,factoryAt:position});
     const tail=server.slice(found.index,found.index+280);
     if(!new RegExp('\\b'+name+'\\s*(?:=\\s*(?:async\\s*)?\\(|=\\s*async\\b|\\()').test(tail))
       throw Error('Late non-function '+g.id+'/'+name+' (manual check required)');
     return '    '+name+': (...args: any[]) => ('+name+' as any)(...args),';
   }
   return '    '+name+',';
 });
 console.log('ITEM10_DEPS',g.id,JSON.stringify(names),'LATE',JSON.stringify(late));
 server=server.replace('    '+injection,items.join('\n'));
}
fs.writeFileSync('server.ts',server);
const current=ts.createProgram(groups.map(g=>g.path),opts);
let failed=0;
for(const g of groups){
 const sf=current.getSourceFile(g.path);
 const ds=ts.getPreEmitDiagnostics(current,sf);
 console.log('ITEM10_TYPE_DIAGNOSTICS',g.id,ds.length);
 for(const d of ds.slice(0,30)){
   const where=d.file?.getLineAndCharacterOfPosition(d.start??0);
   console.log('ITEM10_TYPE',g.id,'code',d.code,'line',where?where.line+1:0,ts.flattenDiagnosticMessageText(d.messageText,' '));
 }
 failed+=ds.length;
}
if(failed>0)process.exitCode=1;
