import assert from 'node:assert/strict';
import fs from 'node:fs';

const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const charts = fs.readFileSync('src/components/Charts.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const registry = fs.readFileSync('src/components/PatientRegistry.tsx', 'utf8');

assert.match(
  detail,
  /const reportChartProtocol = useMemo[\s\S]*?planProtocolCatalog[\s\S]*?matchCount/,
  'o relatório infantil deve resolver o protocolo contra o catálogo real e preferir um protocolo com dados comparáveis',
);
assert.match(
  detail,
  /const kidsReportAvailableSnapshots = useMemo[\s\S]*?resolveReportPeriodStartKey\(reportPeriod, anchorKey\)/,
  'o período selecionado deve limitar de fato as datas disponíveis para comparação',
);
assert.match(
  detail,
  /setComparisonDate1\(firstDate\)[\s\S]*?setComparisonDate2\(lastDate\)/,
  'ao mudar o escopo temporal o relatório deve escolher uma base e uma comparação válidas',
);
assert.match(
  detail,
  /kidsReportSelectableNotesInPeriod[\s\S]*?resolveReportPeriodStartKey\(reportPeriod, anchorKey\)/,
  'o período do relatório também deve restringir as observações clínicas disponíveis',
);
assert.match(
  detail,
  /kidsReportAvailableSnapshots\.map[\s\S]*?formatReportDateLabel\(date\)/,
  'os filtros de data devem consumir as datas comparáveis e exibi-las em pt-BR',
);

assert.match(
  detail,
  /const score = isVbMappProtocol[\s\S]*?Math\.max\(0, rawScore\)/,
  'protocolos não binários devem preservar a pontuação real do item em vez de achatar tudo para 0–1',
);
assert.match(
  detail,
  /matchedTask\?\.maxScore[\s\S]*?maxScore,/,
  'o relatório profissional deve enviar ao cálculo o maxScore real do item do protocolo',
);
assert.doesNotMatch(
  detail,
  /const score = Math\.max\(0, Math\.min\(1, Number\(h\?\.score/,
  'o relatório profissional não pode impor escala global 0–1',
);

const patientDashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
assert.match(
  patientDashboard,
  /const score = isVbMappProtocol[\s\S]*?Math\.max\(0, rawScore\)/,
  'o portal do paciente deve preservar a pontuação real de protocolos como AFLS',
);
assert.match(
  patientDashboard,
  /matchedTask\?\.maxScore[\s\S]*?maxScore,/,
  'o portal do paciente deve usar o maxScore real do item ao calcular domínio',
);
assert.doesNotMatch(
  patientDashboard,
  /const score = Math\.max\(0, Math\.min\(1, Number\(scoreRaw\)/,
  'o portal do paciente não pode impor escala global 0–1',
);
assert.match(
  charts,
  /emptyMessage \|\| 'Selecione dois períodos com medições para comparar o progresso\.'/,
  'o gráfico deve distinguir falta de seleção de falta de dados comparáveis',
);
assert.match(
  coordinator,
  /patientMatchesNameFilter\(patient, patientNameFilter\)[\s\S]*?sortPatientsAlphabetically\(filteredPatients\)/,
  'a gestão de pacientes deve filtrar por nome e ordenar o resultado alfabeticamente',
);
assert.match(
  coordinator,
  /placeholder="Digite o nome do paciente"/,
  'a busca nominal deve estar visível na Gestão de Pacientes',
);
assert.match(
  registry,
  /sortPatientsAlphabetically[\s\S]*?patientMatchesNameFilter/,
  'as listagens de terapeuta/recepção devem reutilizar a mesma busca e ordenação canônicas',
);

console.log('progressReportFilters.regression.test.mjs: ok');
