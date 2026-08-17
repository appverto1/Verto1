import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');

assert.ok(server.includes('readBoundedRawUpload'), 'server must stream bounded raw uploads');
assert.ok(server.includes("'x-verto-upload-mode'"), 'server must require explicit raw upload mode');
assert.ok(server.includes("'x-verto-declared-type'"), 'server must receive declared MIME separately from transport MIME');
assert.ok(server.includes("readBoundedRawUpload(req, 10 * 1024 * 1024)"), 'server raw transport must enforce 10 MB');
assert.ok(server.includes("error?.code === 'UPLOAD_TOO_LARGE'"), 'oversize raw uploads must return controlled 413');
assert.ok(dataService.includes("'Content-Type': 'application/octet-stream'"), 'client must use binary transport instead of multipart');
assert.ok(dataService.includes("'X-Verto-Upload-Mode': 'raw-v1'"), 'client must opt into raw-v1 transport');
assert.ok(dataService.includes('body: uploadBlob'), 'client must send file bytes directly');
assert.ok(!/new FormData\(\)[\s\S]{0,5000}\/api\/patient-files\//.test(dataService), 'patient file upload must not depend on multipart FormData transport');

console.log('patientFileRawUploadTransport.test.mjs: PASS');
