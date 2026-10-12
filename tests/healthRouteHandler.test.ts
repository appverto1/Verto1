import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import express from 'express';
import {createHealthRouteHandler} from '../services/healthRouteHandler';
const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
assert.equal(source.split("app.get('/api/health'").length-1,1);
assert.ok(source.includes("app.get('/api/health', createHealthRouteHandler({ deploymentReleaseId, cleanObject }))"));
assert.ok(source.indexOf("app.get('/api/config'")<source.indexOf("app.get('/api/health'"));
assert.ok(source.indexOf("app.get('/api/health'")<source.indexOf("app.get('/api/ready'"));
let calls=0;
const app=express();
app.get('/api/health',createHealthRouteHandler({
 deploymentReleaseId:()=>{calls++;return 'release-test';},
 cleanObject:(value:any)=>{assert.deepEqual(value,{status:'ok',release:'release-test'});return {...value,cleaned:true};}
}));
const server=app.listen(0,'127.0.0.1');
await once(server,'listening');
const address=server.address();
assert.ok(address&&typeof address!=='string');
try {
 for(let i=1;i<=2;i++){
 const response=await fetch('http://127.0.0.1:'+address.port+'/api/health');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{status:'ok',release:'release-test',cleaned:true});
 assert.equal(calls,i,'release must resolve once per request');
 }
} finally {server.close();server.closeAllConnections();}
console.log('healthRouteHandler.test.ts: PASS');
