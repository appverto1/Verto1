import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, CheckCircle2, Mail, Plus, UserPlus, X } from 'lucide-react';
import { dataService } from '../services/dataService';
import { getSupabase } from '../lib/supabase';

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
      {value && <img src={value} alt="Assinatura" className="h-12 object-contain" />}
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
  const [profilePicture, setProfilePicture] = useState<string | null>(null);

  const [clinicName, setClinicName] = useState('');
  const [clinicLogoUrl, setClinicLogoUrl] = useState<string | null>(null);
  const [clinicPhone, setClinicPhone] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [council, setCouncil] = useState('');
  const [councilNumber, setCouncilNumber] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  const [invites, setInvites] = useState<{ email: string; role: 'therapist' | 'receptionist' }[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'therapist' | 'receptionist'>('therapist');

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
    const reader = new FileReader();
    reader.onloadend = () => cb(reader.result as string);
    reader.readAsDataURL(file);
  };

  const addInvite = () => {
    if (!inviteEmail || !inviteEmail.includes('@')) return;
    if (invites.some(i => i.email.toLowerCase() === inviteEmail.toLowerCase())) return;
    setInvites(prev => [...prev, { email: inviteEmail.trim(), role: inviteRole }]);
    setInviteEmail('');
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
      for (const invite of invites) {
        await dataService.inviteToClinic(invite.email, invite.role, { requiresCouncil: invite.role === 'therapist' });
      }

      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`/api/profile/${user.id}/complete-onboarding`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session?.access_token ? `Bearer ${session.access_token}` : ''
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
          clinicLogoUrl,
          clinicPhone,
          specialty,
          council,
          councilNumber,
          signatureDataUrl,
          profilePicture
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Falha ao concluir onboarding');
      }

      onComplete({
        name: fullName,
        profilePicture,
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
    <div className="fixed inset-0 z-[200] bg-slate-50 flex items-center justify-center p-4 overflow-y-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white w-full max-w-5xl rounded-3xl shadow-xl border border-slate-100">
        <div className="grid md:grid-cols-[320px_1fr] min-h-[680px]">
          <div className="bg-[#7a32fc] text-white p-8 rounded-l-3xl">
            <h2 className="text-2xl font-bold">Boas-vindas a Verto</h2>
            <p className="text-sm text-violet-100 mt-3">Complete seu onboarding para liberar o painel completo do seu papel.</p>
            <div className="mt-8 space-y-3 text-xs">
              <div className={step >= 1 ? 'text-white font-semibold' : 'text-violet-200'}>1. Cadastro Profissional</div>
              <div className={step >= 2 ? 'text-white font-semibold' : 'text-violet-200'}>2. Configuracoes da Clinica</div>
              {isCoordinator && <div className={step >= 3 ? 'text-white font-semibold' : 'text-violet-200'}>3. Convites de Equipe</div>}
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
                    {profilePicture ? <img src={profilePicture} alt="Foto" className="w-full h-full object-cover" /> : <Camera size={24} className="text-slate-400" />}
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
                    <input value={clinicPhone} onChange={(e) => setClinicPhone(e.target.value)} placeholder="Telefone comercial" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Especialidade" className="px-4 py-3 rounded-xl bg-slate-50" />
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Logotipo da clínica</label>
                      <input
                        type="file"
                        className="block w-full text-xs bg-slate-50 p-3 rounded-xl"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) toBase64(file, setClinicLogoUrl);
                        }}
                      />
                    </div>
                    {clinicLogoUrl && <img src={clinicLogoUrl} alt="Logo" className="h-16 object-contain rounded-xl border border-slate-200 p-2 bg-white" />}
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
                    <div className="mb-3">
                      <label className="text-xs text-slate-600">Ou envie uma imagem pronta</label>
                      <input
                        type="file"
                        className="mt-1 block w-full text-xs"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) toBase64(file, setSignatureDataUrl);
                        }}
                      />
                    </div>
                    <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />
                  </div>
                )}

                <div className="pt-2 flex justify-between">
                  <button onClick={() => setStep(1)} className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold">Voltar</button>
                  {isCoordinator ? (
                    <button disabled={!canGoNextClinic} onClick={() => setStep(3)} className="px-6 py-3 rounded-xl bg-[#7a32fc] text-white font-semibold disabled:opacity-40">Convites</button>
                  ) : (
                    <button disabled={loading || !canGoNextClinic} onClick={finish} className="px-6 py-3 rounded-xl bg-[#7a32fc] text-white font-semibold disabled:opacity-40">
                      {loading ? 'Salvando...' : 'Concluir'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {step === 3 && isCoordinator && (
              <div className="space-y-5">
                <h3 className="text-lg font-bold text-slate-900">Convide sua equipe</h3>
                <p className="text-sm text-slate-500">Defina o papel no convite. O painel e onboarding do convidado seguem este papel.</p>

                <div className="grid md:grid-cols-[1fr_180px_auto] gap-3">
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@clinica.com" className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-50" />
                  </div>
                  <select value={inviteRole} onChange={(e: any) => setInviteRole(e.target.value)} className="px-4 py-3 rounded-xl bg-slate-50">
                    <option value="therapist">Terapeuta</option>
                    <option value="receptionist">Recepcionista</option>
                  </select>
                  <button onClick={addInvite} className="px-4 py-3 rounded-xl bg-slate-900 text-white font-semibold inline-flex items-center gap-2">
                    <Plus size={16} /> Adicionar
                  </button>
                </div>

                <div className="space-y-2">
                  {invites.map((invite) => (
                    <div key={invite.email} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
                      <div className="flex items-center gap-2">
                        <UserPlus size={16} className="text-slate-500" />
                        <span className="text-sm font-medium text-slate-800">{invite.email}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500 uppercase">{invite.role}</span>
                        <button type="button" onClick={() => setInvites(prev => prev.filter(i => i.email !== invite.email))} className="text-slate-400 hover:text-red-500">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex justify-between">
                  <button onClick={() => setStep(2)} className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold">Voltar</button>
                  <button disabled={loading} onClick={finish} className="px-6 py-3 rounded-xl bg-[#7a32fc] text-white font-semibold inline-flex items-center gap-2 disabled:opacity-40">
                    {loading ? 'Finalizando...' : 'Concluir onboarding'}
                    {!loading && <CheckCircle2 size={16} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}


