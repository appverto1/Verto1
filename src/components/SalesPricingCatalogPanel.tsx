import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileClock,
  Loader2,
  PackageCheck
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import type {
  SalesPricingCatalogItem,
  SalesPricingCatalogSnapshot,
  SalesPricingCostModel,
  SalesSharedAllocationMethod
} from '../utils/salesModularProposal';

type CatalogVersion = {
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  effective_at: string;
  published_at?: string | null;
};

type ProfitabilityRow = {
  item_key: string;
  public_name: string;
  simulated_count: number;
  proposed_count: number;
  average_proposed_revenue_cents: number | null;
  average_direct_cost_cents: number | null;
  average_ebitda_cents: number | null;
  average_ebitda_margin_basis_points: number | null;
  minimum_ebitda_margin_basis_points: number | null;
  maximum_ebitda_margin_basis_points: number | null;
  selected_basis_points: number | null;
  proposed_basis_points: number | null;
  has_insufficient_data: boolean;
};

const money = (value: number | null | undefined) =>
  value == null
    ? 'Dados insuficientes'
    : (value / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });

const percent = (value: number | null | undefined) =>
  value == null
    ? 'Dados insuficientes'
    : `${(value / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}%`;

const key = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

const nullableCurrencyInput = (value: unknown) =>
  value === '' || value === null || value === undefined
    ? null
    : Math.round(Number(value) * 100);

const costFields: Array<{
  key: keyof SalesPricingCostModel;
  label: string;
}> = [
  ['directFixedMonthlyCostCents', 'Fixo mensal direto'],
  ['directCostPerPatientCents', 'Por paciente'],
  ['directCostPerClinicCents', 'Por clínica'],
  ['directCostPerUsageUnitCents', 'Por unidade de uso'],
  ['storageCostPerGbCents', 'Armazenamento por GB'],
  ['egressCostPerGbCents', 'Egress por GB'],
  ['notificationCostPerUnitCents', 'Notificação por unidade'],
  ['processingCostPerUnitCents', 'Processamento por unidade'],
  ['supportFixedMonthlyCostCents', 'Suporte fixo mensal'],
  ['supportCostPerPatientCents', 'Suporte por paciente'],
  ['operationalFixedMonthlyCostCents', 'Operacional fixo mensal'],
  ['onboardingCostCents', 'Custo de implantação']
].map(([fieldKey, label]) => ({
  key: fieldKey as keyof SalesPricingCostModel,
  label: String(label)
}));

export const SalesPricingCatalogPanel = () => {
  const [catalog, setCatalog] =
    useState<(SalesPricingCatalogSnapshot & { metadata?: any }) | null>(null);
  const [versions, setVersions] = useState<CatalogVersion[]>([]);
  const [report, setReport] = useState<ProfitabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [migrationPending, setMigrationPending] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [allocationDraft, setAllocationDraft] = useState<
    SalesPricingCatalogSnapshot['allocationSettings'] | null
  >(null);
  const [costDrafts, setCostDrafts] = useState<
    Record<string, Record<string, any>>
  >({});

  const authenticatedFetch = async (
    url: string,
    init: RequestInit = {}
  ) => {
    const supabase = await getSupabase();
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      const requestError = new Error(
        data?.error || 'Não foi possível concluir esta ação.'
      );
      (requestError as any).code = data?.code;
      throw requestError;
    }
    return data;
  };

  const setCatalogData = (data: any) => {
    const loadedCatalog = data.catalog || null;
    setCatalog(loadedCatalog);
    setVersions(data.versions || []);
    setReport(data.profitabilityByFeature || []);
    setDraftName(
      loadedCatalog?.status === 'draft' ? loadedCatalog.name || '' : ''
    );
    setAllocationDraft(loadedCatalog?.allocationSettings || null);
    const nextCosts: Record<string, Record<string, any>> = {};
    for (const item of loadedCatalog?.items || []) {
      const model = item.costModel || {};
      nextCosts[item.id] = {
        ...model,
        costSource: model.costSource || 'unavailable',
        sourceDetail:
          model.sourceDetail || 'Custo por funcionalidade ainda não informado.',
        sharedCostAllocationWeight:
          model.sharedCostAllocationWeight == null
            ? 1
            : Number(model.sharedCostAllocationWeight)
      };
      for (const field of costFields) {
        nextCosts[item.id][field.key] =
          model[field.key] == null ? '' : Number(model[field.key]) / 100;
      }
    }
    setCostDrafts(nextCosts);
  };

  const load = async (versionId?: string) => {
    setLoading(true);
    setError('');
    try {
      const query = versionId
        ? `?versionId=${encodeURIComponent(versionId)}`
        : '';
      const data = await authenticatedFetch(
        `/api/owner/sales/pricing-catalogs${query}`
      );
      setCatalogData(data);
      setMigrationPending(false);
    } catch (loadError: any) {
      if (loadError?.code === 'PRICING_CATALOG_NOT_FOUND') {
        setMigrationPending(true);
      } else {
        setError(loadError?.message || 'Não foi possível carregar o catálogo.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const activeVersion = useMemo(
    () => versions.find((version) => version.status === 'active') || null,
    [versions]
  );

  const cloneCatalog = async () => {
    if (!activeVersion) return;
    setBusy('clone');
    setError('');
    try {
      const data = await authenticatedFetch(
        '/api/owner/sales/pricing-catalogs/clone',
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': key('catalog-clone') },
          body: JSON.stringify({
            sourceVersionId: activeVersion.id,
            name: `Catálogo comercial v${Math.max(
              1,
              ...versions.map((version) => version.version + 1)
            )}`
          })
        }
      );
      await load(data.catalogVersion.id);
      setNotice('Rascunho criado. A versão ativa continua inalterada.');
    } catch (cloneError: any) {
      setError(cloneError?.message || 'Não foi possível criar o rascunho.');
    } finally {
      setBusy('');
    }
  };

  const saveDraftAction = async (
    action: 'version' | 'item' | 'tier' | 'cost_model',
    payload: Record<string, any>,
    actionKey: string
  ) => {
    if (!catalog || catalog.status !== 'draft') return;
    setBusy(actionKey);
    setError('');
    setNotice('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/pricing-catalogs/${encodeURIComponent(catalog.id)}`,
        {
          method: 'PATCH',
          headers: { 'X-Idempotency-Key': key(`catalog-${action}`) },
          body: JSON.stringify({ action, payload })
        }
      );
      await load(catalog.id);
      setNotice('Rascunho salvo com histórico de auditoria.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o rascunho.');
    } finally {
      setBusy('');
    }
  };

  const publishCatalog = async () => {
    if (!catalog || catalog.status !== 'draft') return;
    setBusy('publish');
    setError('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/pricing-catalogs/${encodeURIComponent(catalog.id)}/publish`,
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': key('catalog-publish') },
          body: JSON.stringify({})
        }
      );
      await load(catalog.id);
      setNotice(
        'Catálogo publicado. Propostas históricas continuam no snapshot anterior.'
      );
    } catch (publishError: any) {
      setError(publishError?.message || 'Não foi possível publicar.');
    } finally {
      setBusy('');
    }
  };

  const saveCost = async (item: SalesPricingCatalogItem) => {
    const draft = costDrafts[item.id] || {};
    const payload: Record<string, any> = {
      itemId: item.id,
      costSource: draft.costSource || 'unavailable',
      sourceDetail:
        String(draft.sourceDetail || '').trim() ||
        'Custo por funcionalidade ainda não informado.',
      sharedCostAllocationWeight: Number(
        draft.sharedCostAllocationWeight || 0
      )
    };
    for (const field of costFields) {
      payload[field.key] = nullableCurrencyInput(draft[field.key]);
    }
    await saveDraftAction(
      'cost_model',
      payload,
      `cost:${item.id}`
    );
  };

  const allocationFields: Array<{
    key: keyof SalesPricingCatalogSnapshot['allocationSettings'];
    label: string;
  }> = [
    { key: 'stripePercentage', label: 'Tarifa percentual Stripe' },
    { key: 'stripeFixed', label: 'Tarifa fixa Stripe' },
    { key: 'revenueTax', label: 'Imposto sobre faturamento' },
    { key: 'delinquency', label: 'Inadimplência' },
    { key: 'sharedPlatformCosts', label: 'Custos compartilhados' },
    { key: 'belowEbitda', label: 'Despesas abaixo do EBITDA' }
  ];
  const allocationOptions: Array<{
    value: SalesSharedAllocationMethod;
    label: string;
  }> = [
    { value: 'net_revenue', label: 'Receita líquida' },
    { value: 'gross_revenue', label: 'Receita bruta' },
    { value: 'configured_weight', label: 'Peso por funcionalidade' },
    { value: 'base_package', label: 'Somente pacote-base' },
    { value: 'none', label: 'Sem alocação' },
    { value: 'custom', label: 'Personalizado por peso' }
  ];

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex min-h-32 items-center justify-center gap-3 text-sm text-slate-600">
          <Loader2 className="animate-spin text-violet-600" size={19} />
          Carregando catálogo modular...
        </div>
      </section>
    );
  }

  if (migrationPending) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <FileClock className="mt-0.5 shrink-0 text-amber-700" size={19} />
          <div>
            <h2 className="text-base font-semibold text-amber-950">
              Catálogo modular aguardando migration
            </h2>
            <p className="mt-1 text-sm font-normal leading-6 text-amber-900">
              As premissas legadas continuam disponíveis. Aplique manualmente a
              migration 20260727030000 para liberar catálogo, custos e propostas
              modulares.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!catalog) return null;

  return (
    <>
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium text-violet-700">
              Catálogo comercial versionado
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">
              Pacotes, módulos e custos por funcionalidade
            </h2>
            <p className="mt-2 max-w-3xl text-sm font-normal leading-6 text-slate-600">
              Edite somente em rascunhos. Publicações ficam imutáveis e cada
              proposta preserva preços, limites, custos e resultados.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={catalog.id}
              onChange={(event) => void load(event.target.value)}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700"
              aria-label="Versão do catálogo"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version} · {version.name} · {version.status}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void cloneCatalog()}
              disabled={Boolean(busy) || !activeVersion}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-4 text-sm font-medium text-violet-700 disabled:opacity-50"
            >
              {busy === 'clone' ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Copy size={16} />
              )}
              Nova versão
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              catalog.status === 'active'
                ? 'bg-emerald-100 text-emerald-800'
                : catalog.status === 'draft'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-200 text-slate-700'
            }`}
          >
            v{catalog.version} ·{' '}
            {catalog.status === 'active'
              ? 'Ativa'
              : catalog.status === 'draft'
                ? 'Rascunho'
                : 'Histórica'}
          </span>
          <span className="text-xs font-normal text-slate-500">
            Vigência:{' '}
            {new Date(catalog.effectiveAt).toLocaleString('pt-BR')}
          </span>
          <span className="text-xs font-normal text-slate-500">
            {catalog.items.length} itens carregados em lote
          </span>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}
        {notice ? (
          <div
            role="status"
            className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
            {notice}
          </div>
        ) : null}
      </section>

      {catalog.status === 'draft' ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <label className="w-full max-w-lg text-sm font-medium text-slate-700">
              Nome da versão
              <input
                value={draftName}
                maxLength={120}
                onChange={(event) => setDraftName(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void saveDraftAction(
                    'version',
                    {
                      name: draftName,
                      allocationSettings: allocationDraft
                    },
                    'version'
                  )
                }
                disabled={Boolean(busy) || draftName.trim().length < 2}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                <Database size={16} /> Salvar versão
              </button>
              <button
                type="button"
                onClick={() => void publishCatalog()}
                disabled={Boolean(busy)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === 'publish' ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <PackageCheck size={16} />
                )}
                Publicar versão
              </button>
            </div>
          </div>
          {allocationDraft ? (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-slate-800">
                Critérios de alocação
              </legend>
              <p className="mt-1 text-xs font-normal text-slate-600">
                O resíduo de centavos continua sempre no pacote-base.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {allocationFields.map((field) => (
                  <label
                    key={field.key}
                    className="text-xs font-medium text-slate-600"
                  >
                    {field.label}
                    <select
                      value={allocationDraft[field.key]}
                      onChange={(event) =>
                        setAllocationDraft((current) =>
                          current
                            ? {
                                ...current,
                                [field.key]: event.target
                                  .value as SalesSharedAllocationMethod
                              }
                            : current
                        )
                      }
                      className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                    >
                      {allocationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">
          Itens do catálogo
        </h3>
        <p className="mt-1 text-sm font-normal text-slate-500">
          Valores comerciais em reais; custos ausentes permanecem indisponíveis.
        </p>
        <div className="mt-4 space-y-4">
          {catalog.items.map((item) => {
            const costDraft = costDrafts[item.id] || {};
            return (
              <details
                key={item.id}
                className="group rounded-2xl border border-slate-200 bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {item.publicName}
                    </p>
                    <p className="mt-1 text-xs font-normal text-slate-500">
                      {item.pricingMode} ·{' '}
                      {item.costModel?.costSource === 'unavailable'
                        ? 'custo indisponível'
                        : `custo ${item.costModel?.costSource || 'não informado'}`}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-violet-700">
                    Ver preços e custos
                  </span>
                </summary>
                <div className="border-t border-slate-100 p-4">
                  {item.tiers.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-[620px] w-full text-left text-xs">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="pb-2 font-medium">Faixa</th>
                            <th className="pb-2 font-medium">Mínimo</th>
                            <th className="pb-2 font-medium">Máximo</th>
                            <th className="pb-2 font-medium">Preço mensal</th>
                            <th className="pb-2 font-medium" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {item.tiers.map((tier) => (
                            <tr key={tier.id}>
                              <td className="py-2 pr-2 font-medium text-slate-800">
                                {tier.publicName}
                              </td>
                              <td className="py-2 pr-2">{tier.minimumQuantity}</td>
                              <td className="py-2 pr-2">
                                {tier.maximumQuantity ?? 'Personalizado'}
                              </td>
                              <td className="py-2 pr-2">
                                {tier.recurringAmountCents == null
                                  ? 'Personalizado'
                                  : money(tier.recurringAmountCents)}
                              </td>
                              <td className="py-2 text-right">
                                {catalog.status === 'draft' &&
                                !tier.isCustom ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const raw = window.prompt(
                                        `Novo preço mensal de ${tier.publicName} (R$)`,
                                        String(
                                          Number(
                                            tier.recurringAmountCents || 0
                                          ) / 100
                                        )
                                      );
                                      if (raw === null) return;
                                      void saveDraftAction(
                                        'tier',
                                        {
                                          tierId: tier.id,
                                          recurringAmountCents:
                                            nullableCurrencyInput(raw)
                                        },
                                        `tier:${tier.id}`
                                      );
                                    }}
                                    disabled={Boolean(busy)}
                                    className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 font-medium text-violet-700"
                                  >
                                    Editar preço
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                      <span className="text-slate-600">
                        Valor configurado:{' '}
                        {item.billingInterval === 'one_time'
                          ? money(item.oneTimeAmountCents)
                          : money(item.recurringAmountCents)}
                      </span>
                      {catalog.status === 'draft' &&
                      item.itemKey !== 'onboarding' ? (
                        <button
                          type="button"
                          onClick={() => {
                            const raw = window.prompt(
                              `Novo valor de ${item.publicName} (R$)`,
                              String(
                                Number(
                                  item.billingInterval === 'one_time'
                                    ? item.oneTimeAmountCents || 0
                                    : item.recurringAmountCents || 0
                                ) / 100
                              )
                            );
                            if (raw === null) return;
                            void saveDraftAction(
                              'item',
                              {
                                itemId: item.id,
                                [item.billingInterval === 'one_time'
                                  ? 'oneTimeAmountCents'
                                  : 'recurringAmountCents']:
                                  nullableCurrencyInput(raw)
                              },
                              `item:${item.id}`
                            );
                          }}
                          className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-violet-700"
                        >
                          Editar preço
                        </button>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {costFields.map((field) => (
                        <label
                          key={String(field.key)}
                          className="text-xs font-medium text-slate-600"
                        >
                          {field.label}
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={catalog.status !== 'draft'}
                            value={
                              costDraft[field.key] == null
                                ? ''
                                : costDraft[field.key]
                            }
                            onChange={(event) =>
                              setCostDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...current[item.id],
                                  [field.key]: event.target.value
                                }
                              }))
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                          />
                        </label>
                      ))}
                      <label className="text-xs font-medium text-slate-600">
                        Origem
                        <select
                          disabled={catalog.status !== 'draft'}
                          value={costDraft.costSource || 'unavailable'}
                          onChange={(event) =>
                            setCostDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                costSource: event.target.value
                              }
                            }))
                          }
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                        >
                          <option value="unavailable">Indisponível</option>
                          <option value="actual">Real</option>
                          <option value="calculated">Calculado</option>
                          <option value="estimated">Estimado</option>
                          <option value="manual">Manual</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        Peso de rateio
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          disabled={catalog.status !== 'draft'}
                          value={costDraft.sharedCostAllocationWeight ?? 1}
                          onChange={(event) =>
                            setCostDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                sharedCostAllocationWeight: event.target.value
                              }
                            }))
                          }
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                        Fonte e critério
                        <input
                          disabled={catalog.status !== 'draft'}
                          maxLength={500}
                          value={costDraft.sourceDetail || ''}
                          onChange={(event) =>
                            setCostDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                sourceDetail: event.target.value
                              }
                            }))
                          }
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                        />
                      </label>
                    </div>
                    {catalog.status === 'draft' ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void saveCost(item)}
                          disabled={Boolean(busy)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {busy === `cost:${item.id}` ? (
                            <Loader2 className="animate-spin" size={15} />
                          ) : (
                            <Database size={15} />
                          )}
                          Criar versão do custo
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-violet-700">
              Rentabilidade por funcionalidade
            </p>
            <h3 className="mt-1 text-base font-semibold text-slate-900">
              Simulado e proposto
            </h3>
            <p className="mt-1 text-sm font-normal text-slate-500">
              Não representa contratação nem receita realizada.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            Sem DRE realizada
          </span>
        </div>
        {report.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
            O relatório será preenchido quando existirem cenários salvos.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[980px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Funcionalidade</th>
                  <th className="px-3 py-2 font-medium">Simulados</th>
                  <th className="px-3 py-2 font-medium">Propostos</th>
                  <th className="px-3 py-2 font-medium">Receita média</th>
                  <th className="px-3 py-2 font-medium">Custo direto</th>
                  <th className="px-3 py-2 font-medium">EBITDA</th>
                  <th className="px-3 py-2 font-medium">Margem média</th>
                  <th className="px-3 py-2 font-medium">Faixa</th>
                  <th className="px-3 py-2 font-medium">Selecionadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.map((row) => (
                  <tr key={row.item_key}>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {row.public_name}
                    </td>
                    <td className="px-3 py-3">{row.simulated_count}</td>
                    <td className="px-3 py-3">{row.proposed_count}</td>
                    <td className="px-3 py-3">
                      {money(row.average_proposed_revenue_cents)}
                    </td>
                    <td className="px-3 py-3">
                      {money(row.average_direct_cost_cents)}
                    </td>
                    <td className="px-3 py-3">
                      {money(row.average_ebitda_cents)}
                    </td>
                    <td className="px-3 py-3">
                      {percent(row.average_ebitda_margin_basis_points)}
                    </td>
                    <td className="px-3 py-3">
                      {percent(row.minimum_ebitda_margin_basis_points)} –{' '}
                      {percent(row.maximum_ebitda_margin_basis_points)}
                    </td>
                    <td className="px-3 py-3">
                      {percent(row.selected_basis_points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};
