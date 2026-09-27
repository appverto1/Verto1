export type HelpMediaClassification = 'public_synthetic' | 'authenticated_professional' | 'restricted_operational';
export type HelpPublicationStatus = 'draft' | 'published' | 'archived';
export type HelpMedia = { mediaId:string; status:HelpPublicationStatus; classification:HelpMediaClassification; objectKey:string; mimeType:'image/png'|'image/jpeg'|'image/webp'|'video/mp4'|'video/webm'; bytes:number; durationSeconds?:number };
export type HelpArticle = { articleId:string; slug:string; status:HelpPublicationStatus; title:string; theme:string; summary:string; keywords:string[]; synonyms?:string[]; steps:string[]; audiences:string[]; requiredCapabilities:string[]; requiredModules?:string[]; mediaIds:string[] };
export const HELP_MEDIA_BUCKET='help-center-media-private';
export const HELP_MEDIA: readonly HelpMedia[]=[];
export const HELP_ARTICLES: readonly HelpArticle[]=[
 {articleId:'billing-start-v1',slug:'faturamento/comece-aqui',status:'published',title:'Comece no faturamento da clínica',theme:'Convênios e faturamento',summary:'Localize as áreas principais do faturamento sem sair do contexto da clínica ativa.',keywords:['tiss','faturamento','guia','xml','convenio'],synonyms:['convenio','convenios','faturista'],steps:['Confirme a clínica ativa no topo da tela.','Escolha a tarefa de faturamento no menu lateral.','Antes de alterar dados, confira o contexto e o convênio selecionados.'],audiences:['biller','coordinator','director'],requiredCapabilities:[],requiredModules:[],mediaIds:[]}
];
export function publishedHelpProjection(audience:string,capabilities:readonly string[],modules:readonly string[]=[]){
 const allowed=new Set(capabilities); const enabledModules=new Set(modules);
 return HELP_ARTICLES.filter(a=>a.status==='published'&&a.audiences.includes(audience)&&a.requiredCapabilities.every(c=>allowed.has(c))&&(a.requiredModules||[]).every(m=>enabledModules.has(m))).map(a=>({...a,mediaIds:a.mediaIds.filter(id=>HELP_MEDIA.some(m=>m.mediaId===id&&m.status==='published'))}));
}
export function resolveHelpMedia(mediaId:string){
 if(!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(mediaId)) return null;
 const media=HELP_MEDIA.find(m=>m.mediaId===mediaId&&m.status==='published');
 return media||null;
}
export function validateHelpMediaPublication(input:{filename:string;declaredMime:string;magicMime:string;bytes:number;durationSeconds?:number}){
 const allowed=new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm']);
 const ext=String(input.filename||'').toLowerCase().split('.').pop()||'';
 const extMime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};
 if(ext==='svg'||input.declaredMime==='image/svg+xml'||input.magicMime==='image/svg+xml') return false;
 if(!allowed.has(input.declaredMime)||input.declaredMime!==input.magicMime||extMime[ext]!==input.declaredMime) return false;
 if(!Number.isFinite(input.bytes)||input.bytes<=0||input.bytes>3145728) return false;
 if(input.declaredMime.startsWith('video/')&&(!Number.isFinite(input.durationSeconds)||Number(input.durationSeconds)>25||Number(input.durationSeconds)<=0)) return false;
 return true;
}
