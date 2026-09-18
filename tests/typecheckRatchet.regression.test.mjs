import assert from 'node:assert/strict';
import {
  diagnosticSignature,
  findNewTypeScriptDiagnostics,
  parseTypeScriptDiagnostics,
} from '../scripts/typecheck-ratchet.mjs';

const diag = (file, line, column, code, message, detail = '') =>
  `${file}(${line},${column}): error ${code}: ${message}${detail ? `\n  ${detail}` : ''}`;

const baseOne = diag('src/example.ts', 10, 2, 'TS2339', "Property 'x' does not exist on type 'Y'.");
const shiftedOne = diag('src/example.ts', 45, 19, 'TS2339', "Property 'x' does not exist on type 'Y'.");

assert.equal(
  findNewTypeScriptDiagnostics(shiftedOne, baseOne).length,
  0,
  'line/column shifts must not create a new diagnostic',
);

const movedAgain = diag('src/example.ts', 200, 1, 'TS2339', "Property 'x' does not exist on type 'Y'.");
assert.equal(
  findNewTypeScriptDiagnostics(movedAgain, baseOne).length,
  0,
  'same semantic diagnostic moved within the same file must remain baseline debt',
);

const newSignature = diag('src/example.ts', 12, 3, 'TS2322', "Type 'number' is not assignable to type 'string'.");
assert.deepEqual(
  findNewTypeScriptDiagnostics(`${baseOne}\n${newSignature}`, baseOne).map((item) => item.code),
  ['TS2322'],
  'a genuinely new signature must fail',
);

const duplicateCandidate = `${baseOne}\n${diag('src/example.ts', 30, 7, 'TS2339', "Property 'x' does not exist on type 'Y'.")}`;
assert.equal(
  findNewTypeScriptDiagnostics(duplicateCandidate, baseOne).length,
  1,
  'baseline count 1 -> candidate count 2 must report exactly one excess diagnostic',
);

assert.equal(
  findNewTypeScriptDiagnostics(baseOne, `${baseOne}\n${newSignature}`).length,
  0,
  'removing baseline diagnostics must pass and reduce debt',
);

const otherFile = diag('src/other.ts', 10, 2, 'TS2339', "Property 'x' does not exist on type 'Y'.");
assert.equal(
  findNewTypeScriptDiagnostics(otherFile, baseOne).length,
  1,
  'the same code/message in another file is a distinct diagnostic',
);

const otherCode = diag('src/example.ts', 10, 2, 'TS2551', "Property 'x' does not exist on type 'Y'.");
assert.equal(
  findNewTypeScriptDiagnostics(otherCode, baseOne).length,
  1,
  'the same file/message with another TS code is a distinct diagnostic',
);

const detailedBase = diag(
  'src/detail.ts',
  4,
  5,
  'TS2677',
  "A type predicate's type must be assignable to its parameter's type.",
  "Type 'A' is not assignable to type 'B'.",
);
const detailedShifted = diag(
  'src/detail.ts',
  99,
  8,
  'TS2677',
  "A type predicate's type must be assignable to its parameter's type.",
  "Type   'A'   is not assignable to type 'B'.",
);
assert.equal(
  findNewTypeScriptDiagnostics(detailedShifted, detailedBase).length,
  0,
  'message whitespace is normalized while semantic detail remains part of identity',
);

const parsed = parseTypeScriptDiagnostics(baseOne)[0];
assert.equal(parsed.file, 'src/example.ts');
assert.equal(parsed.code, 'TS2339');
assert.equal(
  diagnosticSignature(parsed),
  diagnosticSignature({ ...parsed, line: 999, column: 999 }),
  'signature must be independent of line/column',
);

assert.throws(
  () => findNewTypeScriptDiagnostics('not a TypeScript diagnostic', baseOne),
  /no TypeScript diagnostics could be parsed/,
  'unexpected candidate log format must fail closed',
);

console.log('typecheckRatchet.regression.test.mjs: PASS');
