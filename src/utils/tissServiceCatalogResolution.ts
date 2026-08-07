export type TissServiceCatalogOptionLike = {
  serviceCatalogId?: unknown;
  service_catalog_id?: unknown;
  tussCode?: unknown;
  tuss_code?: unknown;
  officialTussCode?: unknown;
  official_tuss_code?: unknown;
  authorizedCode?: unknown;
  authorized_code?: unknown;
  billingCode?: unknown;
  billing_code?: unknown;
  procedureTussCode?: unknown;
  procedure_tuss_code?: unknown;
  internalCode?: unknown;
  internal_code?: unknown;
};

export type TissServiceCatalogResolution<T extends TissServiceCatalogOptionLike> =
  | {
      status: 'resolved';
      option: T;
      serviceCatalogId: string;
      candidates: T[];
    }
  | {
      status: 'missing';
      option: null;
      serviceCatalogId: null;
      candidates: [];
    }
  | {
      status: 'ambiguous';
      option: null;
      serviceCatalogId: null;
      candidates: T[];
    };

const normalizeExactCode = (value: unknown) => String(value ?? '').trim().toUpperCase();

const record = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/** Reads the canonical procedure identity from the persisted billing context. */
export function resolveBillingContextServiceCatalogId(contextInput: unknown) {
  const context = record(contextInput);
  const metadata = record(context?.metadata);
  const authorization = record(
    metadata?.tiss_authorization ??
      metadata?.tissAuthorization ??
      context?.tiss_authorization ??
      context?.tissAuthorization,
  );
  return String(
    context?.service_catalog_id ??
      context?.serviceCatalogId ??
      metadata?.service_catalog_id ??
      metadata?.serviceCatalogId ??
      authorization?.serviceCatalogId ??
      authorization?.service_catalog_id ??
      '',
  ).trim();
}

const list = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * A pending item that never resolved a catalog is recalculable. Once the
 * catalog identity exists it remains authoritative even when the De/Para is
 * still missing; that condition describes the mapping, not the procedure.
 */
export function resolveAuthoritativeHistoricalTissServiceCatalogId(itemInput: unknown) {
  const item = record(itemInput);
  const serviceCatalogId = String(item?.service_catalog_id ?? item?.serviceCatalogId ?? '').trim();
  if (!serviceCatalogId) return '';
  const status = normalizeExactCode(item?.status);
  const pendingReasons = list(item?.readiness_reasons ?? item?.readinessReasons)
    .map(normalizeExactCode);
  return status === 'PENDING' && pendingReasons.includes('MISSING_SERVICE_CATALOG')
    ? ''
    : serviceCatalogId;
}

const optionServiceCatalogId = (option: TissServiceCatalogOptionLike) =>
  String(option?.serviceCatalogId ?? option?.service_catalog_id ?? '').trim();

const optionExactCodes = (option: TissServiceCatalogOptionLike) => new Set(
  [
    option?.tussCode,
    option?.tuss_code,
    option?.officialTussCode,
    option?.official_tuss_code,
    option?.authorizedCode,
    option?.authorized_code,
    option?.billingCode,
    option?.billing_code,
    option?.procedureTussCode,
    option?.procedure_tuss_code,
    option?.internalCode,
    option?.internal_code,
  ].map(normalizeExactCode).filter(Boolean),
);

/**
 * Resolves a billable catalog option only when an exact official, authorized,
 * billing or internal code
 * identifies one service. Repeated De/Para rows for the same service are one candidate;
 * distinct services with the same code remain explicitly ambiguous.
 */
export function resolveUniqueTissServiceCatalogOptionByCode<
  T extends TissServiceCatalogOptionLike,
>(
  options: readonly T[] | null | undefined,
  requestedCode: unknown,
): TissServiceCatalogResolution<T> {
  const exactCode = normalizeExactCode(requestedCode);
  if (!exactCode || !Array.isArray(options)) {
    return { status: 'missing', option: null, serviceCatalogId: null, candidates: [] };
  }

  const candidatesByService = new Map<string, T>();
  for (const option of options) {
    const serviceCatalogId = optionServiceCatalogId(option);
    if (
      !serviceCatalogId ||
      !optionExactCodes(option).has(exactCode)
    ) continue;
    if (!candidatesByService.has(serviceCatalogId)) {
      candidatesByService.set(serviceCatalogId, option);
    }
  }

  const candidates = Array.from(candidatesByService.values());
  if (candidates.length === 0) {
    return { status: 'missing', option: null, serviceCatalogId: null, candidates: [] };
  }
  if (candidates.length > 1) {
    return { status: 'ambiguous', option: null, serviceCatalogId: null, candidates };
  }

  const option = candidates[0];
  return {
    status: 'resolved',
    option,
    serviceCatalogId: optionServiceCatalogId(option),
    candidates,
  };
}
