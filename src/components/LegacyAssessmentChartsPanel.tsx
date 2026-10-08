import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, RefreshCcw } from 'lucide-react';
import { dataService } from '../services/dataService';
import { RadarDomainAssessmentChart } from './RadarDomainAssessmentChart';
import { CumulativeGrowthChart } from './CumulativeGrowthChart';

type Props = {
  patientId: string;
  protocols?: any[];
  isPanelDark?: boolean;
};

const normalize = (value: unknown) =>
  String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const protocolRef = (row: any) => {
  const taskData = row?.task_data && typeof row.task_data === 'object' ? row.task_data : {};
  return {
    id: String(row?.protocol_id || row?.protocolId || taskData?.protocol_id || taskData?.protocolId || '').trim(),
    title: normalize(row?.protocol_title || row?.protocolTitle || taskData?.protocol_title || taskData?.protocolTitle),
    evidenceKind: String(taskData?.evidence_kind || taskData?.evidenceKind || '').trim()
  };
};

export function LegacyAssessmentChartsPanel({ patientId, protocols = [], isPanelDark = false }: Props) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const evaluationProtocols = useMemo(
    () => (Array.isArray(protocols) ? protocols : []).filter((protocol: any) =>
      String(protocol?.category || protocol?.type || '').trim().toLowerCase() === 'evaluation'
    ),
    [protocols]
  );
  const protocolIds = useMemo(
    () => new Set(evaluationProtocols.map((p: any) => String(p?.id || '').trim()).filter(Boolean)),
    [evaluationProtocols]
  );
  const protocolTitles = useMemo(
    () => new Set(evaluationProtocols.map((p: any) => normalize(p?.title || p?.name)).filter(Boolean)),
    [evaluationProtocols]
  );

  const load = async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    try {
      const result = await dataService.getHistory(patientId, { limit: 100 });
      if (result?.success === false) throw new Error(result?.error || 'HISTORY_LOAD_FAILED');
      setHistory(Array.isArray(result?.data) ? result.data : []);
    } catch {
      setError('Não foi possível carregar as aplicações de protocolos agora.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [patientId]);

  const assessmentHistory = useMemo(
    () => history.filter((row: any) => {
      if (String(row?.patient_id || row?.patientId || '').trim() !== String(patientId || '').trim()) return false;
      const ref = protocolRef(row);
      const explicitProtocol = (ref.id && protocolIds.has(ref.id)) || (ref.title && protocolTitles.has(ref.title));
      if (!explicitProtocol) return false;
      return ref.evidenceKind !== 'session_intervention';
    }),
    [history, patientId, protocolIds, protocolTitles]
  );

  const applications = useMemo(() => {
    const byProtocolAndDay = new Map<string, any>();
    for (const row of assessmentHistory) {
      const ref = protocolRef(row);
      const protocol = evaluationProtocols.find((item: any) =>
        (ref.id && String(item?.id || '').trim() === ref.id) ||
        (ref.title && normalize(item?.title || item?.name) === ref.title)
      );
      const createdAt = String(row?.created_at || row?.createdAt || '');
      const dateKey = createdAt ? createdAt.slice(0, 10) : 'sem-data';
      const protocolId = String(protocol?.id || ref.id || ref.title || 'protocol');
      const key = `${protocolId}:${dateKey}`;
      const current = byProtocolAndDay.get(key) || {
        key,
        protocolTitle: protocol?.title || protocol?.name || row?.protocol_title || 'Protocolo de avaliação',
        createdAt,
        itemCount: 0,
      };
      current.itemCount += 1;
      if (createdAt && (!current.createdAt || new Date(createdAt).getTime() > new Date(current.createdAt).getTime())) current.createdAt = createdAt;
      byProtocolAndDay.set(key, current);
    }
    return Array.from(byProtocolAndDay.values())
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 12);
  }, [assessmentHistory, evaluationProtocols]);

  if (loading) {
    return <div className={`rounded-2xl border p-5 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600'}`}>Carregando aplicações de protocolos...</div>;
  }

  if (error) {
    return (
      <div role="alert" className={`rounded-2xl border p-5 ${isPanelDark ? 'border-red-400/30 bg-red-500/5 text-red-200' : 'border-red-200 bg-red-50 text-red-700'}`}>
        <p className="text-sm font-medium">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold">
          <RefreshCcw size={15} /> Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="legacy-assessment-charts">
      <section className={`rounded-2xl border p-5 ${isPanelDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-start gap-3">
          <ClipboardCheck size={20} className="mt-0.5 text-violet-600" />
          <div>
            <h3 className={`text-base font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>Aplicações de protocolos de avaliação</h3>
            <p className={`mt-1 text-xs leading-5 ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Esta visão usa somente avaliações com protocolo identificado. Dados de intervenção do plano individual não entram no ABA Legacy.
            </p>
          </div>
        </div>
      </section>

      <RadarDomainAssessmentChart
        patientId={patientId}
        protocols={evaluationProtocols}
        history={assessmentHistory}
        dark={isPanelDark}
      />

      <CumulativeGrowthChart
        patientId={patientId}
        protocols={evaluationProtocols}
        history={assessmentHistory}
        dark={isPanelDark}
      />

      <section className={`rounded-2xl border p-5 ${isPanelDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
        <h4 className={`text-sm font-semibold ${isPanelDark ? 'text-slate-100' : 'text-slate-900'}`}>Aplicações registradas</h4>
        {applications.length === 0 ? (
          <p className={`mt-3 text-sm ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Ainda não há aplicação de protocolo de avaliação com identidade persistida.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {applications.map((item: any) => (
              <div key={item.key} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${isPanelDark ? 'text-slate-200' : 'text-slate-800'}`}>{item.protocolTitle}</p>
                  <p className={`mt-0.5 text-xs ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`}>{item.itemCount} item(ns) avaliados</p>
                </div>
                <span className={`shrink-0 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {item.createdAt ? new Date(item.createdAt).toLocaleDateString('pt-BR') : 'Sem data'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
