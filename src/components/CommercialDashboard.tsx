import React, { useMemo } from 'react';

export type CommercialAttempt = {
  id: string;
  lead_id: string;
  channel: 'phone' | 'whatsapp_call';
  outcome: 'no_decisor' | 'decisor_spoken';
  occurred_at: string;
};

type Props = { attempts: CommercialAttempt[]; visibleLeadCount: number };
const pct = (a: number, b: number) => b === 0 ? '—' : (100 * a / b).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const channels = [
  { key: 'phone', name: 'Operadora' },
  { key: 'whatsapp_call', name: 'Ligação WhatsApp' },
] as const;

export const CommercialDashboard = ({ attempts, visibleLeadCount }: Props) => {
  const stats = useMemo(() => {
    const contacted = new Set<string>();
    const attempted = new Set<string>();
    const buckets: Record<string, { total: number; answered: number }> = {};
    const weekdays: Record<string, { total: number; answered: number }> = {};
    let firstTry = 0, reachedAtLaterTry = 0;
    const sequences = new Map<string, CommercialAttempt[]>();
    for (const attempt of attempts) {
      attempted.add(attempt.lead_id);
      if (attempt.outcome === 'decisor_spoken') contacted.add(attempt.lead_id);
      const date = new Date(attempt.occurred_at);
      if (!Number.isNaN(date.getTime())) {
        const hour = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(date);
        const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
        if (!buckets[hour]) buckets[hour] = { total: 0, answered: 0 };
        if (!weekdays[weekday]) weekdays[weekday] = { total: 0, answered: 0 };
        buckets[hour].total++;
        weekdays[weekday].total++;
        if (attempt.outcome === 'decisor_spoken') {
          buckets[hour].answered++;
          weekdays[weekday].answered++;
        }
      }
      const list = sequences.get(attempt.lead_id) || [];
      list.push(attempt);
      sequences.set(attempt.lead_id, list);
    }
    for (const list of sequences.values()) {
      list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      const index = list.findIndex((x) => x.outcome === 'decisor_spoken');
      if (index === 0) firstTry++;
      else if (index > 0) reachedAtLaterTry++;
    }
    return {
      contacted: contacted.size, attempted: attempted.size, buckets, weekdays,
      firstTry, reachedAtLaterTry,
    };
  }, [attempts]);
  const successes = attempts.filter((attempt) => attempt.outcome === 'decisor_spoken').length;
  const hourly = Object.entries(stats.buckets).sort(([a],[b]) => Number(a) - Number(b));
  const byWeekday = Object.entries(stats.weekdays).sort(([a],[b]) => a.localeCompare(b,'pt-BR'));
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Dashboard de prospecção">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-slate-900">Indicadores de prospecção</h3>
        <p className="text-xs text-slate-500">Horários de Brasília · apenas leads carregados</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Leads visíveis', visibleLeadCount.toLocaleString('pt-BR')],
          ['Ligações registradas', attempts.length.toLocaleString('pt-BR')],
          ['Decisores contatados', stats.contacted.toLocaleString('pt-BR')],
          ['Taxa por lead abordado', pct(stats.contacted,stats.attempted)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        Contato efetivo = conversa telefônica com o decisor, inclusive quando não há venda.
        Respostas por mensagem não são contabilizadas como sucesso.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-3">
          <h4 className="text-sm font-semibold">Resultado por canal</h4>
          <div className="mt-3 space-y-3">
            {channels.map((channel) => {
              const selected = attempts.filter((a) => a.channel === channel.key);
              const reached = selected.filter((a) => a.outcome === 'decisor_spoken').length;
              return (
                <div key={channel.key}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span>{channel.name} · {selected.length} ligações</span>
                    <span>{reached} com decisor · {pct(reached, selected.length)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: selected.length ? (100*reached/selected.length) + '%' : '0%' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 p-3">
          <h4 className="text-sm font-semibold">Em qual tentativa falou com o decisor</h4>
          <p className="mt-3 text-xs text-slate-600">1ª tentativa: {stats.firstTry} leads</p>
          <p className="mt-2 text-xs text-slate-600">2ª à 10ª tentativa: {stats.reachedAtLaterTry} leads</p>
          <p className="mt-2 text-xs text-slate-500">Tentativas são ordenadas por data e hora registradas.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-3">
          <h4 className="text-sm font-semibold">Horários das ligações</h4>
          {hourly.length === 0 ? <p className="mt-2 text-xs text-slate-500">Sem dados ainda.</p> : (
            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
              {hourly.map(([hour,row])=>(
                <div key={hour} className="flex justify-between gap-2 text-xs">
                  <span>{hour}h · {row.total} tentativas</span>
                  <span>{row.answered} com decisor ({pct(row.answered,row.total)})</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-100 p-3">
          <h4 className="text-sm font-semibold">Dias da semana</h4>
          {byWeekday.length === 0 ? <p className="mt-2 text-xs text-slate-500">Sem dados ainda.</p> : (
            <div className="mt-2 space-y-2">
              {byWeekday.map(([day,row])=>(
                <div key={day} className="flex justify-between gap-2 text-xs">
                  <span>{day} · {row.total} tentativas</span>
                  <span>{row.answered} com decisor ({pct(row.answered,row.total)})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {successes === 0 && attempts.length > 0 && <p className="mt-2 text-xs text-slate-500">Nenhuma conversa com decisor registrada neste conjunto.</p>}
    </section>
  );
};
