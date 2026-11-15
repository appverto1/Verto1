import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABA_CATALOG_PRESETS,
  abaCatalogNameKey,
  abaCatalogPresetId,
  abaCatalogStoredPresetId,
  isAbaCatalogMethod,
  mergeAbaBehaviorCatalog,
} from '../src/utils/abaBehaviorCatalog';

const patientId = '11111111-1111-4111-8111-111111111111';

test('presets include Grito, clinical topography definitions and interval-partial access', () => {
  assert.equal(ABA_CATALOG_PRESETS.some((preset) => preset.key === 'screaming' && preset.name === 'Grito'), true);
  assert.equal(ABA_CATALOG_PRESETS.every((preset) => preset.operationalDefinition.length > 30), true);
  const rows = mergeAbaBehaviorCatalog(patientId, []);
  assert.equal(rows.length, ABA_CATALOG_PRESETS.length);
  for (const row of rows) {
    assert.equal(row.allowedMeasurements.includes('partial_interval'), true, row.name);
    assert.equal(row.status, 'active');
    assert.equal(row.isPreset, true);
  }
});

test('overrides standard behavior without duplicating or losing its preset identity', () => {
  const row = {
    id: abaCatalogStoredPresetId(patientId, 'screaming'),
    name: 'Grito forte',
    operational_definition: 'Som vocal agudo e prolongado ouvido a pelo menos três metros',
    measurement_type: 'duration',
    interval_seconds: 20,
    default_severity: 4,
    status: 'active',
    is_active: true,
  };
  const rows = mergeAbaBehaviorCatalog(patientId, [row]);
  assert.equal(rows.filter((item) => item.presetKey === 'screaming').length, 1);
  const result = rows.find((item) => item.presetKey === 'screaming');
  assert.equal(result?.name, 'Grito forte');
  assert.equal(result?.defaultMeasurement, 'duration');
  assert.equal(result?.defaultSeverity, 4);
  assert.equal(result?.intervalSeconds, 20);
  assert.deepEqual(result?.allowedMeasurements, ['duration', 'partial_interval']);
});

test('soft archival preserves catalog entry for reactivation but removes it from active dock', () => {
  const row = {
    id: abaCatalogStoredPresetId(patientId, 'crying'),
    name: 'Choro',
    operational_definition: 'Episódio de choro observável',
    measurement_type: 'duration',
    interval_seconds: 30,
    default_severity: 2,
    status: 'archived',
    is_active: false,
  };
  assert.equal(mergeAbaBehaviorCatalog(patientId, [row]).some((item) => item.presetKey === 'crying'), false);
  assert.equal(mergeAbaBehaviorCatalog(patientId, [row], true).some((item) =>
    item.presetKey === 'crying' && item.status === 'archived'), true);
});

test('each patient has an independent deterministic default override identity', () => {
  assert.equal(abaCatalogPresetId('crying'), 'default:crying');
  assert.notEqual(abaCatalogStoredPresetId(patientId, 'crying'),
    abaCatalogStoredPresetId('22222222-2222-4222-8222-222222222222', 'crying'));
  assert.equal(abaCatalogNameKey('  GRITO    FORTE '), abaCatalogNameKey('grito forte'));
});

test('clinical data collection methods are strictly bounded', () => {
  assert.equal(isAbaCatalogMethod('frequency'), true);
  assert.equal(isAbaCatalogMethod('duration'), true);
  assert.equal(isAbaCatalogMethod('partial_interval'), true);
  assert.equal(isAbaCatalogMethod('abc'), false);
  assert.equal(isAbaCatalogMethod('total_interval'), false);
});
