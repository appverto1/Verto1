import React, { useEffect, useState } from 'react';
import { FileCheck2, Loader2, ShieldAlert } from 'lucide-react';
import { getSupabase } from '../lib/supabase';

type Draft = {
  id: string;
  organization_id?: string;
  status: 'draft';
  legal_review_status?: string;
  legalReviewStatus?: string;
  duration_months?: number;
  durationMonths?: number;
  created_at?: string;
  createdAt?: string;
};
type ClinicRow = { organizationId: string; clinicName: string; draft: Draft | null };

// Staging pilot: create a non-binding draft, not a contract or billing change.
export function OwnerLoyaltyDraftPanel() {
  const [rows, setRows] = useState<ClinicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const authHeaders = async (): Promise<Record<string, string>> => {
    const supabase = await getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
    return { Authorization: `Bearer ${session.access_token}` };
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/owner/loyalty/drafts', {
          credentials: 'include',
          headers: await authHeaders(),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success !== true || !Array.isArray(payload.data)) {
          throw new Error('Minutas de fidelidade indisponíveis neste ambiente.');
        }
        if (active) setRows(payload.data);
      } catch (cause: any) {
        if (active) setError(cause?.message || 'Não foi possível consultar a fidelidade.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const createDraft = async (organizationId: string) => {
    if (busyId) return;
    setBusyId(organizationId);
    setError('');
    try {
      const response = await fetch('/api/owner/loyalty/drafts', {
        method: 'POST',
        credentials: 'include',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !payload?.data?.id) {
        throw new Error(payload?.error === 'LOYALTY_SUBSCRIPTION_INELIGIBLE'
          ? 'A assinatura foi alterada ou não está ativa e paga. Atualize a tela.'
          : 'Não foi possível salvar a minuta.');
      }
      setRows((current) => current.map((row) =>
        row.organizationId === organizationId ? { ...row, draft: payload.data } : row));
    } catch (cause: any) {
      setError(cause?.message || 'Não foi possível salvar a minuta.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-[28px] border border-violet-100 bg-white p-6 shadow-sm" aria-label="Fidelidade de 12 meses">
      <div className="mb-4 flex items-start gap-3">
        <FileCheck2 className="mt-1 shrink-0 text-violet-600" size={22} aria-hidden="true" />
        <div>
          <h3 className="text-lg font-black text-slate-900">Fidelidade de 12 meses — staging</h3>
          <p className="mt-1 text-sm text-slate-600">
            Somente minutas para clínicas já pagantes. A multa proporcional depende de revisão jurídica;
            nenhum aceite, cobrança ou alteração da assinatura é realizado aqui.
          </p>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Consultando assinaturas elegíveis...</p>
      ) : !rows.length ? (
        <p className="text-sm text-slate-500">Nenhuma assinatura ativa e paga foi encontrada neste ambiente.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.organizationId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-900">{row.clinicName}</p>
                <p className="text-xs text-slate-500">
                  {row.draft ? 'Minuta salva • 12 meses • revisão jurídica pendente' : 'Assinatura paga existente • sem fidelidade'}
                </p>
              </div>
              {row.draft ? (
                <span className="inline-flex items-center gap-2 text-xs font-bold text-amber-700">
                  <ShieldAlert size={15} aria-hidden="true" /> Não vinculante
                </span>
              ) : (
                <button type="button" onClick={() => void createDraft(row.organizationId)}
                  disabled={busyId !== null}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {busyId === row.organizationId && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  Preparar minuta
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
