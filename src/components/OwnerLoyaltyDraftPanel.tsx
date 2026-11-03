import React, { useEffect, useState } from 'react';
import { FileCheck2, Loader2, ShieldAlert } from 'lucide-react';
import { getSupabase } from '../lib/supabase';

type Draft = {
  id: string;
  status: 'draft' | 'offered' | 'accepted';
  effectiveStartDate?: string;
  effectiveEndDate?: string;
  effective_start_date?: string;
  effective_end_date?: string;
  accepted_at?: string;
};
type ClinicRow = { organizationId: string; clinicName: string; draft: Draft | null };
type Offer = {
  vertoLegalName: string; vertoCnpj: string; vertoAddress: string;
  clinicLegalName: string; clinicCnpj: string; clinicAddress: string;
  benefitDescription: string; benefitValueReais: string; benefitConditions: string;
  monthlyReferenceReais: string; startDate: string;
};
const emptyOffer: Offer = {
  vertoLegalName:'', vertoCnpj:'', vertoAddress:'',
  clinicLegalName:'', clinicCnpj:'', clinicAddress:'',
  benefitDescription:'', benefitValueReais:'', benefitConditions:'',
  monthlyReferenceReais:'', startDate:'',
};
const fields: Array<{ key:keyof Offer; label:string; kind?:string }> = [
  {key:'vertoLegalName',label:'Razão social da Verto'},
  {key:'vertoCnpj',label:'CNPJ da Verto'},
  {key:'vertoAddress',label:'Endereço contratual da Verto'},
  {key:'clinicLegalName',label:'Razão social da clínica'},
  {key:'clinicCnpj',label:'CNPJ da clínica'},
  {key:'clinicAddress',label:'Endereço contratual da clínica'},
  {key:'benefitDescription',label:'Benefício comercial concedido'},
  {key:'benefitValueReais',label:'Valor econômico do benefício (R$)',kind:'number'},
  {key:'benefitConditions',label:'Condições da concessão do benefício'},
  {key:'monthlyReferenceReais',label:'Mensalidade fixa de referência (R$)',kind:'number'},
  {key:'startDate',label:'Início de vigência (não retroativo)',kind:'date'},
];
export function OwnerLoyaltyDraftPanel() {
  const [rows, setRows] = useState<ClinicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer>({...emptyOffer});
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  const authHeaders = async (): Promise<Record<string, string>> => {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
    return { Authorization: `Bearer ${session.access_token}` };
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/owner/loyalty/drafts', {
          credentials:'include',cache:'no-store',headers:await authHeaders(),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success !== true || !Array.isArray(payload.data)) {
          throw new Error('Contratos de fidelidade indisponíveis neste ambiente.');
        }
        if (active) setRows(payload.data);
      } catch (cause:any) {
        if (active) setError(cause?.message || 'Não foi possível consultar a fidelidade.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const createDraft = async (organizationId:string) => {
    if (busyId) return;
    setBusyId(organizationId);
    setError('');
    try {
      const response = await fetch('/api/owner/loyalty/drafts', {
        method:'POST',credentials:'include',headers:{...(await authHeaders()),'Content-Type':'application/json'},
        body:JSON.stringify({organizationId}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true || !payload?.data?.id) {
        throw new Error('Não foi possível preparar o contrato. Verifique a assinatura paga.');
      }
      setRows((current) => current.map((row) =>
        row.organizationId === organizationId ? {...row,draft:payload.data} : row));
    } catch (cause:any) { setError(cause?.message || 'Erro ao preparar contrato.'); }
    finally { setBusyId(null); }
  };

  const publish = async (organizationId:string) => {
    if (busyId || !acknowledged) return;
    const moneyToCents = (amount:string) => Math.round(Number(amount) * 100);
    const value = moneyToCents(offer.benefitValueReais);
    const monthly = moneyToCents(offer.monthlyReferenceReais);
    if (!fields.every((field) => String(offer[field.key] || '').trim())
      || !Number.isSafeInteger(value) || value <= 0
      || !Number.isSafeInteger(monthly) || monthly <= 0) {
      setError('Preencha todos os campos e valores positivos antes de disponibilizar o contrato.');
      return;
    }
    setBusyId(organizationId);
    setError('');
    try {
      const body = {
        vertoLegalName:offer.vertoLegalName,vertoCnpj:offer.vertoCnpj,vertoAddress:offer.vertoAddress,
        clinicLegalName:offer.clinicLegalName,clinicCnpj:offer.clinicCnpj,clinicAddress:offer.clinicAddress,
        benefitDescription:offer.benefitDescription,benefitValueCents:value,
        benefitConditions:offer.benefitConditions,monthlyReferenceCents:monthly,startDate:offer.startDate,
      };
      const response = await fetch(`/api/owner/loyalty/drafts/${encodeURIComponent(organizationId)}/publish`, {
        method:'POST',credentials:'include',headers:{...(await authHeaders()),'Content-Type':'application/json'},
        body:JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || payload.data?.status !== 'offered') {
        throw new Error(payload?.error === 'LOYALTY_OFFER_FIELDS_INVALID'
          ? 'Confira os CNPJs, as datas e os valores informados.'
          : 'Não foi possível salvar e disponibilizar a oferta.');
      }
      setRows((current) => current.map((row) =>
        row.organizationId === organizationId ? {...row,draft:{...row.draft,...payload.data}} : row));
      setEditing(null);
      setAcknowledged(false);
      setOffer({...emptyOffer});
    } catch (cause:any) { setError(cause?.message || 'Falha ao salvar a oferta.'); }
    finally { setBusyId(null); }
  };

  return (
    <section className="rounded-[28px] border border-violet-100 bg-white p-6 shadow-sm" aria-label="Fidelidade de 12 meses">
      <div className="mb-4 flex items-start gap-3">
        <FileCheck2 className="mt-1 shrink-0 text-violet-600" size={22} aria-hidden="true"/>
        <div>
          <h3 className="text-lg font-black text-slate-900">Fidelidade de 12 meses — staging</h3>
          <p className="mt-1 text-sm text-slate-600">
            Ofereça o termo aprovado a uma clínica pagante. Benefício e valores devem ser reais e comprováveis.
            A oferta só aparece ao diretor após clicar em "Salvar e disponibilizar".
            Não há alteração de cobranças, módulos ou dados clínicos.
          </p>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin"/> Consultando assinaturas...
        </p>
      ) : !rows.length ? (
        <p className="text-sm text-slate-500">Nenhum contrato ou assinatura elegível encontrada.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.organizationId} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{row.clinicName}</p>
                  <p className="text-xs text-slate-500">
                    {row.draft?.status === 'accepted' ? 'Aceite confirmado e preservado'
                      : row.draft?.status === 'offered' ? 'Termo disponível ao diretor — aguardando aceite'
                      : row.draft ? 'Contrato preparado — falta salvar os dados comerciais'
                      : 'Assinatura existente — sem fidelidade'}
                  </p>
                </div>
                {row.draft?.status === 'accepted' ? (
                  <span className="text-xs font-bold text-emerald-700">Aceito</span>
                ) : row.draft?.status === 'offered' ? (
                  <span className="inline-flex items-center gap-2 text-xs font-bold text-amber-700">
                    <ShieldAlert size={15}/> Aguardando diretor
                  </span>
                ) : row.draft ? (
                  <button type="button" onClick={() => {setEditing(editing === row.organizationId ? null : row.organizationId); setError('');}}
                    disabled={busyId !== null}
                    className="rounded-xl border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700">
                    {editing === row.organizationId ? 'Fechar formulário' : 'Preencher contrato'}
                  </button>
                ) : (
                  <button type="button" onClick={() => void createDraft(row.organizationId)}
                    disabled={busyId !== null}
                    className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                    {busyId === row.organizationId ? 'Salvando...' : 'Preparar contrato'}
                  </button>
                )}
              </div>
              {editing === row.organizationId && row.draft?.status === 'draft' && (
                <form className="mt-4 space-y-4 border-t pt-4"
                  onSubmit={(event) => { event.preventDefault(); void publish(row.organizationId); }}>
                  <p className="text-sm text-slate-600">
                    Confira os dados com o contrato principal. Nenhum campo pode permanecer em branco.
                    O termo ficará congelado após o salvamento.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {fields.map((field) => (
                      <label key={field.key} className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                        {field.label}
                        <input required type={field.kind || 'text'}
                          min={field.kind === 'number' ? '0.01' : field.kind === 'date' ? new Date().toISOString().slice(0,10) : undefined}
                          step={field.kind === 'number' ? '0.01' : undefined}
                          value={offer[field.key]} onChange={(event) => setOffer((prev) => ({...prev,[field.key]:event.target.value}))}
                          className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-slate-900"/>
                      </label>
                    ))}
                  </div>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={acknowledged} onChange={(e)=>setAcknowledged(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-violet-600"/>
                    Confirmo que os dados e o benefício concedido são reais e foram conferidos antes da disponibilização ao cliente.
                  </label>
                  <button type="submit" disabled={!acknowledged || busyId !== null}
                    className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                    {busyId === row.organizationId ? 'Salvando...' : 'Salvar e disponibilizar ao diretor'}
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
