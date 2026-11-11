import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';

type Partner = {
  id: string;
  display_name: string;
  contact_email: string | null;
  partner_kind: 'professional' | 'external';
  referral_code: string;
  referral_alias?: string | null;
  status: 'pending' | 'approved' | 'suspended';
  compliance_approved: boolean;
  created_at: string;
};
type Opportunity={id:string;status:string;agreed_monthly_cents:number|null;
  created_at:string;clinic:{name:string}|null;partner:{display_name:string}|null};
const brl=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
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
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [confirmCompliance, setConfirmCompliance] = useState<Record<string, boolean>>({});
  const [couponDraft, setCouponDraft] = useState<Record<string, string>>({});
  const [couponAttempted, setCouponAttempted] = useState<Record<string, boolean>>({});

  const reload = useCallback(async () => {
    setError('');
    try {
      const [result, marketplace] = await Promise.all([
        request('/api/owner/partnerships/accounts'),
        request('/api/owner/partnerships/marketplace').catch(() => null)
      ]);
      setAccounts(Array.isArray(result.accounts) ? result.accounts : []);
      setOpportunities(Array.isArray(marketplace?.leads) ? marketplace.leads : []);
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
  const saveCoupon = async (item: Partner) => {
    if (busy || item.referral_alias || item.status !== 'approved') return;
    const couponCode = (couponDraft[item.id] || '').trim().toUpperCase();
    setCouponAttempted(prev => ({ ...prev, [item.id]: true }));
    if (!/^[A-Z0-9]{4,24}$/.test(couponCode))return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request('/api/owner/partnerships/accounts/' + encodeURIComponent(item.id) + '/referral-alias', {
        method: 'PATCH', ...asJson({ couponCode })
      });
      // The server-confirmed save updates local state; no extra account/marketplace GET.
      setAccounts(prev => prev.map(account => account.id === item.id
        ? { ...account, referral_alias: result.couponCode } : account));
      setMessage('Cupom salvo.');
    } catch (e: any) {
      const code = String(e?.message || '');
      setError(code === 'REFERRAL_COUPON_TAKEN' ? 'Este cupom já está em uso. Escolha outro.'
        : code === 'REFERRAL_COUPON_LOCKED' ? 'Este parceiro já possui um cupom definitivo.'
        : 'Não foi possível salvar o cupom.');
    } finally { setBusy(false); }
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
                onClick={() => void navigator.clipboard.writeText(item.referral_alias || item.referral_code)}>
                <Copy size={13}/>{item.referral_alias || item.referral_code}
              </button>}
              {item.status === 'approved' && !item.referral_alias && <div className="mt-3 space-y-1.5">
                <label htmlFor={'partner-owner-coupon-' + item.id} className="block text-xs font-medium text-slate-600">
                  Cupom personalizado (opcional)
                </label>
                <div className="flex flex-wrap gap-2">
                  <input id={'partner-owner-coupon-' + item.id} type="text" maxLength={64}
                    autoComplete="off" placeholder="Ex.: FRATELLI10"
                    value={couponDraft[item.id] || ''}
                    onChange={e => { setCouponDraft(prev => ({ ...prev, [item.id]: e.target.value })); setCouponAttempted(prev => ({ ...prev, [item.id]: false })); }}
                    aria-invalid={!!((couponDraft[item.id] || couponAttempted[item.id]) && !/^[A-Z0-9]{4,24}$/.test((couponDraft[item.id] || '').trim().toUpperCase()))}
                    aria-describedby={'partner-owner-coupon-error-' + item.id}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs uppercase" />
                  <button type="button" disabled={busy} onClick={() => { void saveCoupon(item); }}
                    className="rounded-lg border border-violet-300 px-3 py-2 text-xs font-semibold text-violet-700 disabled:opacity-50">
                    Salvar cupom
                  </button>
                </div>
                {(couponDraft[item.id] || couponAttempted[item.id]) && !/^[A-Z0-9]{4,24}$/.test((couponDraft[item.id] || '').trim().toUpperCase()) &&
                  <p id={'partner-owner-coupon-error-' + item.id} role="alert" className="text-xs text-rose-600">Use de 4 a 24 letras ou números juntos, sem espaços, hífens ou símbolos. Ex.: FRATELLI10.</p>}
                <p className="text-xs text-slate-500">O interessado poderá informar o cupom em “Quem te indicou?”. O cupom não poderá ser alterado após salvar.</p>
              </div>}
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
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">Negócios indicados pela Verto aos parceiros</h3>
      <p className="text-sm text-slate-600">Oportunidades rastreadas, separadas das indicações para assinatura da Verto. Valores abaixo são projeções comerciais, não comissões devidas nem pagamentos confirmados.</p>
      <div className="flex flex-wrap gap-5 text-sm text-slate-700">
        <span><strong>{opportunities.length}</strong> oportunidades exibidas</span>
        <span><strong>{opportunities.filter(o=>o.status==='active').length}</strong> contratações declaradas e confirmadas</span>
        <span><strong>{brl(opportunities.filter(o=>o.status==='active').reduce((sum,o)=>sum+Math.round(Number(o.agreed_monthly_cents||0)*0.1)*6,0))}</strong> potencial de 6 meses*</span>
      </div>
      {opportunities.length===0 ? <p className="text-sm text-slate-500">Ainda não há encaminhamentos cadastrados.</p>
       : <ul className="divide-y divide-slate-100">
          {opportunities.map(o=><li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div>
              <p className="font-medium text-slate-900">{o.clinic?.name||'Clínica'} → {o.partner?.display_name||'Parceiro'}</p>
              <p className="text-xs text-slate-500">{o.status==='active'?'Contratação confirmada':o.status==='awaiting_clinic'?'Aguardando a clínica':'Interesse recebido'}</p>
            </div>
            {o.status==='active'&&o.agreed_monthly_cents!=null&&<span className="text-xs font-medium text-slate-700">{brl(Number(o.agreed_monthly_cents))}/mês declarado</span>}
          </li>)}
        </ul>}
      <p className="text-xs text-slate-500">*Projeção hipotética de 10% da mensalidade de serviço por 6 meses. Não contempla pagamentos verificados, cancelamentos, contrato ou compensações. Nenhuma cobrança é iniciada por esta tela.</p>
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
