import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const s=readFileSync('server.ts','utf8'),handler=readFileSync('services/readyRouteHandler.ts','utf8');
const ast=ts.createSourceFile('server.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let ready=0,health=0;
function visit(n){
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)
    &&n.expression.expression.getText(ast)==='app'&&n.expression.name.text==='get'
    &&n.arguments[0]&&ts.isStringLiteral(n.arguments[0])){
    if(n.arguments[0].text==='/api/ready'){
      ready++;
      assert.equal(n.arguments.length,2);
      assert.match(n.arguments[1].getText(ast),/^createReadyRouteHandler\(/);
    }
    if(n.arguments[0].text==='/api/health')health++;
  }
  ts.forEachChild(n,visit);
}
visit(ast);
assert.equal(ready,1);assert.equal(health,1);
assert.match(s,/import \{ createReadyRouteHandler \} from '\.\/services\/readyRouteHandler';/);
for(const token of ['deploymentReleaseId()','ensureOtpTableAvailability(true)','checkDistributedRuntimeState(supabase)','ready ? 200 : 503'])
  assert.ok(handler.includes(token),'Missing retained contract: '+token);
assert.doesNotMatch(s,/const ready = checks\.supabase/);
console.log('serverReadyRouteExtraction.regression.test: PASS');
