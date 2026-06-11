export type ActionResultAffected = {
  clinicId?: string | null;
  organizationId?: string | null;
  patientId?: string | null;
  patientIds?: string[];
  professionalId?: string | null;
  professionalIds?: string[];
  userIds?: string[];
  appointmentIds?: string[];
  date?: string | null;
  dateRange?: {
    from?: string | null;
    to?: string | null;
  } | null;
  queryKeys?: string[];
  [key: string]: unknown;
};

export type ActionResult<T = any> = {
  success: boolean;
  entity?: string;
  action?: string;
  item?: T | null;
  items?: T[];
  removedIds?: string[];
  affected?: ActionResultAffected;
  events?: any[];
  warnings?: string[];
  error?: string;
  [key: string]: unknown;
};

export type ApplyActionResultState<T = any> = {
  items: T[];
  lastAppliedAt?: number;
};

export type ApplyActionResultOptions<T = any> = {
  entity: string;
  current: T[];
  result: ActionResult<T>;
  now?: number;
  getId?: (item: T) => string;
  sort?: (items: T[]) => T[];
  merge?: (current: T[], incoming: T[]) => T[];
  remove?: (current: T[], removedIds: string[]) => T[];
};

const defaultGetId = (item: any) => String(item?.id || '').trim();

const uniqueStrings = (values: unknown[]) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean)));

export const buildActionResult = <T = any>(result: Partial<ActionResult<T>> & { success?: boolean }): ActionResult<T> => ({
  ...result,
  success: result.success !== false,
  entity: result.entity,
  action: result.action,
  item: result.item ?? null,
  items: Array.isArray(result.items) ? result.items : result.item ? [result.item] : [],
  removedIds: uniqueStrings(result.removedIds || []),
  affected: result.affected || {},
  events: Array.isArray(result.events) ? result.events : [],
  warnings: Array.isArray(result.warnings) ? result.warnings : [],
});

export const mergeActionItemsById = <T = any>(current: T[], incoming: T[], getId: (item: T) => string = defaultGetId) => {
  const byId = new Map<string, T>();
  for (const item of Array.isArray(current) ? current : []) {
    const id = getId(item);
    if (id) byId.set(id, item);
  }
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const id = getId(item);
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) as any || {}), ...(item as any) });
  }
  return Array.from(byId.values());
};

export const removeActionItemsById = <T = any>(current: T[], removedIds: string[], getId: (item: T) => string = defaultGetId) => {
  const ids = new Set(uniqueStrings(removedIds));
  return (Array.isArray(current) ? current : []).filter((item) => !ids.has(getId(item)));
};

export const applyActionResult = <T = any>(options: ApplyActionResultOptions<T>) => {
  const result = buildActionResult(options.result);
  if (!result.success) {
    return { ok: false, reason: result.error || 'ACTION_FAILED', items: options.current, appliedAt: options.now || Date.now() };
  }
  if (result.entity && result.entity !== options.entity) {
    return { ok: false, reason: 'ENTITY_MISMATCH', items: options.current, appliedAt: options.now || Date.now() };
  }

  const getId = options.getId || defaultGetId;
  const incoming = Array.isArray(result.items) && result.items.length > 0
    ? result.items
    : result.item
      ? [result.item]
      : [];
  let next = options.merge
    ? options.merge(options.current, incoming)
    : mergeActionItemsById(options.current, incoming, getId);

  const removedIds = uniqueStrings(result.removedIds || []);
  if (removedIds.length > 0) {
    next = options.remove
      ? options.remove(next, removedIds)
      : removeActionItemsById(next, removedIds, getId);
  }

  if (options.sort) next = options.sort(next);
  return {
    ok: true,
    reason: '',
    items: next,
    appliedAt: options.now || Date.now(),
    affected: result.affected || {},
    events: result.events || [],
    warnings: result.warnings || [],
  };
};
