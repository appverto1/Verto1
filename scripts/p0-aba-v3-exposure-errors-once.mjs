import { readFileSync, writeFileSync } from 'node:fs';
const file='server.ts';
const source=readFileSync(file,'utf8');
const anchor="    if (/IDEMPOTENCY.*CONFLICT|ABA_V3_REVISION_IDEMPOTENCY_CONFLICT/i.test(message)) {";
const addition=`    if (/ABA_V3_EXPOSURE_CONFLICTS_WITH_COLLECTED_TRIALS|ABA_V3_EXPOSURE_REQUIRES_V3_BINDING/i.test(message)) {
      return res.status(409).json({ success: false, code: 'ABA_V3_EXPOSURE_CONFLICT', conflict: true, error: 'Já existem tentativas para este alvo ou a sessão não usa coleta V3.' });
    }
`;
const schemaAnchor="resolve_aba_session_target_measurement_binding_v1|resolve_aba_behavior_collection_v3";
const schemaNext="resolve_aba_session_target_measurement_binding_v1|set_aba_session_target_exposure_v3|resolve_aba_behavior_collection_v3";
if(source.includes('ABA_V3_EXPOSURE_CONFLICTS_WITH_COLLECTED_TRIALS|ABA_V3_EXPOSURE_REQUIRES_V3_BINDING')) process.exit(0);
if(source.split(anchor).length!==2||source.split(schemaAnchor).length!==2)throw new Error('Expected ABA V3 error mapping anchors changed');
const next=source.replace(anchor,addition+anchor).replace(schemaAnchor,schemaNext);
if(next.length!==source.length+addition.length+(schemaNext.length-schemaAnchor.length))throw new Error('Unexpected patch length');
writeFileSync(file,next);
console.log('Patched ABA V3 exposure conflict schema mapping only');
