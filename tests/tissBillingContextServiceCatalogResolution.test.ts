import assert from 'node:assert/strict';
import {
  resolveAuthoritativeHistoricalTissServiceCatalogId,
  resolveBillingContextServiceCatalogId,
  resolveUniqueTissServiceCatalogOptionByCode,
} from '../src/utils/tissServiceCatalogResolution';

const psychologyServiceId = '11111111-1111-4111-8111-111111111111';
const alternateServiceId = '22222222-2222-4222-8222-222222222222';

const psychologyMapping = {
  serviceCatalogId: psychologyServiceId,
  payerTussMappingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tussCode: '50000470',
  serviceName: 'Sessão de psicoterapia individual por psicólogo',
};

const exactResolution = resolveUniqueTissServiceCatalogOptionByCode(
  [psychologyMapping],
  ' 50000470 ',
);
assert.equal(exactResolution.status, 'resolved');
assert.equal(exactResolution.serviceCatalogId, psychologyServiceId);
assert.equal(exactResolution.option, psychologyMapping);
assert.equal(exactResolution.candidates.length, 1);

const duplicateMappingForSameService = {
  ...psychologyMapping,
  payerTussMappingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const deduplicatedResolution = resolveUniqueTissServiceCatalogOptionByCode(
  [psychologyMapping, duplicateMappingForSameService],
  '50000470',
);
assert.equal(deduplicatedResolution.status, 'resolved');
assert.equal(deduplicatedResolution.serviceCatalogId, psychologyServiceId);
assert.equal(deduplicatedResolution.candidates.length, 1);

const ambiguousResolution = resolveUniqueTissServiceCatalogOptionByCode(
  [
    psychologyMapping,
    {
      ...psychologyMapping,
      serviceCatalogId: alternateServiceId,
      payerTussMappingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      serviceName: 'Outro procedimento com o mesmo código',
    },
  ],
  '50000470',
);
assert.equal(ambiguousResolution.status, 'ambiguous');
assert.equal(ambiguousResolution.option, null);
assert.equal(ambiguousResolution.serviceCatalogId, null);
assert.equal(ambiguousResolution.candidates.length, 2);

const missingCodeResolution = resolveUniqueTissServiceCatalogOptionByCode(
  [psychologyMapping],
  '',
);
assert.deepEqual(missingCodeResolution, {
  status: 'missing',
  option: null,
  serviceCatalogId: null,
  candidates: [],
});

const unmatchedCodeResolution = resolveUniqueTissServiceCatalogOptionByCode(
  [psychologyMapping],
  '50000471',
);
assert.equal(unmatchedCodeResolution.status, 'missing');

const internalCodeResolution = resolveUniqueTissServiceCatalogOptionByCode(
  [{ ...psychologyMapping, tussCode: null, internalCode: 'PSICO' }],
  'psico',
);
assert.equal(internalCodeResolution.status, 'resolved');
assert.equal(internalCodeResolution.serviceCatalogId, psychologyServiceId);

const officialCodePreservedWhenAuthorizedDiffers = resolveUniqueTissServiceCatalogOptionByCode(
  [{
    ...psychologyMapping,
    tussCode: 'CONTRATO-PSICO',
    authorizedCode: 'CONTRATO-PSICO',
    officialTussCode: '50000470',
  }],
  '50000470',
);
assert.equal(officialCodePreservedWhenAuthorizedDiffers.status, 'resolved');
assert.equal(officialCodePreservedWhenAuthorizedDiffers.serviceCatalogId, psychologyServiceId);

const authorizedCodeAlsoResolves = resolveUniqueTissServiceCatalogOptionByCode(
  [{
    ...psychologyMapping,
    tussCode: 'CONTRATO-PSICO',
    authorizedCode: 'CONTRATO-PSICO',
    officialTussCode: '50000470',
  }],
  'CONTRATO-PSICO',
);
assert.equal(authorizedCodeAlsoResolves.status, 'resolved');
assert.equal(authorizedCodeAlsoResolves.serviceCatalogId, psychologyServiceId);

assert.equal(
  resolveBillingContextServiceCatalogId({ metadata: { service_catalog_id: psychologyServiceId } }),
  psychologyServiceId,
);
assert.equal(
  resolveBillingContextServiceCatalogId({
    metadata: JSON.stringify({ tiss_authorization: { serviceCatalogId: psychologyServiceId } }),
  }),
  psychologyServiceId,
);
assert.equal(resolveBillingContextServiceCatalogId({ metadata: '{invalid-json' }), '');
assert.equal(
  resolveAuthoritativeHistoricalTissServiceCatalogId({
    status: 'pending',
    service_catalog_id: psychologyServiceId,
    readiness_reasons: ['missing_tuss_mapping'],
  }),
  psychologyServiceId,
);
assert.equal(
  resolveAuthoritativeHistoricalTissServiceCatalogId({
    status: 'pending',
    service_catalog_id: psychologyServiceId,
    readiness_reasons: ['missing_service_catalog'],
  }),
  '',
);
assert.equal(
  resolveAuthoritativeHistoricalTissServiceCatalogId({
    status: 'ready',
    service_catalog_id: psychologyServiceId,
    readiness_reasons: ['missing_service_catalog'],
  }),
  psychologyServiceId,
);
assert.equal(
  resolveAuthoritativeHistoricalTissServiceCatalogId({
    status: 'pending',
    service_catalog_id: psychologyServiceId,
    readiness_reasons: ['missing_amount'],
  }),
  psychologyServiceId,
);
assert.equal(
  resolveAuthoritativeHistoricalTissServiceCatalogId({
    status: 'ready',
    service_catalog_id: psychologyServiceId,
    readiness_reasons: [],
  }),
  psychologyServiceId,
);

console.log('tissBillingContextServiceCatalogResolution: ok');
