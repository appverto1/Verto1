import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { ABA_CATALOG_METHODS, type AbaCatalogBehavior, type AbaCatalogMethod } from '../utils/abaBehaviorCatalog';

export type AbaBehaviorDraft = {
  name: string;
  operationalDefinition: string;
  defaultMeasurement: AbaCatalogMethod;
  intervalSeconds: number;
  defaultSeverity: number;
  status: 'active' | 'archived';
};

const blank = (): AbaBehaviorDraft => ({
  name: '', operationalDefinition: '', defaultMeasurement: 'frequency',
  intervalSeconds: 30, defaultSeverity: 2, status: 'active',
});
const copy = (item: AbaCatalogBehavior): AbaBehaviorDraft => ({
  name: item.name, operationalDefinition: item.operationalDefinition,
  defaultMeasurement: item.defaultMeasurement, intervalSeconds: item.intervalSeconds,
  defaultSeverity: item.defaultSeverity, status: item.status,
});
const methods: Record<AbaCatalogMethod, string> = {
  frequency: 'Frequência (contar eventos)',
  duration: 'Duração (início/fim)',
  partial_interval: 'Intervalo parcial (SIM/NÃO)',
};

export const AbaBehaviorCatalogManager = ({
  open, items, loading, error, onClose, onReload, onCreate, onUpdate, onArchive,
}: {
  open: boolean;
  items: AbaCatalogBehavior[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onReload: () => void;
  onCreate: (draft: AbaBehaviorDraft) => Promise<boolean>;
  onUpdate: (id: string, draft: AbaBehaviorDraft) => Promise<boolean>;
  onArchive: (id: string) => Promise<boolean>;
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AbaBehaviorDraft>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [archiveId, setArchiveId] = useState('');
  useEffect(() => {
    if (!open) {
      setSearch(''); setEditingId(null); setDraft(blank());
      setBusy(false); setMessage(''); setArchiveId('');
    }
  }, [open]);
  const filtered = useMemo(() => items.filter((item) =>
    (item.name + ' ' + item.operationalDefinition).toLocaleLowerCase('pt-BR')
      .includes(search.trim().toLocaleLowerCase('pt-BR'))
  ), [items, search]);

  if (!open) return null;
  const updateDraft = (patch: Partial<AbaBehaviorDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const reset = () => { setEditingId(null); setArchiveId(''); setMessage(''); };
  const save = async () => {
    if (busy) return;
    if (draft.name.trim().length < 2 || !draft.operationalDefinition.trim()) {
      setMessage('Informe um nome e uma definição operacional observável.'); return;
    }
    if (!Number.isInteger(draft.intervalSeconds) || draft.intervalSeconds < 5 || draft.intervalSeconds > 3600) {
      setMessage('O intervalo deve ter entre 5 e 3600 segundos.'); return;
    }
    setBusy(true); setMessage('');
    try {
      const confirmed = editingId
        ? await onUpdate(editingId, { ...draft, status: 'active' })
        : await onCreate({ ...draft, status: 'active' });
      if (confirmed) reset();
      else setMessage('Salvamento não confirmado. Os dados da edição foram mantidos.');
    } finally { setBusy(false); }
  };
  const archive = async () => {
    if (!archiveId || busy) return;
    setBusy(true); setMessage('');
    try {
      if (await onArchive(archiveId)) setArchiveId('');
      else setMessage('Não foi possível arquivar o comportamento.');
    } finally { setBusy(false); }
  };
  const restore = async (item: AbaCatalogBehavior) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      if (!(await onUpdate(item.id, { ...copy(item), status: 'active' }))) {
        setMessage('Não foi possível reativar o comportamento.');
      }
    } finally { setBusy(false); }
  };

  const dialog = (
    <div className="fixed inset-0 z-[245] flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4">
      <button type="button" onClick={() => { if (!busy) onClose(); }} aria-label="Fechar catálogo" className="absolute inset-0" />
      <section role="dialog" aria-modal="true" aria-labelledby="behavior-catalog-title"
        onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}
        className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-3xl">
        <header className="flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
          <div>
            <h2 id="behavior-catalog-title" className="text-lg font-semibold text-slate-900">Comportamentos interferentes</h2>
            <p className="mt-1 text-xs text-slate-500">Catálogo deste paciente · Definições observáveis, não funções presumidas</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-slate-500"><X size={20} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {(error || message) && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{message || error}</p>}
          {editingId === null ? (
            <>
              <div className="flex gap-2">
                <input aria-label="Buscar comportamentos" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar comportamento" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" />
                <button type="button" onClick={() => { setEditingId(''); setDraft(blank()); setMessage(''); }} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-violet-600 px-3 text-sm text-white"><Plus size={15} /> Novo</button>
              </div>
              {loading ? <p className="py-6 text-center text-sm">Carregando comportamentos…</p> : (
                <div className="space-y-2">
                  {filtered.map((item) => (
                    <article key={item.id} className={'rounded-xl border p-3 ' + (item.status === 'archived' ? 'bg-slate-50' : 'bg-white')}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{item.name} {item.isPreset ? <span className="text-[10px] text-violet-600">· padrão editável</span> : null}{item.status === 'archived' ? <span className="text-[10px] text-slate-500"> · arquivado</span> : null}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">{item.operationalDefinition}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{methods[item.defaultMeasurement]} · Intervalo parcial disponível · Grau {item.defaultSeverity}</p>
                        </div>
                        <div className="flex gap-1">
                          <button type="button" disabled={busy} onClick={() => { setEditingId(item.id); setDraft(copy(item)); setMessage(''); }} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs"><Pencil size={13} /> Editar</button>
                          {item.status === 'archived' ? (
                            <button type="button" disabled={busy} onClick={() => void restore(item)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs text-violet-700"><RotateCcw size={13} /> Reativar</button>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => setArchiveId(item.id)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs text-rose-700"><Archive size={13} /> Arquivar</button>
                          )}
                        </div>
                      </div>
                      {archiveId === item.id && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-2 text-xs">
                          <span>Ocultar dos próximos registros? O histórico será preservado.</span>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setArchiveId('')} disabled={busy}>Cancelar</button>
                            <button type="button" onClick={() => void archive()} disabled={busy} className="rounded-lg bg-rose-600 px-2 py-2 text-white">Confirmar</button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                  {!filtered.length && !loading && (
                    <button type="button" onClick={onReload} className="rounded-lg border px-3 py-2 text-xs text-violet-700">Nenhum resultado · Recarregar catálogo</button>
                  )}
                </div>
              )}
            </>
          ) : (
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <h3 className="text-sm font-semibold">{editingId ? 'Editar comportamento' : 'Novo comportamento'}</h3>
              <label className="block text-xs font-medium">
                Nome
                <input required minLength={2} maxLength={100} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Ex.: Grito" className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" />
              </label>
              <label className="block text-xs font-medium">
                Definição operacional individualizada
                <textarea required maxLength={1200} rows={4} value={draft.operationalDefinition} onChange={(event) => updateDraft({ operationalDefinition: event.target.value })} placeholder="Descreva a resposta observável, início e fim quando aplicável." className="mt-1 w-full rounded-xl border p-3 text-sm" />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium">Método padrão
                  <select value={draft.defaultMeasurement} onChange={(event) => updateDraft({ defaultMeasurement: event.target.value as AbaCatalogMethod })} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm">
                    {ABA_CATALOG_METHODS.map((method) => <option key={method} value={method}>{methods[method]}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium">Intervalo parcial · segundos
                  <input type="number" min={5} max={3600} step={1} value={draft.intervalSeconds} onChange={(event) => updateDraft({ intervalSeconds: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm" />
                </label>
                <label className="text-xs font-medium">Severidade inicial (1–5)
                  <select value={draft.defaultSeverity} onChange={(event) => updateDraft({ defaultSeverity: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border px-3 text-sm">
                    {[1, 2, 3, 4, 5].map((degree) => <option key={degree} value={degree}>{degree}</option>)}
                  </select>
                </label>
              </div>
              <p className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">O intervalo parcial está disponível para todos. Sua medida é a porcentagem de intervalos com ocorrência, não uma contagem ou duração direta.</p>
              <div className="flex justify-end gap-2 border-t pt-3">
                <button type="button" onClick={reset} disabled={busy} className="min-h-11 rounded-xl border px-4 text-sm">Cancelar</button>
                <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Salvando…' : 'Salvar comportamento'}</button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
};
