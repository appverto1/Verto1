const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceOf=(row:any)=>{
  const value=row?.source_payload??row?.sourcePayload;
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  if(typeof value==='string'){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed;}catch{}}
  return row||{};
};

// Read projection of rows already protected by the canonical database guards.
// This helper never authorizes booking or accepts a frontend sharing flag.
export function groupCalendarMetadata(row:any){
  const source=sourceOf(row);
  if(source.sessionModality!=='GROUP'||!UUID.test(String(source.sessionGroupId||''))||
    !Array.isArray(source.professionalIds)||source.professionalIds.length<1||source.professionalIds.length>8||
    source.professionalIds.some((id:any)=>typeof id!=='string'||!UUID.test(id))||
    new Set(source.professionalIds).size!==source.professionalIds.length)return{};
  return{sessionModality:'GROUP',sessionGroupId:source.sessionGroupId,
    professionalIds:[...source.professionalIds],
    professionalNames:Array.isArray(source.professionalNames)?source.professionalNames.map((name:any)=>String(name).slice(0,180)):[],
    ...(UUID.test(String(source.recurrenceGroupId||''))?{recurrenceGroupId:source.recurrenceGroupId}:{}),
  };
}

export function groupCalendarMatchesProfessional(row:any,professionalIds:ReadonlySet<string>){
  const primary=String(row?.therapist_id||row?.therapistId||row?.professional_id||'');
  return professionalIds.has(primary)||(groupCalendarMetadata(row).professionalIds||[]).some(id=>professionalIds.has(id));
}

export function groupCalendarProfessionalFilter(input:Iterable<string>){
  const ids=[...new Set([...input].filter(id=>UUID.test(id)))].slice(0,24);
  if(!ids.length)return'id.is.null';
  return[`therapist_id.in.(${ids.join(',')})`,...ids.map(id=>
    `and(source_payload->>sessionModality.eq.GROUP,source_payload->professionalIds.cs.["${id}"])`)].join(',');
}
