import React, { useEffect, useMemo, useRef, useState } from 'react';
import { dataService } from '../services/dataService';

type Receivable = {
  appointmentId: string;
  patientName: string;
  service: string;
  scheduledAt: string;
  chargeId: string | null;
  total: number;
  paid: number;
  balance: number;
};
type Part = { amount: string; method: string };
const currency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
const parseCents = (value: string) => {
  const normalized = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
};
const amountInput = (cents: number) => (Math.max(0, cents) / 100).toFixed(2).replace('.', ',');
const methods = [
  { value: 'pix', label: 'Pix' }, { value: 'card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' }, { value: 'transfer', label: 'Transferência' }
];
const operationKey = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : 'receipt-' + Date.now() + '-' + Math.random().toString(36).slice(2);

export function ProfessionalReceipts() {
  const [rows, setRows] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeId, setActiveId] = useState('');
  const [mixed, setMixed] = useState(false);
  const [parts, setParts] = useState<Part[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(operationKey());

  const reload = async () => {
    const result = await dataService.getOwnProfessionalReceivables();
    if (!result?.success) {
      setError(result?.error || 'Erro ao carregar recebimentos.');
      return;
    }
    setRows(Array.isArray(result.data) ? result.data : []);
  };
  useEffect(() => {
    let alive = true;
    dataService.getOwnProfessionalReceivables().then((result: any) => {
      if (!alive) return;
      setLoading(false);
      if (!result?.success) setError(result?.error || 'Não foi possível carregar os recebimentos.');
      else setRows(Array.isArray(result.data) ? result.data : []);
    });
    return () => { alive = false; };
  }, []);

  const active = useMemo(() => rows.find((row) => row.chargeId === activeId), [activeId, rows]);
  const select = (row: Receivable) => {
    if (!row.chargeId || row.balance <= 0) return;
    const cents = Math.round(row.balance * 100);
    setActiveId(row.chargeId);
    setParts([{ amount: amountInput(cents), method: 'pix' }]);
    setMixed(false);
    setReason('');
    setError('');
    setSuccess('');
    keyRef.current = operationKey();
  };
  const toggleMixed = (checked: boolean) => {
    setMixed(checked);
    if (!active) return;
    const cents = Math.round(active.balance * 100);
    const half = Math.floor(cents / 2);
    setParts(checked
      ? [{ amount: amountInput(half), method: 'pix' }, { amount: amountInput(cents - half), method: 'card' }]
      : [{ amount: amountInput(cents), method: 'pix' }]);
    keyRef.current = operationKey();
  };
  const submit = async () => {
    if (!active || !active.chargeId || saving) return;
    setError('');
    setSuccess('');
    const amounts = parts.map((part) => ({ cents: parseCents(part.amount), method: part.method }));
    const balance = Math.round(active.balance * 100);
    const total = amounts.reduce((sum, item) => sum + item.cents, 0);
    if (!amounts.length || amounts.some((item) => item.cents <= 0 || !methods.some((method) => method.value === item.method)) ||
      total > balance || total <= 0) {
      setError('Informe valores positivos e formas válidas, sem ultrapassar o saldo.');
      return;
    }
    if (total < balance && !reason.trim()) {
      setError('Explique por que parte da cobrança ficará em aberto.');
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      for (let i = 0; i < amounts.length; i++) {
        const item = amounts[i];
        const result = await dataService.recordOwnProfessionalReceipt(active.chargeId, {
          appointmentId: active.appointmentId,
          amount: item.cents / 100,
          method: item.method,
          notes: reason.trim() || (mixed ? 'Recebimento em formas combinadas' : ''),
          idempotencyKey: keyRef.current + ':part:' + (i + 1)
        });
        if (!result?.success) {
          setError('Parte ' + (i + 1) + ' não confirmada. ' + (result?.error || '') +
            ' Não repita sem conferir o extrato: as partes anteriores podem ter sido gravadas.');
          return;
        }
        saved += 1;
      }
      setActiveId('');
      setSuccess('Recebimento confirmado. ' + saved + ' transação(ões) registrada(s) no financeiro da clínica.');
    } finally {
      await reload();
      setSaving(false);
    }
  };
  return (
    <section className="space-y-5 p-5 sm:p-8">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">Recebimentos dos meus atendimentos</h2>
        <p className="mt-1 text-sm text-slate-600">Somente sessões concluídas de sua agenda. Não altera preços, concede descontos nem acessa o financeiro de outros profissionais.</p>
      </header>
      {loading && <p className="text-sm text-slate-600">Carregando recebimentos...</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}
      {!loading && !rows.length && <p className="rounded-xl bg-white p-5 text-sm text-slate-600">Nenhuma sessão própria concluída neste momento.</p>}
      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.appointmentId} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">{row.patientName}</p>
                <p className="text-xs text-slate-500">{row.service} · {new Date(row.scheduledAt).toLocaleString('pt-BR')}</p>
                {row.chargeId
                  ? <p className="mt-1 text-sm">Cobrado: {currency(row.total)} · Recebido: {currency(row.paid)} · Saldo: <strong>{currency(row.balance)}</strong></p>
                  : <p className="mt-1 text-xs text-amber-700">Ainda sem cobrança vinculada. A direção deve configurar ou efetivar o recebível.</p>}
              </div>
              {row.chargeId && row.balance > 0 && <button type="button" onClick={() => select(row)}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white">Registrar recebimento</button>}
            </div>
          </article>
        ))}
      </div>
      {active && <div className="rounded-xl border border-violet-200 bg-white p-5">
        <h3 className="font-semibold text-slate-800">Receber de {active.patientName} · saldo {currency(active.balance)}</h3>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={mixed} disabled={saving} onChange={(event) => toggleMixed(event.target.checked)} />
          Receber usando mais de uma forma de pagamento
        </label>
        {parts.map((part, index) => (
          <div key={index} className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-600">Valor {index + 1}
              <input value={part.amount} disabled={saving} inputMode="decimal"
                onChange={(event) => setParts((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))}
                className="mt-1 w-full rounded-lg border border-slate-200 p-3" />
            </label>
            <label className="text-xs text-slate-600">Forma
              <select value={part.method} disabled={saving}
                onChange={(event) => setParts((current) => current.map((item, i) => i === index ? { ...item, method: event.target.value } : item))}
                className="mt-1 w-full rounded-lg border border-slate-200 p-3">
                {methods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
              </select>
            </label>
          </div>
        ))}
        <p className="mt-3 text-sm font-medium text-slate-800">Total informado: {currency(parts.reduce((sum, part) => sum + parseCents(part.amount), 0) / 100)}</p>
        <label className="mt-3 block text-xs text-slate-600">Justificativa / observação (obrigatória quando o valor é menor que o saldo)
          <textarea rows={2} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 p-3" />
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={submit}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? 'Confirmando...' : 'Confirmar recebimento'}
          </button>
          <button type="button" disabled={saving} onClick={() => setActiveId('')}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-50">Cancelar</button>
        </div>
      </div>}
    </section>
  );
}
