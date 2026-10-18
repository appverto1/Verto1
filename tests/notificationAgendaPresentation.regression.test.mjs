import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guard only the patient-facing presentation and mobile controls.
// Backend timestamps remain ISO in storage and in requests.
const calendar = readFileSync('src/components/Calendar.tsx', 'utf8');
const worker = readFileSync('public/sw.js', 'utf8');

assert.match(calendar, /const formatTime = \(date: Date\) => new Intl\.DateTimeFormat\('pt-BR', \{ timeZone: 'America\/Sao_Paulo'/);
assert.match(calendar, /time: formatTime\(start\)/);
assert.match(calendar, /endTime: formatTime\(end\)/);
assert.match(calendar, /const getRoomDisplayLine = \(event: any\) => \{/);
assert.match(calendar, /\.find\(\(value\) => !looksLikeTechnicalId\(value\)\)/);
assert.match(calendar, /\.map\(sanitizeHumanRoomName\)\.find\(Boolean\)/);
assert.match(calendar, /const intervalLabel =/);
assert.match(calendar, /const eventStart = event.start instanceof Date/);
assert.match(calendar, /const eventEnd = event.end instanceof Date/);
assert.match(calendar, /formatTime\(eventEnd\)\.replace\(':', 'h'\)/);
assert.match(calendar, /view === 'month' \? renderMonthView\(\) : renderMobileList\(\)/, 'month grid on mobile');
assert.match(calendar, /min-h-\[520px\]/, 'month grid keeps readable rows on mobile');
assert.match(calendar, /\{intervalLabel\}/);
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
assert.match(worker, /const SW_VERSION = "verto-branding-v24"/);
assert.doesNotMatch(worker, /notificationOptions\.image\s*=|\.showNotification\([^\n]*\{[^\n]*image:/);
console.log('notificationAgendaPresentation.regression: PASS');
