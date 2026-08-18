import React, { useEffect, useMemo, useState } from 'react';
import { Bell, FileText, X } from 'lucide-react';
import { dataService } from '../services/dataService';

type MentionNotification = {
  id: string;
  patientId: string;
  noteId: string;
  patientName?: string;
  mentionedByName?: string;
  subject?: string | null;
  excerpt?: string | null;
  readAt?: string | null;
  createdAt?: string | null;
};

type Props = {
  themeMode?: 'light' | 'dark' | string;
  onOpenNotification: (notification: MentionNotification) => void;
};

export const ClinicalMentionNotifications = ({ themeMode = 'light', onOpenNotification }: Props) => {
  const [items, setItems] = useState<MentionNotification[]>([]);
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

  const openNotification = async (item: MentionNotification) => {
    onOpenNotification(item);
    setOpen(false);
    if (!item.readAt) {
      const now = new Date().toISOString();
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: now } : entry));
      void dataService.markClinicalNoteMentionRead(item.id);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); if (!open) void load(); }}
        className={`relative rounded-xl p-2.5 transition-all ${isDark ? 'text-slate-300 hover:bg-[#122544]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        title="Menções em anotações"
        aria-label="Menções em anotações"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[#7a32fc] px-1 text-center text-[9px] font-bold leading-4 text-white">
            {Math.min(unread, 9)}{unread > 9 ? '+' : ''}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute right-0 top-12 z-[120] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-2xl ${isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
          <div className={`flex items-center justify-between border-b px-4 py-3 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
            <div>
              <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>Menções</p>
              <p className="text-[10px] text-slate-400">Anotações da equipe que pedem sua atenção</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {loading && items.length === 0 ? (
              <p className="p-5 text-center text-xs text-slate-400">Carregando...</p>
            ) : items.length === 0 ? (
              <p className="p-5 text-center text-xs text-slate-400">Nenhuma menção recente.</p>
            ) : items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openNotification(item)}
                className={`mb-1 flex w-full gap-3 rounded-xl p-3 text-left transition-colors ${isDark ? 'hover:bg-slate-800' : 'hover:bg-violet-50'} ${!item.readAt ? (isDark ? 'bg-violet-500/10' : 'bg-violet-50/60') : ''}`}
              >
                <span className="mt-0.5 rounded-lg bg-violet-100 p-2 text-[#7a32fc]"><FileText size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{item.mentionedByName || 'Profissional da equipe'} mencionou você</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-[#7a32fc]">{item.patientName || 'Paciente'}</span>
                  {item.excerpt && <span className={`mt-1 block line-clamp-2 text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{item.excerpt}</span>}
                </span>
                {!item.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#7a32fc]" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
