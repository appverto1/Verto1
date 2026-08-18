import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

assert.match(server, /loadClinicalNoteMentionUserIdsByNote/);
assert.match(server, /mention_user_ids:\s*mentionUserIdsByNote\.get/);
assert.match(server, /CLINICAL_NOTE_MENTION_PERSISTENCE_FAILED/);
assert.match(server, /A sincroniza[cç][aã]o ser[aá] repetida automaticamente\./i);
assert.match(server, /persistedMentionUserIds\s*=\s*await persistClinicalNoteMentions/);
assert.match(server, /mention_user_ids:\s*persistedMentionUserIds/);

assert.match(app, /mentionUserIds:\s*Array\.isArray\(n\?\.mentionUserIds\)/);
assert.match(app, /mentionUserIds:\s*Array\.isArray\(options\?\.mentionUserIds\)/);
assert.match(app, /result\?\.data\?\.mention_user_ids/);

console.log('clinical mention persistence regression: ok');
