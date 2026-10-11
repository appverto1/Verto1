import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('server.ts','utf8');
const file=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
if(source.length<4_000_000||source.length>5_300_000)throw new Error('server.ts out of expected length');
const position=node=>file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
const routes=[];
function walk(n){
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)
    &&ts.isIdentifier(n.expression.expression)&&n.expression.expression.text==='app'
    &&['get','post','patch','delete','put'].includes(n.expression.name.text)
    &&n.arguments.length>0&&ts.isStringLiteral(n.arguments[0])){
      const path=n.arguments[0].text;const lines=source.slice(n.getStart(file),n.end).split('\n').length;
      if(path.startsWith('/api/'))routes.push({method:n.expression.name.text,path,line:position(n),lines,arguments:n.arguments.length,
        hasMiddleware:n.arguments.length>2});
  }
  ts.forEachChild(n,walk);
}
walk(file);
const targets=routes.filter(x=>['/api/ready','/api/health'].includes(x.path));
const funcs=[];
for(const stmt of file.statements){
  if(ts.isFunctionDeclaration(stmt)&&stmt.name){
    const lines=source.slice(stmt.getStart(file),stmt.end).split('\n').length;
    if(lines>=8&&lines<=60)funcs.push({name:stmt.name.text,line:position(stmt),lines,exported:stmt.modifiers?.some(x=>x.kind===ts.SyntaxKind.ExportKeyword)||false});
  }
}
console.log('[server-probe] '+JSON.stringify({bytes:source.length,lines:source.split('\n').length,
  first50Routes:routes.slice(0,50),healthReady:targets,smallTopLevelFunctions:funcs.slice(0,70),
  totalRoutes:routes.length,totalSmallTopLevelFunctions:funcs.length}));
for(const target of targets){
  const start=source.split('\n').slice(target.line-1,target.line-1+Math.min(target.lines,150)).join('\n');
  if(start.length>9000)console.log('[server-probe-target] '+JSON.stringify({path:target.path,line:target.line,lines:target.lines,sourceStart:start.slice(0,8000)+' ...truncated'}));
  else console.log('[server-probe-target] '+JSON.stringify({path:target.path,line:target.line,lines:target.lines,source:start}));
}
