import fs from 'node:fs';
import ts from 'typescript';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const oldBlob='a301111eac512996c2a019b728e080b9aa54b63a';
const source=fs.readFileSync('server.ts','utf8');
const actual=execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim();
if(actual!==oldBlob)throw Error('SOURCE_SHA_MISMATCH '+actual);
if(source.split('\n').length!==102028)throw Error('SOURCE_LINES_CHANGED');
const names=[
['get','/api/clinic/authorization/me','createClinicAuthorizationMeHandler','access','currentClinicId,getDefaultScopesForRole,resolveClinicCapabilityContext,sanitizeString,sendRouteDbError'],
['get','/api/user/feature-access','createUserFeatureAccessReadHandler','access','canAccessTrackedNewFeature,isKnownNewFeatureKey,isUuid,resolveClinicCapabilityContext,sanitizeString,sendRouteDbError,supabase'],
['post','/api/user/feature-access/:featureKey','createUserFeatureAccessWriteHandler','access','canAccessTrackedNewFeature,isKnownNewFeatureKey,isUuid,resolveClinicCapabilityContext,sanitizeString,sendRouteDbError,supabase'],
['get','/api/clinic/authorization/capabilities/:permissionKey/members','createClinicCapabilityMembersReadHandler','access','canDelegateClinicCapability,currentClinicId,isCapabilityKey,isClinicBaseRole,isDelegableCapability,isUuid,moduleAllowsCapability,resolveEffectiveClinicCapabilities,sanitizeEmail,sanitizeString,sendRouteDbError,supabase'],
['patch','/api/clinic/authorization/capabilities/:permissionKey/members','createClinicCapabilityMembersWriteHandler','access','canDelegateClinicCapability,currentClinicId,enforcePayloadLimit,isCapabilityKey,isClinicBaseRole,isDelegableCapability,isMissingRelationError,isUuid,moduleAllowsCapability,roleHasDefaultCapability,sanitizeString,sanitizeTextField,sendRouteDbError,supabase'],
['get','/api/clinic/members/:memberId/authorization','createClinicMemberAuthorizationReadHandler','access','CAPABILITY_CATALOG,canDelegateClinicCapability,canManageClinicRole,currentClinicId,getDefaultCapabilitiesForRole,getDefaultScopesForRole,isCapabilityKey,isClinicBaseRole,isUuid,moduleAllowsCapability,resolveEffectiveClinicCapabilities,sanitizeString,sendRouteDbError,supabase'],
['patch','/api/clinic/members/:memberId/authorization','createClinicMemberAuthorizationWriteHandler','access','canDelegateClinicCapability,currentClinicId,enforcePayloadLimit,isCapabilityKey,isClinicBaseRole,isDelegableCapability,isMissingRelationError,isUuid,moduleAllowsCapability,resolveEffectiveClinicCapabilities,sanitizeString,sanitizeTextField,sendRouteDbError,supabase'],
['get','/api/clinic/members','createClinicMembersReadHandler','access','asSafeNumber,buildDefaultProfessionalWorkingSchedule,buildProfessionalProfilePhotoViewUrl,currentClinicId,extractPatientPhotosStoragePath,formatClinicAccessRoleLabel,logRouteDbError,normalizeClinicalSpecialty,readProfessionalTitleFromSource,readProfessionalWorkingScheduleFromMetadata,resolveProfessionalProfileSpecialty,sanitizeProfessionalWorkingSchedule,sanitizeSessionUrl,sanitizeString,supabase'],
['patch','/api/clinic/members/:memberId/supervision-eligibility','createClinicSupervisionEligibilityWriteHandler','access','currentClinicId,enforcePayloadLimit,isUuid,sanitizeString,sendRouteDbError,supabase'],
['get','/api/clinic/members/:memberId/work-schedule','createClinicWorkScheduleReadHandler','schedule','currentClinicId,fetchProfessionalWorkingSchedule,logRouteDbError,sanitizeString,supabase'],
['patch','/api/clinic/members/:memberId/work-schedule','createClinicWorkScheduleWriteHandler','schedule','asSafeNumber,assertClinicMemberForWorkSchedule,assertNoOtherWorkspaceScheduleOverlap,currentClinicId,currentClinicTimeZone,enforcePayloadLimit,extractMissingColumnName,isMissingRelationError,logRouteDbError,sanitizeProfessionalWorkingSchedule,sanitizeString,supabase'],
['post','/api/clinic/members/:memberId/work-schedule/apply','createClinicWorkScheduleApplyHandler','schedule','asSafeNumber,assertClinicMemberForWorkSchedule,cleanObject,currentClinicId,currentClinicTimeZone,enforcePayloadLimit,isUuid,logRouteDbError,professionalSchedulesOverlap,sanitizeProfessionalWorkingSchedule,sanitizeString,supabase'],
].map(([method,path,factory,group,deps])=>({method,path,factory,group,deps:deps.split(',')}));
if(names.length!==12)throw Error('TARGET_COUNT');
const files={
access:'services/clinicAccessMembershipHandlers.ts',
schedule:'services/clinicWorkScheduleHandlers.ts',
};
if(Object.values(files).some(x=>fs.existsSync(x)))throw Error('ALREADY_DONE');
const ast=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const matches=[];
function visit(n){
 if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(ast)==='app'&&ts.isStringLiteral(n.arguments[0])){
 const row=names.find(t=>t.method===n.expression.name.text&&t.path===n.arguments[0].text);
 if(row)matches.push({n,row});
 }
 ts.forEachChild(n,visit);
}
visit(ast);
if(matches.length!==12||new Set(matches.map(x=>x.row.factory)).size!==12)throw Error('ROUTE_AST_COUNT_MISMATCH');
const type=ast.statements.find(x=>ts.isTypeAliasDeclaration(x)&&x.name.text==='ResolvedClinicCapabilityContext');
if(!type)throw Error('CONTEXT_TYPE_NOT_FOUND');
const typeStr=type.getText(ast);
if(!typeStr.includes('ReadonlySet<CapabilityKey>')||!typeStr.includes('organization')){} // no-op, exact AST body copied below
const baseImports=[
"import type {CapabilityKey, ClinicBaseRole} from '../src/constants/authorizationModel';",
"import type {CapabilityOverrideLike} from '../src/utils/authorizationRuntime';",
"import type {OrganizationModuleKey, OrganizationModuleAccessMode} from '../src/constants/organizationModules';",
];
const header={
access:[...baseImports,"import type {NewFeatureKey} from '../src/constants/featureMetadata';",typeStr,''].join('\n'),
schedule:[...baseImports,"import type {PortalProfessionalWorkingSchedule} from '../src/services/portalRescheduleAvailability';",typeStr,''].join('\n')
};
const modules={access:[],schedule:[]},patches=[],manifest=[];
for(const {n,row} of matches){
 const handler=n.arguments[n.arguments.length-1];
 if(!ts.isArrowFunction(handler)||!ts.isBlock(handler.body)||handler.parameters.length!==2
  ||handler.parameters[0].name.getText(ast)!=='req'
  ||handler.parameters[1].name.getText(ast)!=='res'
  ||!handler.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))
 throw Error('HANDLER_AST_SHAPE_MISMATCH '+row.factory);
 const head=source.slice(handler.getStart(ast),handler.body.getStart(ast)+1);
 if(!/^async \(req: any, res\) => \{$/.test(head))throw Error('HANDLER_SIGNATURE_CHANGED '+row.factory+' '+head);
 const statements=source.slice(handler.body.getStart(ast)+1,handler.body.end-1);
 const original=source.slice(n.getStart(ast),n.end);
 const prefix=source.slice(n.getStart(ast),handler.getStart(ast));
 const newHandler=row.factory+'(() => ({ '+row.deps.join(', ')+' }))';
 const replacement=prefix+newHandler+source.slice(handler.end,n.end);
 const methodPrefix="app."+row.method+"('"+row.path+"'";
 if(!original.startsWith(methodPrefix))throw Error('REGISTRATION_PREFIX_CHANGED '+row.factory);
 const migrated=[
 '// '+row.method.toUpperCase()+' '+row.path,
 'export function '+row.factory+'(getDeps: () => any) {',
 '  return '+head.replace(', res)',', res: any)'),
 '    const { '+row.deps.join(', ')+' } = getDeps();',
 statements.replace(/[ \t]+$/gm,''),
 '  };',
 '}',''
 ].join('\n');
 modules[row.group].push(migrated);
 patches.push({start:n.getStart(ast),end:n.end,original,replacement});
 manifest.push({path:row.path,method:row.method,factory:row.factory,module:files[row.group],
  arguments:n.arguments.length,middleware:n.arguments.slice(1,-1).map(x=>x.getText(ast)),
  lines:source.slice(handler.getStart(ast),handler.end).split('\n').length,
  bodySHA256:crypto.createHash('sha256').update(statements).digest('hex')});
}
if(manifest.reduce((a,b)=>a+b.lines,0)<1000)throw Error('INSUFFICIENT_SIZE');
let mutated=source;
for(const patch of [...patches].sort((a,b)=>b.start-a.start)){
 if(mutated.slice(patch.start,patch.end)!==patch.original)throw Error('SOURCE_OVERLAP');
 mutated=mutated.slice(0,patch.start)+patch.replacement+mutated.slice(patch.end);
}
const imports=[
"import { "+names.filter(x=>x.group==='access').map(x=>x.factory).join(', ')+" } from './services/clinicAccessMembershipHandlers';",
"import { "+names.filter(x=>x.group==='schedule').map(x=>x.factory).join(', ')+" } from './services/clinicWorkScheduleHandlers';",
''
].join('\n');
const after=imports+mutated;
let reconstructed=after.slice(imports.length);
for(const p of patches.sort((a,b)=>a.start-b.start)){
 if(reconstructed.split(p.replacement).length!==2)throw Error('UNIQUE_ROUNDTRIP_FAILED '+p.start);
 reconstructed=reconstructed.replace(p.replacement,p.original);
}
if(reconstructed!==source)throw Error('BYTE_FOR_BYTE_ROUNDTRIP_FAILED');
const previous=source.split('\n').length,now=after.split('\n').length,removed=previous-now;
if(removed<850)throw Error('TOO_FEW_REMOVED_LINES '+removed);
const data={oldGitBlob:oldBlob,previousLines:previous,newLines:now,removedLines:removed,
  totalRoutes:manifest.length,handlerLines:manifest.reduce((a,b)=>a+b.lines,0),routes:manifest};
fs.writeFileSync('server.ts',after);
fs.writeFileSync(files.access,header.access+'\n'+modules.access.join('\n'));
fs.writeFileSync(files.schedule,header.schedule+'\n'+modules.schedule.join('\n'));
fs.writeFileSync('docs/backend-modularization/20261011-server-route-batch02-manifest.json',JSON.stringify(data,null,2)+'\n');
fs.appendFileSync('docs/backend-modularization/20261011-server-route-batch02.md',
 '\n## Extraction performed\n- Strict original SHA and AST guards, byte-for-byte source roundtrip before any writes.\n'
 +'- 12 handlers, 9 clinic access/membership and 3 schedule, method/path/middleware preserved.\n'
 +'- New server lines: '+previous+' -> '+now+' (removed '+removed+').\n'
 +'- Per-handler SHA256 and middleware preserved in committed manifest. No merge/deploy.\n');
console.log('[batch02-extracted] '+JSON.stringify({previous,now,removed,routes:manifest.length,handlerLines:data.handlerLines}));
