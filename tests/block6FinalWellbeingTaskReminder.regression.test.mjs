import assert from 'node:assert/strict';
import fs from 'node:fs';

const chart = fs.readFileSync(new URL('../src/components/AdultWellbeingTrendChart.tsx', import.meta.url), 'utf8');
const patientDashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const common = fs.readFileSync(new URL('../src/components/Common.tsx', import.meta.url), 'utf8');
const notificationSql = fs.readFileSync(new URL('../supabase/migrations/20260829183000_assigned_task_scheduled_notifications_v2.sql', import.meta.url), 'utf8');

// Mood / energy: exact raw day, daily averages for week/month, monthly averages for year.
assert.match(chart, /activePeriod === 'day'/);
assert.match(chart, /aggregateKind: 'raw'/);
assert.match(chart, /activePeriod === 'year' \? 'monthly_average' : 'daily_average'/);
assert.match(chart, /localDayKey\(row\.timestamp\)/);
assert.match(chart, /localMonthKey\(row\.timestamp\)/);
assert.match(chart, /roundAverage\(group\.total, group\.count\)/);
assert.match(chart, /observationCount: group\.count/);
assert.match(chart, /Média de \{selectedPoint\.observationCount\} registro/);
assert.match(chart, /<YAxis domain=\{\[0, 100\]\} ticks=\{\[0, 25, 50, 75, 100\]\} hide \/>/);
assert.match(chart, /min-w-0 flex-1 overflow-x-auto overscroll-x-contain/);
assert.match(chart, /fixedYAxisTicks = \[100, 75, 50, 25, 0\]/);
assert.match(chart, /style=\{\{ width: chartWidth, minWidth: '100%', height: chartHeight \}\}/);
assert.match(chart, /w-11 shrink-0/);
assert.match(chart, /container\.scrollLeft = Math\.max\(0, container\.scrollWidth - container\.clientWidth\)/);
assert.doesNotMatch(chart, /metricValue\s*\|\|\s*0/);

// Adult task completion must require an explicit patient effort answer.
assert.match(patientDashboard, /useState<number \| null>\(null\)/);
assert.match(patientDashboard, /setTaskEnergy\(isKidsProfile \? 50 : null\)/);
assert.match(patientDashboard, /Como foi fazer essa tarefa\?/);
assert.match(patientDashboard, /Agora informe o esforço percebido após concluir a atividade\./);
assert.match(patientDashboard, /taskEnergy === null/);
assert.match(patientDashboard, /if \(!isKidsProfile && \(taskEnergy === null \|\| !Number\.isFinite\(Number\(taskEnergy\)\)\)\) return;/);
assert.match(patientDashboard, /handleInterventionResponseContinue/);
assert.match(patientDashboard, /setTaskEnergy\(null\);[\s\S]*setTaskStep\(2\);/);
const interventionResponseStepStart = patientDashboard.indexOf('{taskStep === 1 && (');
const interventionReflectionStepStart = patientDashboard.indexOf('{!isKidsProfile && taskStep === 2 && (', interventionResponseStepStart);
assert.ok(interventionResponseStepStart >= 0 && interventionReflectionStepStart > interventionResponseStepStart);
const interventionResponseStep = patientDashboard.slice(interventionResponseStepStart, interventionReflectionStepStart);
const interventionReflectionStep = patientDashboard.slice(interventionReflectionStepStart, patientDashboard.indexOf(') : taskStep === 1 ?', interventionReflectionStepStart));
assert.match(interventionResponseStep, /Enviar Resposta/);
assert.doesNotMatch(interventionResponseStep, /Como foi fazer essa tarefa\?/);
assert.match(interventionReflectionStep, /Como foi fazer essa tarefa\?/);
assert.match(interventionReflectionStep, /Concluir tarefa/);
assert.match(patientDashboard, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/);
assert.match(patientDashboard, /const taskReflectionLabel = 'Esforço percebido'/);
assert.match(patientDashboard, /const taskReflectionPrompt = 'Quanto esforço essa atividade exigiu\?'/);
assert.match(patientDashboard, /scaleLabels=\{\['Pouco esforço', 'Moderado', 'Muito esforço'\]\}/);
assert.match(patientDashboard, /emojiForValue=\{getTaskEffortEmoji\}/);
assert.match(patientDashboard, /progressGradient=\{taskEffortProgressGradient\}/);
assert.match(patientDashboard, /linear-gradient\(90deg, #05CD99 0%, #FFB547 50%, #EE5D50 100%\)/);
assert.match(patientDashboard, /const getTaskReflectionEmoji = \(val: number\) => getTaskEffortEmoji\(val\)/);
assert.match(patientDashboard, /background: taskEffortProgressGradient/);
assert.match(patientDashboard, /clipPath: `inset\(0 \${Math\.max\(0, 100 - Number\(taskEnergy \|\| 0\)\)}% 0 0\)`/);
assert.match(common, /Não informado/);
assert.match(common, /hasExplicitValue/);
assert.match(common, /onInteract/);
assert.match(common, /Ainda não informado/);
assert.match(common, /progressGradient/);
assert.match(common, /clipPath: `inset\(0 \${hasExplicitValue \? Math\.max\(0, 100 - numericValue\) : 100}% 0 0\)`/);

// Professional review must not turn absence into a fabricated 0%.
assert.match(patientDetail, /resolveAssignedTaskPatientEffort/);
assert.match(patientDetail, /patientEffortRaw === null \? null : normalizeEffortPercent/);
assert.match(patientDetail, /O paciente não informou esforço para este registro\. Nenhum valor foi inferido\./);
assert.match(patientDetail, /Esforço percebido após a atividade: <span className="font-semibold">Não informado<\/span>/);

// Every active scheduled assigned task gets a one-time job; daily is additive.
assert.match(notificationSql, /'assigned-task:' \|\| new\.id::text \|\| ':scheduled:'/);
assert.match(notificationSql, /'deliveryMode', 'SCHEDULED_ONCE'/);
assert.match(notificationSql, /and new\.scheduled_at is not null/);
assert.match(notificationSql, /v_scheduled_due :=[\s\S]*verto_notification_delivery_due_v1\(new\.scheduled_at, 0, v_timezone\)/);
assert.match(notificationSql, /if v_active[\s\S]*new\.patient_id is not null[\s\S]*new\.scheduled_at is not null[\s\S]*insert into public\.notification_jobs/);
assert.match(notificationSql, /if v_active[\s\S]*and v_daily[\s\S]*'DAILY_WHILE_PENDING'/);
assert.match(notificationSql, /'assigned-task:' \|\| new\.id::text \|\| ':daily'/);
assert.match(notificationSql, /greatest\(now\(\), coalesce\(v_scheduled_due, now\(\)\)\)/);
assert.match(notificationSql, /idempotency_key ~ '\^assigned-task:\[0-9a-fA-F-\]\+:reminder\$'/);
assert.match(notificationSql, /status = case when notification_jobs\.status = 'SENT' then 'SENT' else 'SCHEDULED' end/);
assert.match(notificationSql, /verto_notification_clinic_timezone_v1/);
assert.doesNotMatch(notificationSql, /drop\s+table/i);
assert.doesNotMatch(notificationSql, /truncate\s+/i);
assert.doesNotMatch(notificationSql, /delete\s+from\s+public\.assigned_tasks/i);
assert.doesNotMatch(notificationSql, /update\s+public\.assigned_tasks/i);

console.log('block6FinalWellbeingTaskReminder.regression: PASS');
