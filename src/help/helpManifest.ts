export type HelpMediaClassification = 'public_synthetic' | 'authenticated_professional' | 'restricted_operational';
export type HelpPublicationStatus = 'draft' | 'published' | 'archived';
export type HelpMediaKind = 'screenshot' | 'poster' | 'video';
export type HelpMedia = { mediaId:string; status:HelpPublicationStatus; classification:HelpMediaClassification; objectKey:string; mimeType:'image/png'|'image/jpeg'|'image/webp'|'video/mp4'|'video/webm'; bytes:number; durationSeconds?:number; kind?:HelpMediaKind; width?:number; height?:number; container?:'mp4'|'webm'; codec?:'h264'|'avc1'|'vp8'|'vp9'|'av1' };
export type HelpArticle = { articleId:string; slug:string; status:HelpPublicationStatus; title:string; theme:string; summary:string; keywords:string[]; synonyms?:string[]; steps:string[]; audiences:string[]; requiredCapabilities:string[]; requiredModules?:string[]; mediaIds:string[] };
export const HELP_MEDIA_BUCKET='help-center-media-private';
export const HELP_MEDIA: readonly HelpMedia[]=[];
export const HELP_ARTICLES: readonly HelpArticle[]=[
 {articleId:'billing-start-v1',slug:'faturamento/comece-aqui',status:'published',title:'Comece no faturamento da clínica',theme:'Convênios e faturamento',summary:'Localize as áreas principais do faturamento sem sair do contexto da clínica ativa.',keywords:['tiss','faturamento','guia','xml','convenio'],synonyms:['convenio','convenios','faturista'],steps:['Confirme a clínica ativa no topo da tela.','Escolha a tarefa de faturamento no menu lateral.','Antes de alterar dados, confira o contexto e o convênio selecionados.'],audiences:['biller','coordinator','director'],requiredCapabilities:[],requiredModules:['insurance_tiss'],mediaIds:[]}
];
export function projectHelpArticles(articles:readonly HelpArticle[],media:readonly HelpMedia[],audience:string,capabilities:readonly string[],modules:readonly string[]=[]){
 const allowed=new Set(capabilities); const enabledModules=new Set(modules);
 return articles.filter(a=>a.status==='published'&&a.audiences.includes(audience)&&a.requiredCapabilities.every(c=>allowed.has(c))&&(a.requiredModules||[]).every(m=>enabledModules.has(m))).map(a=>({...a,mediaIds:a.mediaIds.filter(id=>media.some(m=>m.mediaId===id&&m.status==='published'))}));
}
export function publishedHelpProjection(audience:string,capabilities:readonly string[],modules:readonly string[]=[]){
 return projectHelpArticles(HELP_ARTICLES,HELP_MEDIA,audience,capabilities,modules);
}
export function resolveHelpMedia(mediaId:string){
 if(!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(mediaId)) return null;
 const media=HELP_MEDIA.find(m=>m.mediaId===mediaId&&m.status==='published');
 return media||null;
}
const validDimensions=(width:number,height:number)=>Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&width<=1920&&height<=1920&&width*height<=1920*1080;
export function validateHelpMediaPublication(input:{filename:string;declaredMime:string;magicMime:string;bytes:number;kind:HelpMediaKind;width:number;height:number;durationSeconds?:number;container?:string;codec?:string}){
 const allowed=new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm']);
 const ext=String(input.filename||'').toLowerCase().split('.').pop()||'';
 const declared=String(input.declaredMime||'').toLowerCase(); const magic=String(input.magicMime||'').toLowerCase();
 const extMime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};
 if(ext==='svg'||declared==='image/svg+xml'||magic==='image/svg+xml') return false;
 if(!allowed.has(declared)||declared!==magic||extMime[ext]!==declared) return false;
 if(!Number.isFinite(input.bytes)||input.bytes<=0||!validDimensions(Number(input.width),Number(input.height))) return false;
 if(input.kind==='screenshot'||input.kind==='poster') {
  if(!declared.startsWith('image/')) return false;
  const limit=input.kind==='poster'?200*1024:400*1024;
  return input.bytes<=limit;
 }
 if(input.kind!=='video'||!declared.startsWith('video/')) return false;
 if(input.bytes>3*1024*1024||!Number.isFinite(input.durationSeconds)||Number(input.durationSeconds)>25||Number(input.durationSeconds)<=0) return false;
 const container=String(input.container||'').toLowerCase(); const codec=String(input.codec||'').toLowerCase();
 if(declared==='video/mp4') return container==='mp4'&&['h264','avc1'].includes(codec);
 return container==='webm'&&['vp8','vp9','av1'].includes(codec);
}
