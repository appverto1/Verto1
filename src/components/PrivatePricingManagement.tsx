import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Loader2,
  Save,
  ShieldCheck,
  UserRoundCheck
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { formatDisplayDate } from '../utils/dateFormatting';

type Props = {
  patients: any[];
  currentUser?: any;
  capabilities?: any;
  onToast?: (message: string, type?: 'success' | 'error') => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: any) =>
  (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const key = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const initialRule = () => ({
  scopeType: 'CLINIC_DEFAULT',
  specialtyKey: '',
  specialtyName: '',
  serviceCatalogId: '',
  serviceName: '',
  baseAmount: '',
  defaultDurationMinutes: 50,
  cancellationFreeValue: 0,
  cancellationFreeUnit: 'HOURS',
  lateCancellationType: 'NO_CHARGE',
  lateCancellationValue: 0,
  noShowType: 'NO_CHARGE',
  noShowValue: 0,
  dueRule: 'SESSION_DATE',
  dueOffsetDays: 0,
  dueDay: '',
  expectedPaymentMethod: 'pix',
  allowPartialPayment: true,
  allowedPaymentMethods: ['pix', 'cash', 'card', 'transfer', 'boleto', 'other'],
  allowManualOverride: false,
  discountApprovalRequired: true,
  homeSurcharge: 0,
  schoolSurcharge: 0,
  validFrom: today(),
  validUntil: '',
  active: true,
  replacesRuleId: ''
});

const initialAgreement = () => ({
  patientId: '',
  specialtyKey: '',
  specialtyName: '',
  serviceCatalogId: '',
  serviceName: '',
  payerId: '',
  payerName: '',
  baseAmount: '',
  discountAmount: 0,
  homeSurcharge: '',
  schoolSurcharge: '',
  zeroClassification: '',
  reason: '',
  notes: '',
  validFrom: today(),
  validUntil: '',
  active: true,
  replacesAgreementId: ''
});

const inputClass =
  'mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50';
const labelClass = 'text-xs font-medium text-slate-600';

const scopeLabel = (rule: any) => {
  if (rule.scope_type === 'SERVICE') return `Serviço · ${rule.service_name_snapshot || 'Sem nome'}`;
  if (rule.scope_type === 'SPECIALTY') return `Especialidade · ${rule.specialty_name || rule.specialty_key}`;
  return 'Padrão da clínica';
};

const policyLabel = (type: any, value: any) => {
  const normalized = String(type || '').toUpperCase();
  if (normalized === 'FULL') return '100%';
  if (normalized === 'PERCENTAGE') return `${Number(value) || 0}%`;
  if (normalized === 'FIXED') return money(value);
  if (normalized === 'MANUAL') return 'decisão manual';
  return 'sem cobrança';
};

export function PrivatePricingManagement({ patients, currentUser, capabilities, onToast }: Props) {
  const [catalog, setCatalog] = useState<any>({
    rules: [],
    agreements: [],
    services: [],
    payers: []
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rule, setRule] = useState<any>(initialRule);
  const [agreement, setAgreement] = useState<any>(initialAgreement);
  const [savingRule, setSavingRule] = useState(false);
  const [savingAgreement, setSavingAgreement] = useState(false);
  const canManage = capabilities instanceof Set
    ? capabilities.has('finance.entries.manage')
    : Array.isArray(capabilities)
      ? capabilities.includes('finance.entries.manage')
      : capabilities && typeof capabilities.has === 'function'
        ? capabilities.has('finance.entries.manage')
        : false;

  const load = async () => {
    setLoading(true);
    setLoadError('');
    const result = await dataService.getPrivatePricingCatalog();
    if (!result?.success) {
      setLoadError(result?.error || 'Não foi possível carregar a precificação particular.');
      setLoading(false);
      return;
    }
    setCatalog({
      rules: result.data?.rules || [],
      agreements: result.data?.agreements || [],
      services: result.data?.services || [],
      payers: result.data?.payers || []
    });
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const services = useMemo(
    () => [...(catalog.services || [])].sort((a: any, b: any) =>
      String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR')
    ),
    [catalog.services]
  );
  const patientOptions = useMemo(
    () => [...(patients || [])]
      .filter((patient: any) => patient?.id)
      .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR')),
    [patients]
  );
  const activeRules = useMemo(
    () => (catalog.rules || []).filter((item: any) => item.active),
    [catalog.rules]
  );
  const historicalRules = useMemo(
    () => (catalog.rules || []).filter((item: any) => !item.active),
    [catalog.rules]
  );

  const selectRuleService = (serviceId: string) => {
    const service = services.find((item: any) => String(item.id) === serviceId);
    setRule((current: any) => ({
      ...current,
      serviceCatalogId: serviceId,
      serviceName: service?.name || '',
      specialtyKey: String(service?.specialty || service?.service_type || '').trim().toLowerCase(),
      specialtyName: String(service?.specialty || service?.service_type || '').trim(),
      defaultDurationMinutes: Number(service?.default_duration_minutes || current.defaultDurationMinutes || 50)
    }));
  };

  const selectAgreementService = (serviceId: string) => {
    const service = services.find((item: any) => String(item.id) === serviceId);
    setAgreement((current: any) => ({
      ...current,
      serviceCatalogId: serviceId,
      serviceName: service?.name || '',
      specialtyKey: String(service?.specialty || service?.service_type || current.specialtyKey || '').trim().toLowerCase(),
      specialtyName: String(service?.specialty || service?.service_type || current.specialtyName || '').trim()
    }));
  };

  const saveRule = async () => {
    if (!canManage || savingRule) return;
    if (Number(rule.baseAmount) <= 0) {
      onToast?.('Informe um valor particular maior que zero.', 'error');
      return;
    }
    if (rule.scopeType === 'SPECIALTY' && !String(rule.specialtyName).trim()) {
      onToast?.('Informe a especialidade desta regra.', 'error');
      return;
    }
    if (rule.scopeType === 'SERVICE' && !rule.serviceCatalogId) {
      onToast?.('Selecione o serviço desta regra.', 'error');
      return;
    }
    if (!Array.isArray(rule.allowedPaymentMethods) || rule.allowedPaymentMethods.length === 0) {
      onToast?.('Selecione ao menos uma forma de pagamento permitida.', 'error');
      return;
    }
    if (rule.expectedPaymentMethod && !rule.allowedPaymentMethods.includes(rule.expectedPaymentMethod)) {
      onToast?.('A forma prevista também precisa estar entre as formas permitidas.', 'error');
      return;
    }
    setSavingRule(true);
    const result = await dataService.savePrivateSessionPriceRule({
      ...rule,
      specialtyKey: String(rule.specialtyKey || rule.specialtyName).trim().toLowerCase(),
      idempotencyKey: key('private-price-rule')
    });
    setSavingRule(false);
    if (!result?.success) {
      onToast?.(result?.error || 'Não foi possível salvar a regra.', 'error');
      return;
    }
    onToast?.('Nova versão da regra particular salva.', 'success');
    setRule(initialRule());
    await load();
  };

  const saveAgreement = async () => {
    if (!canManage || savingAgreement) return;
    if (Number(agreement.discountAmount || 0) < 0 || Number(agreement.discountAmount || 0) > Number(agreement.baseAmount || 0)) {
      onToast?.('O desconto recorrente deve estar entre zero e o valor-base do acordo.', 'error');
      return;
    }
    if (agreement.validUntil && agreement.validUntil < agreement.validFrom) {
      onToast?.('A vigência final deve ser posterior ou igual ao início.', 'error');
      return;
    }
    if (!agreement.patientId) {
      onToast?.('Selecione o paciente do acordo.', 'error');
      return;
    }
    if (Number(agreement.baseAmount) < 0 || agreement.baseAmount === '') {
      onToast?.('Informe o valor do acordo.', 'error');
      return;
    }
    if (!String(agreement.reason).trim()) {
      onToast?.('Informe o motivo do acordo para a auditoria.', 'error');
      return;
    }
    if (Number(agreement.baseAmount) === 0 && !agreement.zeroClassification) {
      onToast?.('Valor zero exige isenção ou gratuidade contratual explícita.', 'error');
      return;
    }
    setSavingAgreement(true);
    const result = await dataService.savePatientPrivatePricingAgreement(
      agreement.patientId,
      {
        ...agreement,
        specialtyKey: String(agreement.specialtyKey || agreement.specialtyName).trim().toLowerCase(),
        idempotencyKey: key('private-patient-agreement')
      }
    );
    setSavingAgreement(false);
    if (!result?.success) {
      onToast?.(result?.error || 'Não foi possível salvar o acordo.', 'error');
      return;
    }
    onToast?.('Nova versão do acordo particular salva.', 'success');
    setAgreement(initialAgreement());
    await load();
  };

  const editRuleVersion = (item: any) => {
    setRule({
      ...initialRule(),
      scopeType: item.scope_type,
      specialtyKey: item.specialty_key || '',
      specialtyName: item.specialty_name || '',
      serviceCatalogId: item.service_catalog_id || '',
      serviceName: item.service_name_snapshot || '',
      baseAmount: item.base_amount,
      defaultDurationMinutes: item.default_duration_minutes,
      cancellationFreeValue: item.cancellation_free_value,
      cancellationFreeUnit: item.cancellation_free_unit,
      lateCancellationType: item.late_cancellation_type,
      lateCancellationValue: item.late_cancellation_value,
      noShowType: item.no_show_type,
      noShowValue: item.no_show_value,
      dueRule: item.due_rule,
      dueOffsetDays: item.due_offset_days,
      dueDay: item.due_day || '',
      expectedPaymentMethod: item.expected_payment_method || 'pix',
      allowPartialPayment: item.allow_partial_payment !== false,
      allowedPaymentMethods: item.allowed_payment_methods || initialRule().allowedPaymentMethods,
      allowManualOverride: Boolean(item.allow_manual_override),
      discountApprovalRequired: item.discount_approval_required !== false,
      homeSurcharge: item.home_surcharge || 0,
      schoolSurcharge: item.school_surcharge || 0,
      validFrom: today(),
      validUntil: '',
      active: true,
      replacesRuleId: item.id
    });
  };

  const editAgreementVersion = (item: any) => {
    setAgreement({
      ...initialAgreement(),
      patientId: item.patient_id || '',
      specialtyKey: item.specialty_key || '',
      specialtyName: item.specialty_name || '',
      serviceCatalogId: item.service_catalog_id || '',
      serviceName: item.service_name_snapshot || '',
      payerId: item.payer_id || '',
      payerName: item.payer_name_snapshot || '',
      baseAmount: item.base_amount,
      discountAmount: item.discount_amount || 0,
      homeSurcharge: item.home_surcharge ?? '',
      schoolSurcharge: item.school_surcharge ?? '',
      zeroClassification: item.zero_classification || '',
      reason: item.reason || '',
      notes: item.notes || '',
      validFrom: today(),
      validUntil: '',
      active: true,
      replacesAgreementId: item.id
    });
  };

  if (loading) {
    return (
      <div className="flex items-center rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-500">
        <Loader2 size={17} className="mr-2 animate-spin text-violet-600" />
        Carregando preços particulares...
      </div>
    );
  }

  return (
    <details className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" data-private-pricing-management>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Preços de sessões particulares</p>
            <p className="mt-1 text-xs text-slate-500">
              Acordo do paciente → serviço → especialidade → padrão da clínica. Cada alteração cria uma versão.
            </p>
          </div>
          <BadgeDollarSign size={19} className="shrink-0 text-violet-600" />
        </div>
      </summary>

      {loadError ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {loadError}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 lg:grid-cols-2">
            {activeRules.map((item: any) => (
              <article key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{scopeLabel(item)}</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{money(item.base_amount)}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                    versão {item.version}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span>Duração: {item.default_duration_minutes} min</span>
                  <span>Vigência: {formatDisplayDate(item.valid_from)}</span>
                  <span>Cancelamento tardio: {policyLabel(item.late_cancellation_type, item.late_cancellation_value)}</span>
                  <span>Falta: {policyLabel(item.no_show_type, item.no_show_value)}</span>
                  <span>Domicílio: +{money(item.home_surcharge)}</span>
                  <span>Escola: +{money(item.school_surcharge)}</span>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => editRuleVersion(item)}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-100 bg-white px-3 text-xs font-medium text-violet-700"
                  >
                    <History size={14} /> Criar nova versão
                  </button>
                )}
              </article>
            ))}
            {!activeRules.length && (
              <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Nenhum preço particular ativo. Novas sessões particulares serão bloqueadas até existir uma regra ou acordo válido.
              </div>
            )}
          </div>

          {canManage && (
            <div className="grid gap-5 xl:grid-cols-2">
              <section className="rounded-2xl border border-violet-100 p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={17} className="text-violet-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    {rule.replacesRuleId ? 'Nova versão da regra' : 'Nova regra de preço'}
                  </h3>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Escopo
                    <select value={rule.scopeType} onChange={(event) => setRule({ ...rule, scopeType: event.target.value, serviceCatalogId: '' })} className={inputClass}>
                      <option value="CLINIC_DEFAULT">Padrão da clínica</option>
                      <option value="SPECIALTY">Especialidade</option>
                      <option value="SERVICE">Serviço</option>
                    </select>
                  </label>
                  {rule.scopeType === 'SERVICE' ? (
                    <label className={labelClass}>Serviço
                      <select value={rule.serviceCatalogId} onChange={(event) => selectRuleService(event.target.value)} className={inputClass}>
                        <option value="">Selecione</option>
                        {services.map((service: any) => <option key={service.id} value={service.id}>{service.name}</option>)}
                      </select>
                    </label>
                  ) : rule.scopeType === 'SPECIALTY' ? (
                    <label className={labelClass}>Especialidade
                      <input value={rule.specialtyName} onChange={(event) => setRule({ ...rule, specialtyName: event.target.value, specialtyKey: event.target.value.toLowerCase() })} className={inputClass} />
                    </label>
                  ) : <div />}
                  <label className={labelClass}>Valor particular
                    <input type="number" min="0.01" step="0.01" value={rule.baseAmount} onChange={(event) => setRule({ ...rule, baseAmount: event.target.value })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Duração padrão (min)
                    <input type="number" min="15" max="720" value={rule.defaultDurationMinutes} onChange={(event) => setRule({ ...rule, defaultDurationMinutes: Number(event.target.value) })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Cancelamento gratuito
                    <div className="grid grid-cols-2 gap-2">
                      <input type="number" min="0" max="720" value={rule.cancellationFreeValue} onChange={(event) => setRule({ ...rule, cancellationFreeValue: Number(event.target.value) })} className={inputClass} />
                      <select value={rule.cancellationFreeUnit} onChange={(event) => setRule({ ...rule, cancellationFreeUnit: event.target.value })} className={inputClass}><option value="HOURS">horas</option><option value="DAYS">dias</option></select>
                    </div>
                  </label>
                  <label className={labelClass}>Cancelamento tardio
                    <div className="grid grid-cols-2 gap-2">
                      <select value={rule.lateCancellationType} onChange={(event) => setRule({ ...rule, lateCancellationType: event.target.value })} className={inputClass}><option value="NO_CHARGE">Sem cobrança</option><option value="FULL">Integral</option><option value="PERCENTAGE">Percentual</option><option value="FIXED">Valor fixo</option><option value="MANUAL">Manual</option></select>
                      <input type="number" min="0" step="0.01" value={rule.lateCancellationValue} onChange={(event) => setRule({ ...rule, lateCancellationValue: Number(event.target.value) })} className={inputClass} />
                    </div>
                  </label>
                  <label className={labelClass}>Falta
                    <div className="grid grid-cols-2 gap-2">
                      <select value={rule.noShowType} onChange={(event) => setRule({ ...rule, noShowType: event.target.value })} className={inputClass}><option value="NO_CHARGE">Sem cobrança</option><option value="FULL">Integral</option><option value="PERCENTAGE">Percentual</option><option value="FIXED">Valor fixo</option><option value="MANUAL">Manual</option></select>
                      <input type="number" min="0" step="0.01" value={rule.noShowValue} onChange={(event) => setRule({ ...rule, noShowValue: Number(event.target.value) })} className={inputClass} />
                    </div>
                  </label>
                  <label className={labelClass}>Vencimento
                    <select value={rule.dueRule} onChange={(event) => setRule({ ...rule, dueRule: event.target.value })} className={inputClass}>
                      <option value="SESSION_DATE">No dia da sessão</option>
                      <option value="APPOINTMENT_DATE">No dia do agendamento</option>
                      <option value="DAYS_BEFORE">Dias antes</option>
                      <option value="DAYS_AFTER">Dias depois</option>
                      <option value="FIXED_DAY">Dia fixo do mês</option>
                    </select>
                  </label>
                  <label className={labelClass}>{rule.dueRule === 'FIXED_DAY' ? 'Dia do mês' : 'Quantidade de dias'}
                    <input type="number" min="0" max="365" value={rule.dueRule === 'FIXED_DAY' ? rule.dueDay : rule.dueOffsetDays} onChange={(event) => setRule(rule.dueRule === 'FIXED_DAY' ? { ...rule, dueDay: Number(event.target.value) } : { ...rule, dueOffsetDays: Number(event.target.value) })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Forma prevista
                    <select value={rule.expectedPaymentMethod} onChange={(event) => setRule({ ...rule, expectedPaymentMethod: event.target.value })} className={inputClass}>
                      <option value="">Não definida</option>
                      <option value="pix">PIX</option>
                      <option value="cash">Dinheiro</option>
                      <option value="card">Cartão</option>
                      <option value="transfer">Transferência</option>
                      <option value="boleto">Boleto</option>
                      <option value="other">Outra</option>
                    </select>
                  </label>
                  <label className={labelClass}>Adicional domiciliar
                    <input type="number" min="0" step="0.01" value={rule.homeSurcharge} onChange={(event) => setRule({ ...rule, homeSurcharge: Number(event.target.value) })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Adicional escolar
                    <input type="number" min="0" step="0.01" value={rule.schoolSurcharge} onChange={(event) => setRule({ ...rule, schoolSurcharge: Number(event.target.value) })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Vigência inicial
                    <input type="date" value={rule.validFrom} onChange={(event) => setRule({ ...rule, validFrom: event.target.value })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Vigência final (opcional)
                    <input type="date" value={rule.validUntil} onChange={(event) => setRule({ ...rule, validUntil: event.target.value })} className={inputClass} />
                  </label>
                </div>
                <fieldset className="mt-3">
                  <legend className={labelClass}>Formas de pagamento permitidas</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                      ['pix', 'PIX'],
                      ['cash', 'Dinheiro'],
                      ['card', 'Cartão'],
                      ['transfer', 'Transferência'],
                      ['boleto', 'Boleto'],
                      ['other', 'Outra'],
                    ].map(([value, label]) => (
                      <label key={value} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-100 px-3 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={rule.allowedPaymentMethods.includes(value)}
                          onChange={(event) => setRule({
                            ...rule,
                            allowedPaymentMethods: event.target.checked
                              ? [...rule.allowedPaymentMethods, value]
                              : rule.allowedPaymentMethods.filter((method: string) => method !== value)
                          })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <label className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-xs text-slate-600"><input type="checkbox" checked={rule.allowPartialPayment} onChange={(event) => setRule({ ...rule, allowPartialPayment: event.target.checked })} /> Pagamento parcial</label>
                  <label className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-xs text-slate-600"><input type="checkbox" checked={rule.allowManualOverride} onChange={(event) => setRule({ ...rule, allowManualOverride: event.target.checked })} /> Alteração manual</label>
                  <label className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-xs text-slate-600"><input type="checkbox" checked={rule.discountApprovalRequired} onChange={(event) => setRule({ ...rule, discountApprovalRequired: event.target.checked })} /> Aprovar desconto</label>
                  <label className="flex items-start gap-2 rounded-xl border border-slate-100 p-3 text-xs text-slate-600"><input type="checkbox" checked={rule.active} onChange={(event) => setRule({ ...rule, active: event.target.checked })} /> Regra ativa</label>
                </div>
                <button type="button" onClick={saveRule} disabled={savingRule} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-60">
                  {savingRule ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar nova versão
                </button>
              </section>

              <section className="rounded-2xl border border-emerald-100 p-4">
                <div className="flex items-center gap-2">
                  <UserRoundCheck size={17} className="text-emerald-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Desconto recorrente / acordo por paciente</h3>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className={`sm:col-span-2 ${labelClass}`}>Paciente
                    <select value={agreement.patientId} onChange={(event) => setAgreement({ ...agreement, patientId: event.target.value })} className={inputClass}><option value="">Selecione</option>{patientOptions.map((patient: any) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select>
                  </label>
                  <label className={labelClass}>Especialidade
                    <input value={agreement.specialtyName} onChange={(event) => setAgreement({ ...agreement, specialtyName: event.target.value, specialtyKey: event.target.value.toLowerCase() })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Serviço opcional
                    <select value={agreement.serviceCatalogId} onChange={(event) => selectAgreementService(event.target.value)} className={inputClass}><option value="">Todos da especialidade</option>{services.map((service: any) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
                  </label>
                  <label className={labelClass}>Valor-base do acordo (R$)
                    <input type="number" min="0" step="0.01" value={agreement.baseAmount} onChange={(event) => setAgreement({ ...agreement, baseAmount: event.target.value })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Desconto recorrente por sessão (R$)
                    <input type="number" min="0" step="0.01" value={agreement.discountAmount} onChange={(event) => setAgreement({ ...agreement, discountAmount: Number(event.target.value) })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Adicional domiciliar
                    <input type="number" min="0" step="0.01" value={agreement.homeSurcharge} onChange={(event) => setAgreement({ ...agreement, homeSurcharge: event.target.value })} className={inputClass} placeholder="Herdar da regra" />
                  </label>
                  <label className={labelClass}>Adicional escolar
                    <input type="number" min="0" step="0.01" value={agreement.schoolSurcharge} onChange={(event) => setAgreement({ ...agreement, schoolSurcharge: event.target.value })} className={inputClass} placeholder="Herdar da regra" />
                  </label>
                  <label className={labelClass}>Pagador
                    <select value={agreement.payerId} onChange={(event) => { const payer = (catalog.payers || []).find((item: any) => String(item.id) === event.target.value); setAgreement({ ...agreement, payerId: event.target.value, payerName: payer?.name || '' }); }} className={inputClass}><option value="">Paciente/responsável</option>{(catalog.payers || []).map((payer: any) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}</select>
                  </label>
                  <label className={labelClass}>Classificação de valor zero
                    <select value={agreement.zeroClassification} onChange={(event) => setAgreement({ ...agreement, zeroClassification: event.target.value })} className={inputClass}><option value="">Não se aplica</option><option value="EXEMPT">Isenção</option><option value="CONTRACTUAL_FREE">Gratuidade contratual</option></select>
                  </label>
                  <label className={labelClass}>Início da recorrência
                    <input type="date" value={agreement.validFrom} onChange={(event) => setAgreement({ ...agreement, validFrom: event.target.value })} className={inputClass} />
                  </label>
                  <label className={labelClass}>Fim da recorrência (opcional)
                    <input type="date" value={agreement.validUntil} onChange={(event) => setAgreement({ ...agreement, validUntil: event.target.value })} className={inputClass} />
                  </label>
                  <label className={`sm:col-span-2 ${labelClass}`}>Motivo
                    <input value={agreement.reason} onChange={(event) => setAgreement({ ...agreement, reason: event.target.value })} className={inputClass} placeholder="Ex.: acordo aprovado pela direção" />
                  </label>
                  <label className={`sm:col-span-2 ${labelClass}`}>Observações
                    <textarea value={agreement.notes} onChange={(event) => setAgreement({ ...agreement, notes: event.target.value })} className={`${inputClass} min-h-20 resize-y`} />
                  </label>
                  <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-100 px-3 text-xs text-slate-600 sm:col-span-2">
                    <input type="checkbox" checked={agreement.active} onChange={(event) => setAgreement({ ...agreement, active: event.target.checked })} />
                    Acordo ativo nesta nova versão
                  </label>
                </div>
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">Este acordo será aplicado automaticamente às futuras sessões elegíveis do paciente dentro da vigência. Para desconto em UMA sessão, use Financeiro de pacientes → Cobranças → Aplicar desconto na cobrança específica; ele não altera as sessões seguintes.</p>
                <p className="text-sm font-semibold text-slate-800">Valor final recorrente estimado: {money(Math.max(0, Number(agreement.baseAmount || 0) - Number(agreement.discountAmount || 0)))}</p>
                <button type="button" onClick={saveAgreement} disabled={savingAgreement} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-60">
                  {savingAgreement ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Salvar acordo
                </button>
              </section>
            </div>
          )}

          <details className="rounded-2xl border border-slate-100 p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-slate-800">
              Histórico preservado
              <ChevronDown size={16} className="text-slate-400" />
            </summary>
            <div className="mt-3 space-y-2">
              {[...(catalog.agreements || []), ...historicalRules].map((item: any) => (
                <div key={`${item.patient_id ? 'agreement' : 'rule'}-${item.id}`} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span>{item.patient_id ? `Acordo · ${patientOptions.find((patient: any) => String(patient.id) === String(item.patient_id))?.name || 'Paciente'}` : scopeLabel(item)}</span>
                    <span className="mt-1 block">{money(item.base_amount)} · versão {item.version} · {formatDisplayDate(item.valid_from)}{item.valid_until ? ` a ${formatDisplayDate(item.valid_until)}` : ''} · {item.active ? 'ativo' : 'encerrado'}</span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => item.patient_id ? editAgreementVersion(item) : editRuleVersion(item)}
                      className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-violet-100 bg-white px-3 text-xs font-medium text-violet-700"
                    >
                      <History size={14} /> Criar nova versão
                    </button>
                  )}
                </div>
              ))}
              {!(catalog.agreements || []).length && !historicalRules.length && (
                <p className="text-xs text-slate-500">Nenhuma versão anterior ou acordo individual.</p>
              )}
            </div>
          </details>

          {!canManage && (
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <Clock3 size={15} className="mt-0.5 shrink-0" />
              Seu perfil pode consultar preços e acordos, mas a criação de regras exige permissão de gestão financeira da clínica.
            </div>
          )}
        </div>
      )}
    </details>
  );
}
