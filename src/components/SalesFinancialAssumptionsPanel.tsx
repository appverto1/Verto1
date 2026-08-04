import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  History,
  Loader2,
  Settings2,
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import {
  type SalesAssumptionSnapshot,
  type SalesAssumptionValues,
  type SalesUsageProfile,
  type SimulationValueSource,
} from '../utils/salesProfitability';
import { SalesPricingCatalogPanel } from './SalesPricingCatalogPanel';

type FieldDefinition = {
  key: keyof SalesAssumptionValues;
  label: string;
  type: 'currency' | 'percent' | 'count';
};

type AssumptionSetRecord = SalesAssumptionSnapshot & {
  createdAt?: string;
  createdBy?: string;
};

const basicFields: FieldDefinition[] = [
  {
    key: 'variablePatientCostCents',
    label: 'Custo variável por paciente',
    type: 'currency',
  },
  {
    key: 'variableClinicCostCents',
    label: 'Custo mensal por clínica',
    type: 'currency',
  },
  {
    key: 'monthlySupportClinicCostCents',
    label: 'Suporte mensal por clínica',
    type: 'currency',
  },
  {
    key: 'fixedMonthlyEligibleCostCents',
    label: 'Custos fixos elegíveis',
    type: 'currency',
  },
  {
    key: 'minimumMarginBasisPoints',
    label: 'Referência histórica de margem',
    type: 'percent',
  },
  {
    key: 'attentionMarginBasisPoints',
    label: 'Referência histórica de atenção',
    type: 'percent',
  },
  {
    key: 'healthyMarginBasisPoints',
    label: 'Meta de EBITDA atribuída',
    type: 'percent',
  },
];

const financialStatementFields: FieldDefinition[] = [
  {
    key: 'stripeFeeBasisPoints',
    label: 'Tarifa percentual da Stripe',
    type: 'percent',
  },
  {
    key: 'stripeFixedFeeCents',
    label: 'Tarifa fixa da Stripe por cobrança',
    type: 'currency',
  },
  {
    key: 'revenueTaxBasisPoints',
    label: 'Impostos sobre faturamento',
    type: 'percent',
  },
  {
    key: 'estimatedDelinquencyBasisPoints',
    label: 'Inadimplência estimada',
    type: 'percent',
  },
  {
    key: 'refundChargebackBasisPoints',
    label: 'Estornos e chargebacks',
    type: 'percent',
  },
  {
    key: 'depreciationAmortizationCents',
    label: 'Depreciação e amortização',
    type: 'currency',
  },
  {
    key: 'financialExpensesCents',
    label: 'Despesas financeiras',
    type: 'currency',
  },
  {
    key: 'profitTaxBasisPoints',
    label: 'Impostos sobre o lucro',
    type: 'percent',
  },
  {
    key: 'otherBelowEbitdaCents',
    label: 'Outras despesas abaixo do EBITDA',
    type: 'currency',
  },
];

const advancedGroups: Array<{
  title: string;
  description: string;
  fields: FieldDefinition[];
}> = [
  {
    title: 'Infraestrutura',
    description: 'Custos agregados atribuíveis ao uso da plataforma.',
    fields: [
      {
        key: 'storageCostCents',
        label: 'Armazenamento',
        type: 'currency',
      },
      {
        key: 'egressCostCents',
        label: 'Tráfego / egress',
        type: 'currency',
      },
      {
        key: 'processingCostCents',
        label: 'Processamento',
        type: 'currency',
      },
      {
        key: 'notificationCostCents',
        label: 'E-mails e notificações',
        type: 'currency',
      },
      {
        key: 'otherVariableCostCents',
        label: 'Outros custos variáveis',
        type: 'currency',
      },
    ],
  },
  {
    title: 'Atendimento e operação',
    description: 'Custos operacionais e comerciais da nova clínica.',
    fields: [
      {
        key: 'supportPatientCostCents',
        label: 'Suporte por paciente',
        type: 'currency',
      },
      {
        key: 'monthlyOperationalCostCents',
        label: 'Operacional atribuível',
        type: 'currency',
      },
      {
        key: 'defaultOnboardingCostCents',
        label: 'Onboarding padrão',
        type: 'currency',
      },
      {
        key: 'commercialCommissionBasisPoints',
        label: 'Comissão comercial',
        type: 'percent',
      },
    ],
  },
];

const usageProfileFields: FieldDefinition[] = [
  {
    key: 'variablePatientCostCents',
    label: 'Variável por paciente',
    type: 'currency',
  },
  {
    key: 'processingCostCents',
    label: 'Processamento',
    type: 'currency',
  },
  {
    key: 'notificationCostCents',
    label: 'Notificações',
    type: 'currency',
  },
  {
    key: 'monthlySupportClinicCostCents',
    label: 'Suporte por clínica',
    type: 'currency',
  },
];

const sourceLabels: Record<SimulationValueSource, string> = {
  actual: 'Real',
  calculated: 'Calculado',
  estimated: 'Estimado',
  manual: 'Manual',
  unavailable: 'Indisponível',
};

export const isValidFinancialAssumptionDraft = (
  value: string,
  type: FieldDefinition['type']
) => {
  if (value === '') return true;
  return type === 'count'
    ? /^\d*$/.test(value)
    : /^\d*(?:[,.]\d{0,2})?$/.test(value);
};

export const parseFinancialAssumptionInput = (
  value: string,
  type: FieldDefinition['type']
): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return type === 'count'
    ? Math.round(parsed)
    : Math.round(parsed * 100);
};

export const formatFinancialAssumptionInput = (
  value: unknown,
  type: FieldDefinition['type']
) => {
  if (value == null || value === '') return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  return type === 'count'
    ? String(parsed)
    : String(parsed / 100).replace('.', ',');
};

const formatDateTime = (value?: string) => {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data não informada';
  return date.toLocaleString('pt-BR');
};

const authenticatedFetch = async (
  url: string,
  init: RequestInit = {}
) => {
  const supabase = await getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error || 'Não foi possível concluir esta ação.'
    );
  }
  return data;
};

export const SalesFinancialAssumptionsPanel = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeSet, setActiveSet] =
    useState<AssumptionSetRecord | null>(null);
  const [history, setHistory] = useState<AssumptionSetRecord[]>([]);
  const [values, setValues] = useState<SalesAssumptionValues | null>(
    null
  );
  const [name, setName] = useState(
    `Premissas ${new Date().toLocaleDateString('pt-BR')}`
  );
  const [dirtyFields, setDirtyFields] = useState<
    Set<keyof SalesAssumptionValues>
  >(new Set());
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await authenticatedFetch(
          '/api/owner/sales/profitability-assumptions'
        );
        if (cancelled) return;
        const loadedActive = data.assumptionSet || null;
        setActiveSet(loadedActive);
        setHistory(data.assumptionSets || (loadedActive ? [loadedActive] : []));
        setValues(
          loadedActive?.values || data.editableTemplate || null
        );
        setDirtyFields(new Set());
        setInputDrafts({});
      } catch (loadError: any) {
        if (!cancelled) {
          setError(
            loadError?.message ||
              'Não foi possível carregar as premissas.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (
    field: FieldDefinition,
    rawValue: string
  ) => {
    if (!isValidFinancialAssumptionDraft(rawValue, field.type)) return;
    setInputDrafts((current) => ({
      ...current,
      [String(field.key)]: rawValue,
    }));
    setValues((current) =>
      current
        ? {
            ...current,
            [field.key]: parseFinancialAssumptionInput(rawValue, field.type),
          }
        : current
    );
    setDirtyFields((current) => new Set(current).add(field.key));
  };

  const updateUsageProfile = (
    profile: Exclude<SalesUsageProfile, 'custom'>,
    field: FieldDefinition,
    rawValue: string
  ) => {
    if (!isValidFinancialAssumptionDraft(rawValue, field.type)) return;
    const draftKey = `${profile}:${String(field.key)}`;
    setInputDrafts((current) => ({
      ...current,
      [draftKey]: rawValue,
    }));
    setValues((current) => {
      if (!current) return current;
      return {
        ...current,
        usageProfiles: {
          ...(current.usageProfiles || {}),
          [profile]: {
            ...(current.usageProfiles?.[profile] || {}),
            [field.key]: parseFinancialAssumptionInput(rawValue, field.type),
          },
        },
      };
    });
  };

  const getSource = (
    key: keyof SalesAssumptionValues
  ): SimulationValueSource => {
    if (dirtyFields.has(key)) {
      return values?.[key] == null ? 'unavailable' : 'manual';
    }
    return (
      activeSet?.sources?.[key] ||
      (values?.[key] == null ? 'unavailable' : 'manual')
    );
  };

  const save = async () => {
    if (!values || name.trim().length < 2) {
      setError('Informe um nome para a nova versão.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const sources = Object.fromEntries(
        Object.entries(values)
          .filter(([key]) => key !== 'usageProfiles')
          .map(([key, value]) => {
            const typedKey = key as keyof SalesAssumptionValues;
            const source =
              typedKey === 'officialUnitAmountCents'
                ? 'actual'
                : dirtyFields.has(typedKey)
                  ? value == null
                    ? 'unavailable'
                    : 'manual'
                  : activeSet?.sources?.[typedKey] ||
                    (value == null ? 'unavailable' : 'manual');
            return [key, source];
          })
      );
      const data = await authenticatedFetch(
        '/api/owner/sales/profitability-assumptions',
        {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            values,
            sourceMetadata: {
              basis: 'manual',
              sources,
              sourceDetails: {
                ...(activeSet?.sourceDetails || {}),
                officialUnitAmountCents:
                  'Preço público canônico por paciente ativo.',
              },
            },
          }),
        }
      );
      const saved = data.assumptionSet as AssumptionSetRecord;
      setActiveSet(saved);
      setValues(saved.values);
      setHistory((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setDirtyFields(new Set());
      setInputDrafts({});
      setNotice(`Versão ${saved.version} criada e ativada.`);
    } catch (saveError: any) {
      setError(
        saveError?.message ||
          'Não foi possível criar a nova versão.'
      );
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: FieldDefinition) => {
    const source = getSource(field.key);
    const draftKey = String(field.key);
    return (
      <label
        key={String(field.key)}
        className="min-w-0 text-xs font-medium text-slate-700"
      >
        {field.label}
        <div className="mt-1 flex min-h-11 items-center rounded-lg border border-slate-200 bg-white focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
          <span className="px-3 text-xs font-normal text-slate-400">
            {field.type === 'currency'
              ? 'R$'
              : field.type === 'percent'
                ? '%'
                : '#'}
          </span>
          <input
            inputMode="decimal"
            value={
              inputDrafts[draftKey]
              ?? formatFinancialAssumptionInput(values?.[field.key], field.type)
            }
            onChange={(event) =>
              updateField(field, event.target.value)
            }
            onBlur={() =>
              setInputDrafts((current) => {
                const next = { ...current };
                delete next[draftKey];
                return next;
              })
            }
            placeholder="Dado indisponível"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm font-normal outline-none"
          />
        </div>
        <span className="mt-1 flex items-center gap-1.5 text-[10px] font-normal text-slate-500">
          <span
            className={`size-1.5 rounded-full ${
              source === 'unavailable'
                ? 'bg-slate-300'
                : source === 'actual'
                  ? 'bg-emerald-500'
                  : 'bg-violet-400'
            }`}
          />
          {sourceLabels[source]}
        </span>
      </label>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-white text-sm text-slate-600">
        <Loader2 className="animate-spin text-violet-600" size={20} />
        Carregando premissas financeiras...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SalesPricingCatalogPanel />

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-violet-600">
              Configurações financeiras
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">
              Premissas de simulação comercial
            </h2>
            <p className="mt-2 text-sm font-normal leading-6 text-slate-600">
              Configure uma vez e reutilize automaticamente em todas as
              simulações. Cada salvamento cria uma versão imutável.
            </p>
          </div>
          <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
            <p className="text-[11px] font-medium text-violet-600">
              Versão ativa
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {activeSet
                ? `v${activeSet.version} · ${activeSet.name}`
                : 'Nenhuma versão configurada'}
            </p>
            {activeSet ? (
              <p className="mt-1 text-xs font-normal text-slate-500">
                Vigente desde {formatDateTime(activeSet.effectiveAt)}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
          <p>{notice}</p>
        </div>
      ) : null}

      {values ? (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
              <Settings2 size={19} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Configuração básica
              </h3>
              <p className="text-xs font-normal text-slate-500">
                Somente os dados essenciais para margens e classificação.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-normal leading-5 text-amber-900">
            Valores vazios permanecem indisponíveis. A Verto não cria
            estimativas automáticas nem mistura simulações com a DRE realizada.
          </div>

          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-normal leading-5 text-violet-900">
            Nas propostas modulares novas, a meta de EBITDA atribuída é um
            preço-alvo não bloqueante. Valores abaixo da meta geram aviso, mas
            não impedem salvar, publicar, aceitar ou enviar ao Stripe. As
            referências históricas permanecem disponíveis para simulações
            antigas.
          </div>

          <label className="mt-5 block text-xs font-medium text-slate-700">
            Nome da nova versão
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </label>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {basicFields.map(renderField)}
            <label className="text-xs font-medium text-slate-700">
              Método de rateio
              <select
                value={values.fixedAllocationMethod}
                onChange={(event) => {
                  setValues((current) =>
                    current
                      ? {
                          ...current,
                          fixedAllocationMethod:
                            event.target.value as SalesAssumptionValues['fixedAllocationMethod'],
                        }
                      : current
                  );
                  setDirtyFields((current) =>
                    new Set(current).add('fixedAllocationMethod')
                  );
                }}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              >
                <option value="none">Sem rateio</option>
                <option value="per_patient">Por paciente ativo</option>
                <option value="per_clinic">Por clínica</option>
                <option value="custom">Personalizado</option>
              </select>
              <span className="mt-1 block text-[10px] font-normal text-slate-500">
                {sourceLabels[getSource('fixedAllocationMethod')]}
              </span>
            </label>
            {values.fixedAllocationMethod === 'per_patient'
              ? renderField({
                  key: 'fixedAllocationPatientCount',
                  label: 'Pacientes na base de rateio',
                  type: 'count',
                })
              : null}
            {values.fixedAllocationMethod === 'per_clinic'
              ? renderField({
                  key: 'fixedAllocationClinicCount',
                  label: 'Clínicas na base de rateio',
                  type: 'count',
                })
              : null}
            {values.fixedAllocationMethod === 'custom'
              ? renderField({
                  key: 'customFixedAllocationCents',
                  label: 'Rateio mensal personalizado',
                  type: 'currency',
                })
              : null}
          </div>

          <div className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/40 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm">
                <Database size={18} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  DRE gerencial, perdas e lucro líquido
                </h3>
                <p className="mt-1 text-xs font-normal leading-5 text-slate-600">
                  Estes valores entram no cálculo do faturamento líquido, resultado operacional e lucro gerencial de cada clínica e de cada módulo. Impostos sobre o lucro são aplicados somente após depreciação, despesas financeiras e demais despesas corporativas.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {financialStatementFields.map(renderField)}
            </div>
          </div>

          <details className="group mt-6 rounded-xl border border-slate-200 bg-slate-50/50">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Configurações avançadas
                </span>
                <span className="block text-xs font-normal text-slate-500">
                  Infraestrutura detalhada, resultado gerencial e perfis de uso.
                </span>
              </span>
              <ChevronDown
                size={18}
                className="shrink-0 text-slate-500 transition group-open:rotate-180"
              />
            </summary>
            <div className="space-y-6 border-t border-slate-200 bg-white p-4">
              {advancedGroups.map((group) => (
                <fieldset key={group.title}>
                  <legend className="text-sm font-semibold text-slate-900">
                    {group.title}
                  </legend>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">
                    {group.description}
                  </p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.fields.map(renderField)}
                  </div>
                </fieldset>
              ))}

              <fieldset>
                <legend className="text-sm font-semibold text-slate-900">
                  Perfis de uso
                </legend>
                <p className="mt-0.5 text-xs font-normal text-slate-500">
                  Campos vazios herdam a premissa base. Nenhum perfil inventa
                  custos automaticamente.
                </p>
                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  {(
                    [
                      ['light', 'Uso leve'],
                      ['standard', 'Uso padrão'],
                      ['intensive', 'Uso intensivo'],
                    ] as const
                  ).map(([profile, label]) => (
                    <div
                      key={profile}
                      className="rounded-xl border border-slate-200 bg-slate-50/50 p-3"
                    >
                      <p className="text-xs font-semibold text-slate-800">
                        {label}
                      </p>
                      <div className="mt-3 space-y-3">
                        {usageProfileFields.map((field) => {
                          const draftKey = `${profile}:${String(field.key)}`;
                          return (
                          <label
                            key={`${profile}:${String(field.key)}`}
                            className="block text-[11px] font-medium text-slate-600"
                          >
                            {field.label}
                            <div className="mt-1 flex min-h-10 rounded-lg border border-slate-200 bg-white focus-within:border-violet-500">
                              <span className="px-2.5 py-2 text-xs text-slate-400">
                                R$
                              </span>
                              <input
                                inputMode="decimal"
                                value={
                                  inputDrafts[draftKey]
                                  ?? formatFinancialAssumptionInput(
                                    values.usageProfiles?.[profile]?.[
                                      field.key
                                    ],
                                    field.type
                                  )
                                }
                                onChange={(event) =>
                                  updateUsageProfile(
                                    profile,
                                    field,
                                    event.target.value
                                  )
                                }
                                onBlur={() =>
                                  setInputDrafts((current) => {
                                    const next = { ...current };
                                    delete next[draftKey];
                                    return next;
                                  })
                                }
                                placeholder="Herdar base"
                                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-xs font-normal outline-none"
                              />
                            </div>
                          </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>
          </details>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <Database size={17} />
              )}
              Criar nova versão
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <History size={18} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Histórico de versões
            </h3>
            <p className="text-xs font-normal text-slate-500">
              Versões anteriores permanecem ligadas às simulações já salvas.
            </p>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm font-normal text-slate-500">
            Nenhum conjunto de premissas foi criado.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {history.map((item, index) => (
              <article
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    v{item.version} · {item.name}
                  </p>
                  <p className="mt-1 text-xs font-normal text-slate-500">
                    Criada em {formatDateTime(item.createdAt)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    index === 0
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {index === 0 ? 'Versão ativa' : 'Histórica'}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
