// Presentation-only modular proposal preview, shared by public offer and Super Admin.
// The server remains the sole authority for acceptance, values, checkout and activation.
import React from 'react';
import { Check, Layers3 } from 'lucide-react';
import { formatSalesCurrency } from '../constants/salesCommercial';
import { formatSalesCommercialDate } from '../utils/salesCommercialDate';
import type { ModularPublicOffer } from './PublicSalesOffer';

export const ModularOfferDetails = ({
  offer
}: {
  offer: ModularPublicOffer;
}) => {
  const recurringItems = offer.items.filter(
    (item) => item.pricingMode !== 'one_time'
  );
  const oneTimeItems = offer.items.filter(
    (item) => item.oneTimeAmountCents > 0
  );
  const hasPlatformFoundation = recurringItems.some(
    (item) => item.itemKey === 'platform_foundation'
  );
  const recurringModuleCount = recurringItems.filter(
    (item) => item.itemKey !== 'platform_foundation'
  ).length;
  const hasPromotion =
    offer.promotionalMonthlyAmountCents !==
    offer.postDiscountMonthlyAmountCents;
  const capacityBlockPhases = offer.capacityBlockPhases || [];
  const currentBlockPhase = capacityBlockPhases[0] || null;
  const postBenefitBlockPhase =
    capacityBlockPhases[capacityBlockPhases.length - 1] || null;
  const publicBlockSizePatients =
    currentBlockPhase?.blockSizePatients ??
    offer.basePackage?.capacity?.blockSizePatients ??
    offer.basePackage?.capacity?.policy?.blockSizePatients ??
    0;
  const publicGracePeriodDays =
    offer.basePackage?.capacity?.gracePeriodDays ??
    offer.basePackage?.capacity?.policy?.gracePeriodDays ??
    0;
  const historicalBlockPriceCents =
    offer.basePackage?.capacity?.effectiveBlockPriceCents ??
    offer.basePackage?.capacity?.policy?.blockPriceCents ??
    null;

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Estrutura escolhida</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            Composição modular Verto
          </p>
          <p className="mt-1 text-xs font-normal text-slate-500">
            {hasPlatformFoundation ? 'Fundação da plataforma + ' : ''}
            {recurringModuleCount} módulo(s) ·{' '}
            {offer.initialActivePatientQuantity} pacientes estimados
            {offer.basePackage?.limitQuantity
              ? ` · capacidade de ${offer.basePackage.limitQuantity}`
              : ''}
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {recurringItems.map((item) => (
            <div
              key={`${item.itemKey}:${item.publicMetadata?.tierName || 'item'}`}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Check size={15} className="shrink-0 text-emerald-600" />
                  <p className="text-sm font-medium text-slate-900">{item.publicName}</p>
                </div>
                <p className="mt-1 pl-[23px] text-xs font-normal leading-5 text-slate-500">
                  {item.description}
                </p>
                {Array.isArray(item.publicMetadata?.features) &&
                item.publicMetadata.features.length > 0 ? (
                  <ul className="mt-2 space-y-1 pl-[23px] text-xs font-normal leading-5 text-slate-600">
                    {item.publicMetadata.features.map(
                      (feature: string, featureIndex: number) => (
                        <li
                          key={`${item.itemKey}:feature:${featureIndex}`}
                          className="flex items-start gap-2"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-violet-400"
                          />
                          <span>{feature}</span>
                        </li>
                      )
                    )}
                  </ul>
                ) : null}
                {item.limitQuantity || item.includedQuantity ? (
                  <p className="mt-1 pl-[23px] text-xs font-medium text-violet-700">
                    {item.limitQuantity
                      ? `Limite: ${item.limitQuantity.toLocaleString('pt-BR')} ${item.publicMetadata?.unitName || ''}`
                      : `${item.includedQuantity?.toLocaleString('pt-BR')} ${item.publicMetadata?.unitName || ''} incluídos`}
                  </p>
                ) : null}
                {item.publicMetadata?.pricePerPatientCents != null ? (
                  <p className="mt-1 pl-[23px] text-xs font-medium text-slate-700">
                    {formatSalesCurrency(
                      Number(item.publicMetadata.pricePerPatientCents),
                      offer.currency
                    )}{' '}
                    por paciente/mês · capacidade faturada{' '}
                    {Number(
                      item.publicMetadata.billedCapacityPatients || 0
                    ).toLocaleString('pt-BR')}
                  </p>
                ) : null}
                {item.itemDiscountBasisPoints > 0 ? (
                  <p className="mt-1 pl-[23px] text-xs font-medium text-emerald-700">
                    Desconto do módulo:{' '}
                    {(item.itemDiscountBasisPoints / 100).toLocaleString(
                      'pt-BR',
                      { maximumFractionDigits: 2 }
                    )}
                    %
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 pl-[23px] text-left sm:min-w-44 sm:pl-0 sm:text-right">
                {item.offerDiscount ? (
                  <>
                    <p className="text-xs text-slate-500">
                      Preço de tabela: {formatSalesCurrency(item.offerDiscount.priceBeforeDiscountCents, offer.currency)}/mês
                    </p>
                    <p className="mt-1 text-sm font-semibold text-violet-800">
                      {formatSalesCurrency(item.offerDiscount.discountedPriceCents, offer.currency)}/mês
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-700">
                      {item.offerDiscount.durationCount
                        ? `durante ${item.offerDiscount.durationCount} ${item.offerDiscount.durationUnit === 'days' ? 'dias' : 'meses'}`
                        : item.offerDiscount.endsAt
                          ? `até ${formatSalesCommercialDate(item.offerDiscount.endsAt)}`
                          : 'condição vigente'}
                    </p>
                    <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-900">
                      Depois: {formatSalesCurrency(item.offerDiscount.priceAfterExpirationCents, offer.currency)}/mês
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-900">
                    {formatSalesCurrency(
                      hasPromotion
                        ? item.promotionalRecurringAmountCents
                        : item.postPromotionRecurringAmountCents,
                      offer.currency
                    )}
                    <span className="font-normal text-slate-500">/mês</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {offer.basePackage?.capacity ? (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
          <p className="text-sm font-medium text-violet-950">Capacidade técnica contratada da composição Verto</p>
          <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
            <span>Limite-base: {offer.basePackage.capacity.baseLimitPatients} pacientes</span>
            <span>Quantidade reservada: {offer.basePackage.capacity.selectedBlocks} bloco(s)</span>
            <span>Limite total: {offer.basePackage.capacity.totalContractedLimitPatients} pacientes</span>
            <span>Armazenamento: {offer.basePackage.capacity.includedStorageMb.toLocaleString('pt-BR')} MB</span>
            <span>
              Valor do bloco nesta fase:{' '}
              {currentBlockPhase == null
                ? historicalBlockPriceCents == null
                  ? 'definido na condição comercial'
                  : `${formatSalesCurrency(
                      historicalBlockPriceCents,
                      offer.currency
                    )}/mês`
                : `${formatSalesCurrency(
                    currentBlockPhase.blockPriceCents,
                    offer.currency
                  )}/mês`}
            </span>
            {postBenefitBlockPhase &&
            postBenefitBlockPhase.phaseNumber !==
              currentBlockPhase?.phaseNumber ? (
              <span>
                Valor do bloco após os benefícios:{' '}
                {formatSalesCurrency(
                  postBenefitBlockPhase.blockPriceCents,
                  offer.currency
                )}/mês
              </span>
            ) : null}
            <span>
              Valor dos blocos reservados nesta fase:{' '}
              {formatSalesCurrency(
                currentBlockPhase?.blocksRevenueCents ??
                  offer.basePackage.capacity.blocksMonthlyRevenueCents,
                offer.currency
              )}/mês
            </span>
          </div>
          {currentBlockPhase ? (
            <details className="mt-3 rounded-xl border border-violet-100 bg-white/80">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet-900">
                Módulos que compõem o bloco de{' '}
                {currentBlockPhase.blockSizePatients}
              </summary>
              <div className="divide-y divide-violet-50 border-t border-violet-100 px-3">
                {currentBlockPhase.modules.map((module) => {
                  const postModule = postBenefitBlockPhase?.modules.find(
                    (candidate) => candidate.itemKey === module.itemKey
                  );
                  return (
                    <div
                      key={module.itemKey}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <span className="text-slate-600">{module.publicName}</span>
                      <span className="text-right font-medium text-slate-800">
                        {formatSalesCurrency(
                          module.blockRevenueCents,
                          offer.currency
                        )}
                        {postModule &&
                        postModule.blockRevenueCents !==
                          module.blockRevenueCents
                          ? ` · depois ${formatSalesCurrency(
                              postModule.blockRevenueCents,
                              offer.currency
                            )}`
                          : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}
          {capacityBlockPhases.length > 0 ? (
            <div className="mt-3 space-y-2" aria-label="Fases comerciais da capacidade">
              {capacityBlockPhases.map((phase, phaseIndex) => {
                const previousPhase =
                  phaseIndex > 0 ? capacityBlockPhases[phaseIndex - 1] : null;
                const changedModules = phase.modules.filter((module) => {
                  if (!previousPhase) return true;
                  const previousModule = previousPhase.modules.find(
                    (candidate) => candidate.itemKey === module.itemKey
                  );
                  return (
                    !previousModule ||
                    previousModule.effectivePricePerPatientCents !==
                      module.effectivePricePerPatientCents
                  );
                });
                return (
                  <div
                    key={phase.phaseNumber}
                    className="rounded-xl border border-violet-100 bg-white/80 p-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-medium text-violet-900">
                          Fase {phase.phaseNumber}
                        </p>
                        <p className="mt-0.5 text-[11px] font-normal text-slate-500">
                          {formatSalesCommercialDate(phase.startsAt)} —{' '}
                          {phase.endsAt
                            ? formatSalesCommercialDate(phase.endsAt)
                            : 'condição permanente'}
                        </p>
                      </div>
                      <div className="text-left text-xs text-slate-700 sm:text-right">
                        <p>
                          {formatSalesCurrency(
                            phase.effectivePricePerPatientCents,
                            offer.currency
                          )}
                          /paciente
                        </p>
                        <p className="mt-0.5 font-medium text-slate-900">
                          {formatSalesCurrency(
                            phase.contractedMonthlyRevenueCents,
                            offer.currency
                          )}
                          /mês · bloco{' '}
                          {formatSalesCurrency(
                            phase.blockPriceCents,
                            offer.currency
                          )}
                        </p>
                      </div>
                    </div>
                    {changedModules.length > 0 ? (
                      <p className="mt-2 text-[11px] font-normal leading-5 text-slate-600">
                        {phaseIndex === 0
                          ? 'Módulos desta fase: '
                          : 'Valores alterados nesta fase: '}
                        {changedModules
                          .map(
                            (module) =>
                              `${module.publicName} ${formatSalesCurrency(
                                module.effectivePricePerPatientCents,
                                offer.currency
                              )}/paciente`
                          )
                          .join(' · ')}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-slate-600">
            A capacidade contratada contempla até{' '}
            {offer.basePackage.capacity.baseLimitPatients} pacientes ativos. Ao
            ultrapassar esse limite, a capacidade será ampliada em blocos de{' '}
            {publicBlockSizePatients} pacientes,
            mantendo os mesmos módulos contratados e os preços por paciente
            vigentes em cada fase. Há{' '}
            {publicGracePeriodDays} dias de
            tolerância para ajuste no próximo ciclo. A ampliação de capacidade
            não bloqueia o acesso contratado.
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {hasPromotion ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-xs font-medium text-violet-700">
              Durante a promoção
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatSalesCurrency(
                offer.promotionalMonthlyAmountCents,
                offer.currency
              )}
              <span className="text-sm font-normal text-slate-500">/mês</span>
            </p>
            <p className="mt-1 text-xs font-normal text-slate-600">
              {offer.globalDiscountPercentage.toLocaleString('pt-BR', {
                maximumFractionDigits: 2
              })}
              % de desconto por {offer.discountDurationMonths} meses
            </p>
          </div>
        ) : null}
        <div
          className={`rounded-2xl border border-emerald-200 bg-emerald-50 p-4 ${
            hasPromotion ? '' : 'sm:col-span-2'
          }`}
        >
          <p className="text-xs font-medium text-emerald-700">
            {hasPromotion ? 'Após a promoção' : 'Total mensal'}
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {formatSalesCurrency(
              offer.postDiscountMonthlyAmountCents,
              offer.currency
            )}
            <span className="text-sm font-normal text-slate-500">/mês</span>
          </p>
        </div>
      </div>

      {oneTimeItems.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Implantação</p>
          {oneTimeItems.map((item) => (
            <div
              key={item.itemKey}
              className="mt-2 flex items-center justify-between gap-4 text-sm"
            >
              <span className="font-normal text-slate-700">{item.publicName}</span>
              <span className="font-semibold text-slate-900">
                {formatSalesCurrency(item.oneTimeAmountCents, offer.currency)}
              </span>
            </div>
          ))}
          {offer.onboardingInstallments > 1 ? (
            <p className="mt-2 text-xs font-normal text-slate-500">
              Condição comercial: {offer.onboardingInstallments} parcelas,
              sem criar cobrança na Stripe nesta etapa.
            </p>
          ) : null}
        </div>
      ) : null}

      {offer.publicNotes ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-normal leading-6 text-slate-700">
          {offer.publicNotes}
        </div>
      ) : null}

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-4">
        <Layers3 size={18} className="mt-0.5 shrink-0 text-violet-700" />
        <p className="text-sm font-normal leading-6 text-violet-950">
          {hasPlatformFoundation
            ? 'Comece com a Fundação Verto e os módulos necessários hoje. Novos módulos e blocos de capacidade podem ser adicionados conforme a operação crescer, sem duplicar a base da plataforma.'
            : 'Comece com os módulos necessários hoje. Novos módulos e blocos de capacidade podem ser adicionados conforme a operação crescer.'}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-normal text-amber-900">
        Proposta válida até{' '}
        {formatSalesCommercialDate(offer.expiresAt)}.
      </div>

      {offer.trialDays > 0 ? (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">{offer.trialDays} dias gratuitos</p>
          <p className="mt-1 text-xs font-normal leading-5 text-emerald-800">
            O cartão é cadastrado na Stripe e a primeira cobrança ocorre após o período de teste, conforme esta proposta.
          </p>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
        <p className="text-sm font-medium text-slate-800">Contratação protegida pela Verto</p>
        <p className="mt-1 text-xs font-normal leading-5 text-slate-500">
          Depois do aceite, esta mesma página prepara ou reutiliza o Checkout da Stripe. Os módulos e valores são sempre reconstruídos do contrato congelado no servidor.
        </p>
      </div>
    </>
  );
};
