// Extract only /api/ready from the exact baseline server.ts. All guards fail closed.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const baseBlob='b5460aa69d3cee3ff6ec96849f61537974007997';
const current=execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim();
if(current!==baseBlob)throw new Error('SERVER_BLOB_DRIFT '+current);
for(const path of ['services/readyRouteHandler.ts'])if(existsSync(path))throw new Error('NOT_IDEMPOTENT: '+path);
const original=readFileSync('server.ts','utf8');
if(original.split('\n').length!==102066)throw new Error('UNEXPECTED_LINE_COUNT');
const ast=ts.createSourceFile('server.ts',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),matches=[];
function visit(node) {
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
    &&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='app'
    &&node.expression.name.text==='get'&&node.arguments.length===2
    &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='/api/ready')matches.push(node);
  ts.forEachChild(node,visit);
}
visit(ast);
if(matches.length!==1)throw new Error('READINESS_ROUTE_COUNT '+matches.length);
const call=matches[0],handler=call.arguments[1];
if(!ts.isArrowFunction(handler)||!ts.isBlock(handler.body)||handler.parameters.length!==2
  ||handler.parameters[0].name.getText(ast)!=='_req'||handler.parameters[1].name.getText(ast)!=='res'
  ||!handler.modifiers?.some(x=>x.kind===ts.SyntaxKind.AsyncKeyword))
  throw new Error('READINESS_HANDLER_UNEXPECTED_SHAPE');
const originalCall=original.slice(call.getStart(ast),call.end);
const originalHandler=original.slice(handler.getStart(ast),handler.end);
if(originalCall.split('\n').length!==49||!originalHandler.startsWith('async (_req, res) => {'))
  throw new Error('READINESS_HANDLER_CHANGED');
const expected=[
'const release = deploymentReleaseId();','ensureOtpTableAvailability(true)',
'checkDistributedRuntimeState(supabase)','ready ? 200 : 503',
'...(isProd ? {} : { checks })'
];
for(const key of expected)if(!originalHandler.includes(key))throw new Error('MISSING_GUARD '+key);
const names=[
'deploymentReleaseId','supabase','ensureOtpTableAvailability','sessionPool',
'requiresDistributedRuntimeState','checkDistributedRuntimeState','isProd','cleanObject'
];
const callText="app.get('/api/ready', createReadyRouteHandler(() => ({\n"+
  names.map(n=>'    '+n+',').join('\n')+"\n  })))";
const imported="import { createReadyRouteHandler } from './services/readyRouteHandler';\n";
if(original.includes(imported))throw new Error('ALREADY_EXTRACTED');
const withoutHandler=original.slice(0,call.getStart(ast))+callText+original.slice(call.end);
const updated=imported+withoutHandler;
if(updated.slice(imported.length).replace(callText,originalCall)!==original)
  throw new Error('BYTE_ROUNDTRIP_FAILED');
const statements=original.slice(handler.body.getStart(ast)+1,handler.body.end-1);
const moved=[
'// Exact original statement block of GET /api/ready; lazy dependencies preserve request-time values.',
'export function createReadyRouteHandler(getDeps: () => any) {',
'  return async (_req: any, res: any) => {',
'    const { '+names.join(', ')+' } = getDeps();',
statements,
'  };',
'}',
''
].join('\n');
for(const key of expected)if(!moved.includes(key))throw new Error('MOVED_BODY_INCOMPLETE '+key);
if(!updated.includes("app.get('/api/ready'")||!updated.includes("app.get('/api/health'"))
  throw new Error('REQUIRED_ENDPOINT_MISSING');
writeFileSync('server.ts',updated);
writeFileSync('services/readyRouteHandler.ts',moved);
appendFileSync('docs/backend-modularization/20261011-server-entrypoint-slice.md',
  '\n## Applied extraction\n- Original readiness route: 49 lines, at ~28647 in baseline. All original statement text preserved, with new lazy dependency accessor.\n- Exact baseline Git SHA verified, unique AST route verified, replacement reversed byte-for-byte in memory before writing.\n- Source wrote only server.ts and services/readyRouteHandler.ts; tests were committed to the feature branch before running.\n- Need Node 20 focused tests, build, staging CI and no deployment before accepting.\n');
console.log('[server-direct] '+JSON.stringify({originalLines:original.split('\n').length,
newLines:updated.split('\n').length,
removedLines:original.split('\n').length-updated.split('\n').length,
sourceBlob:current,route:'/api/ready',handlersMoved:1}));
