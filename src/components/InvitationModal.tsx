import React, { useState } from 'react';
import { 
  Mail, 
  UserPlus, 
  X, 
  CheckCircle2, 
  AlertCircle,
  Stethoscope,
  Calendar,
  Shield,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { dataService } from '../services/dataService';

interface InvitationModalProps {
  user: any;
  onClose: () => void;
}

export function InvitationModal({ user, onClose }: InvitationModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'therapist' | 'receptionist'>('therapist');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [invitations, setInvitations] = useState<{email: string, role: string}[]>([]);

  // Plan limits based on LandingPage.tsx
  const planLimits: Record<string, number> = {
    'Essencial': 2,
    'Crescimento': 7,
    'Avançado': 12,
    'Enterprise': 999,
    'Premium': 999
  };

  const currentPlan = user.planName || 'Essencial';
  const maxMembers = planLimits[currentPlan] || 2;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invitations.length + 1 >= maxMembers) {
      setError(`Seu plano ${currentPlan} permite no máximo ${maxMembers} profissionais.`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await dataService.inviteToClinic(email, role);
      if (result.success) {
        setInvitations([...invitations, { email, role }]);
        setEmail('');
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao enviar convite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100"
      >
        <div className="flex flex-col md:flex-row h-full">
          {/* Left Side - Info */}
          <div className="bg-[#4318FF] p-8 md:w-1/3 text-white flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
                <Shield size={24} />
              </div>
              <h2 className="text-2xl font-bold mb-4 tracking-tight">Bem-vindo à Verto!</h2>
              <p className="text-blue-100 text-sm leading-relaxed mb-6">
                Vamos configurar sua equipe. De acordo com seu plano <span className="font-bold text-white">{currentPlan}</span>, você pode convidar até {maxMembers - 1} outros profissionais.
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                <div className="w-5 h-5 bg-white/10 rounded-full flex items-center justify-center">1</div>
                Convide por e-mail
              </div>
              <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                <div className="w-5 h-5 bg-white/10 rounded-full flex items-center justify-center">2</div>
                Eles aceitam o convite
              </div>
              <div className="flex items-center gap-3 text-xs font-medium text-blue-100">
                <div className="w-5 h-5 bg-white/10 rounded-full flex items-center justify-center">3</div>
                Pronto para colaborar!
              </div>
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="p-8 md:w-2/3 relative">
            <button 
              onClick={onClose}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-bold text-slate-900 mb-6">Configurar Papéis e Convites</h3>

            <form onSubmit={handleInvite} className="space-y-6">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">E-mail do Profissional</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="exemplo@email.com"
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Papel na Clínica</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole('therapist')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${role === 'therapist' ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${role === 'therapist' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Stethoscope size={20} />
                    </div>
                    <p className="text-sm font-bold text-slate-900">Terapeuta</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole('receptionist')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${role === 'receptionist' ? 'border-green-500 bg-green-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${role === 'receptionist' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Calendar size={20} />
                    </div>
                    <p className="text-sm font-bold text-slate-900">Recepcionista</p>
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs flex items-center gap-2">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {success && (
                <div className="p-4 bg-green-50 text-green-600 rounded-2xl text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  Convite enviado com sucesso!
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar Convite'}
              </button>
            </form>

            {/* List of pending invites in this session */}
            {invitations.length > 0 && (
              <div className="mt-8">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Convites Pendentes ({invitations.length})</h4>
                <div className="space-y-2">
                  {invitations.map((inv, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-400">
                          <Mail size={14} />
                        </div>
                        <span className="text-xs font-medium text-slate-600">{inv.email}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{inv.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
              <button 
                onClick={onClose}
                className="flex items-center gap-2 text-slate-900 font-bold text-sm hover:gap-3 transition-all"
              >
                Ir para o Dashboard
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
