import React, { useState, useMemo, useEffect, useRef } from "react";
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
  CalendarRange,
  CalendarDays,
  CalendarPlus,
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
import { AnamnesisModal } from "./Anamnesis";
import { RoomReservation } from "./RoomReservation";
import { ProtocolManagementSystem } from "./Protocols";
import { CalendarWidget, DayDetailsModal } from "./Calendar";
import { RoleCapabilityMatrix } from "./RoleCapabilityMatrix";
import { LogoVerto } from "./Common";
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
import { ROLE_CAPABILITY_SECTIONS } from "../constants/roleCapabilities";
import {
  getDefaultAnamnesisTemplate,
  normalizeAnamnesisTemplate,
} from "../lib/anamnesisSchema";

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
  onUpdateAppointment: (id: number, updates: any) => void;
  onUpdateAgendaStatus: (id: number, status: string) => void;
  onAddPatient: (patient: any) => void;
  patientsHistory: any[];
  therapistNotes: any[];
  onAddNote: (
    pid: any,
    txt: string,
    visibility: string,
    subject?: string,
  ) => void;
  onUpdateProfile: (updates: any) => void;
  onUpdatePatient?: (patient: any) => void;
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
  type ClinicBillingSummary = {
    activePatients: number;
    unitPrice: number;
    additionalCost: number;
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
  const canCreatePatients = !isTherapist;
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
    rooms: "rooms",
  };

  const canAccessTab = (tabId: string) => {
    const capability = tabCapabilityMap[tabId];
    if (!capability) return true;
    const status = capabilityStatusForRole(capability);
    if (status === "none") return false;
    return true;
  };

  const filterTabsByRole = <T extends { id: string }>(items: T[]) =>
    items.filter((item) => {
      const capability = tabCapabilityMap[item.id];
      if (!capability) return true;
      const capabilityStatus = capabilityStatusForRole(capability);
      if (capabilityStatus === "none") return false;
      return true;
    });

  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "team"
    | "financial"
    | "patients"
    | "agenda"
    | "rooms"
    | "protocols"
    | "settings"
    | "logs"
    | "billing"
  >("dashboard");
  const [tabHistory, setTabHistory] = useState<string[]>(["dashboard"]);
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [showBillingDetails, setShowBillingDetails] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [therapistMembersById, setTherapistMembersById] = useState<Record<string, any>>({});
  const [patientTherapistFilter, setPatientTherapistFilter] = useState<string>("all");

  const navigateToTab = (
    tab:
      | "dashboard"
      | "team"
      | "financial"
      | "patients"
      | "agenda"
      | "rooms"
      | "protocols"
      | "settings"
      | "logs"
      | "billing",
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
          const role = String(member?.role || "").toLowerCase();
          const id = String(member?.id || "").trim();
          if (role === "therapist" && id) {
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
    const entries = Object.entries(therapistMembersById)
      .map(([id, member]) => ({
        id,
        label: String(member?.name || member?.email || id).trim(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    return entries;
  }, [therapistMembersById]);

  const visiblePatients = useMemo(() => {
    if (patientTherapistFilter === "all") return allPatients;
    if (patientTherapistFilter === "unassigned") {
      return allPatients.filter((patient: any) => {
        const therapistId = String(
          patient?.therapist_id || patient?.professional_id || "",
        ).trim();
        return !therapistId;
      });
    }
    return allPatients.filter((patient: any) => {
      const therapistId = String(
        patient?.therapist_id || patient?.professional_id || "",
      ).trim();
      return therapistId === patientTherapistFilter;
    });
  }, [allPatients, patientTherapistFilter]);

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
    rooms: "Reservas de Sala",
    protocols: "Protocolos",
    settings: "Configurações da Clínica",
    logs: "Log de Atividades",
    billing: "Assinatura e Cobrança",
  };

  const [loading, setLoading] = useState(false);
  const [isEditingRooms, setIsEditingRooms] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", specialties: "" });
  const [editingRoom, setEditingRoom] = useState<any>(null);

  // Agenda State
  const [agendaView, setAgendaView] = useState<"day" | "week" | "month">("day");
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
  const [theme, setTheme] = useState<"light" | "dark">(
    (localStorage.getItem("verto_theme") as "light" | "dark") || "light",
  );
  const [sessionDate, setSessionDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [sessionTime, setSessionTime] = useState("08:00");
  const [sessionPatientName, setSessionPatientName] = useState("");
  const [sessionApproach, setSessionApproach] = useState("");
  const [sessionRoom, setSessionRoom] = useState("");
  const [sessionProfessional, setSessionProfessional] = useState("");
  const [sessionNumSessions, setSessionNumSessions] = useState(1);
  const [editingAppointmentId, setEditingAppointmentId] = useState<
    number | null
  >(null);
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
  const [filteredPatients, setFilteredPatients] = useState<any[]>([]);
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
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPaymentPatient, setSelectedPaymentPatient] =
    useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [paymentReceipt, setPaymentReceipt] = useState<string | null>(null);
  const [paymentType, setPaymentType] = useState("particular");
  const [paymentInsurance, setPaymentInsurance] = useState("");
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
    String(user?.clinicSettings?.clinicCnpj || ""),
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
  const therapistCanRegisterClinicalData = !isTherapist || Boolean(therapistCrp.trim());
  const canManageProtocolLibrary = capabilityStatusForRole("protocol-library") === "full";
  const canManageClinicSettings = capabilityStatusForRole("clinic-settings") !== "none";
  const canManageBilling = capabilityStatusForRole("billing-management") !== "none";
  const [billingSummary, setBillingSummary] = useState<ClinicBillingSummary | null>(null);
  const [billingSummaryLoading, setBillingSummaryLoading] = useState<boolean>(false);
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

  useEffect(() => {
    if (!canManageBilling) return;
    let cancelled = false;
    const loadBillingSummary = async () => {
      setBillingSummaryLoading(true);
      try {
        const response = await fetch("/api/stripe/clinic-billing-summary", {
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && data?.success && data?.data) {
          setBillingSummary({
            activePatients: Number(data.data.activePatients || 0),
            unitPrice: Number(data.data.unitPrice || 0),
            additionalCost: Number(data.data.additionalCost || 0),
          });
        }
      } catch (error) {
        console.error("Erro ao carregar resumo de cobrança:", error);
      } finally {
        if (!cancelled) setBillingSummaryLoading(false);
      }
    };
    void loadBillingSummary();
    return () => {
      cancelled = true;
    };
  }, [canManageBilling, allPatients.length]);

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
    patientProfileType: "adult_conventional",
    anamnesisRenewalMonths: "6",
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
    const fetchPayments = async () => {
      const result = await dataService.getPayments();
      if (result.success) {
        setPayments(result.data);
      }
    };
    if (activeTab === "financial") {
      fetchPayments();
    }
  }, [activeTab]);

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
    setTherapistSignatureDataUrl(
      user?.signatureDataUrl || user?.clinicSettings?.signatureDataUrl || null,
    );
    setTherapistProfilePhotoUrl(user?.profilePicture || user?.profile_picture || null);
    setClinicLogoDataUrl(user?.clinicSettings?.clinicLogoUrl || null);
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
  ]);

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
      if (activeTab !== "financial") return;
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
  }, [activeTab]);

  const handleAddPayment = async () => {
    if (!selectedPaymentPatient || !paymentAmount)
      return alert("Preencha todos os campos");

    const newPayment = {
      patient_id: selectedPaymentPatient.id,
      patient_name: selectedPaymentPatient.name,
      amount: parseFloat(paymentAmount),
      payment_date: paymentDate,
      method: paymentMethod,
      status: "paid",
      receipt_url: paymentReceipt,
      type: paymentType,
      insurance_name: paymentType === "convênio" ? paymentInsurance : null,
    };

    const result = await dataService.savePayment(newPayment);
    if (result.success) {
      setPayments((prev) => [result.data || newPayment, ...prev]);
      setIsPaymentModalOpen(false);
      setPaymentAmount("");
      setSelectedPaymentPatient(null);
      setPaymentReceipt(null);
      alert("Pagamento registrado com sucesso!");
      onAddActivityLog(
        "Pagamento registrado",
        `Pagamento de R$ ${paymentAmount} para ${selectedPaymentPatient?.name || "paciente"}.`,
        "management",
      );
    } else {
      alert("Erro ao salvar pagamento.");
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
        "A clínica enviou as preferências do módulo financeiro (em breve).",
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
    document.body.classList.toggle("theme-dark", theme === "dark");
    localStorage.setItem("verto_theme", theme);
  }, [theme]);

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

  const selectPatientForSession = (name: string) => {
    setSessionPatientName(name);
    setFilteredPatients([]);
  };

  const resetSessionForm = () => {
    setSessionPatientName("");
    setSessionTime("08:00");
    setSessionRoom("");
    setSessionApproach("");
    setSessionProfessional("");
    setSessionNumSessions(1);
    setEditingAppointmentId(null);
  };

  const handleSessionSubmit = async () => {
    if (!sessionPatientName || !sessionTime || !sessionRoom) {
      showToast("Preencha nome, horário e sala.", "error");
      return;
    }
    showProcessing(
      editingAppointmentId ? "Salvando agendamento..." : "Criando agendamento...",
    );

    if (editingAppointmentId) {
      const updates = {
        name: sessionPatientName,
        date: sessionDate,
        time: sessionTime,
        type: sessionApproach || "Consulta Padrão",
        room: sessionRoom,
        professional: sessionProfessional,
      };
      onUpdateAppointment(editingAppointmentId, updates);
      onAddActivityLog(
        "Agendamento editado",
        `Sessão de ${sessionPatientName} atualizada para ${sessionDate} às ${sessionTime}.`,
        "management",
      );
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
      room: sessionRoom,
      professional: sessionProfessional,
      numSessions: sessionNumSessions,
    };
    const result = onScheduleSession(newSession);
    if (result && !result.success) {
      hideProcessing();
      showToast(result.errors.join(" | "), "error");
      return;
    }
    onAddActivityLog(
      "Agendamento criado",
      `Nova sessão agendada para ${sessionPatientName} em ${sessionDate} às ${sessionTime}.`,
      "management",
    );

    setIsAddSessionModalOpen(false);
    resetSessionForm();
    hideProcessing();
    showToast("Agendamento criado com sucesso!");
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
      anamnesisRenewalMonths: 6,
      lastAnamnesisAt: null,
      createdAt: new Date().toISOString(),
    };

    onAddPatient(newPatient);
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
    hideProcessing();
    showToast(
      "Dados salvos com sucesso! Custo de R$ 4,90 será cobrado da clínica.",
      "info",
    );
  };

  const handleStatusUpdate = (id: number, status: string) => {
    onUpdateAgendaStatus(id, status);
    onAddActivityLog(
      "Status de agenda atualizado",
      `Agendamento ${id} atualizado para ${status}.`,
      "management",
    );
  };

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
    setNewPatientForm((prev: any) => ({ ...prev, [field]: value }));
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
      patientProfileType: "adult_conventional",
      anamnesisRenewalMonths: "6",
    });
  };

  const normalizeAnamnesisRenewalMonths = (value: any) => {
    const months = Number(value);
    if ([2, 3, 6, 12].includes(months)) return months;
    return 6;
  };

  const resolveLastAnamnesisDate = (patient: any) => {
    const candidate =
      patient?.lastAnamnesisAt ||
      patient?.anamnesisLastFilledAt ||
      patient?.anamnesisUpdatedAt ||
      patient?.peiGeneratedAt ||
      null;
    if (!candidate) return null;
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const calculateAgeFromBirthDate = (birthDate: string) => {
    if (!birthDate) return undefined;
    const birth = new Date(birthDate);
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

  const handleCreatePatientFromFullForm = () => {
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
    showProcessing(
      editingPatientId
        ? "Salvando alterações do paciente..."
        : "Cadastrando paciente...",
    );

    const existingPatient = editingPatientId
      ? allPatients.find((p: any) => String(p.id) === String(editingPatientId))
      : null;
    const renewalMonths = normalizeAnamnesisRenewalMonths(
      newPatientForm.anamnesisRenewalMonths,
    );

    const newPatient = {
      id: editingPatientId || crypto.randomUUID(),
      name: newPatientForm.nome.trim(),
      socialName: newPatientForm.nomeSocial?.trim() || null,
      phone: normalizedPhone || null,
      email: normalizedEmail || null,
      age: calculateAgeFromBirthDate(newPatientForm.dataNascimento),
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
          }
        : null,
      type: newPatientForm.patientProfileType || "adult_conventional",
      anamnesisRenewalMonths: renewalMonths,
      lastAnamnesisAt: existingPatient?.lastAnamnesisAt || null,
      anamnesisPending: existingPatient
        ? isPatientPendingAnamnesis({
            ...existingPatient,
            anamnesisRenewalMonths: renewalMonths,
          })
        : true,
      createdAt: new Date().toISOString(),
    };

    if (editingPatientId && onUpdatePatient) {
      onUpdatePatient(newPatient);
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
      onAddPatient(newPatient);
      onAddActivityLog(
        "Paciente cadastrado",
        `Cadastro completo de ${newPatient.name} realizado pela coordenação.`,
        "management",
      );
      setActionPopup({
        title: "Paciente adicionado",
        message: `O paciente ${newPatient.name} foi cadastrado com sucesso.`,
      });
      showToast("Dados salvos com sucesso!", "info");
    }
    setIsPatientRegistrationModalOpen(false);
    resetPatientForm();
    hideProcessing();
  };

  const isPatientPendingAnamnesis = (patient: any) => {
    if (!patient) return false;
    const data = patient.anamnesisData;
    const hasAnamnesis =
      !!(data && typeof data === "object" && Object.keys(data).length > 0);
    if (!hasAnamnesis) return true;

    const lastFilledAt = resolveLastAnamnesisDate(patient);
    if (!lastFilledAt) return false;

    const renewalMonths = normalizeAnamnesisRenewalMonths(
      patient?.anamnesisRenewalMonths,
    );
    const dueDate = new Date(lastFilledAt);
    dueDate.setMonth(dueDate.getMonth() + renewalMonths);
    return dueDate.getTime() <= Date.now();
  };

  const handleEditPatient = (patient: any) => {
    setEditingPatientId(String(patient.id));
    setNewPatientForm({
      nome: patient.name || "",
      nomeSocial: patient.socialName || "",
      telefone: patient.phone || "",
      dataNascimento: patient.birthDate || "",
      genero: patient.gender || "",
      convenioTipo: patient.insuranceType === "convenio" ? "convenio" : "particular",
      convenioNome: patient.insuranceName || "",
      convenioCarteirinha: patient.cardNumber || "",
      grupo: patient.group || "adulto",
      comoConheceu: patient.source || "",
      rg: patient.rg || "",
      cpf: patient.cpf || "",
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
      responsavelDataNascimento: patient.guardian?.dataNascimento || "",
      responsavelCpf: patient.guardian?.cpf || "",
      responsavelTelefone: patient.guardian?.telefone || "",
      patientProfileType: patient.type || "adult_conventional",
      anamnesisRenewalMonths: String(
        normalizeAnamnesisRenewalMonths(patient.anamnesisRenewalMonths),
      ),
    });
    setIsPatientRegistrationModalOpen(true);
  };

  const handleDeletePatient = (patient: any) => {
    if (!patient?.id) return;
    const patientName = normalizeUtf8Text(patient?.name || "Paciente");
    const shouldDelete = window.confirm(
      `Deseja excluir o paciente ${patientName}? Esta ação removerá o paciente da clínica.`,
    );
    if (!shouldDelete) return;
    showProcessing("Excluindo paciente...");

    if (onUpdatePatient) {
      onUpdatePatient({
        id: patient.id,
        clinic_id: null,
        status: "deleted",
        deletedAt: new Date().toISOString(),
      });
    }

    onAddActivityLog(
      "Paciente excluído",
      `Paciente ${patientName} foi excluído da clínica.`,
      "management",
    );
    setActionPopup({
      title: "Paciente excluído",
      message: `O paciente ${patientName} foi excluído com sucesso.`,
    });
    hideProcessing();
    showToast("Paciente excluído com sucesso!");
    setOpenMenuId(null);
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
    setSessionPatientName(appointment.name);
    setSessionDate(appointment.date);
    setSessionTime(appointment.time);
    setSessionApproach(appointment.type);
    setSessionRoom(appointment.room);
    setSessionProfessional(appointment.therapistName);
    setIsAddSessionModalOpen(true);
  };

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
    setSelectedPatientProfile(patient);
    setIsPatientProfileModalOpen(true);
  };

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

        return {
          ...item,
          patientName: agendaPatientName,
          therapistName: normalizeUtf8Text(
            item.therapistName || item.professional || "Profissional",
          ),
          type: normalizeUtf8Text(item.type || item.approach || "Sessão"),
          anamnesisPending: isPatientPendingAnamnesis(resolvedPatient),
        };
      }),
    [therapistAgenda, allPatients],
  );

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return (filteredAgenda || [])
      .filter((a: any) => {
        const itemDate = new Date(a.date + "T00:00:00");
        if (agendaView === "day") return itemDate.getTime() === today.getTime();
        if (agendaView === "week") {
          const nextWeek = new Date(today);
          nextWeek.setDate(today.getDate() + 7);
          return itemDate >= today && itemDate <= nextWeek;
        }
        if (agendaView === "month")
          return (
            itemDate.getMonth() === today.getMonth() &&
            itemDate.getFullYear() === today.getFullYear()
          );
        return true;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [agendaView, filteredAgenda]);

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
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = date.toISOString().split("T")[0];
      return {
        key,
        label: date.toLocaleDateString("pt-BR", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        }),
      };
    });
  }, []);

  const renderGoogleDayGrid = () => {
    const todayKey = new Date().toISOString().split("T")[0];
    return (
      <div className="rounded-3xl border border-slate-100 overflow-hidden">
        <div className="grid grid-cols-[96px_1fr] bg-slate-50 border-b border-slate-100">
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
          {currentTimelineOffsetPx !== null && (
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
                className="grid grid-cols-[96px_1fr] border-b border-slate-50 min-h-[66px]"
              >
                <div className="px-4 py-3 text-xs font-semibold text-slate-500 bg-white">
                  {slot}
                </div>
                <div className="px-3 py-2 bg-white">
                  <div className="flex flex-wrap gap-2">
                    {slotItems.length > 0 ? (
                      slotItems.map((item: any) => (
                        <button
                          key={item.id}
                          onClick={() =>
                            onPatientClick(item.patientId, undefined, item.patientName)
                          }
                          className="text-left min-w-[220px] rounded-xl border border-[#7a32fc]/20 bg-[#7a32fc]/5 px-3 py-2 hover:bg-[#7a32fc]/10 transition-all"
                        >
                          <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
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
                          <p className="text-[10px] text-slate-500">
                            {item.therapistName} • Sala {item.room || "--"}
                          </p>
                        </button>
                      ))
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

    return (
      <div className="overflow-x-auto">
        <div className="min-w-[980px] rounded-3xl border border-slate-100 overflow-hidden">
          <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] bg-slate-50 border-b border-slate-100">
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
                className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-slate-50 min-h-[68px]"
              >
                <div className="px-3 py-3 text-xs font-semibold text-slate-500 bg-white">
                  {slot}
                </div>
                {weekDays.map((d) => {
                  const items = (byDate[d.key] || []).filter((item: any) =>
                    String(item.time || "").startsWith(`${hour}:`),
                  );

                  return (
                    <div
                      key={`${d.key}-${slot}`}
                      className="px-2 py-2 border-l border-slate-50 bg-white"
                    >
                      <div className="flex flex-col gap-1">
                        {items.length > 0 ? (
                          items.map((item: any) => (
                            <button
                              key={item.id}
                              onClick={() =>
                                onPatientClick(item.patientId, undefined, item.patientName)
                              }
                              className="text-left rounded-lg border border-[#7a32fc]/20 bg-[#7a32fc]/5 px-2 py-1.5 hover:bg-[#7a32fc]/10 transition-all"
                            >
                              <p className="text-[10px] font-bold text-slate-800 truncate flex items-center gap-1.5">
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
                              <p className="text-[9px] text-slate-500 truncate">
                                {item.therapistName}
                              </p>
                            </button>
                          ))
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
    const specialtiesArray = newRoom.specialties
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const room = {
      id: Date.now().toString(),
      name: newRoom.name,
      specialties: specialtiesArray,
    };
    setRooms((prev) => [...prev, room]);
    setNewRoom({ name: "", specialties: "" });
  };

  const handleEditRoom = (room: any) => {
    setEditingRoom(room);
    setNewRoom({ name: room.name, specialties: room.specialties.join(", ") });
  };

  const handleUpdateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    const specialtiesArray = newRoom.specialties
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    setRooms((prev) =>
      prev.map((r) =>
        r.id === editingRoom.id
          ? { ...r, name: newRoom.name, specialties: specialtiesArray }
          : r,
      ),
    );
    setEditingRoom(null);
    setNewRoom({ name: "", specialties: "" });
  };

  const handleDeleteRoom = (id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
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

  // Mock data for DRE
  const dreData = [
    {
      label: "Receita Bruta",
      value: 45250,
      type: "income",
      info: "Total de faturamento no mês",
    },
    {
      label: "Impostos (6%)",
      value: -2715,
      type: "expense",
      info: "Simples Nacional",
    },
    {
      label: "Receita Líquida",
      value: 42535,
      type: "total",
      info: "Faturamento após impostos",
    },
    {
      label: "Custos Variáveis (Repasses)",
      value: -18100,
      type: "expense",
      info: "Pagamento de profissionais",
    },
    {
      label: "Margem de Contribuição",
      value: 24435,
      type: "total",
      info: "Sobra para custos fixos",
    },
    {
      label: "Custos Fixos (Aluguel, Luz, etc)",
      value: -8500,
      type: "expense",
      info: "Custos operacionais",
    },
    {
      label: "Lucro Líquido",
      value: 15935,
      type: "profit",
      info: "Resultado final do mês",
    },
  ];

  const revenueHistory = [
    { month: "Jan", revenue: 38000, profit: 12000 },
    { month: "Fev", revenue: 42000, profit: 14500 },
    { month: "Mar", revenue: 45250, profit: 15935 },
    { month: "Abr", revenue: 48000, profit: 17200 },
  ];

  const teamPerformance = [
    { name: "Dr. Ricardo", patients: 12, revenue: 8400 },
    { name: "Dra. Ana", patients: 15, revenue: 10500 },
    { name: "Dr. Marcos", patients: 8, revenue: 5600 },
    { name: "Dra. Julia", patients: 10, revenue: 7000 },
  ];

  const compensationForecast = [
    {
      name: "Dra. Ana Silva",
      crp: "06/123456",
      model: "R$ 120 por paciente",
      forecast: 1800,
      payDate: "25/04/2026",
      patients: 15,
    },
    {
      name: "Dr. Ricardo Souza",
      crp: "06/654321",
      model: "Salário fixo R$ 4.500",
      forecast: 4500,
      payDate: "25/04/2026",
      patients: 12,
    },
    {
      name: "Dra. Julia Lima",
      crp: "06/998877",
      model: "R$ 95 por paciente",
      forecast: 950,
      payDate: "25/04/2026",
      patients: 10,
    },
  ];

  const COLORS = ["#7a32fc", "#6AD2FF", "#EFF4FB", "#A3AED0"];

  const renderAgendaContent = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100 gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900">
              Agenda Global
            </h3>
            <p className="text-slate-500 text-sm hidden sm:block">
              Visualização diária, semanal e mensal estilo calendário.
            </p>
          </div>
          {canCreatePatients && (
            <button
              onClick={() => {
                resetPatientForm();
                setIsPatientRegistrationModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#7a32fc] text-white rounded-2xl text-xs font-bold hover:opacity-90 transition-all shadow-lg shadow-[#7a32fc]/20"
            >
              <UserPlus size={16} />
              Novo Paciente
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
          <div className="bg-slate-100 p-1 rounded-xl flex gap-1 w-full sm:w-auto">
            <button
              onClick={() => setAgendaView("day")}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center justify-center gap-2 ${agendaView === "day" ? "bg-white text-[#7a32fc] shadow-sm" : "text-slate-400"}`}
            >
              <Calendar size={14} /> Dia
            </button>
            <button
              onClick={() => setAgendaView("week")}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center justify-center gap-2 ${agendaView === "week" ? "bg-white text-[#7a32fc] shadow-sm" : "text-slate-400"}`}
            >
              <CalendarRange size={14} /> Semana
            </button>
            <button
              onClick={() => setAgendaView("month")}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all flex items-center justify-center gap-2 ${agendaView === "month" ? "bg-white text-[#7a32fc] shadow-sm" : "text-slate-400"}`}
            >
              <CalendarDays size={14} /> Mês
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100">
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap hidden sm:inline">
              Filtrar profissional:
            </span>
            <button
              onClick={() => setProfessionalFilter("all")}
              className={`px-4 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${professionalFilter === "all" ? "bg-[#7a32fc] text-white shadow-md" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
            >
              Todos
            </button>
            {Array.from(new Set(normalizedAgenda.map((a: any) => a.therapistName).filter(Boolean))).map((prof) => (
              <button
                key={String(prof)}
                onClick={() => setProfessionalFilter(String(prof))}
                className={`px-4 py-1.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all whitespace-nowrap ${professionalFilter === prof ? "bg-[#7a32fc] text-white shadow-md" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
              >
                {String(prof)}
              </button>
            ))}
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-2">
            <div className="bg-slate-100 p-1 rounded-xl flex gap-1 w-full md:w-auto">
              <button
                onClick={() => setAgendaSearchMode("patient")}
                className={`flex-1 md:flex-none px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${agendaSearchMode === "patient" ? "bg-white text-[#7a32fc] shadow-sm" : "text-slate-500"}`}
              >
                Paciente
              </button>
              <button
                onClick={() => setAgendaSearchMode("professional")}
                className={`flex-1 md:flex-none px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${agendaSearchMode === "professional" ? "bg-white text-[#7a32fc] shadow-sm" : "text-slate-500"}`}
              >
                Profissional
              </button>
            </div>
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={agendaSearchTerm}
                onChange={(e) => setAgendaSearchTerm(e.target.value)}
                placeholder={`Filtrar por ${agendaSearchMode === "patient" ? "paciente" : "profissional"}...`}
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-9 pr-3 text-xs font-medium text-slate-600 outline-none focus:border-[#7a32fc]/40"
              />
            </div>
          </div>
        </div>

        {agendaView === "day" ? (
          <div className="space-y-4">
            <button
              onClick={() => setIsAddSessionModalOpen(true)}
              className="w-full bg-white rounded-2xl border-2 border-dashed border-[#7a32fc]/40 p-3 sm:p-4 flex items-center justify-center cursor-pointer hover:bg-[#F4F7FE] transition-all gap-3 group"
            >
              <div className="w-8 h-8 rounded-full bg-[#7a32fc]/10 text-[#7a32fc] flex items-center justify-center group-hover:scale-110 transition-transform">
                <Plus size={18} />
              </div>
              <span className="text-[10px] sm:text-xs font-semibold text-[#7a32fc] uppercase tracking-wider">
                Novo Agendamento
              </span>
            </button>
            {renderGoogleDayGrid()}
          </div>
        ) : agendaView === "month" ? (
          <CalendarWidget
            agenda={filteredAgenda}
            currentDate={calendarDate}
            onDateChange={setCalendarDate}
            onDateSelect={(dateStr: string) => {
              setSessionDate(dateStr);
              setIsDayDetailsModalOpen(true);
            }}
          />
        ) : (
          renderGoogleWeekGrid()
        )}
      </div>

      <DayDetailsModal
        isOpen={isDayDetailsModalOpen}
        onClose={() => setIsDayDetailsModalOpen(false)}
        date={sessionDate}
        agenda={filteredAgenda}
        onAddSession={() => setIsAddSessionModalOpen(true)}
        onPatientClick={onPatientClick}
      />
    </div>
  );

  const renderRoomsContent = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white p-4 sm:p-6 rounded-[32px] shadow-sm border border-slate-100 gap-4">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">Salas</h3>
          <p className="text-slate-500 text-sm hidden sm:block">
            Configure as salas disponíveis.
          </p>
        </div>
        <button
          onClick={() => setIsEditingRooms(!isEditingRooms)}
          className={`px-4 sm:px-6 py-2 sm:py-3 rounded-2xl font-bold text-[10px] sm:text-sm transition-all flex items-center justify-center gap-2 ${isEditingRooms ? "bg-slate-100 text-slate-600" : "bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20"}`}
        >
          {isEditingRooms ? "Ver Reservas" : "Editar Salas"}
        </button>
      </div>

      {isEditingRooms ? (
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
                    Separe por vírgula
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
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:bg-white hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white text-slate-400 rounded-xl flex items-center justify-center group-hover:text-[#7a32fc] transition-all">
                        <DoorOpen size={24} />
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-900">
                          {room.name}
                        </h5>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {room.specialties.map((s: string) => (
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
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
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
          onBack={() => setIsEditingRooms(true)}
        />
      )}
    </div>
  );

  const renderDashboard = () => (
    <div className="space-y-8 sm:space-y-12 animate-in fade-in duration-500">
      {/* Stats Grid - Topo do painel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {[
          {
            id: "patients",
            label: "Pacientes Ativos",
            value: (allPatients?.length || 0).toString(),
            icon: Users,
            trend: "+3",
            color: "bg-purple-50 text-purple-600",
          },
          {
            id: "agenda",
            label: "Sessões Realizadas",
            value: "142",
            icon: Calendar,
            trend: "+15",
            color: "bg-orange-50 text-orange-600",
          },
        ].map((stat, i) => (
          <div
            key={i}
            onClick={() => navigateToTab(stat.id as any)}
            className="bg-white p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100 hover:shadow-xl hover:border-blue-500/30 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between mb-4">
              <div
                className={`w-12 h-12 sm:w-14 sm:h-14 ${stat.color} rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform`}
              >
                <stat.icon size={24} className="sm:w-7 sm:h-7" />
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-green-500 bg-green-50 px-2 py-1 rounded-lg">
                  {stat.trend}
                </span>
                <span className="text-[8px] sm:text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
                  Ver Detalhes
                </span>
              </div>
            </div>
            <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mb-1">
              {stat.label}
            </p>
            <h3 className="text-2xl sm:text-3xl font-bold text-slate-900">
              {stat.value}
            </h3>
          </div>
        ))}
      </div>

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
            Financeiro (DRE)
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
                icon: ClipboardCheck,
              },
              { id: "logs", label: "Log de Atividades", icon: History },
              {
                id: "settings",
                label: "Configurações",
                icon: Settings,
              },
              {
                id: "financial",
                label: "Financeiro (DRE)",
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
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <header className="px-4 lg:px-6 py-2.5 flex items-center justify-between sticky top-0 bg-[#F4F7FE]/80 backdrop-blur-md z-30">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setView("home");
                  setActiveTab("dashboard");
                  setTabHistory(["dashboard"]);
                }}
                className="p-2 bg-white rounded-xl text-slate-400 hover:text-[#7a32fc] shadow-sm border border-slate-100 transition-all"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                  Prontuário
                </p>
                <h1 className="text-lg lg:text-2xl font-semibold text-slate-900 tracking-tight">
                  Prontuário do Paciente
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 lg:gap-4 bg-white p-1.5 lg:p-2 rounded-[24px] shadow-sm border border-slate-100">
              <button
                onClick={() => setTheme((prev) => (prev === "light" ? "dark" : "light"))}
                className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-xl transition-all"
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
                className="lg:hidden p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
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
                        icon: ClipboardCheck,
                      },
                      { id: "logs", label: "Log de Atividades", icon: History },
                      {
                        id: "settings",
                        label: "Configurações",
                        icon: Settings,
                      },
                      {
                        id: "financial",
                        label: "Financeiro (DRE)",
                        icon: DollarSign,
                        badge: "EM BREVE",
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
                        badge: "EM BREVE",
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
                          <span className="ml-auto text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
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

          <main className="p-4 lg:p-8 pb-20">
            <PatientDetailView
              patient={patient}
              onBack={() => setView("home")}
              hideBackButton={true}
              clinicContext={{
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
                signatureUrl: user?.clinicSettings?.signatureDataUrl || null,
              }}
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
        { id: "protocols", label: "Protocolos", icon: ClipboardCheck },
        { id: "logs", label: "Log de Atividades", icon: History },
        { id: "settings", label: "Configurações", icon: Settings },
        {
          id: "financial",
          label: "Financeiro (DRE)",
          icon: DollarSign,
          badge: "EM BREVE",
        },
        { id: "flow", label: "Verto Flow", icon: Zap, badge: "EM BREVE" },
        {
          id: "birthdays",
          label: "Aniversariantes",
          icon: Heart,
          badge: "EM BREVE",
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
        {
          id: "protocols",
          label: "Protocolos",
          icon: ClipboardCheck,
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
          badge: "EM BREVE",
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
          badge: "EM BREVE",
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
                    <span className="ml-auto text-[8px] bg-purple-100 text-[#7a32fc] px-1.5 py-0.5 rounded-full">
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
        <header className="px-4 lg:px-8 py-4 flex items-center justify-between sticky top-0 bg-[#F4F7FE]/80 backdrop-blur-md z-30">
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
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                {!isEditingRooms && activeTab === "rooms"
                  ? "Salas"
                  : `Páginas / ${tabLabels[activeTab] || "Painel"}`}
              </p>
              <h1 className="text-xl lg:text-3xl font-semibold text-slate-900 tracking-tight capitalize">
                {!isEditingRooms && activeTab === "rooms"
                  ? "Reservas de Sala"
                  : tabLabels[activeTab] || "Painel"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4 bg-white p-1.5 lg:p-2 rounded-[24px] shadow-sm border border-slate-100">
            <div className="relative hidden md:block">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />
              <input
                type="text"
                placeholder="Pesquisar..."
                className="bg-slate-50 border-none rounded-full py-3 pl-12 pr-6 text-sm font-medium outline-none focus:ring-2 ring-blue-500/20 w-48 lg:w-64 transition-all"
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
                        <span className="ml-auto text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
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
              onClick={() => setIsPaymentModalOpen(false)}
            >
              <div
                className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
                <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <DollarSign size={24} className="text-[#7a32fc]" /> Registrar
                  Pagamento
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Valor (R$)
                      </label>
                      <input
                        type="number"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                        placeholder="0,00"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                        Data
                      </label>
                      <input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Método
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {["pix", "card", "cash"].map((m) => (
                        <button
                          key={m}
                          onClick={() => setPaymentMethod(m)}
                          className={`py-2 rounded-xl text-[10px] font-bold uppercase border-2 transition-all ${paymentMethod === m ? "border-[#7a32fc] bg-blue-50 text-[#7a32fc]" : "border-slate-100 text-slate-400"}`}
                        >
                          {m === "pix"
                            ? "PIX"
                            : m === "card"
                              ? "Cartão"
                              : "Dinheiro"}
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
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () =>
                              setPaymentReceipt(reader.result as string);
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
                    Confirmar Pagamento
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
            {activeTab === "financial" && (
              <motion.div
                key="financial"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="bg-white border border-slate-100 rounded-[32px] p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">
                        Módulo Financeiro (em breve)
                      </h3>
                      <p className="text-sm text-slate-500">
                        Estamos finalizando este módulo. Marque as funcionalidades que sua clínica mais precisa.
                      </p>
                    </div>
                    {financialSurveySubmitted && (
                      <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-widest">
                        Pesquisa enviada
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {financialSurveyOptions.map((feature) => {
                      const checked = financialSurveySelected.includes(feature);
                      return (
                        <label
                          key={feature}
                          className={`flex items-center gap-2 p-3 rounded-xl border text-xs font-medium transition-all ${checked ? "border-[#7a32fc] bg-[#7a32fc]/5 text-[#7a32fc]" : "border-slate-200 bg-slate-50 text-slate-600"}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={financialSurveySubmitted}
                            onChange={(e) => {
                              const isChecked = e.target.checked;
                              setFinancialSurveySelected((prev) =>
                                isChecked
                                  ? [...prev, feature]
                                  : prev.filter((f) => f !== feature),
                              );
                            }}
                          />
                          <span>{feature}</span>
                        </label>
                      );
                    })}
                  </div>

                  <textarea
                    value={financialSurveyNotes}
                    disabled={financialSurveySubmitted}
                    onChange={(e) => setFinancialSurveyNotes(e.target.value)}
                    placeholder="Se quiser, descreva detalhes adicionais..."
                    className="w-full mt-4 bg-slate-50 rounded-xl p-3 text-sm min-h-[96px] border border-slate-200"
                  />
                  {!financialSurveySubmitted && (
                    <div className="flex justify-end mt-4">
                      <button
                        onClick={handleSubmitFinancialSurvey}
                        className="px-5 py-2.5 rounded-xl bg-[#7a32fc] text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-purple-500/20"
                      >
                        Enviar pesquisa
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-slate-900 tracking-tight">
                      Financeiro Operacional da Clínica
                    </h3>
                    <p className="text-slate-500 font-medium">
                      Recebimentos, convênios, comprovantes e previsão de
                      repasses sem DRE.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsPaymentModalOpen(true)}
                    className="bg-[#7a32fc] text-white px-6 py-3 rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 flex items-center gap-2 hover:scale-105 transition-all"
                  >
                    <Plus size={18} /> Registrar Pagamento
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {/* DRE Table */}
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
                                  ? `- R$ ${Math.abs(item.value).toLocaleString()}`
                                  : `R$ ${item.value.toLocaleString()}`}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Recent Payments */}
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
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {payments.length > 0 ? (
                              payments.map((p, idx) => (
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
                                    R$ {p.amount.toFixed(2)}
                                  </td>
                                  <td className="py-4 text-slate-500 text-sm">
                                    {new Date(
                                      p.payment_date,
                                    ).toLocaleDateString()}
                                  </td>
                                  <td className="py-4">
                                    <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-bold uppercase">
                                      {p.method}
                                    </span>
                                  </td>
                                  <td className="py-4 text-xs font-semibold text-slate-500">
                                    {p.receipt_url ? "Anexado" : "Sem anexo"}
                                  </td>
                                  <td className="py-4">
                                    <span className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase">
                                      Pago
                                    </span>
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={7}
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
                    <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 p-8">
                      <h4 className="font-bold text-slate-900 mb-6">
                        Recebimentos e Margem Prevista
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

                    <div className="bg-white rounded-[40px] shadow-sm border border-slate-100 p-8">
                      <h4 className="font-bold text-slate-900 mb-6">
                        Previsão de Pagamento dos Profissionais
                      </h4>
                      <div className="space-y-4">
                        {compensationForecast.map((member, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl"
                          >
                            <div>
                              <p className="font-bold text-slate-900 text-sm">
                                {member.name}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                {member.crp}
                              </p>
                              <p className="text-[10px] text-slate-500 font-medium mt-1">
                                {member.model}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-slate-900 text-sm">
                                R$ {member.forecast.toLocaleString()}
                              </p>
                              <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">
                                Pagamento em {member.payDate}
                              </p>
                              <p className="text-[10px] text-slate-400 font-medium">
                                {member.patients} pacientes ativos
                              </p>
                            </div>
                          </div>
                        ))}
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
                className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] shadow-sm border border-slate-100 p-8 text-center"
              >
                <div className="w-20 h-20 bg-pink-50 text-pink-600 rounded-[32px] flex items-center justify-center mb-6">
                  <Heart size={40} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">
                  Aniversariantes
                </h3>
                <p className="text-slate-500 font-medium mb-8 max-w-md">
                  Configuração que possibilite o envio de mensagens
                  automáticas de feliz aniversário aos pacientes e
                  profissionais da clínica.
                </p>
                <span className="px-6 py-2 bg-[#7a32fc] text-white rounded-full text-xs font-bold uppercase tracking-widest shadow-lg shadow-blue-500/20">
                  Em Breve
                </span>
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
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {visiblePatients.map((patient, i) => (
                    <div
                      key={i}
                      className="p-4 sm:p-6 bg-slate-50 rounded-3xl border border-slate-100 hover:border-blue-500/30 transition-all group relative"
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
                          </h4>
                          <p className="text-[10px] text-slate-400 font-medium">
                            ID: {patient.id}
                          </p>
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
                            const therapistName =
                              therapist?.name || therapist?.email || `ID ${therapistId.slice(0, 8)}`;
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
                            <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 py-2 animate-in fade-in zoom-in duration-200">
                              {!isReceptionist && (
                                <button
                                  onClick={() => {
                                    onPatientClick(patient.id, { tab: "history" });
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                                >
                                  <FileText size={14} className="text-blue-500" />{" "}
                                  Prontuário
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  openPatientProfileModal(patient);
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                              >
                                <Search size={14} className="text-[#7a32fc]" />{" "}
                                Ver mais (cadastro)
                              </button>
                              <button
                                onClick={() => handleResendPatientActivationEmail(patient)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                              >
                                <Mail size={14} className="text-emerald-600" />
                                Reenviar ativação
                              </button>
                              <button
                                onClick={() => handleResendPatientRecoveryEmail(patient)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                              >
                                <KeyRound size={14} className="text-indigo-500" />
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
                                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                                >
                                  <ClipboardCheck size={14} className="text-purple-500" />
                                  Ficha Anamnese
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  handleEditPatient(patient);
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-all"
                              >
                                <Edit2 size={14} className="text-slate-400" />{" "}
                                Editar
                              </button>
                              <button
                                onClick={() => handleDeletePatient(patient)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-all"
                              >
                                <Trash2 size={14} /> Excluir
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t border-slate-200/50">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full animate-pulse ${isPatientPendingAnamnesis(patient) ? "bg-amber-500" : "bg-green-500"}`}
                          />
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                            {isReceptionist
                              ? "Cadastro do paciente"
                              : isPatientPendingAnamnesis(patient)
                              ? "Pendente de Anamnese"
                              : "Paciente Ativo"}
                          </span>
                        </div>
                        <div className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-[8px] font-bold uppercase">
                          {patient.type === "kids_tea"
                            ? "Kids TEA"
                            : patient.type === "adult_tea"
                              ? "Adulto TEA"
                              : "Adulto Convencional"}
                        </div>
                      </div>
                      {isReceptionist ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => openPatientProfileModal(patient)}
                            className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100 transition-all"
                          >
                            Ver cadastro
                          </button>
                          <button
                            onClick={() => handleEditPatient(patient)}
                            className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[10px] font-bold uppercase tracking-wider hover:bg-slate-200 transition-all"
                          >
                            Editar cadastro
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            onClick={() =>
                              onPatientClick(patient.id, {
                                tab: "history",
                                openAnamnesis: true,
                              })
                            }
                            className="px-3 py-2 rounded-xl bg-purple-50 text-purple-700 text-[10px] font-bold uppercase tracking-wider hover:bg-purple-100 transition-all"
                          >
                            Ficha Anamnese
                          </button>
                          <button
                            onClick={() => onPatientClick(patient.id, { tab: "files" })}
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

                  <div className="mb-8 p-5 rounded-[24px] border border-violet-100 bg-violet-50/60 text-slate-700">
                    <p className="text-[10px] font-bold text-violet-500 uppercase tracking-widest mb-1">
                      Cobrança Variável
                    </p>
                    <p className="text-sm font-semibold text-slate-800">
                      {billingSummaryLoading
                        ? "Calculando pacientes ativos..."
                        : `Pacientes Ativos: ${billingSummary?.activePatients ?? 0} | Custo Adicional: R$ ${(billingSummary?.additionalCost ?? 0).toFixed(2).replace(".", ",")}`}
                    </p>
                    <p className="text-xs text-violet-500 mt-1">
                      Valor unitário por paciente ativo: R$ {(billingSummary?.unitPrice ?? 4.9).toFixed(2).replace(".", ",")}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Plano Atual
                      </p>
                      <h4 className="text-xl font-bold text-slate-900">
                        {normalizedPlanName}
                      </h4>
                      <p className="text-emerald-500 text-xs font-bold mt-2 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Ativo
                      </p>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Próximo Vencimento
                      </p>
                      <h4 className="text-xl font-bold text-slate-900">
                        15/05/2026
                      </h4>
                      <p className="text-slate-400 text-xs font-medium mt-2">
                        Renovação automática
                      </p>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-[32px] border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                        Valor Mensal
                      </p>
                      <h4 className="text-xl font-bold text-slate-900">
                        R${" "}
                        {user.planPrice?.toFixed(2).replace(".", ",") ||
                          "149,90"}
                      </h4>
                      <p
                        className="text-blue-500 text-xs font-bold mt-2 cursor-pointer hover:underline"
                        onClick={() =>
                          setShowBillingDetails(!showBillingDetails)
                        }
                      >
                        {showBillingDetails
                          ? "Ocultar detalhes"
                          : "Ver detalhes"}
                      </p>
                    </div>
                  </div>

                  {showBillingDetails && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mb-12 space-y-6 overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                            Histórico de Pagamentos
                          </h4>
                          <div className="space-y-3">
                            {billingHistory.map((bill, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100"
                              >
                                <div>
                                  <p className="text-sm font-bold text-slate-900">
                                    {bill.date}
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-medium">
                                    {bill.method}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-bold text-slate-900">
                                    R${" "}
                                    {bill.amount.toFixed(2).replace(".", ",")}
                                  </p>
                                  <span className="text-[8px] font-bold text-green-500 uppercase">
                                    Pago
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="bg-slate-50 p-6 rounded-[32px] border border-slate-100">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                            Próximos Vencimentos
                          </h4>
                          <div className="space-y-3">
                            {upcomingBills.map((bill, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100"
                              >
                                <div>
                                  <p className="text-sm font-bold text-slate-900">
                                    {bill.date}
                                  </p>
                                  <p className="text-[10px] text-slate-400 font-medium">
                                    Renovação Automática
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-bold text-slate-900">
                                    R${" "}
                                    {bill.amount.toFixed(2).replace(".", ",")}
                                  </p>
                                  <span className="text-[8px] font-bold text-blue-500 uppercase">
                                    Agendado
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <h4 className="text-lg font-bold text-slate-900 mb-6">
                    Gestão de Plano
                  </h4>
                  <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      onClick={handleOpenCustomerPortal}
                      disabled={loading}
                      className="w-full py-3 rounded-2xl font-bold text-sm bg-slate-100 text-slate-800 hover:bg-slate-200 transition-all"
                    >
                      Trocar Cartão / Faturamento
                    </button>
                    <button
                      onClick={() => handleCheckout("Essencial")}
                      disabled={loading || normalizedPlanName === "Essencial"}
                      className={`w-full py-3 rounded-2xl font-bold text-sm transition-all ${
                        normalizedPlanName === "Essencial"
                          ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                          : "bg-white border border-[#7a32fc]/30 text-[#7a32fc] hover:bg-[#f6f0ff]"
                      }`}
                    >
                      {normalizedPlanName === "Essencial" ? "Plano atual já é Essencial" : "Migrar para Essencial (downgrade)"}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div
                      className={`p-8 rounded-[40px] border-2 transition-all ${
                        normalizedPlanName === "Essencial"
                          ? "border-[#7a32fc] bg-blue-50/30"
                          : "border-slate-100 hover:border-blue-200"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h5 className="text-xl font-bold text-slate-900">Essencial</h5>
                          <p className="text-slate-500 text-sm">Para início da operação</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-[#4318FF]">R$ 149,90</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">por mês</p>
                        </div>
                      </div>
                      <ul className="space-y-3 mb-8">
                        {[
                          "Até 2 profissionais",
                          "Prontuário + Agenda",
                          "Portal paciente e família",
                          "Histórico clínico centralizado",
                        ].map((feat) => (
                          <li key={feat} className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                            <CheckCircle2 size={16} className="text-emerald-500" /> {feat}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => handleCheckout("Essencial")}
                        disabled={loading || normalizedPlanName === "Essencial"}
                        className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${
                          normalizedPlanName === "Essencial"
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20 hover:scale-[1.02]"
                        }`}
                      >
                        {normalizedPlanName === "Essencial" ? "Plano Atual" : "Escolher Essencial"}
                      </button>
                    </div>
                    <div
                      className={`p-8 rounded-[40px] border-2 transition-all ${user.planName === "Crescimento" ? "border-[#7a32fc] bg-blue-50/30" : "border-slate-100 hover:border-blue-200"}`}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h5 className="text-xl font-bold text-slate-900">
                            Crescimento
                          </h5>
                          <p className="text-slate-500 text-sm">
                            Para clínicas em crescimento
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-[#4318FF]">
                            R$ 399,90
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">
                            por mês
                          </p>
                        </div>
                      </div>
                      <ul className="space-y-3 mb-8">
                        {[
                          "3 a 7 Profissionais",
                          "Dashboard de Evolução Clínica",
                          "Relatórios Consolidados",
                          "Gestão Financeira Avançada",
                          "Suporte Prioritário",
                        ].map((feat) => (
                          <li
                            key={feat}
                            className="flex items-center gap-2 text-sm text-slate-600 font-medium"
                          >
                            <CheckCircle2
                              size={16}
                              className="text-emerald-500"
                            />{" "}
                            {feat}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => handleCheckout("growth_plan_id")}
                        disabled={loading || user.planName === "Crescimento"}
                        className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${user.planName === "Crescimento" ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20 hover:scale-[1.02]"}`}
                      >
                        {user.planName === "Crescimento"
                          ? "Plano Atual"
                          : "Fazer Upgrade"}
                      </button>
                    </div>

                    <div
                      className={`p-8 rounded-[40px] border-2 transition-all ${user.planName === "Avançado" ? "border-[#7a32fc] bg-blue-50/30" : "border-slate-100 hover:border-blue-200"}`}
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h5 className="text-xl font-bold text-slate-900">
                            Avançado
                          </h5>
                          <p className="text-slate-500 text-sm">
                            Para clínicas estabelecidas
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-[#4318FF]">
                            R$ 679,90
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">
                            por mês
                          </p>
                        </div>
                      </div>
                      <ul className="space-y-3 mb-8">
                        {[
                          "7 a 12 Profissionais",
                          "Múltiplos Workspaces de PEI",
                          "API de Integração de Dados",
                          "Gerente de Conta Dedicado",
                        ].map((feat) => (
                          <li
                            key={feat}
                            className="flex items-center gap-2 text-sm text-slate-600 font-medium"
                          >
                            <CheckCircle2
                              size={16}
                              className="text-emerald-500"
                            />{" "}
                            {feat}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => handleCheckout("advanced_plan_id")}
                        disabled={loading || user.planName === "Avançado"}
                        className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${user.planName === "Avançado" ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-[#7a32fc] text-white shadow-lg shadow-purple-500/30 hover:scale-[1.02]"}`}
                      >
                        {user.planName === "Avançado"
                          ? "Plano Atual"
                          : "Fazer Upgrade"}
                      </button>
                    </div>

                    <div className="p-8 rounded-[40px] border-2 border-slate-100 hover:border-blue-200 transition-all bg-slate-50/30">
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h5 className="text-xl font-bold text-slate-900">
                            Enterprise
                          </h5>
                          <p className="text-slate-500 text-sm">
                            Para grandes redes
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-slate-900">
                            Sob Consulta
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase">
                            Personalizado
                          </p>
                        </div>
                      </div>
                      <ul className="space-y-3 mb-8">
                        {[
                          "12+ Profissionais",
                          "Workspaces Ilimitados",
                          "Dashboard de Organização",
                          "Faturamento Centralizado",
                          "Opções de White-label",
                        ].map((feat) => (
                          <li
                            key={feat}
                            className="flex items-center gap-2 text-sm text-slate-600 font-medium"
                          >
                            <CheckCircle2
                              size={16}
                              className="text-emerald-500"
                            />{" "}
                            {feat}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() =>
                          window.open("https://wa.me/5511999999999", "_blank")
                        }
                        className="w-full py-4 bg-white border-2 border-[#7a32fc] text-[#7a32fc] rounded-2xl font-bold text-sm hover:bg-[#7a32fc] hover:text-white transition-all flex items-center justify-center gap-2"
                      >
                        <MessageCircle size={18} />
                        Falar com Especialista
                      </button>
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
                  onSaveProtocol={(p: any) => {
                    if (!canManageProtocolLibrary) return;
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
                    setProtocols(protocols.filter((p: any) => p.id !== id));
                  }}
                  onBack={goBackTab}
                />
              </div>
            )}
            {activeTab === "logs" && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                  <h3 className="text-xl font-bold text-slate-900 mb-6">
                    Registros de Atividades do Sistema
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
                          As ações realizadas no sistema aparecerão aqui para
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
                              <img
                                src={therapistSignatureDataUrl}
                                alt="Assinatura digital"
                                className="max-h-28 object-contain"
                              />
                            ) : (
                              <span className="text-xs font-semibold text-slate-500">
                                Clique para enviar assinatura
                              </span>
                            )}
                            <input
                              type="file"
                              className="hidden"
                              accept="image/png,image/webp,image/svg+xml"
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
                              <img
                                src={therapistProfilePhotoUrl}
                                alt="Foto de perfil"
                                className="w-24 h-24 rounded-2xl object-cover"
                              />
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
                                <img src={therapistSignatureDataUrl} alt="Assinatura digital" className="max-h-28 object-contain" />
                              ) : (
                                <span className="text-xs font-semibold text-slate-500">Clique para enviar assinatura</span>
                              )}
                              <input
                                type="file"
                                className="hidden"
                                accept="image/png,image/webp,image/svg+xml,image/jpeg"
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
                                <img src={therapistProfilePhotoUrl} alt="Foto de perfil" className="w-24 h-24 rounded-2xl object-cover" />
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
                                <img src={clinicLogoDataUrl} alt="Logo da clínica" className="max-h-28 object-contain" />
                              ) : (
                                <span className="text-xs font-semibold text-slate-500">Clique para enviar logotipo</span>
                              )}
                              <input
                                type="file"
                                className="hidden"
                                accept="image/png,image/webp,image/svg+xml,image/jpeg"
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
                              onChange={(e) => setClinicCnpj(e.target.value)}
                              placeholder="00.000.000/0000-00"
                              className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                        </div>
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
            className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-pop relative"
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
              <div className="grid grid-cols-2 gap-3">
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
                    Hora
                  </label>
                  <input
                    type="time"
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionTime}
                    onChange={(e) => setSessionTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Abordagem
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionApproach}
                    onChange={(e) => setSessionApproach(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    <option value="Consulta Padrão">Consulta Padrão</option>
                    <option value="TCC">TCC</option>
                    <option value="ABA">ABA</option>
                    <option value="Integração Sensorial">
                      Integração Sensorial
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                    Sala
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                    value={sessionRoom}
                    onChange={(e) => setSessionRoom(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {rooms.map((room: any) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                  Terapeuta Responsável
                </label>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm outline-none font-semibold text-slate-700"
                  placeholder="Nome do Profissional"
                  value={sessionProfessional}
                  onChange={(e) => setSessionProfessional(e.target.value)}
                />
              </div>
              <button
                onClick={handleSessionSubmit}
                className="w-full bg-[#7a32fc] text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all mt-2 active:scale-95 uppercase tracking-widest"
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
              <div><span className="text-slate-400">Telefone:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.phone || "-"}</p></div>
              <div><span className="text-slate-400">Email:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.email || "-"}</p></div>
              <div><span className="text-slate-400">Convênio:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.insuranceName || selectedPatientProfile.insuranceType || "-"}</p></div>
              <div><span className="text-slate-400">Carteirinha:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.cardNumber || "-"}</p></div>
              <div><span className="text-slate-400">RG:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.rg || "-"}</p></div>
              <div><span className="text-slate-400">CPF:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.cpf || "-"}</p></div>
              <div><span className="text-slate-400">Renovação da anamnese:</span> <p className="font-semibold text-slate-800">{normalizeAnamnesisRenewalMonths(selectedPatientProfile.anamnesisRenewalMonths)} meses</p></div>
              <div className="md:col-span-2"><span className="text-slate-400">Endereço:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.address?.logradouro || "-"} {selectedPatientProfile.address?.numero || ""} - {selectedPatientProfile.address?.bairro || ""} - {selectedPatientProfile.address?.cidade || ""}</p></div>
              <div className="md:col-span-2"><span className="text-slate-400">Observações:</span> <p className="font-semibold text-slate-800">{selectedPatientProfile.notes || "-"}</p></div>
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
                <option value="kids_tea">Paciente Kids TEA</option>
                <option value="adult_tea">Paciente Adulto TEA</option>
                <option value="adult_conventional">Paciente Adulto Convencional</option>
              </select>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="block text-xs font-bold text-slate-600 mb-2">
                  Lembrete de renovação da ficha anamnese
                </label>
                <select
                  className="bg-slate-50 rounded-xl p-3 text-sm w-full"
                  value={String(newPatientForm.anamnesisRenewalMonths || "6")}
                  onChange={(e) =>
                    handlePatientFormChange("anamnesisRenewalMonths", e.target.value)
                  }
                >
                  <option value="2">A cada 2 meses</option>
                  <option value="3">A cada 3 meses</option>
                  <option value="6">A cada 6 meses</option>
                  <option value="12">A cada 12 meses</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  O alerta de pendência só voltará quando esse prazo vencer após a última ficha preenchida.
                </p>
              </div>

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












