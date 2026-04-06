import React, { useState } from 'react';
import { 
  User, 
  Stethoscope, 
  ShieldCheck, 
  ArrowRight,
  CheckCircle2,
  Camera
} from 'lucide-react';
import { motion } from 'framer-motion';

interface ProfessionalOnboardingProps {
  user: any;
  onComplete: (data: any) => void;
}

export function ProfessionalOnboarding({ user, onComplete }: ProfessionalOnboardingProps) {
  const [name, setName] = useState(user.name || '');
  const [specialty, setSpecialty] = useState('Psicólogo');
  const [crp, setCrp] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (specialty === 'Psicólogo' && !crp.trim()) {
      return alert("O preenchimento do CRP é obrigatório para Psicólogos.");
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/profile/${user.id}/complete-onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, specialty, crp })
      });
      
      if (response.ok) {
        onComplete({ name, specialty, crp });
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

  return (
    <div className="fixed inset-0 z-[200] bg-slate-50 flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl shadow-blue-500/5 overflow-hidden border border-slate-100"
      >
        <div className="flex flex-col md:flex-row">
          {/* Left Side - Welcome */}
          <div className="bg-[#4318FF] p-10 md:w-2/5 text-white flex flex-col justify-between">
            <div>
              <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mb-8">
                <ShieldCheck size={32} />
              </div>
              <h2 className="text-3xl font-bold mb-4 tracking-tight">Bem-vindo à Equipe!</h2>
              <p className="text-blue-100 text-sm leading-relaxed">
                Você foi vinculado à clínica. Vamos configurar seu perfil profissional para começar os atendimentos.
              </p>
            </div>

            <div className="space-y-4 mt-10">
              <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                <CheckCircle2 size={16} className="text-green-400" />
                Acesso à clínica confirmado
              </div>
              <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                <div className="w-4 h-4 rounded-full border border-white/30 flex items-center justify-center text-[8px]">2</div>
                Configure seu perfil
              </div>
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="p-10 md:w-3/5">
            <h3 className="text-xl font-bold text-slate-900 mb-8">Configurações Iniciais</h3>
            
            <form onSubmit={handleSubmit} className="space-y-6">
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
                  disabled={loading}
                  className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {loading ? 'Salvando...' : 'Concluir Configuração'}
                  {!loading && <ArrowRight size={18} />}
                </button>
              </div>
            </form>

            <p className="mt-6 text-[10px] text-slate-400 text-center font-medium leading-relaxed">
              Ao concluir, você terá acesso total ao painel clínico e poderá iniciar seus atendimentos.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
