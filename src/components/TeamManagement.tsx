import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Mail, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  Search,
  Filter,
  MoreVertical,
  UserCheck,
  Calendar,
  Stethoscope,
  Clock
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'framer-motion';
import { RoleCapabilityMatrix } from './RoleCapabilityMatrix';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'coordinator' | 'therapist' | 'receptionist' | 'patient' | 'admin';
  clinic_id: string;
  created_at: string;
}

const PLAN_LIMITS: Record<string, number> = {
  'Essencial': 2,
  'Crescimento': 7,
  'Avançado': 12,
  'Enterprise': 999,
  'Premium': 999,
  'Paciente': 0
};

export function TeamManagement({
  user,
  onRequestUpgrade,
  memberSessionDurations = {},
  onUpdateMemberSessionDuration,
}: {
  user: any;
  onRequestUpgrade?: () => void;
  memberSessionDurations?: Record<string, string>;
  onUpdateMemberSessionDuration?: (member: Member, duration: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<string | null>(null);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [unlinkingMemberId, setUnlinkingMemberId] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'therapist' | 'receptionist'>('therapist');

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const rawPlanName = String(user?.planName || '').trim();
  const planName =
    !rawPlanName || rawPlanName === 'Verto Pro' || rawPlanName === 'Plano Pro'
      ? 'Essencial'
      : rawPlanName;
  const inviteLimit = PLAN_LIMITS[planName] || 2;
  const totalUsed = (members?.length || 0) + (invitations?.filter(i => i.status === 'pending').length || 0);
  const canInvite = totalUsed < inviteLimit;

  useEffect(() => {
    fetchMembers();
    fetchInvitations();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const result = await dataService.getClinicMembers();
      if (result.success) {
        setMembers(result.data || []);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao carregar membros da equipe');
    } finally {
      setLoading(false);
    }
  };

  const fetchInvitations = async () => {
    try {
      const result = await dataService.getInvitations();
      if (result.success) {
        setInvitations(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching invitations:', err);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAssigning(true);
    setError(null);
    setSuccess(null);

    if (!canInvite) {
      setError(`Seu plano ${planName} permite no máximo ${inviteLimit} membros. Faça upgrade para convidar mais.`);
      setIsAssigning(false);
      return;
    }

    try {
      const result = await dataService.inviteToClinic(newMemberEmail, newMemberRole);
      if (result.success) {
        setSuccess(`Convite enviado com sucesso para ${newMemberEmail}`);
        setNewMemberEmail('');
        fetchInvitations();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao enviar convite');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    const confirmed = window.confirm('Tem certeza que deseja cancelar este convite? O link enviado ficará inválido.');
    if (!confirmed) return;
    setError(null);
    setSuccess(null);
    setCancellingInvitationId(invitationId);
    try {
      const result = await dataService.cancelInvitation(invitationId);
      if (result.success) {
        setSuccess(result.message || 'Convite cancelado com sucesso.');
        await fetchInvitations();
      } else {
        setError(result.error || 'Não foi possível cancelar convite.');
      }
    } catch (err) {
      setError('Erro ao cancelar convite.');
    } finally {
      setCancellingInvitationId(null);
    }
  };

  const handleResendInvitation = async (invitation: any) => {
    setError(null);
    setSuccess(null);
    setResendingInvitationId(invitation.id);
    try {
      const result = await dataService.inviteToClinic(invitation.email, invitation.role);
      if (result.success) {
        const baseMessage = result.message || `Convite reenviado para ${invitation.email}.`;
        setSuccess(baseMessage);
        await fetchInvitations();
      } else {
        setError(result.error || 'Não foi possível reenviar convite.');
      }
    } catch (err) {
      setError('Erro ao reenviar convite.');
    } finally {
      setResendingInvitationId(null);
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: any) => {
    try {
      const result = await dataService.updateMemberRole(memberId, newRole);
      if (result.success) {
        setSuccess('Papel atualizado com sucesso');
        fetchMembers();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao atualizar papel');
    }
  };

  const handleUnlinkMember = async (member: Member) => {
    if (!member?.id) return;
    if (member.id === user.id) {
      setError('Você não pode se desvincular da clínica por esta ação.');
      return;
    }
    const confirmed = window.confirm(
      `Deseja desvincular ${member.name || member.email} da clínica? Ele(a) perderá acesso a este workspace.`
    );
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    setUnlinkingMemberId(member.id);
    try {
      const result = await dataService.unlinkClinicMember(member.id);
      if (result.success) {
        setSuccess(result.message || 'Membro desvinculado com sucesso.');
        await fetchMembers();
      } else {
        setError(result.error || 'Não foi possível desvincular o membro.');
      }
    } catch (_err) {
      setError('Erro ao desvincular membro.');
    } finally {
      setUnlinkingMemberId(null);
    }
  };

  const roleIcons = {
    coordinator: <Shield className="text-purple-500" size={18} />,
    therapist: <Stethoscope className="text-blue-500" size={18} />,
    receptionist: <Calendar className="text-green-500" size={18} />,
    patient: <Users className="text-slate-400" size={18} />,
    admin: <Shield className="text-red-500" size={18} />
  };

  const roleLabels = {
    coordinator: 'Coordenador',
    therapist: 'Terapeuta',
    receptionist: 'Recepcionista',
    patient: 'Paciente',
    admin: 'Admin'
  };

  const filteredMembers = members.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.email.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const pendingInvitations = invitations.filter((inv) => String(inv?.status || '').toLowerCase() === 'pending');
  const invitationHistory = invitations.filter((inv) => String(inv?.status || '').toLowerCase() !== 'pending');

  return (
    <div className="p-6 max-w-6xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gestão da Equipe</h1>
          <p className="text-slate-500 text-sm">
            Plano {planName}: {totalUsed} de {inviteLimit === 999 ? 'Ilimitado' : inviteLimit} vagas utilizadas
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {!canInvite && (
            <button 
              onClick={() => onRequestUpgrade?.()}
              className="px-4 py-2 bg-gradient-to-r from-[#6D28FF] to-[#9F67FF] text-white rounded-xl text-xs font-bold uppercase shadow-lg shadow-purple-500/30 hover:scale-105 transition-all"
            >
              Fazer Upgrade
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Buscar membro..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-full md:w-64"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Lista de Membros */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Membros Ativos</h2>
              <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {filteredMembers?.length || 0} Colaboradores
              </span>
            </div>

            <div className="divide-y divide-slate-50">
              {loading ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-slate-400 text-sm">Carregando equipe...</p>
                </div>
              ) : (filteredMembers?.length || 0) === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Users size={32} />
                  </div>
                  <p className="text-slate-500 font-medium">Nenhum membro encontrado</p>
                  <p className="text-slate-400 text-xs mt-1">Atribua papéis para começar a montar sua equipe.</p>
                </div>
              ) : (
                filteredMembers.map((member) => (
                  <div key={member.id} className="p-6 hover:bg-slate-50/50 transition-all flex items-center justify-between group">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 font-bold text-lg">
                    {(String(member?.name || 'P').trim().charAt(0) || 'P').toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-slate-900 text-sm">{member.name}</h3>
                          {member.id === user.id && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[8px] font-bold uppercase tracking-widest">Você</span>
                          )}
                        </div>
                        <p className="text-slate-400 text-xs">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="hidden md:block text-right">
                        <div className="flex items-center justify-end gap-1.5 mb-0.5">
                          {roleIcons[member.role as keyof typeof roleIcons]}
                          <span className="text-xs font-semibold text-slate-700">{roleLabels[member.role as keyof typeof roleLabels]}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium">Desde {new Date(member.created_at).toLocaleDateString()}</p>
                      </div>

                      {(member.role === 'therapist' || member.role === 'coordinator') && (
                        <div className="hidden md:flex items-center gap-2 bg-slate-50 rounded-xl px-2 py-1.5">
                          <Clock size={14} className="text-slate-400" />
                          <select
                            value={memberSessionDurations[member.id] || memberSessionDurations[member.email] || memberSessionDurations[member.name] || '50'}
                            onChange={(e) => onUpdateMemberSessionDuration?.(member, e.target.value)}
                            className="bg-transparent text-xs font-semibold text-slate-700 outline-none"
                          >
                            <option value="30">30 min</option>
                            <option value="45">45 min</option>
                            <option value="50">50 min</option>
                            <option value="60">60 min</option>
                            <option value="90">90 min</option>
                          </select>
                        </div>
                      )}
                      
                      <div className="relative">
                        <button 
                          onClick={() => setOpenMenuId(openMenuId === member.id ? null : member.id)}
                          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-xl transition-all"
                        >
                          <MoreVertical size={18} />
                        </button>
                        
                        {openMenuId === member.id && (
                          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 py-2 animate-in fade-in zoom-in duration-200">
                            <div className="px-4 py-2 border-b border-slate-50 mb-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Alterar Papel</p>
                            </div>
                            <button 
                              onClick={() => { handleUpdateRole(member.id, 'coordinator'); setOpenMenuId(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${member.role === 'coordinator' ? 'text-purple-600 bg-purple-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              disabled={member.id === user.id}
                            >
                              <Shield size={14} /> Coordenador
                            </button>
                            <button 
                              onClick={() => { handleUpdateRole(member.id, 'therapist'); setOpenMenuId(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${member.role === 'therapist' ? 'text-blue-600 bg-blue-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              disabled={member.id === user.id}
                            >
                              <Stethoscope size={14} /> Terapeuta
                            </button>
                            <button 
                              onClick={() => { handleUpdateRole(member.id, 'receptionist'); setOpenMenuId(null); }}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium transition-all ${member.role === 'receptionist' ? 'text-green-600 bg-green-50' : 'text-slate-600 hover:bg-slate-50'}`}
                              disabled={member.id === user.id}
                            >
                              <Calendar size={14} /> Recepcionista
                            </button>
                            <div className="h-px bg-slate-50 my-1" />
                            <button 
                              onClick={() => { handleUnlinkMember(member); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-all"
                              disabled={member.id === user.id || unlinkingMemberId === member.id}
                            >
                              <Trash2 size={14} /> {unlinkingMemberId === member.id ? 'Desvinculando...' : 'Desvincular da Clínica'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Atribuir Papel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 sticky top-6">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
              <UserPlus size={24} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Atribuir Novo Papel</h2>
            <p className="text-slate-500 text-xs mb-6">Se o colaborador ainda não tiver conta, ele poderá criar pelo próprio convite via e-mail.</p>

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">E-mail do Colaborador</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="email"
                    required
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="exemplo@email.com"
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Papel / Nível de Acesso</label>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewMemberRole('therapist')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${newMemberRole === 'therapist' ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${newMemberRole === 'therapist' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Stethoscope size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Terapeuta</p>
                      <p className="text-[10px] text-slate-500">Prontuários e Agendas</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewMemberRole('receptionist')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left ${newMemberRole === 'receptionist' ? 'border-green-500 bg-green-50/50' : 'border-slate-100 hover:border-slate-200'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${newMemberRole === 'receptionist' ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                      <Calendar size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Recepcionista</p>
                      <p className="text-[10px] text-slate-500">Apenas Agendas</p>
                    </div>
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-xs flex items-center gap-2 animate-shake">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              {success && (
                <div className="p-4 bg-green-50 text-green-600 rounded-2xl text-xs flex items-center gap-2 animate-pop">
                  <CheckCircle2 size={16} />
                  {success}
                </div>
              )}

              <button
                type={!canInvite ? "button" : "submit"}
                disabled={isAssigning}
                className={`w-full py-4 rounded-2xl font-bold text-sm shadow-lg transition-all ${
                  !canInvite
                    ? 'bg-gradient-to-r from-[#6D28FF] to-[#9F67FF] text-white cursor-pointer shadow-purple-500/30'
                    : 'bg-gradient-to-r from-[#6D28FF] to-[#9F67FF] text-white shadow-purple-500/30 hover:scale-[1.02] active:scale-[0.98]'
                } disabled:opacity-50 disabled:scale-100`}
                onClick={!canInvite ? () => onRequestUpgrade?.() : undefined}
              >
                {isAssigning ? 'Enviando...' : !canInvite ? 'Upgrade' : 'Enviar Convite'}
              </button>
            </form>

            {/* Pending Invitations */}
            {(pendingInvitations.length || 0) > 0 && (
              <div className="mt-12">
                <h3 className="text-lg font-bold text-slate-900 mb-6">Convites Pendentes</h3>
                <div className="space-y-3">
                  {pendingInvitations.map((inv) => (
                    <div key={inv.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400">
                          <Mail size={20} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{inv.email}</p>
                          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{inv.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 bg-amber-100 text-amber-600 rounded-full text-[10px] font-bold uppercase tracking-widest">Pendente</span>
                        <button
                          type="button"
                          onClick={() => handleResendInvitation(inv)}
                          disabled={resendingInvitationId === inv.id}
                          className="px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-widest hover:bg-blue-100 transition-colors disabled:opacity-60"
                          title="Reenviar convite"
                        >
                          {resendingInvitationId === inv.id ? 'Reenviando...' : 'Reenviar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelInvitation(inv.id)}
                          disabled={cancellingInvitationId === inv.id}
                          className="px-3 py-1 rounded-full border border-red-200 bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-colors disabled:opacity-60"
                          title="Cancelar convite"
                        >
                          {cancellingInvitationId === inv.id ? 'Cancelando...' : 'Cancelar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(invitationHistory.length || 0) > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Histórico de Convites</h3>
                <div className="space-y-3">
                  {invitationHistory.map((inv) => {
                    const status = String(inv?.status || '').toLowerCase();
                    const statusLabel = status === 'accepted'
                      ? 'Ativado'
                      : status === 'canceled'
                        ? 'Cancelado'
                        : status;
                    const statusClass = status === 'accepted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : status === 'canceled'
                        ? 'bg-slate-200 text-slate-600'
                        : 'bg-slate-100 text-slate-500';
                    return (
                      <div key={inv.id} className="p-4 bg-white rounded-2xl border border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400">
                            <Mail size={20} />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{inv.email}</p>
                            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{inv.role}</p>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3">
          <RoleCapabilityMatrix />
        </div>
      </div>
    </div>
  );
}

