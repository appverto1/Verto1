import React, { useState } from 'react';
import { 
  User, 
  Stethoscope, 
  ShieldCheck, 
  ArrowRight,
  CheckCircle2,
  Camera,
  Mail,
  MessageCircle,
  Plus,
  X,
  UserPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { dataService } from '../services/dataService';
import { getSupabase } from '../lib/supabase';

interface ProfessionalOnboardingProps {
  user: any;
  onComplete: (data: any) => void;
}

export function ProfessionalOnboarding({ user, onComplete }: ProfessionalOnboardingProps) {
  const [step, setStep] = useState(1); // 1: Profile, 2: Invitations (only for coordinator)
  const [name, setName] = useState(user.name || '');
  const [specialty, setSpecialty] = useState('Psicólogo');
  const [crp, setCrp] = useState('');
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Invitation state
  const [invites, setInvites] = useState<{ email: string, role: 'therapist' | 'receptionist' }[]>([]);
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'therapist' | 'receptionist'>('therapist');

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (specialty === 'Psicólogo' && !crp.trim()) {
      return alert("O preenchimento do CRP é obrigatório para Psicólogos.");
    }

    if (user.role === 'coordinator') {
      setStep(2);
    } else {
      await finishOnboarding();
    }
  };

  const finishOnboarding = async () => {
    setLoading(true);
    try {
      const supabase = await getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Send invitations first if any
      if (invites.length > 0) {
        for (const invite of invites) {
          await dataService.inviteToClinic(invite.email, invite.role);
        }
      }

      const response = await fetch(`/api/profile/${user.id}/complete-onboarding`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        credentials: 'include',
        body: JSON.stringify({ name, specialty, crp, profilePicture })
      });
      
      if (response.ok) {
        onComplete({ name, specialty, crp, profilePicture });
      } else {
        alert('Erro ao salvar configurações. Tente novamente.');
      }
    } catch (err) {
      console.error('Onboarding error:', err);
      alert('Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const addInvite = () => {
    if (!newInviteEmail || !newInviteEmail.includes('@')) return alert('E-mail inválido');
    if (invites.find(i => i.email === newInviteEmail)) return alert('Este e-mail já está na lista');
    
    setInvites([...invites, { email: newInviteEmail, role: newInviteRole }]);
    setNewInviteEmail('');
  };

  const removeInvite = (email: string) => {
    setInvites(invites.filter(i => i.email !== email));
  };

  const getWhatsAppLink = () => {
    const message = encodeURIComponent(`Olá! Gostaria de te convidar para fazer parte da minha equipe na Verto. Cadastre-se aqui: ${window.location.origin}`);
    return `https://wa.me/?text=${message}`;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-50 flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-4xl rounded-[40px] shadow-2xl shadow-blue-500/5 overflow-hidden border border-slate-100"
      >
        <div className="flex flex-col md:flex-row min-h-[600px]">
          {/* Left Side - Welcome */}
          <div className="bg-[#4318FF] p-10 md:w-1/3 text-white flex flex-col justify-between">
            <div>
              <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mb-8">
                <ShieldCheck size={32} />
              </div>
              <h2 className="text-3xl font-bold mb-4 tracking-tight">
                {step === 1 ? 'Bem-vindo à Verto!' : 'Sua Equipe'}
              </h2>
              <p className="text-blue-100 text-sm leading-relaxed">
                {step === 1 
                  ? 'Vamos configurar seu perfil profissional para começar os atendimentos e gerir sua clínica.'
                  : 'Convide seus colaboradores para começarem a trabalhar com você.'}
              </p>
            </div>

            <div className="space-y-4 mt-10">
              <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                <CheckCircle2 size={16} className={step >= 1 ? "text-green-400" : "text-white/30"} />
                Perfil Profissional
              </div>
              {user.role === 'coordinator' && (
                <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                  <CheckCircle2 size={16} className={step >= 2 ? "text-green-400" : "text-white/30"} />
                  Convite de Equipe
                </div>
              )}
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="p-10 md:w-2/3 overflow-y-auto max-h-[80vh]">
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.div 
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900">Configurações de Perfil</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Passo 1 de {user.role === 'coordinator' ? '2' : '1'}</span>
                  </div>

                  {/* Profile Picture */}
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="relative group">
                      <div className="w-24 h-24 bg-slate-50 rounded-3xl flex items-center justify-center overflow-hidden border-2 border-dashed border-slate-200 group-hover:border-blue-500/50 transition-all">
                        {profilePicture ? (
                          <img src={profilePicture} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <Camera size={32} className="text-slate-300" />
                        )}
                      </div>
                      <input 
                        type="file" 
                        id="onboarding-pic" 
                        className="hidden" 
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setProfilePicture(reader.result as string);
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                      <button 
                        type="button"
                        onClick={() => document.getElementById('onboarding-pic')?.click()}
                        className="absolute -bottom-2 -right-2 p-2 bg-[#4318FF] text-white rounded-xl shadow-lg hover:scale-110 transition-all"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Foto de Perfil</p>
                  </div>
                  
                  <form onSubmit={handleProfileSubmit} className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Nome Completo</label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input 
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Seu nome completo"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Especialidade Principal</label>
                      <div className="relative">
                        <Stethoscope className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <select 
                          value={specialty}
                          onChange={(e) => setSpecialty(e.target.value)}
                          className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all appearance-none"
                        >
                          <option value="Psicólogo">Psicólogo</option>
                          <option value="Terapeuta Ocupacional">Terapeuta Ocupacional</option>
                          <option value="Fonoaudiólogo">Fonoaudiólogo</option>
                          <option value="Fisioterapeuta">Fisioterapeuta</option>
                          <option value="Psicopedagogo">Psicopedagogo</option>
                          <option value="Médico">Médico</option>
                        </select>
                      </div>
                    </div>

                    {specialty === 'Psicólogo' && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-2"
                      >
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Registro Profissional (CRP)</label>
                        <input 
                          type="text"
                          required
                          value={crp}
                          onChange={(e) => setCrp(e.target.value)}
                          className="w-full px-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                          placeholder="Ex: 06/123456"
                        />
                      </motion.div>
                    )}

                    <div className="pt-4">
                      <button
                        type="submit"
                        className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                        {user.role === 'coordinator' ? 'Próximo Passo' : 'Concluir Configuração'}
                        <ArrowRight size={18} />
                      </button>
                    </div>
                  </form>
                </motion.div>
              ) : (
                <motion.div 
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900">Convidar Colaboradores</h3>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Passo 2 de 2</span>
                  </div>

                  <div className="space-y-6">
                    <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100">
                      <h4 className="text-sm font-bold text-[#4318FF] mb-2 flex items-center gap-2">
                        <MessageCircle size={18} /> Link Direto (WhatsApp)
                      </h4>
                      <p className="text-xs text-slate-500 mb-4">Compartilhe o link de cadastro diretamente com sua equipe.</p>
                      <a 
                        href={getWhatsAppLink()}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-green-500 text-white rounded-2xl font-bold text-xs hover:bg-green-600 transition-all shadow-md shadow-green-500/20"
                      >
                        <MessageCircle size={16} /> Enviar via WhatsApp
                      </a>
                    </div>

                    <div className="space-y-4">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Convite por E-mail</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                          <input 
                            type="email"
                            value={newInviteEmail}
                            onChange={(e) => setNewInviteEmail(e.target.value)}
                            className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                            placeholder="email@exemplo.com"
                          />
                        </div>
                        <select 
                          value={newInviteRole}
                          onChange={(e: any) => setNewInviteRole(e.target.value)}
                          className="bg-slate-50 border-none rounded-2xl px-4 text-xs font-bold text-slate-600 outline-none"
                        >
                          <option value="therapist">Terapeuta</option>
                          <option value="receptionist">Recepcionista</option>
                        </select>
                        <button 
                          onClick={addInvite}
                          className="p-3.5 bg-[#4318FF] text-white rounded-2xl hover:scale-105 transition-all shadow-lg shadow-blue-500/20"
                        >
                          <Plus size={20} />
                        </button>
                      </div>
                    </div>

                    {invites.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lista de Convites</p>
                        <div className="space-y-2">
                          {invites.map((invite, i) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-white rounded-xl shadow-sm">
                                  <UserPlus size={16} className="text-[#4318FF]" />
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{invite.email}</p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase">{invite.role === 'therapist' ? 'Terapeuta' : 'Recepcionista'}</p>
                                </div>
                              </div>
                              <button onClick={() => removeInvite(invite.email)} className="p-2 text-slate-300 hover:text-red-500 transition-all">
                                <X size={18} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-4 pt-4">
                      <button
                        onClick={() => setStep(1)}
                        className="flex-1 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold text-sm hover:bg-slate-200 transition-all"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={finishOnboarding}
                        disabled={loading}
                        className="flex-[2] bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                        {loading ? 'Finalizando...' : 'Concluir e Acessar Painel'}
                        {!loading && <CheckCircle2 size={18} />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-8 text-[10px] text-slate-400 text-center font-medium leading-relaxed">
              Ao concluir, você terá acesso total ao painel de gestão da clínica e poderá iniciar as operações.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
