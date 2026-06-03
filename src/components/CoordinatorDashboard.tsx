import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Calendar,
  ClipboardList,
  Settings,
  LogOut,
  Plus,
  Search,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  DollarSign,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  UserPlus,
  Mail,
  Filter,
  Download,
  FileText,
  DoorOpen,
  Edit2,
  Trash2,
  History,
  ClipboardCheck,
  CalendarDays,
  CalendarPlus,
  ReceiptText,
  FileChartColumnIncreasing,
  BookOpenCheck,
  Cake,
  MessageCircle,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Zap,
  Heart,
  X,
  Menu,
  MoreVertical,
  Clock,
  Moon,
  Sun,
  XCircle,
  Paperclip,
  KeyRound,
} from "lucide-react";
import { TeamManagement } from "./TeamManagement";
import { InvitationModal } from "./InvitationModal";
import { SettingsMenu } from "./SettingsMenu";
import { PatientDetailView } from "./PatientDetailView";
import { PatientInternalChatPreview } from "./PatientInternalChatPreview";
import { AnamnesisModal } from "./Anamnesis";
import { RoomReservation } from "./RoomReservation";
import { ProtocolManagementSystem } from "./Protocols";
import { StackedDomainStatusChart } from "./StackedDomainStatusChart";
import { RoleCapabilityMatrix } from "./RoleCapabilityMatrix";
import { ClinicalAgendaBoard } from "./Calendar";
import { OperationalClosureCenter } from "./OperationalClosureCenter";
import { MonthlyConferenceCenter } from "./MonthlyConferenceCenter";
import { PayerRequirementsPanel } from "./PayerRequirementsPanel";
import { LogoVerto } from "./Common";
import { SecureImage } from "./SecureMedia";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  Cell,
  PieChart as RePieChart,
  Pie,
} from "recharts";
import { SafeResponsiveContainer } from "./SafeResponsiveContainer";
import { dataService } from "../services/dataService";
import {
  getAgendaViewPreferenceKey,
  readAgendaViewPreference,
  writeAgendaViewPreference,
  type AgendaView,
} from "../utils/agendaViewPreference";
import { ROLE_CAPABILITY_SECTIONS } from "../constants/roleCapabilities";
import {
  getDefaultAnamnesisTemplate,
  normalizeAnamnesisTemplate,
} from "../lib/anamnesisSchema";
import { formatTherapistLabel } from "../utils/displayLabels";
import {
  SESSION_DURATION_QUICK_OPTIONS,
  SCHEDULE_LOCATION_OPTIONS,
  addMinutesToTime,
  buildRecurrenceDateKeys,
  checkLocalScheduleConflicts,
  getAppointmentDurationOption,
  normalizeDurationMinutes,
  normalizeScheduleLocationType,
  type ScheduleLocationType,
} from "../utils/scheduling";
import {
  PATIENT_FINANCIAL_BILLING_MODE_OPTIONS,
  PATIENT_FINANCIAL_PAYMENT_METHOD_OPTIONS,
  PATIENT_FINANCIAL_QUANTITY_PERIOD_OPTIONS,
  PATIENT_FINANCIAL_SERVICE_OPTIONS,
  createPatientFinancialPlan,
  financialPlanRequiresPaymentMethod,
  getFinancialPlanMonthlyProjectionValue,
  getFinancialPlanPrimaryBillingMethod,
  isPatientFinancialPlanComplete,
  normalizePatientFinancialPlans,
  serializePatientFinancialPlanForPayload,
} from "../utils/patientFinancialPlan";
import {
  PATIENT_PROFILE_TYPE_OPTIONS,
  getPatientProfileTypeLabel,
  mapPatientProfileTypeToLegacyPortalType,
  normalizePatientProfileType,
} from "../utils/patientProfileType";

interface CoordinatorDashboardProps {
  user: any;
  onLogout: () => void;
  allPatients: any[];
  therapistAgenda: any[];
  onOpenOnboarding?: () => void;
  rooms: any[];
  setRooms: React.Dispatch<React.SetStateAction<any[]>>;
  roomReservations: any[];
  onDeleteRoomReservation: (id: string) => void;
  protocols: any[];
  setProtocols: (protocols: any) => void;
  activityLogs: any[];
  onAddActivityLog: (title: string, content: string, type?: string) => void;
  onScheduleSession: (session: any) => any;
  onUpdateAppointment: (id: any, updates: any) => any;
  onUpdateAgendaStatus: (id: any, status: string, details?: any) => void;
  onDeleteAppointment?: (id: any, details?: any) => Promise<any> | any;
  onAddPatient: (patient: any) => Promise<any> | any;
  patientsHistory: any[];
  therapistNotes: any[];
  onAddNote: (
    pid: any,
    txt: string,
    visibility: string,
    subject?: string,
  ) => void;
  onUpdateProfile: (updates: any) => void;
  onUpdatePatient?: (patient: any) => Promise<any> | any;
  onRecordTrial?: (
    pid: any,
    title: string,
    score: number,
    evalComment?: string,
  ) => any;
  onDeleteHistoryItem?: (id: any) => void;
  onEvaluateHistoryItem?: (id: any, score: number, note: string) => void;
  allTasks?: any[];
  onAddTask?: (task: any) => void;
  onUpdateTask?: (taskId: any, updates: any) => void;
}

const SESSION_PATIENT_INSURANCE_PAYER_VALUE = "__patient_insurance__";

export function CoordinatorDashboard({
  user,
  onLogout,
  allPatients,
  therapistAgenda,
  onOpenOnboarding,
  rooms,
  setRooms,
  roomReservations,
  onDeleteRoomReservation,
  protocols,
  setProtocols,
  activityLogs,
  onAddActivityLog,
  onScheduleSession,
  onUpdateAppointment,
  onUpdateAgendaStatus,
  onDeleteAppointment,
  onAddPatient,
  patientsHistory,
  therapistNotes,
  onAddNote,
  onUpdateProfile,
  onUpdatePatient,
  onRecordTrial,
  onDeleteHistoryItem,
  onEvaluateHistoryItem,
  allTasks = [],
  onAddTask,
  onUpdateTask,
}: CoordinatorDashboardProps) {
  const formatCnpjInput = (value: string) => {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };
  const role = String(user?.role || "coordinator");
  const capabilityRole: "coordinator" | "receptionist" | "therapist" =
    role === "therapist"
      ? "therapist"
      : role === "receptionist"
        ? "receptionist"
        : "coordinator";
  const isTherapist = capabilityRole === "therapist";
  const isReceptionist = capabilityRole === "receptionist";
  const canCancelRecurringAppointments = ["coordinator", "receptionist", "therapist", "admin", "owner"].includes(role.toLowerCase());
  const canDeleteRecurringAppointments = canCancelRecurringAppointments;
  const canAccessClinicFinance = ["coordinator", "admin", "owner"].includes(role.toLowerCase());
  const canCreatePatients = !isTherapist;
  const canManageRooms = !isTherapist;
  const dashboardResumeKey = useMemo(() => {
    const userId = String(user?.id || "").trim();
    const workspaceId =
      String(user?.activeWorkspaceId || user?.clinicId || "global").trim() ||
      "global";
    if (!userId) return null;
    return `verto:dashboard:resume:${userId}:${workspaceId}`;
  }, [user?.id, user?.activeWorkspaceId, user?.clinicId]);
  const hasRestoredDashboardStateRef = useRef(false);

  const capabilityStatusForRole = (capabilityKey: string): "full" | "limited" | "none" => {
    const capability = ROLE_CAPABILITY_SECTIONS.flatMap((section) => section.items).find(
      (item) => item.key === capabilityKey,
    );
    if (!capability) return "none";
    const status = (capability as any)?.[capabilityRole];
    if (status === "full" || status === "limited" || status === "none") return status;
    return "none";
  };

  const tabCapabilityMap: Record<string, string | null> = {
    dashboard: null,
    patients: "patient-intake",
    protocols: "protocol-library",
    financial: "patient-financial",
    team: "team-compensation",
    settings: null,
    logs: null,
    billing: "billing-management",
    flow: "engagement-widgets",
    birthdays: "engagement-widgets",
    agenda: "agenda-multi-view",
    closure: "agenda-multi-view",
    conference: "agenda-multi-view",
    rooms: "rooms",
  };

  const capabilityForTab = (tabId: string) => {
    if (tabId === "patients" && isTherapist) return "medical-records";
    return tabCapabilityMap[tabId];
  };

  const canAccessTab = (tabId: string) => {
    if (tabId === "financial") return canAccessClinicFinance;
    if (tabId === "closure") return !isReceptionist;
    if (tabId === "conference") return !isReceptionist && !isTherapist;
    const capability = capabilityForTab(tabId);
    if (!capability) return true;
    const status = capabilityStatusForRole(capability);
    if (status === "none") return false;
    return true;
  };

  const filterTabsByRole = <T extends { id: string }>(items: T[]) =>
    items.filter((item) => {
      return canAccessTab(item.id);
    });

  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "team"
    | "financial"
    | "patients"
    | "agenda"
    | "closure"
    | "conference"
    | "rooms"
    | "protocols"
    | "settings"
    | "logs"
    | "billing"
    | "flow"
    | "birthdays"
  >("dashboard");
  const [tabHistory, setTabHistory] = useState<string[]>(["dashboard"]);
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [showBillingDetails, setShowBillingDetails] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [therapistMembersById, setTherapistMembersById] = useState<Record<string, any>>({});
  const [patientTherapistFilter, setPatientTherapistFilter] = useState<string>("all");
  const [patientQuickFilter, setPatientQuickFilter] = useState<"all" | "birthdaysToday">("all");

  const navigateToTab = (
    tab:
      | "dashboard"
      | "team"
      | "financial"
      | "patients"
      | "agenda"
      | "closure"
      | "conference"
      | "rooms"
      | "protocols"
      | "settings"
      | "logs"
      | "billing"
      | "flow"
      | "birthdays",
  ) => {
    if (!canAccessTab(tab)) {
      setActiveTab("dashboard");
      return;
    }
    setActiveTab(tab);
    setTabHistory((prev) => {
      if (prev[prev.length - 1] === tab) return prev;
      return [...prev, tab];
    });
  };

  useEffect(() => {
    if (!canAccessTab(activeTab)) {
      setActiveTab("dashboard");
      setTabHistory(["dashboard"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeTab]);

  const goBackTab = () => {
    setTabHistory((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const previousTab = next[next.length - 1] as typeof activeTab;
      setActiveTab(previousTab);
      return next;
    });
  };

  useEffect(() => {
    let isMounted = true;
    const loadTherapistMembers = async () => {
      try {
        const result = await dataService.getClinicMembers();
        if (!isMounted || !result?.success || !Array.isArray(result?.data)) return;
        const byId: Record<string, any> = {};
        result.data.forEach((member: any) => {
          const role = String(
            member?.profileRole || member?.professionalProfileRole || member?.role || "",
          ).toLowerCase();
          const id = String(member?.id || "").trim();
          if ((role === "therapist" || role === "professional") && id) {
            byId[id] = member;
          }
        });
        setTherapistMembersById(byId);
      } catch (error) {
        console.error("Erro ao carregar terapeutas para exibição de responsáveis:", error);
      }
    };
    loadTherapistMembers();
    return () => {
      isMounted = false;
    };
  }, [user?.activeWorkspaceId, user?.clinicId]);

  const therapistFilterOptions = useMemo(() => {
    const entries = Object.entries(therapistMembersById as Record<string, any>)
      .map(([id, member]: [string, any]) => {
        const specialties = Array.isArray(member?.specialties)
          ? member.specialties
          : String(member?.specialties || member?.specialty || member?.professionalSpecialty || "")
              .split(/[,;|]/);
        const specialty = String(specialties.find((item: any) => String(item || "").trim()) || "").trim();
        return {
          id,
          label: String(
            member?.full_name || member?.fullName || member?.name || member?.email || id,
          ).trim(),
          specialty,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return entries;
  }, [therapistMembersById]);

  const isValidDateOnlyParts = (year: number, month: number, day: number) => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const localDate = new Date(year, month - 1, day);
    return (
      localDate.getFullYear() === year &&
      localDate.getMonth() === month - 1 &&
      localDate.getDate() === day
    );
  };

  const normalizeBirthDateForStorage = (value: any) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const isoDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDateOnly) {
      const year = Number(isoDateOnly[1]);
      const month = Number(isoDateOnly[2]);
      const day = Number(isoDateOnly[3]);
      return isValidDateOnlyParts(year, month, day) ? `${isoDateOnly[1]}-${isoDateOnly[2]}-${isoDateOnly[3]}` : "";
    }
    const brazilianDate = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brazilianDate) {
      const day = Number(brazilianDate[1]);
      const month = Number(brazilianDate[2]);
      const year = Number(brazilianDate[3]);
      if (!isValidDateOnlyParts(year, month, day)) return "";
      return `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}`;
    }
    return "";
  };

  const formatBirthDateForInput = (value: any) => normalizeBirthDateForStorage(value);

  const formatBirthDateForDisplay = (value: any) => {
    const normalized = normalizeBirthDateForStorage(value);
    if (!normalized) return "";
    const [year, month, day] = normalized.split("-");
    return `${day}/${month}/${year}`;
  };

  const parsePatientBirthDateParts = (value: any) => {
    const normalized = normalizeBirthDateForStorage(value);
    if (!normalized) return null;
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
      day: Number(match[3]),
      month: Number(match[2]),
    };
  };

  const isInactivePatientForDashboard = (patient: any) => {
    const normalized = String(patient?.status || "").trim().toLowerCase();
    return Boolean(
      patient?.deleted_at ||
        patient?.deletedAt ||
        patient?.unlinkedAt ||
        patient?.is_active === false ||
        ["inactive", "inativo", "deleted", "archived", "cancelled", "canceled", "unlinked"].includes(normalized),
    );
  };

  const isBirthdayTodayPatient = (patient: any) => {
    if (isInactivePatientForDashboard(patient)) return false;
    const today = new Date();
    const birthDate = parsePatientBirthDateParts(
      patient?.birthDate ||
        patient?.birth_date ||
        patient?.dataNascimento ||
        patient?.anamnesisData?.dataNascimento,
    );
    return birthDate?.day === today.getDate() && birthDate?.month === today.getMonth() + 1;
  };

  const roleScopedPatients = useMemo(() => {
    const currentTherapistId = String(user?.id || "").trim();
    return isTherapist
      ? allPatients.filter((patient: any) => {
          const therapistId = String(
            patient?.therapist_id || patient?.professional_id || "",
          ).trim();
          return Boolean(currentTherapistId) && therapistId === currentTherapistId;
        })
      : allPatients;
  }, [allPatients, isTherapist, user?.id]);

  const birthdayPatients = useMemo(
    () => roleScopedPatients.filter((patient: any) => isBirthdayTodayPatient(patient)),
    [roleScopedPatients],
  );

  const visiblePatients = useMemo(() => {
    const patientsAllowedForRole = roleScopedPatients;

    let filteredPatients = patientsAllowedForRole;
    if (patientTherapistFilter !== "all" && !isTherapist) {
      if (patientTherapistFilter === "unassigned") {
        filteredPatients = patientsAllowedForRole.filter((patient: any) => {
          const therapistId = String(
            patient?.therapist_id || patient?.professional_id || "",
          ).trim();
          return !therapistId;
        });
      } else {
        filteredPatients = patientsAllowedForRole.filter((patient: any) => {
          const therapistId = String(
            patient?.therapist_id || patient?.professional_id || "",
          ).trim();
          return therapistId === patientTherapistFilter;
        });
      }
    }

    if (patientQuickFilter === "birthdaysToday") {
      return filteredPatients.filter((patient: any) => isBirthdayTodayPatient(patient));
    }

    return filteredPatients;
  }, [isTherapist, patientQuickFilter, patientTherapistFilter, roleScopedPatients]);

  const visiblePatientsWithoutQuickFilter = useMemo(() => {
    if (patientTherapistFilter === "all" || isTherapist) return roleScopedPatients;
    if (patientTherapistFilter === "unassigned") {
      return roleScopedPatients.filter((patient: any) => {
        const therapistId = String(
          patient?.therapist_id || patient?.professional_id || "",
        ).trim();
        return !therapistId;
      });
    }
    return roleScopedPatients.filter((patient: any) => {
      const therapistId = String(
        patient?.therapist_id || patient?.professional_id || "",
      ).trim();
      return therapistId === patientTherapistFilter;
    });
  }, [isTherapist, patientTherapistFilter, roleScopedPatients]);

  const billingHistory = [
    {
      date: "15/03/2026",
      amount: 149.9,
      status: "paid",
      method: "Cartão •••• 4242",
    },
    {
      date: "15/02/2026",
      amount: 149.9,
      status: "paid",
      method: "Cartão •••• 4242",
    },
    {
      date: "15/01/2026",
      amount: 149.9,
      status: "paid",
      method: "Cartão •••• 4242",
    },
  ];

  const upcomingBills = [
    { date: "15/04/2026", amount: 149.9, status: "pending" },
    { date: "15/05/2026", amount: 149.9, status: "pending" },
    { date: "15/06/2026", amount: 149.9, status: "pending" },
  ];

  const tabLabels: Record<string, string> = {
    dashboard: "Painel",
    team: "Gestão da Equipe",
    financial: "Financeiro",
    patients: "Pacientes",
    agenda: "Agenda",
    closure: "Fechamento operacional",
    conference: "Conferência mensal",
    rooms: "Reservas de Sala",
    protocols: "Protocolos",
    settings: "Configurações da Clínica",
    logs: "Log de Atividades",
    billing: "Assinatura e Cobrança",
  };
  const professionalDailyMessages = [
    "Cada marco registrado hoje é um capítulo na história de superação de alguém.",
    "A ciência é sua base, mas sua escuta é o que transforma vidas.",
    "Lembre-se: para o paciente, você é a ponte entre o desafio e a conquista.",
    "O progresso clínico raramente é uma linha reta. Valorize as pequenas vitórias de hoje!",
    "Grandes mudanças são feitas de pequenos marcos consistentes.",
    "Sua dedicação é a bússola que guia o desenvolvimento de quem você atende.",
    "Para cuidar do outro com excelência, lembre-se de também cuidar de você.",
    "Sua saúde mental é tão importante quanto a técnica que você aplica. Respire fundo.",
    "Lembre-se que quem faz o dia bonito é você!",
    "Transformando dados em sorrisos e evolução, um atendimento por vez.",
  ];

  const [loading, setLoading] = useState(false);
  const [isEditingRooms, setIsEditingRooms] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", specialties: "" });
  const [editingRoom, setEditingRoom] = useState<any>(null);

  const agendaViewPreferenceKey = useMemo(
    () => getAgendaViewPreferenceKey(user),
    [user?.id, user?.email, user?.activeWorkspaceId, user?.clinicId],
  );

  // Agenda State
  const [agendaView, setAgendaView] = useState<AgendaView>(() =>
    readAgendaViewPreference(agendaViewPreferenceKey),
  );
  useEffect(() => {
    setAgendaView(readAgendaViewPreference(agendaViewPreferenceKey));
  }, [agendaViewPreferenceKey]);
  const handleAgendaViewChange = useCallback(
    (nextView: AgendaView) => {
      setAgendaView(nextView);
      writeAgendaViewPreference(agendaViewPreferenceKey, nextView);
    },
    [agendaViewPreferenceKey],
  );
  const [professionalFilter, setProfessionalFilter] = useState("all");
  const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
  const [isQuickRegisterModalOpen, setIsQuickRegisterModalOpen] = useState(false);
  const [isPatientRegistrationModalOpen, setIsPatientRegistrationModalOpen] =
    useState(false);
  const [agendaSearchMode, setAgendaSearchMode] = useState<
    "patient" | "professional"
  >("patient");
  const [agendaSearchTerm, setAgendaSearchTerm] = useState("");
  const [quickPatientName, setQuickPatientName] = useState("");
  const [quickPatientEmail, setQuickPatientEmail] = useState("");
  const [quickPatientPhone, setQuickPatientPhone] = useState("");
  const [quickPatientAge, setQuickPatientAge] = useState("");
  const [isDayDetailsModalOpen, setIsDayDetailsModalOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [actionPopup, setActionPopup] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [processingState, setProcessingState] = useState<{
    active: boolean;
    message: string;
  }>({ active: false, message: "Processando..." });
  const themeStorageKey = useMemo(
    () => `verto_theme_${String(user?.id || "guest")}`,
    [user?.id],
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const legacy = localStorage.getItem("verto_theme");
    return legacy === "dark" || legacy === "light" ? legacy : "light";
  });
  const [sessionDate, setSessionDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [sessionTime, setSessionTime] = useState("08:00");
  const [sessionPatientName, setSessionPatientName] = useState("");
  const [sessionApproach, setSessionApproach] = useState("");
  const [sessionDurationOption, setSessionDurationOption] = useState("50");
  const [sessionCustomDuration, setSessionCustomDuration] = useState("50");
  const [sessionLocationType, setSessionLocationType] = useState<ScheduleLocationType>("clinica");
  const [sessionRoom, setSessionRoom] = useState("");
  const [sessionLocationNotes, setSessionLocationNotes] = useState("");
  const [sessionCallLink, setSessionCallLink] = useState("");
  const [sessionProfessional, setSessionProfessional] = useState("");
  const [sessionPayerId, setSessionPayerId] = useState("");
  const [sessionPayerNameSnapshot, setSessionPayerNameSnapshot] = useState("");
  const [sessionGuideNumber, setSessionGuideNumber] = useState("");
  const [sessionAuthorizationCode, setSessionAuthorizationCode] = useState("");
  const [clinicPayers, setClinicPayers] = useState<any[]>([]);
  const lastAutoPayerPatientKeyRef = useRef("");
  const [sessionNumSessions, setSessionNumSessions] = useState(1);
  const [sessionRecurrencePattern, setSessionRecurrencePattern] = useState("weekly");
  const [scheduleConflictState, setScheduleConflictState] = useState<{
    loading: boolean;
    checked: boolean;
    blocking: boolean;
    message: string;
    conflicts: any[];
  }>({ loading: false, checked: false, blocking: false, message: "", conflicts: [] });
  const [editingAppointmentId, setEditingAppointmentId] = useState<
    string | number | null
  >(null);
  const [appointmentEditScope, setAppointmentEditScope] = useState<"single" | "future">("single");
  const [selectedPatientId, setSelectedPatientId] = useState<any>(null);
  const [view, setView] = useState<"home" | "patient">("home");
  const [patientOpenTab, setPatientOpenTab] = useState<
    "history" | "notes" | "report" | "plan" | "session" | "files"
  >("history");
  const [openAnamnesisOnPatientOpen, setOpenAnamnesisOnPatientOpen] =
    useState(false);
  const [isPatientProfileModalOpen, setIsPatientProfileModalOpen] =
    useState(false);
  const [selectedPatientProfile, setSelectedPatientProfile] = useState<any>(null);
  const [selectedAgendaAppointment, setSelectedAgendaAppointment] =
    useState<any>(null);
  const [scheduledSessionContext, setScheduledSessionContext] =
    useState<any>(null);
  const [scheduledSessionStartKey, setScheduledSessionStartKey] =
    useState("");
  const [agendaAppointmentObservation, setAgendaAppointmentObservation] =
    useState("");
  const [pendingRecurringCancellation, setPendingRecurringCancellation] =
    useState<{
      appointment: any;
      note: string;
      source: string;
    } | null>(null);
  const [pendingRecurringDeletion, setPendingRecurringDeletion] =
    useState<{
      appointment: any;
      note: string;
      source: string;
    } | null>(null);
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);
  const dashboardHeadlineMessage = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    let seed = 0;
    for (let i = 0; i < todayKey.length; i += 1) seed += todayKey.charCodeAt(i);
    const index = seed % professionalDailyMessages.length;
    return professionalDailyMessages[index];
  }, []);
  const dashboardGreeting = useMemo(() => {
    const hour = new Date().getHours();
    const firstName = String(user?.name || "colaborador").trim().split(" ")[0] || "colaborador";
    const period = hour < 12 ? "Bom dia," : hour < 18 ? "Boa tarde," : "Boa noite,";
    return { period, firstName };
  }, [user?.name]);
  useEffect(() => {
    if (!dashboardResumeKey || hasRestoredDashboardStateRef.current) return;
    hasRestoredDashboardStateRef.current = true;
    try {
      const raw = localStorage.getItem(dashboardResumeKey);
      if (!raw) return;
      const state = JSON.parse(raw || "{}");
      const nextTab = String(state?.activeTab || "dashboard") as typeof activeTab;
      const nextView = String(state?.view || "home");
      const nextPatientId = String(state?.selectedPatientId || "").trim();
      const nextPatientTab = String(state?.patientOpenTab || "history");

      if (canAccessTab(nextTab)) {
        setActiveTab(nextTab);
        setTabHistory([nextTab]);
      } else {
        setActiveTab("dashboard");
        setTabHistory(["dashboard"]);
      }

      if (nextView === "patient" && nextPatientId) {
        setSelectedPatientId(nextPatientId);
        if (
          nextPatientTab === "history" ||
          nextPatientTab === "notes" ||
          nextPatientTab === "report" ||
          nextPatientTab === "plan" ||
          nextPatientTab === "session" ||
          nextPatientTab === "files"
        ) {
          setPatientOpenTab(nextPatientTab);
        }
        setView("patient");
      } else {
        setView("home");
      }
    } catch (error) {
      console.warn("Falha ao restaurar contexto do painel:", error);
    }
  }, [dashboardResumeKey, activeTab]);

  useEffect(() => {
    if (!dashboardResumeKey) return;
    try {
      localStorage.setItem(
        dashboardResumeKey,
        JSON.stringify({
          activeTab,
          view,
          selectedPatientId: selectedPatientId ? String(selectedPatientId) : null,
          patientOpenTab,
        }),
      );
    } catch (error) {
      console.warn("Falha ao persistir contexto do painel:", error);
    }
  }, [dashboardResumeKey, activeTab, view, selectedPatientId, patientOpenTab]);

  const [payments, setPayments] = useState<any[]>([]);
  const [professionalPayments, setProfessionalPayments] = useState<any[]>([]);
  const [financialEntries, setFinancialEntries] = useState<any[]>([]);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isProfessionalPaymentModalOpen, setIsProfessionalPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [editingPaymentScope, setEditingPaymentScope] = useState<"single" | "future">("single");
  const [editingProfessionalPayment, setEditingProfessionalPayment] = useState<any>(null);
  const [editingProfessionalPaymentScope, setEditingProfessionalPaymentScope] = useState<"single" | "future">("single");
  const [selectedPaymentPatient, setSelectedPaymentPatient] =
    useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentDueDate, setPaymentDueDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentSpecialty, setPaymentSpecialty] = useState("");
  const [financialMonth, setFinancialMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [paymentReceipt, setPaymentReceipt] = useState<string | null>(null);
  const [paymentReceiptName, setPaymentReceiptName] = useState("");
  const [paymentType, setPaymentType] = useState("particular");
  const [paymentInsurance, setPaymentInsurance] = useState("");
  const [selectedProfessionalPaymentId, setSelectedProfessionalPaymentId] = useState("");
  const [professionalPaymentAmount, setProfessionalPaymentAmount] = useState("");
  const [professionalPaymentDate, setProfessionalPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [professionalPaymentDueDate, setProfessionalPaymentDueDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [professionalPaymentMethod, setProfessionalPaymentMethod] = useState("pix");
  const [professionalPaymentStatus, setProfessionalPaymentStatus] = useState("pending");
  const [paymentIsRecurring, setPaymentIsRecurring] = useState(false);
  const [paymentRecurrenceMonths, setPaymentRecurrenceMonths] = useState("6");
  const [paymentRecurrenceDueDays, setPaymentRecurrenceDueDays] = useState("");
  const [paymentAdditionalAmount, setPaymentAdditionalAmount] = useState("");
  const [paymentAdditionalScope, setPaymentAdditionalScope] = useState<"next" | "future">("next");
  const [professionalPaymentIsRecurring, setProfessionalPaymentIsRecurring] = useState(false);
  const [professionalPaymentRecurrenceMonths, setProfessionalPaymentRecurrenceMonths] = useState("6");
  const [professionalPaymentRecurrenceDueDays, setProfessionalPaymentRecurrenceDueDays] = useState("");
  const [professionalPaymentAdditionalAmount, setProfessionalPaymentAdditionalAmount] = useState("");
  const [professionalPaymentAdditionalScope, setProfessionalPaymentAdditionalScope] = useState<"next" | "future">("next");
  const [defaultSessionDuration, setDefaultSessionDuration] = useState(
    String(user?.clinicSettings?.defaultSessionDuration || "50"),
  );
  const [workStart, setWorkStart] = useState(
    user?.clinicSettings?.workStart || "08:00",
  );
  const [workEnd, setWorkEnd] = useState(
    user?.clinicSettings?.workEnd || "18:00",
  );
  const [professionalSessionDurations, setProfessionalSessionDurations] =
    useState<Record<string, string>>({});
  const [financialSurveySubmitted, setFinancialSurveySubmitted] = useState(false);
  const [financialSurveySelected, setFinancialSurveySelected] = useState<string[]>([]);
  const [financialSurveyNotes, setFinancialSurveyNotes] = useState("");
  const [anamnesisTemplate, setAnamnesisTemplate] = useState<any>(
    getDefaultAnamnesisTemplate(),
  );
  const [isAnamnesisTemplateModalOpen, setIsAnamnesisTemplateModalOpen] =
    useState(false);
  const [loadingAnamnesisTemplate, setLoadingAnamnesisTemplate] =
    useState(false);
  const [clinicCnpj, setClinicCnpj] = useState(
    formatCnpjInput(String(user?.clinicSettings?.clinicCnpj || "")),
  );
  const buildInitialAvatarDataUrl = (name?: string) => {
    const initial = (name || "P").trim().charAt(0).toUpperCase() || "P";
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%' height='100%' rx='18' fill='#7a32fc'/><text x='50%' y='56%' text-anchor='middle' font-size='42' font-family='Arial,sans-serif' fill='white'>${initial}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  };
  const coordinatorAvatarUrl = user?.profilePicture || user?.profile_picture || null;
  const [therapistCrp, setTherapistCrp] = useState<string>(
    String(user?.crp || ""),
  );
  const [therapistFullName, setTherapistFullName] = useState<string>(
    String(user?.name || ""),
  );
  const [therapistSpecialties, setTherapistSpecialties] = useState<string>(
    String(
      user?.specialties ||
        user?.clinicSettings?.therapistSpecialties ||
        user?.clinicSettings?.specialty ||
        "",
    ),
  );
  const [therapistMiniCurriculum, setTherapistMiniCurriculum] = useState<string>(
    String(
      user?.miniCurriculum ||
        user?.clinicSettings?.therapistMiniCurriculum ||
        "",
    ),
  );
  const [therapistSignatureDataUrl, setTherapistSignatureDataUrl] = useState<
    string | null
  >(user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null);
  const [therapistProfilePhotoUrl, setTherapistProfilePhotoUrl] = useState<
    string | null
  >(user?.profilePicture || user?.profile_picture || null);
  const [clinicLogoDataUrl, setClinicLogoDataUrl] = useState<string | null>(
    user?.clinicSettings?.clinicLogoUrl || null,
  );
  const [mediaRefreshAttempts, setMediaRefreshAttempts] = useState({
    signature: 0,
    profile: 0,
    logo: 0,
  });
  const therapistCanRegisterClinicalData = !isTherapist || Boolean(therapistCrp.trim());
  const canManageProtocolLibrary = capabilityStatusForRole("protocol-library") === "full";
  const canManageClinicSettings = capabilityStatusForRole("clinic-settings") !== "none";
  const canManageBilling = capabilityStatusForRole("billing-management") !== "none";
  const canEditAnamnesisTemplate = canManageClinicSettings;
  const DAY_GRID_SLOT_HEIGHT_PX = 66;
  const DAY_GRID_START_HOUR = 7;
  const DAY_GRID_END_HOUR = 20;
  const [currentTimelineOffsetPx, setCurrentTimelineOffsetPx] = useState<number | null>(null);
  const [currentTimelineLabel, setCurrentTimelineLabel] = useState<string>("");
  const financialSurveyOptions = [
    "Controle de recebimentos por paciente",
    "Conciliação de PIX e cartão",
    "Fluxo de caixa diário e mensal",
    "Alertas de inadimplência",
    "Cobrança automática por WhatsApp",
    "Relatório por convênio",
    "Comissão por profissional",
    "Repasse automático aos terapeutas",
    "DRE simplificado por clínica",
    "Centro de custos por unidade",
    "Gestão de reembolsos",
    "Emissão de recibos",
    "Upload de comprovantes",
    "Assinatura digital de recibos",
    "Previsão de faturamento",
    "Metas financeiras mensais",
    "Comparativo mês a mês",
    "Exportação contábil (CSV)",
    "Integração com Stripe completa",
    "Painel de auditoria financeira",
  ];

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    setToast({ type, message });
  };

  const parseMoneyInput = (value: any) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const normalized = raw
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatMoneyInput = (value: any) => {
    const parsed = parseMoneyInput(value);
    if (!parsed) return "";
    return parsed.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const normalizeMoneyInputChange = (value: string) =>
    value
      .replace(/[^\d,.]/g, "")
      .replace(/(\,.*),/g, "$1")
      .slice(0, 14);

  const createFinancialSeriesId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `series-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const clampDueDay = (day: number) =>
    Math.min(31, Math.max(1, Number(day) || 1));

  const parseDueDays = (value: string, fallbackDate: string) => {
    const fallbackDay = clampDueDay(
      Number(String(fallbackDate || "").split("-")[2]) || new Date().getDate(),
    );
    const parsed = String(value || "")
      .split(/[,\s;]+/)
      .map((item) => clampDueDay(Number(item)))
      .filter(Boolean);
    const unique = Array.from(new Set(parsed.length ? parsed : [fallbackDay]));
    return unique.sort((a, b) => a - b);
  };

  const buildMonthlyDueDates = (startDate: string, dueDays: number[], months: number) => {
    const start = new Date(`${startDate || new Date().toISOString().slice(0, 10)}T00:00:00`);
    const totalMonths = Math.min(60, Math.max(1, Number(months) || 1));
    const dates: string[] = [];
    for (let monthIndex = 0; monthIndex < totalMonths; monthIndex += 1) {
      dueDays.forEach((day) => {
        const candidate = new Date(start.getFullYear(), start.getMonth() + monthIndex, 1);
        const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
        candidate.setDate(Math.min(day, lastDay));
        dates.push(candidate.toISOString().slice(0, 10));
      });
    }
    return Array.from(new Set(dates)).sort();
  };

  const getPaymentStatus = (payment: any) =>
    String(payment?.status || "").trim().toLowerCase();

  const isPaymentPaid = (payment: any) => getPaymentStatus(payment) === "paid";

  const daysUntilDate = (dateValue: any) => {
    const raw = String(dateValue || "").slice(0, 10);
    if (!raw) return null;
    const target = new Date(`${raw}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(target.getTime())) return null;
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  };

  const ensureTherapistClinicalProfile = () => {
    if (therapistCanRegisterClinicalData) return true;
    const warning =
      "Complete seu perfil com o CRP para habilitar registros clínicos";
    alert(warning);
    showToast(warning, "error");
    setActiveTab("settings");
    setTabHistory((prev) => (prev[prev.length - 1] === "settings" ? prev : [...prev, "settings"]));
    return false;
  };

  const readImageAsDataUrl = (file: File, onDone: (result: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      if (!value) {
        showToast("Não foi possível processar a imagem.", "error");
        return;
      }
      onDone(value);
    };
    reader.onerror = () => showToast("Falha ao ler arquivo de imagem.", "error");
    reader.readAsDataURL(file);
  };

  const isUnsavedLocalMediaPreview = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().startsWith("data:image/");

  const showProcessing = (message = "Processando...") => {
    setProcessingState({ active: true, message });
  };

  const hideProcessing = () => {
    setProcessingState((prev) => ({ ...prev, active: false }));
  };

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timeout);
  }, [toast]);

  const [newPatientForm, setNewPatientForm] = useState<any>({
    nome: "",
    nomeSocial: "",
    telefone: "",
    dataNascimento: "",
    genero: "",
    convenioTipo: "particular",
    convenioNome: "",
    convenioCarteirinha: "",
    grupo: "adulto",
    comoConheceu: "",
    rg: "",
    cpf: "",
    cep: "",
    email: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    outrasInformacoes: "",
    menorDeIdade: false,
    responsavelNome: "",
    responsavelDataNascimento: "",
    responsavelCpf: "",
    responsavelTelefone: "",
    responsavelEmail: "",
    responsavelRelacao: "",
    patientProfileType: "ADULT",
    financialPlans: [],
  });
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "settings" || isAnamnesisTemplateModalOpen) {
      loadClinicAnamnesisTemplate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAnamnesisTemplateModalOpen]);

  useEffect(() => {
    loadClinicAnamnesisTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insuranceOptions = [
    "Particular",
    "Unimed",
    "Amil",
    "Bradesco Saúde",
    "SulAmérica",
    "Hapvida",
    "NotreDame Intermédica",
    "Care Plus",
    "Omint",
    "Porto Seguro Saúde",
    "Golden Cross",
    "Seguros Unimed",
    "Samp",
    "São Cristóvão Saúde",
    "CASSI",
    "Geap",
    "IPSEMG",
    "Cabesp",
    "Afresp",
    "Outro",
  ];

  useEffect(() => {
    const fetchFinancialData = async () => {
      if (!canAccessClinicFinance) return;
      const [paymentsResult, professionalResult, entriesResult] = await Promise.all([
        dataService.getPayments(),
        dataService.getProfessionalPayments(),
        dataService.getClinicFinancialEntries(),
      ]);
      if (paymentsResult.success) setPayments(paymentsResult.data || []);
      if (professionalResult.success) setProfessionalPayments(professionalResult.data || []);
      if (entriesResult.success) setFinancialEntries(entriesResult.data || []);
    };
    if (activeTab === "financial" && canAccessClinicFinance) {
      fetchFinancialData();
    }
  }, [activeTab, canAccessClinicFinance]);

  useEffect(() => {
    setTherapistCrp(String(user?.crp || ""));
    setTherapistFullName(String(user?.name || ""));
    setTherapistSpecialties(
      String(
        user?.specialties ||
          user?.clinicSettings?.therapistSpecialties ||
          user?.clinicSettings?.specialty ||
          "",
      ),
    );
    setTherapistMiniCurriculum(
      String(
        user?.miniCurriculum ||
          user?.clinicSettings?.therapistMiniCurriculum ||
          "",
      ),
    );
    setTherapistSignatureDataUrl((prev) =>
      isUnsavedLocalMediaPreview(prev)
        ? prev
        : user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null,
    );
    setTherapistProfilePhotoUrl((prev) =>
      isUnsavedLocalMediaPreview(prev)
        ? prev
        : user?.profilePicture || user?.profile_picture || null,
    );
    setClinicLogoDataUrl((prev) =>
      isUnsavedLocalMediaPreview(prev)
        ? prev
        : user?.clinicSettings?.clinicLogoUrl || null,
    );
    setWorkStart(String(user?.clinicSettings?.workStart || "08:00"));
    setWorkEnd(String(user?.clinicSettings?.workEnd || "18:00"));
    setClinicCnpj(formatCnpjInput(String(user?.clinicSettings?.clinicCnpj || "")));
  }, [
    user?.crp,
    user?.name,
    user?.specialties,
    user?.miniCurriculum,
    user?.clinicSettings?.therapistSpecialties,
    user?.clinicSettings?.therapistMiniCurriculum,
    user?.clinicSettings?.specialty,
    user?.signatureDataUrl,
    user?.clinicSettings?.signatureDataUrl,
    user?.profilePicture,
    user?.profile_picture,
    user?.clinicSettings?.clinicLogoUrl,
    user?.clinicSettings?.workStart,
    user?.clinicSettings?.workEnd,
    user?.clinicSettings?.clinicCnpj,
  ]);
  const refreshSignedMediaUrls = useCallback(async () => {
    try {
      const userId = String(user?.id || "").trim();
      if (!userId) return;

      const profileResult = await dataService.getUserProfileMedia(userId);
      if (!profileResult?.success) return;

      const media = profileResult?.data || {};
      const signedProfilePicture = String(media?.profilePictureUrl || "").trim() || null;
      const signedClinicLogo = String(media?.clinicLogoUrl || "").trim() || null;
      const signedSignature = String(media?.signatureUrl || "").trim() || null;

      setTherapistProfilePhotoUrl((prev) =>
        isUnsavedLocalMediaPreview(prev) ? prev : signedProfilePicture || prev,
      );
      setClinicLogoDataUrl((prev) =>
        isUnsavedLocalMediaPreview(prev) ? prev : signedClinicLogo || prev,
      );
      setTherapistSignatureDataUrl((prev) =>
        isUnsavedLocalMediaPreview(prev) ? prev : signedSignature || prev,
      );
    } catch (error) {
      console.warn("Falha ao renovar URLs assinadas de mídia no perfil.", error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (activeTab !== "settings") return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await refreshSignedMediaUrls();
    };
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 1000 * 60 * 4);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, refreshSignedMediaUrls]);

  const retryMediaIfBroken = useCallback(
    async (mediaType: "signature" | "profile" | "logo") => {
      if (activeTab !== "settings") return;
      if (
        (mediaType === "signature" && isUnsavedLocalMediaPreview(therapistSignatureDataUrl)) ||
        (mediaType === "profile" && isUnsavedLocalMediaPreview(therapistProfilePhotoUrl)) ||
        (mediaType === "logo" && isUnsavedLocalMediaPreview(clinicLogoDataUrl))
      ) {
        return;
      }
      if ((mediaRefreshAttempts[mediaType] || 0) >= 2) return;
      setMediaRefreshAttempts((prev) => ({
        ...prev,
        [mediaType]: (prev[mediaType] || 0) + 1,
      }));
      await refreshSignedMediaUrls();
    },
    [
      activeTab,
      clinicLogoDataUrl,
      mediaRefreshAttempts,
      refreshSignedMediaUrls,
      therapistProfilePhotoUrl,
      therapistSignatureDataUrl,
    ],
  );

  useEffect(() => {
    const updateTimeline = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      if (hours < DAY_GRID_START_HOUR || hours > DAY_GRID_END_HOUR) {
        setCurrentTimelineOffsetPx(null);
        setCurrentTimelineLabel("");
        return;
      }
      const relativeHour = hours + minutes / 60 - DAY_GRID_START_HOUR;
      setCurrentTimelineOffsetPx(Math.max(0, relativeHour * DAY_GRID_SLOT_HEIGHT_PX));
      setCurrentTimelineLabel(
        now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      );
    };

    updateTimeline();
    const timer = setInterval(updateTimeline, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (view === "patient") {
      setIsSidebarExpanded(false);
    }
  }, [view]);

  useEffect(() => {
    const fetchFinancialSurvey = async () => {
      if (activeTab !== "financial" || !canAccessClinicFinance) return;
      try {
        const response = await fetch("/api/financial/feature-survey", {
          credentials: "include",
        });
        const result = await response.json();
        if (result?.success && result?.submitted) {
          setFinancialSurveySubmitted(true);
          setFinancialSurveySelected(result.data?.selected_features || []);
          setFinancialSurveyNotes(result.data?.notes || "");
        }
      } catch (error) {
        console.warn("Falha ao carregar pesquisa financeira.");
      }
    };
    fetchFinancialSurvey();
  }, [activeTab, canAccessClinicFinance]);

  const handleAddPayment = async () => {
    if (!selectedPaymentPatient || !paymentAmount)
      return alert("Preencha todos os campos");
    const normalizedAmount = parseMoneyInput(paymentAmount);
    const additionalAmount = parseMoneyInput(paymentAdditionalAmount);
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return alert("Informe um valor válido.");
    }

    if (editingPayment?.id) {
      const targets = editingPaymentScope === "future"
        ? getFutureSeriesItems(payments, editingPayment)
        : [editingPayment];
      const patch = {
        amount: normalizedAmount + additionalAmount,
        base_amount: normalizedAmount,
        additional_amount: additionalAmount,
        additional_scope: additionalAmount > 0 ? paymentAdditionalScope : null,
        payment_date: paymentDate,
        due_date: paymentDueDate || paymentDate,
        method: paymentMethod,
        status: paymentReceipt ? "paid" : editingPayment?.status || "pending",
        receipt_url: paymentReceipt,
        receipt_file_name: paymentReceiptName || null,
        type: paymentType,
        insurance_name: paymentType === "convênio" ? paymentInsurance : null,
        specialty: paymentSpecialty || null,
      };
      const results = await Promise.all(targets.map((payment: any) => dataService.updatePayment(String(payment.id), patch)));
      const failed = results.find((result) => !result?.success);
      if (failed) {
        showToast(failed?.error || "Não foi possível editar o pagamento.", "error");
        return;
      }
      setPayments((prev) =>
        prev.map((payment: any) =>
          targets.some((target: any) => String(target.id) === String(payment.id))
            ? { ...payment, ...patch }
            : payment,
        ),
      );
      setIsPaymentModalOpen(false);
      setEditingPayment(null);
      setPaymentAdditionalAmount("");
      showToast(editingPaymentScope === "future" ? "Pagamentos futuros atualizados." : "Pagamento atualizado.");
      return;
    }

    const dueDays = parseDueDays(paymentRecurrenceDueDays, paymentDueDate || paymentDate);
    const dueDates = paymentIsRecurring
      ? buildMonthlyDueDates(paymentDueDate || paymentDate, dueDays, Number(paymentRecurrenceMonths) || 1)
      : [paymentDueDate || paymentDate];
    const recurrenceGroupId = paymentIsRecurring ? createFinancialSeriesId() : null;
    const paymentsToCreate = dueDates.map((dueDate, index) => {
      const shouldApplyAdditional =
        additionalAmount > 0 &&
        (paymentAdditionalScope === "future" || index === 0);
      return {
        patient_id: selectedPaymentPatient.id,
        patient_name: selectedPaymentPatient.name,
        amount: normalizedAmount + (shouldApplyAdditional ? additionalAmount : 0),
        base_amount: normalizedAmount,
        additional_amount: shouldApplyAdditional ? additionalAmount : 0,
        additional_scope: additionalAmount > 0 ? paymentAdditionalScope : null,
        payment_date: index === 0 ? paymentDate : dueDate,
        due_date: dueDate,
        method: paymentMethod,
        status: index === 0 && paymentReceipt ? "paid" : "pending",
        receipt_url: index === 0 ? paymentReceipt : null,
        receipt_file_name: index === 0 ? paymentReceiptName || null : null,
        type: paymentType,
        insurance_name: paymentType === "convênio" ? paymentInsurance : null,
        specialty: paymentSpecialty || null,
        is_recurring: paymentIsRecurring,
        recurrence_group_id: recurrenceGroupId,
        recurrence_index: index + 1,
        recurrence_total: dueDates.length,
        recurrence_frequency: paymentIsRecurring ? "monthly" : null,
      };
    });

    const results = await Promise.all(paymentsToCreate.map((payment) => dataService.savePayment(payment)));
    const failed = results.find((result) => !result?.success);
    if (!failed) {
      setPayments((prev) => [
        ...results.map((result, index) => result.data || paymentsToCreate[index]),
        ...prev,
      ]);
      setIsPaymentModalOpen(false);
      setEditingPayment(null);
      setPaymentAmount("");
      setSelectedPaymentPatient(null);
      setPaymentReceipt(null);
      setPaymentReceiptName("");
      setPaymentSpecialty("");
      setPaymentIsRecurring(false);
      setPaymentRecurrenceDueDays("");
      setPaymentAdditionalAmount("");
      setPaymentAdditionalScope("next");
      alert(paymentReceipt ? "Pagamento registrado como pago." : "Cobrança registrada como pendente.");
      onAddActivityLog(
        paymentReceipt ? "Pagamento registrado" : "Cobrança registrada",
        `${paymentReceipt ? "Pagamento" : "Cobrança"} de R$ ${formatMoneyInput(paymentAmount)} para ${selectedPaymentPatient?.name || "paciente"}${paymentIsRecurring ? ` em ${dueDates.length} vencimentos recorrentes` : ""}.`,
        "management",
      );
    } else {
      alert("Erro ao salvar pagamento.");
    }
  };

  const handleAttachPaymentReceipt = async (payment: any, file: File | null | undefined) => {
    if (!payment?.id || !file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const receiptUrl = String(reader.result || "");
      if (!receiptUrl) return;
      const result = await dataService.updatePayment(String(payment.id), {
        receipt_url: receiptUrl,
        receipt_file_name: file.name,
        receipt_content_type: file.type || "application/octet-stream",
        status: "paid",
        payment_date: payment.payment_date || new Date().toISOString().slice(0, 10),
      });
      if (result?.success) {
        const updatedPayment = result.data || {
          ...payment,
          receipt_url: receiptUrl,
          receipt_file_name: file.name,
          status: "paid",
        };
        setPayments((prev) =>
          prev.map((item: any) => (String(item.id) === String(payment.id) ? updatedPayment : item)),
        );
        showToast("Comprovante anexado e pagamento marcado como pago.");
      } else {
        showToast(result?.error || "Não foi possível anexar o comprovante.", "error");
      }
    };
    reader.readAsDataURL(file);
  };

  const getFutureSeriesItems = (items: any[], current: any) => {
    const groupId = String(current?.recurrence_group_id || current?.recurrenceGroupId || "").trim();
    if (!groupId) return [current];
    const currentDate = String(current?.due_date || current?.dueDate || current?.payment_date || current?.paymentDate || "");
    const currentIndex = Number(current?.recurrence_index ?? current?.recurrenceIndex ?? 0) || 0;
    return items.filter((item: any) => {
      const itemGroupId = String(item?.recurrence_group_id || item?.recurrenceGroupId || "").trim();
      if (itemGroupId !== groupId) return false;
      const itemIndex = Number(item?.recurrence_index ?? item?.recurrenceIndex ?? 0) || 0;
      if (currentIndex > 0 && itemIndex > 0) return itemIndex >= currentIndex;
      const itemDate = String(item?.due_date || item?.dueDate || item?.payment_date || item?.paymentDate || "");
      return itemDate >= currentDate;
    });
  };

  const openPaymentEditor = (payment: any) => {
    const patient = allPatients.find((item: any) => String(item.id) === String(payment?.patient_id || payment?.patientId));
    setEditingPayment(payment);
    setEditingPaymentScope("single");
    setSelectedPaymentPatient(patient || {
      id: payment?.patient_id || payment?.patientId,
      name: payment?.patient_name || payment?.patientName || "Paciente",
    });
    setPaymentAmount(formatMoneyInput(payment?.amount));
    setPaymentDate(String(payment?.payment_date || payment?.paymentDate || new Date().toISOString().slice(0, 10)).slice(0, 10));
    setPaymentDueDate(String(payment?.due_date || payment?.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10));
    setPaymentMethod(payment?.method || "pix");
    setPaymentType(payment?.type || "particular");
    setPaymentInsurance(payment?.insurance_name || payment?.insuranceName || "");
    setPaymentSpecialty(payment?.specialty || "");
    setPaymentReceipt(payment?.receipt_url || null);
    setPaymentReceiptName(payment?.receipt_file_name || "");
    setPaymentIsRecurring(Boolean(payment?.is_recurring || payment?.isRecurring || payment?.recurrence_group_id || payment?.recurrenceGroupId));
    setPaymentAdditionalAmount(formatMoneyInput(payment?.additional_amount || ""));
    setPaymentAdditionalScope(payment?.additional_scope === "future" ? "future" : "next");
    setIsPaymentModalOpen(true);
  };

  const openProfessionalPaymentEditor = (payment: any) => {
    setEditingProfessionalPayment(payment);
    setEditingProfessionalPaymentScope("single");
    setSelectedProfessionalPaymentId(String(payment?.professional_id || payment?.professionalId || ""));
    setProfessionalPaymentAmount(formatMoneyInput(payment?.amount));
    setProfessionalPaymentDate(String(payment?.payment_date || payment?.paymentDate || new Date().toISOString().slice(0, 10)).slice(0, 10));
    setProfessionalPaymentDueDate(String(payment?.due_date || payment?.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10));
    setProfessionalPaymentMethod(payment?.method || "pix");
    setProfessionalPaymentStatus(payment?.status || "pending");
    setProfessionalPaymentIsRecurring(Boolean(payment?.is_recurring || payment?.isRecurring || payment?.recurrence_group_id || payment?.recurrenceGroupId));
    setProfessionalPaymentAdditionalAmount(formatMoneyInput(payment?.additional_amount || ""));
    setProfessionalPaymentAdditionalScope(payment?.additional_scope === "future" ? "future" : "next");
    setIsProfessionalPaymentModalOpen(true);
  };

  const handleAddProfessionalPayment = async () => {
    const member = therapistFilterOptions.find((item) => item.id === selectedProfessionalPaymentId);
    const amount = parseMoneyInput(professionalPaymentAmount);
    const additionalAmount = parseMoneyInput(professionalPaymentAdditionalAmount);
    if (!member || !Number.isFinite(amount) || amount <= 0) {
      alert("Selecione o profissional e informe um valor válido.");
      return;
    }
    if (editingProfessionalPayment?.id) {
      const targets = editingProfessionalPaymentScope === "future"
        ? getFutureSeriesItems(professionalPayments, editingProfessionalPayment)
        : [editingProfessionalPayment];
      const patch = {
        professional_id: member.id,
        professional_name: member.label,
        specialty: member.specialty || editingProfessionalPayment?.specialty || null,
        amount: amount + additionalAmount,
        base_amount: amount,
        additional_amount: additionalAmount,
        additional_scope: additionalAmount > 0 ? professionalPaymentAdditionalScope : null,
        payment_date: professionalPaymentDate,
        due_date: professionalPaymentDueDate || professionalPaymentDate,
        method: professionalPaymentMethod,
        status: professionalPaymentStatus,
      };
      const results = await Promise.all(targets.map((payment: any) =>
        dataService.updateProfessionalPayment(String(payment.id), patch),
      ));
      const failed = results.find((result) => !result?.success);
      if (failed) {
        showToast(failed?.error || "Não foi possível editar o pagamento profissional.", "error");
        return;
      }
      setProfessionalPayments((prev) =>
        prev.map((payment: any) =>
          targets.some((target: any) => String(target.id) === String(payment.id))
            ? { ...payment, ...patch }
            : payment,
        ),
      );
      setIsProfessionalPaymentModalOpen(false);
      setEditingProfessionalPayment(null);
      setProfessionalPaymentAdditionalAmount("");
      showToast(editingProfessionalPaymentScope === "future" ? "Pagamentos profissionais futuros atualizados." : "Pagamento profissional atualizado.");
      return;
    }
    const dueDays = parseDueDays(professionalPaymentRecurrenceDueDays, professionalPaymentDueDate || professionalPaymentDate);
    const dueDates = professionalPaymentIsRecurring
      ? buildMonthlyDueDates(professionalPaymentDueDate || professionalPaymentDate, dueDays, Number(professionalPaymentRecurrenceMonths) || 1)
      : [professionalPaymentDueDate || professionalPaymentDate];
    const recurrenceGroupId = professionalPaymentIsRecurring ? createFinancialSeriesId() : null;
    const payloads = dueDates.map((dueDate, index) => {
      const shouldApplyAdditional =
        additionalAmount > 0 &&
        (professionalPaymentAdditionalScope === "future" || index === 0);
      return {
        professional_id: member.id,
        professional_name: member.label,
        specialty: member.specialty || null,
        amount: amount + (shouldApplyAdditional ? additionalAmount : 0),
        base_amount: amount,
        additional_amount: shouldApplyAdditional ? additionalAmount : 0,
        additional_scope: additionalAmount > 0 ? professionalPaymentAdditionalScope : null,
        payment_date: index === 0 ? professionalPaymentDate : dueDate,
        due_date: dueDate,
        method: professionalPaymentMethod,
        status: index === 0 ? professionalPaymentStatus : "pending",
        is_recurring: professionalPaymentIsRecurring,
        recurrence_group_id: recurrenceGroupId,
        recurrence_index: index + 1,
        recurrence_total: dueDates.length,
        recurrence_frequency: professionalPaymentIsRecurring ? "monthly" : null,
      };
    });
    const results = await Promise.all(payloads.map((payload) => dataService.saveProfessionalPayment(payload)));
    const failed = results.find((result) => !result?.success);
    if (!failed) {
      setProfessionalPayments((prev) => [
        ...results.map((result, index) => result.data || payloads[index]),
        ...prev,
      ]);
      setIsProfessionalPaymentModalOpen(false);
      setSelectedProfessionalPaymentId("");
      setProfessionalPaymentAmount("");
      setProfessionalPaymentStatus("pending");
      setProfessionalPaymentIsRecurring(false);
      setProfessionalPaymentRecurrenceDueDays("");
      setProfessionalPaymentAdditionalAmount("");
      setProfessionalPaymentAdditionalScope("next");
      showToast(professionalPaymentIsRecurring ? "Pagamentos profissionais recorrentes registrados." : "Pagamento profissional registrado.");
    } else {
      showToast(failed?.error || "Não foi possível salvar o pagamento profissional.", "error");
    }
  };

  const handleSubmitFinancialSurvey = async () => {
    if (financialSurveySelected.length === 0) {
      alert("Selecione ao menos uma opção para enviar a pesquisa.");
      return;
    }

    try {
      const response = await fetch("/api/financial/feature-survey", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedFeatures: financialSurveySelected,
          notes: financialSurveyNotes,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Não foi possível enviar a pesquisa.");
      }
      setFinancialSurveySubmitted(true);
      onAddActivityLog(
        "Pesquisa do financeiro enviada",
        "A clínica enviou as preferências do módulo financeiro.",
        "management",
      );
      alert("Pesquisa enviada com sucesso. Obrigado pelo feedback!");
    } catch (error: any) {
      alert(error.message || "Falha ao enviar pesquisa.");
    }
  };

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(themeStorageKey);
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
      return;
    }
    const legacy = localStorage.getItem("verto_theme");
    if (legacy === "dark" || legacy === "light") {
      setTheme(legacy);
    }
  }, [themeStorageKey]);

  useEffect(() => {
    document.body.classList.toggle("theme-dark", theme === "dark");
    localStorage.setItem(themeStorageKey, theme);
    localStorage.setItem("verto_theme", theme);
  }, [theme, themeStorageKey]);

  const normalizeUtf8Text = (value: any) => String(value ?? "").normalize("NFC");
  const repairMojibakeText = (value: any) => {
    const text = normalizeUtf8Text(value ?? "");
    if (!text) return "";
    const replacements: Array<[string, string]> = [
      ["Ã§", "ç"], ["Ã£", "ã"], ["Ã¡", "á"], ["Ã ", "à"], ["Ã¢", "â"], ["Ãª", "ê"],
      ["Ã©", "é"], ["Ã­", "í"], ["Ã³", "ó"], ["Ã´", "ô"], ["Ãµ", "õ"], ["Ãº", "ú"],
      ["Â ", " "], ["â€“", "–"], ["â€”", "—"], ["â€˜", "‘"], ["â€™", "’"], ["â€œ", "“"], ["â€", "”"],
      ["Ã", "Á"], ["Ã‰", "É"], ["Ã“", "Ó"], ["Ãš", "Ú"], ["Ã‡", "Ç"], ["Ãƒ", "Ã"],
    ];
    return replacements.reduce((acc, [from, to]) => acc.split(from).join(to), text);
  };

  const normalizedPlanName = (() => {
    const raw = normalizeUtf8Text(user?.planName || "").trim();
    if (!raw || raw === "Verto Pro" || raw === "Plano Pro" || raw === "Pro") {
      return "Essencial";
    }
    return raw;
  })();

  const normalizePayerLookup = (value: any) =>
    normalizeUtf8Text(String(value ?? ""))
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const getPatientAutoPayerKey = (patient: any, fallbackName = "") =>
    normalizePayerLookup(patient?.id || patient?.patient_id || fallbackName || patient?.name);

  const normalizeBillingServiceMatchKey = (value: any) => {
    const raw = normalizePayerLookup(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const aliases: Record<string, string> = {
      aba: "ABA",
      fono: "SPEECH_THERAPY",
      fonoaudiologia: "SPEECH_THERAPY",
      speech_therapy: "SPEECH_THERAPY",
      psicologia: "PSYCHOLOGY",
      psychology: "PSYCHOLOGY",
      terapia_ocupacional: "OCCUPATIONAL_THERAPY",
      occupational_therapy: "OCCUPATIONAL_THERAPY",
      to: "OCCUPATIONAL_THERAPY",
      psicopedagogia: "PSYCHOPEDAGOGY",
      physiotherapy: "PHYSIOTHERAPY",
      fisioterapia: "PHYSIOTHERAPY",
      therapy: "THERAPY",
      terapia: "THERAPY",
    };
    return aliases[raw] || raw.toUpperCase();
  };

  const financialPlanMatchesAppointmentService = (plan: any, serviceType: any) => {
    const serviceKey = normalizeBillingServiceMatchKey(serviceType);
    if (!serviceKey) return false;
    return [
      plan?.serviceType,
      plan?.service_type,
      plan?.customServiceName,
      plan?.custom_service_name,
      plan?.serviceNameSnapshot,
      plan?.service_name_snapshot,
    ]
      .map(normalizeBillingServiceMatchKey)
      .filter(Boolean)
      .includes(serviceKey);
  };

  const resolvePatientInsurancePayer = (patient: any, serviceType: any = "") => {
    if (!patient) return { payerId: "", payerName: "" };
    const plans = normalizePatientFinancialPlans(
      Array.isArray(patient?.financialPlans)
        ? patient.financialPlans
        : Array.isArray(patient?.financial_plans)
          ? patient.financial_plans
          : [],
    );
    const insurancePlans = plans.filter(
      (plan: any) =>
        plan?.billingMode === "INSURANCE" &&
        String(plan?.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
        (String(plan?.payerId || "").trim() ||
          String(plan?.payerNameSnapshot || "").trim()),
    );
    const matchingPlans = serviceType
      ? insurancePlans.filter((plan: any) => financialPlanMatchesAppointmentService(plan, serviceType))
      : [];
    const insurancePlan =
      matchingPlans.length === 1
        ? matchingPlans[0]
        : !serviceType && insurancePlans.length === 1
          ? insurancePlans[0]
          : null;
    const planPayerId = String(insurancePlan?.payerId || "").trim();
    const planPayerName = normalizeUtf8Text(
      String(
        insurancePlan?.payerNameSnapshot ||
          insurancePlan?.insuranceName ||
          "",
      ),
    ).trim();
    if (planPayerId || planPayerName) {
      return { payerId: planPayerId, payerName: planPayerName };
    }

    const insuranceType = normalizePayerLookup(
      patient?.insuranceType ||
        patient?.insurance_type ||
        patient?.convenioTipo ||
        patient?.anamnesisData?.convenioTipo,
    );
    const insuranceName = normalizeUtf8Text(
      String(
        patient?.insuranceName ||
          patient?.insurance_name ||
          patient?.convenioNome ||
          patient?.anamnesisData?.convenioNome ||
          "",
      ),
    ).trim();
    if (!insuranceName || insuranceType === "particular" || insuranceType === "private") {
      return { payerId: "", payerName: "" };
    }
    return { payerId: "", payerName: insuranceName };
  };

  const resolveClinicPayerForPatientInsurance = (patientPayer: any) => {
    const payerId = String(patientPayer?.payerId || "").trim();
    const payerNameKey = normalizePayerLookup(patientPayer?.payerName);
    return (
      clinicPayers.find((payer: any) => payerId && String(payer?.id || "") === payerId) ||
      clinicPayers.find((payer: any) => payerNameKey && normalizePayerLookup(payer?.name) === payerNameKey) ||
      null
    );
  };

  useEffect(() => {
    if (sessionPatientName && allPatients) {
      const matches = allPatients.filter((p: any) =>
        p.name.toLowerCase().includes(sessionPatientName.toLowerCase()),
      );
      setFilteredPatients(matches);
    } else {
      setFilteredPatients([]);
    }
  }, [sessionPatientName, allPatients]);

  useEffect(() => {
    if (!isAddSessionModalOpen || isTherapist) return;
    let cancelled = false;
    dataService.getPayers({ status: "ACTIVE", limit: 80 }).then((result: any) => {
      if (cancelled) return;
      setClinicPayers(result?.success && Array.isArray(result.data) ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [isAddSessionModalOpen, isTherapist]);

  const selectPatientForSession = (name: string) => {
    const normalizedName = normalizeUtf8Text(name).trim().toLowerCase();
    const patient = allPatients.find(
      (item: any) => normalizeUtf8Text(item?.name).trim().toLowerCase() === normalizedName,
    );
    const patientPayer = resolvePatientInsurancePayer(patient, sessionApproach);
    const matchingPayer = resolveClinicPayerForPatientInsurance(patientPayer);
    lastAutoPayerPatientKeyRef.current = getPatientAutoPayerKey(patient, name);
    setSessionPatientName(name);
    setSessionPayerId(String(matchingPayer?.id || patientPayer.payerId || ""));
    setSessionPayerNameSnapshot(String(matchingPayer?.name || patientPayer.payerName || ""));
    setFilteredPatients([]);
  };

  const activeClinicRooms = useMemo(
    () => (rooms || []).filter((room: any) => room?.is_active !== false && room?.isActive !== false),
    [rooms],
  );

  const sessionDurationMinutes = useMemo(
    () =>
      normalizeDurationMinutes(
        sessionDurationOption === "custom"
          ? sessionCustomDuration
          : sessionDurationOption,
        50,
      ),
    [sessionDurationOption, sessionCustomDuration],
  );

  const sessionEndTime = useMemo(
    () => addMinutesToTime(sessionTime, sessionDurationMinutes),
    [sessionTime, sessionDurationMinutes],
  );

  const selectedSessionPatient = useMemo(() => {
    const normalizedName = normalizeUtf8Text(sessionPatientName).trim().toLowerCase();
    return (
      allPatients.find((patient: any) => normalizeUtf8Text(patient?.name).trim().toLowerCase() === normalizedName) ||
      null
    );
  }, [allPatients, sessionPatientName]);

  const selectedSessionPatientInsurancePayer = useMemo(
    () => resolvePatientInsurancePayer(selectedSessionPatient, sessionApproach),
    [selectedSessionPatient, selectedSessionPatient?.financialPlans, selectedSessionPatient?.financial_plans, sessionApproach],
  );

  const selectedSessionPatientInsuranceClinicPayer = useMemo(
    () => resolveClinicPayerForPatientInsurance(selectedSessionPatientInsurancePayer),
    [
      clinicPayers,
      selectedSessionPatientInsurancePayer.payerId,
      selectedSessionPatientInsurancePayer.payerName,
    ],
  );

  const selectedSessionProfessional = useMemo(() => {
    const normalizedName = normalizeUtf8Text(sessionProfessional).trim();
    return (
      therapistFilterOptions.find((member) => member.label === normalizedName) ||
      therapistFilterOptions.find((member) => String(member.id || "") === normalizedName) ||
      null
    );
  }, [sessionProfessional, therapistFilterOptions]);

  const selectedSessionRoom = useMemo(
    () => activeClinicRooms.find((room: any) => String(room?.id || "") === String(sessionRoom || "")) || null,
    [activeClinicRooms, sessionRoom],
  );

  const selectedSessionPayer = useMemo(
    () => clinicPayers.find((payer: any) => String(payer?.id || "") === String(sessionPayerId || "")) || null,
    [clinicPayers, sessionPayerId],
  );

  const selectedSessionPayerName = selectedSessionPayer?.name || sessionPayerNameSnapshot || "";
  const sessionPayerSelectValue =
    sessionPayerId || (sessionPayerNameSnapshot ? SESSION_PATIENT_INSURANCE_PAYER_VALUE : "");
  const hasSessionPayerIdOption = Boolean(sessionPayerId && !selectedSessionPayer);
  const sessionPayerSnapshotOptionLabel =
    sessionPayerNameSnapshot || selectedSessionPatientInsurancePayer.payerName || "";
  const hasPatientInsuranceSnapshotOption = Boolean(
    sessionPayerSnapshotOptionLabel &&
      !sessionPayerId &&
      !clinicPayers.some(
        (payer: any) => normalizePayerLookup(payer?.name) === normalizePayerLookup(sessionPayerSnapshotOptionLabel),
      ),
  );

  const handleSessionPayerChange = (value: string) => {
    lastAutoPayerPatientKeyRef.current = getPatientAutoPayerKey(selectedSessionPatient, sessionPatientName);
    if (value === SESSION_PATIENT_INSURANCE_PAYER_VALUE) {
      setSessionPayerId("");
      setSessionPayerNameSnapshot(sessionPayerSnapshotOptionLabel);
      return;
    }
    const payer = clinicPayers.find((item: any) => String(item?.id || "") === String(value || ""));
    setSessionPayerId(value);
    setSessionPayerNameSnapshot(payer?.name || "");
  };

  useEffect(() => {
    if (!isAddSessionModalOpen || editingAppointmentId) return;
    const patientPayer = selectedSessionPatientInsurancePayer;
    const matchingPayer = selectedSessionPatientInsuranceClinicPayer;
    const patientKey = getPatientAutoPayerKey(selectedSessionPatient, sessionPatientName);
    const nextPayerId = String(matchingPayer?.id || patientPayer.payerId || "");
    const nextPayerName = String(matchingPayer?.name || patientPayer.payerName || "");
    if (!nextPayerId && !nextPayerName) return;

    if (!sessionPayerId && !sessionPayerNameSnapshot) {
      if (patientKey && lastAutoPayerPatientKeyRef.current === patientKey) return;
      lastAutoPayerPatientKeyRef.current = patientKey;
      setSessionPayerId(nextPayerId);
      setSessionPayerNameSnapshot(nextPayerName);
      return;
    }

    const currentSnapshotMatchesPatient =
      normalizePayerLookup(sessionPayerNameSnapshot) === normalizePayerLookup(patientPayer.payerName);
    if (!sessionPayerId && matchingPayer?.id && currentSnapshotMatchesPatient) {
      setSessionPayerId(String(matchingPayer.id));
      setSessionPayerNameSnapshot(String(matchingPayer.name || patientPayer.payerName || ""));
    }
  }, [
    clinicPayers,
    editingAppointmentId,
    isAddSessionModalOpen,
    selectedSessionPatient,
    selectedSessionPatientInsuranceClinicPayer,
    selectedSessionPatientInsurancePayer,
    sessionPatientName,
    sessionPayerId,
    sessionPayerNameSnapshot,
  ]);

  const sessionRecurrenceDates = useMemo(
    () =>
      buildRecurrenceDateKeys({
        startDate: sessionDate,
        count: editingAppointmentId ? 1 : sessionNumSessions,
        pattern: sessionRecurrencePattern,
      }),
    [editingAppointmentId, sessionDate, sessionNumSessions, sessionRecurrencePattern],
  );

  const requiredSessionFieldsReady = Boolean(
    sessionPatientName.trim() &&
      sessionDate &&
      sessionTime &&
      sessionApproach &&
      sessionProfessional &&
      sessionDurationMinutes >= 15 &&
      (sessionLocationType !== "clinica" || sessionRoom),
  );

  useEffect(() => {
    if (!isAddSessionModalOpen) return;
    if (!sessionPatientName || !sessionDate || !sessionTime || !sessionApproach || !sessionProfessional) {
      setScheduleConflictState({ loading: false, checked: false, blocking: false, message: "", conflicts: [] });
      return;
    }
    if (sessionLocationType === "clinica" && !sessionRoom) {
      setScheduleConflictState({
        loading: false,
        checked: true,
        blocking: true,
        message: "Selecione uma sala da clínica para este atendimento.",
        conflicts: [],
      });
      return;
    }

    const localResult = checkLocalScheduleConflicts({
      appointments: therapistAgenda,
      patient_id: selectedSessionPatient?.id,
      patient_name: sessionPatientName,
      professional_ids: selectedSessionProfessional?.id ? [selectedSessionProfessional.id] : [],
      professional_names: sessionProfessional ? [sessionProfessional] : [],
      room_id: sessionLocationType === "clinica" ? sessionRoom : "",
      room_name: selectedSessionRoom?.name || sessionRoom,
      location_type: sessionLocationType,
      date: sessionDate,
      start_time: sessionTime,
      end_time: sessionEndTime,
      duration_minutes: sessionDurationMinutes,
      exclude_event_id: editingAppointmentId,
      recurrence_dates: sessionRecurrenceDates,
    });
    setScheduleConflictState({
      loading: true,
      checked: true,
      blocking: localResult.blocking,
      message: localResult.humanMessage,
      conflicts: localResult.conflicts,
    });

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await dataService.checkScheduleConflicts({
          patient_id: selectedSessionPatient?.id,
          patient_name: sessionPatientName,
          professional_ids: selectedSessionProfessional?.id ? [selectedSessionProfessional.id] : [],
          professional_names: sessionProfessional ? [sessionProfessional] : [],
          room_id: sessionLocationType === "clinica" ? sessionRoom : null,
          room_name: selectedSessionRoom?.name || sessionRoom,
          location_type: sessionLocationType,
          date: sessionDate,
          start_time: sessionTime,
          end_time: sessionEndTime,
          duration_minutes: sessionDurationMinutes,
          exclude_event_id: editingAppointmentId,
          recurrence_dates: sessionRecurrenceDates,
        });
        if (cancelled) return;
        const serverResult = result?.success === false ? null : result?.data || result;
        if (!serverResult) {
          setScheduleConflictState((prev) => ({ ...prev, loading: false }));
          return;
        }
        setScheduleConflictState({
          loading: false,
          checked: true,
          blocking: Boolean(serverResult.blocking),
          message: serverResult.humanMessage || (serverResult.hasConflict ? "Conflito encontrado." : "Horário disponível."),
          conflicts: Array.isArray(serverResult.conflicts) ? serverResult.conflicts : [],
        });
      } catch (error) {
        if (!cancelled) {
          setScheduleConflictState((prev) => ({ ...prev, loading: false }));
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    editingAppointmentId,
    isAddSessionModalOpen,
    selectedSessionPatient?.id,
    selectedSessionProfessional?.id,
    selectedSessionRoom?.name,
    sessionApproach,
    sessionDate,
    sessionDurationMinutes,
    sessionEndTime,
    sessionLocationType,
    sessionPatientName,
    sessionProfessional,
    sessionRecurrenceDates.join("|"),
    sessionRoom,
    sessionTime,
    therapistAgenda,
  ]);

  const resetSessionForm = () => {
    lastAutoPayerPatientKeyRef.current = "";
    setSessionPatientName("");
    setSessionTime("08:00");
    setSessionDurationOption("50");
    setSessionCustomDuration("50");
    setSessionLocationType("clinica");
    setSessionRoom("");
    setSessionLocationNotes("");
    setSessionCallLink("");
    setSessionApproach("");
    setSessionProfessional("");
    setSessionPayerId("");
    setSessionPayerNameSnapshot("");
    setSessionGuideNumber("");
    setSessionAuthorizationCode("");
    setSessionNumSessions(1);
    setSessionRecurrencePattern("weekly");
    setEditingAppointmentId(null);
    setAppointmentEditScope("single");
    setScheduleConflictState({ loading: false, checked: false, blocking: false, message: "", conflicts: [] });
  };

  const editingAppointment = useMemo(
    () =>
      editingAppointmentId === null
        ? null
        : therapistAgenda.find(
            (appointment: any) =>
              String(appointment?.id) === String(editingAppointmentId),
          ) || null,
    [editingAppointmentId, therapistAgenda],
  );
  const isEditingRecurringAppointment = Boolean(
    editingAppointment &&
      (editingAppointment.isRecurring ||
        editingAppointment.is_recurring ||
        editingAppointment.recurrenceGroupId ||
        editingAppointment.recurrence_group_id),
  );

  const openNewAppointmentAt = (date: string, time = "08:00") => {
    resetSessionForm();
    setSessionDate(date);
    setSessionTime(time);
    setIsDayDetailsModalOpen(false);
    setIsAddSessionModalOpen(true);
  };

  const handleSessionSubmit = async () => {
    if (!requiredSessionFieldsReady) {
      showToast("Preencha paciente, data, horário, duração, tipo, profissional e sala quando o local for clínica.", "error");
      return;
    }
    if (scheduleConflictState.blocking) {
      showToast(scheduleConflictState.message || "Existe conflito bloqueante nesse horário.", "error");
      return;
    }
    showProcessing(
      editingAppointmentId ? "Salvando agendamento..." : "Criando agendamento...",
    );

    const getBulkEditExcludedAppointmentIds = () => {
      if (!editingAppointmentId) return [];
      if (!isEditingRecurringAppointment || appointmentEditScope !== "future") {
        return [String(editingAppointmentId)];
      }
      const recurrenceGroupId = String(
        editingAppointment?.recurrenceGroupId || editingAppointment?.recurrence_group_id || "",
      ).trim();
      const currentIndex =
        Number(editingAppointment?.recurrenceIndex ?? editingAppointment?.recurrence_index ?? 0) || 0;
      const getOccurrenceTime = (appointment: any) => {
        const scheduledAt = appointment?.scheduledAt || appointment?.scheduled_at;
        const parsedScheduledAt = scheduledAt ? new Date(scheduledAt).getTime() : Number.NaN;
        if (!Number.isNaN(parsedScheduledAt)) return parsedScheduledAt;
        const date = String(appointment?.date || "").trim();
        const time = String(appointment?.time || "").trim();
        const parsedDateTime = date && time ? new Date(`${date}T${time}:00`).getTime() : Number.NaN;
        return Number.isNaN(parsedDateTime) ? Number.POSITIVE_INFINITY : parsedDateTime;
      };
      const currentOccurrenceTime = getOccurrenceTime(editingAppointment);
      return therapistAgenda
        .filter((appointment: any) => {
          if (String(appointment?.id || "") === String(editingAppointmentId)) return true;
          if (!recurrenceGroupId) return false;
          const appointmentGroupId = String(
            appointment?.recurrenceGroupId || appointment?.recurrence_group_id || "",
          ).trim();
          if (appointmentGroupId !== recurrenceGroupId) return false;
          const appointmentIndex = Number(appointment?.recurrenceIndex ?? appointment?.recurrence_index ?? 0) || 0;
          if (currentIndex > 0 && appointmentIndex > 0) {
            return appointmentIndex >= currentIndex;
          }
          return getOccurrenceTime(appointment) >= currentOccurrenceTime;
        })
        .map((appointment: any) => String(appointment?.id || "").trim())
        .filter(Boolean);
    };
    const conflictExcludeEventIds = getBulkEditExcludedAppointmentIds();

    const serverConflict = await dataService.checkScheduleConflicts({
      patient_id: selectedSessionPatient?.id,
      patient_name: sessionPatientName,
      professional_ids: selectedSessionProfessional?.id ? [selectedSessionProfessional.id] : [],
      professional_names: sessionProfessional ? [sessionProfessional] : [],
      room_id: sessionLocationType === "clinica" ? sessionRoom : null,
      room_name: selectedSessionRoom?.name || sessionRoom,
      location_type: sessionLocationType,
      date: sessionDate,
      start_time: sessionTime,
      end_time: sessionEndTime,
      duration_minutes: sessionDurationMinutes,
      exclude_event_id: editingAppointmentId,
      exclude_event_ids: conflictExcludeEventIds,
      recurrence_dates: sessionRecurrenceDates,
    });
    const conflictPayload = serverConflict?.data || serverConflict;
    if (conflictPayload?.blocking) {
      hideProcessing();
      showToast(conflictPayload.humanMessage || "Conflito encontrado nesse horário.", "error");
      return;
    }

    if (editingAppointmentId) {
      const updates = {
        name: sessionPatientName,
        patientName: sessionPatientName,
        patientId: selectedSessionPatient?.id,
        patient_id: selectedSessionPatient?.id,
        date: sessionDate,
        time: sessionTime,
        type: sessionApproach || "Consulta Padrão",
        approach: sessionApproach || "Consulta Padrão",
        durationMinutes: sessionDurationMinutes,
        duration_minutes: sessionDurationMinutes,
        scheduledDurationMinutes: sessionDurationMinutes,
        scheduled_duration_minutes: sessionDurationMinutes,
        locationType: sessionLocationType,
        location_type: sessionLocationType,
        room: sessionLocationType === "clinica" ? sessionRoom : "",
        roomId: sessionLocationType === "clinica" ? sessionRoom : "",
        room_id: sessionLocationType === "clinica" ? sessionRoom : "",
        roomName: sessionLocationType === "clinica" ? selectedSessionRoom?.name || sessionRoom : "",
        room_name: sessionLocationType === "clinica" ? selectedSessionRoom?.name || sessionRoom : "",
        roomSpecialties: sessionLocationType === "clinica" ? selectedSessionRoom?.specialties || [] : [],
        room_specialties: sessionLocationType === "clinica" ? selectedSessionRoom?.specialties || [] : [],
        locationNotes: sessionLocationNotes,
        location_notes: sessionLocationNotes,
        callLink: sessionCallLink,
        call_link: sessionCallLink,
        payerId: sessionPayerId || null,
        payer_id: sessionPayerId || null,
        payerName: selectedSessionPayerName,
        payer_name_snapshot: selectedSessionPayerName,
        guideNumber: sessionGuideNumber,
        guide_number: sessionGuideNumber,
        authorizationCode: sessionAuthorizationCode,
        authorization_code: sessionAuthorizationCode,
        professional: sessionProfessional,
        professionalId: selectedSessionProfessional?.id,
        professional_id: selectedSessionProfessional?.id,
        therapistId: selectedSessionProfessional?.id,
        therapist_id: selectedSessionProfessional?.id,
        therapistName: sessionProfessional,
        therapist_name: sessionProfessional,
        recurrencePattern: sessionRecurrencePattern,
        recurrenceScope: isEditingRecurringAppointment
          ? appointmentEditScope
          : "single",
      };
      const result: any = onUpdateAppointment(editingAppointmentId, updates);
      if (result && !result.success) {
        hideProcessing();
        showToast(result.errors.join(" | "), "error");
        return;
      }
      onAddActivityLog(
        "Agendamento editado",
        isEditingRecurringAppointment && appointmentEditScope === "future"
          ? `Série recorrente de ${sessionPatientName} atualizada a partir de ${sessionDate} às ${sessionTime}.`
          : `Sessão de ${sessionPatientName} atualizada para ${sessionDate} às ${sessionTime}.`,
        "management",
      );
      if (sessionPayerId || selectedSessionPayerName || sessionGuideNumber || sessionAuthorizationCode) {
        void dataService.updateAppointmentBillingContext(String(editingAppointmentId), {
          payerId: sessionPayerId || null,
          payerName: selectedSessionPayerName,
          serviceType: sessionApproach || "Consulta Padrão",
          guideNumber: sessionGuideNumber,
          authorizationCode: sessionAuthorizationCode,
        });
      }
      setIsAddSessionModalOpen(false);
      resetSessionForm();
      hideProcessing();
      showToast("Dados salvos com sucesso!");
      return;
    }

    const newSession = {
      patientName: sessionPatientName,
      date: sessionDate,
      time: sessionTime,
      approach: sessionApproach || "Consulta Padrão",
      durationMinutes: sessionDurationMinutes,
      duration_minutes: sessionDurationMinutes,
      locationType: sessionLocationType,
      location_type: sessionLocationType,
      room: sessionLocationType === "clinica" ? sessionRoom : "",
      roomId: sessionLocationType === "clinica" ? sessionRoom : "",
      room_id: sessionLocationType === "clinica" ? sessionRoom : "",
      roomName: sessionLocationType === "clinica" ? selectedSessionRoom?.name || sessionRoom : "",
      room_name: sessionLocationType === "clinica" ? selectedSessionRoom?.name || sessionRoom : "",
      roomSpecialties: sessionLocationType === "clinica" ? selectedSessionRoom?.specialties || [] : [],
      room_specialties: sessionLocationType === "clinica" ? selectedSessionRoom?.specialties || [] : [],
      locationNotes: sessionLocationNotes,
      location_notes: sessionLocationNotes,
      callLink: sessionCallLink,
      call_link: sessionCallLink,
      payerId: sessionPayerId || null,
      payer_id: sessionPayerId || null,
      payerName: selectedSessionPayerName,
      payer_name_snapshot: selectedSessionPayerName,
      guideNumber: sessionGuideNumber,
      guide_number: sessionGuideNumber,
      authorizationCode: sessionAuthorizationCode,
      authorization_code: sessionAuthorizationCode,
      professional: sessionProfessional,
      professionalName: sessionProfessional,
      professionalId: selectedSessionProfessional?.id,
      professional_id: selectedSessionProfessional?.id,
      therapistId: selectedSessionProfessional?.id,
      therapist_id: selectedSessionProfessional?.id,
      numSessions: Math.min(52, Math.max(1, Number(sessionNumSessions) || 1)),
      recurrencePattern: sessionRecurrencePattern,
    };
    const result = onScheduleSession(newSession);
    if (result && !result.success) {
      hideProcessing();
      showToast(result.errors.join(" | "), "error");
      return;
    }
    onAddActivityLog(
      "Agendamento criado",
      Number(newSession.numSessions) > 1
        ? `${newSession.numSessions} sessões semanais agendadas para ${sessionPatientName} a partir de ${sessionDate} às ${sessionTime}.`
        : `Nova sessão agendada para ${sessionPatientName} em ${sessionDate} às ${sessionTime}.`,
      "management",
    );

    setIsAddSessionModalOpen(false);
    resetSessionForm();
    hideProcessing();
    showToast(
      Number(newSession.numSessions) > 1
        ? "Agendamentos recorrentes criados com sucesso!"
        : "Agendamento criado com sucesso!",
    );
  };

  const handleQuickRegister = async () => {
    if (!canCreatePatients) {
      showToast("A criação de pacientes é exclusiva da recepção e coordenação.", "error");
      return;
    }
    if (!quickPatientName) {
      showToast("Nome é obrigatório.", "error");
      return;
    }
    showProcessing("Cadastrando paciente...");

    const newPatient = {
      id: Date.now(),
      name: quickPatientName,
      email: quickPatientEmail,
      phone: quickPatientPhone,
      age: quickPatientAge ? parseInt(quickPatientAge) : undefined,
      anamnesisPending: true,
      lastAnamnesisAt: null,
      patientProfileType: "ADULT",
      panelType: "ADULT",
      type: "adult_conventional",
      createdAt: new Date().toISOString(),
    };

    try {
      const addResult = await onAddPatient(newPatient);
      if (addResult?.success === false) {
        showToast(String(addResult?.error || "Não foi possível cadastrar paciente."), "error");
        return;
      }

      setIsQuickRegisterModalOpen(false);
      setQuickPatientName("");
      setQuickPatientEmail("");
      setQuickPatientPhone("");
      setQuickPatientAge("");

      onAddActivityLog(
        "Novo Paciente",
        `Paciente ${quickPatientName} cadastrado via registro rápido.`,
      );
      setActionPopup({
        title: "Paciente adicionado",
        message: `O paciente ${quickPatientName} foi cadastrado com sucesso.`,
      });
      showToast(
        addResult?.data?.patientSyncPending
          ? "Cadastro salvo localmente. Sincronização pendente."
          : "Dados salvos com sucesso! Custo de R$ 4,90 será cobrado da clínica.",
        addResult?.data?.patientSyncPending ? "info" : "info",
      );
    } finally {
      hideProcessing();
    }
  };

  const handleStatusUpdate = (id: number, status: string, details: any = {}) => {
    onUpdateAgendaStatus(id, status, details);
    onAddActivityLog(
      "Status de agenda atualizado",
      `Agendamento ${id} atualizado para ${status}${details?.recurrenceScope === "future" ? " para esta e as próximas consultas da série" : ""}.${details?.note ? ` Observação: ${details.note}` : ""}`,
      "management",
    );
  };

  const readAppointmentSourcePayload = useCallback((appointment: any) => {
    const payload = appointment?.source_payload || appointment?.sourcePayload;
    if (!payload) return {};
    if (typeof payload === "object" && !Array.isArray(payload)) return payload;
    if (typeof payload !== "string") return {};
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, []);

  const isPersistedAppointmentId = useCallback((value: any) => (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim())
  ), []);

  const resolvePersistedAppointmentId = useCallback((appointment: any) => {
    const source = readAppointmentSourcePayload(appointment);
    for (const candidate of [
      appointment?.appointment_id,
      appointment?.appointmentId,
      source?.appointment_id,
      source?.appointmentId,
      appointment?.id,
      source?.id,
    ]) {
      const normalized = String(candidate || "").trim();
      if (isPersistedAppointmentId(normalized)) return normalized;
    }
    return "";
  }, [isPersistedAppointmentId, readAppointmentSourcePayload]);

  const buildAppointmentSessionContext = useCallback((appointment: any) => {
    const appointmentId = resolvePersistedAppointmentId(appointment);
    if (!appointmentId) return null;
    const source = readAppointmentSourcePayload(appointment);
    return {
      ...source,
      ...appointment,
      id: appointmentId,
      appointment_id: appointmentId,
      appointmentId,
      patientId: appointment?.patientId || appointment?.patient_id || source?.patientId || source?.patient_id,
      patient_id: appointment?.patient_id || appointment?.patientId || source?.patient_id || source?.patientId,
      professionalId: appointment?.professionalId || appointment?.professional_id || appointment?.therapistId || appointment?.therapist_id || source?.professionalId || source?.professional_id || source?.therapistId || source?.therapist_id,
      professional_id: appointment?.professional_id || appointment?.professionalId || appointment?.therapist_id || appointment?.therapistId || source?.professional_id || source?.professionalId || source?.therapist_id || source?.therapistId,
      therapistId: appointment?.therapistId || appointment?.therapist_id || appointment?.professionalId || appointment?.professional_id || source?.therapistId || source?.therapist_id || source?.professionalId || source?.professional_id,
      therapist_id: appointment?.therapist_id || appointment?.therapistId || appointment?.professional_id || appointment?.professionalId || source?.therapist_id || source?.therapistId || source?.professional_id || source?.professionalId,
    };
  }, [readAppointmentSourcePayload, resolvePersistedAppointmentId]);

  const normalizeSeriesKeyText = useCallback((value: any) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(), []);

  const getAppointmentOccurrenceTime = useCallback((appointment: any) => {
    const source = readAppointmentSourcePayload(appointment);
    const scheduledAt =
      appointment?.scheduledAt ||
      appointment?.scheduled_at ||
      appointment?.start_time ||
      source?.scheduledAt ||
      source?.scheduled_at ||
      source?.start_time;
    const parsedScheduledAt = scheduledAt ? new Date(scheduledAt).getTime() : Number.NaN;
    if (!Number.isNaN(parsedScheduledAt)) return parsedScheduledAt;
    const date = String(appointment?.date || source?.date || "").trim();
    const time = String(appointment?.time || source?.time || "").trim();
    const parsedDateTime = date && time ? new Date(`${date}T${time}:00`).getTime() : Number.NaN;
    return Number.isNaN(parsedDateTime) ? Number.POSITIVE_INFINITY : parsedDateTime;
  }, [readAppointmentSourcePayload]);

  const getPatientSeriesKey = useCallback((appointment: any) => {
    const source = readAppointmentSourcePayload(appointment);
    const patientId = String(appointment?.patientId || appointment?.patient_id || source?.patientId || source?.patient_id || "").trim();
    if (patientId) return `id:${patientId}`;
    const patientName = normalizeSeriesKeyText(
      appointment?.patientName || appointment?.patient_name || appointment?.name || source?.patientName || source?.patient_name || source?.name,
    );
    return patientName ? `name:${patientName}` : "";
  }, [normalizeSeriesKeyText, readAppointmentSourcePayload]);

  const getProfessionalSeriesKey = useCallback((appointment: any) => {
    const source = readAppointmentSourcePayload(appointment);
    const professionalId = String(
      appointment?.therapistId ||
        appointment?.therapist_id ||
        appointment?.professionalId ||
        appointment?.professional_id ||
        source?.therapistId ||
        source?.therapist_id ||
        source?.professionalId ||
        source?.professional_id ||
        "",
    ).trim();
    if (professionalId) return `id:${professionalId}`;
    const professionalName = normalizeSeriesKeyText(
      appointment?.therapistName || appointment?.therapist_name || appointment?.professional || source?.therapistName || source?.therapist_name || source?.professional,
    );
    return professionalName ? `name:${professionalName}` : "";
  }, [normalizeSeriesKeyText, readAppointmentSourcePayload]);

  const getSeriesClockTime = useCallback((appointment: any) => {
    const source = readAppointmentSourcePayload(appointment);
    const explicitTime = String(appointment?.time || source?.time || "").trim().slice(0, 5);
    if (/^\d{2}:\d{2}$/.test(explicitTime)) return explicitTime;
    const timestamp = getAppointmentOccurrenceTime(appointment);
    if (!Number.isFinite(timestamp)) return "";
    const parsed = new Date(timestamp);
    return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  }, [getAppointmentOccurrenceTime, readAppointmentSourcePayload]);

  const hasFuturePatientSeriesAppointment = useCallback((appointment: any) => {
    const patientKey = getPatientSeriesKey(appointment);
    if (!patientKey) return false;
    const professionalKey = getProfessionalSeriesKey(appointment);
    const clockTime = getSeriesClockTime(appointment);
    const occurrenceTime = getAppointmentOccurrenceTime(appointment);
    return (therapistAgenda || []).some((candidate: any) => {
      if (!candidate || String(candidate?.id) === String(appointment?.id)) return false;
      if (getPatientSeriesKey(candidate) !== patientKey) return false;
      const candidateProfessionalKey = getProfessionalSeriesKey(candidate);
      if (professionalKey && candidateProfessionalKey && candidateProfessionalKey !== professionalKey) return false;
      const candidateClockTime = getSeriesClockTime(candidate);
      if (clockTime && candidateClockTime && candidateClockTime !== clockTime) return false;
      return getAppointmentOccurrenceTime(candidate) >= occurrenceTime;
    });
  }, [
    getAppointmentOccurrenceTime,
    getPatientSeriesKey,
    getProfessionalSeriesKey,
    getSeriesClockTime,
    therapistAgenda,
  ]);

  const isRecurringAppointment = useCallback((appointment: any) => {
    if (!appointment) return false;
    const source = readAppointmentSourcePayload(appointment);
    return Boolean(
      appointment?.isRecurring ||
        appointment?.is_recurring ||
        appointment?.recurrenceGroupId ||
        appointment?.recurrence_group_id ||
        source?.recurrenceGroupId ||
        source?.recurrence_group_id ||
        hasFuturePatientSeriesAppointment(appointment),
    );
  }, [hasFuturePatientSeriesAppointment, readAppointmentSourcePayload]);

  const requestAppointmentCancellation = useCallback(
    (appointment: any, details: any = {}) => {
      if (!appointment?.id) return;
      const payload = {
        note: String(
          details?.note ?? details?.notes ?? details?.observation ?? "",
        ).trim(),
        source: String(details?.source || "agenda_management"),
      };
      if (canCancelRecurringAppointments && isRecurringAppointment(appointment)) {
        setPendingRecurringCancellation({
          appointment,
          ...payload,
        });
        return;
      }
      handleStatusUpdate(appointment.id, "canceled", {
        ...payload,
        recurrenceScope: "single",
      });
    },
    [canCancelRecurringAppointments, handleStatusUpdate, isRecurringAppointment],
  );

  const submitRecurringCancellation = useCallback(
    (scope: "single" | "future") => {
      if (!pendingRecurringCancellation?.appointment?.id) return;
      handleStatusUpdate(
        pendingRecurringCancellation.appointment.id,
        "canceled",
        {
          note: pendingRecurringCancellation.note,
          source: pendingRecurringCancellation.source,
          recurrenceScope: scope,
        },
      );
      setPendingRecurringCancellation(null);
    },
    [handleStatusUpdate, pendingRecurringCancellation],
  );

  const handleDeleteAgendaAppointment = useCallback(
    (id: any, details: any = {}) => {
      if (!onDeleteAppointment) return { success: false, error: "Exclusão indisponível." };
      return onDeleteAppointment(id, details);
    },
    [onDeleteAppointment],
  );

  const requestAppointmentDeletion = useCallback(
    (appointment: any, details: any = {}) => {
      if (!appointment?.id) return;
      const payload = {
        note: String(
          details?.note ?? details?.notes ?? details?.observation ?? "",
        ).trim(),
        source: String(details?.source || "agenda_management"),
      };
      if (canDeleteRecurringAppointments && isRecurringAppointment(appointment)) {
        setPendingRecurringDeletion({
          appointment,
          ...payload,
        });
        return;
      }
      handleDeleteAgendaAppointment(appointment.id, {
        ...payload,
        recurrenceScope: "single",
      });
    },
    [canDeleteRecurringAppointments, handleDeleteAgendaAppointment, isRecurringAppointment],
  );

  const submitRecurringDeletion = useCallback(
    (scope: "single" | "future") => {
      if (!pendingRecurringDeletion?.appointment?.id) return;
      handleDeleteAgendaAppointment(
        pendingRecurringDeletion.appointment.id,
        {
          note: pendingRecurringDeletion.note,
          source: pendingRecurringDeletion.source,
          recurrenceScope: scope,
        },
      );
      setPendingRecurringDeletion(null);
    },
    [handleDeleteAgendaAppointment, pendingRecurringDeletion],
  );

  const normalizeCpfInput = (value: string) =>
    String(value || "")
      .replace(/\D/g, "")
      .slice(0, 11);

  const normalizeBrazilMobileInput = (value: string) => {
    const digits = String(value || "")
      .replace(/\D/g, "")
      .slice(0, 11);
    return digits;
  };

  const isValidBrazilMobile = (value: string) => /^\d{2}9\d{8}$/.test(value);
  const isValidCpf = (value: string) => /^\d{11}$/.test(value);
  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());

  const formatCpf = (value: string) => {
    const v = normalizeCpfInput(value);
    if (v.length <= 3) return v;
    if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`;
    if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
    return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9, 11)}`;
  };

  const formatBrazilMobile = (value: string) => {
    const v = normalizeBrazilMobileInput(value);
    if (v.length <= 2) return v;
    if (v.length <= 7) return `(${v.slice(0, 2)}) ${v.slice(2)}`;
    return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7, 11)}`;
  };

  const handlePatientFormChange = (field: string, value: any) => {
    if (field === "cpf" || field === "responsavelCpf") {
      setNewPatientForm((prev: any) => ({ ...prev, [field]: formatCpf(String(value || "")) }));
      return;
    }
    if (field === "telefone" || field === "responsavelTelefone") {
      setNewPatientForm((prev: any) => ({ ...prev, [field]: formatBrazilMobile(String(value || "")) }));
      return;
    }
    if (field === "email") {
      setNewPatientForm((prev: any) => ({ ...prev, [field]: String(value || "").trim().toLowerCase() }));
      return;
    }
    if (field === "convenioTipo") {
      setNewPatientForm((prev: any) => ({
        ...prev,
        convenioTipo: value,
        financialPlans: normalizePatientFinancialPlans(prev.financialPlans, prev).map((plan: any) => ({
          ...plan,
          ...(value === "convenio" && plan.billingMode === "INSURANCE"
            ? { payerNameSnapshot: plan.payerNameSnapshot || prev.convenioNome || "" }
            : {}),
        })),
      }));
      return;
    }
    if (field === "convenioNome") {
      setNewPatientForm((prev: any) => ({
        ...prev,
        convenioNome: value,
        financialPlans: normalizePatientFinancialPlans(prev.financialPlans, prev).map((plan: any) => ({
          ...plan,
          payerNameSnapshot: plan.billingMode === "INSURANCE" ? value : plan.payerNameSnapshot,
          insuranceName: plan.billingMode === "INSURANCE" ? value : plan.insuranceName,
        })),
      }));
      return;
    }
    setNewPatientForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleFinancialPlanChange = (planId: string, field: string, value: any) => {
    setNewPatientForm((prev: any) => ({
      ...prev,
      financialPlans: normalizePatientFinancialPlans(prev.financialPlans, prev).map((plan: any) =>
        plan.id === planId
          ? createPatientFinancialPlan({
              ...plan,
              [field]: value,
              ...(field === "billingMode" && value === "INSURANCE"
                ? { payerNameSnapshot: plan.payerNameSnapshot || prev.convenioNome || "" }
                : {}),
              ...(field === "billingMode" && value !== "INSURANCE"
                ? { payerNameSnapshot: "", insuranceName: "", authorizationCode: "", authorizationValidUntil: "", copaymentAmount: "" }
                : {}),
              ...(field === "serviceType" && value !== "CUSTOM" ? { customServiceName: "" } : {}),
              ...(field === "payerNameSnapshot" ? { insuranceName: value } : {}),
            })
          : plan,
      ),
    }));
  };

  const addFinancialPlanRow = () => {
    setNewPatientForm((prev: any) => ({
      ...prev,
      financialPlans: [
        ...normalizePatientFinancialPlans(prev.financialPlans, prev),
        createPatientFinancialPlan({
          billingMode: prev.convenioTipo === "convenio" ? "INSURANCE" : "PRIVATE",
          payerNameSnapshot: prev.convenioTipo === "convenio" ? prev.convenioNome || "" : "",
        }),
      ],
    }));
  };

  const removeFinancialPlanRow = (planId: string) => {
    setNewPatientForm((prev: any) => {
      const remaining = normalizePatientFinancialPlans(prev.financialPlans, prev).filter(
        (plan: any) => plan.id !== planId,
      );
      return {
        ...prev,
        financialPlans: remaining,
      };
    });
  };

  const resetPatientForm = () => {
    setEditingPatientId(null);
    setNewPatientForm({
      nome: "",
      nomeSocial: "",
      telefone: "",
      dataNascimento: "",
      genero: "",
      convenioTipo: "particular",
      convenioNome: "",
      convenioCarteirinha: "",
      grupo: "adulto",
      comoConheceu: "",
      rg: "",
      cpf: "",
      cep: "",
      email: "",
      logradouro: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      outrasInformacoes: "",
      menorDeIdade: false,
      responsavelNome: "",
      responsavelDataNascimento: "",
      responsavelCpf: "",
      responsavelTelefone: "",
      responsavelEmail: "",
      responsavelRelacao: "",
      patientProfileType: "ADULT",
      financialPlans: [],
    });
  };

  const calculateAgeFromBirthDate = (birthDate: string) => {
    if (!birthDate) return undefined;
    const dateOnly = String(birthDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const birth = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(birthDate);
    if (Number.isNaN(birth.getTime())) return undefined;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age -= 1;
    }
    return age >= 0 ? age : undefined;
  };

  const handleCreatePatientFromFullForm = async () => {
    if (!canCreatePatients) {
      showToast("A criação de pacientes é exclusiva da recepção e coordenação.", "error");
      return;
    }
    if (!newPatientForm.nome?.trim()) {
      showToast("O nome do paciente é obrigatório.", "error");
      return;
    }
    const normalizedPhone = normalizeBrazilMobileInput(newPatientForm.telefone);
    if (!isValidBrazilMobile(normalizedPhone)) {
      showToast("Telefone inválido. Use DDD + 9 dígitos (ex.: 11912345678).", "error");
      return;
    }
    const normalizedEmail = String(newPatientForm.email || "").trim().toLowerCase();
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      showToast("E-mail inválido. Informe um domínio válido.", "error");
      return;
    }
    const normalizedCpf = normalizeCpfInput(newPatientForm.cpf);
    if (normalizedCpf && !isValidCpf(normalizedCpf)) {
      showToast("CPF inválido. Informe 11 dígitos.", "error");
      return;
    }
    const normalizedGuardianCpf = normalizeCpfInput(newPatientForm.responsavelCpf);
    if (newPatientForm.menorDeIdade && normalizedGuardianCpf && !isValidCpf(normalizedGuardianCpf)) {
      showToast("CPF do responsável inválido. Informe 11 dígitos.", "error");
      return;
    }
    const normalizedGuardianPhone = normalizeBrazilMobileInput(newPatientForm.responsavelTelefone);
    if (newPatientForm.menorDeIdade && normalizedGuardianPhone && !isValidBrazilMobile(normalizedGuardianPhone)) {
      showToast("Telefone do responsável inválido. Use DDD + 9 dígitos.", "error");
      return;
    }
    const normalizedGuardianEmail = String(newPatientForm.responsavelEmail || "").trim().toLowerCase();
    if (normalizedGuardianEmail && !isValidEmail(normalizedGuardianEmail)) {
      showToast("E-mail do responsável inválido.", "error");
      return;
    }
    showProcessing(
      editingPatientId
        ? "Salvando alterações do paciente..."
        : "Cadastrando paciente...",
    );

    const existingPatient = editingPatientId
      ? allPatients.find((p: any) => String(p.id) === String(editingPatientId))
      : null;
    const financialPlans = canAccessClinicFinance
      ? normalizePatientFinancialPlans(newPatientForm.financialPlans, newPatientForm)
          .filter(isPatientFinancialPlanComplete)
          .map(serializePatientFinancialPlanForPayload)
      : [];
    const monthlyTreatmentValue = financialPlans.reduce(
      (sum: number, plan: any) => sum + getFinancialPlanMonthlyProjectionValue(plan),
      0,
    );
    const primaryBillingPlan = financialPlans.find((plan: any) => getFinancialPlanPrimaryBillingMethod(plan));
    const canonicalProfileType = normalizePatientProfileType(newPatientForm.patientProfileType);
    const legacyPortalType = mapPatientProfileTypeToLegacyPortalType(canonicalProfileType);
    const normalizedBirthDate = normalizeBirthDateForStorage(newPatientForm.dataNascimento);

    const newPatient = {
      id: editingPatientId || crypto.randomUUID(),
      name: newPatientForm.nome.trim(),
      socialName: newPatientForm.nomeSocial?.trim() || null,
      phone: normalizedPhone || null,
      email: normalizedEmail || null,
      age: calculateAgeFromBirthDate(normalizedBirthDate),
      birthDate: normalizedBirthDate || null,
      birth_date: normalizedBirthDate || null,
      dataNascimento: normalizedBirthDate || null,
      gender: newPatientForm.genero || null,
      insuranceType: newPatientForm.convenioTipo || "particular",
      insuranceName:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioNome || null
          : null,
      cardNumber:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioCarteirinha || null
          : null,
      group: newPatientForm.grupo || null,
      source: newPatientForm.comoConheceu || null,
      rg: newPatientForm.rg || null,
      cpf: normalizedCpf || null,
      cep: newPatientForm.cep || null,
      address: {
        logradouro: newPatientForm.logradouro || null,
        numero: newPatientForm.numero || null,
        complemento: newPatientForm.complemento || null,
        bairro: newPatientForm.bairro || null,
        cidade: newPatientForm.cidade || null,
      },
      notes: newPatientForm.outrasInformacoes || null,
      isMinor: Boolean(newPatientForm.menorDeIdade),
      guardian: newPatientForm.menorDeIdade
        ? {
            nome: newPatientForm.responsavelNome || null,
            dataNascimento: newPatientForm.responsavelDataNascimento || null,
            cpf: normalizedGuardianCpf || null,
            telefone: normalizedGuardianPhone || null,
            email: normalizedGuardianEmail || null,
            relacao: newPatientForm.responsavelRelacao || null,
          }
        : null,
      responsavelEmail: normalizedGuardianEmail || null,
      responsavelRelacao: newPatientForm.responsavelRelacao || null,
      responsibleEmail: normalizedGuardianEmail || null,
      responsibleRelationship: newPatientForm.responsavelRelacao || null,
      type: legacyPortalType,
      patientProfileType: canonicalProfileType,
      panelType: canonicalProfileType,
      ...(canAccessClinicFinance
        ? {
            financialPlans,
            monthlyTreatmentValue,
            billingDueDay: primaryBillingPlan?.dueDay || null,
            billingMethod: getFinancialPlanPrimaryBillingMethod(primaryBillingPlan) || null,
          }
        : {}),
      lastAnamnesisAt: existingPatient?.lastAnamnesisAt || null,
      anamnesisPending: existingPatient
        ? isPatientPendingAnamnesis(existingPatient)
        : true,
      createdAt: new Date().toISOString(),
    };

    try {
      if (editingPatientId && onUpdatePatient) {
        const updateResult = await onUpdatePatient(newPatient);
        if (updateResult?.success === false) {
          showToast(String(updateResult?.error || "Não foi possível salvar alterações do paciente."), "error");
          return;
        }
        onAddActivityLog(
          "Paciente atualizado",
          `Cadastro de ${newPatient.name} atualizado pela coordenação.`,
          "management",
        );
        setActionPopup({
          title: "Paciente editado",
          message: `As informações de ${newPatient.name} foram atualizadas com sucesso.`,
        });
        showToast("Dados salvos com sucesso!");
      } else {
        const addPatientResult = await onAddPatient(newPatient);
        if (addPatientResult?.success === false) {
          const errorMessage = String(addPatientResult?.error || "Não foi possível cadastrar paciente.");
          showToast(errorMessage, "error");
          return;
        }
        onAddActivityLog(
          "Paciente cadastrado",
          `Cadastro completo de ${newPatient.name} realizado pela coordenação.`,
          "management",
        );
        const activationEmailSent = addPatientResult?.data?.activationEmailSent;
        const patientEmail = String(addPatientResult?.data?.patientEmail || newPatient?.email || "").trim();
        const activationMessage = String(addPatientResult?.data?.activationMessage || "").trim();
        const patientSyncPending = Boolean(addPatientResult?.data?.patientSyncPending);
        const emailMessage =
          activationMessage
            ? ` ${activationMessage}`
            :
          patientEmail && activationEmailSent === true
            ? ` E-mail de ativação enviado para ${patientEmail}.`
            : patientEmail && activationEmailSent === false
              ? " Cadastro concluído, mas o e-mail de ativação não foi enviado. Use o botão de reenviar ativação."
              : "";
        if (patientSyncPending) {
          setActionPopup({
            title: "Paciente salvo localmente",
            message: `O cadastro de ${newPatient.name} foi salvo neste dispositivo e ainda aguarda confirmação do servidor.${emailMessage}`,
          });
          showToast("Cadastro salvo localmente. Sincronização pendente.", "info");
        } else {
          setActionPopup({
            title: "Paciente adicionado",
            message: `O paciente ${newPatient.name} foi cadastrado com sucesso.${emailMessage}`,
          });
          showToast(
            activationEmailSent === false
              ? "Paciente cadastrado. Ativação pendente de envio."
              : "Dados salvos com sucesso!",
            activationEmailSent === false ? "error" : "info"
          );
        }
      }
      setIsPatientRegistrationModalOpen(false);
      resetPatientForm();
    } finally {
      hideProcessing();
    }
  };

  const isPatientAnamnesisReviewed = (patient: any) => {
    if (!patient) return false;
    const onboarding = String(patient?.onboarding_status || patient?.onboardingStatus || "").toUpperCase();
    const status = String(patient?.status || "").toUpperCase();
    const requestStatus = String(patient?.anamnesis_request_status || patient?.anamnesisRequestStatus || "").toUpperCase();
    const responseStatus = String(patient?.anamnesis_response_status || patient?.anamnesisResponseStatus || "").toUpperCase();
    const reviewedAt = patient?.anamnesis_reviewed_at || patient?.anamnesisReviewedAt || patient?.lastAnamnesisAt;
    return (
      ["READY_FOR_CARE", "ANAMNESIS_REVIEWED"].includes(onboarding) ||
      requestStatus === "REVIEWED" ||
      responseStatus === "REVIEWED" ||
      Boolean(reviewedAt) ||
      (status === "ACTIVE" && patient?.anamnesisPending === false)
    );
  };

  const isPatientPendingAnamnesis = (patient: any) => {
    if (!patient) return false;
    if (patient?.anamnesis_required === false || patient?.anamnesisRequired === false) return false;
    if (isPatientAnamnesisReviewed(patient)) return false;
    const onboarding = String(patient?.onboarding_status || patient?.onboardingStatus || "").toUpperCase();
    const status = String(patient?.status || "").toUpperCase();
    if (
      [
        "NOT_STARTED",
        "ANAMNESIS_SENT",
        "ANAMNESIS_IN_PROGRESS",
        "ANAMNESIS_SUBMITTED",
        "PENDING_ANAMNESIS",
        "PENDING_CONFIRMATION",
      ].includes(onboarding || status)
    ) {
      return true;
    }
    const data = patient.anamnesisData;
    const hasAnamnesis =
      !!(data && typeof data === "object" && Object.keys(data).length > 0);
    return !hasAnamnesis;
  };

  const getPatientClinicalStatusLabel = (patient: any) => {
    if (!patient) return "Cadastro incompleto";
    const onboarding = String(patient?.onboarding_status || patient?.onboardingStatus || "").toUpperCase();
    if (isPatientAnamnesisReviewed(patient)) {
      return "Anamnese revisada";
    }
    if (String(patient?.status || "").toUpperCase() === "ACTIVE" && !isPatientPendingAnamnesis(patient)) {
      return "Paciente ativo";
    }
    if (onboarding === "ANAMNESIS_SENT") return "Ficha enviada à família";
    if (onboarding === "ANAMNESIS_IN_PROGRESS") return "Anamnese em preenchimento";
    if (onboarding === "ANAMNESIS_SUBMITTED") return "Aguardando revisão";
    return "Anamnese pendente";
  };

  const handleEditPatient = (patient: any) => {
    setEditingPatientId(String(patient.id));
    setNewPatientForm({
      nome: patient.name || "",
      nomeSocial: patient.socialName || "",
      telefone: patient.phone || "",
      dataNascimento: formatBirthDateForInput(
        patient.birthDate ||
          patient.birth_date ||
          patient.dataNascimento ||
          patient.anamnesisData?.dataNascimento ||
          "",
      ),
      genero: patient.gender || "",
      convenioTipo: patient.insuranceType === "convenio" ? "convenio" : "particular",
      convenioNome: patient.insuranceName || "",
      convenioCarteirinha: patient.cardNumber || "",
      grupo: patient.group || "adulto",
      comoConheceu: patient.source || "",
      rg: patient.rg || "",
      cpf: formatCpf(patient.cpf || patient.anamnesisData?.cpf || ""),
      cep: patient.cep || patient.address?.cep || "",
      email: patient.email || "",
      logradouro: patient.address?.logradouro || "",
      numero: patient.address?.numero || "",
      complemento: patient.address?.complemento || "",
      bairro: patient.address?.bairro || "",
      cidade: patient.address?.cidade || "",
      outrasInformacoes: patient.notes || "",
      menorDeIdade: Boolean(patient.isMinor),
      responsavelNome: patient.guardian?.nome || "",
      responsavelDataNascimento: formatBirthDateForInput(patient.guardian?.dataNascimento || ""),
      responsavelCpf: formatCpf(patient.guardian?.cpf || ""),
      responsavelTelefone: patient.guardian?.telefone || "",
      responsavelEmail: patient.guardian?.email || patient.responsible_email || "",
      responsavelRelacao:
        patient.guardian?.relacao ||
        patient.responsible_relationship ||
        patient.metadata?.responsibleRelationship ||
        "",
      patientProfileType: normalizePatientProfileType(
        patient.patientProfileType || patient.panelType || patient.profile_type || patient.type,
      ),
      financialPlans: normalizePatientFinancialPlans(patient.financialPlans, {
        ...patient,
        convenioTipo: patient.insuranceType === "convenio" ? "convenio" : "particular",
        convenioNome: patient.insuranceName || "",
      }),
    });
    setIsPatientRegistrationModalOpen(true);
  };

  const handleDeletePatient = async (patient: any) => {
    if (!patient?.id) return;
    const patientName = normalizeUtf8Text(patient?.name || "Paciente");
    const isUnlinkOnly = isTherapist;
    const shouldDelete = window.confirm(
      isUnlinkOnly
        ? `Deseja desvincular o paciente ${patientName} da clínica?`
        : `Deseja arquivar o paciente ${patientName}? Ele deixará de aparecer na lista ativa, mas o histórico da clínica será preservado para consulta caso o paciente retorne.`,
    );
    if (!shouldDelete) return;
    showProcessing(isUnlinkOnly ? "Desvinculando paciente..." : "Arquivando paciente...");

    try {
      if (onUpdatePatient) {
        const updateResult = await onUpdatePatient({
          id: patient.id,
          ...(isUnlinkOnly ? { clinic_id: null, unlinkedAt: new Date().toISOString() } : {}),
          status: isUnlinkOnly ? "deleted" : "archived",
          [isUnlinkOnly ? "unlinkedAt" : "archivedAt"]: new Date().toISOString(),
        });
        if (updateResult?.success === false) {
          showToast(String(updateResult?.error || "Não foi possível atualizar o paciente."), "error");
          return;
        }
      }

      onAddActivityLog(
        isUnlinkOnly ? "Paciente desvinculado" : "Paciente arquivado",
        isUnlinkOnly
          ? `Paciente ${patientName} foi desvinculado da clínica.`
          : `Paciente ${patientName} foi arquivado com histórico preservado.`,
        "management",
      );
      setActionPopup({
        title: isUnlinkOnly ? "Paciente desvinculado" : "Paciente arquivado",
        message: isUnlinkOnly
          ? `O paciente ${patientName} foi desvinculado da clínica.`
          : `O paciente ${patientName} foi arquivado com sucesso. O histórico da clínica permanece preservado para consulta.`,
      });
      showToast(isUnlinkOnly ? "Paciente desvinculado da clínica." : "Paciente arquivado com sucesso.");
      setOpenMenuId(null);
    } finally {
      hideProcessing();
    }
  };

  const handleResendPatientActivationEmail = async (patient: any) => {
    if (!patient?.id) return;
    showProcessing("Reenviando e-mail de ativação...");
    try {
      const result = await dataService.resendPatientActivationEmail(String(patient.id));
      if (!result?.success) {
        throw new Error(result?.error || "Falha ao reenviar ativação.");
      }
      onAddActivityLog(
        "Reenvio de ativação",
        `E-mail de ativação reenviado para ${normalizeUtf8Text(patient?.name || "paciente")}.`,
        "management",
      );
      showToast(
        result?.message || "E-mail de ativação reenviado com sucesso.",
        "success",
      );
    } catch (error: any) {
      showToast(
        error?.message || "Não foi possível reenviar o e-mail de ativação.",
        "error",
      );
    } finally {
      hideProcessing();
      setOpenMenuId(null);
    }
  };

  const handleResendPatientRecoveryEmail = async (patient: any) => {
    if (!patient?.id) return;
    showProcessing("Reenviando e-mail de recuperação...");
    try {
      const result = await dataService.resendPatientRecoveryEmail(String(patient.id));
      if (!result?.success) {
        throw new Error(result?.error || "Falha ao reenviar recuperação.");
      }
      onAddActivityLog(
        "Reenvio de recuperação",
        `E-mail de recuperação reenviado para ${normalizeUtf8Text(patient?.name || "paciente")}.`,
        "management",
      );
      showToast(
        result?.message || "E-mail de recuperação reenviado com sucesso.",
        "success",
      );
    } catch (error: any) {
      showToast(
        error?.message || "Não foi possível reenviar o e-mail de recuperação.",
        "error",
      );
    } finally {
      hideProcessing();
      setOpenMenuId(null);
    }
  };

  const handleEditAppointment = (appointment: any) => {
    setEditingAppointmentId(appointment.id);
    setAppointmentEditScope("single");
    setSessionNumSessions(1);
    setSessionRecurrencePattern(appointment.recurrencePattern || appointment.recurrence_pattern || "weekly");
    setSessionPatientName(appointment.patientName || appointment.name || "");
    setSessionDate(appointment.date);
    setSessionTime(appointment.time);
    setSessionApproach(appointment.type || appointment.approach || "");
    const duration = normalizeDurationMinutes(
      appointment.duration_minutes ||
        appointment.durationMinutes ||
        appointment.scheduled_duration_minutes ||
        appointment.scheduledDurationMinutes ||
        50,
      50,
    );
    setSessionDurationOption(getAppointmentDurationOption(duration));
    setSessionCustomDuration(String(duration));
    const nextLocationType = normalizeScheduleLocationType(
      appointment.location_type || appointment.locationType || appointment.location || (appointment.room ? "clinica" : "online"),
    );
    setSessionLocationType(nextLocationType);
    setSessionRoom(nextLocationType === "clinica" ? String(appointment.roomId || appointment.room_id || appointment.room || "") : "");
    setSessionLocationNotes(String(appointment.locationNotes || appointment.location_notes || ""));
    setSessionCallLink(String(appointment.callLink || appointment.call_link || ""));
    setSessionProfessional(
      appointment.therapistName || appointment.professional || "",
    );
    setSessionPayerId(String(appointment.payerId || appointment.payer_id || ""));
    setSessionPayerNameSnapshot(String(appointment.payerName || appointment.payer_name_snapshot || ""));
    setSessionGuideNumber(String(appointment.guideNumber || appointment.guide_number || ""));
    setSessionAuthorizationCode(String(appointment.authorizationCode || appointment.authorization_code || ""));
    if (appointment.id && !isTherapist) {
      dataService.getAppointmentBillingContext(String(appointment.id)).then((result: any) => {
        if (!result?.success || !result.data) return;
        setSessionPayerId(String(result.data.payerId || ""));
        setSessionPayerNameSnapshot(String(result.data.payerName || ""));
        setSessionGuideNumber(String(result.data.guideNumber || ""));
        setSessionAuthorizationCode(String(result.data.authorizationCode || ""));
      });
    }
    setIsAddSessionModalOpen(true);
  };

  const formatAgendaRoomDisplayName = useCallback((value: any) => {
    const roomName = normalizeUtf8Text(String(value || ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!roomName) return "";

    const withoutRepeatedPrefix = roomName.replace(/^(sala\s+)+/i, "Sala ");
    if (/^sala\b/i.test(withoutRepeatedPrefix)) {
      return withoutRepeatedPrefix.replace(/^sala\b/i, "Sala");
    }
    if (/^\d+[a-z]?$/i.test(withoutRepeatedPrefix)) {
      return `Sala ${withoutRepeatedPrefix}`;
    }
    return withoutRepeatedPrefix;
  }, []);

  const onPatientClick = (
    patientId: any,
    options?: {
      tab?: "history" | "notes" | "report" | "plan" | "session" | "files";
      openAnamnesis?: boolean;
    },
    fallbackPatientName?: string,
  ) => {
    const normalizedFallback = normalizeUtf8Text(
      String(fallbackPatientName || ""),
    )
      .trim()
      .toLowerCase();

    const resolvedPatient =
      allPatients.find(
        (p) =>
          patientId !== undefined &&
          patientId !== null &&
          String(p.id) === String(patientId),
      ) ||
      allPatients.find(
        (p) =>
          normalizedFallback.length > 0 &&
          normalizeUtf8Text(String(p?.name || ""))
            .trim()
            .toLowerCase() === normalizedFallback,
      );

    if (!resolvedPatient?.id) {
      const fallbackName = normalizeUtf8Text(String(fallbackPatientName || "Paciente")).trim();
      setQuickPatientName(fallbackName || "Paciente");
      setQuickPatientAge("");
      setQuickPatientEmail("");
      setQuickPatientPhone("");
      setIsQuickRegisterModalOpen(true);
      setActionPopup({
        title: "Paciente não localizado",
        message:
          "Abrimos o Cadastro Rápido já preenchido com o nome do agendamento para você vincular o atendimento sem retrabalho.",
      });
      return;
    }

    const roleDefault = isTherapist
      ? { tab: "history" as const, openAnamnesis: false }
      : isReceptionist
        ? { tab: "files" as const, openAnamnesis: false }
        : { tab: "history" as const, openAnamnesis: false };

    const nextOptions = isReceptionist
      ? roleDefault
      : {
          ...roleDefault,
          ...(options || {}),
        };

    setSelectedPatientId(resolvedPatient.id);
    setPatientOpenTab(nextOptions.tab || "history");
    setOpenAnamnesisOnPatientOpen(Boolean(nextOptions.openAnamnesis));
    setView("patient");
  };

  const openPatientProfileModal = (patient: any) => {
    const profile = patient && typeof patient === "object" ? patient : {};
    const anamnesisData =
      profile?.anamnesisData && typeof profile.anamnesisData === "object"
        ? profile.anamnesisData
        : {};
    const address =
      profile?.address && typeof profile.address === "object"
        ? profile.address
        : {};
    const readFirstText = (...values: any[]) => {
      for (const value of values) {
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
      return "";
    };

    setSelectedPatientProfile({
      ...profile,
      name: readFirstText(profile?.name, anamnesisData?.nome),
      socialName: readFirstText(profile?.socialName, profile?.nomeSocial, anamnesisData?.nomeSocial),
      phone: readFirstText(profile?.phone, anamnesisData?.telefone),
      email: readFirstText(profile?.email, anamnesisData?.email),
      insuranceType: readFirstText(profile?.insuranceType, anamnesisData?.convenioTipo),
      insuranceName: readFirstText(profile?.insuranceName, anamnesisData?.convenioNome),
      cardNumber: readFirstText(profile?.cardNumber, anamnesisData?.convenioCarteirinha),
      rg: readFirstText(profile?.rg, anamnesisData?.rg),
      cpf: readFirstText(profile?.cpf, anamnesisData?.cpf),
      patientProfileType: normalizePatientProfileType(
        profile?.patientProfileType || profile?.panelType || profile?.profile_type || profile?.type,
      ),
      lastAnamnesisAt: profile?.lastAnamnesisAt || profile?.anamnesisLastFilledAt || profile?.anamnesisUpdatedAt || null,
      address: {
        cep: readFirstText(address?.cep, profile?.cep, anamnesisData?.cep),
        logradouro: readFirstText(address?.logradouro, profile?.logradouro, anamnesisData?.logradouro),
        numero: readFirstText(address?.numero, profile?.numero, anamnesisData?.numero),
        complemento: readFirstText(address?.complemento, profile?.complemento, anamnesisData?.complemento),
        bairro: readFirstText(address?.bairro, profile?.bairro, anamnesisData?.bairro),
        cidade: readFirstText(address?.cidade, profile?.cidade, anamnesisData?.cidade),
      },
      notes: readFirstText(profile?.notes, profile?.outrasInformacoes, anamnesisData?.outrasInformacoes),
    });
    setIsPatientProfileModalOpen(true);
  };

  const resolvePatientFromAgendaItem = useCallback(
    (appointment: any) => {
      const normalizedName = normalizeUtf8Text(
        String(appointment?.patientName || appointment?.name || ""),
      )
        .trim()
        .toLowerCase();

      return (
        allPatients.find(
          (patient: any) =>
            appointment?.patientId !== undefined &&
            appointment?.patientId !== null &&
            String(patient?.id) === String(appointment.patientId),
        ) ||
        allPatients.find(
          (patient: any) =>
            normalizedName.length > 0 &&
            normalizeUtf8Text(String(patient?.name || ""))
              .trim()
              .toLowerCase() === normalizedName,
        ) ||
        null
      );
    },
    [allPatients],
  );

  const closeAgendaActionModal = useCallback(() => {
    setSelectedAgendaAppointment(null);
    setAgendaAppointmentObservation("");
  }, []);

  const openAgendaActionModal = useCallback((appointment: any) => {
    const therapistId = String(
      appointment?.professionalId ||
        appointment?.therapistId ||
        appointment?.professional_id ||
        appointment?.therapist_id ||
        "",
    ).trim();
    const therapist =
      therapistMembersById[therapistId] ||
      Object.values(therapistMembersById).find((member: any) => {
        const memberName = String(
          member?.full_name || member?.fullName || member?.name || member?.email || "",
        ).trim();
        return memberName && memberName === String(appointment?.therapistName || appointment?.professional || "").trim();
      }) ||
      null;
    const resolvedTherapistName = normalizeUtf8Text(
      String(
        therapist?.full_name ||
          therapist?.fullName ||
          therapist?.name ||
          appointment?.therapistName ||
          appointment?.professional ||
          "Profissional",
      ),
    );
    const roomId = String(
      appointment?.roomId || appointment?.room_id || appointment?.room || "",
    ).trim();
    const roomMatch =
      rooms.find((room: any) => String(room?.id || "").trim() === roomId) ||
      rooms.find((room: any) => String(room?.name || "").trim() === roomId) ||
      null;
    const resolvedRoomName = formatAgendaRoomDisplayName(
      roomMatch?.name || appointment?.roomName || appointment?.room || "",
    );

    setIsDayDetailsModalOpen(false);
    setSelectedAgendaAppointment({
      ...appointment,
      therapistDisplayName: resolvedTherapistName,
      roomDisplayName: resolvedRoomName,
    });
    setAgendaAppointmentObservation(
      String(
        appointment?.notes ||
          appointment?.note ||
          appointment?.observation ||
          appointment?.appointmentObservation ||
          appointment?.appointment_observation ||
          "",
      ),
    );
  }, [formatAgendaRoomDisplayName, rooms, therapistMembersById]);

  const openAppointmentProfileFromAgenda = useCallback(
    (appointment: any) => {
      const resolvedPatient = resolvePatientFromAgendaItem(appointment);
      closeAgendaActionModal();
      if (resolvedPatient) {
        openPatientProfileModal(resolvedPatient);
        return;
      }
      onPatientClick(
        appointment?.patientId,
        undefined,
        appointment?.patientName || appointment?.name,
      );
    },
    [
      closeAgendaActionModal,
      onPatientClick,
      openPatientProfileModal,
      resolvePatientFromAgendaItem,
    ],
  );

  const openAppointmentChartFromAgenda = useCallback(
    (appointment: any, openAnamnesis = false) => {
      closeAgendaActionModal();
      onPatientClick(
        appointment?.patientId,
        { tab: "history", openAnamnesis },
        appointment?.patientName || appointment?.name,
      );
    },
    [closeAgendaActionModal, onPatientClick],
  );

  const handleRescheduleAppointmentFromAgenda = useCallback(
    (appointment: any) => {
      closeAgendaActionModal();
      handleEditAppointment(appointment);
    },
    [closeAgendaActionModal, handleEditAppointment],
  );

  const handleCancelAppointmentFromAgenda = useCallback(
    (appointment: any) => {
      closeAgendaActionModal();
      requestAppointmentCancellation(appointment, {
        note: agendaAppointmentObservation,
        source: "agenda_modal",
      });
    },
    [agendaAppointmentObservation, closeAgendaActionModal, requestAppointmentCancellation],
  );

  const handleDeleteAppointmentFromAgenda = useCallback(
    (appointment: any) => {
      closeAgendaActionModal();
      requestAppointmentDeletion(appointment, {
        note: agendaAppointmentObservation,
        source: "agenda_modal",
      });
    },
    [agendaAppointmentObservation, closeAgendaActionModal, requestAppointmentDeletion],
  );

  const handleConfirmAppointmentFromAgenda = useCallback(
    (appointment: any) => {
      closeAgendaActionModal();
      handleStatusUpdate(appointment?.id, "confirmed", {
        note: agendaAppointmentObservation,
        source: "agenda_modal",
      });
    },
    [agendaAppointmentObservation, closeAgendaActionModal, handleStatusUpdate],
  );

  const normalizedAgenda = useMemo(
    () =>
      (therapistAgenda || []).map((item: any) => {
        const agendaPatientName = normalizeUtf8Text(
          item.patientName || item.name || "Paciente",
        );
        const normalizedAgendaPatientName = agendaPatientName
          .trim()
          .toLowerCase();
        const resolvedPatient =
          allPatients.find(
            (p: any) =>
              item?.patientId !== undefined &&
              item?.patientId !== null &&
              String(p?.id) === String(item.patientId),
          ) ||
          allPatients.find(
            (p: any) =>
              normalizeUtf8Text(String(p?.name || ""))
                .trim()
                .toLowerCase() === normalizedAgendaPatientName,
          );
        const therapistId = String(
          item?.professionalId ||
            item?.therapistId ||
            item?.professional_id ||
            item?.therapist_id ||
            "",
        ).trim();
        const therapist =
          therapistMembersById[therapistId] ||
          Object.values(therapistMembersById).find((member: any) => {
            const memberName = String(
              member?.full_name || member?.fullName || member?.name || member?.email || "",
            ).trim();
            return memberName && memberName === String(item?.therapistName || item?.professional || "").trim();
          }) ||
          null;
        const roomId = String(
          item?.roomId || item?.room_id || item?.room || "",
        ).trim();
        const roomMatch =
          rooms.find((room: any) => String(room?.id || "").trim() === roomId) ||
          rooms.find((room: any) => String(room?.name || "").trim() === roomId) ||
          null;
        const therapistDisplayName = normalizeUtf8Text(
          String(
            therapist?.full_name ||
              therapist?.fullName ||
              therapist?.name ||
              item.therapistName ||
              item.professional ||
              "Profissional",
          ),
        );
        const roomDisplayName = formatAgendaRoomDisplayName(
          roomMatch?.name || item?.roomName || item?.room || "",
        );

        return {
          ...item,
          patientName: agendaPatientName,
          therapistName: therapistDisplayName,
          therapistDisplayName,
          roomDisplayName,
          type: normalizeUtf8Text(item.type || item.approach || "Sessão"),
          anamnesisPending: isPatientPendingAnamnesis(resolvedPatient),
        };
      }),
    [therapistAgenda, allPatients, rooms, therapistMembersById, formatAgendaRoomDisplayName],
  );

  const todayAgendaKey = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  const getAgendaDateKey = (value: any) => {
    if (!value) return "";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const getLocalDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const focusedAgendaDate = useMemo(() => {
    const next = new Date(calendarDate);
    next.setHours(0, 0, 0, 0);
    return next;
  }, [calendarDate]);

  const focusedAgendaDateKey = useMemo(
    () => getLocalDateKey(focusedAgendaDate),
    [focusedAgendaDate],
  );

  const focusedWeekRange = useMemo(() => {
    const start = new Date(focusedAgendaDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [focusedAgendaDate]);

  const moveAgendaDate = (direction: -1 | 1) => {
    setCalendarDate((prev) => {
      const next = new Date(prev);
      if (agendaView === "day") next.setDate(next.getDate() + direction);
      if (agendaView === "week") next.setDate(next.getDate() + direction * 7);
      if (agendaView === "month") next.setMonth(next.getMonth() + direction);
      return next;
    });
  };

  const agendaPeriodLabel = useMemo(() => {
    if (agendaView === "day") {
      return focusedAgendaDate.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    }
    if (agendaView === "week") {
      const start = focusedWeekRange.start.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      });
      const end = focusedWeekRange.end.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      return `${start} - ${end}`;
    }
    return focusedAgendaDate.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    });
  }, [agendaView, focusedAgendaDate, focusedWeekRange]);

  const isCanceledAgendaItem = (item: any) => {
    const status = String(item?.status || item?.state || item?.statusLabel || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return status.includes("cancel") || status.includes("desmarc");
  };

  const todayAgendaItems = useMemo(
    () =>
      (normalizedAgenda || []).filter((item: any) => {
        const dateKey = getAgendaDateKey(
          item?.date || item?.scheduled_at || item?.scheduledAt || item?.start,
        );
        return dateKey === todayAgendaKey;
      }),
    [normalizedAgenda, todayAgendaKey],
  );

  const confirmedTodayCount = useMemo(
    () =>
      todayAgendaItems.filter((item: any) =>
        ["confirmed", "confirmado"].includes(String(item?.status || "").toLowerCase()),
      ).length,
    [todayAgendaItems],
  );

  const canceledTodayCount = useMemo(
    () => todayAgendaItems.filter(isCanceledAgendaItem).length,
    [todayAgendaItems],
  );

  const pendingPatientPayments = useMemo(
    () => (payments || []).filter((payment: any) => !isPaymentPaid(payment)),
    [payments],
  );

  const dueSoonPatientPayments = useMemo(
    () =>
      pendingPatientPayments.filter((payment: any) => {
        const days = daysUntilDate(payment?.due_date || payment?.dueDate);
        return days === 2;
      }),
    [pendingPatientPayments],
  );

  const overduePatientPayments = useMemo(
    () =>
      pendingPatientPayments.filter((payment: any) => {
        const days = daysUntilDate(payment?.due_date || payment?.dueDate);
        return days !== null && days < 0;
      }),
    [pendingPatientPayments],
  );

  useEffect(() => {
    if (!["coordinator", "receptionist", "admin", "owner"].includes(role)) return;
    dueSoonPatientPayments.forEach((payment: any) => {
      const paymentId = String(payment?.id || `${payment?.patient_id}-${payment?.due_date}`);
      const noticeKey = `verto:payment-due-soon:${paymentId}:${payment?.due_date}`;
      if (localStorage.getItem(noticeKey)) return;
      localStorage.setItem(noticeKey, "1");
      showToast(
        `Faltam 2 dias para o vencimento do pagamento de ${payment?.patient_name || payment?.patientName || "paciente"}.`,
        "info",
      );
    });
  }, [dueSoonPatientPayments, role]);

  const birthdayTodayCount = useMemo(() => {
    return birthdayPatients.length;
  }, [birthdayPatients.length]);

  const dashboardDailyStats = useMemo(() => {
    const stats = [
      {
        id: "agenda",
        label: "Consultas hoje",
        value: confirmedTodayCount,
        hint: "confirmadas",
        icon: Calendar,
        accent: "bg-emerald-500",
        color: "text-emerald-600",
        iconBg: theme === "dark" ? "bg-emerald-400/15" : "bg-emerald-50",
      },
      {
        id: "agenda",
        label: "Desmarcados",
        value: canceledTodayCount,
        hint: "para hoje",
        icon: XCircle,
        accent: "bg-rose-500",
        color: "text-rose-600",
        iconBg: theme === "dark" ? "bg-rose-400/15" : "bg-rose-50",
      },
      {
        id: "birthdays",
        label: "Aniversariantes",
        value: birthdayTodayCount,
        hint: "hoje",
        icon: Cake,
        accent: "bg-sky-500",
        color: "text-sky-600",
        iconBg: theme === "dark" ? "bg-sky-400/15" : "bg-sky-50",
      },
    ];

    if (canAccessClinicFinance) {
      stats.push({
        id: "financial",
        label: "Inadimplentes",
        value: overduePatientPayments.length,
        hint: "pagamentos vencidos",
        icon: AlertCircle,
        accent: "bg-amber-500",
        color: "text-amber-600",
        iconBg: theme === "dark" ? "bg-amber-400/15" : "bg-amber-50",
      });
    }

    return stats;
  }, [
    birthdayTodayCount,
    canceledTodayCount,
    canAccessClinicFinance,
    confirmedTodayCount,
    overduePatientPayments.length,
    theme,
  ]);

  useEffect(() => {
    const uniqueProfessionals = Array.from(
      new Set(
        normalizedAgenda
          .map((a: any) => String(a.therapistName || "").trim())
          .filter(Boolean),
      ),
    ) as string[];
    setProfessionalSessionDurations((prev) => {
      const next = { ...prev };
      uniqueProfessionals.forEach((professional) => {
        if (!next[professional]) {
          next[professional] = String(defaultSessionDuration || "50");
        }
      });
      return next;
    });
  }, [normalizedAgenda, defaultSessionDuration]);

  const filteredAgenda = useMemo(() => {
    let filtered = normalizedAgenda || [];
    if (professionalFilter !== "all") {
      filtered = filtered.filter((a) => a.therapistName === professionalFilter);
    }

    const search = agendaSearchTerm.trim().toLowerCase();
    if (search) {
      filtered = filtered.filter((a) =>
        agendaSearchMode === "patient"
          ? String(a.patientName || "")
              .toLowerCase()
              .includes(search)
          : String(a.therapistName || "")
              .toLowerCase()
              .includes(search),
      );
    }

    return filtered;
  }, [normalizedAgenda, professionalFilter, agendaSearchMode, agendaSearchTerm]);

  const currentViewAgenda = useMemo(() => {
    return (filteredAgenda || [])
      .filter((a: any) => {
        const itemDate = new Date(a.date + "T00:00:00");
        if (agendaView === "day") return itemDate.getTime() === focusedAgendaDate.getTime();
        if (agendaView === "week") {
          return itemDate >= focusedWeekRange.start && itemDate <= focusedWeekRange.end;
        }
        if (agendaView === "month")
          return (
            itemDate.getMonth() === focusedAgendaDate.getMonth() &&
            itemDate.getFullYear() === focusedAgendaDate.getFullYear()
          );
        return true;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [agendaView, filteredAgenda, focusedAgendaDate, focusedWeekRange]);

  const groupedAgenda = useMemo(() => {
    if (agendaView === "day" || agendaView === "month") return null;
    const items = currentViewAgenda;
    const grouped: any = {};
    items.forEach((item: any) => {
      const dateKey = new Date(item.date + "T00:00:00").toLocaleDateString(
        "pt-BR",
        { weekday: "short", day: "numeric", month: "short" },
      );
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(item);
    });
    return grouped;
  }, [agendaView, currentViewAgenda]);

  const hourSlots = useMemo(
    () =>
      Array.from({ length: 14 }, (_, idx) => {
        const hour = idx + 7;
        return `${String(hour).padStart(2, "0")}:00`;
      }),
    [],
  );

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(focusedWeekRange.start);
      date.setDate(focusedWeekRange.start.getDate() + i);
      const key = getLocalDateKey(date);
      return {
        key,
        label: date.toLocaleDateString("pt-BR", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        }),
      };
    });
  }, [focusedWeekRange]);

  const getAgendaStatusVisual = (status: string) => {
    const normalized = String(status || "pending").toLowerCase();
    const dark = theme === "dark";
    if (normalized === "confirmed") {
      return {
        card: dark
          ? "border-emerald-300/70 bg-emerald-400 text-emerald-950 hover:bg-emerald-300 shadow-sm"
          : "border-emerald-400 bg-emerald-50/80 text-slate-900 hover:bg-emerald-50",
        badge: "bg-emerald-500 text-white",
        label: "Confirmado",
        icon: CheckCircle2,
        name: "",
        title: dark ? "text-emerald-950" : "text-slate-900",
        meta: dark ? "text-emerald-950/75" : "text-slate-500",
      };
    }
    if (normalized === "reschedule") {
      return {
        card: dark
          ? "border-amber-300/70 bg-amber-400 text-amber-950 hover:bg-amber-300 shadow-sm"
          : "border-amber-300 bg-amber-50 text-slate-900 hover:bg-amber-50",
        badge: "bg-amber-500 text-white",
        label: "Remarcar",
        icon: AlertCircle,
        name: "",
        title: dark ? "text-amber-950" : "text-slate-900",
        meta: dark ? "text-amber-950/75" : "text-slate-500",
      };
    }
    if (normalized === "canceled" || normalized === "cancelled") {
      return {
        card: dark
          ? "border-l-4 border-l-rose-300 border-rose-300/50 bg-rose-500/80 text-white opacity-80 hover:bg-rose-500"
          : "border-l-4 border-l-rose-500 border-rose-100 bg-slate-50 text-slate-900 opacity-60 hover:bg-slate-50",
        badge: "bg-rose-500 text-white",
        label: "Cancelado",
        icon: XCircle,
        name: "line-through decoration-2 decoration-rose-500",
        title: dark ? "text-white" : "text-slate-900",
        meta: dark ? "text-rose-50/85" : "text-slate-500",
      };
    }
    return {
      card: dark
        ? "border-sky-300/70 bg-sky-400 text-sky-950 hover:bg-sky-300 shadow-sm"
        : "border-[#7a32fc]/20 bg-[#7a32fc]/5 text-slate-900 hover:bg-[#7a32fc]/10",
      badge: "bg-violet-100 text-violet-700",
      label: "Pendente",
      icon: Clock,
      name: "",
      title: dark ? "text-sky-950" : "text-slate-900",
      meta: dark ? "text-sky-950/75" : "text-slate-500",
    };
  };

  const renderGoogleDayGrid = () => {
    const todayKey = focusedAgendaDateKey;
    const isFocusedToday = todayKey === getLocalDateKey(new Date());
    const shellClass = theme === "dark"
      ? "rounded-3xl border border-slate-700/80 bg-[#101827] overflow-hidden"
      : "rounded-3xl border border-slate-100 bg-white overflow-hidden";
    const headerClass = theme === "dark"
      ? "grid grid-cols-[96px_1fr] bg-[#0b1220] border-b border-slate-700/80"
      : "grid grid-cols-[96px_1fr] bg-slate-50 border-b border-slate-100";
    const rowClass = theme === "dark"
      ? "grid grid-cols-[96px_1fr] border-b border-slate-700/70 min-h-[66px]"
      : "grid grid-cols-[96px_1fr] border-b border-slate-50 min-h-[66px]";
    const timeCellClass = theme === "dark"
      ? "px-4 py-3 text-xs font-semibold text-slate-200 bg-[#0b1220]"
      : "px-4 py-3 text-xs font-semibold text-slate-500 bg-white";
    const slotCellClass = theme === "dark"
      ? "px-3 py-2 bg-[#101827] hover:bg-[#132033] transition-colors cursor-pointer"
      : "px-3 py-2 bg-white hover:bg-slate-50 transition-colors cursor-pointer";
    return (
      <div className={shellClass}>
        <div className={headerClass}>
          <div className="px-4 py-3 text-[10px] font-bold tracking-widest uppercase text-slate-400">
            Horário
          </div>
          <div className="px-4 py-3 text-[10px] font-bold tracking-widest uppercase text-slate-400">
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </div>
        </div>

        <div className="relative">
          {isFocusedToday && currentTimelineOffsetPx !== null && (
            <div
              className="absolute left-[96px] right-0 z-10 pointer-events-none"
              style={{ top: `${currentTimelineOffsetPx}px` }}
            >
              <div className="relative">
                <div className="h-[2px] bg-[#ff4d6d] shadow-[0_0_0_1px_rgba(255,77,109,0.18)]" />
                <span className="absolute -top-3.5 right-3 rounded-full bg-[#ff4d6d] text-white text-[9px] font-black tracking-wider px-2 py-0.5 shadow-sm">
                  {currentTimelineLabel}
                </span>
              </div>
            </div>
          )}

          {hourSlots.map((slot) => {
            const [hour] = slot.split(":");
            const slotItems = currentViewAgenda.filter(
              (item: any) =>
                item.date === todayKey &&
                String(item.time || "").startsWith(`${hour}:`),
            );

            return (
              <div
                key={slot}
                className={rowClass}
              >
                <div className={timeCellClass}>
                  {slot}
                </div>
                <div
                  className={slotCellClass}
                  onClick={() => openNewAppointmentAt(todayKey, slot)}
                  title="Criar agendamento neste horário"
                >
                  <div className="flex flex-wrap gap-2">
                    {slotItems.length > 0 ? (
                      slotItems.map((item: any) => {
                        const statusVisual = getAgendaStatusVisual(item.status);
                        const StatusIcon = statusVisual.icon;
                        return (
                          <button
                            key={item.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              openAgendaActionModal(item);
                            }}
                            className={`text-left min-w-[220px] rounded-xl border px-3 py-2 transition-all ${statusVisual.card}`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className={`text-xs font-bold flex items-center gap-1.5 ${statusVisual.title} ${statusVisual.name}`}>
                                {item.time} • {item.patientName}
                                {item.anamnesisPending && (
                                  <span
                                    title="Paciente pendente de ficha anamnese"
                                    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black"
                                  >
                                    !
                                  </span>
                                )}
                              </p>
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase ${statusVisual.badge}`}>
                                <StatusIcon size={11} />
                                {statusVisual.label}
                              </span>
                            </div>
                            <p className={`text-[10px] ${statusVisual.meta}`}>
                              {item.therapistDisplayName || item.therapistName} • {item.roomDisplayName || "--"}
                            </p>
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-[11px] text-slate-300">
                        Sem agendamento
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderGoogleWeekGrid = () => {
    const byDate: Record<string, any[]> = {};
    weekDays.forEach((d) => {
      byDate[d.key] = currentViewAgenda.filter((item: any) => item.date === d.key);
    });
    const shellClass = theme === "dark"
      ? "min-w-[980px] rounded-3xl border border-slate-700/80 bg-[#101827] overflow-hidden"
      : "min-w-[980px] rounded-3xl border border-slate-100 bg-white overflow-hidden";
    const headerClass = theme === "dark"
      ? "grid grid-cols-[96px_repeat(7,minmax(0,1fr))] bg-[#0b1220] border-b border-slate-700/80"
      : "grid grid-cols-[96px_repeat(7,minmax(0,1fr))] bg-slate-50 border-b border-slate-100";
    const rowClass = theme === "dark"
      ? "grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-slate-700/70 min-h-[68px]"
      : "grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-slate-50 min-h-[68px]";
    const timeCellClass = theme === "dark"
      ? "px-3 py-3 text-xs font-semibold text-slate-200 bg-[#0b1220]"
      : "px-3 py-3 text-xs font-semibold text-slate-500 bg-white";
    const dayCellClass = theme === "dark"
      ? "px-2 py-2 border-l border-slate-700/70 bg-[#101827] hover:bg-[#132033] transition-colors cursor-pointer"
      : "px-2 py-2 border-l border-slate-50 bg-white hover:bg-slate-50 transition-colors cursor-pointer";

    return (
      <div className="overflow-x-auto">
        <div className={shellClass}>
          <div className={headerClass}>
            <div className="px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Hora
            </div>
            {weekDays.map((d) => (
              <div
                key={d.key}
                className="px-3 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-l border-slate-100"
              >
                {d.label}
              </div>
            ))}
          </div>
          {hourSlots.map((slot) => {
            const [hour] = slot.split(":");
            return (
              <div
                key={slot}
                className={rowClass}
              >
                <div className={timeCellClass}>
                  {slot}
                </div>
                {weekDays.map((d) => {
                  const items = (byDate[d.key] || []).filter((item: any) =>
                    String(item.time || "").startsWith(`${hour}:`),
                  );

                  return (
                    <div
                      key={`${d.key}-${slot}`}
                      className={dayCellClass}
                      onClick={() => openNewAppointmentAt(d.key, slot)}
                      title="Criar agendamento neste horário"
                    >
                      <div className="flex flex-col gap-1">
                        {items.length > 0 ? (
                          items.map((item: any) => {
                            const statusVisual = getAgendaStatusVisual(item.status);
                            return (
                              <button
                                key={item.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAgendaActionModal(item);
                                }}
                                className={`text-left rounded-lg border px-2 py-1.5 transition-all ${statusVisual.card}`}
                              >
                                <p className={`text-[10px] font-bold truncate flex items-center gap-1.5 ${statusVisual.title} ${statusVisual.name}`}>
                                  {item.time} • {item.patientName}
                                  {item.anamnesisPending && (
                                    <span
                                      title="Pendente de anamnese"
                                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black shrink-0"
                                    >
                                      !
                                    </span>
                                  )}
                                </p>
                                <p className={`text-[9px] truncate ${statusVisual.meta}`}>
                                  {item.therapistName}
                                </p>
                              </button>
                            );
                          })
                        ) : (
                          <span className="text-[10px] text-slate-300">-</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const handleCheckout = async (planId: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planName: planId }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Erro ao iniciar checkout: " + data.error);
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Erro de conexão ao processar pagamento.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCustomerPortal = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/customer-portal-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      showToast(data?.error || "Não foi possível abrir o portal de faturamento.", "error");
    } catch (error) {
      console.error("Customer portal error:", error);
      showToast("Erro de conexão ao abrir portal de faturamento.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRooms) return;
    const specialtiesArray = newRoom.specialties
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const room = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      name: newRoom.name,
      specialties: specialtiesArray,
      is_active: true,
      isActive: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setRooms((prev) => [...prev, room]);
    setNewRoom({ name: "", specialties: "" });
  };

  const handleEditRoom = (room: any) => {
    if (!canManageRooms) return;
    setEditingRoom(room);
    setNewRoom({ name: room.name, specialties: (Array.isArray(room.specialties) ? room.specialties : []).join(", ") });
  };

  const handleUpdateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRooms) return;
    if (!editingRoom) return;
    const specialtiesArray = newRoom.specialties
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    setRooms((prev) =>
      prev.map((r) =>
        r.id === editingRoom.id
          ? { ...r, name: newRoom.name, specialties: specialtiesArray, updated_at: new Date().toISOString() }
          : r,
      ),
    );
    setEditingRoom(null);
    setNewRoom({ name: "", specialties: "" });
  };

  const handleDeleteRoom = (id: string) => {
    if (!canManageRooms) return;
    setRooms((prev) =>
      prev.map((room) =>
        String(room.id) === String(id)
          ? (() => {
              const nextActive = !(room.is_active !== false && room.isActive !== false);
              return { ...room, is_active: nextActive, isActive: nextActive, updated_at: new Date().toISOString() };
            })()
          : room,
      ),
    );
  };

  const handleSaveClinicSettings = () => {
    if (isTherapist) {
      const cleanFullName = therapistFullName.trim();
      const cleanCrp = therapistCrp.trim();
      const cleanSpecialties = therapistSpecialties.trim();
      const cleanMiniCurriculum = therapistMiniCurriculum.trim();
      const isCrpValid =
        /^[A-Za-z]{2,4}\s?\/?\s?\d{3,10}$/i.test(cleanCrp) ||
        /^\d{2}\s?\/?\s?\d{4,8}$/i.test(cleanCrp);

      if (!cleanFullName || cleanFullName.length < 3) {
        showToast("Informe o nome completo para salvar o perfil.", "error");
        return;
      }
      if (!cleanCrp) {
        const warning =
          "Complete seu perfil com o CRP para habilitar registros clínicos";
        alert(warning);
        showToast(warning, "error");
        return;
      }
      if (!isCrpValid) {
        showToast("CRP inválido. Use um formato como CRP 06/123456.", "error");
        return;
      }
      showProcessing("Salvando perfil profissional...");
      onUpdateProfile({
        name: cleanFullName,
        crp: cleanCrp,
        specialties: cleanSpecialties,
        miniCurriculum: cleanMiniCurriculum,
        profilePicture: therapistProfilePhotoUrl,
        signatureDataUrl: therapistSignatureDataUrl,
        clinicSettings: {
          ...(user?.clinicSettings || {}),
          therapistSpecialties: cleanSpecialties,
          therapistMiniCurriculum: cleanMiniCurriculum,
          signatureDataUrl: therapistSignatureDataUrl,
        },
      });
      onAddActivityLog(
        "Perfil profissional atualizado",
        "O terapeuta atualizou nome, CRP, especialidades, mini currículo, assinatura digital e foto de perfil.",
        "management",
      );
      hideProcessing();
      showToast("Perfil atualizado com sucesso!");
      return;
    }
    if (!canManageClinicSettings) {
      showToast("Apenas a coordenação pode alterar as configurações da clínica.", "error");
      return;
    }

    showProcessing("Salvando configurações da clínica...");
    const clinicSettings = {
      ...(user?.clinicSettings || {}),
      defaultSessionDuration,
      workStart,
      workEnd,
      professionalSessionDurations,
      clinicCnpj,
    };

    onUpdateProfile({
      name: therapistFullName?.trim() || user?.name,
      profilePicture: therapistProfilePhotoUrl,
      signatureDataUrl: therapistSignatureDataUrl,
      clinicSettings: {
        ...clinicSettings,
        clinicLogoUrl: clinicLogoDataUrl || undefined,
        signatureDataUrl: therapistSignatureDataUrl || undefined,
      },
    });

    onAddActivityLog(
      "Configurações atualizadas",
      "A coordenação atualizou horários, branding (logo/assinatura/foto) e duração de sessão por profissional.",
      "management",
    );
    hideProcessing();
    showToast("Configurações salvas com sucesso!");
  };

  const loadClinicAnamnesisTemplate = async () => {
    setLoadingAnamnesisTemplate(true);
    try {
      const result = await dataService.getClinicAnamnesisTemplate();
      if (result?.success) {
        setAnamnesisTemplate(
          normalizeAnamnesisTemplate(
            result.data || getDefaultAnamnesisTemplate(),
          ),
        );
      }
    } catch (error) {
      console.error("Falha ao carregar template da anamnese:", error);
    } finally {
      setLoadingAnamnesisTemplate(false);
    }
  };

  const handleSaveClinicAnamnesisTemplate = async (template: any) => {
    if (!canEditAnamnesisTemplate) {
      showToast("Apenas a coordenação pode alterar o template de anamnese.", "error");
      throw new Error("Permissão insuficiente para editar template.");
    }
    showProcessing("Salvando personalização da ficha...");
    const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || '').trim();
    const result = await dataService.saveClinicAnamnesisTemplate(template, workspaceId || undefined);
    if (!result?.success) {
      hideProcessing();
      throw new Error(
        result?.error || "Não foi possível salvar o template da anamnese.",
      );
    }
    const normalizedSavedTemplate = normalizeAnamnesisTemplate(
      result?.data || template,
    );
    setAnamnesisTemplate(normalizedSavedTemplate);
    onAddActivityLog(
      "Template de anamnese atualizado",
      "A coordenação personalizou perguntas e campos da ficha de anamnese.",
      "management",
    );
    hideProcessing();
    showToast("Dados salvos com sucesso!");
    return normalizedSavedTemplate;
  };

  const formatCurrency = (value: any) =>
    (Number(value) || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  const parseCurrencyValue = (value: any) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value || "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const isPatientFinanciallyActive = (patient: any) => {
    const status = String(patient?.status || "active").toLowerCase();
    return !["inactive", "inativo", "deleted", "cancelled", "canceled", "cancelado"].includes(status) && patient?.clinic_id !== null;
  };

  const getPatientPlans = (patient: any) =>
    normalizePatientFinancialPlans(patient?.financialPlans, {
      monthlyTreatmentValue: patient?.monthlyTreatmentValue,
      monthlyFee: patient?.monthlyFee,
      billingDueDay: patient?.billingDueDay,
      billingMethod: patient?.billingMethod,
      insuranceType: patient?.insuranceType,
      insuranceName: patient?.insuranceName,
    })
      .filter(isPatientFinancialPlanComplete)
      .map(serializePatientFinancialPlanForPayload)
      .map((plan: any) => ({
        ...plan,
        amount: Number(plan.amountCents || 0) / 100,
        specialty: String(plan.serviceNameSnapshot || plan.specialty || "Não informado").trim() || "Não informado",
        dueDay: plan.dueDay ? Math.min(31, Math.max(1, Number(plan.dueDay))) : null,
        billingMethod: String(plan.billingMethod || plan.paymentMethod || "").toLowerCase(),
        payerType: plan.billingMode === "INSURANCE" ? "convenio" : String(plan.billingMode || "PRIVATE").toLowerCase(),
        payerLabel:
          PATIENT_FINANCIAL_BILLING_MODE_OPTIONS.find((option) => option.value === plan.billingMode)?.label ||
          "Particular",
        insuranceName: String(plan.payerNameSnapshot || plan.insuranceName || patient?.insuranceName || "").trim(),
      }))
      .filter((plan: any) => plan.amount > 0);

  const isSameFinancialMonth = (dateValue: any, monthKey: string) => {
    const raw = String(dateValue || "").trim();
    if (!raw || !monthKey) return false;
    const date = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString().slice(0, 7) === monthKey;
  };

  const addToMap = (map: Map<string, any>, key: string, amount: number, extra: any = {}) => {
    const safeKey = key || "Não informado";
    const current = map.get(safeKey) || { label: safeKey, amount: 0, patients: new Set<string>(), ...extra };
    current.amount += amount;
    if (extra.patientId) current.patients.add(String(extra.patientId));
    map.set(safeKey, current);
  };

  const financialDashboard = useMemo(() => {
    const clinicPatientIds = new Set((allPatients || []).map((patient: any) => String(patient?.id)));
    const patientById = new Map((allPatients || []).map((patient: any) => [String(patient?.id), patient]));
    const activePatients = (allPatients || []).filter(isPatientFinanciallyActive);
    const inactivePatients = (allPatients || []).filter((patient: any) => !isPatientFinanciallyActive(patient));
    const normalizeStatus = (status: any) => {
      const normalized = String(status || "").toLowerCase();
      if (["paid", "pago"].includes(normalized)) return "paid";
      if (["canceled", "cancelled", "cancelado"].includes(normalized)) return "canceled";
      return normalized || "pending";
    };
    const monthPayments = (payments || []).filter((payment: any) => {
      const belongsToClinicPatient = clinicPatientIds.has(String(payment?.patient_id || payment?.patientId || ""));
      const referenceDate =
        payment?.payment_date ||
        payment?.paymentDate ||
        payment?.due_date ||
        payment?.dueDate;
      return isSameFinancialMonth(referenceDate, financialMonth) && belongsToClinicPatient;
    });
    const paidPayments = monthPayments.filter((payment: any) => normalizeStatus(payment?.status) === "paid");
    const pendingPayments = monthPayments.filter((payment: any) => normalizeStatus(payment?.status) === "pending");
    const monthProfessionalPayments = (professionalPayments || []).filter((payment: any) => {
      const referenceDate =
        payment?.payment_date ||
        payment?.paymentDate ||
        payment?.due_date ||
        payment?.dueDate;
      return isSameFinancialMonth(referenceDate, financialMonth);
    });
    const paidProfessionalPayments = monthProfessionalPayments.filter((payment: any) => normalizeStatus(payment?.status) === "paid");
    const pendingProfessionalPayments = monthProfessionalPayments.filter((payment: any) => normalizeStatus(payment?.status) === "pending");
    const monthFinancialEntries = (financialEntries || []).filter((entry: any) =>
      isSameFinancialMonth(entry?.occurred_on || entry?.occurredOn || entry?.date, financialMonth),
    );
    const operationalExpenses = monthFinancialEntries
      .filter((entry: any) => String(entry?.entry_type || entry?.type || "expense").toLowerCase() === "expense")
      .reduce((sum: number, entry: any) => sum + parseCurrencyValue(entry?.amount), 0);

    const specialtyMap = new Map<string, any>();
    const payerMap = new Map<string, any>();
    const insuranceMap = new Map<string, any>();
    const billingMethodMap = new Map<string, any>();
    const dueRows: any[] = [];

    const ensureSpecialtyRow = (label: string) => {
      const safeLabel = String(label || "Não informado").trim() || "Não informado";
      const current = specialtyMap.get(safeLabel) || {
        label: safeLabel,
        amount: 0,
        projected: 0,
        realized: 0,
        pending: 0,
        overdue: 0,
        professionalPaid: 0,
        allocatedOperationalExpenses: 0,
        contributionProfit: 0,
        netProfit: 0,
        contributionMarginPct: 0,
        netMarginPct: 0,
        averageTicket: 0,
        realizedTicket: 0,
        patients: new Set<string>(),
        paidPatients: new Set<string>(),
      };
      specialtyMap.set(safeLabel, current);
      return current;
    };

    const addSpecialtyMetric = (
      specialty: string,
      amount: number,
      field: "projected" | "realized" | "pending" | "overdue" | "professionalPaid",
      patientId?: any,
    ) => {
      const row = ensureSpecialtyRow(specialty);
      row[field] += amount;
      if (field === "projected") row.amount += amount;
      if (patientId) {
        row.patients.add(String(patientId));
        if (field === "realized") row.paidPatients.add(String(patientId));
      }
    };

    const distributePatientAmountBySpecialty = (patient: any, amount: number, explicitSpecialty?: any) => {
      const safeAmount = Number(amount) || 0;
      const specialty = String(explicitSpecialty || "").trim();
      if (specialty) {
        return [{ specialty, amount: safeAmount }];
      }
      const plans = getPatientPlans(patient);
      if (!plans.length) return [{ specialty: "Não informado", amount: safeAmount }];
      if (plans.length === 1) return [{ specialty: plans[0].specialty, amount: safeAmount }];
      const total = plans.reduce((sum: number, plan: any) => sum + (Number(plan.amount) || 0), 0);
      if (total <= 0) return [{ specialty: plans[0].specialty, amount: safeAmount }];
      return plans.map((plan: any) => ({
        specialty: plan.specialty,
        amount: safeAmount * ((Number(plan.amount) || 0) / total),
      }));
    };

    let projection = 0;
    activePatients.forEach((patient: any) => {
      const plans = getPatientPlans(patient);
      plans.forEach((plan: any) => {
        projection += plan.amount;
        addSpecialtyMetric(plan.specialty, plan.amount, "projected", patient.id);
        addToMap(payerMap, plan.payerLabel, plan.amount, { patientId: patient.id });
        if (plan.payerType === "convenio") {
          addToMap(insuranceMap, plan.insuranceName || "Convênio não informado", plan.amount, { patientId: patient.id });
        }
        addToMap(billingMethodMap, plan.billingMethod ? plan.billingMethod.toUpperCase() : plan.payerLabel, plan.amount, { patientId: patient.id });
        if (plan.dueDay) {
          const dueDate = new Date(`${financialMonth || new Date().toISOString().slice(0, 7)}-01T00:00:00`);
          dueDate.setDate(Math.min(plan.dueDay, new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate()));
          dueRows.push({
            patientId: patient.id,
            patientName: patient.name || "Paciente",
            specialty: plan.specialty,
            amount: plan.amount,
            dueDay: plan.dueDay,
            dueDate: dueDate.toISOString().slice(0, 10),
            billingMethod: plan.billingMethod ? plan.billingMethod.toUpperCase() : plan.payerLabel,
            payerType: plan.payerLabel,
            insuranceName: plan.insuranceName,
          });
        }
      });
    });

    const realized = paidPayments.reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
    const pendingAmount = pendingPayments.reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
    const overduePayments = pendingPayments.filter((payment: any) => {
      const days = daysUntilDate(payment?.due_date || payment?.dueDate);
      return days !== null && days < 0;
    });
    const overdueAmount = overduePayments.reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
    const professionalPaid = paidProfessionalPayments.reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
    const professionalPending = pendingProfessionalPayments.reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
    const averageTicket = activePatients.length ? projection / activePatients.length : 0;
    const newPatients = activePatients.filter((patient: any) => isSameFinancialMonth(patient?.created_at || patient?.createdAt, financialMonth));
    const newEntriesValue = newPatients.reduce(
      (sum: number, patient: any) => sum + getPatientPlans(patient).reduce((planSum: number, plan: any) => planSum + plan.amount, 0),
      0,
    );
    const cancellations = inactivePatients.filter((patient: any) =>
      isSameFinancialMonth(patient?.deletedAt || patient?.unlinkedAt || patient?.cancelledAt || patient?.updated_at || patient?.updatedAt, financialMonth),
    );
    const cancellationValue = cancellations.reduce(
      (sum: number, patient: any) => sum + getPatientPlans(patient).reduce((planSum: number, plan: any) => planSum + plan.amount, 0),
      0,
    );
    const outstanding = Math.max(projection - realized, 0);
    const cashIn = realized;
    const cashOut = professionalPaid + operationalExpenses;
    const cashFlow = cashIn - cashOut;
    const contributionMarginValue = realized - professionalPaid;
    const contributionMarginPct = realized > 0 ? (contributionMarginValue / realized) * 100 : 0;
    const netProfit = realized - professionalPaid - operationalExpenses;
    const netMarginPct = realized > 0 ? (netProfit / realized) * 100 : 0;

    paidPayments.forEach((payment: any) => {
      const patientId = payment?.patient_id || payment?.patientId;
      const patient = patientById.get(String(patientId));
      distributePatientAmountBySpecialty(patient, parseCurrencyValue(payment?.amount), payment?.specialty)
        .forEach((entry: any) => addSpecialtyMetric(entry.specialty, entry.amount, "realized", patientId));
    });
    pendingPayments.forEach((payment: any) => {
      const patientId = payment?.patient_id || payment?.patientId;
      const patient = patientById.get(String(patientId));
      const paymentKey = String(payment?.id || "").trim();
      const isOverdue = overduePayments.some((overdue: any) =>
        overdue === payment || (paymentKey && String(overdue?.id || "").trim() === paymentKey),
      );
      distributePatientAmountBySpecialty(patient, parseCurrencyValue(payment?.amount), payment?.specialty)
        .forEach((entry: any) => {
          addSpecialtyMetric(entry.specialty, entry.amount, "pending", patientId);
          if (isOverdue) addSpecialtyMetric(entry.specialty, entry.amount, "overdue", patientId);
        });
    });
    paidProfessionalPayments.forEach((payment: any) => {
      const professionalId = String(payment?.professional_id || payment?.professionalId || "").trim();
      const professional = therapistMembersById[professionalId] || {};
      const professionalSpecialties = Array.isArray(professional?.specialties)
        ? professional.specialties
        : String(professional?.specialties || professional?.specialty || professional?.professionalSpecialty || "")
            .split(/[,;|]/);
      const specialty = String(
        payment?.specialty ||
        professionalSpecialties.find((item: any) => String(item || "").trim()) ||
        "Não informado",
      ).trim();
      addSpecialtyMetric(specialty, parseCurrencyValue(payment?.amount), "professionalPaid");
    });

    const specialtyBasisTotal = realized > 0 ? realized : projection;
    Array.from(specialtyMap.values()).forEach((row: any) => {
      const basis = realized > 0 ? row.realized : row.projected;
      row.allocatedOperationalExpenses = specialtyBasisTotal > 0
        ? operationalExpenses * (basis / specialtyBasisTotal)
        : 0;
      row.contributionProfit = row.realized - row.professionalPaid;
      row.netProfit = row.realized - row.professionalPaid - row.allocatedOperationalExpenses;
      row.contributionMarginPct = row.realized > 0 ? (row.contributionProfit / row.realized) * 100 : 0;
      row.netMarginPct = row.realized > 0 ? (row.netProfit / row.realized) * 100 : 0;
      row.averageTicket = row.patients.size ? row.projected / row.patients.size : 0;
      row.realizedTicket = row.paidPatients.size ? row.realized / row.paidPatients.size : 0;
    });

    const dreRows = [
      { label: "Faturamento projetado", value: projection, type: "income", info: "Soma das mensalidades cadastradas nos pacientes ativos." },
      { label: "Faturamento realizado", value: realized, type: "income", info: "Pagamentos com status pago no mês selecionado." },
      { label: "Cobranças pendentes registradas", value: pendingAmount, type: "total", info: "Cobranças já lançadas sem comprovante/pagamento." },
      { label: "Inadimplência", value: -overdueAmount, type: "expense", info: `${overduePayments.length} pagamento(s) vencido(s) sem baixa.` },
      { label: "A receber projetado", value: outstanding, type: "total", info: "Diferença entre projeção mensal e pagamentos pagos." },
      { label: "Pagamentos a profissionais", value: -professionalPaid, type: "expense", info: "Repasses profissionais pagos no mês." },
      { label: "Despesas operacionais", value: -operationalExpenses, type: "expense", info: "Saídas registradas no fluxo de caixa da clínica." },
      { label: "Fluxo de caixa líquido", value: cashFlow, type: cashFlow >= 0 ? "profit" : "expense", info: "Entradas pagas menos saídas pagas." },
      { label: "Lucro líquido", value: netProfit, type: netProfit >= 0 ? "profit" : "expense", info: `Margem líquida ${netMarginPct.toFixed(1)}%.` },
      { label: "Margem de contribuição", value: contributionMarginValue, type: contributionMarginValue >= 0 ? "profit" : "expense", info: `${contributionMarginPct.toFixed(1)}% após repasses profissionais pagos.` },
      { label: "Novas entradas", value: newEntriesValue, type: "income", info: `${newPatients.length} paciente(s) cadastrados no mês.` },
      { label: "Cancelamentos", value: -cancellationValue, type: "expense", info: `${cancellations.length} saída(s) no mês selecionado.` },
      { label: "Ticket médio projetado", value: averageTicket, type: "profit", info: "Projeção dividida pelo número de pacientes ativos." },
    ];

    const monthDates = Array.from({ length: 6 }, (_, index) => {
      const base = financialMonth ? new Date(`${financialMonth}-01T00:00:00`) : new Date();
      base.setMonth(base.getMonth() - (5 - index));
      return base;
    });
    const revenueRows = monthDates.map((date) => {
      const key = date.toISOString().slice(0, 7);
      const paid = (payments || [])
        .filter((payment: any) => String(payment?.status || "paid").toLowerCase() === "paid" && isSameFinancialMonth(payment?.payment_date || payment?.paymentDate, key))
        .filter((payment: any) => clinicPatientIds.has(String(payment?.patient_id || payment?.patientId || "")))
        .reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
      const professional = (professionalPayments || [])
        .filter((payment: any) => normalizeStatus(payment?.status) === "paid" && isSameFinancialMonth(payment?.payment_date || payment?.paymentDate, key))
        .reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
      return {
        month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        revenue: paid,
        profit: paid - professional,
      };
    });

    return {
      activePatients,
      patientCount: activePatients.length,
      projection,
      realized,
      pendingAmount,
      overdueAmount,
      overduePayments,
      outstanding,
      cashIn,
      cashOut,
      cashFlow,
      professionalPaid,
      professionalPending,
      operationalExpenses,
      contributionMarginValue,
      contributionMarginPct,
      netProfit,
      netMarginPct,
      averageTicket,
      newPatients,
      newEntriesValue,
      cancellations,
      cancellationValue,
      dreRows,
      revenueRows,
      specialtyRows: Array.from(specialtyMap.values())
        .map((row: any) => ({
          ...row,
          patients: row.patients.size,
          paidPatients: row.paidPatients.size,
        }))
        .sort((a, b) => b.projected - a.projected),
      payerRows: Array.from(payerMap.values()).map((row: any) => ({ ...row, patients: row.patients.size })).sort((a, b) => b.amount - a.amount),
      insuranceRows: Array.from(insuranceMap.values()).map((row: any) => ({ ...row, patients: row.patients.size })).sort((a, b) => b.amount - a.amount),
      billingMethodRows: Array.from(billingMethodMap.values()).map((row: any) => ({ ...row, patients: row.patients.size })).sort((a, b) => b.amount - a.amount),
      dueRows: dueRows.sort((a, b) => a.dueDay - b.dueDay || a.patientName.localeCompare(b.patientName, "pt-BR")),
      monthPayments,
      paidPayments,
      pendingPayments,
      professionalPayments: monthProfessionalPayments.sort((a: any, b: any) => String(a.due_date || a.payment_date || '').localeCompare(String(b.due_date || b.payment_date || ''))),
      paidProfessionalPayments,
      pendingProfessionalPayments,
    };
  }, [allPatients, financialEntries, financialMonth, payments, professionalPayments, therapistMembersById]);

  const dreData = financialDashboard.dreRows;
  const revenueHistory = financialDashboard.revenueRows;
  const compensationForecast = financialDashboard.dueRows.slice(0, 6);

  const COLORS = ["#7a32fc", "#6AD2FF", "#EFF4FB", "#A3AED0"];

  const renderAgendaContent = () => (
    <ClinicalAgendaBoard
      agenda={normalizedAgenda}
      patients={allPatients}
      rooms={rooms}
      teamMembers={therapistFilterOptions}
      currentUser={user}
      currentDate={calendarDate}
      view={agendaView}
      onDateChange={setCalendarDate}
      onViewChange={handleAgendaViewChange}
      onCreateAppointment={openNewAppointmentAt}
      onEditAppointment={handleEditAppointment}
      onConfirmAppointment={handleConfirmAppointmentFromAgenda}
      onCancelAppointment={handleCancelAppointmentFromAgenda}
      onDeleteAppointment={handleDeleteAppointmentFromAgenda}
      onOpenPatient={onPatientClick}
      onStartSession={(appointment: any) =>
        {
          const sessionAppointment = buildAppointmentSessionContext(appointment);
          if (!sessionAppointment?.appointmentId) {
            showToast("Esta consulta ainda não foi salva no servidor. Atualize a agenda e tente novamente.", "error");
            return;
          }
          setScheduledSessionContext(sessionAppointment);
          setScheduledSessionStartKey(
            `${sessionAppointment.appointmentId}:${Date.now()}`,
          );
          onPatientClick(
            sessionAppointment?.patientId || sessionAppointment?.patient_id,
            { tab: "session" },
            sessionAppointment?.patientName || sessionAppointment?.patient_name,
          );
        }
      }
      theme={theme}
    />
  );

  const renderRoomsContent = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100 gap-4">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">{canManageRooms ? "Salas" : "Reservas de Sala"}</h3>
          <p className="text-slate-500 text-sm hidden sm:block">
            {canManageRooms ? "Configure as salas disponíveis." : "Visualize o calendário de reservas da clínica."}
          </p>
        </div>
        {canManageRooms && (
          <button
            onClick={() => setIsEditingRooms(!isEditingRooms)}
            className={`px-4 sm:px-6 py-2 sm:py-3 rounded-2xl font-bold text-[10px] sm:text-sm transition-all flex items-center justify-center gap-2 ${isEditingRooms ? "bg-slate-100 text-slate-600" : "bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20"}`}
          >
            {isEditingRooms ? "Ver Reservas" : "Editar Salas"}
          </button>
        )}
      </div>

      {canManageRooms && isEditingRooms ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 sticky top-6">
              <h4 className="text-sm font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Plus size={18} className="text-[#7a32fc]" />
                {editingRoom ? "Editar Sala" : "Nova Sala"}
              </h4>
              <form
                onSubmit={editingRoom ? handleUpdateRoom : handleAddRoom}
                className="space-y-4"
              >
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                    Nome da Sala
                  </label>
                  <input
                    type="text"
                    value={newRoom.name}
                    onChange={(e) =>
                      setNewRoom({ ...newRoom, name: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Ex: Sala 01"
                    required
                  />
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">
                    O nome da sala será exibido na agenda e nos relatórios.
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                    Especialidades
                  </label>
                  <input
                    type="text"
                    value={newRoom.specialties}
                    onChange={(e) =>
                      setNewRoom({ ...newRoom, specialties: e.target.value })
                    }
                    className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-sm font-semibold focus:ring-2 focus:ring-blue-500/20 transition-all"
                    placeholder="Ex: ABA, TCC, Fono"
                  />
                  <p className="text-[9px] text-slate-400 mt-1 ml-1">
                    Especialidades ajudam a filtrar salas, mas são opcionais. Separe por vírgula.
                  </p>
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-[#7a32fc] text-white rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
                >
                  {editingRoom ? "Atualizar Sala" : "Adicionar Sala"}
                </button>
                {editingRoom && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRoom(null);
                      setNewRoom({ name: "", specialties: "" });
                    }}
                    className="w-full py-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest"
                  >
                    Cancelar Edição
                  </button>
                )}
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 mb-6">
                Salas Cadastradas
              </h4>
              <div className="grid gap-4">
                {rooms.map((room) => {
                  const roomActive = room.is_active !== false && room.isActive !== false;
                  return (
                  <div
                    key={room.id}
                    className={`flex items-center justify-between p-4 rounded-2xl border group hover:bg-white hover:shadow-md transition-all ${roomActive ? "bg-slate-50 border-slate-100" : "bg-slate-100/70 border-slate-200 opacity-75"}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white text-slate-400 rounded-xl flex items-center justify-center group-hover:text-[#7a32fc] transition-all">
                        <DoorOpen size={24} />
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900 flex items-center gap-2">
                          {room.name}
                          {!roomActive && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                              Inativa
                            </span>
                          )}
                        </h5>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(Array.isArray(room.specialties) ? room.specialties : []).map((s: string) => (
                            <span
                              key={s}
                              className="px-2 py-0.5 bg-white text-slate-500 rounded-full text-[9px] font-bold uppercase tracking-wider border border-slate-100"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditRoom(room)}
                        className="p-2 text-slate-400 hover:text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDeleteRoom(room.id)}
                        className={`p-2 rounded-xl transition-all ${roomActive ? "text-slate-400 hover:text-red-500 hover:bg-red-50" : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"}`}
                        title={roomActive ? "Desativar sala" : "Reativar sala"}
                      >
                        {roomActive ? <Trash2 size={18} /> : <CheckCircle2 size={18} />}
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <RoomReservation
          user={user}
          rooms={rooms}
          reservations={roomReservations}
          onDeleteReservation={onDeleteRoomReservation}
          onBack={() => {
            if (canManageRooms) setIsEditingRooms(true);
          }}
        />
      )}
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-8 sm:space-y-12 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1fr)]">
        <section
          className={`relative min-h-[220px] overflow-hidden rounded-[30px] border p-6 sm:min-h-[260px] sm:p-8 lg:p-10 ${
            theme === "dark"
              ? "border-violet-400/30 bg-[#0b1024] shadow-[0_20px_65px_rgba(124,58,237,0.22)]"
              : "border-violet-200/80 bg-white shadow-[0_20px_65px_rgba(124,58,237,0.16)]"
          }`}
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(139,92,246,0.22)_0%,rgba(168,85,247,0.12)_38%,transparent_72%)] blur-2xl" />
            <div className="absolute -right-[22%] top-1/2 hidden h-[162%] w-[78%] -translate-y-1/2 items-center justify-center lg:flex">
              <img
                src="/verto-3d-transparent.png"
                alt=""
                className="h-full w-full object-contain opacity-30 drop-shadow-[0_36px_80px_rgba(88,28,135,0.42)]"
              />
            </div>
          </div>

          <div className="relative z-10 grid h-full items-center gap-6 lg:grid-cols-[minmax(0,0.68fr)_minmax(160px,0.32fr)]">
            <div className="max-w-xl">
              <div
                className={`mb-5 text-[11px] font-medium uppercase tracking-[0.2em] ${
                  theme === "dark" ? "text-violet-100/80" : "text-violet-700"
                }`}
              >
                <span>{dashboardGreeting.period} </span>
                <strong className="font-black">{dashboardGreeting.firstName}</strong>
              </div>
              <h2
                className={`max-w-2xl text-2xl font-black leading-tight tracking-tight sm:text-3xl lg:text-4xl ${
                  theme === "dark" ? "text-white" : "text-slate-950"
                }`}
              >
                {dashboardHeadlineMessage}
              </h2>
            </div>

            <div className="flex justify-center lg:hidden">
              <div className="relative flex h-40 w-40 items-center justify-center sm:h-52 sm:w-52">
                <img
                  src="/verto-3d-transparent.png"
                  alt="Logo 3D da Verto"
                  className="h-full w-full object-contain drop-shadow-[0_26px_45px_rgba(88,28,135,0.25)]"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 xl:grid-cols-1">
          {dashboardDailyStats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              onClick={() => {
                if (stat.id === "birthdays") {
                  setPatientQuickFilter("birthdaysToday");
                  navigateToTab("patients");
                  return;
                }
                navigateToTab(stat.id as any);
              }}
              className={`group relative overflow-hidden rounded-[26px] border p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl ${
                theme === "dark"
                  ? "border-white/10 bg-white/[0.04] hover:border-violet-300/30"
                  : "border-slate-100 bg-white hover:border-violet-200"
              }`}
            >
              <span className={`absolute left-0 top-0 h-full w-1.5 ${stat.accent}`} />
              <div className="flex items-start justify-between gap-4 pl-2">
                <div>
                  <div
                    className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${stat.iconBg} ${stat.color} transition-transform group-hover:scale-105`}
                  >
                    <stat.icon size={22} />
                  </div>
                  <p className={`text-[11px] font-black uppercase tracking-[0.2em] ${stat.color}`}>
                    {stat.label}
                  </p>
                  <p className={`mt-1 text-[11px] font-bold ${theme === "dark" ? "text-slate-400" : "text-slate-400"}`}>
                    {stat.hint}
                  </p>
                </div>
                <span className={`text-4xl font-black leading-none ${theme === "dark" ? "text-white" : "text-slate-950"}`}>
                  {stat.value}
                </span>
              </div>
            </button>
          ))}
        </div>
        {canAccessClinicFinance && overduePatientPayments.length > 0 && (
          <button
            type="button"
            onClick={() => navigateToTab("financial")}
            className={`w-full rounded-[24px] border p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${
              theme === "dark"
                ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/80 p-3 text-amber-600">
                <AlertCircle size={20} />
              </div>
              <div>
                <p className="text-sm font-black">
                  Pagamentos vencidos sem registro
                </p>
                <p className="mt-1 text-xs font-semibold opacity-80">
                  {overduePatientPayments.slice(0, 2).map((payment: any) =>
                    payment?.patient_name || payment?.patientName || "Paciente",
                  ).join(", ")}
                  {overduePatientPayments.length > 2 ? ` e mais ${overduePatientPayments.length - 2}` : ""}
                </p>
              </div>
            </div>
          </button>
        )}
      </div>

      {!isTherapist && (
        <section className="space-y-4 sm:space-y-6">
          <StackedDomainStatusChart
            protocols={protocols}
            history={patientsHistory}
            patients={allPatients}
          />
        </section>
      )}

      {/* Agenda Global Section */}
      <section className="space-y-4 sm:space-y-6">
        {renderAgendaContent()}
      </section>

      {/* Gestão de Salas Section */}
      <section className="space-y-4 sm:space-y-6">
        {renderRoomsContent()}
      </section>

      {capabilityStatusForRole("team-compensation") !== "none" && (
        <section className="space-y-4 sm:space-y-6">
          <div className="bg-white p-4 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <Users size={20} className="sm:w-6 sm:h-6" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Equipe
              </h2>
            </div>
            <TeamManagement
              user={user}
              onRequestUpgrade={() => navigateToTab("billing")}
              activePatientCount={(allPatients || []).filter((patient: any) => String(patient?.status || "active").toLowerCase() !== "inactive").length}
              memberSessionDurations={professionalSessionDurations}
              onUpdateMemberSessionDuration={(member, duration) =>
                setProfessionalSessionDurations((prev) => ({
                  ...prev,
                  [member.id]: duration,
                  [member.email]: duration,
                  [member.name]: duration,
                }))
              }
            />
          </div>
        </section>
      )}

      {/* Removed financial and performance charts as they belong to DRE */}
    </div>
  );

  const renderFinancial = () => (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Financeiro
          </h2>
          <p className="text-slate-400 text-sm font-medium hidden sm:block">
            Visão detalhada da saúde financeira da clínica
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-white border border-slate-100 rounded-xl text-[10px] sm:text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm">
            <Download size={14} className="sm:w-4 sm:h-4" /> Exportar
          </button>
          <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-[#7a32fc] text-white rounded-xl text-[10px] sm:text-xs font-bold hover:bg-blue-700 transition-all shadow-lg shadow-purple-500/20">
            <Plus size={14} className="sm:w-4 sm:h-4" /> Lançamento
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 sm:p-8 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
              <Calendar size={20} className="text-[#7a32fc]" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Período
              </p>
              <p className="text-sm font-bold text-slate-900">Março de 2024</p>
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-8">
            <div className="text-left sm:text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Margem Líquida
              </p>
              <p className="text-base sm:text-lg font-bold text-green-500">
                35.2%
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Ponto Equilíbrio
              </p>
              <p className="text-base sm:text-lg font-bold text-slate-900">
                R$ 14.166
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-8 overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="text-left">
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Descrição
                </th>
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">
                  Valor (R$)
                </th>
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">
                  % Rec.
                </th>
                <th className="pb-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">
                  Info
                </th>
              </tr>
            </thead>
            <tbody className="space-y-4">
              {dreData.map((item, i) => (
                <tr
                  key={i}
                  className={`group ${item.type === "total" || item.type === "profit" ? "bg-slate-50/50" : ""}`}
                >
                  <td
                    className={`py-3 sm:py-4 px-2 sm:px-4 rounded-l-2xl ${item.type === "profit" ? "text-base sm:text-lg font-bold text-green-600" : item.type === "total" ? "font-bold text-slate-900" : "text-slate-600 font-medium text-sm"}`}
                  >
                    {item.label}
                  </td>
                  <td
                    className={`py-3 sm:py-4 px-2 sm:px-4 text-right ${item.value < 0 ? "text-red-500" : item.type === "profit" ? "text-base sm:text-lg font-bold text-green-600" : "text-slate-900 font-bold text-sm"}`}
                  >
                    {item.value < 0
                      ? `- R$ ${Math.abs(item.value).toLocaleString()}`
                      : `R$ ${item.value.toLocaleString()}`}
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4 text-right text-slate-400 font-bold text-[10px] sm:text-xs">
                    {item.label === "Receita Bruta"
                      ? "100%"
                      : `${Math.abs((item.value / 45250) * 100).toFixed(1)}%`}
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4 rounded-r-2xl text-center">
                    <button className="p-1.5 hover:bg-white rounded-lg transition-all text-slate-300 hover:text-[#7a32fc]">
                      <FileText size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Financial Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 overflow-hidden">
        <div className="lg:col-span-2 bg-white p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-6">
            Composição de Custos
          </h3>
          <div className="overflow-x-auto no-scrollbar -mx-6 sm:mx-0 px-6 sm:px-0">
            <div className="h-[250px] sm:h-[300px] min-h-[300px] min-w-[600px] sm:min-w-0">
                  <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                <BarChart
                  data={[
                    { name: "Repasses", value: 18100 },
                    { name: "Aluguel", value: 3500 },
                    { name: "Marketing", value: 2000 },
                    { name: "Sistemas", value: 1200 },
                    { name: "Outros", value: 1800 },
                  ]}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  barGap={12}
                  barCategoryGap="30%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#F1F5F9"
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#A3AED0", fontSize: 10, fontWeight: "bold" }}
                    padding={{ left: 30, right: 30 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#A3AED0", fontSize: 10, fontWeight: "bold" }}
                  />
                  <Tooltip
                    cursor={{ fill: "#F8FAFC" }}
                    contentStyle={{ borderRadius: "16px", border: "none" }}
                  />
                  <Bar
                    dataKey="value"
                    fill="#7a32fc"
                    radius={[8, 8, 0, 0]}
                    barSize={40}
                  />
                </BarChart>
              </SafeResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-6">
            Distribuição
          </h3>
          <div className="overflow-x-auto no-scrollbar -mx-6 sm:mx-0 px-6 sm:px-0">
            <div className="h-[250px] sm:h-[300px] min-h-[300px] min-w-[300px] sm:min-w-0">
                  <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                <RePieChart>
                  <Pie
                    data={[
                      { name: "Lucro", value: 15935 },
                      { name: "Repasses", value: 18100 },
                      { name: "Custos Fixos", value: 8500 },
                      { name: "Impostos", value: 2715 },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {COLORS.map((color, index) => (
                      <Cell key={`cell-${index}`} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RePieChart>
              </SafeResponsiveContainer>
            </div>
          </div>
          <div className="space-y-3 mt-6 border-t border-slate-50 pt-6">
            {["Lucro", "Repasses", "Custos Fixos", "Impostos"].map(
              (label, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[11px] sm:text-xs font-semibold"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2.5 h-2.5 rounded-full shadow-sm"
                      style={{ backgroundColor: COLORS[i] }}
                    />
                    <span className="text-slate-500">{label}</span>
                  </div>
                  <span className="text-slate-900 font-bold">
                    R${" "}
                    {dreData
                      .find((d) => d.label.includes(label))
                      ?.value.toLocaleString() || 0}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (view === "patient" && selectedPatientId) {
    const patient = allPatients.find(
      (p) => String(p.id) === String(selectedPatientId),
    );
    if (!patient) {
      return (
        <div className="min-h-screen bg-[#F4F7FE] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 max-w-lg w-full text-center">
            <h2 className="text-xl font-black text-slate-900 mb-2">
              Paciente não encontrado
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              Este agendamento não está vinculado a um paciente válido no
              cadastro.
            </p>
            <button
              onClick={() => setView("home")}
              className="px-5 py-2.5 rounded-xl bg-[#7a32fc] text-white font-semibold"
            >
              Voltar ao painel
            </button>
          </div>
        </div>
      );
    }
    const patientSidebarExpanded = isSidebarExpanded;
    return (
      <div className="min-h-screen bg-[#F4F7FE] flex">
        {/* Sidebar */}
        <div
          onMouseEnter={() => setIsSidebarExpanded(true)}
          onMouseLeave={() => setIsSidebarExpanded(false)}
          className={`${patientSidebarExpanded ? "w-64" : "w-20"} bg-white hidden lg:flex flex-col p-5 sticky top-0 h-screen border-r border-slate-100 transition-all duration-300 ease-in-out z-20`}
        >
          <div
            className={`flex items-center ${patientSidebarExpanded ? "gap-2" : "justify-center"} mb-7 px-1 transition-all duration-300`}
          >
            <LogoVerto size={38} />
            {patientSidebarExpanded && (
              <div>
                <span className="font-black text-xl text-slate-900 tracking-tighter block leading-none lowercase">
                  verto
                </span>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.18em]">
                  Gestão
                </span>
              </div>
            )}
          </div>

          <nav className="space-y-1 flex-1 overflow-y-auto no-scrollbar pr-1">
            {filterTabsByRole([
              {
                id: "dashboard",
                label: "Painel",
                icon: LayoutDashboard,
              },
              {
                id: "patients",
                label: "Pacientes",
                icon: ClipboardList,
              },
              {
                id: "protocols",
                label: "Protocolos",
                icon: BookOpenCheck,
              },
              { id: "logs", label: "Log de Atividades", icon: History },
              {
                id: "settings",
                label: "Configurações",
                icon: Settings,
              },
              {
                id: "financial",
                label: "Financeiro",
                icon: DollarSign,
              },
              {
                id: "flow",
                label: "Fluxo Verto",
                icon: Zap,
              },
              {
                id: "birthdays",
                label: "Aniversariantes",
                icon: Heart,
              },
            ]).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  navigateToTab(item.id as any);
                  setView("home");
                }}
                className={`w-full flex items-center ${patientSidebarExpanded ? "gap-3 px-4" : "justify-center"} py-3.5 rounded-2xl transition-all font-medium text-sm ${
                  activeTab === item.id
                    ? "text-[#7a32fc] bg-purple-50 shadow-sm"
                    : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
                }`}
                title={!patientSidebarExpanded ? item.label : ""}
              >
                <item.icon size={20} />
                {patientSidebarExpanded && item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-4 border-t border-slate-50">
            <div
              className={`bg-slate-50 rounded-2xl ${patientSidebarExpanded ? "p-3 mb-3" : "p-2 mb-2"} transition-all`}
            >
              <div className={`flex items-center ${patientSidebarExpanded ? "gap-3" : "justify-center"}`}>
                <div className={`${patientSidebarExpanded ? "w-10 h-10 rounded-xl" : "w-9 h-9 rounded-lg"} bg-white flex items-center justify-center font-bold text-[#7a32fc] shadow-sm overflow-hidden`}>
                  {coordinatorAvatarUrl ? (
                    <img src={coordinatorAvatarUrl} alt={user?.name || "Perfil"} className="w-full h-full object-cover" />
                  ) : (
                    user.name?.[0]
                  )}
                </div>
                {patientSidebarExpanded && (
                  <div className="overflow-hidden">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {normalizeUtf8Text(user.name)}
                    </p>
                    <p className="text-xs font-medium text-slate-400 truncate">
                      {user.email}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={onLogout}
              className={`w-full flex items-center ${patientSidebarExpanded ? "gap-3 justify-start px-3" : "justify-center px-2"} py-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all font-bold text-sm`}
            >
              <LogOut size={18} />
              {patientSidebarExpanded && "Sair do Sistema"}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* Header */}
          <header
            className={`sticky top-0 z-30 flex items-center justify-between gap-2 px-3 py-2.5 backdrop-blur-md sm:px-4 lg:px-6 ${
              theme === "dark"
                ? "bg-[#0f172a]/85 border-b border-slate-800/80"
                : "bg-[#F4F7FE]/85 border-b border-slate-100/90"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <button
                onClick={() => {
                  setView("home");
                  setActiveTab("dashboard");
                  setTabHistory(["dashboard"]);
                }}
                className={`shrink-0 rounded-xl border p-2 shadow-sm transition-all ${
                  theme === "dark"
                    ? "bg-[#0b1a33] text-slate-300 border-slate-700 hover:text-violet-300"
                    : "bg-white text-slate-400 border-slate-100 hover:text-[#7a32fc]"
                }`}
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
              <div className="min-w-0">
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-slate-400">
                  Prontuário
                </p>
                <h1 className="max-w-[13rem] text-base font-semibold leading-snug text-slate-900 sm:max-w-none lg:text-2xl">
                  Prontuário do Paciente
                </h1>
              </div>
            </div>

            <div
              className={`flex shrink-0 items-center gap-1 rounded-2xl border p-1 shadow-sm sm:gap-2 lg:gap-4 lg:p-2 ${
                theme === "dark"
                  ? "bg-[#0b1a33] border-slate-700"
                  : "bg-white border-slate-100"
              }`}
            >
              <button
                onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
                className={`rounded-xl p-2 transition-all sm:p-2.5 ${
                  theme === "dark"
                    ? "text-slate-300 hover:text-slate-100 hover:bg-[#122544]"
                    : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
                title={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
              >
                {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <SettingsMenu
                user={user}
                onLogout={onLogout}
                onViewTeam={() => {
                  navigateToTab("team");
                  setView("home");
                }}
                onOpenInvitations={() => setShowInvitationModal(true)}
                onViewProfile={() => {
                  navigateToTab("settings");
                  setView("home");
                }}
                onViewBilling={() => {
                  navigateToTab("billing");
                  setView("home");
                }}
                onOpenOnboarding={onOpenOnboarding}
              />

              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-50 hover:text-slate-600 lg:hidden sm:p-2.5"
              >
                <Menu size={20} />
              </button>
            </div>
          </header>

          {/* Mobile Menu Drawer */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100] lg:hidden"
                />
                <motion.div
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  className="fixed top-0 right-0 bottom-0 w-[280px] bg-white z-[101] lg:hidden shadow-2xl flex flex-col p-6"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <LogoVerto size={40} />
                      <span className="font-black text-xl text-slate-900 tracking-tighter lowercase">
                        verto
                      </span>
                    </div>
                    <button
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="p-2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={24} />
                    </button>
                  </div>

                  <nav className="space-y-1 flex-1 overflow-y-auto no-scrollbar">
                    {filterTabsByRole([
                      {
                        id: "dashboard",
                        label: "Painel",
                        icon: LayoutDashboard,
                      },
                      {
                        id: "patients",
                        label: "Pacientes",
                        icon: ClipboardList,
                      },
                      {
                        id: "protocols",
                        label: "Protocolos",
                        icon: BookOpenCheck,
                      },
                      { id: "logs", label: "Log de Atividades", icon: History },
                      {
                        id: "settings",
                        label: "Configurações",
                        icon: Settings,
                      },
                      {
                        id: "financial",
                        label: "Financeiro",
                        icon: DollarSign,
                        badge: "BETA",
                      },
                      {
                        id: "flow",
                        label: "Verto Flow",
                        icon: Zap,
                        badge: "EM BREVE",
                      },
                      {
                        id: "birthdays",
                        label: "Aniversariantes",
                        icon: Heart,
                      },
                    ]).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          navigateToTab(item.id as any);
                          setView("home");
                          setIsMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all font-medium text-sm ${
                          activeTab === item.id
                            ? "text-[#7a32fc] bg-blue-50"
                            : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
                        }`}
                      >
                        <item.icon size={18} />
                        {item.label}
                        {item.badge && (
                          <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-black text-amber-950 shadow-sm shadow-amber-300/50 ring-1 ring-amber-500/30">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </nav>

                  <div className="mt-auto pt-6 border-t border-slate-50">
                    <button
                      onClick={onLogout}
                      className="w-full flex items-center gap-4 px-4 py-3.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all font-bold text-sm"
                    >
                      <LogOut size={18} />
                      Sair do Sistema
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <main className="min-w-0 px-0 pb-20 sm:p-4 lg:p-8">
            <PatientDetailView
              patient={patient}
              themeMode={theme}
              onBack={() => setView("home")}
              hideBackButton={true}
              clinicContext={{
                userId: user?.id || "",
                clinicName:
                  user?.clinicSettings?.clinicName ||
                  user?.name ||
                  "Clínica Verto",
                cnpj: user?.clinicSettings?.clinicCnpj || "",
                address: user?.clinicSettings?.clinicAddress || "",
                logoUrl:
                  user?.clinicSettings?.clinicLogoUrl ||
                  user?.profilePicture ||
                  buildInitialAvatarDataUrl(user?.name),
                professionalName: user?.name || "Profissional",
                crp: user?.crp || user?.clinicSettings?.crp || "",
                signatureUrl: user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null,
                defaultSessionDuration: user?.clinicSettings?.defaultSessionDuration || defaultSessionDuration || 50,
              }}
              scheduledSession={
                String(scheduledSessionContext?.patientId || scheduledSessionContext?.patient_id || "") === String(patient?.id || "")
                  ? scheduledSessionContext
                  : null
              }
              startScheduledSessionKey={
                String(scheduledSessionContext?.patientId || scheduledSessionContext?.patient_id || "") === String(patient?.id || "")
                  ? scheduledSessionStartKey
                  : ""
              }
              initialTab={patientOpenTab}
              openAnamnesisOnLoad={openAnamnesisOnPatientOpen}
              onAnamnesisOpenConsumed={() => setOpenAnamnesisOnPatientOpen(false)}
              history={patientsHistory.filter((h) => {
                const itemPatientId = String(h?.patientId ?? h?.patient_id ?? "").trim();
                const currentPatientId = String(selectedPatientId ?? "").trim();
                const currentPatientEmail = String(
                  (allPatients || []).find((p: any) => String(p?.id ?? "").trim() === currentPatientId)?.email || ""
                )
                  .trim()
                  .toLowerCase();
                const itemPatientEmail = String(h?.patient_email ?? h?.email ?? "").trim().toLowerCase();
                const byId = itemPatientId !== "" && itemPatientId === currentPatientId;
                const byEmail = currentPatientEmail !== "" && itemPatientEmail === currentPatientEmail;
                return byId || byEmail;
              })}
              notes={therapistNotes.filter((n) => {
                const itemPatientId = String(n?.patientId ?? n?.patient_id ?? "").trim();
                const currentPatientId = String(selectedPatientId ?? "").trim();
                return itemPatientId !== "" && itemPatientId === currentPatientId;
              })}
              patientTasks={(allTasks || []).filter((t) => {
                const itemPatientId = String(t?.patientId ?? t?.patient_id ?? "").trim();
                const currentPatientId = String(selectedPatientId ?? "").trim();
                return itemPatientId !== "" && itemPatientId === currentPatientId;
              })}
              onAddNote={(
                pid: any,
                txt: string,
                visibility: string,
                subject?: string,
              ) => {
                if (!ensureTherapistClinicalProfile()) return;
                onAddNote(pid, txt, visibility, subject);
              }}
              onAddActivityLog={onAddActivityLog}
              onUpdatePatient={
                onUpdatePatient
                  ? (updates: any) => {
                      if (!ensureTherapistClinicalProfile()) return;
                      onUpdatePatient(updates);
                    }
                  : undefined
              }
              onRecordTrial={
                onRecordTrial
                  ? (pid: any, title: string, score: number, evalComment?: string) => {
                      if (!ensureTherapistClinicalProfile()) return null;
                      return onRecordTrial(pid, title, score, evalComment);
                    }
                  : undefined
              }
              onDeleteHistoryItem={onDeleteHistoryItem}
              onEvaluateHistoryItem={
                onEvaluateHistoryItem
                  ? (id: any, score: number, note: string) => {
                      if (!ensureTherapistClinicalProfile()) return;
                      onEvaluateHistoryItem(id, score, note);
                    }
                  : undefined
              }
              onAddTask={onAddTask}
              onUpdateTask={onUpdateTask}
              protocols={protocols}
              setProtocols={setProtocols}
              userRole={user.role}
              allowedTabs={isReceptionist ? ["files"] : undefined}
              anamnesisTemplate={anamnesisTemplate}
            />
          </main>
        </div>
      </div>
    );
  }

  const desktopNavItems = isReceptionist
    ? [
        { id: "dashboard", label: "Painel", icon: LayoutDashboard },
        { id: "patients", label: "Pacientes", icon: ClipboardList },
        { id: "agenda", label: "Agenda", icon: CalendarDays },
        { id: "rooms", label: "Salas", icon: DoorOpen },
        { id: "logs", label: "Log de Atividades", icon: History },
        { id: "settings", label: "Configurações", icon: Settings },
      ]
    : [
        { id: "dashboard", label: "Painel", icon: LayoutDashboard },
        { id: "patients", label: "Pacientes", icon: ClipboardList },
        { id: "agenda", label: "Agenda", icon: CalendarDays },
        { id: "closure", label: "Fechamento", icon: ReceiptText },
        { id: "conference", label: "Conferência", icon: FileChartColumnIncreasing },
        { id: "protocols", label: "Protocolos", icon: BookOpenCheck },
        { id: "logs", label: "Log de Atividades", icon: History },
        { id: "settings", label: "Configurações", icon: Settings },
        {
          id: "financial",
          label: "Financeiro",
          icon: DollarSign,
          badge: "BETA",
        },
        { id: "flow", label: "Verto Flow", icon: Zap, badge: "EM BREVE" },
        {
          id: "birthdays",
          label: "Aniversariantes",
          icon: Heart,
        },
      ];

  const mobileNavItems = isReceptionist
    ? [
        { id: "dashboard", label: "Painel", icon: LayoutDashboard },
        { id: "patients", label: "Pacientes", icon: ClipboardList },
        { id: "agenda", label: "Agenda", icon: CalendarDays },
        { id: "rooms", label: "Salas", icon: DoorOpen },
        { id: "logs", label: "Registros", icon: History },
        { id: "settings", label: "Configurações", icon: Settings },
      ]
    : [
        { id: "dashboard", label: "Painel", icon: LayoutDashboard },
        { id: "patients", label: "Pacientes", icon: ClipboardList },
        { id: "agenda", label: "Agenda", icon: CalendarDays },
        { id: "closure", label: "Fechamento", icon: ReceiptText },
        { id: "conference", label: "Conferência", icon: FileChartColumnIncreasing },
        {
          id: "protocols",
          label: "Protocolos",
          icon: BookOpenCheck,
        },
        { id: "logs", label: "Registros", icon: History },
        {
          id: "settings",
          label: "Configurações",
          icon: Settings,
        },
        {
          id: "financial",
          label: "Financeiro",
          icon: DollarSign,
          badge: "BETA",
        },
        {
          id: "flow",
          label: "Fluxo Verto",
          icon: Zap,
          badge: "EM BREVE",
        },
        {
          id: "birthdays",
          label: "Aniversariantes",
          icon: Heart,
        },
      ];

  return (
    <div className="min-h-screen bg-[#F4F7FE] flex">
      {/* Sidebar */}
      <aside 
        onMouseEnter={() => setIsSidebarExpanded(true)}
        onMouseLeave={() => setIsSidebarExpanded(false)}
        className={`${isSidebarExpanded ? 'w-64' : 'w-20'} bg-white hidden lg:flex flex-col p-5 sticky top-0 h-screen border-r border-slate-100 transition-all duration-300 ease-in-out z-20`}
      >
        <div className={`flex items-center ${isSidebarExpanded ? 'gap-2' : 'justify-center'} mb-7 px-1 transition-all duration-300`}>
          <LogoVerto size={38} />
          {isSidebarExpanded && (
            <div>
              <span className="font-black text-xl text-slate-900 tracking-tighter block leading-none lowercase">
                verto
              </span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                Gestão
              </span>
            </div>
          )}
        </div>

        <nav className="space-y-2 flex-1 overflow-y-auto no-scrollbar pr-2">
            {filterTabsByRole(desktopNavItems as any).map((item: any) => (
            <button
              key={item.id}
              onClick={() => navigateToTab(item.id as any)}
              className={`w-full flex items-center ${isSidebarExpanded ? 'gap-3 px-4' : 'justify-center'} py-3.5 rounded-2xl transition-all font-medium text-sm ${
                activeTab === item.id
                  ? "text-[#7a32fc] bg-purple-50 shadow-sm"
                  : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
              }`}
              title={!isSidebarExpanded ? item.label : ""}
            >
              <item.icon size={20} />
              {isSidebarExpanded && (
                <>
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-black text-amber-950 shadow-sm shadow-amber-300/50 ring-1 ring-amber-500/30">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>
        <div
          className={`mt-2 mb-0 text-[9px] text-slate-400 font-semibold uppercase tracking-wider flex items-center ${
            isSidebarExpanded ? "gap-1 px-2" : "justify-center"
          }`}
          title={!isSidebarExpanded ? "Role para ver mais módulos" : ""}
        >
          <ChevronDown size={12} />
          {isSidebarExpanded && "Role para ver mais módulos"}
        </div>

        <div className="mt-auto pt-4 border-t border-slate-50">
          {isSidebarExpanded && (
            <div className="bg-slate-50 rounded-2xl p-3 mb-3">
              <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center font-bold text-[#7a32fc] shadow-sm text-xs overflow-hidden">
                    {coordinatorAvatarUrl ? (
                      <img src={coordinatorAvatarUrl} alt={user?.name || "Perfil"} className="w-full h-full object-cover" />
                    ) : (
                      user.name?.[0]
                    )}
                  </div>
                <div className="overflow-hidden">
                  <p className="text-[11px] font-bold text-slate-900 truncate">
                    {normalizeUtf8Text(user.name)}
                  </p>
                </div>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            className={`w-full flex items-center ${isSidebarExpanded ? 'gap-3 px-4' : 'justify-center'} py-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all font-bold text-sm`}
            title={!isSidebarExpanded ? "Sair" : ""}
          >
            <LogOut size={20} />
            {isSidebarExpanded && <span>Sair do Sistema</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto relative z-10">
        {/* Header */}
        <header
          className={`px-4 lg:px-8 ${activeTab === "dashboard" ? "py-5 lg:py-6" : "py-4"} flex items-center justify-between sticky top-0 backdrop-blur-md z-30 ${
            theme === "dark"
              ? "bg-[#0f172a]/85 border-b border-slate-800/80"
              : "bg-[#F4F7FE]/85 border-b border-slate-100/90"
          }`}
        >
          <div className="flex items-center gap-4">
            {activeTab !== "dashboard" && (
              <button
                onClick={() => {
                  setActiveTab("dashboard");
                  setTabHistory(["dashboard"]);
                  setIsEditingRooms(true);
                }}
                className="p-2 bg-white rounded-xl text-slate-400 hover:text-[#7a32fc] shadow-sm border border-slate-100 transition-all"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
            )}
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${theme === "dark" ? "text-slate-300" : "text-slate-500"}`}>
                {activeTab === "rooms" && !isEditingRooms
                  ? "Salas"
                  : activeTab === "dashboard"
                    ? "Painel"
                    : `Páginas / ${tabLabels[activeTab] || "Painel"}`}
              </p>
              <h1 className={`text-base lg:text-2xl font-semibold tracking-tight ${theme === "dark" ? "text-slate-100" : "text-slate-900"} ${activeTab === "dashboard" ? "max-w-[980px] leading-snug" : "capitalize"}`}>
                {activeTab === "rooms" && !isEditingRooms
                  ? "Reservas de Sala"
                  : activeTab === "dashboard"
                    ? "Visão geral"
                    : tabLabels[activeTab] || "Painel"}
              </h1>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 lg:gap-4 p-1.5 lg:p-2 rounded-[24px] shadow-sm border ${
              theme === "dark"
                ? "bg-[#0b1a33] border-slate-700"
                : "bg-white border-slate-100"
            }`}
          >
            <div className="relative hidden md:block">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />
              <input
                type="text"
                placeholder="Pesquisar..."
                className={`border-none rounded-full py-3 pl-12 pr-6 text-sm font-medium outline-none focus:ring-2 ring-blue-500/20 w-48 lg:w-64 transition-all ${
                  theme === "dark"
                    ? "bg-[#122544] text-slate-100 placeholder:text-slate-400"
                    : "bg-slate-50 text-slate-700 placeholder:text-slate-400"
                }`}
              />
            </div>

            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
            >
              <Menu size={20} />
            </button>

            <button
              onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
              className="p-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
              title={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            <SettingsMenu
              user={user}
              onLogout={onLogout}
              onViewTeam={() => navigateToTab("team")}
              onOpenInvitations={() => setShowInvitationModal(true)}
              onViewProfile={() => navigateToTab("settings")}
              onViewBilling={() => navigateToTab("billing")}
              onOpenOnboarding={onOpenOnboarding}
            />
          </div>
        </header>

        {/* Mobile Menu Drawer */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[100] lg:hidden"
              />
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-[280px] bg-white z-[101] lg:hidden shadow-2xl flex flex-col p-6"
              >
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <LogoVerto size={40} />
                    <span className="font-black text-xl text-slate-900 tracking-tighter lowercase">
                      verto
                    </span>
                  </div>
                  <button
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={24} />
                  </button>
                </div>

                <nav className="space-y-1 flex-1 overflow-y-auto no-scrollbar">
                  {filterTabsByRole(mobileNavItems as any).map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        navigateToTab(item.id as any);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all font-bold text-sm ${
                        activeTab === item.id
                          ? "text-[#7a32fc] bg-purple-50"
                          : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <item.icon size={18} />
                      {item.label}
                      {item.badge && (
                        <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-black text-amber-950 shadow-sm shadow-amber-300/50 ring-1 ring-amber-500/30">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>

                <div className="mt-auto pt-6 border-t border-slate-50">
                  <button
                    onClick={onLogout}
                    className="w-full flex items-center gap-4 px-4 py-3.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all font-bold text-sm"
                  >
                    <LogOut size={18} />
                    Sair do Sistema
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <main className="px-4 lg:px-8 pt-2 pb-16">
          {isPaymentModalOpen && (
            <div
              className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
              onClick={() => {
                setIsPaymentModalOpen(false);
                setEditingPayment(null);
              }}
            >
              <div
                className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setIsPaymentModalOpen(false);
                    setEditingPayment(null);
                  }}
                  className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
                <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <DollarSign size={24} className="text-[#7a32fc]" /> Registrar
                  {editingPayment ? " Pagamento" : " Pagamento"}
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Paciente
                    </label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                      onChange={(e) => {
                        const p = allPatients.find(
                          (p: any) =>
                            p.id === e.target.value ||
                            p.id === parseInt(e.target.value),
                        );
                        setSelectedPaymentPatient(p);
                        if (p) {
                          const plans = getPatientPlans(p);
                          const total = plans.reduce((sum: number, plan: any) => sum + plan.amount, 0);
                          const primaryPlan = plans[0];
                          if (total > 0) setPaymentAmount(formatMoneyInput(total));
                          setPaymentType(primaryPlan?.payerLabel || (primaryPlan?.payerType === "convenio" ? "convênio" : "particular"));
                          setPaymentInsurance(primaryPlan?.insuranceName || p.insuranceName || "");
                          if (primaryPlan?.billingMethod) setPaymentMethod(primaryPlan.billingMethod);
                          setPaymentSpecialty(primaryPlan?.specialty || "");
                          const dueDay = primaryPlan?.dueDay || p.billingDueDay;
                          if (dueDay) {
                            const safeDueDay = Math.min(31, Math.max(1, Number(dueDay)));
                            const dueDate = new Date(`${financialMonth || new Date().toISOString().slice(0, 7)}-01T00:00:00`);
                            dueDate.setDate(Math.min(safeDueDay, new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate()));
                            setPaymentDueDate(dueDate.toISOString().slice(0, 10));
                          }
                        }
                      }}
                    >
                      <option value="">Selecione o paciente...</option>
                      {allPatients.map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Tipo de Pagamento
                      </label>
                      <select
                        value={paymentType}
                        onChange={(e) => setPaymentType(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                      >
                        <option value="particular">Particular</option>
                        <option value="convênio">Convênio</option>
                      </select>
                    </div>
                    {paymentType === "convênio" && (
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                          Convênio
                        </label>
                        <input
                          type="text"
                          value={paymentInsurance}
                          onChange={(e) => setPaymentInsurance(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                          placeholder="Nome do convênio..."
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Valor (R$)
                      </label>
                      <input
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(normalizeMoneyInputChange(e.target.value))}
                        onBlur={() => setPaymentAmount(formatMoneyInput(paymentAmount))}
                        inputMode="decimal"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Data de pagamento
                      </label>
                      <input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Vencimento
                      </label>
                      <input
                        type="date"
                        value={paymentDueDate}
                        onChange={(e) => setPaymentDueDate(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                      />
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    {editingPayment && paymentIsRecurring && (
                      <div className="mb-4 rounded-2xl bg-white p-1">
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingPaymentScope("single")}
                            className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${editingPaymentScope === "single" ? "bg-[#7a32fc] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                          >
                            Só este
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPaymentScope("future")}
                            className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${editingPaymentScope === "future" ? "bg-[#7a32fc] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                          >
                            Este e próximos
                          </button>
                        </div>
                      </div>
                    )}
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        disabled={Boolean(editingPayment)}
                        checked={paymentIsRecurring}
                        onChange={(e) => setPaymentIsRecurring(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                      />
                      <span>
                        <span className="block text-sm font-black text-slate-800">
                          Gerar cobranças recorrentes
                        </span>
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          Use uma ou mais datas de vencimento por mês.
                        </span>
                      </span>
                    </label>
                    {paymentIsRecurring && (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                            Meses à frente
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={paymentRecurrenceMonths}
                            onChange={(e) => setPaymentRecurrenceMonths(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                            Dias de vencimento
                          </label>
                          <input
                            value={paymentRecurrenceDueDays}
                            onChange={(e) => setPaymentRecurrenceDueDays(e.target.value.replace(/[^\d,;\s]/g, ""))}
                            className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                            placeholder="10, 20"
                          />
                        </div>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                          Adicional (R$)
                        </label>
                        <input
                          value={paymentAdditionalAmount}
                          onChange={(e) => setPaymentAdditionalAmount(normalizeMoneyInputChange(e.target.value))}
                          onBlur={() => setPaymentAdditionalAmount(formatMoneyInput(paymentAdditionalAmount))}
                          inputMode="decimal"
                          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                          placeholder="0,00"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                          Aplicar adicional
                        </label>
                        <select
                          value={paymentAdditionalScope}
                          onChange={(e) => setPaymentAdditionalScope(e.target.value as "next" | "future")}
                          className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                        >
                          <option value="next">Só no próximo pagamento</option>
                          <option value="future">Em todos à frente</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Especialidade / faturamento
                    </label>
                    <input
                      type="text"
                      value={paymentSpecialty}
                      onChange={(e) => setPaymentSpecialty(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                      placeholder="Ex.: Fono, Psicologia, Nutrição..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Método
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {["pix", "card", "cash", "boleto", "transfer"].map((m) => (
                        <button
                          key={m}
                          onClick={() => setPaymentMethod(m)}
                          className={`py-2 rounded-xl text-[10px] font-bold uppercase border-2 transition-all ${paymentMethod === m ? "border-[#7a32fc] bg-blue-50 text-[#7a32fc]" : "border-slate-100 text-slate-400"}`}
                        >
                          {m === "pix"
                            ? "PIX"
                            : m === "card"
                              ? "Cartão"
                              : m === "cash"
                                ? "Dinheiro"
                                : m === "boleto"
                                  ? "Boleto"
                                  : "Transfer."}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Anexar Comprovante
                    </label>
                    <div
                      className="border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center cursor-pointer hover:border-blue-500 transition-all bg-slate-50"
                      onClick={() =>
                        document.getElementById("receipt-upload")?.click()
                      }
                    >
                      {paymentReceipt ? (
                        <div className="flex items-center justify-center gap-2 text-emerald-500 font-bold text-xs">
                          <CheckCircle2 size={16} /> Arquivo Selecionado
                        </div>
                      ) : (
                        <div className="text-slate-400 text-xs font-medium flex flex-col items-center gap-2">
                          <Paperclip size={20} />
                          Clique para anexar comprovante
                        </div>
                      )}
                      <input
                        type="file"
                        id="receipt-upload"
                        className="hidden"
                        accept="image/*,application/pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setPaymentReceipt(reader.result as string);
                              setPaymentReceiptName(file.name);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleAddPayment}
                    className="w-full bg-[#7a32fc] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 mt-4"
                  >
                    {paymentReceipt ? "Confirmar Pagamento" : "Registrar Cobrança Pendente"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {isProfessionalPaymentModalOpen && (
            <div
              className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
              onClick={() => {
                setIsProfessionalPaymentModalOpen(false);
                setEditingProfessionalPayment(null);
              }}
            >
              <div
                className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setIsProfessionalPaymentModalOpen(false);
                    setEditingProfessionalPayment(null);
                  }}
                  className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
                <h2 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-900">
                  <CreditCard size={24} className="text-[#7a32fc]" /> Pagamento Profissional
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                      Profissional
                    </label>
                    <select
                      value={selectedProfessionalPaymentId}
                      onChange={(e) => setSelectedProfessionalPaymentId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none"
                    >
                      <option value="">Selecione...</option>
                      {therapistFilterOptions.map((member) => (
                        <option key={`professional-payment-${member.id}`} value={member.id}>
                          {member.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                        Valor (R$)
                      </label>
                      <input
                        value={professionalPaymentAmount}
                        onChange={(e) => setProfessionalPaymentAmount(normalizeMoneyInputChange(e.target.value))}
                        onBlur={() => setProfessionalPaymentAmount(formatMoneyInput(professionalPaymentAmount))}
                        inputMode="decimal"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none"
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                        Status
                      </label>
                      <select
                        value={professionalPaymentStatus}
                        onChange={(e) => setProfessionalPaymentStatus(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none"
                      >
                        <option value="pending">Pendente</option>
                        <option value="paid">Pago</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                        Vencimento
                      </label>
                      <input
                        type="date"
                        value={professionalPaymentDueDate}
                        onChange={(e) => setProfessionalPaymentDueDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                        Pagamento
                      </label>
                      <input
                        type="date"
                        value={professionalPaymentDate}
                        onChange={(e) => setProfessionalPaymentDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                      Método
                    </label>
                    <select
                      value={professionalPaymentMethod}
                      onChange={(e) => setProfessionalPaymentMethod(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none"
                    >
                      <option value="pix">PIX</option>
                      <option value="transfer">Transferência</option>
                      <option value="cash">Dinheiro</option>
                      <option value="card">Cartão</option>
                      <option value="boleto">Boleto</option>
                    </select>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    {editingProfessionalPayment && professionalPaymentIsRecurring && (
                      <div className="mb-4 rounded-2xl bg-white p-1">
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingProfessionalPaymentScope("single")}
                            className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${editingProfessionalPaymentScope === "single" ? "bg-[#7a32fc] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                          >
                            Só este
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingProfessionalPaymentScope("future")}
                            className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${editingProfessionalPaymentScope === "future" ? "bg-[#7a32fc] text-white" : "text-slate-500 hover:bg-slate-50"}`}
                          >
                            Este e próximos
                          </button>
                        </div>
                      </div>
                    )}
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        disabled={Boolean(editingProfessionalPayment)}
                        checked={professionalPaymentIsRecurring}
                        onChange={(e) => setProfessionalPaymentIsRecurring(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                      />
                      <span>
                        <span className="block text-sm font-black text-slate-800">
                          Gerar pagamentos recorrentes
                        </span>
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          Cria vencimentos futuros para o profissional.
                        </span>
                      </span>
                    </label>
                    {professionalPaymentIsRecurring && (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                            Meses à frente
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={professionalPaymentRecurrenceMonths}
                            onChange={(e) => setProfessionalPaymentRecurrenceMonths(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                            Dias de vencimento
                          </label>
                          <input
                            value={professionalPaymentRecurrenceDueDays}
                            onChange={(e) => setProfessionalPaymentRecurrenceDueDays(e.target.value.replace(/[^\d,;\s]/g, ""))}
                            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 outline-none"
                            placeholder="5, 20"
                          />
                        </div>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                          Adicional (R$)
                        </label>
                        <input
                          value={professionalPaymentAdditionalAmount}
                          onChange={(e) => setProfessionalPaymentAdditionalAmount(normalizeMoneyInputChange(e.target.value))}
                          onBlur={() => setProfessionalPaymentAdditionalAmount(formatMoneyInput(professionalPaymentAdditionalAmount))}
                          inputMode="decimal"
                          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 outline-none"
                          placeholder="0,00"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                          Aplicar adicional
                        </label>
                        <select
                          value={professionalPaymentAdditionalScope}
                          onChange={(e) => setProfessionalPaymentAdditionalScope(e.target.value as "next" | "future")}
                          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 outline-none"
                        >
                          <option value="next">Só no próximo pagamento</option>
                          <option value="future">Em todos à frente</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleAddProfessionalPayment}
                    className="mt-4 w-full rounded-2xl bg-[#7a32fc] py-4 text-sm font-bold text-white shadow-lg shadow-purple-500/20"
                  >
                    Salvar Pagamento Profissional
                  </button>
                </div>
              </div>
            </div>
          )}
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {renderDashboard()}
              </motion.div>
            )}
            {activeTab === "team" && (
              <motion.div
                key="team"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <TeamManagement
                  user={user}
                  onRequestUpgrade={() => navigateToTab("billing")}
                  activePatientCount={(allPatients || []).filter((patient: any) => String(patient?.status || "active").toLowerCase() !== "inactive").length}
                  memberSessionDurations={professionalSessionDurations}
                  onUpdateMemberSessionDuration={(member, duration) =>
                    setProfessionalSessionDurations((prev) => ({
                      ...prev,
                      [member.id]: duration,
                      [member.email]: duration,
                      [member.name]: duration,
                    }))
                  }
                />
              </motion.div>
            )}
            {canAccessClinicFinance && activeTab === "financial" && (
              <motion.div
                key="financial"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {!isReceptionist && (
                  <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-2xl font-black tracking-tight text-slate-900">
                          DRE da Clínica
                        </h3>
                        <p className="text-sm font-medium text-slate-500">
                          Projeção pelo cadastro dos pacientes e realizado pelos pagamentos confirmados.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          Mês
                        </label>
                        <input
                          type="month"
                          value={financialMonth}
                          onChange={(e) => setFinancialMonth(e.target.value)}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-[#7a32fc]"
                        />
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {[
                        ["Pacientes ativos", financialDashboard.patientCount, "Com plano financeiro ativo"],
                        ["Projeção mensal", formatCurrency(financialDashboard.projection), "Mensalidades cadastradas"],
                        ["Realizado", formatCurrency(financialDashboard.realized), "Pagamentos do mês"],
                        ["Ticket médio", formatCurrency(financialDashboard.averageTicket), "Por paciente ativo"],
                        ["Fluxo de caixa", formatCurrency(financialDashboard.cashFlow), "Entradas menos saídas pagas"],
                        ["Lucro líquido", formatCurrency(financialDashboard.netProfit), `${financialDashboard.netMarginPct.toFixed(1)}% de margem líquida`],
                        ["Margem contribuição", `${financialDashboard.contributionMarginPct.toFixed(1)}%`, formatCurrency(financialDashboard.contributionMarginValue)],
                        ["Repasses profissionais", formatCurrency(financialDashboard.professionalPaid), `${formatCurrency(financialDashboard.professionalPending)} pendente`],
                      ].map(([label, value, hint]) => (
                        <div key={label} className="rounded-3xl bg-slate-50 p-5">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                          <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-400">{hint}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-2xl font-black tracking-tight text-slate-900">
                        {isReceptionist ? "Recebimentos e cobranças" : "Financeiro e DRE Operacional da Clínica"}
                      </h3>
                      <p className="text-sm font-medium text-slate-500">
                        {isReceptionist
                          ? "Acompanhe cobranças, vencimentos, recebimentos e comprovantes dos pacientes."
                          : "Recebimentos, convênios, vencimentos, projeção e realizado em um só lugar."}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Mês
                      </label>
                      <input
                        type="month"
                        value={financialMonth}
                        onChange={(e) => setFinancialMonth(e.target.value)}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-[#7a32fc]"
                        />
                      </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setIsPaymentModalOpen(true)}
                    className="bg-[#7a32fc] text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 flex items-center gap-2 hover:scale-105 transition-all"
                  >
                    <Plus size={18} /> Cobrança / Pagamento
                  </button>
                  <button
                    onClick={() => setIsProfessionalPaymentModalOpen(true)}
                    className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-slate-500/20 flex items-center gap-2 hover:scale-105 transition-all"
                  >
                    <CreditCard size={18} /> Pagamento Profissional
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {!isReceptionist && (
                      <>
                        <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
                          <div className="p-8 border-b border-slate-50">
                            <h4 className="font-bold text-slate-900">
                              Resumo Financeiro Operacional
                            </h4>
                          </div>
                          <div className="p-8">
                            <div className="space-y-4">
                              {dreData.map((item, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-center justify-between p-4 rounded-2xl ${
                                    item.type === "total"
                                      ? "bg-slate-50 font-bold"
                                      : item.type === "profit"
                                        ? "bg-emerald-50 text-emerald-700 font-black"
                                        : "bg-white"
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <div
                                      className={`w-2 h-2 rounded-full ${
                                        item.type === "income"
                                          ? "bg-emerald-500"
                                          : item.type === "expense"
                                            ? "bg-red-500"
                                            : "bg-blue-500"
                                      }`}
                                    />
                                    <div>
                                      <p className="text-sm">{item.label}</p>
                                      <p className="text-[10px] text-slate-400 font-medium">
                                        {item.info}
                                      </p>
                                    </div>
                                  </div>
                                  <p className="text-lg">
                                    {item.value < 0
                                      ? `- ${formatCurrency(Math.abs(item.value))}`
                                      : formatCurrency(item.value)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <h4 className="font-bold text-slate-900">
                                DRE por especialidade
                              </h4>
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                Projeção vem do cadastro financeiro do paciente. Quando o pagamento não informa especialidade, o valor é distribuído conforme as especialidades cadastradas no paciente.
                              </p>
                            </div>
                            <span className="w-fit rounded-full bg-violet-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#7a32fc]">
                              Visão gerencial
                            </span>
                          </div>
                          <div className="mt-5 space-y-4">
                            {financialDashboard.specialtyRows.length ? (
                              financialDashboard.specialtyRows.map((row: any) => {
                                const netPositive = row.netProfit >= 0;
                                return (
                                  <div key={row.label} className="rounded-[28px] border border-slate-100 bg-slate-50 p-5">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div>
                                        <p className="text-base font-black text-slate-900">{row.label}</p>
                                        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                          {row.patients} paciente(s) ativo(s) • {row.paidPatients} com pagamento realizado no mês
                                        </p>
                                      </div>
                                      <div className={`rounded-2xl px-4 py-2 text-right ${netPositive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                                        <p className="text-[10px] font-black uppercase tracking-widest">Lucro estimado</p>
                                        <p className="text-lg font-black">{formatCurrency(row.netProfit)}</p>
                                      </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Faturamento projetado</p>
                                        <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(row.projected)}</p>
                                      </div>
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Realizado</p>
                                        <p className="mt-1 text-lg font-black text-[#7a32fc]">{formatCurrency(row.realized)}</p>
                                      </div>
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Ticket médio</p>
                                        <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(row.averageTicket)}</p>
                                      </div>
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Margem líquida</p>
                                        <p className={`mt-1 text-lg font-black ${netPositive ? "text-emerald-600" : "text-rose-600"}`}>
                                          {row.netMarginPct.toFixed(1)}%
                                        </p>
                                      </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] font-bold text-slate-500 sm:grid-cols-2 xl:grid-cols-5">
                                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                                        Ticket realizado: <span className="text-[#7a32fc]">{formatCurrency(row.realizedTicket)}</span>
                                      </div>
                                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                                        Pendente: <span className="text-amber-600">{formatCurrency(row.pending)}</span>
                                      </div>
                                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                                        Inadimplente: <span className="text-rose-600">{formatCurrency(row.overdue)}</span>
                                      </div>
                                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                                        Repasses: <span className="text-slate-800">{formatCurrency(row.professionalPaid)}</span>
                                      </div>
                                      <div className="rounded-2xl bg-white/70 px-3 py-2">
                                        Desp. aloc.: <span className="text-slate-800">{formatCurrency(row.allocatedOperationalExpenses)}</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">
                                Nenhuma mensalidade cadastrada nos pacientes ativos.
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                          <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                            <h4 className="font-bold text-slate-900">
                              Ranking de faturamento por especialidade
                            </h4>
                            <div className="mt-5 space-y-3">
                              {financialDashboard.specialtyRows.length ? (
                                financialDashboard.specialtyRows.map((row: any) => (
                                  <div key={row.label} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                                    <div>
                                      <p className="text-sm font-black text-slate-800">{row.label}</p>
                                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                        {row.patients} paciente(s) • ticket {formatCurrency(row.averageTicket)}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-black text-[#7a32fc]">{formatCurrency(row.projected)}</p>
                                      <p className="text-[10px] font-bold text-slate-400">
                                        {formatCurrency(row.realized)} realizado
                                      </p>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">
                                  Nenhuma mensalidade cadastrada nos pacientes ativos.
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                            <h4 className="font-bold text-slate-900">
                              Particular, convênio e faturamento
                            </h4>
                            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {financialDashboard.payerRows.map((row: any) => (
                                <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.label}</p>
                                  <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(row.amount)}</p>
                                  <p className="text-[10px] font-semibold text-slate-400">{row.patients} paciente(s)</p>
                                </div>
                              ))}
                              {financialDashboard.billingMethodRows.map((row: any) => (
                                <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.label}</p>
                                  <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(row.amount)}</p>
                                  <p className="text-[10px] font-semibold text-slate-400">Meio de faturamento</p>
                                </div>
                              ))}
                            </div>
                            {financialDashboard.insuranceRows.length > 0 && (
                              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                                {financialDashboard.insuranceRows.map((row: any) => (
                                  <div key={row.label} className="flex items-center justify-between text-xs font-bold text-slate-500">
                                    <span>{row.label}</span>
                                    <span>{formatCurrency(row.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 overflow-hidden">
                      <div className="p-8 border-b border-slate-50">
                        <h4 className="font-bold text-slate-900">
                          Últimos Recebimentos
                        </h4>
                      </div>
                      <div className="p-8 overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left border-b border-slate-50">
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Paciente
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Tipo
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Valor
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Data
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Método
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Comprovante
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Status
                              </th>
                              <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Ações
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {financialDashboard.monthPayments.length > 0 ? (
                              financialDashboard.monthPayments.map((p: any, idx: number) => (
                                <tr
                                  key={p.id || idx}
                                  className="group hover:bg-slate-50 transition-all"
                                >
                                  <td className="py-4 font-semibold text-slate-700">
                                    {p.patient_name}
                                  </td>
                                  <td className="py-4">
                                    <div className="flex flex-col">
                                      <span
                                        className={`text-[10px] font-bold uppercase ${p.type === "particular" ? "text-blue-600" : "text-purple-600"}`}
                                      >
                                        {p.type || "Particular"}
                                      </span>
                                      {p.insurance_name && (
                                        <span className="text-[9px] text-slate-400 font-medium">
                                          {p.insurance_name}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-4 font-bold text-[#7a32fc]">
                                    {formatCurrency(p.amount)}
                                  </td>
                                  <td className="py-4 text-slate-500 text-sm">
                                    {new Date(
                                      p.payment_date || p.due_date,
                                    ).toLocaleDateString()}
                                  </td>
                                  <td className="py-4">
                                    <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase">
                                      {p.method}
                                    </span>
                                  </td>
                                  <td className="py-4 text-xs font-semibold text-slate-500">
                                    {p.receipt_url ? (
                                      "Anexado"
                                    ) : (
                                      <label className="inline-flex cursor-pointer items-center rounded-full bg-violet-50 px-3 py-1 text-[10px] font-black uppercase text-[#7a32fc] hover:bg-violet-100">
                                        Anexar
                                        <input
                                          type="file"
                                          className="hidden"
                                          accept="image/*,application/pdf"
                                          onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            void handleAttachPaymentReceipt(p, file);
                                            event.currentTarget.value = "";
                                          }}
                                        />
                                      </label>
                                    )}
                                  </td>
                                  <td className="py-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                                      String(p.status || "").toLowerCase() === "paid"
                                        ? "bg-green-100 text-green-600"
                                        : "bg-amber-100 text-amber-700"
                                    }`}>
                                      {String(p.status || "").toLowerCase() === "paid" ? "Pago" : "Pendente"}
                                    </span>
                                  </td>
                                  <td className="py-4">
                                    <button
                                      type="button"
                                      onClick={() => openPaymentEditor(p)}
                                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 hover:border-[#7a32fc] hover:text-[#7a32fc]"
                                    >
                                      Editar
                                    </button>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={8}
                                  className="py-8 text-center text-slate-400 text-sm font-medium"
                                >
                                  Nenhum pagamento registrado.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-8">
                    {!isReceptionist && (
                      <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 p-8">
                        <h4 className="font-bold text-slate-900 mb-6">
                          Realizado x projeção
                        </h4>
                        <div className="h-64 min-h-[300px]">
                <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                            <BarChart data={revenueHistory}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={false}
                                stroke="#F1F5F9"
                              />
                              <XAxis
                                dataKey="month"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: "#94A3B8", fontSize: 12 }}
                              />
                              <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: "#94A3B8", fontSize: 12 }}
                              />
                              <Tooltip
                                contentStyle={{
                                  borderRadius: "16px",
                                  border: "none",
                                  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                                }}
                                cursor={{ fill: "#F8FAFC" }}
                              />
                              <Bar
                                dataKey="revenue"
                                fill="#7a32fc"
                                radius={[4, 4, 0, 0]}
                              />
                              <Bar
                                dataKey="profit"
                                fill="#6AD2FF"
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          </SafeResponsiveContainer>
                        </div>
                      </div>
                    )}

                    <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 p-8">
                      <h4 className="font-bold text-slate-900 mb-6">
                        Próximos vencimentos
                      </h4>
                      <div className="space-y-4">
                        {compensationForecast.map((member, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl"
                          >
                            <div>
                              <p className="font-bold text-slate-900 text-sm">
                                {member.patientName}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                {member.specialty}
                              </p>
                              <p className="text-[10px] text-slate-500 font-medium mt-1">
                                {member.payerType}{member.insuranceName ? ` • ${member.insuranceName}` : ""}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-slate-900 text-sm">
                                {formatCurrency(member.amount)}
                              </p>
                              <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">
                                Vence dia {String(member.dueDay).padStart(2, "0")}
                              </p>
                              <p className="text-[10px] text-slate-400 font-medium">
                                {member.billingMethod}
                              </p>
                            </div>
                          </div>
                        ))}
                        {!compensationForecast.length && (
                          <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">
                            Cadastre mensalidades no paciente para ver vencimentos.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 p-8">
                      <h4 className="font-bold text-slate-900 mb-6">
                        Pagamentos de profissionais
                      </h4>
                      <div className="space-y-4">
                        {financialDashboard.professionalPayments.length ? (
                          financialDashboard.professionalPayments.map((payment: any, index: number) => (
                            <div key={payment.id || index} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                              <div>
                                <p className="text-sm font-bold text-slate-900">
                                  {payment.professional_name || payment.professionalName || "Profissional"}
                                </p>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                  Vence {new Date(payment.due_date || payment.payment_date).toLocaleDateString("pt-BR")}
                                </p>
                                <p className="mt-1 text-[10px] font-medium text-slate-500">
                                  {payment.method || "pix"}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-black text-slate-900">
                                  {formatCurrency(payment.amount)}
                                </p>
                                <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                                  String(payment.status || "").toLowerCase() === "paid"
                                    ? "bg-green-100 text-green-600"
                                    : "bg-amber-100 text-amber-700"
                                }`}>
                                  {String(payment.status || "").toLowerCase() === "paid" ? "Pago" : "Pendente"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openProfessionalPaymentEditor(payment)}
                                  className="mt-2 block rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-black uppercase text-slate-600 hover:border-[#7a32fc] hover:text-[#7a32fc]"
                                >
                                  Editar
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">
                            Nenhum pagamento profissional registrado no mês.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === "flow" && (
              <motion.div
                key="flow"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] shadow-sm border border-slate-100 p-8 text-center"
              >
                <div className="w-20 h-20 bg-blue-50 text-[#7a32fc] rounded-[32px] flex items-center justify-center mb-6">
                  <Zap size={40} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
                  Verto Flow
                </h3>
                <p className="text-slate-500 font-medium mb-8 max-w-md">
                  O coordenador vai poder gerenciar uma lista de espera
                  inteligente para que a agenda seja preenchida por outro
                  paciente caso haja algum cancelamento e horário disponível.
                </p>
                <span className="px-6 py-2 bg-[#7a32fc] text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20">
                  Em Breve
                </span>
              </motion.div>
            )}
            {activeTab === "birthdays" && (
              <motion.div
                key="birthdays"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white p-4 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100"
              >
                <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-pink-600">
                      <Cake size={14} />
                      Aniversariantes de hoje
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">
                      {birthdayTodayCount === 1
                        ? "1 aniversariante hoje"
                        : `${birthdayTodayCount} aniversariantes hoje`}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      A contagem considera dia e mês de nascimento, sem alterar a data por fuso horário.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPatientQuickFilter("all");
                      navigateToTab("patients");
                    }}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-all hover:border-[#7a32fc] hover:text-[#7a32fc]"
                  >
                    Limpar filtro
                  </button>
                </div>

                {birthdayPatients.length > 0 ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {birthdayPatients.map((patient: any) => (
                      <div
                        key={`birthday-${patient.id}`}
                        className="rounded-3xl border border-pink-100 bg-pink-50/50 p-5 shadow-sm"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-lg font-black text-pink-600 shadow-sm">
                            {(String(patient?.name || "P").trim().charAt(0) || "P").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <h4 className="truncate text-sm font-bold text-slate-900">
                              {normalizeUtf8Text(patient?.name || "Paciente")}
                            </h4>
                            <p className="mt-0.5 text-xs font-semibold text-slate-500">
                              {formatBirthDateForDisplay(
                                patient?.birthDate || patient?.birth_date || patient?.dataNascimento,
                              ) || "Nascimento cadastrado"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="rounded-xl bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            {getPatientProfileTypeLabel(patient.patientProfileType || patient.panelType || patient.type)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (isReceptionist) {
                                openPatientProfileModal(patient);
                                return;
                              }
                              onPatientClick(patient.id, { tab: "history" });
                            }}
                            className="rounded-xl bg-[#7a32fc] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white"
                          >
                            Abrir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-slate-100 bg-slate-50 p-8 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-400">
                      <Cake size={26} />
                    </div>
                    <p className="text-sm font-semibold text-slate-500">
                      Nenhum aniversariante hoje.
                    </p>
                  </div>
                )}
              </motion.div>
            )}
            {activeTab === "patients" && (
              <motion.div
                key="patients"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white p-4 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100"
              >
                <div className="flex flex-col gap-3 mb-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                      Gestão de Pacientes
                    </h3>
                    {canCreatePatients && (
                      <button
                        onClick={() => {
                          resetPatientForm();
                          setIsPatientRegistrationModalOpen(true);
                        }}
                        className="px-4 sm:px-6 py-2 sm:py-3 bg-[#7a32fc] text-white rounded-2xl font-bold text-xs sm:text-sm shadow-lg shadow-purple-500/20 hover:bg-blue-700 transition-all"
                      >
                        Novo Paciente
                      </button>
                    )}
                  </div>
                  {!isReceptionist && (
                    <div className="w-full sm:w-[360px]">
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                        Filtrar por terapeuta
                      </label>
                      <select
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                        value={patientTherapistFilter}
                        onChange={(e) => setPatientTherapistFilter(e.target.value)}
                      >
                        <option value="all">Todos os pacientes</option>
                        <option value="unassigned">Não atribuídos</option>
                        {therapistFilterOptions.map((therapist) => (
                          <option key={`therapist-filter-${therapist.id}`} value={therapist.id}>
                            {therapist.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {patientQuickFilter === "birthdaysToday" && (
                    <div className="flex flex-col gap-3 rounded-2xl border border-pink-100 bg-pink-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-sm font-bold text-pink-700">
                        <Cake size={18} />
                        <span>Filtro ativo: Aniversariantes de hoje</span>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-pink-600">
                          {visiblePatients.length}/{visiblePatientsWithoutQuickFilter.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPatientQuickFilter("all")}
                        className="inline-flex items-center justify-center rounded-xl bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-slate-600 shadow-sm transition-all hover:text-[#7a32fc]"
                      >
                        Limpar filtro
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {visiblePatients.map((patient, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        if (isReceptionist) {
                          openPatientProfileModal(patient);
                          return;
                        }
                        onPatientClick(patient.id, { tab: "history" });
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isReceptionist) {
                            openPatientProfileModal(patient);
                            return;
                          }
                          onPatientClick(patient.id, { tab: "history" });
                        }
                      }}
                      className={`p-4 sm:p-6 rounded-3xl border transition-all group relative cursor-pointer focus:outline-none focus:ring-4 focus:ring-[#7a32fc]/15 ${
                        patientQuickFilter === "birthdaysToday"
                          ? "border-pink-200 bg-pink-50/70 hover:border-pink-300"
                          : "border-slate-100 bg-slate-50 hover:border-blue-500/30"
                      }`}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl flex items-center justify-center font-bold text-slate-900 shadow-sm group-hover:scale-110 transition-transform">
                          {(String(patient?.name || "P").trim().charAt(0) || "P").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-slate-900 truncate flex items-center gap-2">
                            {normalizeUtf8Text(patient.name)}
                            {!isReceptionist && isPatientPendingAnamnesis(patient) && (
                              <span
                                title="Novo paciente pendente de ficha anamnese"
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-black shrink-0"
                              >
                                !
                              </span>
                            )}
                            {patientQuickFilter === "birthdaysToday" && (
                              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-pink-700">
                                Hoje
                              </span>
                            )}
                          </h4>
                          {(() => {
                            const therapistId = String(
                              patient?.therapist_id || patient?.professional_id || "",
                            ).trim();
                            if (!therapistId) {
                              return (
                                <p className="text-[10px] mt-1 font-semibold text-amber-600">
                                  Terapeuta: não atribuído
                                </p>
                              );
                            }
                            const therapist = therapistMembersById[therapistId];
                            const therapistName = formatTherapistLabel({ ...therapist, id: therapistId });
                            return (
                              <p className="text-[10px] mt-1 font-semibold text-indigo-600">
                                Terapeuta: {therapistName}
                              </p>
                            );
                          })()}
                        </div>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(
                                openMenuId === patient.id ? null : patient.id,
                              );
                            }}
                            className="p-2 text-slate-400 hover:text-[#7a32fc] hover:bg-white rounded-xl transition-all"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openMenuId === patient.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-2 w-60 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 py-2 animate-in fade-in zoom-in duration-200"
                            >
                              {!isReceptionist && (
                                <button
                                  onClick={() => {
                                    onPatientClick(patient.id, { tab: "history" });
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all whitespace-nowrap text-left"
                                >
                                  <FileText size={14} className="text-blue-500 shrink-0" />{" "}
                                  Prontuário
                                </button>
                              )}
                              {!isTherapist && (
                                <button
                                  onClick={() => {
                                    openPatientProfileModal(patient);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all whitespace-nowrap text-left"
                                >
                                  <Search size={14} className="text-[#7a32fc] shrink-0" />{" "}
                                  Ver cadastro
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResendPatientActivationEmail(patient);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all whitespace-nowrap text-left"
                              >
                                <Mail size={14} className="text-emerald-600 shrink-0" />
                                Reenviar ativação
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResendPatientRecoveryEmail(patient);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all whitespace-nowrap text-left"
                              >
                                <KeyRound size={14} className="text-indigo-500 shrink-0" />
                                Reenviar recuperação
                              </button>
                              {!isReceptionist && (
                                <button
                                  onClick={() => {
                                    onPatientClick(patient.id, {
                                      tab: "history",
                                      openAnamnesis: true,
                                    });
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all whitespace-nowrap text-left"
                                >
                                  <ClipboardCheck size={14} className="text-purple-500 shrink-0" />
                                  Ficha de anamnese
                                </button>
                              )}
                              {!isTherapist && (
                                <button
                                  onClick={() => {
                                    handleEditPatient(patient);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all whitespace-nowrap text-left"
                                >
                                  <Edit2 size={14} className="text-slate-400 shrink-0" />{" "}
                                  Editar
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePatient(patient);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-all whitespace-nowrap text-left"
                              >
                                {isTherapist ? (
                                  <>
                                    <XCircle size={14} className="shrink-0" /> Desvincular da clínica
                                  </>
                                ) : (
                                  <>
                                    <Trash2 size={14} className="shrink-0" /> Arquivar
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t border-slate-200/50">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const clinicalPending = isPatientPendingAnamnesis(patient);
                            return (
                              <>
                          <span
                                className={`w-2 h-2 rounded-full ${clinicalPending ? "bg-amber-500 animate-pulse" : "bg-green-500"}`}
                          />
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                            {isReceptionist
                              ? "Cadastro do paciente"
                                  : getPatientClinicalStatusLabel(patient)}
                          </span>
                              </>
                            );
                          })()}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <PatientInternalChatPreview
                            patientName={patient.name}
                            compact
                          />
                          <div className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-[8px] font-bold uppercase">
                            {getPatientProfileTypeLabel(patient.patientProfileType || patient.panelType || patient.type)}
                          </div>
                        </div>
                      </div>
                      {isReceptionist ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openPatientProfileModal(patient);
                            }}
                            className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100 transition-all"
                          >
                            Ver cadastro
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditPatient(patient);
                            }}
                            className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider hover:bg-slate-200 transition-all"
                          >
                            Editar cadastro
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPatientClick(patient.id, {
                                tab: "history",
                                openAnamnesis: true,
                              });
                            }}
                            className="px-3 py-2 rounded-xl bg-purple-50 text-purple-700 text-[10px] font-bold uppercase tracking-wider hover:bg-purple-100 transition-all"
                          >
                            Ficha de anamnese
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPatientClick(patient.id, { tab: "files" });
                            }}
                            className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider hover:bg-slate-200 transition-all"
                          >
                            Arquivos
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {visiblePatients.length === 0 && (
                    <div className="col-span-full rounded-2xl border border-slate-100 bg-slate-50 p-6 text-sm font-medium text-slate-500">
                      Nenhum paciente encontrado para o filtro selecionado.
                    </div>
                  )}
                </div>
              </motion.div>
            )}
            {activeTab === "agenda" && (
              <motion.div
                key="agenda"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {renderAgendaContent()}
              </motion.div>
            )}
            {activeTab === "closure" && (
              <motion.div
                key="closure"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <OperationalClosureCenter
                  patients={visiblePatients}
                  professionals={Object.values(therapistMembersById)}
                  canOverride={!isTherapist}
                  onOpenAppointment={() => navigateToTab("agenda")}
                  onOpenReport={(appointment) =>
                    onPatientClick(
                      undefined,
                      { tab: "report" },
                      appointment?.patient_name || "Paciente",
                    )
                  }
                />
              </motion.div>
            )}
            {activeTab === "conference" && (
              <motion.div
                key="conference"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <MonthlyConferenceCenter
                  patients={visiblePatients}
                  professionals={Object.values(therapistMembersById)}
                  payers={clinicPayers}
                  canExport={!isTherapist}
                  onOpenAppointment={() => navigateToTab("agenda")}
                  onOpenReport={(appointment) =>
                    onPatientClick(
                      undefined,
                      { tab: "report" },
                      appointment?.patient_name || "Paciente",
                    )
                  }
                />
              </motion.div>
            )}
            {activeTab === "billing" && (
              <motion.div
                key="billing"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto space-y-8"
              >
                <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-blue-50 text-[#7a32fc] rounded-2xl">
                      <CreditCard size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-slate-900 tracking-tight">
                        Assinatura e Planos
                      </h3>
                      <p className="text-slate-500 font-medium">
                        Gerencie seu plano e faturamento.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-6 bg-slate-50 rounded-[28px] border border-slate-100">
                      <div className="flex items-start gap-4">
                        <div className="p-3 rounded-2xl bg-white text-[#7a32fc] border border-slate-100">
                          <FileText size={22} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Faturas
                          </p>
                          <h4 className="text-xl font-bold text-slate-900">
                            Faturas por cartão
                          </h4>
                          <button
                            type="button"
                            onClick={handleOpenCustomerPortal}
                            disabled={loading}
                            className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:bg-[#6926df] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <FileText size={16} />
                            Abrir faturas
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-[28px] border border-slate-100">
                      <div className="flex items-start gap-4">
                        <div className="p-3 rounded-2xl bg-white text-[#7a32fc] border border-slate-100">
                          <CreditCard size={22} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Pagamento
                          </p>
                          <h4 className="text-xl font-bold text-slate-900">
                            Cartão de crédito
                          </h4>
                          <button
                            type="button"
                            onClick={handleOpenCustomerPortal}
                            disabled={loading}
                            className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:border-[#7a32fc] hover:text-[#7a32fc] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <CreditCard size={16} />
                            Trocar cartão
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </motion.div>
            )}
            {activeTab === "rooms" && (
              <motion.div
                key="rooms"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                {renderRoomsContent()}
              </motion.div>
            )}
            {activeTab === "protocols" && (
              <div className="animate-fade-in">
                {!canManageProtocolLibrary && (
                  <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl p-4 text-xs font-semibold">
                    Modo terapeuta: execução permitida. A gestão da biblioteca de protocolos (criar, editar e excluir) está restrita à coordenação.
                  </div>
                )}
                <ProtocolManagementSystem
                  protocols={protocols}
                  canManageLibrary={canManageProtocolLibrary}
                  onSaveProtocol={(p: any, nextProtocols?: any[]) => {
                    if (!canManageProtocolLibrary) return;
                    if (Array.isArray(nextProtocols)) {
                      setProtocols(nextProtocols);
                      return;
                    }
                    const exists = protocols.find(
                      (old: any) => old.id === p.id,
                    );
                    if (exists) {
                      setProtocols(
                        protocols.map((old: any) =>
                          old.id === p.id ? p : old,
                        ),
                      );
                    } else {
                      setProtocols([...protocols, p]);
                    }
                  }}
                  onDeleteProtocol={(id: any) => {
                    if (!canManageProtocolLibrary) return;
                    setProtocols((prev: any[]) => prev.filter((p: any) => p.id !== id));
                  }}
                  onBack={goBackTab}
                />
              </div>
            )}
            {activeTab === "logs" && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900 mb-6">
                    Registros de Atividades da Clínica
                  </h3>
                  <div className="space-y-4">
                    {activityLogs && activityLogs.length > 0 ? (
                      activityLogs.map((log, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100"
                        >
                          <div
                            className={`p-2 rounded-xl ${
                              log.type === "management"
                                ? "bg-purple-100 text-purple-600"
                                : log.type === "clinical"
                                  ? "bg-blue-100 text-blue-600"
                                  : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            <History size={18} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-sm font-bold text-slate-900">
                                {repairMojibakeText(log.title || log.action || "Atividade registrada")}
                              </p>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                {(() => {
                                  if (log.time) return log.time;
                                  const rawTs = log.timestamp || log.created_at || log.date;
                                  if (!rawTs) return "Agora";
                                  const parsed = new Date(rawTs);
                                  return Number.isNaN(parsed.getTime())
                                    ? "Agora"
                                    : parsed.toLocaleString("pt-BR");
                                })()}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              {repairMojibakeText(log.content || log.details || "Ação registrada no sistema.")}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">
                              por {repairMojibakeText(log.actor_name || log.professional || "Profissional")}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-20">
                        <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center mx-auto mb-6 text-slate-200">
                          <History size={40} />
                        </div>
                        <h4 className="text-lg font-bold text-slate-900 mb-2">
                          Nenhuma atividade registrada
                        </h4>
                        <p className="text-sm text-slate-400 max-w-xs mx-auto">
                          As ações clínicas relevantes aparecerão aqui para
                          acompanhamento da coordenação.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {activeTab === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-slate-900">
                    {isTherapist ? "Meu Perfil Profissional" : "Meu Perfil e Configurações da Clínica"}
                  </h3>
                  <div className="flex items-center gap-3">
                    {canEditAnamnesisTemplate && (
                      <button
                        onClick={() => setIsAnamnesisTemplateModalOpen(true)}
                        disabled={loadingAnamnesisTemplate}
                        className="px-5 py-3 bg-white border border-[#7a32fc]/25 text-[#7a32fc] rounded-2xl font-bold text-sm hover:bg-[#f6f0ff] transition-all"
                      >
                        {loadingAnamnesisTemplate
                          ? "Carregando ficha..."
                          : "Editar Ficha Anamnese"}
                      </button>
                    )}
                    <button
                      onClick={handleSaveClinicSettings}
                      className="px-6 py-3 bg-[#7a32fc] text-white rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all"
                    >
                      {isTherapist ? "Salvar Perfil" : "Salvar Alterações"}
                    </button>
                  </div>
                </div>

                {isTherapist ? (
                  <div className="space-y-8">
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                      <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">
                        Dados obrigatórios para registros clínicos
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Nome Completo <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={therapistFullName}
                            onChange={(e) => setTherapistFullName(e.target.value)}
                            placeholder="Nome completo do profissional"
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            CRP <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={therapistCrp}
                            onChange={(e) => setTherapistCrp(e.target.value)}
                            placeholder="Ex: 06/123456"
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          />
                          {!therapistCanRegisterClinicalData && (
                            <p className="text-xs text-amber-700 font-semibold mt-2">
                              Complete seu perfil com o CRP para habilitar registros clínicos
                            </p>
                          )}
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Especialidades
                          </label>
                          <input
                            type="text"
                            value={therapistSpecialties}
                            onChange={(e) => setTherapistSpecialties(e.target.value)}
                            placeholder="Ex: ABA, TCC, Integração Sensorial"
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Mini Currículo
                          </label>
                          <textarea
                            rows={4}
                            value={therapistMiniCurriculum}
                            onChange={(e) => setTherapistMiniCurriculum(e.target.value)}
                            placeholder="Resumo profissional para relatórios e identificação clínica."
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Assinatura Digital
                          </label>
                          <label className="w-full min-h-[150px] p-4 bg-white border border-dashed border-slate-300 rounded-2xl flex items-center justify-center cursor-pointer hover:border-[#7a32fc] transition-all">
                            {therapistSignatureDataUrl ? (
                              <SecureImage src={therapistSignatureDataUrl} alt="Assinatura digital" className="max-h-28 object-contain" onError={() => { void retryMediaIfBroken("signature"); }} />
                            ) : (
                              <span className="text-xs font-semibold text-slate-500">
                                Clique para enviar assinatura
                              </span>
                            )}
                            <input
                              type="file"
                              className="hidden"
                              accept="image/png,image/webp,image/jpeg"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                readImageAsDataUrl(file, setTherapistSignatureDataUrl);
                              }}
                            />
                          </label>
                          <p className="text-[11px] text-slate-400 mt-2">
                            Recomendação: PNG com fundo transparente para relatórios.
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Foto de Perfil
                          </label>
                          <label className="w-full min-h-[150px] p-4 bg-white border border-dashed border-slate-300 rounded-2xl flex items-center justify-center cursor-pointer hover:border-[#7a32fc] transition-all">
                            {therapistProfilePhotoUrl ? (
                              <SecureImage src={therapistProfilePhotoUrl} alt="Foto de perfil" className="w-24 h-24 rounded-2xl object-cover" onError={() => { void retryMediaIfBroken("profile"); }} />
                            ) : (
                              <span className="text-xs font-semibold text-slate-500">
                                Clique para enviar foto
                              </span>
                            )}
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                readImageAsDataUrl(file, setTherapistProfilePhotoUrl);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {canManageClinicSettings ? (
                      <div className="space-y-6">
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                          Meu Perfil e Branding
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Nome Completo
                            </label>
                            <input
                              type="text"
                              value={therapistFullName}
                              onChange={(e) => setTherapistFullName(e.target.value)}
                              placeholder="Nome do coordenador responsável"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Assinatura Digital
                            </label>
                            <label className="w-full min-h-[150px] p-4 bg-white border border-dashed border-slate-300 rounded-2xl flex items-center justify-center cursor-pointer hover:border-[#7a32fc] transition-all">
                              {therapistSignatureDataUrl ? (
                                <SecureImage src={therapistSignatureDataUrl} alt="Assinatura digital" className="max-h-28 object-contain" onError={() => { void retryMediaIfBroken("signature"); }} />
                              ) : (
                                <span className="text-xs font-semibold text-slate-500">Clique para enviar assinatura</span>
                              )}
                              <input
                                type="file"
                                className="hidden"
                                accept="image/png,image/webp,image/jpeg"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  readImageAsDataUrl(file, setTherapistSignatureDataUrl);
                                }}
                              />
                            </label>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Foto de Perfil
                            </label>
                            <label className="w-full min-h-[150px] p-4 bg-white border border-dashed border-slate-300 rounded-2xl flex items-center justify-center cursor-pointer hover:border-[#7a32fc] transition-all">
                              {therapistProfilePhotoUrl ? (
                                <SecureImage src={therapistProfilePhotoUrl} alt="Foto de perfil" className="w-24 h-24 rounded-2xl object-cover" onError={() => { void retryMediaIfBroken("profile"); }} />
                              ) : (
                                <span className="text-xs font-semibold text-slate-500">Clique para enviar foto</span>
                              )}
                              <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  readImageAsDataUrl(file, setTherapistProfilePhotoUrl);
                                }}
                              />
                            </label>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Logotipo da Clínica
                            </label>
                            <label className="w-full min-h-[150px] p-4 bg-white border border-dashed border-slate-300 rounded-2xl flex items-center justify-center cursor-pointer hover:border-[#7a32fc] transition-all">
                              {clinicLogoDataUrl ? (
                                <SecureImage src={clinicLogoDataUrl} alt="Logo da clínica" className="max-h-28 object-contain" onError={() => { void retryMediaIfBroken("logo"); }} />
                              ) : (
                                <span className="text-xs font-semibold text-slate-500">Clique para enviar logotipo</span>
                              )}
                              <input
                                type="file"
                                className="hidden"
                                accept="image/png,image/webp,image/jpeg"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  readImageAsDataUrl(file, setClinicLogoDataUrl);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                          Horários da Clínica
                        </h4>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-2">
                                Início do Expediente
                              </label>
                              <input
                                type="time"
                                value={workStart}
                                onChange={(e) => setWorkStart(e.target.value)}
                                className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-slate-700 mb-2">
                                Fim do Expediente
                              </label>
                              <input
                                type="time"
                                value={workEnd}
                                onChange={(e) => setWorkEnd(e.target.value)}
                                className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              CNPJ da Clínica
                            </label>
                            <input
                              type="text"
                              value={clinicCnpj}
                              onChange={(e) => setClinicCnpj(formatCnpjInput(e.target.value))}
                              placeholder="00.000.000/0000-00"
                              className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                        </div>
                        <PayerRequirementsPanel />
                      </div>
                    ) : (
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 text-sm font-semibold text-slate-500">
                        Configurações iniciais da clínica disponíveis apenas para coordenação.
                      </div>
                    )}

                    {canManageBilling && (
                      <div className="space-y-6">
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                          Plano e Assinatura
                        </h4>
                        <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100">
                          <div className="flex items-center justify-between mb-4">
                            <p className="text-sm font-bold text-blue-900">
                              Plano {normalizedPlanName}
                            </p>
                            <span className="px-3 py-1 bg-blue-100 text-[#7a32fc] rounded-lg text-[10px] font-bold uppercase">
                              Ativo
                            </span>
                          </div>
                          <p className="text-xs text-blue-600 mb-6">
                            Sua clínica possui acesso a todas as ferramentas de
                            gestão e prontuário eletrônico.
                          </p>
                          <button
                            onClick={() => navigateToTab("billing")}
                            className="w-full py-3 bg-[#7a32fc] text-white rounded-2xl font-bold text-xs shadow-sm hover:opacity-90 transition-all"
                          >
                            Gerenciar Assinatura
                          </button>
                        </div>
                      </div>
                    )}

                    {!isTherapist && (
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                            Gestão da clínica
                          </h4>
                          <p className="mt-2 text-sm text-slate-500">
                            Acompanhe as permissões de cada papel para organizar acessos, responsabilidades e rotinas da equipe.
                          </p>
                        </div>
                        <RoleCapabilityMatrix />
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {showInvitationModal && (
        <InvitationModal
          user={user}
          onClose={() => setShowInvitationModal(false)}
        />
      )}

      <AnamnesisModal
        isOpen={isAnamnesisTemplateModalOpen}
        onClose={() => setIsAnamnesisTemplateModalOpen(false)}
        initialData={{ nome: "Template da Clínica" }}
        mode="edit"
        onSave={() => setIsAnamnesisTemplateModalOpen(false)}
        template={anamnesisTemplate}
        canEditTemplate={canEditAnamnesisTemplate}
        onTemplateSave={handleSaveClinicAnamnesisTemplate}
      />

      {isAddSessionModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsAddSessionModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[32px] p-8 shadow-2xl animate-pop relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsAddSessionModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2 tracking-tight">
              <CalendarPlus size={24} className="text-[#7a32fc]" />{" "}
              {editingAppointmentId ? "Editar Agendamento" : "Agendar Sessão"}
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Paciente
                </label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold text-slate-700"
                  placeholder="Buscar..."
                  value={sessionPatientName}
                  onChange={(e) => setSessionPatientName(e.target.value)}
                />
                {filteredPatients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-100 rounded-xl shadow-xl mt-1 z-20 max-h-40 overflow-y-auto no-scrollbar">
                    {filteredPatients.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => selectPatientForSession(p.name)}
                        className="p-3 hover:bg-slate-50 cursor-pointer text-sm font-semibold text-slate-700 border-b border-slate-50 last:border-0 flex items-center gap-2"
                      >
                        <div className="w-6 h-6 rounded-full bg-blue-50 text-[#7a32fc] flex items-center justify-center text-xs">
                          {(String(p?.name || "P").trim().charAt(0) || "P").toUpperCase()}
                        </div>
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Hora de início
                  </label>
                  <input
                    type="time"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionTime}
                    onChange={(e) => setSessionTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Duração
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionDurationOption}
                    onChange={(e) => setSessionDurationOption(e.target.value)}
                  >
                    {SESSION_DURATION_QUICK_OPTIONS.map((duration) => (
                      <option key={duration} value={String(duration)}>
                        {duration} min
                      </option>
                    ))}
                    <option value="custom">Personalizado</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Hora de fim
                  </label>
                  <div className="w-full bg-slate-100 border border-slate-100 rounded-xl p-3 text-sm font-black text-slate-700">
                    {sessionEndTime}
                  </div>
                </div>
              </div>
              {sessionDurationOption === "custom" && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Duração personalizada em minutos
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={720}
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionCustomDuration}
                    onChange={(e) => setSessionCustomDuration(e.target.value)}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Tipo de sessão
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionApproach}
                    onChange={(e) => setSessionApproach(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    <option value="ABA">ABA</option>
                    <option value="Fonoaudiologia">Fonoaudiologia</option>
                    <option value="Terapia Ocupacional">Terapia Ocupacional</option>
                    <option value="Psicologia">Psicologia</option>
                    <option value="Psicopedagogia">Psicopedagogia</option>
                    <option value="Avaliação">Avaliação</option>
                    <option value="Supervisão">Supervisão</option>
                    <option value="Reunião interdisciplinar">Reunião interdisciplinar</option>
                    <option value="Orientação familiar">Orientação familiar</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Local do atendimento
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionLocationType}
                    onChange={(e) => {
                      const nextLocation = e.target.value as ScheduleLocationType;
                      setSessionLocationType(nextLocation);
                      if (nextLocation !== "clinica") setSessionRoom("");
                    }}
                  >
                    {SCHEDULE_LOCATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {sessionLocationType === "clinica" ? (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Sala <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionRoom}
                    onChange={(e) => setSessionRoom(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {activeClinicRooms.map((room: any) => {
                      const roomSpecialties = Array.isArray(room.specialties)
                        ? room.specialties.join(", ")
                        : String(room.specialties || room.specialty || "").trim();
                      return (
                        <option key={room.id} value={room.id}>
                          {roomSpecialties ? `${room.name || "Sala não identificada"} · ${roomSpecialties}` : room.name || "Sala não identificada"}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : sessionLocationType === "online" ? (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Link da chamada <span className="text-slate-300 normal-case tracking-normal">(opcional)</span>
                  </label>
                  <input
                    type="url"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionCallLink}
                    onChange={(e) => setSessionCallLink(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Endereço/observação <span className="text-slate-300 normal-case tracking-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionLocationNotes}
                    onChange={(e) => setSessionLocationNotes(e.target.value)}
                    placeholder="Endereço, sala externa ou referência"
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Terapeuta Responsável
                </label>
                <select
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                  placeholder="Nome do Profissional"
                  value={sessionProfessional}
                  onChange={(e) => setSessionProfessional(e.target.value)}
                >
                  <option value="">Selecione...</option>
                  {therapistFilterOptions.map((member) => (
                    <option key={member.id} value={member.label}>
                      {member.label}
                    </option>
                  ))}
                  {sessionProfessional &&
                    !therapistFilterOptions.some(
                      (member) => member.label === sessionProfessional,
                    ) && (
                      <option value={sessionProfessional}>{sessionProfessional}</option>
                  )}
                </select>
              </div>
              {!isTherapist && (
                <div className="rounded-3xl border border-violet-100 bg-violet-50/70 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#7a32fc]">
                    Pagador e conferência
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Pagador/convênio
                      <select
                        className="mt-1 w-full rounded-xl border border-violet-100 bg-white p-3 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none"
                        value={sessionPayerSelectValue}
                        onChange={(e) => handleSessionPayerChange(e.target.value)}
                      >
                        <option value="">Sem pagador</option>
                        {hasPatientInsuranceSnapshotOption && (
                          <option value={SESSION_PATIENT_INSURANCE_PAYER_VALUE}>
                            Convênio do paciente: {sessionPayerSnapshotOptionLabel}
                          </option>
                        )}
                        {hasSessionPayerIdOption && (
                          <option value={sessionPayerId}>
                            {sessionPayerNameSnapshot || selectedSessionPatientInsurancePayer.payerName || "Pagador cadastrado"}
                          </option>
                        )}
                        {clinicPayers.map((payer: any) => (
                          <option key={payer.id} value={payer.id}>
                            {payer.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Guia
                      <input
                        className="mt-1 w-full rounded-xl border border-violet-100 bg-white p-3 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none"
                        value={sessionGuideNumber}
                        onChange={(e) => setSessionGuideNumber(e.target.value)}
                        placeholder="Número da guia"
                      />
                    </label>
                    <label className="sm:col-span-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Autorização/senha
                      <input
                        className="mt-1 w-full rounded-xl border border-violet-100 bg-white p-3 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none"
                        value={sessionAuthorizationCode}
                        onChange={(e) => setSessionAuthorizationCode(e.target.value)}
                        placeholder="Código informado pelo pagador"
                      />
                    </label>
                  </div>
                </div>
              )}
              {scheduleConflictState.checked && (
                <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
                  scheduleConflictState.blocking
                    ? "border-red-100 bg-red-50 text-red-700"
                    : "border-emerald-100 bg-emerald-50 text-emerald-700"
                }`}>
                  <div className="flex items-center gap-2">
                    {scheduleConflictState.loading ? (
                      <Clock size={16} className="animate-pulse" />
                    ) : scheduleConflictState.blocking ? (
                      <AlertCircle size={16} />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    <span>
                      {scheduleConflictState.loading
                        ? "Verificando conflitos..."
                        : scheduleConflictState.blocking
                          ? "Conflito encontrado"
                          : "Horário disponível"}
                    </span>
                  </div>
                  {scheduleConflictState.message && (
                    <p className="mt-1 text-xs font-medium opacity-90">
                      {scheduleConflictState.message}
                    </p>
                  )}
                </div>
              )}
              {editingAppointmentId && isEditingRecurringAppointment && (
                <div className="rounded-3xl border border-violet-100 bg-violet-50 p-4">
                  <p className="text-sm font-black text-slate-800">
                    Este agendamento faz parte de uma recorrência.
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Escolha se a remarcação vale só para esta data ou para esta e as próximas consultas da série.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setAppointmentEditScope("single")}
                      className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${
                        appointmentEditScope === "single"
                          ? "bg-[#7a32fc] text-white shadow-lg shadow-violet-500/20"
                          : "text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Só este dia
                    </button>
                    <button
                      type="button"
                      onClick={() => setAppointmentEditScope("future")}
                      className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${
                        appointmentEditScope === "future"
                          ? "bg-[#7a32fc] text-white shadow-lg shadow-violet-500/20"
                          : "text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Este e próximos
                    </button>
                  </div>
                </div>
              )}
              {!editingAppointmentId && (
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                      checked={Number(sessionNumSessions) > 1}
                      onChange={(e) => setSessionNumSessions(e.target.checked ? 4 : 1)}
                    />
                    <span>
                      <span className="block text-sm font-black text-slate-800">
                        Reservar semanalmente este dia e horário
                      </span>
                      <span className="mt-1 block text-xs font-medium text-slate-500">
                        Cria consultas recorrentes para o mesmo paciente, sala, profissional e horário. Os lembretes seguem separados para cada data.
                      </span>
                    </span>
                  </label>
                  {Number(sessionNumSessions) > 1 && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] items-end gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                          Recorrência
                        </label>
                        <select
                          className="w-full bg-white border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                          value={sessionRecurrencePattern}
                          onChange={(e) => setSessionRecurrencePattern(e.target.value)}
                        >
                          <option value="weekly">Semanal</option>
                          <option value="biweekly">Quinzenal</option>
                          <option value="monthly">Mensal</option>
                          <option value="custom">Personalizada</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                          Quantidade de sessões
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={52}
                          className="w-full bg-white border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                          value={sessionNumSessions}
                          onChange={(e) =>
                            setSessionNumSessions(
                              Math.min(52, Math.max(2, Number(e.target.value) || 2)),
                            )
                          }
                        />
                      </div>
                      <span className="pb-3 text-xs font-bold text-slate-400">
                        ocorrências
                      </span>
                    </div>
                  )}
                  {Number(sessionNumSessions) > 1 && (
                    <div className="mt-4 rounded-2xl bg-white p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Preview das próximas datas
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {sessionRecurrenceDates.slice(0, 8).map((dateKey) => (
                          <span key={dateKey} className="rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                            {dateKey}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleSessionSubmit}
                disabled={!requiredSessionFieldsReady || scheduleConflictState.blocking || scheduleConflictState.loading}
                className="w-full bg-[#7a32fc] text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all mt-2 active:scale-95 uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editingAppointmentId
                  ? "Salvar Alterações"
                  : "Confirmar Agendamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isQuickRegisterModalOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsQuickRegisterModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsQuickRegisterModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2 tracking-tight">
              <UserPlus size={24} className="text-[#7a32fc]" /> Cadastro Rápido
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Nome Completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold text-slate-700"
                  placeholder="Nome do paciente"
                  value={quickPatientName}
                  onChange={(e) => setQuickPatientName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Idade
                  </label>
                  <input
                    type="number"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    placeholder="Ex: 25"
                    value={quickPatientAge}
                    onChange={(e) => setQuickPatientAge(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    placeholder="(00) 00000-0000"
                    value={quickPatientPhone}
                    onChange={(e) => setQuickPatientPhone(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                  placeholder="email@exemplo.com"
                  value={quickPatientEmail}
                  onChange={(e) => setQuickPatientEmail(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-slate-400 font-medium italic">
                * Cadastro simplificado para agendamento e faturamento imediato.
              </p>
              <button
                onClick={handleQuickRegister}
                className="w-full bg-[#7a32fc] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#7a32fc]/20 hover:opacity-90 transition-all mt-2 active:scale-95 uppercase tracking-widest text-xs"
              >
                Cadastrar Paciente
              </button>
            </div>
          </div>
        </div>
      )}

      {isPatientProfileModalOpen && selectedPatientProfile && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setIsPatientProfileModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-2xl rounded-3xl p-6 md:p-8 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900">
                Informações cadastrais
              </h3>
              <button
                onClick={() => setIsPatientProfileModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={22} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-slate-400">Nome:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.name || "-"}</p></div>
              <div><span className="text-slate-400">Nome social:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.socialName || "-"}</p></div>
              <div><span className="text-slate-400">Nascimento:</span> <p className="font-semibold text-slate-800">{formatBirthDateForDisplay(selectedPatientProfile.birthDate || selectedPatientProfile.birth_date || selectedPatientProfile.dataNascimento) || "-"}</p></div>
              <div><span className="text-slate-400">Telefone:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.phone || "-"}</p></div>
              <div><span className="text-slate-400">Email:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.email || "-"}</p></div>
              <div><span className="text-slate-400">Convênio:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.insuranceName || selectedPatientProfile.insuranceType || "-"}</p></div>
              <div><span className="text-slate-400">Carteirinha:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.cardNumber || "-"}</p></div>
              <div><span className="text-slate-400">RG:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.rg || "-"}</p></div>
              <div><span className="text-slate-400">CPF:</span> <p className="font-semibold text-slate-800">{formatCpf(selectedPatientProfile.cpf || "") || "-"}</p></div>
              <div><span className="text-slate-400">Perfil:</span> <p className="font-semibold text-slate-800">{getPatientProfileTypeLabel(selectedPatientProfile.patientProfileType)}</p></div>
              <div className="md:col-span-2"><span className="text-slate-400">Endereço:</span> <p className="font-semibold text-slate-800">{[selectedPatientProfile.address?.logradouro, selectedPatientProfile.address?.numero, selectedPatientProfile.address?.complemento, selectedPatientProfile.address?.bairro, selectedPatientProfile.address?.cidade].filter(Boolean).join(" - ") || "-"}</p></div>
              <div className="md:col-span-2"><span className="text-slate-400">Observações:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.notes || "-"}</p></div>
            </div>
          </div>
        </div>
      )}

      {pendingRecurringCancellation && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-violet-100 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-500">
                  Recorrência
                </p>
                <h3 className="text-lg font-bold text-slate-900">
                  Como deseja cancelar?
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Esta consulta faz parte de uma série recorrente. O cancelamento pode valer só para esta data ou para esta e as próximas consultas.
                </p>
              </div>
              <button
                onClick={() => setPendingRecurringCancellation(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-bold text-slate-800">
                {pendingRecurringCancellation.appointment?.patientName ||
                  pendingRecurringCancellation.appointment?.name ||
                  "Paciente"}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {pendingRecurringCancellation.appointment?.date} às{" "}
                {pendingRecurringCancellation.appointment?.time}
              </p>
            </div>

            <div className="mt-6 grid gap-2">
              <button
                onClick={() => submitRecurringCancellation("single")}
                className="rounded-2xl border border-rose-200 px-4 py-3 text-left text-sm font-semibold text-rose-600 transition-all hover:bg-rose-50"
              >
                Cancelar só esta consulta
              </button>
              <button
                onClick={() => submitRecurringCancellation("future")}
                className="rounded-2xl bg-rose-600 px-4 py-3 text-left text-sm font-semibold text-white transition-all hover:bg-rose-700"
              >
                Cancelar esta e as próximas
              </button>
              <button
                onClick={() => setPendingRecurringCancellation(null)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAgendaAppointment && (
        <div
          className="fixed inset-0 z-[135] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={closeAgendaActionModal}
        >
          <div
            className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  Agendamento
                </p>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedAgendaAppointment.patientName ||
                    selectedAgendaAppointment.name ||
                    "Paciente"}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {selectedAgendaAppointment.date} às {selectedAgendaAppointment.time}
                  {selectedAgendaAppointment.therapistDisplayName
                    ? ` • ${selectedAgendaAppointment.therapistDisplayName}`
                    : ""}
                  {selectedAgendaAppointment.roomDisplayName
                    ? ` • ${selectedAgendaAppointment.roomDisplayName}`
                    : ""}
                </p>
              </div>
              <button
                onClick={closeAgendaActionModal}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-5">
              {(() => {
                const statusVisual = getAgendaStatusVisual(
                  selectedAgendaAppointment.status,
                );
                const StatusIcon = statusVisual.icon;
                return (
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase ${statusVisual.badge}`}
                  >
                    <StatusIcon size={12} />
                    {statusVisual.label}
                  </span>
                );
              })()}
            </div>

            <div className="mb-5">
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Observação da consulta
              </label>
              <textarea
                value={agendaAppointmentObservation}
                onChange={(event) => setAgendaAppointmentObservation(event.target.value)}
                maxLength={1200}
                rows={3}
                placeholder="Registre informações importantes sobre este agendamento..."
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-[#7a32fc] focus:ring-4 focus:ring-[#7a32fc]/10"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() =>
                  handleConfirmAppointmentFromAgenda(selectedAgendaAppointment)
                }
                className="flex items-center gap-2 rounded-2xl border border-emerald-200 px-4 py-3 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition-all"
              >
                <CheckCircle2 size={16} />
                Confirmar
              </button>
              <button
                onClick={() =>
                  handleRescheduleAppointmentFromAgenda(selectedAgendaAppointment)
                }
                className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all"
              >
                <Edit2 size={16} className="text-[#7a32fc]" />
                Remarcar
              </button>
              <button
                onClick={() =>
                  handleCancelAppointmentFromAgenda(selectedAgendaAppointment)
                }
                className="flex items-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-all"
              >
                <XCircle size={16} />
                Cancelar
              </button>
              <button
                onClick={() =>
                  handleDeleteAppointmentFromAgenda(selectedAgendaAppointment)
                }
                className="flex items-center gap-2 rounded-2xl border border-rose-200 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-all"
              >
                <Trash2 size={16} />
                Excluir
              </button>
              <button
                onClick={() =>
                  openAppointmentProfileFromAgenda(selectedAgendaAppointment)
                }
                className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all sm:col-span-2"
              >
                <Search size={16} className="text-[#7a32fc]" />
                {isReceptionist ? "Visualizar ficha cadastral" : "Ficha cadastral"}
              </button>
              {!isReceptionist && (
                <>
                  <button
                    onClick={() =>
                      openAppointmentChartFromAgenda(
                        selectedAgendaAppointment,
                        true,
                      )
                    }
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all"
                  >
                    <ClipboardCheck size={16} className="text-purple-600" />
                    Anamnese
                  </button>
                  <button
                    onClick={() =>
                      openAppointmentChartFromAgenda(
                        selectedAgendaAppointment,
                        false,
                      )
                    }
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all"
                  >
                    <FileText size={16} className="text-blue-600" />
                    Prontuário
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {isPatientRegistrationModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsPatientRegistrationModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-[32px] p-6 md:p-8 shadow-2xl animate-pop relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsPatientRegistrationModalOpen(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>

            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              {editingPatientId
                ? "Editar Cadastro de Paciente"
                : "Cadastro Completo de Paciente"}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Nome*" value={newPatientForm.nome} onChange={(e) => handlePatientFormChange("nome", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Nome social" value={newPatientForm.nomeSocial} onChange={(e) => handlePatientFormChange("nomeSocial", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Telefone*" value={newPatientForm.telefone} onChange={(e) => handlePatientFormChange("telefone", e.target.value)} />
              <input type="date" className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.dataNascimento} onChange={(e) => handlePatientFormChange("dataNascimento", e.target.value)} />
              <select className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.genero} onChange={(e) => handlePatientFormChange("genero", e.target.value)}>
                <option value="">Gênero</option>
                <option value="feminino">Feminino</option>
                <option value="masculino">Masculino</option>
                <option value="nao_binario">Não binário</option>
                <option value="prefiro_nao_informar">Prefiro não informar</option>
              </select>
              <select className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.grupo} onChange={(e) => handlePatientFormChange("grupo", e.target.value)}>
                <option value="infantil">Infantil</option>
                <option value="adolescente">Adolescente</option>
                <option value="adulto">Adulto</option>
                <option value="idoso">Idoso</option>
              </select>
              <select className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.convenioTipo} onChange={(e) => handlePatientFormChange("convenioTipo", e.target.value)}>
                <option value="particular">Particular</option>
                <option value="convenio">Convênio</option>
              </select>
              <select className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.convenioNome} onChange={(e) => handlePatientFormChange("convenioNome", e.target.value)}>
                <option value="">Selecione o convênio</option>
                {insuranceOptions.map((ins) => (
                  <option key={ins} value={ins}>{ins}</option>
                ))}
              </select>
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Carteirinha do convênio" value={newPatientForm.convenioCarteirinha} onChange={(e) => handlePatientFormChange("convenioCarteirinha", e.target.value)} />
              {canAccessClinicFinance && (
                <div className="md:col-span-2 xl:col-span-3 rounded-3xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                        Plano financeiro do tratamento
                      </p>
                      <p className="text-[11px] font-medium text-slate-400">
                        Modalidade, pagador, autorizações e valores por linha de cuidado.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addFinancialPlanRow}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2 text-xs font-bold text-[#7a32fc] shadow-sm transition-all hover:bg-violet-50"
                    >
                      <Plus size={14} /> Plano
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(() => {
                      const plans = normalizePatientFinancialPlans(newPatientForm.financialPlans, newPatientForm);
                      if (!plans.length) {
                        return (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-xs font-semibold text-slate-400">
                            Nenhum plano financeiro cadastrado.
                          </div>
                        );
                      }
                      return plans.map((plan: any) => {
                        const showPaymentMethod = financialPlanRequiresPaymentMethod(plan);
                        const isInsurancePlan = plan.billingMode === "INSURANCE";
                        const isPackagePlan = plan.billingMode === "PACKAGE";
                        const isCourtesyPlan = plan.billingMode === "COURTESY";
                        const isMonthlyPlan = plan.billingMode === "MONTHLY";
                        return (
                          <div key={plan.id} className="grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm md:grid-cols-6">
                            <select
                              className="rounded-xl bg-slate-50 p-3 text-sm md:col-span-2"
                              value={plan.serviceType}
                              onChange={(e) => handleFinancialPlanChange(plan.id, "serviceType", e.target.value)}
                            >
                              <option value="">Especialidade/serviço</option>
                              {PATIENT_FINANCIAL_SERVICE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            {plan.serviceType === "CUSTOM" && (
                              <input
                                className="rounded-xl bg-slate-50 p-3 text-sm md:col-span-2"
                                placeholder="Nome do serviço"
                                value={plan.customServiceName}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "customServiceName", e.target.value)}
                              />
                            )}
                            <select
                              className="rounded-xl bg-slate-50 p-3 text-sm"
                              value={plan.billingMode}
                              onChange={(e) => handleFinancialPlanChange(plan.id, "billingMode", e.target.value)}
                            >
                              {PATIENT_FINANCIAL_BILLING_MODE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            {!isCourtesyPlan && (
                              <input
                                className="rounded-xl bg-slate-50 p-3 text-sm"
                                placeholder={isInsurancePlan ? "Valor autorizado R$" : isPackagePlan ? "Valor pacote R$" : isMonthlyPlan ? "Mensalidade R$" : "Valor R$"}
                                inputMode="decimal"
                                value={plan.amount}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "amount", e.target.value)}
                              />
                            )}
                            <div className="flex items-center gap-2">
                              <input
                                className="min-w-0 flex-1 rounded-xl bg-slate-50 p-3 text-sm"
                                placeholder={isInsurancePlan ? "Qtde. autorizada" : "Sessões"}
                                type="number"
                                min={1}
                                value={plan.sessionsQuantity}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "sessionsQuantity", e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={() => removeFinancialPlanRow(plan.id)}
                                className="rounded-xl p-3 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                title="Remover plano financeiro"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <select
                              className="rounded-xl bg-slate-50 p-3 text-sm"
                              value={plan.quantityPeriod}
                              onChange={(e) => handleFinancialPlanChange(plan.id, "quantityPeriod", e.target.value)}
                            >
                              {PATIENT_FINANCIAL_QUANTITY_PERIOD_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            {isMonthlyPlan && (
                              <input
                                className="rounded-xl bg-slate-50 p-3 text-sm"
                                placeholder="Venc. dia"
                                type="number"
                                min={1}
                                max={31}
                                value={plan.dueDay}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "dueDay", e.target.value)}
                              />
                            )}
                            {isPackagePlan && (
                              <input
                                type="date"
                                className="rounded-xl bg-slate-50 p-3 text-sm"
                                value={plan.packageValidUntil}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "packageValidUntil", e.target.value)}
                              />
                            )}
                            {isInsurancePlan && (
                              <>
                                <select
                                  className="rounded-xl bg-slate-50 p-3 text-sm md:col-span-2"
                                  value={plan.payerId || ""}
                                  onChange={(e) => {
                                    const payer = clinicPayers.find((item: any) => String(item?.id) === e.target.value);
                                    handleFinancialPlanChange(plan.id, "payerId", e.target.value);
                                    handleFinancialPlanChange(plan.id, "payerNameSnapshot", payer?.name || plan.payerNameSnapshot || "");
                                  }}
                                >
                                  <option value="">Pagador/convênio</option>
                                  {clinicPayers.map((payer: any) => (
                                    <option key={`financial-payer-${plan.id}-${payer.id}`} value={payer.id}>
                                      {payer.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  className="rounded-xl bg-slate-50 p-3 text-sm"
                                  placeholder="Nome do convênio"
                                  value={plan.payerNameSnapshot}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "payerNameSnapshot", e.target.value)}
                                />
                                <input
                                  className="rounded-xl bg-slate-50 p-3 text-sm"
                                  placeholder="Autorização"
                                  value={plan.authorizationCode}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "authorizationCode", e.target.value)}
                                />
                                <input
                                  type="date"
                                  className="rounded-xl bg-slate-50 p-3 text-sm"
                                  value={plan.authorizationValidUntil}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "authorizationValidUntil", e.target.value)}
                                />
                                <input
                                  className="rounded-xl bg-slate-50 p-3 text-sm"
                                  placeholder="Coparticipação R$"
                                  inputMode="decimal"
                                  value={plan.copaymentAmount}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "copaymentAmount", e.target.value)}
                                />
                              </>
                            )}
                            {showPaymentMethod && (
                              <select
                                className="rounded-xl bg-slate-50 p-3 text-sm"
                                value={plan.paymentMethod}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "paymentMethod", e.target.value)}
                              >
                                <option value="">Forma de pagamento</option>
                                {PATIENT_FINANCIAL_PAYMENT_METHOD_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            )}
                            {(isCourtesyPlan || plan.billingMode === "OTHER") && (
                              <input
                                className="rounded-xl bg-slate-50 p-3 text-sm md:col-span-3"
                                placeholder="Observação"
                                value={plan.notes}
                                onChange={(e) => handleFinancialPlanChange(plan.id, "notes", e.target.value)}
                              />
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
              <select className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.comoConheceu} onChange={(e) => handlePatientFormChange("comoConheceu", e.target.value)}>
                <option value="">Como conheceu a clínica?</option>
                <option value="google">Google</option>
                <option value="indicacao">Indicação</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="rede_social">Rede social</option>
                <option value="evento">Evento</option>
                <option value="convenio">Convênio</option>
                <option value="outro">Outro</option>
              </select>
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="RG" value={newPatientForm.rg} onChange={(e) => handlePatientFormChange("rg", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="CPF" value={newPatientForm.cpf} onChange={(e) => handlePatientFormChange("cpf", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="CEP" value={newPatientForm.cep} onChange={(e) => handlePatientFormChange("cep", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="E-mail" value={newPatientForm.email} onChange={(e) => handlePatientFormChange("email", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Logradouro" value={newPatientForm.logradouro} onChange={(e) => handlePatientFormChange("logradouro", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Número" value={newPatientForm.numero} onChange={(e) => handlePatientFormChange("numero", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Complemento" value={newPatientForm.complemento} onChange={(e) => handlePatientFormChange("complemento", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Bairro" value={newPatientForm.bairro} onChange={(e) => handlePatientFormChange("bairro", e.target.value)} />
              <input className="bg-slate-50 rounded-xl p-3 text-sm md:col-span-2" placeholder="Cidade" value={newPatientForm.cidade} onChange={(e) => handlePatientFormChange("cidade", e.target.value)} />

              <div className="md:col-span-2 xl:col-span-3">
                <label className="block text-xs font-bold text-slate-600 mb-2">
                  Selecione o tipo de portal desse paciente
                </label>
                <p className="text-[11px] text-slate-400 mb-2">
                  Qual a área de acesso do paciente no aplicativo?
                </p>
              </div>
              <select className="bg-slate-50 rounded-xl p-3 text-sm md:col-span-2 xl:col-span-3" value={newPatientForm.patientProfileType} onChange={(e) => handlePatientFormChange("patientProfileType", e.target.value)}>
                {PATIENT_PROFILE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={newPatientForm.menorDeIdade} onChange={(e) => handlePatientFormChange("menorDeIdade", e.target.checked)} />
                Menor de idade
              </label>
            </div>

            {newPatientForm.menorDeIdade && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Nome do responsável" value={newPatientForm.responsavelNome} onChange={(e) => handlePatientFormChange("responsavelNome", e.target.value)} />
                <input type="date" className="bg-slate-50 rounded-xl p-3 text-sm" value={newPatientForm.responsavelDataNascimento} onChange={(e) => handlePatientFormChange("responsavelDataNascimento", e.target.value)} />
                <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="CPF do responsável" value={newPatientForm.responsavelCpf} onChange={(e) => handlePatientFormChange("responsavelCpf", e.target.value)} />
                <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Telefone do responsável" value={newPatientForm.responsavelTelefone} onChange={(e) => handlePatientFormChange("responsavelTelefone", e.target.value)} />
                <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="E-mail do responsável" value={newPatientForm.responsavelEmail} onChange={(e) => handlePatientFormChange("responsavelEmail", e.target.value)} />
                <input className="bg-slate-50 rounded-xl p-3 text-sm" placeholder="Relação com o paciente" value={newPatientForm.responsavelRelacao} onChange={(e) => handlePatientFormChange("responsavelRelacao", e.target.value)} />
              </div>
            )}

            <textarea
              className="w-full mt-4 bg-slate-50 rounded-xl p-3 text-sm min-h-[110px]"
              placeholder="Outras informações"
              value={newPatientForm.outrasInformacoes}
              onChange={(e) => handlePatientFormChange("outrasInformacoes", e.target.value)}
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsPatientRegistrationModalOpen(false)}
                className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreatePatientFromFullForm}
                className="px-6 py-3 rounded-xl bg-[#7a32fc] text-white font-semibold shadow-lg shadow-purple-500/20"
              >
                {editingPatientId ? "Salvar alterações" : "Cadastrar paciente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {processingState.active && (
        <div className="fixed inset-0 z-[175] bg-black/30 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl px-6 py-5 shadow-2xl border border-slate-100 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[#7a32fc]/30 border-t-[#7a32fc] rounded-full animate-spin" />
            <span className="text-sm font-semibold text-slate-700">
              {processingState.message || "Processando..."}
            </span>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[176] max-w-sm">
          <div
            className={`rounded-2xl px-4 py-3 shadow-xl border text-sm font-semibold ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : toast.type === "error"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-blue-50 border-blue-200 text-blue-700"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {pendingRecurringDeletion && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-rose-100 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-rose-500">
                  Recorrência
                </p>
                <h3 className="text-lg font-bold text-slate-900">
                  Como deseja excluir?
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Esta consulta faz parte de uma série recorrente. A exclusão remove o agendamento da agenda só nesta data ou nesta e nas próximas consultas.
                </p>
              </div>
              <button
                onClick={() => setPendingRecurringDeletion(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-bold text-slate-800">
                {pendingRecurringDeletion.appointment?.patientName ||
                  pendingRecurringDeletion.appointment?.name ||
                  "Paciente"}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {pendingRecurringDeletion.appointment?.date} às{" "}
                {pendingRecurringDeletion.appointment?.time}
              </p>
            </div>

            <div className="mt-6 grid gap-2">
              <button
                onClick={() => submitRecurringDeletion("single")}
                className="rounded-2xl border border-rose-200 px-4 py-3 text-left text-sm font-semibold text-rose-600 transition-all hover:bg-rose-50"
              >
                Excluir só esta consulta
              </button>
              <button
                onClick={() => submitRecurringDeletion("future")}
                className="rounded-2xl bg-rose-600 px-4 py-3 text-left text-sm font-semibold text-white transition-all hover:bg-rose-700"
              >
                Excluir esta e as próximas
              </button>
              <button
                onClick={() => setPendingRecurringDeletion(null)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {actionPopup && (
        <div className="fixed inset-0 z-[170] bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 p-6">
            <h3 className="text-lg font-bold text-slate-900">{actionPopup.title}</h3>
            <p className="text-sm text-slate-600 mt-2">{actionPopup.message}</p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setActionPopup(null)}
                className="px-4 py-2.5 rounded-xl bg-[#7a32fc] text-white font-semibold text-sm"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





