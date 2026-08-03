import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

const patientDetail = read('src/components/PatientDetailView.tsx');
const teamPanel = read('src/components/PatientProfessionalLinksPanel.tsx');
const radarChart = read('src/components/RadarDomainAssessmentChart.tsx');
const cumulativeChart = read('src/components/CumulativeGrowthChart.tsx');
const charts = read('src/components/Charts.tsx');

const patientHeaderIndex = patientDetail.indexOf('id="patient-header-info"');
const careContextIndex = patientDetail.indexOf('id="patient-care-context"');
const tabsIndex = patientDetail.indexOf('aria-label="Áreas do prontuário"');

assert.ok(patientHeaderIndex >= 0, 'o resumo do paciente deve continuar identificado');
assert.ok(
  careContextIndex > patientHeaderIndex,
  'cuidado e equipe devem aparecer depois do resumo do paciente',
);
assert.ok(
  tabsIndex > careContextIndex,
  'a navegação deve aparecer depois do contexto assistencial',
);
assert.match(
  patientDetail,
  /id="patient-care-context"[\s\S]*Responsável principal[\s\S]*<PatientProfessionalLinksPanel/,
  'responsável e equipe devem formar uma seção assistencial coerente',
);
assert.match(
  patientDetail,
  /aria-label="Áreas do prontuário"[\s\S]*lg:grid lg:auto-cols-fr lg:grid-flow-col/,
  'as abas devem distribuir igualmente a largura disponível no desktop',
);
assert.match(
  patientDetail,
  /aria-label="Áreas do prontuário"[\s\S]*min-h-11[\s\S]*focus-visible:ring-2/,
  'as abas devem preservar área de toque e foco visível',
);
assert.equal(
  (patientDetail.match(/max-w-\[1480px\]/g) || []).length >= 2,
  true,
  'cabeçalho e conteúdo devem compartilhar uma largura máxima legível',
);

assert.match(
  patientDetail,
  /data-testid="therapeutic-plan-mode-switch"[\s\S]*PTS[\s\S]*PEI/,
  'PTS e PEI devem ser acessíveis no topo do plano, sem empilhar o PEI abaixo do PTS',
);
assert.match(
  patientDetail,
  /patientPhotoSource\(patient\)[\s\S]*<SecureImage/,
  'a foto cadastrada do paciente deve aparecer no cabeçalho do prontuário',
);
assert.match(
  patientDetail,
  /therapeuticPlanMode === 'pts'[\s\S]*<TherapeuticPlanPanel/,
  'o PTS deve permanecer como visão padrão e preservar o painel existente',
);
assert.match(
  patientDetail,
  /therapeuticPlanMode === 'pei'[\s\S]*PEI - Plano Educacional Individualizado/,
  'o PEI deve permanecer funcional em uma visão própria',
);

assert.doesNotMatch(
  teamPanel,
  /max-w-3xl/,
  'a equipe do caso não deve ficar artificialmente limitada e solta no cabeçalho',
);
assert.match(
  teamPanel,
  /aria-label="Equipe do caso"[\s\S]*xl:grid-cols-3/,
  'vínculos devem aproveitar a largura disponível sem criar espaço morto',
);
assert.match(
  teamPanel,
  /professionalPhotoSource[\s\S]*<SecureImage/,
  'a equipe do caso deve reutilizar as fotos cadastradas pelos profissionais',
);

const evolutionIndex = patientDetail.indexOf('id="patient-history-insights"');
const timelineIndex = patientDetail.indexOf(
  'id="patient-timeline-heading"',
  evolutionIndex,
);

assert.ok(evolutionIndex >= 0, 'o Histórico deve possuir uma seção de evolução clínica');
assert.ok(
  timelineIndex > evolutionIndex,
  'a linha do tempo deve ser uma seção própria depois dos indicadores de evolução',
);
assert.match(
  patientDetail,
  /Período da linha do tempo/,
  'o filtro deve explicar que afeta a linha do tempo',
);
assert.doesNotMatch(
  patientDetail,
  /Período visível/,
  'o filtro não deve sugerir que controla todos os gráficos',
);
assert.doesNotMatch(
  patientDetail,
  /id="snapshot-selector"/,
  'um seletor de recorte sem efeito real não deve permanecer visível',
);
assert.match(
  patientDetail,
  /<EvolutionBarChart[\s\S]*variant="patient-history"/,
  'o Histórico deve usar a variante compacta sem alterar consumidores legados',
);
assert.match(
  patientDetail,
  /<RadarDomainAssessmentChart[\s\S]*protocolId=\{selectedChartProtocolId\}[\s\S]*compact/,
  'radar e evolução devem compartilhar o protocolo controlado pelo prontuário',
);
assert.match(
  patientDetail,
  /<CumulativeGrowthChart[\s\S]*protocolId=\{selectedChartProtocolId\}[\s\S]*compact/,
  'crescimento e evolução devem compartilhar o mesmo protocolo',
);
assert.match(
  patientDetail,
  /!isKidsProfile && showCoordinatorPatientRadar[\s\S]*Panorama do desenvolvimento[\s\S]*<RadarDomainAssessmentChart[\s\S]*<CumulativeGrowthChart/,
  'pacientes adultos devem preservar as leituras históricas existentes',
);

assert.match(
  radarChart,
  /const useDomainList = compact && chartData\.length > 8/,
  'protocolos extensos devem ganhar uma visualização legível por domínio',
);
assert.match(
  radarChart,
  /role="list" aria-label="Resultados por domínio"/,
  'a alternativa ao radar deve manter semântica acessível',
);
assert.match(
  radarChart,
  /const isProtocolControlled = protocolId !== undefined/,
  'o radar deve respeitar o filtro compartilhado quando controlado',
);
assert.match(
  cumulativeChart,
  /chartData\.length < 2[\s\S]*Há um primeiro registro disponível/,
  'um único ponto não deve produzir uma curva visualmente enganosa',
);
assert.match(
  charts,
  /entry\[dsLabel\] = dsValues\[index\] \?\? null/,
  'ausência de dado não deve ser apresentada como desempenho zero',
);
assert.match(
  charts,
  /variant = 'default'[\s\S]*const isPatientHistory = variant === 'patient-history'/,
  'a compactação deve ser opt-in para preservar os outros usos do gráfico',
);

for (const chartSource of [radarChart, cumulativeChart]) {
  assert.doesNotMatch(
    chartSource,
    /fetch\(|dataService\./,
    'os gráficos devem reutilizar os dados carregados, sem novas requisições',
  );
}

console.log('patient detail information architecture tests passed');
