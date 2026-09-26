import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import {
  billingCommunicationService,
  type BillingCommunicationNotification,
} from '../services/billingCommunicationService';

type Props = {
  clinicId: string;
  themeMode?: 'light' | 'dark';
  onOpenThread: (threadId: string) => void;
};

const MINIMAL_MENTION_COPY = 'Você foi mencionado em uma atualização da clínica.';

export function BillingCommunicationNotifications({
  clinicId,
  themeMode = 'light',
  onOpenThread,
}: Props) {
  const scope = String(clinicId || '').trim();
  const revisionRef = useRef(0);
  const [items, setItems] = useState<BillingCommunicationNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const unreadCount = useMemo(
    () => items.reduce((total, item) => total + (item.readAt ? 0 : 1), 0),
    [items],
  );

  const load = useCallback(async () => {
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    if (!scope) {
      setItems([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await billingCommunicationService.listNotifications(scope);
      if (revision !== revisionRef.current) return;
      setItems(result.items.slice(0, 20));
    } catch {
      if (revision === revisionRef.current) {
        setItems([]);
        setError('Não foi possível carregar as menções de faturamento.');
      }
    } finally {
      if (revision === revisionRef.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    revisionRef.current += 1;
    setItems([]);
    setOpen(false);
    setError('');
    void load();
    return () => {
      revisionRef.current += 1;
    };
  }, [scope, load]);

  const openNotification = async (item: BillingCommunicationNotification) => {
    const revision = revisionRef.current;
    if (!item.readAt) {
      try {
        await billingCommunicationService.markNotificationRead(item.mentionId);
        if (revision === revisionRef.current) {
          setItems((current) => current.map((entry) => (
            entry.mentionId === item.mentionId
              ? { ...entry, readAt: new Date().toISOString() }
              : entry
          )));
        }
      } catch {
        // Notification-read is independent from opening the communication thread.
      }
    }
    if (revision === revisionRef.current) {
      setOpen(false);
      onOpenThread(item.threadId);
    }
  };

  if (!scope) return null;

  const dark = themeMode === 'dark';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) void load();
        }}
        className={`relative rounded-xl p-2.5 transition-all ${dark ? 'text-slate-300 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        aria-label={unreadCount > 0 ? `${unreadCount} menção${unreadCount === 1 ? '' : 'ões'} em atualizações do faturamento` : 'Atualizações do faturamento'}
        aria-expanded={open}
        title="Atualizações do faturamento"
      >
        <MessageCircle size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-violet-600 px-1 text-center text-[9px] font-bold leading-4 text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-xl ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
          <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${dark ? 'border-slate-700' : 'border-slate-100'}`}>
            <div>
              <div className={`flex items-center gap-2 text-sm font-semibold ${dark ? 'text-slate-100' : 'text-slate-800'}`}>
                <Bell size={15} /> Menções do faturamento
              </div>
              <p className={`mt-0.5 text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Avisos mínimos da clínica ativa
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className={`rounded-lg p-2 ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-50'}`}
              aria-label="Atualizar menções do faturamento"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {loading && items.length === 0 && (
              <div className={`flex items-center gap-2 px-3 py-4 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                <Loader2 size={14} className="animate-spin" /> Carregando menções…
              </div>
            )}
            {!loading && error && (
              <div className="rounded-xl bg-rose-50 px-3 py-3 text-xs text-rose-700" role="alert">{error}</div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className={`px-3 py-5 text-center text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Nenhuma menção de faturamento nesta clínica.
              </div>
            )}
            {items.map((item) => (
              <button
                key={item.mentionId}
                type="button"
                onClick={() => void openNotification(item)}
                className={`mb-1 w-full rounded-xl px-3 py-3 text-left transition last:mb-0 ${
                  item.readAt
                    ? dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-50'
                    : dark ? 'bg-violet-950/40 text-violet-100 hover:bg-violet-950/60' : 'bg-violet-50 text-violet-900 hover:bg-violet-100'
                }`}
              >
                <p className="text-xs font-semibold leading-5">{MINIMAL_MENTION_COPY}</p>
                <p className={`mt-1 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                  {item.readAt ? 'Lida' : 'Não lida'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
