import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { BillingTissSettingsPanel } from "./BillingTissSettingsPanel";
import { RoleCapabilityMatrix } from "./RoleCapabilityMatrix";
import { SecureImage } from "./SecureMedia";
import { dataService } from "../services/dataService";
import { normalizeAbaPromptTypeConfig, type AbaPromptTypeConfig } from "../utils/abaPromptLevels";
import { formatDocument, maskCep, maskPhoneBR, onlyDigits, parseDocumentForStorage } from "../utils/brMasks";

type SettingsValues = Record<string, any>;

type ClinicGlobalSettingsPanelProps = {
  isTherapist: boolean;
  canEditAnamnesisTemplate: boolean;
  loadingAnamnesisTemplate: boolean;
  onOpenAnamnesisTemplate: () => void;
  canManageClinicSettings: boolean;
  canManageBilling: boolean;
  normalizedPlanName: string;
  navigateToTab: (tab: string) => void;
  onSave: () => void | Promise<void>;
  values: SettingsValues;
  setters: Record<string, (value: any) => void>;
  readImageAsDataUrl: (file: File, onDone: (result: string) => void) => void;
  retryMediaIfBroken: (kind: "signature" | "profile" | "logo") => void | Promise<void>;
};

const inputClass =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-[#7a32fc]/40 focus:ring-2 focus:ring-[#7a32fc]/10";
const labelClass = "block text-xs font-bold text-slate-600";
const BRAZILIAN_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
];

function StatusBadge({ complete, hasAnyData }: { complete: boolean; hasAnyData: boolean }) {
  const label = complete ? "Completo" : hasAnyData ? "Pendente" : "Incompleto";
  const className = complete
    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : hasAnyData
      ? "bg-amber-50 text-amber-700 ring-amber-100"
      : "bg-slate-100 text-slate-500 ring-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${className}`}>
      {complete ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
      {label}
    </span>
  );
}

function SectionCard({
  id,
  title,
  description,
  complete,
  hasAnyData,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  complete: boolean;
  hasAnyData: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-black text-slate-900">{title}</h4>
          <p className="mt-1 text-sm font-medium text-slate-500">{description}</p>
        </div>
        <StatusBadge complete={complete} hasAnyData={hasAnyData} />
      </div>
      {children}
    </section>
  );
}

function SaveButton({ children, onSave }: { children: React.ReactNode; onSave: () => void | Promise<void> }) {
  return (
    <button
      type="button"
      onClick={() => void onSave()}
      className="rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-black text-white transition-all hover:opacity-90"
    >
      {children}
    </button>
  );
}

function AbaPromptTypesSettings() {
  const [promptTypes, setPromptTypes] = useState<AbaPromptTypeConfig[]>(() => normalizeAbaPromptTypeConfig());
  const [savingId, setSavingId] = useState('');
  const [newPrompt, setNewPrompt] = useState({
    name: '',
    category: 'Visual',
    independenceScore: 80,
    intrusivenessOrder: 1,
    countsAsIndependent: false,
    showInSession: true,
    description: ''
  });
  const inactivePromptTypes = useMemo(() => promptTypes.filter((prompt) => !prompt.active), [promptTypes]);

  useEffect(() => {
    let cancelled = false;
    dataService.getAbaPromptTypes()
      .then((result: any) => {
        if (!cancelled) setPromptTypes(normalizeAbaPromptTypeConfig(result?.data));
      })
      .catch(() => {
        if (!cancelled) setPromptTypes(normalizeAbaPromptTypeConfig());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savePromptType = async (prompt: Partial<AbaPromptTypeConfig>) => {
    const id = String(prompt.id || prompt.key || `prompt-${Date.now()}`);
    setSavingId(id);
    try {
      const result = await dataService.saveAbaPromptType(prompt);
      if (result?.success !== false) {
        const saved = normalizeAbaPromptTypeConfig([result?.data || prompt])[0];
        setPromptTypes((prev) => normalizeAbaPromptTypeConfig([
          ...prev.filter((item) => item.id !== saved.id && item.key !== saved.key),
          saved
        ]));
      }
    } finally {
      setSavingId('');
    }
  };

  const addPromptType = async () => {
    const name = newPrompt.name.trim();
    if (!name) return;
    await savePromptType({
      ...newPrompt,
      name,
      label: name,
      key: name,
      active: true
    });
    setNewPrompt({
      name: '',
      category: 'Visual',
      independenceScore: 80,
      intrusivenessOrder: Math.max(1, promptTypes.length + 1),
      countsAsIndependent: false,
      showInSession: true,
      description: ''
    });
  };

  return (
    <SectionCard
      title="Tipos de ajuda ABA"
      description="Configure os tipos de ajuda usados durante as tentativas. Também chamados de prompt na prática ABA."
      complete={promptTypes.some((prompt) => prompt.active)}
      hasAnyData
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900">
          Cada tipo pode ter uma pontuação de independência para gráficos, relatórios e critérios clínicos. Eventos antigos continuam usando o fallback já existente.
        </div>
        <div className="grid gap-3">
          {promptTypes.filter((prompt) => prompt.active).map((prompt) => (
            <div key={prompt.id || prompt.key} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[1.3fr_1fr_110px_110px_auto]">
              <label className={labelClass}>
                Nome
                <input value={prompt.name} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, name: event.target.value, label: event.target.value } : item))} className={inputClass} />
              </label>
              <label className={labelClass}>
                Categoria
                <input value={prompt.category} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, category: event.target.value } : item))} className={inputClass} />
              </label>
              <label className={labelClass}>
                Pontuação
                <input type="number" min={0} max={100} value={prompt.independenceScore} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, independenceScore: Number(event.target.value) } : item))} className={inputClass} />
              </label>
              <label className={labelClass}>
                Ordem
                <input type="number" min={0} value={prompt.intrusivenessOrder} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, intrusivenessOrder: Number(event.target.value) } : item))} className={inputClass} />
              </label>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={prompt.showInSession} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, showInSession: event.target.checked } : item))} />
                  Na sessão
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={prompt.countsAsIndependent} onChange={(event) => setPromptTypes((prev) => prev.map((item) => item.key === prompt.key ? { ...item, countsAsIndependent: event.target.checked } : item))} />
                  Independente
                </label>
                <button type="button" onClick={() => void savePromptType(prompt)} className="rounded-lg bg-[#7a32fc] px-3 py-2 text-xs font-black text-white">
                  {savingId === (prompt.id || prompt.key) ? 'Salvando...' : 'Salvar'}
                </button>
                <button type="button" onClick={() => void savePromptType({ ...prompt, active: false })} className="text-xs font-bold text-red-600">
                  Inativar
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <p className="mb-3 text-sm font-black text-slate-800">Adicionar tipo de ajuda</p>
          <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_120px_120px]">
            <label className={labelClass}>Nome<input value={newPrompt.name} onChange={(event) => setNewPrompt((prev) => ({ ...prev, name: event.target.value }))} placeholder="Visual parcial leve" className={inputClass} /></label>
            <label className={labelClass}>Categoria<input value={newPrompt.category} onChange={(event) => setNewPrompt((prev) => ({ ...prev, category: event.target.value }))} placeholder="Visual" className={inputClass} /></label>
            <label className={labelClass}>Pontuação<input type="number" min={0} max={100} value={newPrompt.independenceScore} onChange={(event) => setNewPrompt((prev) => ({ ...prev, independenceScore: Number(event.target.value) }))} className={inputClass} /></label>
            <label className={labelClass}>Ordem<input type="number" min={0} value={newPrompt.intrusivenessOrder} onChange={(event) => setNewPrompt((prev) => ({ ...prev, intrusivenessOrder: Number(event.target.value) }))} className={inputClass} /></label>
          </div>
          <button type="button" onClick={() => void addPromptType()} className="mt-4 rounded-xl bg-[#7a32fc] px-5 py-2.5 text-sm font-black text-white">
            Adicionar tipo
          </button>
        </div>
        {inactivePromptTypes.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-black text-slate-700">Tipos inativos ({inactivePromptTypes.length})</summary>
            <div className="mt-3 space-y-2">
              {inactivePromptTypes.map((prompt) => (
                <div key={prompt.id || prompt.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-700">{prompt.name}</span>
                  <button type="button" onClick={() => void savePromptType({ ...prompt, active: true })} className="text-xs font-black text-[#7a32fc]">Reativar</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </SectionCard>
  );
}

function MediaDropzone({
  label,
  value,
  alt,
  accept,
  emptyText,
  imageClassName,
  onChange,
  onError,
}: {
  label: string;
  value: string | null;
  alt: string;
  accept: string;
  emptyText: string;
  imageClassName: string;
  onChange: (file: File) => void;
  onError: () => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold text-slate-600">{label}</label>
      <label className="flex min-h-[150px] w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 transition-all hover:border-[#7a32fc]">
        {value ? (
          <SecureImage src={value} alt={alt} className={imageClassName} onError={onError} />
        ) : (
          <span className="text-xs font-semibold text-slate-500">{emptyText}</span>
        )}
        <input
          type="file"
          className="hidden"
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChange(file);
          }}
        />
      </label>
    </div>
  );
}

export function ClinicGlobalSettingsPanel({
  isTherapist,
  canEditAnamnesisTemplate,
  loadingAnamnesisTemplate,
  onOpenAnamnesisTemplate,
  canManageClinicSettings,
  canManageBilling,
  normalizedPlanName,
  navigateToTab,
  onSave,
  values,
  setters,
  readImageAsDataUrl,
  retryMediaIfBroken,
}: ClinicGlobalSettingsPanelProps) {
  const scrollToClinicData = () => {
    document.getElementById("clinic-master-data")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const clinicDocumentDigits = parseDocumentForStorage(values.clinicCnpj);
  const clinicCoreComplete = Boolean(values.clinicDisplayName?.trim() && clinicDocumentDigits && (values.clinicPhone?.trim() || values.clinicEmail?.trim()));
  const clinicFiscalComplete = Boolean(values.clinicLegalName?.trim() && clinicDocumentDigits && (values.clinicCnesCode?.trim() || values.clinicProviderCode?.trim()));
  const contactComplete = Boolean(values.clinicEmail?.trim() || values.clinicPhone?.trim() || values.clinicWhatsapp?.trim());
  const responsibleComplete = Boolean(values.therapistFullName?.trim() && values.therapistRoleTitle?.trim() && (values.therapistEmail?.trim() || values.therapistPhone?.trim()));
  const professionalBillingComplete = Boolean(
    values.therapistCouncilType?.trim() &&
    values.therapistCrp?.trim() &&
    values.therapistCouncilState?.trim() &&
    values.therapistCboCode?.trim(),
  );
  const mediaComplete = Boolean(values.therapistSignatureDataUrl || values.therapistProfilePhotoUrl);

  const professionalFields = (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {isTherapist && (
        <p className="md:col-span-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">
          Este é o seu cadastro profissional e faturável global. Ele será reutilizado em Pré-guias TISS, pré-faturamento, relatórios e documentos de todos os seus atendimentos.
        </p>
      )}
      <label className={`${labelClass} md:col-span-2`}>
        Nome de exibição
        <input type="text" value={values.therapistFullName} onChange={(event) => setters.setTherapistFullName(event.target.value)} placeholder="Nome do profissional responsável" className={inputClass} />
      </label>
      <div className="grid grid-cols-[130px_1fr] gap-3">
        <label className={labelClass}>
          Tipo de documento
          <select
            value={values.therapistDocumentType || "CPF"}
            onChange={(event) => {
              setters.setTherapistDocumentType(event.target.value);
              setters.setTherapistCpf(formatDocument(values.therapistCpf, event.target.value));
            }}
            className={inputClass}
          >
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
            <option value="OTHER">Outro</option>
          </select>
        </label>
        <label className={labelClass}>
          Documento
          <input
            type="text"
            value={values.therapistCpf}
            onChange={(event) => setters.setTherapistCpf(formatDocument(event.target.value, values.therapistDocumentType))}
            placeholder={values.therapistDocumentType === "CNPJ" ? "00.000.000/0000-00" : "000.000.000-00"}
            className={inputClass}
          />
        </label>
      </div>
      <label className={labelClass}>
        E-mail
        <input type="email" value={values.therapistEmail} onChange={(event) => setters.setTherapistEmail(event.target.value)} placeholder="responsavel@clinica.com" className={inputClass} />
      </label>
      <label className={labelClass}>
        Telefone / WhatsApp
        <input type="text" value={values.therapistPhone} onChange={(event) => setters.setTherapistPhone(maskPhoneBR(event.target.value))} placeholder="(00) 00000-0000" className={inputClass} />
      </label>
      <label className={labelClass}>
        Cargo / Função
        <input type="text" value={values.therapistRoleTitle} onChange={(event) => setters.setTherapistRoleTitle(event.target.value)} placeholder="Ex: Coordenador clínico" className={inputClass} />
      </label>
      <label className={labelClass}>
        Conselho profissional
        <input type="text" value={values.therapistCouncilType} onChange={(event) => setters.setTherapistCouncilType(event.target.value)} placeholder="CRP, CREFITO, CRM..." className={inputClass} />
      </label>
      <label className={labelClass}>
        Número do conselho / Registro
        <input type="text" value={values.therapistCrp} onChange={(event) => setters.setTherapistCrp(event.target.value)} placeholder="Ex: CRP 06/123456" className={inputClass} />
      </label>
      <label className={labelClass}>
        UF do conselho
        <select value={values.therapistCouncilState} onChange={(event) => setters.setTherapistCouncilState(event.target.value)} className={inputClass}>
          <option value="">Selecione</option>
          {BRAZILIAN_UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        CBO
        <input type="text" value={values.therapistCboCode} onChange={(event) => setters.setTherapistCboCode(onlyDigits(event.target.value, 12))} placeholder="Código CBO" className={inputClass} />
      </label>
      <label className={labelClass}>
        Especialidade
        <input type="text" value={values.therapistSpecialtyName} onChange={(event) => setters.setTherapistSpecialtyName(event.target.value)} placeholder="Especialidade principal" className={inputClass} />
      </label>
      <label className={labelClass}>
        Código do prestador
        <input type="text" value={values.therapistProviderCode} onChange={(event) => setters.setTherapistProviderCode(event.target.value)} placeholder="Opcional, conforme operadora" className={inputClass} />
      </label>
      <label className={`${labelClass} md:col-span-2`}>
        Mini currículo
        <textarea rows={3} value={values.therapistMiniCurriculum} onChange={(event) => setters.setTherapistMiniCurriculum(event.target.value)} placeholder="Resumo profissional usado em relatórios e documentos." className={`${inputClass} resize-none`} />
      </label>
      <div className="md:col-span-2 flex justify-end">
        <SaveButton onSave={onSave}>{isTherapist ? "Salvar perfil profissional" : "Salvar responsável"}</SaveButton>
      </div>
    </div>
  );

  const mediaFields = (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <MediaDropzone
        label="Assinatura Digital"
        value={values.therapistSignatureDataUrl}
        alt="Assinatura digital"
        accept="image/png,image/webp,image/jpeg"
        emptyText="Clique para enviar assinatura"
        imageClassName="max-h-28 object-contain"
        onChange={(file) => readImageAsDataUrl(file, setters.setTherapistSignatureDataUrl)}
        onError={() => void retryMediaIfBroken("signature")}
      />
      <MediaDropzone
        label="Foto de Perfil"
        value={values.therapistProfilePhotoUrl}
        alt="Foto de perfil"
        accept="image/*"
        emptyText="Clique para enviar foto"
        imageClassName="h-24 w-24 rounded-2xl object-cover"
        onChange={(file) => readImageAsDataUrl(file, setters.setTherapistProfilePhotoUrl)}
        onError={() => void retryMediaIfBroken("profile")}
      />
      <div className="md:col-span-2 flex justify-end">
        <SaveButton onSave={onSave}>Salvar documentos</SaveButton>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Configurações globais</p>
            <h3 className="mt-1 text-2xl font-black text-slate-900">
              {isTherapist ? "Meu Perfil Profissional" : "Meu Perfil e Configurações da Clínica"}
            </h3>
            <p className="mt-2 max-w-3xl text-sm font-medium text-slate-500">
              Dados preenchidos uma vez e reutilizados em Pré-guia TISS, Pré-faturamento, Fechamento, documentos, relatórios, notificações e agenda.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canEditAnamnesisTemplate && (
              <button
                type="button"
                onClick={onOpenAnamnesisTemplate}
                disabled={loadingAnamnesisTemplate}
                className="rounded-xl border border-[#7a32fc]/25 bg-white px-4 py-2.5 text-sm font-bold text-[#7a32fc] transition-all hover:bg-[#f6f0ff] disabled:opacity-60"
              >
                {loadingAnamnesisTemplate ? "Carregando ficha..." : "Editar Ficha Anamnese"}
              </button>
            )}
            <SaveButton onSave={onSave}>{isTherapist ? "Salvar perfil" : "Salvar cadastro global"}</SaveButton>
          </div>
        </div>
      </div>

      {isTherapist ? (
        <>
          <SectionCard title="Perfil profissional e faturável" description="Cadastre seus dados profissionais uma vez para reutilizá-los em Pré-guias TISS, relatórios, documentos e pré-faturamento." complete={responsibleComplete && professionalBillingComplete} hasAnyData={Boolean(values.therapistFullName || values.therapistPhone || values.therapistEmail || values.therapistCrp || values.therapistCboCode)}>
            {professionalFields}
          </SectionCard>
          <SectionCard title="Dados assistenciais e documentos" description="Assinatura e foto seguem o fluxo existente e continuam sendo usadas em relatórios e documentos." complete={mediaComplete} hasAnyData={mediaComplete}>
            {mediaFields}
          </SectionCard>
        </>
      ) : (
        <>
          {canManageClinicSettings ? (
            <>
              <SectionCard id="clinic-master-data" title="Dados da clínica" description="Dados usados em documentos, notificações, relatórios e identificação pública da clínica." complete={clinicCoreComplete} hasAnyData={Boolean(values.clinicDisplayName || values.clinicCnpj || values.clinicPhone || values.clinicEmail)}>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <label className={`${labelClass} md:col-span-2`}>
                    Nome fantasia da clínica
                    <input type="text" value={values.clinicDisplayName} onChange={(event) => setters.setClinicDisplayName(event.target.value)} placeholder="Nome público da clínica" className={inputClass} />
                  </label>
                  <label className={labelClass}>
                    Razão social
                    <input type="text" value={values.clinicLegalName} onChange={(event) => setters.setClinicLegalName(event.target.value)} placeholder="Razão social do prestador" className={inputClass} />
                  </label>
                  <div className="grid grid-cols-[130px_1fr] gap-3">
                    <label className={labelClass}>
                      Tipo
                      <select value={values.clinicDocumentType} onChange={(event) => { setters.setClinicDocumentType(event.target.value); setters.setClinicCnpj(formatDocument(values.clinicCnpj, event.target.value)); }} className={inputClass}>
                        <option value="CNPJ">CNPJ</option>
                        <option value="CPF">CPF</option>
                      </select>
                    </label>
                    <label className={labelClass}>
                      CPF/CNPJ
                      <input type="text" value={values.clinicCnpj} onChange={(event) => setters.setClinicCnpj(formatDocument(event.target.value, values.clinicDocumentType))} placeholder={values.clinicDocumentType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"} className={inputClass} />
                    </label>
                  </div>
                  <label className={labelClass}>
                    CNES
                    <input type="text" value={values.clinicCnesCode} onChange={(event) => setters.setClinicCnesCode(onlyDigits(event.target.value, 12))} placeholder="CNES da clínica" className={inputClass} />
                  </label>
                  <label className={labelClass}>
                    Código do prestador
                    <input type="text" value={values.clinicProviderCode} onChange={(event) => setters.setClinicProviderCode(event.target.value)} placeholder="Código no convênio/operadora" className={inputClass} />
                  </label>
                  <div className="md:col-span-2">
                    <MediaDropzone
                      label="Logotipo da Clínica"
                      value={values.clinicLogoDataUrl}
                      alt="Logo da clínica"
                      accept="image/png,image/webp,image/jpeg"
                      emptyText="Clique para enviar logotipo"
                      imageClassName="max-h-28 object-contain"
                      onChange={(file) => readImageAsDataUrl(file, setters.setClinicLogoDataUrl)}
                      onError={() => void retryMediaIfBroken("logo")}
                    />
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <SaveButton onSave={onSave}>Salvar dados da clínica</SaveButton>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Dados de contato" description="Contatos e endereço reutilizados em documentos, notificações e relatórios." complete={contactComplete} hasAnyData={Boolean(values.clinicEmail || values.clinicPhone || values.clinicWhatsapp || values.clinicAddressLine || values.clinicCity)}>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <label className={labelClass}>E-mail institucional<input type="email" value={values.clinicEmail} onChange={(event) => setters.setClinicEmail(event.target.value)} placeholder="contato@clinica.com" className={inputClass} /></label>
                  <label className={labelClass}>Telefone principal<input type="text" value={values.clinicPhone} onChange={(event) => setters.setClinicPhone(maskPhoneBR(event.target.value))} placeholder="(00) 00000-0000" className={inputClass} /></label>
                  <label className={labelClass}>WhatsApp<input type="text" value={values.clinicWhatsapp} onChange={(event) => setters.setClinicWhatsapp(maskPhoneBR(event.target.value))} placeholder="(00) 00000-0000" className={inputClass} /></label>
                  <label className={labelClass}>Site<input type="url" value={values.clinicSite} onChange={(event) => setters.setClinicSite(event.target.value)} placeholder="https://clinica.com.br" className={inputClass} /></label>
                  <label className={labelClass}>Endereço<input type="text" value={values.clinicAddressLine} onChange={(event) => { setters.setClinicAddressLine(event.target.value); setters.setClinicAddress(event.target.value); }} placeholder="Rua, avenida, travessa" className={inputClass} /></label>
                  <label className={labelClass}>Número<input type="text" value={values.clinicAddressNumber} onChange={(event) => setters.setClinicAddressNumber(event.target.value)} placeholder="Número" className={inputClass} /></label>
                  <label className={labelClass}>Complemento<input type="text" value={values.clinicAddressComplement} onChange={(event) => setters.setClinicAddressComplement(event.target.value)} placeholder="Sala, bloco, andar" className={inputClass} /></label>
                  <label className={labelClass}>Bairro<input type="text" value={values.clinicDistrict} onChange={(event) => setters.setClinicDistrict(event.target.value)} placeholder="Bairro" className={inputClass} /></label>
                  <label className={labelClass}>Cidade<input type="text" value={values.clinicCity} onChange={(event) => setters.setClinicCity(event.target.value)} placeholder="Cidade" className={inputClass} /></label>
                  <label className={labelClass}>UF<input type="text" value={values.clinicStateUf} onChange={(event) => setters.setClinicStateUf(event.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2} className={inputClass} /></label>
                  <label className={labelClass}>CEP<input type="text" value={values.clinicPostalCode} onChange={(event) => setters.setClinicPostalCode(maskCep(event.target.value))} placeholder="00000-000" className={inputClass} /></label>
                  <div className="md:col-span-2 flex justify-end"><SaveButton onSave={onSave}>Salvar contato</SaveButton></div>
                </div>
              </SectionCard>

              <SectionCard title="Dados fiscais e documentais" description="Dados fiscais/TISS globais da clínica usados pela Pré-guia e futuras guias." complete={clinicFiscalComplete} hasAnyData={Boolean(values.clinicLegalName || values.clinicCnesCode || values.clinicProviderCode)}>
                <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">
                  Estes campos também são sincronizados com o perfil TISS do prestador. A Pré-guia consome este cadastro global, não dados preenchidos atendimento por atendimento.
                </p>
              </SectionCard>

              <SectionCard title="Profissional responsável" description="Dados do responsável técnico ou administrativo. Eles não substituem os dados da clínica." complete={responsibleComplete && professionalBillingComplete} hasAnyData={Boolean(values.therapistFullName || values.therapistCpf || values.therapistCrp)}>
                {professionalFields}
              </SectionCard>

              <SectionCard title="Dados assistenciais e documentos" description="Assinatura e foto seguem o fluxo existente e continuam funcionando como antes." complete={mediaComplete} hasAnyData={mediaComplete}>
                {mediaFields}
              </SectionCard>

              <SectionCard title="Preferências da clínica" description="Preferências operacionais usadas na agenda e nas rotinas administrativas." complete={Boolean(values.workStart && values.workEnd)} hasAnyData>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <label className={labelClass}>Início do expediente<input type="time" value={values.workStart} onChange={(event) => setters.setWorkStart(event.target.value)} className={inputClass} /></label>
                  <label className={labelClass}>Fim do expediente<input type="time" value={values.workEnd} onChange={(event) => setters.setWorkEnd(event.target.value)} className={inputClass} /></label>
                  <div className="md:col-span-2 flex justify-end"><SaveButton onSave={onSave}>Salvar preferências</SaveButton></div>
                </div>
              </SectionCard>

              <AbaPromptTypesSettings />

              <BillingTissSettingsPanel onEditClinicData={scrollToClinicData} onNavigatePayers={() => navigateToTab("payers")} onNavigateProfessionals={() => navigateToTab("team")} />
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 shadow-sm">
              Configurações iniciais da clínica disponíveis apenas para coordenação.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {canManageBilling && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm font-bold text-blue-900">Plano {normalizedPlanName}</p>
                  <span className="rounded-lg bg-blue-100 px-3 py-1 text-[10px] font-bold uppercase text-[#7a32fc]">Ativo</span>
                </div>
                <p className="mb-6 text-xs text-blue-600">Sua clínica possui acesso às ferramentas de gestão e prontuário eletrônico.</p>
                <button onClick={() => navigateToTab("billing")} className="w-full rounded-2xl bg-[#7a32fc] py-3 text-xs font-bold text-white shadow-sm transition-all hover:opacity-90">
                  Gerenciar Assinatura
                </button>
              </div>
            )}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400">Gestão da clínica</h4>
              <p className="mt-2 text-sm text-slate-500">Acompanhe as permissões de cada papel para organizar acessos, responsabilidades e rotinas da equipe.</p>
              <RoleCapabilityMatrix />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
