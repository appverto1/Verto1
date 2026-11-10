import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';

type Partner = {
  id: string;
  display_name: string;
  contact_email: string | null;
  partner_kind: 'professional' | 'external';
  referral_code: string;
  status: 'pending' | 'approved' | 'suspended';
  compliance_approved: boolean;
  created_at: string;
};
const statusLabel: Record<Partner['status'], string> = {
  pending: 'Em análise', approved: 'Aprovado', suspended: 'Suspenso'
};
async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) throw new Error(data.error || 'Serviço temporariamente indisponível.');
  return data;
}
const asJson = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function OwnerPartnershipsPanel() {
  const [accounts, setAccounts] = useState<Partner[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [confirmCompliance, setConfirmCompliance] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setError('');
    try {
      const result = await request('/api/owner/partnerships/accounts');
      setAccounts(Array.isArray(result.accounts) ? result.accounts : []);
    } catch (e: any) { setError(e.message || 'Não foi possível consultar parceiros.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const mutate = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const responseMessage = await fn();
      await reload();
      setMessage(responseMessage);
    } catch (e: any) { setError(e.message || 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await mutate(async () => {
      await request('/api/owner/partnerships/accounts', {
        method: 'POST', ...asJson({ displayName: name.trim(), contactEmail: email.trim().toLowerCase() })
      });
      setName(''); setEmail('');
      return 'Parceiro externo cadastrado. A aprovação é uma ação separada.';
    });
  };
  const setStatus = async (item: Partner, status: Partner['status']) => {
    await mutate(async () => {
      await request('/api/owner/partnerships/accounts/' + encodeURIComponent(item.id), {
        method: 'PATCH',
        ...asJson({ status, complianceApproved: status === 'approved' })
      });
      setConfirmCompliance(prev => ({ ...prev, [item.id]: false }));
      return status === 'approved' ? 'Parceiro aprovado.' : 'Status atualizado.';
    });
  };
  const attach = async (e: React.FormEvent) => {
    e.preventDefault();
    await mutate(async () => {
      await request('/api/owner/partnerships/referrals', {
        method: 'POST', ...asJson({ partnerId: selectedId, leadId: leadId.trim() })
      });
      setLeadId('');
      return 'Indicação vinculada ao lead com confirmação do banco.';
    });
  };
  return <section className="space-y-5" aria-label="Gestão de parcerias">
    <div>
      <h2 className="text-xl font-bold text-slate-900">Programa de Parcerias</h2>
      <p className="mt-1 text-sm text-slate-600">
        Indicação comercial de novas clínicas. Comissão potencial de 10% por até 12 meses, sujeita à revisão jurídica e financeira.
        Aprovação não autoriza repasse automático.
      </p>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">{message}</p>}
    <form onSubmit={create} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-[1fr_1fr_auto]">
      <div>
        <label htmlFor="partner-name" className="mb-1 block text-sm font-medium">Nome do parceiro externo</label>
        <input id="partner-name" required minLength={2} maxLength={180} value={name} onChange={e => setName(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
      </div>
      <div>
        <label htmlFor="partner-email" className="mb-1 block text-sm font-medium">E-mail de acesso</label>
        <input id="partner-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
      </div>
      <button disabled={busy} type="submit" className="self-end rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        <UserPlus size={16} className="mr-2 inline" /> Cadastrar
      </button>
    </form>
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Solicitações e parceiros</h3>
        <button type="button" onClick={() => { setLoading(true); void reload(); }}
          aria-label="Atualizar lista" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><RefreshCw size={18}/></button>
      </div>
      {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={16}/>Carregando...</p>
      : accounts.length === 0 ? <p className="text-sm text-slate-500">Nenhum parceiro cadastrado.</p>
      : <ul className="divide-y divide-slate-100">
        {accounts.map(item => <li key={item.id} className="space-y-3 py-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{item.display_name}</p>
              <p className="text-xs text-slate-500">{item.partner_kind === 'professional' ? 'Profissional' : 'Externo'} · {item.contact_email || 'E-mail não informado'} · {statusLabel[item.status]}</p>
              {item.status === 'approved' && <button type="button"
                title="Copiar código de indicação" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700"
                onClick={() => void navigator.clipboard.writeText(item.referral_code)}>
                <Copy size={13}/>{item.referral_code}
              </button>}
            </div>
            <div className="flex items-center gap-2">
              {item.status !== 'approved' && <div className="space-y-2">
                <label className="flex max-w-xs items-start gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={!!confirmCompliance[item.id]}
                    onChange={e => setConfirmCompliance(prev => ({ ...prev, [item.id]: e.target.checked }))}
                    className="mt-0.5" />
                  Confirmo a revisão comercial e jurídica da elegibilidade.
                </label>
                <button type="button" disabled={busy || !confirmCompliance[item.id]} onClick={() => void setStatus(item, 'approved')}
                  className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  <ShieldCheck size={14} className="mr-1 inline"/>Aprovar
                </button>
              </div>}
              {item.status === 'approved' && <button type="button" disabled={busy} onClick={() => void setStatus(item, 'suspended')}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-50">Suspender</button>}
              {item.status === 'suspended' && <button type="button" disabled={busy} onClick={() => void setStatus(item, 'pending')}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-50">Reabrir análise</button>}
            </div>
          </div>
        </li>)}
      </ul>}
      <p className="mt-3 text-xs text-slate-500">Exibição limitada aos 100 parceiros mais recentes. Nenhum valor de paciente é exibido.</p>
    </div>
    <form onSubmit={attach} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">Vincular indicação comercial existente</h3>
      <p className="text-xs text-slate-500">Apenas leads elegíveis, sem pagamento anterior e sem atribuição a outro parceiro. O banco valida a operação.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="attach-partner">Parceiro aprovado</label>
          <select id="attach-partner" required value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
            <option value="">Selecione...</option>
            {accounts.filter(a => a.status === 'approved' && a.compliance_approved).map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="attach-lead">ID do lead comercial</label>
          <input id="attach-lead" required value={leadId} onChange={e => setLeadId(e.target.value)}
            placeholder="UUID do lead" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
        </div>
      </div>
      <button type="submit" disabled={busy || !selectedId || !leadId.trim()} className="rounded-xl border border-violet-300 px-4 py-2.5 text-sm font-semibold text-violet-800 disabled:opacity-40">
        <CheckCircle2 size={15} className="mr-1.5 inline"/> Confirmar vinculação
      </button>
    </form>
  </section>;
}
