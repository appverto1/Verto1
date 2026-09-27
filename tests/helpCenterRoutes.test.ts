import assert from 'node:assert/strict';
import { registerHelpCenterRoutes } from '../services/helpCenterRoutes';

type Handler=(req:any,res:any,next?:()=>Promise<void>|void)=>any;
const routes=new Map<string,Handler[]>();
const app:any={get:(path:string,...handlers:Handler[])=>routes.set(path,handlers)};
const pass:Handler=(_req,_res,next)=>next?.();
const checkAuth:Handler=(req,res,next)=>req.session?.user?next?.():res.status(401).json({error:'AUTH_REQUIRED'});
const requireClinicCapability=(_cap:string):Handler=>(req,res,next)=>req.authorizationContext?.capabilities?.has('clinic.view')?next?.():res.status(403).json({error:'FORBIDDEN'});
const media={mediaId:'restricted-video-v1',status:'published' as const,classification:'restricted_operational' as const,kind:'video' as const,objectKey:'v1/restricted-video.mp4',mimeType:'video/mp4' as const,bytes:1024,width:1280,height:720,durationSeconds:8,codec:'h264' as const};
const article={articleId:'restricted-v1',slug:'ops/restricted',status:'published' as const,title:'Operação restrita',theme:'Operação',summary:'Restrito',keywords:[],steps:['Faça com autorização.'],audiences:['biller'],requiredCapabilities:['help.restricted.view'],requiredModules:[],mediaIds:[media.mediaId]};
let signed=0;
registerHelpCenterRoutes(app,{
 supabase:{storage:{from:()=>({createSignedUrl:async()=>{signed++;return {data:{signedUrl:'https://signed.invalid/object'},error:null};}})}},
 noStoreDynamicResponse:pass,checkAuth,requireClinicCapability,
 currentClinicId:(user:any)=>user?.clinicId==='clinic-a'?'clinic-a':null,
 projectArticles:(audience:string,capabilities:readonly string[])=>audience==='biller'&&capabilities.includes('help.restricted.view')?[article]:[],
 resolveMedia:(id:string)=>id===media.mediaId?media:null
} as any);
const invoke=async(path:string,req:any)=>{
 let status=200,body:any,headers:any={}; const res:any={status:(v:number)=>{status=v;return res;},json:(v:any)=>{body=v;return res;},setHeader:(k:string,v:string)=>{headers[k]=v;},end:()=>res};
 const stack=routes.get(path)!; let index=-1; const next=async()=>{index++; if(index<stack.length)await stack[index](req,res,next);}; await next(); return {status,body,headers};
};
const baseReq={params:{mediaId:media.mediaId},headers:{},session:{user:{role:'biller',clinicId:'clinic-a'}},authorizationContext:{role:'biller',capabilities:new Set(['clinic.view','help.restricted.view']),modules:new Set()}};
assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,session:{}})).status,401,'no session denied');
assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,session:{user:{role:'biller',clinicId:'clinic-b'}}})).status,403,'cross-clinic context denied');
assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,authorizationContext:{role:'biller',capabilities:new Set(['clinic.view']),modules:new Set()}})).status,404,'restricted media hidden without article capability');
const allowed=await invoke('/api/help/media/:mediaId',baseReq);
assert.equal(allowed.status,200); assert.equal(allowed.body.supportsRange,true); assert.equal(allowed.headers['Cache-Control'],'private, no-store'); assert.equal(signed,1);
const ranged=await invoke('/api/help/media/:mediaId',{...baseReq,headers:{range:'bytes=0-511'}});
assert.equal(ranged.status,307,'Range request redirects preserving GET/Range semantics'); assert.equal(ranged.headers.Location,'https://signed.invalid/object');
assert.equal((await invoke('/api/help/media/:mediaId',{...baseReq,params:{mediaId:'../secret'}})).status,404,'arbitrary path denied');
console.log('helpCenterRoutes.test: PASS');
