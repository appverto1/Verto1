import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, CheckCircle2, UploadCloud, X } from 'lucide-react';
import { dataService } from '../services/dataService';
import { SecureImage } from './SecureMedia';

interface ProfessionalOnboardingProps {
  user: any;
  onComplete: (data: any) => void;
  onClose?: () => void;
}

function SignaturePad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);

  const getPoint = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setDrawing(true);
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = getPoint(e);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!drawing) return;
    setDrawing(false);
    const data = canvas.toDataURL('image/png');
    onChange(data);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={540}
        height={160}
        onMouseDown={start}
        onMouseMove={draw}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={draw}
        onTouchEnd={end}
        className="w-full bg-white border border-slate-200 rounded-2xl touch-none"
      />
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">Assine com o mouse ou toque.</p>
        <button type="button" onClick={clear} className="text-xs text-slate-600 hover:text-slate-900">Limpar</button>
      </div>
      {value && <SecureImage src={value} alt="Assinatura" className="h-12 object-contain" />}
    </div>
  );
}

export function ProfessionalOnboarding({ user, onComplete, onClose }: ProfessionalOnboardingProps) {
  const isCoordinator = user.role === 'coordinator' || user.role === 'admin';
  const isTherapist = user.role === 'therapist';

  const [step, setStep] = useState(1);
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
  const [clinicLogoUrl, setClinicLogoUrl] = useState<string | null>(null);
  const [clinicCnpj, setClinicCnpj] = useState('');
  const [clinicPhone, setClinicPhone] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [council, setCouncil] = useState('');
  const [councilNumber, setCouncilNumber] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);


  useEffect(() => {
    const loadExistingProfile = async () => {
      try {
        const result = await dataService.getUserProfile(user.id);
        const profile = result?.data?.professional_profile;
        if (!profile) return;

        setFullName(profile.full_name || user.name || "");
        setBirthDate(profile.birth_date || "");
        setGender(profile.gender || "");
        setCountryCode(profile.country_code || "+55");
        setPhone(profile.phone || "");
        setProfilePicture(profile.profile_photo_url || null);
        setClinicName(profile.clinic_name || "");
        setClinicLogoUrl(profile.clinic_logo_url || null);
        setClinicCnpj(profile.metadata?.clinicCnpj || profile.address?.cnpj || "");
        setClinicPhone(profile.clinic_phone || "");
        setSpecialty(profile.specialty || "");
        setCouncil(profile.council || "");
        setCouncilNumber(profile.council_number || "");
        setSignatureDataUrl(profile.signature_data_url || null);
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
  }, [user.id, user.name]);

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
    if (!input) return null;
    if (!input.startsWith('data:image/')) return input;

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
    return uploadResult.url as string;
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
      const [profilePictureUrl, clinicLogoUploadedUrl, signatureUploadedUrl] = await Promise.all([
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
          clinicLogoUrl: clinicLogoUploadedUrl,
          clinicCnpj,
          clinicPhone,
          specialty,
          council,
          councilNumber,
          signatureDataUrl: signatureUploadedUrl,
          profilePicture: profilePictureUrl
        })
      });

      const result = await parseJsonSafe(response);
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Falha ao concluir onboarding');
      }

      onComplete({
        name: fullName,
        profilePicture: profilePictureUrl,
        firstLoginCompleted: true,
        subscriptionStatus: 'active'
      });
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

                {isCoordinator && (
                  <div className="grid md:grid-cols-2 gap-4">
                    <input value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="Nome da clinica" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <input value={clinicCnpj} onChange={(e) => setClinicCnpj(e.target.value)} placeholder="CNPJ da clinica" className="px-4 py-3 rounded-xl bg-slate-50" />
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
                    <input value={councilNumber} onChange={(e) => setCouncilNumber(e.target.value)} placeholder="Numero do conselho" className="px-4 py-3 rounded-xl bg-slate-50" />
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
                          <p className="text-sm font-semibold text-slate-800">Enviar assinatura pronta</p>
                          <p className="text-xs text-slate-500">Opcional. Você também pode assinar no campo abaixo.</p>
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
                    <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />
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



