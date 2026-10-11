import { ORGANIZATION_MODULE_KEYS, type OrganizationModuleKey } from '../src/constants/organizationModules';

const DIRECT_OFFER_STATUSES = new Set(['ready', 'sent', 'opened', 'accepted', 'checkout_created']);
export const normalizeModuleSet = (values: Iterable<unknown>) => Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter((value): value is OrganizationModuleKey => ORGANIZATION_MODULE_KEYS.includes(value as OrganizationModuleKey)))).sort();
const sameModuleSet = (left: Iterable<unknown>, right: Iterable<unknown>) => { const a = normalizeModuleSet(left); const b = normalizeModuleSet(right); return a.length === b.length && a.every((value, index) => value === b[index]); };
export const isDemoSession = (user: any) => { const billingModel = String(user?.billingModel || user?.billing_model || '').trim().toLowerCase(); const activeWorkspaceId = String(user?.activeWorkspaceId || user?.clinicId || user?.clinic_id || '').trim(); const workspaces = Array.isArray(user?.workspaces) ? user.workspaces : []; const activeWorkspace = workspaces.find((workspace: any) => String(workspace?.clinicId || workspace?.clinic_id || '').trim() === activeWorkspaceId); return Boolean(user?.isDemoUser === true || user?.is_demo_user === true || billingModel === 'demo' || billingModel === 'demo_sandbox' || activeWorkspace?.isDemo === true || String(activeWorkspace?.billingModel || activeWorkspace?.billing_model || '').trim().toLowerCase() === 'demo_sandbox'); };

export const loadCanonicalDirectOffers = async (supabase: any, organizationId: string, currentModules: readonly OrganizationModuleKey[]) => {
  const leadResult = await supabase.from('sales_leads').select('id').eq('converted_clinic_id', organizationId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(20);
  if (leadResult.error) throw leadResult.error;
  const leadIds = (Array.isArray(leadResult.data) ? leadResult.data : []).map((row: any) => String(row?.id || '').trim()).filter(Boolean);
  if (leadIds.length === 0) return new Map<OrganizationModuleKey, string>();
  const offerResult = await supabase.from('sales_offers').select('id,lead_id,status,expires_at,revoked_at,offer_type,modular_checkout_enabled,created_at').in('lead_id', leadIds).eq('offer_type', 'modular').is('revoked_at', null).order('created_at', { ascending: false }).limit(50);
  if (offerResult.error) throw offerResult.error;
  const now = Date.now();
  const offers = (Array.isArray(offerResult.data) ? offerResult.data : []).filter((offer: any) => { const status = String(offer?.status || '').trim().toLowerCase(); const expiresAt = Date.parse(String(offer?.expires_at || '')); return DIRECT_OFFER_STATUSES.has(status) && offer?.modular_checkout_enabled !== false && Number.isFinite(expiresAt) && expiresAt > now; });
  const offerIds = offers.map((offer: any) => String(offer?.id || '').trim()).filter(Boolean);
  if (offerIds.length === 0) return new Map<OrganizationModuleKey, string>();
  const itemResult = await supabase.from('sales_offer_items').select('offer_id,item_key').in('offer_id', offerIds).limit(500);
  if (itemResult.error) throw itemResult.error;
  const moduleSetByOffer = new Map<string, OrganizationModuleKey[]>();
  for (const row of Array.isArray(itemResult.data) ? itemResult.data : []) { const offerId = String(row?.offer_id || '').trim(); const itemKey = String(row?.item_key || '').trim() as OrganizationModuleKey; if (!offerId || !ORGANIZATION_MODULE_KEYS.includes(itemKey)) continue; const list = moduleSetByOffer.get(offerId) || []; if (!list.includes(itemKey)) list.push(itemKey); moduleSetByOffer.set(offerId, list); }
  const currentSet = normalizeModuleSet(['clinical_core', ...currentModules]);
  const directByModule = new Map<OrganizationModuleKey, string>();
  for (const moduleKey of ORGANIZATION_MODULE_KEYS) { if (moduleKey === 'clinical_core' || currentSet.includes(moduleKey)) continue; const expectedSet = normalizeModuleSet([...currentSet, moduleKey]); const matchingOffer = offers.find((offer: any) => sameModuleSet(moduleSetByOffer.get(String(offer?.id || '').trim()) || [], expectedSet)); if (matchingOffer?.id) directByModule.set(moduleKey, String(matchingOffer.id)); }
  return directByModule;
};

