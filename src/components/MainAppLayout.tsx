import React, { useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, ShieldAlert } from 'lucide-react';
import { LogoVerto } from './Common';
import { RoleBasedSidebar } from './RoleBasedSidebar';
import { PatientRegistry } from './PatientRegistry';
import { PatientDetailView } from './PatientDetailView';
import { ProtocolManagementSystem } from './Protocols';
import { RoomReservation } from './RoomReservation';
import { CalendarWidget, DayDetailsModal } from './Calendar';
import { withAuth } from '../hoc/withAuth';
import {
  getAllowedRoutesByRole,
  hasCapability,
  isClinicalMfaEnabled,
  type ClinicalRole,
} from '../lib/rbac';

interface MainAppLayoutProps {
  user: any;
  onLogout: () => void;
  allPatients: any[];
  therapistAgenda: any[];
  patientsHistory: any[];
  therapistNotes: any[];
  protocols: any[];
  setProtocols: (next: any) => void;
  allTasks: any[];
  clinicalRecords: any[];
  rooms: any[];
  roomReservations: any[];
  onDeleteRoomReservation: (id: string) => void;
  onAddNote: (pid: any, txt: string, visibility: string, subject?: string) => void;
  onAddActivityLog: (title: string, content: string, type?: string) => void;
  onAddTask: (task: any) => void;
  onUpdateTask: (taskId: any, updates: any) => void;
  onUpdateHistoryItem: (id: any, updates: any) => void;
  onUpdatePatient?: (patient: any) => void;
  onRecordTrial?: (pid: any, title: string, score: number, evalComment?: string) => any;
  onDeleteHistoryItem?: (id: any) => void;
  onEvaluateHistoryItem?: (id: any, score: number, note: string) => void;
  onUpdateProfile: (updates: any) => void;
}

const ClinicalMfaGate = ({ enabled }: { enabled: boolean }) => {
  if (enabled) return null;
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/80 p-6">
      <div className="flex items-start gap-3">
        <ShieldAlert className="text-amber-600 mt-0.5" size={20} />
        <div>
          <h3 className="text-sm font-bold text-amber-900">MFA obrigatório para dados clínicos</h3>
          <p className="text-sm text-amber-800 mt-1">
            Ative TOTP no perfil antes de acessar prontuários e anamnese.
          </p>
        </div>
      </div>
    </div>
  );
};

const AccessDenied = ({ message }: { message: string }) => (
  <div className="rounded-3xl border border-red-200 bg-red-50/70 p-6">
    <div className="flex items-start gap-3">
      <AlertCircle className="text-red-600 mt-0.5" size={20} />
      <div>
        <h3 className="text-sm font-bold text-red-900">Acesso bloqueado</h3>
        <p className="text-sm text-red-800 mt-1">{message}</p>
      </div>
    </div>
  </div>
);

interface HomeViewProps {
  user: any;
  filteredAgenda: any[];
}

interface AgendaViewProps extends HomeViewProps {
  onSelectPatient: (patientId: any) => void;
}

interface PatientIntakeViewProps {
  user: any;
  allPatients: any[];
  clinicalRecords: any[];
  onSelectPatient: (patientId: any) => void;
}

interface PatientRecordViewProps {
  user: any;
  patient: any;
  onBack: () => void;
  history: any[];
  notes: any[];
  onAddNote: (pid: any, txt: string, visibility: string, subject?: string) => void;
  onAddActivityLog: (title: string, content: string, type?: string) => void;
  protocols: any[];
  setProtocols: (next: any) => void;
  onAddTask: (task: any) => void;
  patientTasks: any[];
  onEvaluateHistoryItem?: (id: any, score: number, note: string) => void;
  onUpdateTask: (taskId: any, updates: any) => void;
  onUpdatePatient?: (patient: any) => void;
  onRecordTrial?: (pid: any, title: string, score: number, evalComment?: string) => any;
  onDeleteHistoryItem?: (id: any) => void;
  openAnamnesisOnLoad?: boolean;
  hideBackButton?: boolean;
}

const HomeViewBase = ({ user, filteredAgenda }: HomeViewProps) => (
  <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
    <div className="rounded-3xl bg-white border border-slate-100 p-6 shadow-sm xl:col-span-2">
      <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Resumo Operacional</p>
      <h2 className="text-2xl font-bold text-slate-900 mt-2">Painel de {user?.role}</h2>
      <p className="text-sm text-slate-500 mt-2">
        Navegação e permissões derivadas de `roleCapabilities.ts`.
      </p>
    </div>
    <div className="rounded-3xl bg-white border border-slate-100 p-6 shadow-sm">
      <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Agenda Visível</p>
      <p className="text-3xl font-bold text-[#7a32fc] mt-3">{filteredAgenda.length}</p>
      <p className="text-xs text-slate-500 mt-1">atendimentos no escopo deste papel</p>
    </div>
  </div>
);

const AgendaViewBase = ({ user, filteredAgenda, onSelectPatient }: AgendaViewProps) => {
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [dayModalDate, setDayModalDate] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-100 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <CalendarClock size={20} className="text-[#7a32fc]" />
          <div>
            <h3 className="text-base font-bold text-slate-900">Agenda Multi-View</h3>
            <p className="text-xs text-slate-500">
              {user?.role === 'therapist'
                ? 'Filtro automático aplicado para exibir apenas seus atendimentos.'
                : 'Visualização operacional da clínica inteira.'}
            </p>
          </div>
        </div>
        <CalendarWidget
          agenda={filteredAgenda}
          currentDate={calendarDate}
          onDateChange={setCalendarDate}
          onDateSelect={(dateStr: string) => setDayModalDate(dateStr)}
        />
      </div>
      <DayDetailsModal
        isOpen={Boolean(dayModalDate)}
        onClose={() => setDayModalDate(null)}
        date={dayModalDate}
        agenda={filteredAgenda}
        onAddSession={() => {}}
        onPatientClick={(appointmentId: any) => onSelectPatient(appointmentId)}
      />
    </div>
  );
};

const PatientIntakeViewBase = ({
  user,
  allPatients,
  clinicalRecords,
  onSelectPatient,
}: PatientIntakeViewProps) => (
  <div className="rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
    <PatientRegistry
      patients={allPatients}
      clinicalRecords={clinicalRecords}
      onBack={() => {}}
      onSelectPatient={(patientId: any) => onSelectPatient(patientId)}
      userRole={user.role}
    />
  </div>
);

const PatientRecordViewBase = ({ patient, ...rest }: PatientRecordViewProps) => {
  if (!patient) {
    return (
      <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2 text-slate-500">
          <AlertCircle size={18} />
          <p className="text-sm font-semibold">Selecione um paciente em Cadastro para abrir o prontuário.</p>
        </div>
      </div>
    );
  }
  return <PatientDetailView patient={patient} {...rest} />;
};

const HomeView = withAuth<HomeViewProps>(HomeViewBase);
const AgendaView = withAuth<AgendaViewProps>(AgendaViewBase);
const PatientIntakeView = withAuth<PatientIntakeViewProps>(PatientIntakeViewBase);
const PatientRecordView = withAuth<PatientRecordViewProps>(PatientRecordViewBase);

export function MainAppLayout({
  user,
  onLogout,
  allPatients,
  therapistAgenda,
  patientsHistory,
  therapistNotes,
  protocols,
  setProtocols,
  allTasks,
  clinicalRecords,
  rooms,
  roomReservations,
  onDeleteRoomReservation,
  onAddNote,
  onAddActivityLog,
  onAddTask,
  onUpdateTask,
  onUpdateHistoryItem,
  onUpdatePatient,
  onRecordTrial,
  onDeleteHistoryItem,
  onEvaluateHistoryItem,
  onUpdateProfile,
}: MainAppLayoutProps) {
  const role = (user?.role || 'therapist') as ClinicalRole;
  const allowedRoutes = useMemo(() => {
    const base = getAllowedRoutesByRole(role);
    if (role !== 'receptionist') return base;
    return base.filter((route) => !['medical-records', 'anamnesis', 'protocol-library'].includes(route));
  }, [role]);
  const [activeRoute, setActiveRoute] = useState<string>(allowedRoutes[0] || 'home');
  const [selectedPatientId, setSelectedPatientId] = useState<any>(null);

  const filteredAgenda = useMemo(() => {
    const agenda = Array.isArray(therapistAgenda) ? therapistAgenda : [];
    if (role !== 'therapist') return agenda;
    const userId = String(user?.id || '');
    const userEmail = String(user?.email || '').toLowerCase();
    const userName = String(user?.name || '').toLowerCase();

    return agenda.filter((item: any) => {
      const itemProfessionalId = String(item?.professionalId || item?.professional_id || '');
      const itemProfessionalEmail = String(item?.professionalEmail || item?.professional_email || '').toLowerCase();
      const itemProfessionalName = String(item?.professional || item?.professionalName || '').toLowerCase();
      if (itemProfessionalId && userId && itemProfessionalId === userId) return true;
      if (itemProfessionalEmail && userEmail && itemProfessionalEmail === userEmail) return true;
      if (itemProfessionalName && userName && itemProfessionalName.includes(userName)) return true;
      return false;
    });
  }, [role, therapistAgenda, user?.id, user?.email, user?.name]);

  const therapistPatientIdSet = useMemo(() => {
    if (role !== 'therapist') return new Set<string>();
    const ids = new Set<string>();
    filteredAgenda.forEach((item: any) => {
      if (item?.patientId !== undefined && item?.patientId !== null) {
        ids.add(String(item.patientId));
      }
    });
    allPatients.forEach((patient: any) => {
      const therapistId = String(patient?.therapistId || patient?.therapist_id || '');
      if (therapistId && therapistId === String(user?.id || '')) {
        ids.add(String(patient.id));
      }
    });
    return ids;
  }, [role, filteredAgenda, allPatients, user?.id]);

  const scopedPatients = useMemo(() => {
    if (role !== 'therapist') return allPatients;
    return allPatients.filter((patient: any) => therapistPatientIdSet.has(String(patient.id)));
  }, [role, allPatients, therapistPatientIdSet]);

  const selectedPatient = useMemo(() => {
    const basePatient = scopedPatients.find((p: any) => String(p.id) === String(selectedPatientId));
    const clinicalRecord = clinicalRecords.find((record: any) => String(record.patientId) === String(selectedPatientId));
    if (!basePatient) return null;
    return { ...basePatient, ...clinicalRecord };
  }, [scopedPatients, clinicalRecords, selectedPatientId]);

  const mfaEnabled = isClinicalMfaEnabled(user);
  const canSeeMedicalRecords = hasCapability(role, 'medical-records');
  const canSeeAnamnesis = hasCapability(role, 'anamnesis');

  const navigate = (route: string) => {
    if (!allowedRoutes.includes(route)) return;
    setActiveRoute(route);
  };

  const safeSelectPatient = (patientId: any) => {
    setSelectedPatientId(patientId);
    if (role === 'receptionist') return;
    if (canSeeMedicalRecords) setActiveRoute('medical-records');
  };

  const renderContent = () => {
    if (activeRoute === 'home') {
      return <HomeView user={user} filteredAgenda={filteredAgenda} />;
    }

    if (activeRoute === 'agenda') {
      return <AgendaView user={user} filteredAgenda={filteredAgenda} onSelectPatient={safeSelectPatient} />;
    }

    if (activeRoute === 'patient-intake') {
      return (
        <PatientIntakeView
          user={user}
          allPatients={scopedPatients}
          clinicalRecords={clinicalRecords}
          onSelectPatient={safeSelectPatient}
        />
      );
    }

    if (activeRoute === 'medical-records') {
      if (!canSeeMedicalRecords) {
        return <AccessDenied message="Seu papel não possui permissão para prontuários." />;
      }
      if (!mfaEnabled) {
        return <ClinicalMfaGate enabled={false} />;
      }
      return (
        <PatientRecordView
          user={user}
          patient={selectedPatient}
          onBack={() => setActiveRoute('patient-intake')}
          history={patientsHistory.filter((h: any) => String(h.patientId) === String(selectedPatientId))}
          notes={therapistNotes.filter((n: any) => String(n.patientId) === String(selectedPatientId))}
          onAddNote={onAddNote}
          onAddActivityLog={onAddActivityLog}
          protocols={protocols}
          setProtocols={setProtocols}
          onAddTask={onAddTask}
          patientTasks={allTasks.filter((t: any) => String(t.patientId) === String(selectedPatientId))}
          onEvaluateHistoryItem={onEvaluateHistoryItem}
          onUpdateTask={onUpdateTask}
          onUpdatePatient={role === 'therapist' ? undefined : onUpdatePatient}
          onRecordTrial={onRecordTrial}
          onDeleteHistoryItem={onDeleteHistoryItem}
          hideBackButton={false}
        />
      );
    }

    if (activeRoute === 'anamnesis') {
      if (!canSeeAnamnesis) {
        return <AccessDenied message="Seu papel não possui permissão para anamnese." />;
      }
      if (!mfaEnabled) {
        return <ClinicalMfaGate enabled={false} />;
      }
      return (
        <PatientRecordView
          user={user}
          patient={selectedPatient}
          onBack={() => setActiveRoute('patient-intake')}
          history={patientsHistory.filter((h: any) => String(h.patientId) === String(selectedPatientId))}
          notes={therapistNotes.filter((n: any) => String(n.patientId) === String(selectedPatientId))}
          onAddNote={onAddNote}
          onAddActivityLog={onAddActivityLog}
          protocols={protocols}
          setProtocols={setProtocols}
          onAddTask={onAddTask}
          patientTasks={allTasks.filter((t: any) => String(t.patientId) === String(selectedPatientId))}
          onEvaluateHistoryItem={onEvaluateHistoryItem}
          onUpdateTask={onUpdateTask}
          onUpdatePatient={role === 'therapist' ? undefined : onUpdatePatient}
          onRecordTrial={onRecordTrial}
          onDeleteHistoryItem={onDeleteHistoryItem}
          openAnamnesisOnLoad
          hideBackButton={false}
        />
      );
    }

    if (activeRoute === 'protocol-library') {
      return (
        <ProtocolManagementSystem
          protocols={protocols}
          onSaveProtocol={(nextProtocol: any) => {
            const current = Array.isArray(protocols) ? protocols : [];
            const exists = current.some((p: any) => String(p.id) === String(nextProtocol.id));
            if (exists) {
              setProtocols(current.map((p: any) => (String(p.id) === String(nextProtocol.id) ? nextProtocol : p)));
              return;
            }
            setProtocols([nextProtocol, ...current]);
          }}
          onDeleteProtocol={(id: any) => {
            const current = Array.isArray(protocols) ? protocols : [];
            setProtocols(current.filter((p: any) => String(p.id) !== String(id)));
          }}
          onBack={() => setActiveRoute('home')}
        />
      );
    }

    if (activeRoute === 'rooms') {
      return (
        <RoomReservation
          user={user}
          rooms={rooms}
          reservations={roomReservations}
          onDeleteReservation={onDeleteRoomReservation}
          onBack={() => setActiveRoute('home')}
        />
      );
    }

    if (activeRoute === 'profile') {
      return (
        <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm max-w-2xl">
          <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Perfil</p>
          <h3 className="text-xl font-bold text-slate-900 mt-2">{user?.name || 'Usuário'}</h3>
          <p className="text-sm text-slate-500 mt-1">{user?.email || '-'}</p>
          <p className="text-xs text-slate-500 mt-2">Papel: {user?.role}</p>
          <div className="mt-5">
            <button
              onClick={() => onUpdateProfile({ lastSecurityReviewAt: new Date().toISOString() })}
              className="px-4 py-2 rounded-xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-widest"
            >
              Atualizar Perfil
            </button>
          </div>
        </div>
      );
    }

    return <HomeView user={user} filteredAgenda={filteredAgenda} />;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
        <header className="rounded-[32px] bg-white border border-slate-100 shadow-sm px-5 py-4 sm:px-7 sm:py-5 flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <LogoVerto />
            <div>
              <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Verto</p>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 capitalize">{role}</h1>
            </div>
          </div>
          <div className="rounded-full bg-violet-50 text-violet-700 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest">
            Layout Unificado
          </div>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-[min-content_minmax(0,1fr)] gap-4">
          <RoleBasedSidebar role={role} activeRoute={activeRoute} onNavigate={navigate} onLogout={onLogout} />
          <main>{renderContent()}</main>
        </div>
      </div>
    </div>
  );
}
