export type SalesPostPaymentState = 'payment_pending' | 'payment_confirmed' | 'provisioning' | 'director_ready' | 'account_activated' | 'review_required';
export function resolveSalesPostPaymentState(data: any): SalesPostPaymentState;
export function resolveSalesPostPaymentRetryDelayMs(retryAfterHeader: string | null | undefined, data: any, fallbackMs: number): number;
