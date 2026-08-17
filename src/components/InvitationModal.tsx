import React, { useState } from 'react';
import {
  Mail,
  X,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { dataService } from '../services/dataService';
import {
  CLINICAL_SPECIALTY_OPTIONS,
} from '../utils/clinicalSpecialties';
import { LogoVerto } from './Common';

interface InvitationModalProps {
  user: any;
  onClose: () => void;
}

type InviteRole = 'director' | 'coordinator' | 'therapist' | 'receptionist' | 'biller';

const formatInviteRoleLabel = (
  role: string,
  specialty = '',
) => {
  if (role === 'director') return 'Diretor';
  if (role === 'coordinator') return 'Coordenador';
  if (role === 'therapist') {
    return `Profissional de atendimento · ${specialty || 'Especialidade pendente'}`;
  }
  if (role === 'receptionist') return 'Recepcionista/Assistente';
  if (role === 'biller') return 'Faturista';
  return 'Profissional';
};

export function InvitationModal({ user, onClose }: InvitationModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('therapist');
  const [specialty, setSpecialty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [invitations, setInvitations] = useState<{email: string, role: string}[]>([]);

  const explicitTeamLimit = Number(user?.teamMemberLimit || user?.team_member_limit || 0);
  const maxMembers = Number.isFinite(explicitTeamLimit) && explicitTeamLimit > 0 ? explicitTeamLimit : null;
  const actorRole = String(user?.role || '').trim().toLowerCase();
  const canGrantDirector = actorRole === 'director';
  const canGrantAdministrativeRoles = actorRole === 'director' || actorRole === 'coordinator';
  const canCreateAccounts = actorRole === 'director' || actorRole === 'coordinator';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateAccounts) {
      setError('Somente Diretor e Coordenador podem enviar convites de equipe.');
      return;
    }
    if (actorRole === 'coordinator' && role === 'director') {
      setError('Coordenadores podem convidar colaboradores da própria unidade, mas não podem conceder o papel de Diretor.');
      return;
    }
    if (maxMembers && invitations.length + 1 >= maxMembers) {
      setError(`Sua configuracao permite no maximo ${maxMembers} profissionais.`);
      return;
    }
    if (role === 'therapist' && !specialty) {
      setError('Selecione a especialidade clínica do profissional.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await dataService.inviteToClinic(
        email,
        role,
        role === 'therapist'
          ? {
              specialty,
              accessRoleLabel: 'Profissional de atendimento'
            }
          : {}
      );
      if (result.success && (result.inAppInvitation === true || result.invitationEmailSent !== false)) {
        setInvitations([
          ...invitations,
          { email, role: formatInviteRoleLabel(role, specialty) },
        ]);
        setEmail('');
        setSpecialty('');
        setSuccess(true);
      } else {
        setError(
          result.error ||
            result.message ||
            (result.invitationPersisted
              ? 'Convite salvo como pendente, mas o e-mail não foi enviado. Tente reenviar.'
              : 'Não foi possível enviar o convite.')
        );
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
              <LogoVerto size={28} showText={true} className="mb-6" />
              <h2 className="text-2xl font-bold mb-4 tracking-tight">Bem-vindo à Verto!</h2>
              <p className="text-blue-100 text-sm leading-relaxed mb-6">
                Vamos configurar sua equipe. {maxMembers ? `Voce pode convidar ate ${maxMembers - 1} outros profissionais.` : 'Convide os profissionais que vao colaborar na clinica.'}
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
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setSuccess(false);
                    }}
                    placeholder="exemplo@email.com"
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Papel na Clínica</label>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as InviteRole)}
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
                >
                  {canGrantDirector && <option value="director">Diretor</option>}
                  {canGrantAdministrativeRoles && <option value="coordinator">Coordenador</option>}
                  <option value="therapist">Profissional de atendimento</option>
                  {canGrantAdministrativeRoles && <option value="receptionist">Recepcionista/Assistente</option>}
                  {canGrantAdministrativeRoles && <option value="biller">Faturista</option>}
                </select>

                {role === 'therapist' && (
                  <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                    <label
                      htmlFor="invitation-clinical-specialty"
                      className="mb-2 block text-xs font-medium text-slate-600"
                    >
                      Especialidade clínica
                    </label>
                    <select
                      id="invitation-clinical-specialty"
                      value={specialty}
                      required
                      onChange={(event) => setSpecialty(event.target.value)}
                      className="min-h-11 w-full rounded-xl border border-blue-100 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                    >
                      <option value="" disabled>
                        Selecione a especialidade
                      </option>
                      {CLINICAL_SPECIALTY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs flex items-center gap-2">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-4 rounded-2xl font-bold text-sm text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 ${success ? 'bg-emerald-600 shadow-emerald-500/20' : 'bg-[#4318FF] shadow-blue-500/20 hover:scale-[1.02]'}`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {success && <CheckCircle2 size={17} />}
                  {loading ? 'Enviando...' : success ? 'Convite criado com sucesso.' : 'Enviar convite'}
                </span>
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
                      <span className="text-[10px] font-semibold text-slate-500">{inv.role}</span>
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
