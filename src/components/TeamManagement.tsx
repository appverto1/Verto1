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
  LayoutDashboard,
  Stethoscope
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { motion, AnimatePresence } from 'framer-motion';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'coordinator' | 'therapist' | 'receptionist' | 'patient' | 'admin';
  clinic_id: string;
  created_at: string;
}

export function TeamManagement({ user }: { user: any }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'therapist' | 'receptionist'>('therapist');

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const result = await dataService.getClinicMembers();
      if (result.success) {
        setMembers(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao carregar membros da equipe');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAssigning(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await dataService.assignClinicRole(newMemberEmail, newMemberRole);
      if (result.success) {
        setSuccess(`Papel atribuído com sucesso a ${newMemberEmail}`);
        setNewMemberEmail('');
        fetchMembers();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Erro ao atribuir papel');
    } finally {
      setIsAssigning(false);
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

  const roleDescriptions = {
    coordinator: 'Acesso total a todas as funcionalidades e gestão da equipe.',
    therapist: 'Acesso a prontuários, agendas e evoluções. Sem acesso a dashboards de gestão.',
    receptionist: 'Acesso limitado a agendas e gestão de horários.'
  };

  const filteredMembers = members.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gestão da Equipe</h1>
          <p className="text-slate-500 text-sm">Gerencie os papéis e acessos dos seus colaboradores.</p>
        </div>
        
        <div className="flex items-center gap-3">
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
        {/* Atribuir Papel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-100 sticky top-6">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6">
              <UserPlus size={24} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Atribuir Novo Papel</h2>
            <p className="text-slate-500 text-xs mb-6">O colaborador já deve ter uma conta cadastrada na Verto.</p>

            <form onSubmit={handleAssignRole} className="space-y-4">
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
                type="submit"
                disabled={isAssigning}
                className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98] disabled:opacity-50 disabled:scale-100"
              >
                {isAssigning ? 'Atribuindo...' : 'Atribuir Papel'}
              </button>
            </form>
          </div>
        </div>

        {/* Lista de Membros */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Membros Ativos</h2>
              <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {filteredMembers.length} Colaboradores
              </span>
            </div>

            <div className="divide-y divide-slate-50">
              {loading ? (
                <div className="p-12 text-center">
                  <div className="w-8 h-8 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-slate-400 text-sm">Carregando equipe...</p>
                </div>
              ) : filteredMembers.length === 0 ? (
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
                        {member.name.charAt(0)}
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
                          <span className="text-xs font-bold text-slate-700">{roleLabels[member.role as keyof typeof roleLabels]}</span>
                        </div>
                        <p className="text-[10px] text-slate-400">Desde {new Date(member.created_at).toLocaleDateString()}</p>
                      </div>
                      
                      <button className="p-2 text-slate-300 hover:text-slate-600 hover:bg-white rounded-xl transition-all">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Info Card */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-purple-50 p-6 rounded-[28px] border border-purple-100">
              <div className="w-10 h-10 bg-purple-500 text-white rounded-xl flex items-center justify-center mb-4">
                <Shield size={20} />
              </div>
              <h3 className="font-bold text-purple-900 text-sm mb-1">Coordenador</h3>
              <p className="text-purple-700/70 text-[10px] leading-relaxed">Gestão total da clínica, faturamento e equipe.</p>
            </div>

            <div className="bg-blue-50 p-6 rounded-[28px] border border-blue-100">
              <div className="w-10 h-10 bg-blue-500 text-white rounded-xl flex items-center justify-center mb-4">
                <Stethoscope size={20} />
              </div>
              <h3 className="font-bold text-blue-900 text-sm mb-1">Terapeuta</h3>
              <p className="text-blue-700/70 text-[10px] leading-relaxed">Foco no atendimento, prontuários e evoluções.</p>
            </div>

            <div className="bg-green-50 p-6 rounded-[28px] border border-green-100">
              <div className="w-10 h-10 bg-green-500 text-white rounded-xl flex items-center justify-center mb-4">
                <Calendar size={20} />
              </div>
              <h3 className="font-bold text-green-900 text-sm mb-1">Recepcionista</h3>
              <p className="text-green-700/70 text-[10px] leading-relaxed">Gestão de agendas, faltas e reagendamentos.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
