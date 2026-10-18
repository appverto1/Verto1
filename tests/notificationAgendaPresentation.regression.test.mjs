import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guard only the patient-facing presentation and mobile controls.
// Backend timestamps remain ISO in storage and in requests.
const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const worker = readFileSync('public/sw.js', 'utf8');

assert.match(calendar, /const formatTime = \(date: Date\) => new Intl\.DateTimeFormat\('pt-BR', \{ timeZone: 'America\/Sao_Paulo'/);
assert.match(calendar, /time: formatTime\(start\)/);
assert.match(calendar, /endTime: formatTime\(end\)/);
assert.match(calendar, /\{event\.time\} - \{event\.endTime\}/);
assert.match(calendar, /mobileAgendaMoreOpen/);
assert.match(calendar, /aria-expanded=\{mobileAgendaMoreOpen\}/);
assert.match(calendar, /id="agenda-mobile-more"/);
assert.match(calendar, /className="relative xl:hidden"/);
assert.match(calendar, /Mais <ChevronDown/);
assert.match(calendar, /Sessões em grupo/);
assert.match(calendar, /Relatórios de tempo/);
assert.match(calendar, /Atualizar agenda/);
assert.match(calendar, /cacheRef\.current\.clear\(\);[\s\S]*?setRemoteRefreshNonce/);
assert.match(calendar, /setFilterSheetOpen\(true\)/);
assert.match(worker, /const SW_VERSION = "verto-branding-v23"/);
assert.doesNotMatch(worker, /notificationOptions\.image\s*=|\.showNotification\([^\n]*\{[^\n]*image:/);
console.log('notificationAgendaPresentation.regression: PASS');
