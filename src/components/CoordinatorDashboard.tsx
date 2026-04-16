import React, { useState, useMemo, useEffect } from "react";
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
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
  PieChart as RePieChart,
  Pie,
} from "recharts";
import { dataService } from "../services/dataService";
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
  allTasks?: any[];
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
  allTasks = [],
}: CoordinatorDashboardProps) {
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
    setActiveTab(tab);
    setTabHistory((prev) => {
      if (prev[prev.length - 1] === tab) return prev;
      return [...prev, tab];
    });
  };

  const goBackTab = () => {
    setTabHistory((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const previousTab = next[next.length - 1] as typeof activeTab;
      setActiveTab(previousTab);
      return next;
    });
  };

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

  const mockMedicalRecord = {
    firstInterview: {
      date: "10/01/2024",
      therapist: "Dra. Ana Silva",
      mainComplaint: "Dificuldades na interação social e atraso na fala.",
      history:
        "Gestação sem intercorrências. Marcos do desenvolvimento motores dentro do esperado, porém sem balbucio aos 12 meses.",
      observations:
        "Paciente evita contato visual, apresenta estereotipias motoras (flapping).",
      diagnosis: "TEA (Transtorno do Espectro Autista) - Nível 1 de suporte.",
      recommendations: "Terapia ABA 20h semanais, Fonoaudiologia 2h semanais.",
    },
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
    patientProfileType: "adult_conventional",
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

  const repairMojibake = (value: any) => {
    const text = String(value || "");
    if (!text) return "";
    try {
      if (text.includes("Ã") || text.includes("â")) {
        const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
        const fixed = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (fixed && !fixed.includes("�")) return fixed;
      }
    } catch (_e) {
      // fallback below
    }
    return text
      .replaceAll("Ã¡", "á")
      .replaceAll("Ãà", "à")
      .replaceAll("Ã¢", "â")
      .replaceAll("Ãã", "ã")
      .replaceAll("Ã©", "é")
      .replaceAll("Ãª", "ê")
      .replaceAll("Ã­", "í")
      .replaceAll("Ã³", "ó")
      .replaceAll("Ã´", "ô")
      .replaceAll("Ãµ", "õ")
      .replaceAll("Ãº", "ú")
      .replaceAll("Ã§", "ç")
      .replaceAll("Â·", "•")
      .replaceAll("â€¢", "•")
      .replaceAll("Â", "");
  };

  const normalizedPlanName = (() => {
    const raw = repairMojibake(user?.planName || "").trim();
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

  const handlePatientFormChange = (field: string, value: any) => {
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
    });
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
    if (!newPatientForm.nome?.trim()) {
      showToast("O nome do paciente é obrigatório.", "error");
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

    const newPatient = {
      id: editingPatientId || crypto.randomUUID(),
      name: newPatientForm.nome.trim(),
      socialName: newPatientForm.nomeSocial?.trim() || null,
      phone: String(newPatientForm.telefone || "").trim(),
      email: String(newPatientForm.email || "").trim() || null,
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
      cpf: newPatientForm.cpf || null,
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
            cpf: newPatientForm.responsavelCpf || null,
            telefone: newPatientForm.responsavelTelefone || null,
          }
        : null,
      type: newPatientForm.patientProfileType || "adult_conventional",
      anamnesisPending: existingPatient
        ? isPatientPendingAnamnesis(existingPatient)
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
      showToast(
        "Dados salvos com sucesso! Custo de R$ 4,90 será cobrado da clínica.",
        "info",
      );
    }
    setIsPatientRegistrationModalOpen(false);
    resetPatientForm();
    hideProcessing();
  };

  const isPatientPendingAnamnesis = (patient: any) => {
    if (!patient) return false;
    if (typeof patient.anamnesisPending === "boolean") {
      return patient.anamnesisPending;
    }
    const data = patient.anamnesisData;
    return !(data && typeof data === "object" && Object.keys(data).length > 0);
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
    });
    setIsPatientRegistrationModalOpen(true);
  };

  const handleDeletePatient = (patient: any) => {
    if (!patient?.id) return;
    const patientName = repairMojibake(patient?.name || "Paciente");
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
    const normalizedFallback = repairMojibake(
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
          repairMojibake(String(p?.name || ""))
            .trim()
            .toLowerCase() === normalizedFallback,
      );

    if (!resolvedPatient?.id) {
      alert(
        "Este agendamento ainda não está vinculado a um paciente cadastrado. Vincule o paciente no cadastro para abrir o prontuário.",
      );
      return;
    }

    setSelectedPatientId(resolvedPatient.id);
    setPatientOpenTab(options?.tab || "history");
    setOpenAnamnesisOnPatientOpen(Boolean(options?.openAnamnesis));
    setView("patient");
  };

  const openPatientProfileModal = (patient: any) => {
    setSelectedPatientProfile(patient);
    setIsPatientProfileModalOpen(true);
  };

  const normalizedAgenda = useMemo(
    () =>
      (therapistAgenda || []).map((item: any) => {
        const agendaPatientName = repairMojibake(
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
              repairMojibake(String(p?.name || ""))
                .trim()
                .toLowerCase() === normalizedAgendaPatientName,
          );

        return {
          ...item,
          patientName: agendaPatientName,
          therapistName: repairMojibake(
            item.therapistName || item.professional || "Profissional",
          ),
          type: repairMojibake(item.type || item.approach || "Sessão"),
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
      clinicSettings,
    });

    onAddActivityLog(
      "Configurações atualizadas",
      "A coordenação atualizou os horários e a duração de sessão por profissional.",
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
    showProcessing("Salvando personalização da ficha...");
    const result = await dataService.saveClinicAnamnesisTemplate(template);
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

      {/* Gestão de Equipe Section */}
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
            <div className="h-[250px] sm:h-[300px] min-w-[600px] sm:min-w-0">
              <ResponsiveContainer width="100%" height="100%">
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
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] shadow-sm border border-slate-100">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-6">
            Distribuição
          </h3>
          <div className="overflow-x-auto no-scrollbar -mx-6 sm:mx-0 px-6 sm:px-0">
            <div className="h-[250px] sm:h-[300px] min-w-[300px] sm:min-w-0">
              <ResponsiveContainer width="100%" height="100%">
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
              </ResponsiveContainer>
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
            {[
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
            ].map((item) => (
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
                      {repairMojibake(user.name)}
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
                    {[
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
                    ].map((item) => (
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
              history={patientsHistory.filter(
                (h) => h.patientId === selectedPatientId,
              )}
              notes={therapistNotes.filter(
                (n) => n.patientId === selectedPatientId,
              )}
              patientTasks={(allTasks || []).filter(
                (t) => t.patientId === selectedPatientId,
              )}
              onAddNote={onAddNote}
              onAddActivityLog={onAddActivityLog}
              onUpdatePatient={onUpdatePatient}
              protocols={protocols}
              userRole={user.role}
              anamnesisTemplate={anamnesisTemplate}
            />
          </main>
        </div>
      </div>
    );
  }

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
            {[
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
          ].map((item) => (
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
                    {repairMojibake(user.name)}
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
                  {[
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
                  ].map((item) => (
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
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
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
                        </ResponsiveContainer>
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
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                    Gestão de Pacientes
                  </h3>
                  <button
                    onClick={() => {
                      resetPatientForm();
                      setIsPatientRegistrationModalOpen(true);
                    }}
                    className="px-4 sm:px-6 py-2 sm:py-3 bg-[#7a32fc] text-white rounded-2xl font-bold text-xs sm:text-sm shadow-lg shadow-purple-500/20 hover:bg-blue-700 transition-all"
                  >
                    Novo Paciente
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {allPatients.map((patient, i) => (
                    <div
                      key={i}
                      className="p-4 sm:p-6 bg-slate-50 rounded-3xl border border-slate-100 hover:border-blue-500/30 transition-all group relative"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl flex items-center justify-center font-bold text-slate-900 shadow-sm group-hover:scale-110 transition-transform">
                          {patient.name[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-slate-900 truncate flex items-center gap-2">
                            {repairMojibake(patient.name)}
                            {isPatientPendingAnamnesis(patient) && (
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
                            {isPatientPendingAnamnesis(patient)
                              ? "Pendente de Anamnese"
                              : "Paciente Ativo"}
                          </span>
                        </div>
                        <div className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-[8px] font-bold uppercase">
                          {patient.id.startsWith("P") ? "Infantil" : "Adulto"}
                        </div>
                      </div>
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
                    </div>
                  ))}
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
                    Upgrade de Plano
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                <ProtocolManagementSystem
                  protocols={protocols}
                  onSaveProtocol={(p: any) => {
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
                  onDeleteProtocol={(id: any) =>
                    setProtocols(protocols.filter((p: any) => p.id !== id))
                  }
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
                                {log.title || log.action || "Atividade registrada"}
                              </p>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                {log.time ||
                                  (log.timestamp
                                    ? new Date(log.timestamp).toLocaleString("pt-BR")
                                    : log.created_at
                                      ? new Date(log.created_at).toLocaleString("pt-BR")
                                      : "Agora")}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              {log.content || log.details || "Ação registrada no sistema."}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">
                              por {log.actor_name || log.professional || "Profissional"}
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
                    Configurações da Clínica
                  </h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsAnamnesisTemplateModalOpen(true)}
                      disabled={loadingAnamnesisTemplate}
                      className="px-5 py-3 bg-white border border-[#7a32fc]/25 text-[#7a32fc] rounded-2xl font-bold text-sm hover:bg-[#f6f0ff] transition-all"
                    >
                      {loadingAnamnesisTemplate
                        ? "Carregando ficha..."
                        : "Editar Ficha Anamnese"}
                    </button>
                    <button
                      onClick={handleSaveClinicSettings}
                      className="px-6 py-3 bg-[#7a32fc] text-white rounded-2xl font-bold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-all"
                    >
                      Salvar Alterações
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
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
                </div>
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
        canEditTemplate={true}
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
                          {p.name.charAt(0)}
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



