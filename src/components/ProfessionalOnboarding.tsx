import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  CalendarClock,
  Camera,
  FileSignature,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { SecureImage } from './SecureMedia';
import { formatProfessionalRegistry } from '../utils/professionalRegistry';

type OnboardingContext = {
  onboardingMode: 'invited_professional' | 'clinic_member' | 'clinic_owner' | 'standard' | 'invalid';
  requiresPayment: boolean;
  canAccessDashboard: boolean;
  canEditClinic: boolean;
  errorCode?: string | null;
  clinic: {
    id: string;
    name: string;
    phone?: string | null;
    whatsapp?: string | null;
    logoUrl?: string | null;
    address?: string | null;
    subscriptionStatus?: string | null;
    billingModel?: string | null;
  } | null;
  membership: {
    role: string;
    specialty?: string | null;
    invitedBy?: string | null;
    invitationId?: string | null;
    invitationStatus?: string | null;
  } | null;
};

interface ProfessionalOnboardingProps {
  user: any;
  onComplete: (data: any) => void;
  onClose?: () => void;
}

const WEEKDAYS = [
  ['monday', 'Segunda'],
  ['tuesday', 'Terça'],
  ['wednesday', 'Quarta'],
  ['thursday', 'Quinta'],
  ['friday', 'Sexta'],
  ['saturday', 'Sábado'],
  ['sunday', 'Domingo'],
] as const;

const roleLabel = (role: string) => {
  if (role === 'coordinator') return 'Coordenador';
  if (role === 'receptionist') return 'Recepcionista/Assistente';
  if (role === 'admin') return 'Administrador';
  if (role === 'owner') return 'Proprietário';
  return 'Profissional de atendimento';
};

export function ProfessionalOnboarding({ user, onComplete, onClose }: ProfessionalOnboardingProps) {
  const initialContext = (user?.onboardingContext || null) as OnboardingContext | null;
  const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || 'global').trim() || 'global';
  const draftKey = `verto:onboarding:draft:${String(user?.id || '').trim()}:${workspaceId}`;
  const stepKey = `verto:onboarding:step:${String(user?.id || '').trim()}:${workspaceId}`;

  const [context, setContext] = useState<OnboardingContext | null>(initialContext);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [step, setStep] = useState(() => Math.max(1, Math.min(3, Number(localStorage.getItem(stepKey) || 1))));
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [cpf, setCpf] = useState(user?.cpf || '');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');
  const [countryCode, setCountryCode] = useState('+55');
  const [profilePicture, setProfilePicture] = useState<string | null>(user?.profilePicture || null);
  const [council, setCouncil] = useState('');
  const [councilNumber, setCouncilNumber] = useState(user?.crp || '');
  const [miniCurriculum, setMiniCurriculum] = useState(user?.miniCurriculum || '');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(user?.signatureDataUrl || null);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState('50');
  const [selectedDays, setSelectedDays] = useState<string[]>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  const [workStart, setWorkStart] = useState('08:00');
  const [workEnd, setWorkEnd] = useState('18:00');

  // Owner-only clinic fields. They are never submitted for invited members.
  const [clinicName, setClinicName] = useState(user?.clinicSettings?.clinicName || '');
  const [clinicPhone, setClinicPhone] = useState(user?.clinicSettings?.clinicPhone || '');
  const [clinicLogoUrl, setClinicLogoUrl] = useState<string | null>(user?.clinicSettings?.clinicLogoUrl || null);
  const [clinicOperationType, setClinicOperationType] = useState<'private' | 'insurance' | 'mixed'>('mixed');

  const isManagedMember = Boolean(
    context?.clinic?.id &&
    ['invited_professional', 'clinic_member'].includes(context?.onboardingMode || ''),
  );
  const isOwnerOnboarding = context?.requiresPayment === true;
  const maxStep = isManagedMember ? 3 : 2;
  const specialty = context?.membership?.specialty || user?.specialties || '';
  const effectiveRole = context?.membership?.role || user?.role || 'therapist';

  const schedule = useMemo(() => {
    const days = Object.fromEntries(
      WEEKDAYS.map(([key]) => [
        key,
        selectedDays.includes(key)
          ? { enabled: true, periods: [{ start: workStart, end: workEnd }], intervals: [] }
          : { enabled: false, periods: [], intervals: [] },
      ]),
    );
    const duration = Number(sessionDurationMinutes) || 50;
    return {
      active: true,
      stepMinutes: duration,
      defaultSessionDurationMinutes: duration,
      minLeadMinutes: 120,
      maxSlotsPerDay: 8,
      sessionBufferMinutes: 0,
      days,
      exceptions: [],
    };
  }, [selectedDays, sessionDurationMinutes, workStart, workEnd]);

  useEffect(() => {
    localStorage.setItem(stepKey, String(Math.min(step, maxStep)));
  }, [maxStep, step, stepKey]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setContextLoading(true);
      setContextError(null);
      try {
        const [contextResult, profileResult] = await Promise.all([
          dataService.getOnboardingContext(),
          dataService.getUserProfile(user.id),
        ]);
        if (!active) return;
        if (!contextResult?.success || !contextResult?.data?.clinic?.id) {
          throw new Error(contextResult?.error || 'Não foi possível identificar a clínica vinculada ao seu acesso.');
        }
        const authoritativeContext = contextResult.data as OnboardingContext;
        setContext(authoritativeContext);
        const profile = profileResult?.data?.professional_profile;
        const metadata = profile?.metadata || {};
        const savedSchedule = metadata?.workSchedule || metadata?.work_schedule;

        const draftRaw = user?.firstLoginCompleted === false ? localStorage.getItem(draftKey) : null;
        const draft = draftRaw ? JSON.parse(draftRaw) : {};
        setFullName(profile?.full_name || draft.fullName || user?.name || '');
        setPhone(profile?.phone || draft.phone || user?.phone || '');
        setCpf(profile?.cpf || metadata?.cpf || draft.cpf || user?.cpf || '');
        setBirthDate(profile?.birth_date || draft.birthDate || '');
        setGender(profile?.gender || draft.gender || '');
        setCountryCode(profile?.country_code || draft.countryCode || '+55');
        setProfilePicture(profile?.profile_photo_url || draft.profilePicture || user?.profilePicture || null);
        setCouncil(profile?.council || draft.council || '');
        setCouncilNumber(formatProfessionalRegistry(profile?.council_number || draft.councilNumber || user?.crp || ''));
        setMiniCurriculum(profile?.mini_curriculum || metadata?.miniCurriculum || draft.miniCurriculum || user?.miniCurriculum || '');
        setSignatureDataUrl(profile?.signature_data_url || draft.signatureDataUrl || user?.signatureDataUrl || null);
        setSessionDurationMinutes(String(metadata?.sessionDurationMinutes || metadata?.defaultSessionDurationMinutes || draft.sessionDurationMinutes || '50'));

        if (savedSchedule?.days) {
          setSelectedDays(WEEKDAYS.filter(([key]) => savedSchedule.days?.[key]?.enabled !== false && savedSchedule.days?.[key]?.periods?.length).map(([key]) => key));
          const firstPeriod = WEEKDAYS.map(([key]) => savedSchedule.days?.[key]?.periods?.[0]).find(Boolean);
          if (firstPeriod?.start) setWorkStart(firstPeriod.start);
          if (firstPeriod?.end) setWorkEnd(firstPeriod.end);
        } else {
          setSelectedDays(Array.isArray(draft.selectedDays) ? draft.selectedDays : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
          setWorkStart(draft.workStart || '08:00');
          setWorkEnd(draft.workEnd || '18:00');
        }

        // Clinic identity is server-authoritative for invited members.
        setClinicName(authoritativeContext.clinic?.name || user?.clinicSettings?.clinicName || '');
        setClinicPhone(authoritativeContext.clinic?.phone || authoritativeContext.clinic?.whatsapp || user?.clinicSettings?.clinicPhone || '');
        setClinicLogoUrl(authoritativeContext.clinic?.logoUrl || user?.clinicSettings?.clinicLogoUrl || null);
      } catch (error: any) {
        if (active) setContextError(error?.message || 'Não foi possível carregar seu vínculo com a clínica.');
      } finally {
        if (active) setContextLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [draftKey, user]);

  useEffect(() => {
    if (user?.firstLoginCompleted !== false || contextLoading) return;
    localStorage.setItem(draftKey, JSON.stringify({
      fullName,
      phone,
      cpf,
      birthDate,
      gender,
      countryCode,
      profilePicture,
      council,
      councilNumber,
      miniCurriculum,
      signatureDataUrl,
      sessionDurationMinutes,
      selectedDays,
      workStart,
      workEnd,
      ...(isOwnerOnboarding ? { clinicName, clinicPhone, clinicLogoUrl, clinicOperationType } : {}),
    }));
  }, [
    birthDate, clinicLogoUrl, clinicName, clinicOperationType, clinicPhone, contextLoading,
    countryCode, council, councilNumber, cpf, draftKey, fullName, gender, isOwnerOnboarding,
    miniCurriculum, phone, profilePicture, selectedDays, sessionDurationMinutes, signatureDataUrl,
    user?.firstLoginCompleted, workEnd, workStart,
  ]);

  const toBase64 = (file: File, cb: (value: string) => void) => {
    if (file.size > 900 * 1024) {
      alert('A imagem está muito grande. Use um arquivo com até 900KB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => cb(reader.result as string);
    reader.readAsDataURL(file);
  };

  const parseJsonSafe = async (response: Response) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { success: false, error: `Resposta inválida do servidor (HTTP ${response.status})` };
    }
  };

  const uploadImageIfNeeded = async (input: string | null, kind: 'profile' | 'logo' | 'signature') => {
    if (!input) return { url: null as string | null, path: null as string | null };
    if (!input.startsWith('data:image/')) return { url: input, path: null as string | null };
    const mime = input.match(/^data:([^;]+);base64,/)?.[1] || 'image/png';
    const extension = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    const label = kind === 'profile' ? 'perfil' : kind === 'logo' ? 'logo' : 'assinatura';
    const response = await fetch('/api/storage/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket: 'patient-photos',
        path: `onboarding/${user.id}/${label}-${Date.now()}.${extension}`,
        contentType: mime,
        fileBase64: input,
      }),
    });
    const result = await parseJsonSafe(response);
    if (!response.ok || !result?.success || !result?.url) {
      throw new Error(result?.error || `Não foi possível enviar a imagem (${label}).`);
    }
    return { url: result.url as string, path: result.path ? `patient-photos/${result.path}` : null };
  };

  const finish = async () => {
    if (!fullName.trim() || !phone.trim()) {
      alert('Preencha nome e telefone para continuar.');
      return;
    }
    if (!context?.clinic?.id) {
      alert('Não foi possível identificar a clínica vinculada ao seu acesso.');
      return;
    }
    setLoading(true);
    try {
      const [profileUpload, signatureUpload, clinicLogoUpload] = await Promise.all([
        uploadImageIfNeeded(profilePicture, 'profile'),
        uploadImageIfNeeded(signatureDataUrl, 'signature'),
        isOwnerOnboarding
          ? uploadImageIfNeeded(clinicLogoUrl, 'logo')
          : Promise.resolve({ url: context.clinic.logoUrl || null, path: null as string | null }),
      ]);

      const memberPayload = {
        fullName,
        birthDate,
        gender,
        countryCode,
        phone,
        cpf,
        council,
        councilNumber,
        miniCurriculum,
        sessionDurationMinutes: Number(sessionDurationMinutes),
        workSchedule: schedule,
        signatureDataUrl: signatureUpload.url,
        signaturePath: signatureUpload.path,
        profilePicture: profileUpload.url,
        profilePicturePath: profileUpload.path,
      };
      const ownerPayload = {
        ...memberPayload,
        clinicName,
        clinicPhone,
        clinicLogoUrl: clinicLogoUpload.url,
        clinicLogoPath: clinicLogoUpload.path,
        clinicOperationType,
      };
      const response = await fetch(`/api/profile/${user.id}/complete-onboarding`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isManagedMember ? memberPayload : ownerPayload),
      });
      const result = await parseJsonSafe(response);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Falha ao concluir sua configuração.');
      }
      localStorage.removeItem(draftKey);
      localStorage.removeItem(stepKey);
      onComplete({
        ...(result.user || {}),
        name: fullName,
        crp: councilNumber || null,
        cpf: cpf || null,
        phone: phone || null,
        specialties: specialty || null,
        miniCurriculum: miniCurriculum || null,
        profilePicture: profileUpload.url,
        signatureDataUrl: signatureUpload.url,
        firstLoginCompleted: true,
        onboardingContext: result.onboardingContext || context,
        subscriptionStatus: result.subscriptionStatus ?? user?.subscriptionStatus ?? null,
        clinicSettings: isManagedMember
          ? {
              ...(user?.clinicSettings || {}),
              clinicName: context.clinic.name,
              clinicPhone: context.clinic.phone || context.clinic.whatsapp || null,
              clinicLogoUrl: context.clinic.logoUrl || null,
              specialty: specialty || null,
            }
          : {
              ...(user?.clinicSettings || {}),
              clinicName,
              clinicPhone,
              clinicLogoUrl: clinicLogoUpload.url,
              clinicOperationType,
            },
      });
    } catch (error: any) {
      alert(error?.message || 'Não foi possível concluir sua configuração.');
    } finally {
      setLoading(false);
    }
  };

  if (contextLoading) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-50 p-6">
        <div className="rounded-3xl border border-slate-100 bg-white px-8 py-10 text-center shadow-sm">
          <Loader2 className="mx-auto animate-spin text-[#7a32fc]" size={32} />
          <p className="mt-4 text-sm text-slate-500">Carregando seu vínculo com a clínica...</p>
        </div>
      </div>
    );
  }

  if (contextError || !context?.clinic?.id) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-3xl border border-red-100 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto text-red-500" size={34} />
          <h2 className="mt-4 text-xl font-bold text-slate-900">Vínculo não encontrado</h2>
          <p className="mt-2 text-sm text-slate-500">{contextError || 'Fale com o responsável da clínica para revisar seu convite.'}</p>
          {onClose && <button onClick={onClose} className="mt-6 rounded-xl bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">Fechar</button>}
        </div>
      </div>
    );
  }

  const sidebarSteps = isManagedMember
    ? ['Dados pessoais e profissionais', 'Configurações clínicas individuais', 'Horários e vínculo']
    : ['Dados do usuário', 'Configurações da clínica'];

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="flex min-h-full w-full items-start justify-center py-2 md:py-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-5xl rounded-3xl border border-slate-100 bg-white shadow-xl">
          <div className="grid min-h-[680px] md:grid-cols-[320px_1fr]">
            <div className="rounded-t-3xl bg-[#7a32fc] p-8 text-white md:rounded-l-3xl md:rounded-tr-none">
              <h2 className="text-2xl font-bold">Boas-vindas à Verto</h2>
              <p className="mt-3 text-sm text-violet-100">
                {isManagedMember
                  ? 'Complete suas informações profissionais para acessar a clínica à qual você foi convidado.'
                  : 'Complete os dados iniciais da clínica antes de escolher o plano.'}
              </p>
              <div className="mt-8 space-y-3 text-xs">
                {sidebarSteps.map((label, index) => (
                  <div key={label} className={step >= index + 1 ? 'font-semibold text-white' : 'text-violet-200'}>
                    {index + 1}. {label}
                  </div>
                ))}
                {!isManagedMember && (
                  <>
                    <div className="text-violet-200">3. Plano por pacientes ativos</div>
                    <div className="text-violet-200">4. Cartão e assinatura</div>
                  </>
                )}
              </div>
            </div>

            <div className="relative p-6 md:p-8">
              {onClose && (
                <button onClick={onClose} className="absolute right-6 top-6 text-slate-400 hover:text-slate-600" aria-label="Fechar onboarding">
                  <X size={18} />
                </button>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <h3 className="text-lg font-bold text-slate-900">Dados pessoais e profissionais</h3>
                  <p className="text-sm text-slate-500">Preencha seus dados. A clínica e a especialidade vêm do convite e não podem ser trocadas aqui.</p>
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50">
                      {profilePicture ? <SecureImage src={profilePicture} alt="Foto de perfil" className="h-full w-full object-cover" /> : <Camera size={24} className="text-slate-400" />}
                    </div>
                    <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                      Escolher foto
                      <input type="file" className="hidden" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) toBase64(file, setProfilePicture); }} />
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Nome completo" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Telefone ou WhatsApp" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <input value={cpf} onChange={(event) => setCpf(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="CPF (quando aplicável)" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <input value={birthDate} onChange={(event) => setBirthDate(event.target.value)} type="date" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <select value={gender} onChange={(event) => setGender(event.target.value)} className="rounded-xl bg-slate-50 px-4 py-3">
                      <option value="">Gênero (opcional)</option>
                      <option value="female">Feminino</option>
                      <option value="male">Masculino</option>
                      <option value="other">Outro</option>
                      <option value="prefer_not_to_say">Prefiro não informar</option>
                    </select>
                    <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-violet-500">Especialidade vinculada</p>
                      <p className="mt-1 text-sm font-semibold text-violet-900">{specialty || 'Definida pela clínica'}</p>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button disabled={!fullName.trim() || !phone.trim()} onClick={() => setStep(2)} className="rounded-xl bg-[#7a32fc] px-6 py-3 font-semibold text-white disabled:opacity-40">Continuar</button>
                  </div>
                </div>
              )}

              {step === 2 && isManagedMember && (
                <div className="space-y-5">
                  <h3 className="text-lg font-bold text-slate-900">Configurações clínicas individuais</h3>
                  <p className="text-sm text-slate-500">Essas informações pertencem ao seu perfil profissional e serão usadas em documentos clínicos.</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <input value={council} onChange={(event) => setCouncil(event.target.value)} placeholder="Conselho profissional" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <input value={councilNumber} onChange={(event) => setCouncilNumber(formatProfessionalRegistry(event.target.value))} placeholder="Número do conselho" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <select value={sessionDurationMinutes} onChange={(event) => setSessionDurationMinutes(event.target.value)} className="rounded-xl bg-slate-50 px-4 py-3">
                      <option value="30">Sessões de 30 minutos</option>
                      <option value="45">Sessões de 45 minutos</option>
                      <option value="50">Sessões de 50 minutos</option>
                      <option value="60">Sessões de 60 minutos</option>
                      <option value="90">Sessões de 90 minutos</option>
                    </select>
                    <input value={countryCode} onChange={(event) => setCountryCode(event.target.value)} placeholder="Código do país" className="rounded-xl bg-slate-50 px-4 py-3" />
                  </div>
                  <textarea value={miniCurriculum} onChange={(event) => setMiniCurriculum(event.target.value.slice(0, 4000))} placeholder="Minicurrículo profissional" rows={5} className="w-full rounded-xl bg-slate-50 px-4 py-3" />
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                      <FileSignature className="text-violet-500" size={22} />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Assinatura profissional</p>
                        <p className="text-xs text-slate-500">Use uma imagem nítida com fundo claro.</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-4">
                      {signatureDataUrl && <SecureImage src={signatureDataUrl} alt="Assinatura" className="h-16 max-w-[220px] rounded-lg border border-slate-100 object-contain" />}
                      <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                        Selecionar assinatura
                        <input type="file" className="hidden" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) toBase64(file, setSignatureDataUrl); }} />
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-between pt-2">
                    <button onClick={() => setStep(1)} className="rounded-xl bg-slate-100 px-6 py-3 font-semibold text-slate-700">Voltar</button>
                    <button onClick={() => setStep(3)} className="rounded-xl bg-[#7a32fc] px-6 py-3 font-semibold text-white">Continuar</button>
                  </div>
                </div>
              )}

              {step === 2 && !isManagedMember && (
                <div className="space-y-5">
                  <h3 className="text-lg font-bold text-slate-900">Configurações da clínica</h3>
                  <p className="text-sm text-slate-500">Configure os dados mínimos da nova clínica. O fluxo comercial permanece disponível somente para o responsável.</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <input value={clinicName} onChange={(event) => setClinicName(event.target.value)} placeholder="Nome da clínica" className="rounded-xl bg-slate-50 px-4 py-3" />
                    <input value={clinicPhone} onChange={(event) => setClinicPhone(event.target.value)} placeholder="Telefone ou WhatsApp da clínica" className="rounded-xl bg-slate-50 px-4 py-3" />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      ['private', 'Particular'],
                      ['insurance', 'Convênio'],
                      ['mixed', 'Ambos'],
                    ].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => setClinicOperationType(value as 'private' | 'insurance' | 'mixed')} className={`rounded-2xl border px-4 py-3 text-left ${clinicOperationType === value ? 'border-violet-400 bg-violet-50' : 'border-slate-200'}`}>
                        <span className="text-sm font-bold text-slate-900">{label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between pt-2">
                    <button onClick={() => setStep(1)} className="rounded-xl bg-slate-100 px-6 py-3 font-semibold text-slate-700">Voltar</button>
                    <button disabled={loading || !clinicName.trim()} onClick={finish} className="rounded-xl bg-[#7a32fc] px-6 py-3 font-semibold text-white disabled:opacity-40">
                      {loading ? 'Salvando...' : 'Continuar para o plano'}
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && isManagedMember && (
                <div className="space-y-5">
                  <h3 className="text-lg font-bold text-slate-900">Horários e vínculo</h3>
                  <p className="text-sm text-slate-500">Defina sua disponibilidade e confirme a clínica à qual você foi vinculado.</p>
                  <div className="rounded-2xl border border-violet-100 bg-violet-50 p-5">
                    <div className="flex items-start gap-3">
                      <Building2 className="mt-0.5 text-violet-600" size={22} />
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-violet-500">Clínica vinculada</p>
                        <p className="mt-1 text-base font-bold text-violet-950">{context.clinic.name}</p>
                        <p className="mt-1 text-sm text-violet-800">{context.clinic.phone || context.clinic.whatsapp || 'Contato administrado pela clínica'}</p>
                        <p className="mt-2 text-xs text-violet-700">{roleLabel(effectiveRole)}{specialty ? ` · ${specialty}` : ''}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center gap-3">
                      <CalendarClock className="text-violet-500" size={22} />
                      <p className="text-sm font-semibold text-slate-800">Disponibilidade semanal</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {WEEKDAYS.map(([key, label]) => {
                        const selected = selectedDays.includes(key);
                        return (
                          <button key={key} type="button" onClick={() => setSelectedDays((current) => selected ? current.filter((item) => item !== key) : [...current, key])} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${selected ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="text-xs font-medium text-slate-600">Início<input type="time" value={workStart} onChange={(event) => setWorkStart(event.target.value)} className="mt-2 w-full rounded-xl bg-slate-50 px-4 py-3" /></label>
                      <label className="text-xs font-medium text-slate-600">Fim<input type="time" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} className="mt-2 w-full rounded-xl bg-slate-50 px-4 py-3" /></label>
                    </div>
                  </div>
                  <div className="flex justify-between pt-2">
                    <button onClick={() => setStep(2)} className="rounded-xl bg-slate-100 px-6 py-3 font-semibold text-slate-700">Voltar</button>
                    <button disabled={loading || selectedDays.length === 0 || workStart >= workEnd} onClick={finish} className="rounded-xl bg-[#7a32fc] px-6 py-3 font-semibold text-white disabled:opacity-40">
                      {loading ? 'Salvando...' : 'Concluir configuração'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
