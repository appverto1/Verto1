// Pure input validation for manual/bulk owner opportunity acquisition.
// Keep request checks before any database access; the route owns all persistence.
type ValidationDeps = {
  sanitizeString: (value: unknown, limit: number) => string;
  isUuid: (value: string) => boolean;
};

export function parseManualOpportunityPreviewInput(rawPhones: unknown) {
    const phones = rawPhones;
    if (!Array.isArray(phones) || phones.length < 1 || phones.length > 100 ||
        phones.some((value: unknown) => typeof value !== 'string' || value.length > 40)) {
      return {ok:false as const,error:'Informe entre 1 e 100 telefones.'};
    }
    const normalized = (phones as string[]).map(value => {
      let digits = value.replace(/[^0-9]/g, '');
      if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
      return /^55[1-9][0-9][0-9]{8,9}$/.test(digits) ? digits : null;
    });
    const counts = new Map<string,number>();
    for (const phone of normalized) if (phone) counts.set(phone,(counts.get(phone)||0)+1);
    const unique = [...counts.keys()];
    return {ok:true as const,normalized,counts,unique};
}

export function parseManualOpportunitySaveInput(req: any, {sanitizeString,isUuid}: ValidationDeps) {
    const phones = req.body?.phones;
    const channelsByPhone = req.body?.channelsByPhone;
    const detailsByPhone = req.body?.detailsByPhone;
    const withDetails = detailsByPhone !== undefined;
    const actorId = sanitizeString(req.session?.user?.id, 120);
    const key = sanitizeString(req.headers?.['x-idempotency-key'], 120);
    if (!isUuid(actorId) || key.length < 12 || key.length > 120 ||
        !Array.isArray(phones) || phones.length < 1 || phones.length > 100 ||
        phones.some((v: unknown) => typeof v !== 'string' || v.length > 40) ||
        !Array.isArray(channelsByPhone) || channelsByPhone.length!==phones.length ||
        channelsByPhone.some((row:unknown)=>!Array.isArray(row)||row.length>20||
          row.some((id:unknown)=>typeof id!=='string'||!isUuid(id))||
          new Set(row).size!==row.length)) {
      return {ok:false as const,error:'Informe entre 1 e 100 telefones válidos.'};
    }
    if (withDetails) {
      if (!Array.isArray(detailsByPhone) || detailsByPhone.length!==phones.length ||
          detailsByPhone.some((row:unknown)=>!row || typeof row!=='object' || Array.isArray(row) ||
            Object.keys(row).some(k=>!['name','clinicName','email'].includes(k)) ||
            Object.values(row).some(v=>v!==null && typeof v!=='string'))) {
        return {ok:false as const,error:'Dados dos contatos inválidos.'};
      }
      const emails = new Set<string>();
      for (const row of detailsByPhone as Array<{name?:string;clinicName?:string;email?:string}>) {
        const name = String(row.name || '').trim();
        const clinic = String(row.clinicName || '').trim();
        const email = String(row.email || '').trim().toLowerCase();
        if ((name && name.length<2) || name.length>180 || clinic.length>180 ||
            email.length>254 || (email && (email.length<3 || !/^[^ @]+@[^ @]+[.][^ @]+$/.test(email))) ||
            /[\x00-\x1F\x7F]/.test(name+clinic+email)) {
          return {ok:false as const,error:'Revise nome, clínica e e-mail dos contatos.'};
        }
        if (email) {
          if (emails.has(email)) return {ok:false as const,error:'E-mail repetido no lote de contatos.'};
          emails.add(email);
        }
      }
    }
    return {ok:true as const,phones,channelsByPhone,detailsByPhone,withDetails,actorId,key};
}
