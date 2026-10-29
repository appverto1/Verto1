export type HelpMediaClassification = 'public_synthetic' | 'authenticated_professional' | 'restricted_operational';
export type HelpPublicationStatus = 'draft' | 'published' | 'archived';
export type HelpMediaKind = 'screenshot' | 'poster' | 'video';
export type HelpRouteKey = 'billing_workspace';
export type HelpTutorialStep = { label:string; instruction:string; mediaId:string; rect:[number,number,number,number] };
export type HelpMedia = { mediaId:string; status:HelpPublicationStatus; classification:HelpMediaClassification; kind:HelpMediaKind; objectKey:string; mimeType:'image/png'|'image/jpeg'|'image/webp'|'video/mp4'|'video/webm'; bytes:number; width:number; height:number; durationSeconds?:number; codec?:'h264'|'vp8'|'vp9'|'av1'; container?:'mp4'|'webm' };
export type HelpArticle = { articleId:string; slug:string; status:HelpPublicationStatus; title:string; theme:string; summary:string; keywords:string[]; synonyms?:string[]; steps:string[]; audiences:string[]; audienceLabel?:string; requiredCapabilities:string[]; requiredModules?:string[]; prerequisites?:string[]; expectedResult?:string; recovery?:string[]; relatedArticleIds?:string[]; routeKey?:HelpRouteKey; mediaIds:string[]; contentRevision?:string; tutorialSteps?:HelpTutorialStep[] };
export const HELP_MEDIA_BUCKET='help-center-media-private';
export const HELP_MEDIA: readonly HelpMedia[]=[];
export const HELP_ARTICLES: readonly HelpArticle[]=[
 {
  articleId:'help-getting-started-v1',slug:'ajuda/primeiros-passos',status:'published',
  title:'Como usar a Ajuda e os tutoriais',theme:'Primeiros passos',
  summary:'Encontre instruções para seu papel e entenda como pesquisar os recursos da Verto.',
  keywords:['ajuda','tutorial','começar','papel','permissões','buscar'],
  steps:[
    'Abra Ajuda e tutoriais no menu disponível para o seu papel.',
    'Use a busca para localizar uma tarefa pelo nome, por exemplo agenda ou prontuário.',
    'Escolha um tema e siga as instruções exibidas para sua função.',
    'Se algum recurso não aparecer, peça à gestão para conferir seu vínculo e suas permissões; a Ajuda não modifica acessos.'
  ],
  audiences:['director','coordinator','therapist','supervisor','receptionist','biller'],
  requiredCapabilities:[],requiredModules:[],mediaIds:[]
 },
 {
  articleId:'billing-orientation-v1',slug:'faturamento/orientacao-inicial',status:'published',
  title:'Orientação inicial do faturista',theme:'Convênios e faturamento',
  summary:'Saiba por onde começar a conferir sessões e itens faturáveis sem alterar cobranças.',
  keywords:['faturista','faturamento','sessões','recebíveis','convênio'],
  steps:[
    'Confirme a clínica ativa antes de iniciar qualquer conferência.',
    'Abra a área de faturamento disponível na sua conta.',
    'Revise as sessões e pendências apresentadas pelo sistema conforme as permissões concedidas.',
    'Para corrigir uma cobrança ou executar um envio, siga o fluxo autorizado e confira o resultado antes de prosseguir.'
  ],
  audiences:['biller'],requiredCapabilities:['billing.sessions.view'],requiredModules:[],mediaIds:[]
 },
 {articleId:'billing-start-v1',slug:'faturamento/comece-aqui',status:'published',title:'Comece no faturamento da clínica',theme:'Convênios e faturamento',summary:'Localize as áreas principais do faturamento sem sair do contexto da clínica ativa.',keywords:['tiss','faturamento','guia','xml','convenio'],synonyms:['convenio','convenios','faturista'],steps:['Confirme a clínica ativa no topo da tela.','Escolha a tarefa de faturamento no menu lateral.','Antes de alterar dados, confira o contexto e o convênio selecionados.'],audiences:['biller','coordinator','director'],audienceLabel:'Faturamento, coordenação e direção autorizados',requiredCapabilities:['reports.billing.view'],requiredModules:['insurance_tiss'],prerequisites:['Módulo Convênios e TISS ativo na clínica.','Permissão para visualizar informações de faturamento.'],expectedResult:'Reconhecer a área de faturamento correta no contexto da clínica ativa e seguir para a tarefa desejada sem trocar de tenant.',recovery:['Se a área não aparecer, confirme a clínica ativa e suas permissões com a gestão.','Se o módulo não estiver disponível, volte à Verto e verifique se Convênios e TISS está ativo para a clínica.'],relatedArticleIds:[],routeKey:'billing_workspace',mediaIds:[]}
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
export function validateHelpMediaPublication(input:{kind:'screenshot'|'poster'|'video';filename:string;declaredMime:string;magicMime:string;bytes:number;width:number;height:number;durationSeconds?:number;codec?:string;container?:string}){
 const allowed=new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm']);
 const ext=String(input.filename||'').toLowerCase().split('.').pop()||'';
 const extMime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};
 if(ext==='svg'||input.declaredMime==='image/svg+xml'||input.magicMime==='image/svg+xml') return false;
 if(!allowed.has(input.declaredMime)||input.declaredMime!==input.magicMime||extMime[ext]!==input.declaredMime) return false;
 if(!Number.isFinite(input.bytes)||input.bytes<=0) return false;
 if(!Number.isFinite(input.width)||!Number.isFinite(input.height)||input.width<=0||input.height<=0||Math.max(input.width,input.height)>1920||input.width*input.height>2073600) return false;
 if(input.kind==='screenshot'&&(input.declaredMime.startsWith('video/')||input.bytes>409600)) return false;
 if(input.kind==='poster'&&(input.declaredMime.startsWith('video/')||input.bytes>204800)) return false;
 if(input.kind==='video'){
  if(!input.declaredMime.startsWith('video/')||input.bytes>3145728||!Number.isFinite(input.durationSeconds)||Number(input.durationSeconds)>25||Number(input.durationSeconds)<=0) return false;
  const codec=String(input.codec||'').trim().toLowerCase();
  const container=String(input.container||'').trim().toLowerCase();
  if(input.declaredMime==='video/mp4'&&(container!=='mp4'||codec!=='h264')) return false;
  if(input.declaredMime==='video/webm'&&(container!=='webm'||!['vp8','vp9','av1'].includes(codec))) return false;
 }
 return true;
}
