import { getSupabase } from '../lib/supabase';

export type OnboardingSlot = {
  id: string;
  starts_at: string;
  timezone: string;
  status: 'available' | 'inactive' | 'reserved' | 'cancelled';
};

export type OnboardingResponse = {
  id: string;
  publication_id: string;
  slot_id: string;
  participants: string[];
  status: 'responded' | 'cancelled' | 'superseded';
  responded_at: string;
  admin_ack_at: string | null;
};

export type TenantOnboardingPublication = {
  id: string;
  version: number;
  snapshot_title: string;
  snapshot_message: string;
  snapshot_topics: string[];
  snapshot_participant_guidance: string;
  status: 'published' | 'viewed' | 'responded' | 'cancelled';
  published_at: string;
  viewed_at: string | null;
  responded_at: string | null;
  onboarding_slots: OnboardingSlot[];
  onboarding_responses: OnboardingResponse[];
};

const client = async () => {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('ONBOARDING_CLIENT_UNAVAILABLE');
  return supabase;
};

const normalizeRpcError = (error: any): Error => {
  const message = String(error?.message || error?.details || 'ONBOARDING_REQUEST_FAILED');
  if (message.includes('SLOT_TAKEN')) return new Error('SLOT_TAKEN');
  if (message.includes('ONBOARDING_ALREADY_RESPONDED')) return new Error('ONBOARDING_ALREADY_RESPONDED');
  if (message.includes('ONBOARDING_FORBIDDEN')) return new Error('ONBOARDING_FORBIDDEN');
  return new Error('ONBOARDING_REQUEST_FAILED');
};

export const onboardingService = {
  async listTenantPublications(limit = 10): Promise<TenantOnboardingPublication[]> {
    const supabase = await client();
    const boundedLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
    const { data, error } = await supabase
      .from('onboarding_publications')
      .select(`
        id,
        version,
        snapshot_title,
        snapshot_message,
        snapshot_topics,
        snapshot_participant_guidance,
        status,
        published_at,
        viewed_at,
        responded_at,
        onboarding_slots(id, starts_at, timezone, status),
        onboarding_responses(id, publication_id, slot_id, participants, status, responded_at, admin_ack_at)
      `)
      .in('status', ['published', 'viewed', 'responded'])
      .order('published_at', { ascending: false })
      .limit(boundedLimit);
    if (error) throw normalizeRpcError(error);
    return (Array.isArray(data) ? data : []) as TenantOnboardingPublication[];
  },

  async markViewed(publicationId: string) {
    const supabase = await client();
    const { data, error } = await supabase.rpc('mark_onboarding_viewed_current_v1', {
      p_publication_id: publicationId,
    });
    if (error) throw normalizeRpcError(error);
    return Array.isArray(data) ? data[0] : data;
  },

  async submitResponse(input: {
    publicationId: string;
    slotId: string;
    participants: string[];
    idempotencyKey: string;
  }) {
    const supabase = await client();
    const { data, error } = await supabase.rpc('submit_onboarding_response_current_v1', {
      p_publication_id: input.publicationId,
      p_slot_id: input.slotId,
      p_participants: input.participants,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw normalizeRpcError(error);
    return Array.isArray(data) ? data[0] : data;
  },

  async listAdminInbox(page = 0, pageSize = 20) {
    const supabase = await client();
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 50);
    const offset = Math.max(Number(page) || 0, 0) * size;
    const { data, error, count } = await supabase
      .from('onboarding_responses')
      .select(`
        id,
        publication_id,
        clinic_id,
        slot_id,
        status,
        responded_at,
        admin_ack_at,
        onboarding_publications!inner(snapshot_title, status),
        onboarding_slots!inner(starts_at, timezone),
        clinics!inner(id, name)
      `, { count: 'exact' })
      .eq('is_current', true)
      .eq('status', 'responded')
      .order('responded_at', { ascending: false })
      .range(offset, offset + size - 1);
    if (error) throw normalizeRpcError(error);
    return { items: Array.isArray(data) ? data : [], total: Number(count || 0) };
  },

  async getAdminResponse(responseId: string) {
    const supabase = await client();
    const { data, error } = await supabase
      .from('onboarding_responses')
      .select(`
        id,
        publication_id,
        clinic_id,
        slot_id,
        participants,
        status,
        responded_at,
        admin_ack_at,
        onboarding_publications!inner(snapshot_title, snapshot_message, snapshot_topics, snapshot_participant_guidance, status),
        onboarding_slots!inner(starts_at, timezone),
        clinics!inner(id, name)
      `)
      .eq('id', responseId)
      .single();
    if (error) throw normalizeRpcError(error);
    return data;
  },

  async acknowledgeResponse(responseId: string) {
    const supabase = await client();
    const { data, error } = await supabase.rpc('ack_onboarding_response_current_v1', {
      p_response_id: responseId,
    });
    if (error) throw normalizeRpcError(error);
    return Array.isArray(data) ? data[0] : data;
  },
};
