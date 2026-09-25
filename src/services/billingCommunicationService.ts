import { getSupabase } from '../lib/supabase';

export type BillingCommunicationReferenceState = 'AVAILABLE' | 'RESTRICTED' | 'UNAVAILABLE' | null;

export type BillingCommunicationThread = {
  id: string;
  subject: string;
  status: 'open' | 'archived' | string;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceState?: BillingCommunicationReferenceState;
  lastActivityAt?: string | null;
  lastSequence?: number | null;
  unreadCount?: number | null;
  lastAuthorName?: string | null;
  lastAuthorRole?: string | null;
  lastMessageAt?: string | null;
};

export type BillingCommunicationMessage = {
  id: string;
  threadId: string;
  sequence: number;
  authorUserId?: string | null;
  authorName?: string | null;
  authorRole?: string | null;
  body: string;
  createdAt?: string | null;
  mentions?: Array<{ userId?: string; name?: string; role?: string }> | null;
};

export type BillingCommunicationMentionTarget = {
  userId: string;
  name: string;
  role: string;
};

export type BillingCommunicationNotification = {
  mentionId: string;
  clinicId: string;
  threadId: string;
  createdAt?: string | null;
  readAt?: string | null;
  copy?: string | null;
};

export type BillingCommunicationThreadCursor = {
  lastActivityAt: string;
  id: string;
};

export type BillingCommunicationNotificationCursor = {
  createdAt: string;
  id: string;
};

type RpcResult<T> = T | null | undefined;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase();
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function createBillingCommunicationIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `billing-communication-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export const billingCommunicationService = {
  async listThreads(clinicId: string, cursor?: BillingCommunicationThreadCursor | null) {
    const payload = await rpc<RpcResult<{ items?: BillingCommunicationThread[]; nextCursor?: BillingCommunicationThreadCursor | null }>>(
      'list_clinic_communication_threads_v1',
      {
        p_clinic_id: clinicId,
        p_limit: 30,
        p_before_activity_at: cursor?.lastActivityAt || null,
        p_before_id: cursor?.id || null,
      },
    );
    return {
      items: Array.isArray(payload?.items) ? payload!.items! : [],
      nextCursor: payload?.nextCursor || null,
    };
  },

  async listMessages(threadId: string, beforeSequence?: number | null) {
    const payload = await rpc<RpcResult<{ items?: BillingCommunicationMessage[]; nextBeforeSequence?: number | null }>>(
      'list_clinic_communication_messages_v1',
      {
        p_thread_id: threadId,
        p_limit: 50,
        p_before_sequence: beforeSequence ?? null,
      },
    );
    return {
      items: Array.isArray(payload?.items) ? payload!.items! : [],
      nextBeforeSequence: payload?.nextBeforeSequence ?? null,
    };
  },

  async listMentionTargets(clinicId: string, query: string) {
    const payload = await rpc<RpcResult<{ items?: BillingCommunicationMentionTarget[] } | BillingCommunicationMentionTarget[]>>(
      'list_clinic_communication_mention_targets_v1',
      { p_clinic_id: clinicId, p_query: query, p_limit: 20 },
    );
    if (Array.isArray(payload)) return payload;
    return Array.isArray(payload?.items) ? payload!.items! : [];
  },

  async listNotifications(cursor?: BillingCommunicationNotificationCursor | null) {
    const payload = await rpc<RpcResult<{ items?: BillingCommunicationNotification[]; nextCursor?: BillingCommunicationNotificationCursor | null }>>(
      'list_clinic_communication_notifications_v1',
      {
        p_limit: 30,
        p_before_created_at: cursor?.createdAt || null,
        p_before_id: cursor?.id || null,
      },
    );
    return {
      items: Array.isArray(payload?.items) ? payload!.items! : [],
      nextCursor: payload?.nextCursor || null,
    };
  },

  async getUnreadCount(clinicId: string) {
    const payload = await rpc<RpcResult<number | { unreadCount?: number }>>(
      'get_clinic_communication_unread_count_v1',
      { p_clinic_id: clinicId },
    );
    if (typeof payload === 'number') return payload;
    return Number(payload?.unreadCount || 0);
  },

  createThread(input: {
    clinicId: string;
    subject: string;
    message: string;
    mentionUserIds: string[];
    idempotencyKey: string;
    referenceType?: string | null;
    referenceId?: string | null;
  }) {
    return rpc<{ threadId: string; messageId: string; sequence: number; idempotent?: boolean }>(
      'create_clinic_communication_thread_v1',
      {
        p_clinic_id: input.clinicId,
        p_subject: input.subject,
        p_message: input.message,
        p_mention_user_ids: input.mentionUserIds,
        p_reference_type: input.referenceType || null,
        p_reference_id: input.referenceId || null,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  },

  sendMessage(input: { threadId: string; message: string; mentionUserIds: string[]; idempotencyKey: string }) {
    return rpc<{ threadId: string; messageId: string; sequence: number; idempotent?: boolean }>(
      'send_clinic_communication_message_v1',
      {
        p_thread_id: input.threadId,
        p_message: input.message,
        p_mention_user_ids: input.mentionUserIds,
        p_idempotency_key: input.idempotencyKey,
      },
    );
  },

  setArchived(threadId: string, archived: boolean) {
    return rpc<{ threadId: string; status: string; idempotent?: boolean }>('set_clinic_communication_thread_archived_v1', {
      p_thread_id: threadId,
      p_archived: archived,
    });
  },

  markThreadRead(threadId: string, observedSequence: number) {
    return rpc<{ threadId: string; lastReadSequence: number }>('mark_clinic_communication_read_v1', {
      p_thread_id: threadId,
      p_observed_sequence: observedSequence,
    });
  },

  markNotificationRead(mentionId: string) {
    return rpc<{ mentionId: string; notificationRead: boolean }>('mark_clinic_communication_notification_read_v1', {
      p_mention_id: mentionId,
    });
  },
};
