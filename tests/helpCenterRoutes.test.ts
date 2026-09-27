import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerHelpCenterRoutes } from '../services/helpCenterRoutes';

type Handler=(req:any,res:any,next?:()=>Promise<void>|void)=>any;
const routes=new Map<string,Handler[]>();
const app:any={get:(path:string,...handlers:Handler[])=>routes.set(path,handlers)};
const pass:Handler=(_req,_res,next)=>next?.();
const checkAuth:Handler=(req,res,next)=>req.session?.user?next?.():res.status(401).json({error:'AUTH_REQUIRED'});
const requireClinicCapability=(_cap:string):Handler=>(req,res,next)=>req.authorizationContext?.capabilities?.has('clinic.view')?next?.():res.status(403).json({error:'FORBIDDEN'});
const media={mediaId:'restricted-video-v1',status:'published' as const,classification:'restricted_operational' as const,objectKey:'v1/restricted-video.mp4',mimeType:'video/mp4' as const,bytes:1024,durationSeconds:8};
const article={articleId:'restricted-v1',slug:'ops/restricted',status:'published' as const,title:'Operação restrita',theme:'Operação',summary:'Restrito',keywords:[],steps:['Faça com autorização.'],audiences:['biller'],requiredCapabilities:['help.restricted.view'],requiredModules:[],mediaIds:[media.mediaId]};
let signed=0; let signedUrl='https://signed.invalid/object';
registerHelpCenterRoutes(app,{
 supabase:{storage:{from:()=>({createSignedUrl:async()=>{signed++;return {data:{signedUrl},error:null};}})}},
 noStoreDynamicResponse:pass,checkAuth,requireClinicCapability,
 currentClinicId:(user:any)=>user?.clinicId==='clinic-a'?'clinic-a':null,
 projectArticles:(audience:string,capabilities:readonly string[])=>audience==='biller'&&capabilities.includes('help.restricted.view')?[article]:[],
 resolveMedia:(id:string)=>id===media.mediaId?media:null
} as any);
const invoke=async(path:string,req:any)=>{
 let status=200,body:any,headers:any={}; const res:any={status:(v:number)=>{status=v;return res;},json:(v:any)=>{body=v;return res;},setHeader:(k:string,v:string)=>{headers[k]=v;}};
 const stack=routes.get(path)!; let index=-1; const next=async()=>{index++; if(index<stack.length)await stack[index](req,res,next);}; await next(); return {status,body,headers};
};
const baseUser={role:'biller',clinicId:'clinic-a',activeAccessContext:{clinicId:'clinic-a',clinicName:'Clínica A'}};
const baseReq={params:{mediaId:media.mediaId},session:{user:baseUser},authorizationContext:{role:'biller',capabilities:new Set(['clinic.view','help.restricted.view']),modules:new Set()}};

async function main(){
 assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,session:{}})).status,401,'no session denied');
 assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,session:{user:{role:'biller',clinicId:'clinic-b'}}})).status,403,'cross-clinic context denied');
 assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,authorizationContext:{role:'biller',capabilities:new Set(['clinic.view']),modules:new Set()}})).status,404,'restricted media hidden without article capability');
 const catalog=await invoke('/api/help/catalog',baseReq);
 assert.equal(catalog.status,200); assert.equal(catalog.body.clinicId,'clinic-a'); assert.equal(catalog.body.clinicName,'Clínica A','catalog returns authoritative active clinic name');
 const rangeServer=createServer((req,res)=>{
  if(req.headers.range==='bytes=0-0') { res.writeHead(206,{'Accept-Ranges':'bytes','Content-Range':'bytes 0-0/4','Content-Length':'1','Content-Type':'video/mp4'});res.end(Buffer.from([0]));return; }
  res.writeHead(200,{'Accept-Ranges':'bytes','Content-Length':'4','Content-Type':'video/mp4'});res.end(Buffer.from([0,1,2,3]));
 });
 await new Promise<void>((resolve,reject)=>{rangeServer.once('error',reject);rangeServer.listen(0,'127.0.0.1',()=>resolve());});
 try {
  const address=rangeServer.address(); assert.ok(address&&typeof address==='object'); signedUrl=`http://127.0.0.1:${address.port}/video`;
  const allowed=await invoke('/api/help/media/:mediaId',baseReq);
  assert.equal(allowed.status,200); assert.equal(allowed.body.supportsRange,true); assert.equal(allowed.headers['Cache-Control'],'private, no-store'); assert.equal(signed,1);
  const ranged=await fetch(allowed.body.url,{headers:{Range:'bytes=0-0'}});
  assert.equal(ranged.status,206,'signed video URL must honor HTTP Range');
  assert.equal(ranged.headers.get('content-range'),'bytes 0-0/4','signed video URL returns a concrete byte range');
  assert.equal((await ranged.arrayBuffer()).byteLength,1,'range response returns only requested byte');
 } finally { await new Promise<void>((resolve,reject)=>rangeServer.close(error=>error?reject(error):resolve())); }
 assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,params:{mediaId:'../secret'}})).status,404,'arbitrary path denied');
 console.log('helpCenterRoutes.test: PASS');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
