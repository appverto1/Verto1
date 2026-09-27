export type HelpMediaClassification = 'public_synthetic' | 'authenticated_professional' | 'restricted_operational';
export type HelpPublicationStatus = 'draft' | 'published' | 'archived';
export type HelpMedia = { mediaId:string; status:HelpPublicationStatus; classification:HelpMediaClassification; objectKey:string; mimeType:'image/png'|'image/jpeg'|'image/webp'|'video/mp4'|'video/webm'; bytes:number; durationSeconds?:number };
export type HelpArticle = { articleId:string; slug:string; status:HelpPublicationStatus; title:string; theme:string; summary:string; keywords:string[]; steps:string[]; audiences:string[]; requiredCapabilities:string[]; mediaIds:string[] };
export const HELP_MEDIA_BUCKET='help-center-media-private';
export const HELP_MEDIA: readonly HelpMedia[]=[];
export const HELP_ARTICLES: readonly HelpArticle[]=[
 {articleId:'billing-start-v1',slug:'faturamento/comece-aqui',status:'published',title:'Comece no faturamento da clínica',theme:'Convênios e faturamento',summary:'Localize as áreas principais do faturamento sem sair do contexto da clínica ativa.',keywords:['tiss','faturamento','guia','xml','convenio'],steps:['Confirme a clínica ativa no topo da tela.','Escolha a tarefa de faturamento no menu lateral.','Antes de alterar dados, confira o contexto e o convênio selecionados.'],audiences:['biller','coordinator','director'],requiredCapabilities:[],mediaIds:[]}
];
export function publishedHelpProjection(audience:string,capabilities:readonly string[]){
 const allowed=new Set(capabilities);
 return HELP_ARTICLES.filter(a=>a.status==='published'&&a.audiences.includes(audience)&&a.requiredCapabilities.every(c=>allowed.has(c))).map(a=>({...a,mediaIds:a.mediaIds.filter(id=>HELP_MEDIA.some(m=>m.mediaId===id&&m.status==='published'))}));
}
export function resolveHelpMedia(mediaId:string){
 if(!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(mediaId)) return null;
 const media=HELP_MEDIA.find(m=>m.mediaId===mediaId&&m.status==='published');
 return media||null;
}
