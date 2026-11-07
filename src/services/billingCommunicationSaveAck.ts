export type PersistedBillingMessageAck = {
  threadId: string;
  messageId: string;
  sequence: number;
  idempotent?: boolean;
};

// A successful HTTP/RPC response is not proof that a message was persisted.
// The database RPC returns these three fields for both initial writes and idempotent replays.
export function requirePersistedBillingMessageAck(
  value: unknown,
  expectedThreadId?: string,
): PersistedBillingMessageAck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('COMMUNICATION_PERSISTENCE_UNCONFIRMED');
  }
  const ack = value as Record<string, unknown>;
  if (
    typeof ack.threadId !== 'string' || !ack.threadId.trim() ||
    typeof ack.messageId !== 'string' || !ack.messageId.trim() ||
    typeof ack.sequence !== 'number' || !Number.isSafeInteger(ack.sequence) || ack.sequence < 1 ||
    (expectedThreadId !== undefined && ack.threadId !== expectedThreadId)
  ) {
    throw new Error('COMMUNICATION_PERSISTENCE_UNCONFIRMED');
  }
  return value as PersistedBillingMessageAck;
}
