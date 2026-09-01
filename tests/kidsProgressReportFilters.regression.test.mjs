import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');

assert.match(source, /const REPORT_PERIOD_MONTHS: Record<string, number>/);
assert.match(source, /const kidsReportScoredRows = useMemo\(/);
assert.match(source, /row\?\.protocol_id \|\| row\?\.protocolId/);
assert.match(source, /id: '__history_report_projection__'/);
assert.match(source, /title: 'Registros clínicos'/);
assert.match(source, /const periodStartKey = resolveReportPeriodStartKey\(reportPeriod, anchorKey\)/);
assert.match(source, /setComparisonDate1\(firstDate\)/);
assert.match(source, /setComparisonDate2\(lastDate\)/);
assert.match(source, /const scoredEvents = kidsReportScoredRows/);
assert.match(source, /value=\{comparisonDate1\}/);
assert.match(source, /value=\{comparisonDate2\}/);

console.log('kids progress report filters regression: ok');
