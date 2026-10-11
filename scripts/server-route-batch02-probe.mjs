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
