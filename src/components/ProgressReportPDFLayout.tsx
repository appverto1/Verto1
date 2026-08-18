import React from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

type ProgressReportObservation = {
  id: string | number;
  date: string;
  type: string;
  activity: string;
  score: string;
  notes: string;
};

type ProgressReportPDFLayoutProps = {
  clinic: {
    name?: string;
    cnpj?: string;
    address?: string;
    phone?: string;
    email?: string;
    logoUrl?: string | null;
  };
  patient: {
    name?: string;
  };
  professional: {
    name?: string;
    registry?: string;
    signatureUrl?: string | null;
  };
  report: {
    type?: string;
    periodLabel?: string;
    generatedAt?: string;
    comparisonKeys?: string[];
  };
  chartData: Array<Record<string, any>>;
  observations: ProgressReportObservation[];
  additionalNote?: string;
};

const BRAND_PURPLE = '#8B5CF6';
const SUCCESS_GREEN = '#10B981';

const wrapText = (value: any, maxChars = 27) => {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines.slice(0, 4);
};

const WrappedYAxisTick = ({ x, y, payload }: any) => {
  const lines = wrapText(payload?.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} textAnchor="end" fill="#334155" fontSize={10} fontWeight={700}>
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? -((lines.length - 1) * 6) : 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
};

const PdfTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: 10, boxShadow: '0 10px 24px rgba(15,23,42,.12)' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 800, color: '#0F172A', fontSize: 11 }}>{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ margin: '3px 0', color: entry.color, fontWeight: 700, fontSize: 10 }}>
          {entry.dataKey}: {Number(entry.value || 0).toFixed(1)}%
        </p>
      ))}
    </div>
  );
};

const observationWeight = (item: ProgressReportObservation) => {
  const textLength = `${item.activity || ''} ${item.notes || ''}`.trim().length;
  if (textLength > 1200) return 3;
  if (textLength > 650) return 2;
  return 1;
};

const chunkObservations = (observations: ProgressReportObservation[]) => {
  if (!observations.length) return [] as ProgressReportObservation[][];
  const pages: ProgressReportObservation[][] = [];
  let page: ProgressReportObservation[] = [];
  let weight = 0;
  for (const item of observations) {
    const nextWeight = observationWeight(item);
    const shouldBreak = page.length >= 5 || (page.length >= 4 && weight + nextWeight > 5) || weight + nextWeight > 6;
    if (shouldBreak && page.length > 0) {
      pages.push(page);
      page = [];
      weight = 0;
    }
    page.push(item);
    weight += nextWeight;
  }
  if (page.length) pages.push(page);
  return pages;
};

const PageFooter = ({ professional, report }: Pick<ProgressReportPDFLayoutProps, 'professional' | 'report'>) => (
  <footer style={{ marginTop: 44, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, pageBreakInside: 'avoid' }}>
    <p style={{ margin: 0, fontSize: 9.5, color: '#94A3B8', maxWidth: 360 }}>
      Documento gerado automaticamente pela plataforma Verto em {report.generatedAt || new Date().toLocaleString('pt-BR')}.
    </p>
    <div style={{ width: 260, textAlign: 'center' }}>
      {professional.signatureUrl ? (
        <img src={professional.signatureUrl} alt="Assinatura digital" style={{ display: 'block', height: 54, maxWidth: 230, objectFit: 'contain', margin: '0 auto 8px' }} />
      ) : null}
      <div style={{ borderTop: '1px solid #94A3B8', paddingTop: 6 }}>
        <p style={{ margin: '0 0 2px', fontSize: 10.5, fontWeight: 700 }}>{professional.name || 'Profissional responsável'}</p>
        <p style={{ margin: 0, fontSize: 9.5, color: '#64748B' }}>{professional.registry || 'Registro profissional'}</p>
      </div>
    </div>
  </footer>
);

const CompactPageHeader = ({ clinic, patient, pageNumber }: Pick<ProgressReportPDFLayoutProps, 'clinic' | 'patient'> & { pageNumber: number }) => (
  <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, borderBottom: '1px solid #E2E8F0', paddingBottom: 14, marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 70, height: 40, border: '1px solid #E2E8F0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#F8FAFC' }}>
        {clinic.logoUrl ? <img src={clinic.logoUrl} alt="Logo da clínica" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9, fontWeight: 800, color: '#94A3B8' }}>LOGO</span>}
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: '#0F172A' }}>{clinic.name || 'Clínica'}</p>
        <p style={{ margin: '2px 0 0', fontSize: 9.5, color: '#64748B' }}>Paciente: {patient.name || '-'}</p>
      </div>
    </div>
    <p style={{ margin: 0, fontSize: 9.5, color: '#94A3B8' }}>Página {pageNumber}</p>
  </header>
);

const ObservationCard = ({ item }: { item: ProgressReportObservation }) => (
  <article style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 14px', borderLeft: `4px solid ${BRAND_PURPLE}`, background: '#FFFFFF', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
    <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>
      {item.date || '-'} | Tipo: {item.type || 'NOVO REGISTRO'} | Atividade: {item.activity || '-'} | Pontuação: {item.score || '-'}
    </p>
    <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: '#1E293B', whiteSpace: 'pre-wrap' }}>
      <strong>Anotações do Profissional:</strong>{'\n'}{item.notes || 'Sem anotação textual selecionada.'}
    </p>
  </article>
);

export const ProgressReportPDFLayout = ({
  clinic,
  patient,
  professional,
  report,
  chartData,
  observations,
  additionalNote,
}: ProgressReportPDFLayoutProps) => {
  const comparisonKeys = report.comparisonKeys?.length
    ? report.comparisonKeys
    : Object.keys(chartData?.[0] || {}).filter((key) => key !== 'name');
  const chartHeight = Math.max(320, (chartData?.length || 1) * 52);
  const hasChartData = Array.isArray(chartData) && chartData.length > 0 && comparisonKeys.length > 0;
  const observationPages = chunkObservations(observations);
  const pageStyle: React.CSSProperties = {
    width: 794,
    minHeight: 1123,
    background: '#FFFFFF',
    color: '#0F172A',
    fontFamily: 'Arial, Helvetica, sans-serif',
    padding: '34px 38px',
    boxSizing: 'border-box',
    pageBreakAfter: 'always',
  };

  return (
    <div style={{ background: '#FFFFFF' }}>
      <div className="progress-report-pdf-page" style={pageStyle}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 28, borderBottom: '1px solid #E2E8F0', paddingBottom: 20 }}>
          <div style={{ width: '48%' }}>
            <div style={{ width: 96, height: 54, border: '1px solid #E2E8F0', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, overflow: 'hidden', background: '#F8FAFC' }}>
              {clinic.logoUrl ? (
                <img src={clinic.logoUrl} alt="Logo da clínica" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', letterSpacing: 1 }}>LOGO</span>
              )}
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: 18, lineHeight: 1.2 }}>Relatório de Progresso</h1>
            <p style={{ margin: '3px 0', fontSize: 10.5, color: '#334155' }}><strong>{clinic.name || 'Clínica não informada'}</strong></p>
            <p style={{ margin: '3px 0', fontSize: 10.5, color: '#475569' }}>CNPJ: {clinic.cnpj || '-'}</p>
            <p style={{ margin: '3px 0', fontSize: 10.5, color: '#475569' }}>Endereço: {clinic.address || '-'}</p>
            <p style={{ margin: '3px 0', fontSize: 10.5, color: '#475569' }}>Contato: {clinic.phone || '-'} / {clinic.email || '-'}</p>
          </div>

          <div style={{ width: '48%', borderLeft: `4px solid ${BRAND_PURPLE}`, paddingLeft: 16 }}>
            <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 800, color: BRAND_PURPLE, letterSpacing: 1.6, textTransform: 'uppercase' }}>Dados do relatório</p>
            <p style={{ margin: '5px 0', fontSize: 11, color: '#334155' }}><strong>Paciente:</strong> {patient.name || '-'}</p>
            <p style={{ margin: '5px 0', fontSize: 11, color: '#334155' }}><strong>Tipo de ficha:</strong> {report.type || 'Relatório de Progresso (comparativo)'}</p>
            <p style={{ margin: '5px 0', fontSize: 11, color: '#334155' }}><strong>Período:</strong> {report.periodLabel || '-'}</p>
            <p style={{ margin: '5px 0', fontSize: 11, color: '#334155' }}><strong>Profissional responsável:</strong> {professional.name || '-'}</p>
            <p style={{ margin: '5px 0', fontSize: 11, color: '#334155' }}><strong>Registro:</strong> {professional.registry || '-'}</p>
          </div>
        </header>

        <section style={{ marginTop: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.2 }}>1. Gráfico Comparativo por Domínio</h2>
          <p style={{ margin: '0 0 14px', fontSize: 10.5, lineHeight: 1.5, color: '#64748B' }}>
            Comparação percentual da evolução por domínio, com barras horizontais para preservar a legibilidade em folha A4.
          </p>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 14, background: '#FFFFFF' }}>
            {hasChartData ? (
              <BarChart
                width={690}
                height={chartHeight}
                data={chartData}
                layout="vertical"
                margin={{ top: 10, right: 28, left: 168, bottom: 18 }}
                barGap={8}
                barCategoryGap="28%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 20, 40, 60, 80, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={165}
                  tick={<WrappedYAxisTick />}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <Tooltip content={<PdfTooltip />} />
                {comparisonKeys.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={index === 0 ? BRAND_PURPLE : SUCCESS_GREEN}
                    radius={[0, 8, 8, 0]}
                    maxBarSize={20}
                  />
                ))}
              </BarChart>
            ) : (
              <div style={{ padding: 30, color: '#64748B', fontSize: 12, textAlign: 'center' }}>
                Sem dados comparativos suficientes para o período selecionado.
              </div>
            )}
          </div>
          {comparisonKeys.length > 0 && (
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10 }}>
              {comparisonKeys.map((key, index) => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: '#334155' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: index === 0 ? BRAND_PURPLE : SUCCESS_GREEN }} />
                  {key}
                </span>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.2 }}>2. Observações Selecionadas para o Relatório</h2>
          <p style={{ margin: '0 0 14px', fontSize: 10.5, lineHeight: 1.5, color: '#64748B' }}>
            {observations.length > 0
              ? `${observations.length} registro(s) selecionado(s). As observações são apresentadas nas páginas seguintes sem dividir um card entre páginas.`
              : 'Nenhuma observação foi selecionada para este relatório.'}
          </p>
        </section>

        {observations.length === 0 && additionalNote?.trim() && (
          <div style={{ marginTop: 12, border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, background: '#F8FAFC', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Observação adicional</p>
            <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{additionalNote}</p>
          </div>
        )}

        {observations.length === 0 && <PageFooter professional={professional} report={report} />}
      </div>

      {observationPages.map((pageItems, pageIndex) => {
        const isLastPage = pageIndex === observationPages.length - 1;
        return (
          <div key={`observations-page-${pageIndex}`} className="progress-report-pdf-page" style={pageStyle}>
            <CompactPageHeader clinic={clinic} patient={patient} pageNumber={pageIndex + 2} />
            <section>
              <h2 style={{ margin: '0 0 4px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.2 }}>2. Observações Selecionadas para o Relatório</h2>
              <p style={{ margin: '0 0 14px', fontSize: 10.5, lineHeight: 1.5, color: '#64748B' }}>
                Continuação dos registros clínicos selecionados pelo profissional.
              </p>
              <div style={{ display: 'grid', gap: 10 }}>
                {pageItems.map((item) => (
                  <React.Fragment key={item.id}>
                    <ObservationCard item={item} />
                  </React.Fragment>
                ))}
              </div>
            </section>

            {isLastPage && additionalNote?.trim() && (
              <div style={{ marginTop: 12, border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, background: '#F8FAFC', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Observação adicional</p>
                <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{additionalNote}</p>
              </div>
            )}

            {isLastPage && <PageFooter professional={professional} report={report} />}
          </div>
        );
      })}
    </div>
  );
};
