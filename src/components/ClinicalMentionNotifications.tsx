import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Eye, FileText, MessageCircle, X } from 'lucide-react';
import { dataService } from '../services/dataService';

type ClinicalNotification = {
  id: string;
  source?: 'mention' | 'clinical_inbox' | string;
  eventType?: string | null;
  patientId: string;
  noteId?: string | null;
  timelineItemId?: string | null;
  grantId?: string | null;
  commentId?: string | null;
  patientName?: string;
  mentionedByName?: string;
  actorName?: string;
  subject?: string | null;
  excerpt?: string | null;
  readAt?: string | null;
  createdAt?: string | null;
};

type Props = {
  themeMode?: 'light' | 'dark' | string;
  onOpenNotification: (notification: ClinicalNotification) => void;
};

export const ClinicalMentionNotifications = ({ themeMode = 'light', onOpenNotification }: Props) => {
  const [items, setItems] = useState<ClinicalNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isDark = themeMode === 'dark';

  const load = async () => {
    setLoading(true);
    try {
      const result = await dataService.getClinicalNoteMentions(12);
      if (result?.success !== false) setItems(Array.isArray(result?.data) ? result.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  const unread = useMemo(() => items.filter((item) => !item.readAt).length, [items]);

  const openNotification = async (item: ClinicalNotification) => {
    onOpenNotification(item);
    setOpen(false);
    if (!item.readAt) {
      const now = new Date().toISOString();
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: now } : entry));
      void dataService.markClinicalNoteMentionRead(item.id, item.source === 'clinical_inbox' ? 'clinical_inbox' : 'mention');
    }
  };

  const renderCopy = (item: ClinicalNotification) => {
    if (item.eventType === 'EXTERNAL_EVOLUTION_FIRST_VIEWED') {
      return {
        title: 'Evolução visualizada',
        detail: `${item.actorName || 'Profissional externo'} visualizou uma evolução compartilhada de ${item.patientName || 'Paciente'}.`,
        Icon: Eye,
      };
    }
    if (item.eventType === 'EXTERNAL_EVOLUTION_COMMENTED') {
      return {
        title: 'Novo comentário em evolução',
        detail: `${item.actorName || 'Profissional externo'} comentou uma evolução compartilhada de ${item.patientName || 'Paciente'}.`,
        Icon: MessageCircle,
      };
    }
    return {
      title: `${item.actorName || item.mentionedByName || 'Profissional da equipe'} mencionou você`,
      detail: item.excerpt || '',
      Icon: FileText,
    };
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); if (!open) void load(); }}
        className={`relative rounded-xl p-2.5 transition-all ${isDark ? 'text-slate-300 hover:bg-[#122544]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        title="Notificações clínicas"
        aria-label="Notificações clínicas"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[#7a32fc] px-1 text-center text-[9px] font-bold leading-4 text-white">
            {Math.min(unread, 9)}{unread > 9 ? '+' : ''}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute right-0 top-12 z-[120] w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-2xl ${isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
          <div className={`flex items-center justify-between border-b px-4 py-3 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
            <div>
              <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>Notificações</p>
              <p className="text-[10px] text-slate-400">Menções e atualizações clínicas que pedem sua atenção</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className={`rounded-lg p-1 text-slate-400 ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}><X size={16} /></button>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {loading && items.length === 0 ? (
              <p className="p-5 text-center text-xs text-slate-400">Carregando...</p>
            ) : items.length === 0 ? (
              <p className="p-5 text-center text-xs text-slate-400">Nenhuma notificação recente.</p>
            ) : items.map((item) => {
              const copy = renderCopy(item);
              const Icon = copy.Icon;
              return (
                <button
                  key={`${item.source || 'mention'}:${item.id}`}
                  type="button"
                  onClick={() => void openNotification(item)}
                  className={`mb-1 flex w-full gap-3 rounded-xl p-3 text-left transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-violet-50'} ${!item.readAt ? (isDark ? 'bg-violet-500/10' : 'bg-violet-50/60') : ''}`}
                >
                  <span className="mt-0.5 rounded-lg bg-violet-100 p-2 text-[#7a32fc]"><Icon size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{copy.title}</span>
                    {item.source !== 'clinical_inbox' && <span className="mt-0.5 block text-[11px] font-medium text-[#7a32fc]">{item.patientName || 'Paciente'}</span>}
                    {copy.detail && <span className={`mt-1 block line-clamp-2 text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{copy.detail}</span>}
                  </span>
                  {!item.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#7a32fc]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
