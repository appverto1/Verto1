/**
 * ABA behavior catalogue shared between session UI and API.
 * A name describes observable topography; it does not imply behavioral function.
 * All presets are examples; clinicians must individualize operational definitions.
 */
export type AbaCatalogMethod = 'frequency' | 'duration' | 'partial_interval';
export type AbaCatalogPreset = {
  key: string;
  name: string;
  operationalDefinition: string;
  defaultMeasurement: AbaCatalogMethod;
  intervalSeconds: number;
  defaultSeverity: number;
};

export const ABA_CATALOG_PRESETS: readonly AbaCatalogPreset[] = [
  { key: 'crying', name: 'Choro', operationalDefinition: 'Episódio observável de choro, com vocalização ou lágrimas; registrar início e término conforme critério definido para o paciente.', defaultMeasurement: 'duration', intervalSeconds: 30, defaultSeverity: 2 },
  { key: 'screaming', name: 'Grito', operationalDefinition: 'Emissão vocal audível em intensidade elevada, acima da voz habitual do paciente, com início e término observáveis; definir os critérios específicos do caso.', defaultMeasurement: 'frequency', intervalSeconds: 30, defaultSeverity: 2 },
  { key: 'escape', name: 'Fuga da atividade', operationalDefinition: 'Afastamento físico da área de atividade definida, sem autorização, após apresentação de uma demanda; descrever a topografia antes de inferir função.', defaultMeasurement: 'duration', intervalSeconds: 30, defaultSeverity: 2 },
  { key: 'aggression', name: 'Agressão', operationalDefinition: 'Contato físico dirigido a outra pessoa, como bater, chutar ou morder; delimitar quais topografias entram nesta definição para o caso.', defaultMeasurement: 'frequency', intervalSeconds: 30, defaultSeverity: 2 },
  { key: 'self_injury', name: 'Autoagressão', operationalDefinition: 'Contato físico da pessoa consigo mesma com potencial de lesão; especificar os movimentos incluídos e os critérios de início/fim.', defaultMeasurement: 'frequency', intervalSeconds: 30, defaultSeverity: 2 },
  { key: 'refusal', name: 'Recusa', operationalDefinition: 'Ausência de início de resposta após solicitação definida durante uma janela de tempo estabelecida; individualizar a janela e evitar presumir função.', defaultMeasurement: 'frequency', intervalSeconds: 30, defaultSeverity: 2 },
  { key: 'stereotypy', name: 'Estereotipia', operationalDefinition: 'Movimento ou vocalização repetitiva, definida por topografia concreta e observável para o paciente, sem atribuição automática de função.', defaultMeasurement: 'partial_interval', intervalSeconds: 30, defaultSeverity: 2 },
];

export const ABA_CATALOG_METHODS: readonly AbaCatalogMethod[] = ['frequency', 'duration', 'partial_interval'];
export const isAbaCatalogMethod = (value: unknown): value is AbaCatalogMethod =>
  ABA_CATALOG_METHODS.includes(value as AbaCatalogMethod);

export const abaCatalogNameKey = (value: unknown) =>
  String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

export const abaCatalogPresetId = (key: string) => 'default:' + key;
export const abaCatalogStoredPresetId = (patientId: string, key: string) => 'preset:' + patientId + ':' + key;
export const abaCatalogPresetForId = (id: string) =>
  ABA_CATALOG_PRESETS.find((preset) => id === abaCatalogPresetId(preset.key));

export type AbaCatalogBehavior = {
  id: string;
  name: string;
  operationalDefinition: string;
  defaultMeasurement: AbaCatalogMethod;
  allowedMeasurements: AbaCatalogMethod[];
  intervalSeconds: number;
  defaultSeverity: number;
  status: 'active' | 'archived';
  isPreset: boolean;
  presetKey: string | null;
};

export const mergeAbaBehaviorCatalog = (patientId: string, stored: any[], includeArchived = false): AbaCatalogBehavior[] => {
  const rows = Array.isArray(stored) ? stored : [];
  const byPreset = new Map<string, any>();
  const custom: any[] = [];
  for (const row of rows) {
    const key = String(row.id || '');
    const preset = ABA_CATALOG_PRESETS.find((item) =>
      key === abaCatalogStoredPresetId(patientId, item.key)
      || abaCatalogNameKey(row.name) === abaCatalogNameKey(item.name));
    if (preset && !byPreset.has(preset.key)) byPreset.set(preset.key, row);
    else custom.push(row);
  }
  const fromRow = (row: any, preset?: AbaCatalogPreset): AbaCatalogBehavior => {
    const method = isAbaCatalogMethod(row.measurement_type)
      ? row.measurement_type : (preset?.defaultMeasurement || 'frequency');
    return {
      id: String(row.id),
      name: String(row.name || preset?.name || ''),
      operationalDefinition: String(row.operational_definition || preset?.operationalDefinition || ''),
      defaultMeasurement: method,
      allowedMeasurements: Array.from(new Set<AbaCatalogMethod>([method, 'partial_interval'])),
      intervalSeconds: Math.min(3600, Math.max(5, Number(row.interval_seconds || preset?.intervalSeconds || 30))),
      defaultSeverity: Math.min(5, Math.max(1, Number(row.default_severity || preset?.defaultSeverity || 2))),
      status: row.status !== 'active' || row.is_active === false ? 'archived' : 'active',
      isPreset: Boolean(preset),
      presetKey: preset?.key || null,
    };
  };
  const presets = ABA_CATALOG_PRESETS.map((preset) => {
    const row = byPreset.get(preset.key);
    return row
      ? fromRow(row, preset)
      : {
          id: abaCatalogPresetId(preset.key), name: preset.name,
          operationalDefinition: preset.operationalDefinition,
          defaultMeasurement: preset.defaultMeasurement,
          allowedMeasurements: Array.from(new Set<AbaCatalogMethod>([preset.defaultMeasurement, 'partial_interval'])),
          intervalSeconds: preset.intervalSeconds, defaultSeverity: preset.defaultSeverity,
          status: 'active' as const, isPreset: true, presetKey: preset.key,
        };
  });
  return [...presets, ...custom.map((row) => fromRow(row))]
    .filter((item) => includeArchived || item.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
};
