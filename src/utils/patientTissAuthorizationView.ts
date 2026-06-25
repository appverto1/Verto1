export type PatientTissAuthorizationStatus =
  | 'current'
  | 'expiring'
  | 'future'
  | 'expired'
  | 'consumed'
  | 'inactive';

export type PatientTissAuthorizationVisualState = {
  status: PatientTissAuthorizationStatus;
  label: string;
  tone: 'green' | 'amber' | 'blue' | 'red' | 'slate';
  sortRank: number;
  isCurrent: boolean;
  isHistorical: boolean;
};

export type PatientTissAuthorizationGroup = {
  key: string;
  payerName: string;
  serviceName: string;
  tussCode: string;
  tussDescription: string;
  authorizations: any[];
  currentAuthorizations: any[];
  historicalAuthorizations: any[];
  suggestedAuthorization: any | null;
  duplicateLikeCount: number;
};

const cleanText = (value: any) => String(value ?? '').trim();

const normalizeKey = (value: any) =>
  cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const asDateKey = (value: any) => {
  const raw = cleanText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const daysBetween = (fromKey: string, toKey: string) => {
  if (!fromKey || !toKey) return null;
  const from = new Date(`${fromKey}T00:00:00Z`).getTime();
  const to = new Date(`${toKey}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
};

export const getPatientTissAuthorizationVisualState = (
  authorization: any,
  referenceDateKey = todayKey(),
): PatientTissAuthorizationVisualState => {
  const status = cleanText(authorization?.status).toLowerCase();
  const active = authorization?.active !== false && status !== 'cancelled' && status !== 'inactive';
  const authorizedQuantity = Number(authorization?.authorizedQuantity ?? authorization?.authorized_quantity ?? 0) || 0;
  const usedQuantity = Number(authorization?.usedQuantity ?? authorization?.used_quantity ?? 0) || 0;
  const validFrom = asDateKey(authorization?.validFrom ?? authorization?.valid_from);
  const validUntil = asDateKey(authorization?.validUntil ?? authorization?.valid_until);

  if (!active) {
    return { status: 'inactive', label: 'Inativa', tone: 'slate', sortRank: 5, isCurrent: false, isHistorical: true };
  }
  if (authorizedQuantity > 0 && usedQuantity >= authorizedQuantity) {
    return { status: 'consumed', label: 'Consumida', tone: 'slate', sortRank: 4, isCurrent: false, isHistorical: true };
  }
  if (validUntil && validUntil < referenceDateKey) {
    return { status: 'expired', label: 'Expirada', tone: 'red', sortRank: 3, isCurrent: false, isHistorical: true };
  }
  if (validFrom && validFrom > referenceDateKey) {
    return { status: 'future', label: 'Futura', tone: 'blue', sortRank: 2, isCurrent: false, isHistorical: false };
  }

  const daysToExpire = validUntil ? daysBetween(referenceDateKey, validUntil) : null;
  if (daysToExpire !== null && daysToExpire <= 15) {
    return { status: 'expiring', label: 'A vencer', tone: 'amber', sortRank: 1, isCurrent: true, isHistorical: false };
  }
  return { status: 'current', label: 'Vigente', tone: 'green', sortRank: 0, isCurrent: true, isHistorical: false };
};

const authorizationGroupKey = (authorization: any) => {
  const payer = cleanText(authorization?.payerId || authorization?.payer_id) || normalizeKey(authorization?.payerName || authorization?.payer_name);
  const service = cleanText(authorization?.serviceCatalogId || authorization?.service_catalog_id) || normalizeKey(authorization?.serviceName || authorization?.procedureNameSnapshot || authorization?.procedure_name_snapshot);
  const tuss = cleanText(authorization?.tussCodeId || authorization?.tuss_code_id) || normalizeKey(authorization?.tussCode || authorization?.procedureTussCode || authorization?.procedure_tuss_code);
  return [payer || 'payer', service || 'service', tuss || 'tuss'].join('|');
};

const authorizationDedupeKey = (authorization: any) => {
  const id = cleanText(authorization?.id);
  if (id) return `id:${id}`;
  return [
    authorizationGroupKey(authorization),
    normalizeKey(authorization?.authorizationNumber || authorization?.authorizationCode || authorization?.authorization_number || authorization?.authorization_code),
    normalizeKey(authorization?.guideNumber || authorization?.guide_number),
    asDateKey(authorization?.validFrom || authorization?.valid_from),
    asDateKey(authorization?.validUntil || authorization?.valid_until),
  ].join('|');
};

const duplicateLikeKey = (authorization: any) =>
  [
    authorizationGroupKey(authorization),
    normalizeKey(authorization?.authorizationNumber || authorization?.authorizationCode || authorization?.authorization_number || authorization?.authorization_code),
    asDateKey(authorization?.validFrom || authorization?.valid_from),
    asDateKey(authorization?.validUntil || authorization?.valid_until),
  ].join('|');

export const groupPatientTissAuthorizations = (
  authorizations: any[],
  referenceDateKey = todayKey(),
): PatientTissAuthorizationGroup[] => {
  const uniqueById = new Map<string, any>();
  for (const authorization of Array.isArray(authorizations) ? authorizations : []) {
    uniqueById.set(authorizationDedupeKey(authorization), authorization);
  }

  const groups = new Map<string, any[]>();
  for (const authorization of uniqueById.values()) {
    const key = authorizationGroupKey(authorization);
    groups.set(key, [...(groups.get(key) || []), authorization]);
  }

  return Array.from(groups.entries())
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => {
        const stateA = getPatientTissAuthorizationVisualState(a, referenceDateKey);
        const stateB = getPatientTissAuthorizationVisualState(b, referenceDateKey);
        if (stateA.sortRank !== stateB.sortRank) return stateA.sortRank - stateB.sortRank;
        return cleanText(b.validUntil || b.valid_until || b.updatedAt || b.updated_at).localeCompare(cleanText(a.validUntil || a.valid_until || a.updatedAt || a.updated_at));
      });
      const first = sorted[0] || {};
      const duplicateKeys = new Set(sorted.map(duplicateLikeKey));
      const currentAuthorizations = sorted.filter((authorization) => !getPatientTissAuthorizationVisualState(authorization, referenceDateKey).isHistorical);
      const historicalAuthorizations = sorted.filter((authorization) => getPatientTissAuthorizationVisualState(authorization, referenceDateKey).isHistorical);
      return {
        key,
        payerName: cleanText(first.payerName || first.payer_name) || 'Convênio não informado',
        serviceName: cleanText(first.serviceName || first.procedureNameSnapshot || first.procedure_name_snapshot) || 'Procedimento faturável',
        tussCode: cleanText(first.tussCode || first.procedureTussCode || first.procedure_tuss_code),
        tussDescription: cleanText(first.tussDescription || first.procedureNameSnapshot || first.procedure_name_snapshot),
        authorizations: sorted,
        currentAuthorizations,
        historicalAuthorizations,
        suggestedAuthorization: sorted.find((authorization) => getPatientTissAuthorizationVisualState(authorization, referenceDateKey).isCurrent) || null,
        duplicateLikeCount: Math.max(0, sorted.length - duplicateKeys.size),
      };
    })
    .sort((a, b) => {
      const stateA = getPatientTissAuthorizationVisualState(a.authorizations[0], referenceDateKey);
      const stateB = getPatientTissAuthorizationVisualState(b.authorizations[0], referenceDateKey);
      if (stateA.sortRank !== stateB.sortRank) return stateA.sortRank - stateB.sortRank;
      return `${a.payerName} ${a.serviceName} ${a.tussCode}`.localeCompare(`${b.payerName} ${b.serviceName} ${b.tussCode}`);
    });
};

export const findSuggestedTissAuthorizationForFinancialPlan = (
  plan: any,
  groups: PatientTissAuthorizationGroup[],
) => {
  const payerId = cleanText(plan?.payerId || plan?.payer_id);
  const payerNameKey = normalizeKey(plan?.payerNameSnapshot || plan?.payer_name_snapshot || plan?.insuranceName || plan?.insurance_name);
  const serviceKey = normalizeKey(plan?.customServiceName || plan?.custom_service_name || plan?.serviceType || plan?.service_type || plan?.specialty);
  return (
    groups
      .filter((group) => group.suggestedAuthorization)
      .find((group) => {
        const authorization = group.suggestedAuthorization;
        const payerMatches =
          (payerId && cleanText(authorization?.payerId || authorization?.payer_id) === payerId) ||
          (!payerId && payerNameKey && normalizeKey(group.payerName) === payerNameKey);
        if (!payerMatches) return false;
        if (!serviceKey) return true;
        const groupServiceKey = normalizeKey(`${group.serviceName} ${authorization?.internalCode || authorization?.internal_code || ''}`);
        return groupServiceKey.includes(serviceKey) || serviceKey.includes(groupServiceKey);
      })?.suggestedAuthorization || null
  );
};
