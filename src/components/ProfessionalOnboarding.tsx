import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, CheckCircle2, UploadCloud, X } from 'lucide-react';
import { dataService } from '../services/dataService';
import { SecureImage } from './SecureMedia';
import { formatProfessionalRegistry } from '../utils/professionalRegistry';

interface ProfessionalOnboardingProps {
  user: any;
  onComplete: (data: any) => void;
  onClose?: () => void;
}

export function ProfessionalOnboarding({ user, onComplete, onClose }: ProfessionalOnboardingProps) {
  const formatCnpjInput = (value: string) => {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };
  const isCoordinator = user.role === 'coordinator' || user.role === 'admin';
  const isTherapist = user.role === 'therapist';
  const onboardingWorkspaceId = String(user?.activeWorkspaceId || user?.clinicId || 'global').trim() || 'global';
  const onboardingDraftKey = `verto:onboarding:draft:${String(user?.id || '').trim()}:${onboardingWorkspaceId}`;
  const onboardingStepKey = `verto:onboarding:step:${String(user?.id || '').trim()}:${onboardingWorkspaceId}`;

  const [step, setStep] = useState(() => {
    const raw = Number(localStorage.getItem(onboardingStepKey) || 1);
    return raw === 2 ? 2 : 1;
  });
  const [loading, setLoading] = useState(false);

  const [fullName, setFullName] = useState(user.name || '');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState('50');
  const [countryCode, setCountryCode] = useState('+55');
  const [phone, setPhone] = useState('');
  const [profilePicture, setProfilePicture] = useState<string | null>(
    user?.profilePicture || user?.profile_picture || null,
  );

  const [clinicName, setClinicName] = useState('');
  const [clinicLogoUrl, setClinicLogoUrl] = useState<string | null>(
    user?.clinicSettings?.clinicLogoUrl || null,
  );
  const [clinicCnpj, setClinicCnpj] = useState('');
  const [clinicPhone, setClinicPhone] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [council, setCouncil] = useState('');
  const [councilNumber, setCouncilNumber] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(
    user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null,
  );

  useEffect(() => {
    localStorage.setItem(onboardingStepKey, String(step));
  }, [step, onboardingStepKey]);

  useEffect(() => {
    const loadExistingProfile = async () => {
      try {
        const shouldRestoreDraft = user?.firstLoginCompleted === false;
        const draftRaw = shouldRestoreDraft ? localStorage.getItem(onboardingDraftKey) : null;
        if (!shouldRestoreDraft) {
          localStorage.removeItem(onboardingDraftKey);
          localStorage.removeItem(onboardingStepKey);
        }
        if (draftRaw) {
          const draft = JSON.parse(draftRaw);
          setFullName(String(draft.fullName || fullName || ''));
          setBirthDate(String(draft.birthDate || ''));
          setGender(String(draft.gender || ''));
          setCep(String(draft.cep || ''));
          setLogradouro(String(draft.logradouro || ''));
          setNumber(String(draft.number || ''));
          setComplement(String(draft.complement || ''));
          setBairro(String(draft.bairro || ''));
          setCidade(String(draft.cidade || ''));
          setSessionDurationMinutes(String(draft.sessionDurationMinutes || '50'));
          setCountryCode(String(draft.countryCode || '+55'));
          setPhone(String(draft.phone || ''));
          setProfilePicture(draft.profilePicture || user?.profilePicture || user?.profile_picture || null);
          setClinicName(String(draft.clinicName || ''));
          setClinicLogoUrl(draft.clinicLogoUrl || user?.clinicSettings?.clinicLogoUrl || null);
          setClinicCnpj(formatCnpjInput(String(draft.clinicCnpj || '')));
          setClinicPhone(String(draft.clinicPhone || ''));
          setSpecialty(String(draft.specialty || ''));
          setCouncil(String(draft.council || ''));
          setCouncilNumber(formatProfessionalRegistry(String(draft.councilNumber || '')));
          setSignatureDataUrl(draft.signatureDataUrl || user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null);
        }
        if (isTherapist && user?.clinicSettings?.clinicName) {
          setClinicName(String(user.clinicSettings.clinicName));
        }
        const result = await dataService.getUserProfile(user.id);
        const profile = result?.data?.professional_profile;
        if (!profile) return;

        setFullName(profile.full_name || user.name || "");
        setBirthDate(profile.birth_date || "");
        setGender(profile.gender || "");
        setCountryCode(profile.country_code || "+55");
        setPhone(profile.phone || "");
        setProfilePicture(profile.profile_photo_url || user?.profilePicture || user?.profile_picture || null);
        setClinicName(profile.clinic_name || user?.clinicSettings?.clinicName || "");
        setClinicLogoUrl(profile.clinic_logo_url || user?.clinicSettings?.clinicLogoUrl || null);
        setClinicCnpj(formatCnpjInput(profile.metadata?.clinicCnpj || profile.address?.cnpj || ""));
        setClinicPhone(profile.clinic_phone || "");
        setSpecialty(profile.specialty || "");
        setCouncil(profile.council || "");
        setCouncilNumber(formatProfessionalRegistry(profile.council_number || ""));
        setSignatureDataUrl(profile.signature_data_url || user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null);
        setSessionDurationMinutes(String(profile.metadata?.sessionDurationMinutes || "50"));

        const address = profile.address || {};
        setCep(address.cep || "");
        setLogradouro(address.logradouro || "");
        setNumber(address.number || "");
        setComplement(address.complement || "");
        setBairro(address.bairro || "");
        setCidade(address.cidade || "");
      } catch (error) {
        console.warn("Não foi possível carregar perfil existente para pré-preenchimento.");
      }
    };
    loadExistingProfile();
  }, [user.id, user.name, user.firstLoginCompleted, onboardingDraftKey, onboardingStepKey]);

  useEffect(() => {
    const draft = {
      fullName,
      birthDate,
      gender,
      cep,
      logradouro,
      number,
      complement,
      bairro,
      cidade,
      sessionDurationMinutes,
      countryCode,
      phone,
      profilePicture,
      clinicName,
      clinicLogoUrl,
      clinicCnpj,
      clinicPhone,
      specialty,
      council,
      councilNumber,
      signatureDataUrl
    };
    if (user?.firstLoginCompleted === false) {
      localStorage.setItem(onboardingDraftKey, JSON.stringify(draft));
    }
  }, [
    onboardingDraftKey,
    user?.firstLoginCompleted,
    fullName,
    birthDate,
    gender,
    cep,
    logradouro,
    number,
    complement,
    bairro,
    cidade,
    sessionDurationMinutes,
    countryCode,
    phone,
    profilePicture,
    clinicName,
    clinicLogoUrl,
    clinicCnpj,
    clinicPhone,
    specialty,
    council,
    councilNumber,
    signatureDataUrl
  ]);

  const canGoNextPersonal = fullName.trim() && birthDate && gender && cep && logradouro && number && bairro && cidade && phone;
  const councilRequired = isCoordinator || isTherapist;
  const canGoNextClinic = !isCoordinator || (clinicName.trim() && specialty.trim() && (!councilRequired || (council.trim() && councilNumber.trim())));

  const toBase64 = (file: File, cb: (v: string) => void) => {
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

    const mimeMatch = input.match(/^data:([^;]+);base64,/);
    const contentType = mimeMatch?.[1] || 'image/png';
    const extension = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    const safeKind = kind === 'profile' ? 'perfil' : kind === 'logo' ? 'logo' : 'assinatura';
    const objectPath = `onboarding/${user.id}/${safeKind}-${Date.now()}.${extension}`;

    const uploadResponse = await fetch('/api/storage/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket: 'patient-photos',
        path: objectPath,
        contentType,
        fileBase64: input
      })
    });

    const uploadResult = await parseJsonSafe(uploadResponse);
    if (!uploadResponse.ok || !uploadResult?.success || !uploadResult?.url) {
      throw new Error(uploadResult?.error || `Não foi possível enviar a imagem (${safeKind}).`);
    }
    return {
      url: uploadResult.url as string,
      path: uploadResult.path ? `patient-photos/${uploadResult.path}` : null
    };
  };

  const finish = async () => {
    if (!canGoNextPersonal) {
      alert('Preencha os dados cadastrais obrigatorios.');
      return;
    }
    if (councilRequired && (!council || !councilNumber)) {
      alert('Conselho e numero do conselho sao obrigatorios para este papel.');
      return;
    }

    setLoading(true);
    try {
      const [profileUpload, clinicLogoUpload, signatureUpload] = await Promise.all([
        uploadImageIfNeeded(profilePicture, 'profile'),
        uploadImageIfNeeded(clinicLogoUrl, 'logo'),
        uploadImageIfNeeded(signatureDataUrl, 'signature')
      ]);

      const response = await fetch(`/api/profile/${user.id}/complete-onboarding`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fullName,
          birthDate,
          gender,
          cep,
          logradouro,
          number,
          complement,
          bairro,
          cidade,
          sessionDurationMinutes: Number(sessionDurationMinutes),
          countryCode,
          phone,
          clinicName,
          clinicLogoUrl: clinicLogoUpload.url,
          clinicLogoPath: clinicLogoUpload.path,
          clinicCnpj,
          clinicPhone,
          specialty,
          council,
          councilNumber,
          signatureDataUrl: signatureUpload.url,
          signaturePath: signatureUpload.path,
          profilePicture: profileUpload.url,
          profilePicturePath: profileUpload.path
        })
      });

      const result = await parseJsonSafe(response);
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Falha ao concluir onboarding');
      }

      onComplete({
        name: fullName,
        crp: councilNumber || null,
        profilePicture: profileUpload.url,
        signatureDataUrl: signatureUpload.url,
        clinicSettings: {
          ...(user?.clinicSettings || {}),
          clinicName: clinicName || null,
          clinicLogoUrl: clinicLogoUpload.url,
          clinicCnpj: clinicCnpj || null,
          clinicPhone: clinicPhone || null,
          specialty: specialty || null,
          council: council || null,
          councilNumber: councilNumber || null,
          signatureDataUrl: signatureUpload.url,
        },
        firstLoginCompleted: true,
        subscriptionStatus: 'active'
      });
      localStorage.removeItem(onboardingDraftKey);
      localStorage.removeItem(onboardingStepKey);
    } catch (error: any) {
      alert(error.message || 'Nao foi possivel concluir onboarding.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-50 overflow-y-auto p-4 md:p-6">
      <div className="min-h-full w-full flex items-start justify-center py-2 md:py-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white w-full max-w-5xl rounded-3xl shadow-xl border border-slate-100">
        <div className="grid md:grid-cols-[320px_1fr] min-h-[680px]">
          <div className="bg-[#7a32fc] text-white p-8 rounded-l-3xl">
            <h2 className="text-2xl font-bold">Boas-vindas a Verto</h2>
            <p className="text-sm text-violet-100 mt-3">Complete seu onboarding para liberar o painel completo do seu papel.</p>
            <div className="mt-8 space-y-3 text-xs">
              <div className={step >= 1 ? 'text-white font-semibold' : 'text-violet-200'}>1. Cadastro Profissional</div>
              <div className={step >= 2 ? 'text-white font-semibold' : 'text-violet-200'}>2. Configuracoes da Clinica</div>
            </div>
          </div>

          <div className="p-8 relative">
            {onClose && (
              <button onClick={onClose} className="absolute right-6 top-6 text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <h3 className="text-lg font-bold text-slate-900">Dados cadastrais</h3>

                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl border border-dashed border-slate-300 overflow-hidden flex items-center justify-center bg-slate-50">
                    {profilePicture ? <SecureImage src={profilePicture} alt="Foto" className="w-full h-full object-cover" /> : <Camera size={24} className="text-slate-400" />}
                  </div>
                  <label className="text-xs font-semibold text-slate-700 cursor-pointer px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-all">
                    Escolher foto
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) toBase64(file, setProfilePicture);
                      }}
                    />
                  </label>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="px-4 py-3 rounded-xl bg-slate-50" />
                  <select value={gender} onChange={(e) => setGender(e.target.value)} className="px-4 py-3 rounded-xl bg-slate-50">
                    <option value="">Genero</option>
                    <option value="feminino">Feminino</option>
                    <option value="masculino">Masculino</option>
                    <option value="nao_binario">Nao binario</option>
                    <option value="prefiro_nao_informar">Prefiro nao informar</option>
                  </select>
                  <input value={cep} onChange={(e) => setCep(e.target.value)} placeholder="CEP" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} placeholder="Logradouro" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Numero" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Complemento" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Cidade" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} placeholder="Codigo do pais" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone" className="px-4 py-3 rounded-xl bg-slate-50" />
                  <select value={sessionDurationMinutes} onChange={(e) => setSessionDurationMinutes(e.target.value)} className="px-4 py-3 rounded-xl bg-slate-50">
                    <option value="30">Sessao 30 min</option>
                    <option value="45">Sessao 45 min</option>
                    <option value="50">Sessao 50 min</option>
                    <option value="60">Sessao 60 min</option>
                    <option value="90">Sessao 90 min</option>
                  </select>
                </div>

                <div className="pt-2 flex justify-end">
                  <button disabled={!canGoNextPersonal} onClick={() => setStep(2)} className="px-6 py-3 rounded-xl bg-[#7a32fc] text-white font-semibold disabled:opacity-40">Continuar</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <h3 className="text-lg font-bold text-slate-900">Configuracoes de clinica e credenciais</h3>
                {isTherapist && (
                  <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-widest font-bold text-violet-500">Clínica vinculada</p>
                    <p className="text-base font-bold text-violet-900">
                      {clinicName || user?.clinicSettings?.clinicName || user?.workspaceName || 'Clínica do workspace'}
                    </p>
                  </div>
                )}

                {isCoordinator && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Nome da clinica" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <input value={clinicCnpj} onChange={(e) => setClinicCnpj(formatCnpjInput(e.target.value))} placeholder="00.000.000/0000-00" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <input value={clinicPhone} onChange={(e) => setClinicPhone(e.target.value)} placeholder="Telefone comercial" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Especialidade" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <label className="md:col-span-2 block cursor-pointer">
                      <span className="text-xs text-slate-500 block mb-2">Logotipo da clínica</span>
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 flex items-center gap-4 hover:border-[#7a32fc] transition-all">
                        <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                          {clinicLogoUrl ? <SecureImage src={clinicLogoUrl} alt="Logo" className="w-full h-full object-cover" /> : <UploadCloud size={20} className="text-slate-400" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Enviar logo da clínica</p>
                          <p className="text-xs text-slate-500">JPG ou PNG. Esta logo aparecerá em documentos e relatórios.</p>
                        </div>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) toBase64(file, setClinicLogoUrl);
                        }}
                      />
                    </label>
                  </div>
                )}

                {!isCoordinator && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Especialidade" className="px-4 py-3 rounded-xl bg-slate-50" />
                  </div>
                )}

                {(councilRequired || isCoordinator) && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <input value={council} onChange={(e) => setCouncil(e.target.value)} placeholder="Conselho (ex: CRP)" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <input value={councilNumber} onChange={(e) => setCouncilNumber(formatProfessionalRegistry(e.target.value))} placeholder="00/00000" className="px-4 py-3 rounded-xl bg-slate-50" />
                  </div>
                )}

                {(isCoordinator || isTherapist) && (
                  <div>
                    <p className="text-sm font-semibold text-slate-800 mb-2">Assinatura para relatorios</p>
                    <label className="block cursor-pointer mb-3">
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 flex items-center gap-4 hover:border-[#7a32fc] transition-all">
                        <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
                          {signatureDataUrl ? <SecureImage src={signatureDataUrl} alt="Assinatura" className="w-full h-full object-contain" /> : <UploadCloud size={20} className="text-slate-400" />}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Enviar foto da assinatura</p>
                          <p className="text-xs text-slate-500">Use apenas uma imagem pronta da assinatura, preferencialmente PNG com fundo transparente.</p>
                        </div>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) toBase64(file, setSignatureDataUrl);
                        }}
                      />
                    </label>
                  </div>
                )}

                <div className="pt-2 flex justify-between">
                  <button onClick={() => setStep(1)} className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold">Voltar</button>
                  <button disabled={loading || !canGoNextClinic} onClick={finish} className="px-6 py-3 rounded-xl bg-[#7a32fc] text-white font-semibold disabled:opacity-40">
                    {loading ? 'Salvando...' : 'Concluir'}
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





