import React, { useMemo, useState } from 'react';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Repeat2,
  X,
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { formatDisplayDate } from '../utils/dateFormatting';
import { PATIENT_FINANCIAL_SERVICE_OPTIONS } from '../utils/patientFinancialPlan';
import {
  clinicExpenseActualAmount,
  clinicExpenseCompetenceKey,
  clinicExpenseExpectedAmount,
  resolveClinicExpenseSemanticStatus,
} from '../utils/clinicFinanceReadModel';

type Props = {
  month: string;
  entries: any[];
  rules: any[];
  schemaReady: boolean;
  canManage: boolean;
  loading?: boolean;
  onChanged: () => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
};

type EditorMode =
  | 'new'
  | 'edit-entry'
  | 'pay-entry'
  | 'edit-rule'
  | 'end-rule'
  | null;

const currency = (value: any) =>
  (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const monthLabel = (month: string) => {
  const [year, monthNumber] = String(month || '').split('-').map(Number);
  if (!year || !monthNumber) return 'Competência';
  const text = new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const nextMonthStart = (month: string) => {
  const [year, monthNumber] = String(month || '').split('-').map(Number);
  const date = year && monthNumber ? new Date(Date.UTC(year, monthNumber, 1)) : new Date();
  if (!year || !monthNumber) date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
};

const monthEnd = (month: string) => {
  const [year, monthNumber] = String(month || '').split('-').map(Number);
  const date = year && monthNumber
    ? new Date(Date.UTC(year, monthNumber, 0))
    : new Date();
  return date.toISOString().slice(0, 10);
};

const statusMeta = (entry: any) => {
  const status = resolveClinicExpenseSemanticStatus(entry);
  if (status === 'paid') return { label: 'Pago/realizado', className: 'bg-emerald-50 text-emerald-700' };
  if (status === 'overdue') return { label: 'Vencido', className: 'bg-rose-50 text-rose-700' };
  if (status === 'canceled') return { label: 'Cancelado', className: 'bg-slate-100 text-slate-500' };
  return { label: 'A vencer', className: 'bg-amber-50 text-amber-700' };
};

const emptyForm = (month: string) => ({
  expenseType: 'one_off',
  name: '',
  amount: '',
  dueDate: `${month || new Date().toISOString().slice(0, 7)}-01`,
  recurrence: 'monthly',
  dueDay: '10',
  startsOn: `${month || new Date().toISOString().slice(0, 7)}-01`,
  effectiveFrom: nextMonthStart(month),
  paidOn: new Date().toISOString().slice(0, 10),
  category: 'operacional',
  specialty: '',
  notes: '',
});

export default function ClinicExpenseManager({
  month,
  entries,
  rules,
  schemaReady,
  canManage,
  loading = false,
  onChanged,
  onToast,
}: Props) {
  const [mode, setMode] = useState<EditorMode>(null);
  const [target, setTarget] = useState<any>(null);
  const [form, setForm] = useState<any>(() => emptyForm(month));
  const [saving, setSaving] = useState(false);

  const selectedEntries = useMemo(
    () => [...(entries || [])]
      .filter((entry: any) =>
        String(entry?.entry_type || 'expense').toLowerCase() === 'expense' &&
        clinicExpenseCompetenceKey(entry) === month,
      )
      .sort((a: any, b: any) => String(a?.due_date || a?.occurred_on || '').localeCompare(String(b?.due_date || b?.occurred_on || ''))),
    [entries, month],
  );

  const latestRules = useMemo(() => {
    const grouped = new Map<string, any>();
    (rules || []).forEach((rule: any) => {
      const key = String(rule?.logical_id || rule?.id || '');
      const current = grouped.get(key);
      if (!current || Number(rule?.version || 1) > Number(current?.version || 1)) grouped.set(key, rule);
    });
    return Array.from(grouped.values()).sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR'));
  }, [rules]);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    onToast?.(message, type);
  };

  const closeEditor = () => {
    if (saving) return;
    setMode(null);
    setTarget(null);
    setForm(emptyForm(month));
  };

  const openNew = () => {
    setTarget(null);
    setForm(emptyForm(month));
    setMode('new');
  };

  const openEditEntry = (entry: any) => {
    setTarget(entry);
    setForm({
      ...emptyForm(month),
      name: entry?.description || '',
      amount: String(entry?.amount ?? ''),
      dueDate: String(entry?.due_date || entry?.occurred_on || '').slice(0, 10),
      category: entry?.category || 'operacional',
      specialty: entry?.specialty || '',
      notes: entry?.notes || '',
    });
    setMode('edit-entry');
  };

  const openPayEntry = (entry: any) => {
    setTarget(entry);
    setForm({
      ...emptyForm(month),
      name: entry?.description || '',
      amount: String(entry?.amount ?? entry?.expected_amount ?? ''),
      paidOn: new Date().toISOString().slice(0, 10),
    });
    setMode('pay-entry');
  };

  const openEditRule = (rule: any) => {
    setTarget(rule);
    setForm({
      ...emptyForm(month),
      name: rule?.name || '',
      amount: String(rule?.amount ?? ''),
      recurrence: rule?.recurrence || 'monthly',
      dueDay: String(rule?.due_day || '10'),
      effectiveFrom: nextMonthStart(month),
      category: rule?.category || 'operacional',
      specialty: rule?.specialty || '',
      notes: rule?.notes || '',
    });
    setMode('edit-rule');
  };

  const openEndRule = (rule: any) => {
    setTarget(rule);
    setForm({ ...emptyForm(month), effectiveFrom: monthEnd(month) });
    setMode('end-rule');
  };

  const runMutation = async (action: () => Promise<any>, successMessage: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await action();
      if (!result?.success) {
        notify(result?.error || 'Não foi possível concluir a operação.', 'error');
        return;
      }
      notify(successMessage, 'success');
      setMode(null);
      setTarget(null);
      setForm(emptyForm(month));
      onChanged();
    } catch (error: any) {
      notify(error?.message || 'Não foi possível concluir a operação.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!mode) return;
    if (mode === 'new') {
      const amount = Number(String(form.amount || '').replace(',', '.'));
      if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0) {
        notify('Informe descrição e valor válidos.', 'error');
        return;
      }
      if (form.expenseType === 'recurring') {
        await runMutation(
          () => dataService.createClinicExpenseRule({
            name: form.name,
            amount,
            recurrence: form.recurrence,
            starts_on: form.startsOn,
            due_day: form.recurrence === 'monthly' ? Number(form.dueDay) : undefined,
            category: form.category,
            specialty: form.specialty || null,
            notes: form.notes || null,
          }),
          'Despesa recorrente cadastrada.',
        );
      } else {
        await runMutation(
          () => dataService.createClinicExpense({
            description: form.name,
            amount,
            due_date: form.dueDate,
            category: form.category,
            specialty: form.specialty || null,
            notes: form.notes || null,
          }),
          'Despesa pontual cadastrada.',
        );
      }
      return;
    }

    if (mode === 'edit-entry') {
      const amount = Number(String(form.amount || '').replace(',', '.'));
      await runMutation(
        () => dataService.updateClinicExpense(target.id, {
          description: form.name,
          amount,
          due_date: form.dueDate,
          category: form.category,
          specialty: form.specialty || null,
          notes: form.notes || null,
        }),
        'Ocorrência atualizada.',
      );
      return;
    }

    if (mode === 'pay-entry') {
      const amount = Number(String(form.amount || '').replace(',', '.'));
      await runMutation(
        () => dataService.markClinicExpensePaid(target.id, { amount, paid_on: form.paidOn }),
        'Pagamento da despesa registrado.',
      );
      return;
    }

    if (mode === 'edit-rule') {
      const amount = Number(String(form.amount || '').replace(',', '.'));
      await runMutation(
        () => dataService.updateClinicExpenseRule(target.id, {
          effective_from: form.effectiveFrom,
          name: form.name,
          amount,
          due_day: target?.recurrence === 'monthly' ? Number(form.dueDay) : undefined,
          category: form.category,
          specialty: form.specialty || null,
          notes: form.notes || null,
        }),
        'Regra futura atualizada sem reescrever o histórico.',
      );
      return;
    }

    if (mode === 'end-rule') {
      await runMutation(
        () => dataService.endClinicExpenseRule(target.id, { end_on: form.effectiveFrom }),
        'Recorrência encerrada; histórico preservado.',
      );
    }
  };

  const cancelEntry = async (entry: any) => {
    if (!window.confirm(`Cancelar a despesa “${entry?.description || 'selecionada'}”? O histórico não será apagado.`)) return;
    await runMutation(() => dataService.cancelClinicExpense(entry.id), 'Despesa cancelada sem apagar o histórico.');
  };

  const inputClass = 'mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
  const labelClass = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500';

  return (
    <div data-clinic-expense-manager className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Despesas operacionais · {monthLabel(month)}</p>
          <p className="mt-1 text-xs text-slate-500">Pontuais e recorrentes usam o mesmo histórico financeiro; repasses profissionais permanecem separados.</p>
        </div>
        {canManage && schemaReady && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/15 transition hover:bg-[#6d28e8]"
          >
            <Plus size={16} /> Nova despesa
          </button>
        )}
      </div>

      {!schemaReady && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          A leitura legada continua disponível, mas o CRUD histórico de despesas requer a migration de gestão de despesas antes de liberar gravações.
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center gap-2 rounded-2xl bg-slate-50 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Carregando despesas…
        </div>
      ) : (
        <>
          <div className="grid gap-3 xl:grid-cols-2">
            {selectedEntries.map((entry: any) => {
              const status = statusMeta(entry);
              const semanticStatus = resolveClinicExpenseSemanticStatus(entry);
              const expected = clinicExpenseExpectedAmount(entry);
              const actual = clinicExpenseActualAmount(entry);
              const isRecurring = Boolean(entry?.recurring_cost_id);
              return (
                <article key={entry.id} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Receipt size={15} className="text-violet-500" />
                        <p className="truncate text-sm font-semibold text-slate-900">{entry?.description || 'Despesa'}</p>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {isRecurring ? 'Recorrente' : 'Pontual'} · {entry?.category || 'Operacional'}
                        {entry?.specialty ? ` · ${entry.specialty}` : ' · Geral/não alocada'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Vencimento {formatDisplayDate(entry?.due_date || entry?.occurred_on)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-slate-900">{currency(actual)}</p>
                      {expected !== actual && (
                        <p className="mt-1 text-[10px] text-slate-500">Previsto {currency(expected)}</p>
                      )}
                    </div>
                  </div>
                  {entry?.notes && <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{entry.notes}</p>}
                  {canManage && schemaReady && semanticStatus !== 'paid' && semanticStatus !== 'canceled' && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <button type="button" onClick={() => openEditEntry(entry)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Pencil size={13} /> Editar ocorrência</button>
                      <button type="button" onClick={() => openPayEntry(entry)} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"><CheckCircle2 size={13} /> Marcar paga</button>
                      <button type="button" onClick={() => void cancelEntry(entry)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"><Ban size={13} /> Cancelar</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!selectedEntries.length && (
            <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Nenhuma despesa operacional encontrada nesta competência.</div>
          )}

          <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Repeat2 size={16} className="text-violet-500" />
              <h5 className="text-sm font-semibold text-slate-900">Regras recorrentes</h5>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {latestRules.map((rule: any) => (
                <div key={rule.id} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{rule?.name || 'Recorrência'}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {rule?.recurrence === 'weekly' ? 'Recorrente semanal' : 'Recorrente mensal'} · Previsto {currency(rule?.amount)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {rule?.recurrence === 'monthly' ? `Vence dia ${String(rule?.due_day || '').padStart(2, '0')}` : `Início ${formatDisplayDate(rule?.starts_on)}`}
                        {rule?.specialty ? ` · ${rule.specialty}` : ' · Geral/não alocada'}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${rule?.active === false ? 'bg-slate-100 text-slate-500' : 'bg-violet-50 text-violet-700'}`}>
                      {rule?.active === false ? 'Encerrada/versão histórica' : `Ativa · v${rule?.version || 1}`}
                    </span>
                  </div>
                  {canManage && schemaReady && rule?.active !== false && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <button type="button" onClick={() => openEditRule(rule)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"><Pencil size={13} /> Alterar futuro</button>
                      <button type="button" onClick={() => openEndRule(rule)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 px-3 py-2 text-xs font-semibold text-rose-700"><Ban size={13} /> Encerrar</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!latestRules.length && <p className="text-xs text-slate-500">Nenhuma regra recorrente nesta competência.</p>}
          </div>
        </>
      )}

      {mode && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-semibold text-slate-900">
                  {mode === 'new' && 'Nova despesa'}
                  {mode === 'edit-entry' && 'Editar ocorrência'}
                  {mode === 'pay-entry' && 'Registrar pagamento'}
                  {mode === 'edit-rule' && 'Alterar recorrência futura'}
                  {mode === 'end-rule' && 'Encerrar recorrência'}
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  {mode === 'edit-rule' ? 'A alteração cria uma nova versão e não reescreve competências realizadas.' : mode === 'end-rule' ? 'Competências históricas permanecem intactas.' : 'Despesa operacional da clínica, separada de repasses profissionais.'}
                </p>
              </div>
              <button type="button" onClick={closeEditor} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="Fechar"><X size={18} /></button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {mode === 'new' && (
                <div className="sm:col-span-2">
                  <span className={labelClass}>Tipo</span>
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-1.5">
                    {[['one_off', 'Pontual'], ['recurring', 'Recorrente']].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setForm((prev: any) => ({ ...prev, expenseType: value }))} className={`rounded-xl px-3 py-2 text-sm font-semibold ${form.expenseType === value ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>{label}</button>
                    ))}
                  </div>
                </div>
              )}

              {mode !== 'pay-entry' && mode !== 'end-rule' && (
                <label className="sm:col-span-2">
                  <span className={labelClass}>Descrição</span>
                  <input className={inputClass} value={form.name} maxLength={160} onChange={(event) => setForm((prev: any) => ({ ...prev, name: event.target.value }))} placeholder="Ex.: Energia elétrica" />
                </label>
              )}

              {mode !== 'end-rule' && (
                <label>
                  <span className={labelClass}>{mode === 'pay-entry' ? 'Valor realizado' : mode === 'edit-entry' && target?.recurring_cost_id ? 'Valor desta competência' : 'Valor previsto'}</span>
                  <input className={inputClass} inputMode="decimal" value={form.amount} onChange={(event) => setForm((prev: any) => ({ ...prev, amount: event.target.value }))} placeholder="0,00" />
                </label>
              )}

              {mode === 'new' && form.expenseType === 'one_off' && (
                <label>
                  <span className={labelClass}>Vencimento</span>
                  <input type="date" className={inputClass} value={form.dueDate} onChange={(event) => setForm((prev: any) => ({ ...prev, dueDate: event.target.value }))} />
                </label>
              )}

              {mode === 'new' && form.expenseType === 'recurring' && (
                <>
                  <label>
                    <span className={labelClass}>Recorrência</span>
                    <select className={inputClass} value={form.recurrence} onChange={(event) => setForm((prev: any) => ({ ...prev, recurrence: event.target.value }))}>
                      <option value="monthly">Mensal</option>
                      <option value="weekly">Semanal</option>
                    </select>
                  </label>
                  <label>
                    <span className={labelClass}>Início</span>
                    <input type="date" className={inputClass} value={form.startsOn} onChange={(event) => setForm((prev: any) => ({ ...prev, startsOn: event.target.value }))} />
                  </label>
                  {form.recurrence === 'monthly' && (
                    <label>
                      <span className={labelClass}>Dia de vencimento</span>
                      <input type="number" min="1" max="31" className={inputClass} value={form.dueDay} onChange={(event) => setForm((prev: any) => ({ ...prev, dueDay: event.target.value }))} />
                    </label>
                  )}
                </>
              )}

              {mode === 'edit-entry' && (
                <label>
                  <span className={labelClass}>Vencimento</span>
                  <input type="date" className={inputClass} value={form.dueDate} onChange={(event) => setForm((prev: any) => ({ ...prev, dueDate: event.target.value }))} />
                </label>
              )}

              {mode === 'pay-entry' && (
                <label>
                  <span className={labelClass}>Pago em</span>
                  <input type="date" className={inputClass} value={form.paidOn} onChange={(event) => setForm((prev: any) => ({ ...prev, paidOn: event.target.value }))} />
                </label>
              )}

              {mode === 'edit-rule' && (
                <>
                  <label>
                    <span className={labelClass}>Válido a partir de</span>
                    <input type="date" className={inputClass} value={form.effectiveFrom} onChange={(event) => setForm((prev: any) => ({ ...prev, effectiveFrom: event.target.value }))} />
                    {target?.recurrence === 'monthly' && <span className="mt-1 block text-[10px] text-slate-400">Para recorrência mensal, use o primeiro dia da competência futura.</span>}
                  </label>
                  {target?.recurrence === 'monthly' && (
                    <label>
                      <span className={labelClass}>Novo dia de vencimento</span>
                      <input type="number" min="1" max="31" className={inputClass} value={form.dueDay} onChange={(event) => setForm((prev: any) => ({ ...prev, dueDay: event.target.value }))} />
                    </label>
                  )}
                </>
              )}

              {mode === 'end-rule' && (
                <label className="sm:col-span-2">
                  <span className={labelClass}>Encerrar em</span>
                  <input type="date" className={inputClass} value={form.effectiveFrom} onChange={(event) => setForm((prev: any) => ({ ...prev, effectiveFrom: event.target.value }))} />
                </label>
              )}

              {mode !== 'pay-entry' && mode !== 'end-rule' && (
                <>
                  <label>
                    <span className={labelClass}>Categoria</span>
                    <input className={inputClass} value={form.category} maxLength={80} onChange={(event) => setForm((prev: any) => ({ ...prev, category: event.target.value }))} placeholder="Operacional" />
                  </label>
                  <label>
                    <span className={labelClass}>Especialidade (opcional)</span>
                    <select className={inputClass} value={form.specialty} onChange={(event) => setForm((prev: any) => ({ ...prev, specialty: event.target.value }))}>
                      <option value="">Geral / não alocada</option>
                      {PATIENT_FINANCIAL_SERVICE_OPTIONS.map((option) => <option key={option.value} value={option.label}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="sm:col-span-2">
                    <span className={labelClass}>Observação</span>
                    <textarea className={`${inputClass} min-h-[88px] resize-y`} value={form.notes} maxLength={1200} onChange={(event) => setForm((prev: any) => ({ ...prev, notes: event.target.value }))} />
                  </label>
                </>
              )}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeEditor} disabled={saving} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : mode === 'pay-entry' ? <CheckCircle2 size={16} /> : mode === 'end-rule' ? <CalendarClock size={16} /> : <Receipt size={16} />}
                {saving ? 'Salvando…' : mode === 'pay-entry' ? 'Registrar pagamento' : mode === 'end-rule' ? 'Encerrar recorrência' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
