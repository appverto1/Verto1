import fs from 'node:fs';
import ts from 'typescript';
const s=fs.readFileSync('server.ts','utf8'),sf=ts.createSourceFile('server.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),routes=[];
function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(sf)==='app'
&&['get','post','patch','put','delete'].includes(n.expression.name.text)&&ts.isStringLiteral(n.arguments[0])){
const a=n.arguments[0].text;
routes.push({path:a,method:n.expression.name.text,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,
lines:s.slice(n.getStart(sf),n.end).split('\n').length,argCount:n.arguments.length,
handler:n.arguments[n.arguments.length-1]?.kind?ts.SyntaxKind[n.arguments[n.arguments.length-1].kind]:''});
}ts.forEachChild(n,visit)}visit(sf);
const start=routes.filter(r=>r.line>=28500&&r.line<=34500);
console.log('[batch02-inventory] '+JSON.stringify({total:routes.length,window:start}));
const targetPaths=[
'/api/config','/api/health/details','/api/auth/config','/api/onboarding/context','/api/workspaces',
'/api/access-contexts/select','/api/workspaces/select','/api/clinic/authorization/me',
'/api/user/feature-access','/api/user/feature-access/:featureKey',
'/api/clinic/authorization/capabilities/:permissionKey/members',
'/api/clinic/members/:memberId/authorization','/api/clinic/members',
'/api/clinic/members/:memberId/work-schedule'
];
for(const r of start.filter(x=>targetPaths.includes(x.path))){
 const full=routes.find(x=>x===r);
 const nlist=[];function find(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(sf)==='app'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===r.path&&n.expression.name.text===r.method)nlist.push(n);ts.forEachChild(n,find)}find(sf);
 if(nlist.length!==1)continue;
 const body=s.slice(nlist[0].getStart(sf),nlist[0].end);
 console.log('[batch02-route] '+JSON.stringify({path:r.path,method:r.method,line:r.line,lines:r.lines,chars:body.length,body:body.slice(0,17000)}));
}


const keys=[
['get','/api/clinic/authorization/me'],
['get','/api/user/feature-access'],
['post','/api/user/feature-access/:featureKey'],
['get','/api/clinic/authorization/capabilities/:permissionKey/members'],
['patch','/api/clinic/authorization/capabilities/:permissionKey/members'],
['get','/api/clinic/members/:memberId/authorization'],
['patch','/api/clinic/members/:memberId/authorization'],
['get','/api/clinic/members'],
['patch','/api/clinic/members/:memberId/supervision-eligibility'],
['get','/api/clinic/members/:memberId/work-schedule'],
['patch','/api/clinic/members/:memberId/work-schedule'],
['post','/api/clinic/members/:memberId/work-schedule/apply']
];
const matches=[];function visitRoute(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(sf)==='app'&&ts.isStringLiteral(n.arguments[0])&&keys.some(([m,p])=>m===n.expression.name.text&&p===n.arguments[0].text))matches.push(n);ts.forEachChild(n,visitRoute)}visitRoute(sf);
const runtimeGlobals=new Set(['undefined','NaN','Infinity','Array','Object','Map','Set','Date','String','Number','Boolean','Promise','Math','JSON','Error','RegExp','Buffer','console','process','URL','URLSearchParams','parseInt','parseFloat','isNaN','decodeURIComponent','encodeURIComponent','BigInt','Intl']);
const binding=(n,out)=>{if(ts.isIdentifier(n))out.add(n.text);else if(ts.isObjectBindingPattern(n)||ts.isArrayBindingPattern(n)){for(const e of n.elements){if(ts.isBindingElement(e))binding(e.name,out)}}};
const declare=(n,out)=>{if(ts.isVariableDeclaration(n))binding(n.name,out);if(ts.isParameter(n))binding(n.name,out);if(ts.isCatchClause(n)&&n.variableDeclaration)binding(n.variableDeclaration.name,out);if(ts.isFunctionDeclaration(n)&&n.name)out.add(n.name.text);ts.forEachChild(n,c=>declare(c,out))};
const identRef=n=>{
 const p=n.parent;
 if(!p)return false;
 if(ts.isPropertyAccessExpression(p)&&p.name===n)return false;
 if(ts.isPropertyAssignment(p)&&p.name===n)return false;
 if(ts.isMethodDeclaration(p)&&p.name===n)return false;
 if(ts.isVariableDeclaration(p)&&p.name===n)return false;
 if(ts.isParameter(p)&&p.name===n)return false;
 if(ts.isFunctionDeclaration(p)&&p.name===n)return false;
 if(ts.isBindingElement(p)&&p.name===n)return false;
 if(ts.isImportSpecifier(p)||ts.isExportSpecifier(p)||ts.isTypeReferenceNode(p)||ts.isQualifiedName(p))return false;
 if(ts.isTypeQueryNode(p))return false;
 return true;
};
for(const [method,path] of keys){
 const n=matches.find(n=>n.expression.name.text===method&&n.arguments[0].text===path);
 if(!n)throw Error('TARGET_MISSING '+method+' '+path);
 const handler=n.arguments[n.arguments.length-1];if(!ts.isArrowFunction(handler)||!ts.isBlock(handler.body))throw Error('NOT_ARROW '+method+' '+path);
 const locals=new Set(),refs=new Set(),types=new Set();
 declare(handler,locals);
 function walk(n){
 if(ts.isTypeReferenceNode(n))types.add(n.typeName.getText(sf));
 if(ts.isIdentifier(n)&&identRef(n))refs.add(n.text);
 ts.forEachChild(n,walk);
 }
 walk(handler.body);
 for(const param of handler.parameters)binding(param.name,locals);
 const free=[...refs].filter(x=>!locals.has(x)&&!runtimeGlobals.has(x)).sort();
 console.log('[batch02-deps] '+JSON.stringify({method,path,handlerLines:s.slice(handler.getStart(sf),handler.end).split('\n').length,free,types:[...types],locals:[...locals].slice(0,25)}));
}
