import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Calendar,
  ClipboardList,
  LogOut,
  Plus,
  Search,
  Bell,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  UserPlus,
  Mail,
  Filter,
  Download,
  FileText,
  FileSpreadsheet,
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
  ShieldCheck,
  LayoutGrid,
  List,
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
import { BillingTissSettingsPanel } from "./BillingTissSettingsPanel";
import { ClinicGlobalSettingsPanel } from "./ClinicGlobalSettingsPanel";
import { LogoVerto } from "./Common";
import { SecureImage } from "./SecureMedia";
import { VERTO_BRAND_ASSETS } from "../constants/vertoBranding";
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
import {
  getPatientViewPreferenceKey,
  readPatientViewPreference,
  writePatientViewPreference,
  type PatientViewMode,
} from "../utils/patientViewPreference";
import {
  formatDocument,
  maskCep,
  maskCnpj,
  maskCpf,
  maskPhoneBR,
  onlyDigits,
  parseDocumentForStorage,
} from "../utils/brMasks";
import { ROLE_CAPABILITY_SECTIONS } from "../constants/roleCapabilities";
import {
  getDefaultAnamnesisTemplate,
  normalizeAnamnesisTemplate,
} from "../lib/anamnesisSchema";
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

type DashboardTab =
  | "dashboard"
  | "team"
  | "financial"
  | "patients"
  | "agenda"
  | "closure"
  | "conference"
  | "payers"
  | "patientAuthorizations"
  | "rooms"
  | "protocols"
  | "settings"
  | "logs"
  | "billing"
  | "flow"
  | "birthdays";

type ConferenceNavigationTab =
  | "sessions"
  | "patient"
  | "professional"
  | "payer"
  | "service"
  | "procedure"
  | "tuss"
  | "guide"
  | "preGuides"
  | "notBillable"
  | "exported"
  | "reopened";

type TissPreGuidePanel = "preGuides" | "batchDrafts" | "xmlDrafts";
type PayerNavigationSection = "convenios" | "tuss" | "prices" | "rules";
type PatientRegistrationTab = "personal" | "insurance" | "tiss" | "financial" | "legacy";

type FinancialNavigationIntent = {
  tab: DashboardTab;
  breadcrumb: string[];
  conferenceTab?: ConferenceNavigationTab;
  tissPanel?: TissPreGuidePanel;
  payerSection?: PayerNavigationSection;
  payerId?: string;
  payerName?: string;
};

type NavigationNode = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  badge?: string;
  tab?: DashboardTab;
  intent?: FinancialNavigationIntent;
  aliases?: Array<{ id: string; label: string; intent: FinancialNavigationIntent }>;
  children?: NavigationNode[];
  clinicFinanceOnly?: boolean;
  patientFinanceOnly?: boolean;
};

const COORDINATOR_SIDEBAR_PREFERENCE_KEY = "verto:coordinator-sidebar-expanded";

const readSidebarPreference = (key: string) => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};

const writeSidebarPreference = (key: string, expanded: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, expanded ? "true" : "false");
  } catch {
    // Prefer stable navigation over failing when storage is unavailable.
  }
};
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
import { normalizePatientInsuranceEligibility } from "../utils/patientInsuranceEligibility";
import {
  ABA_INDIVIDUAL_EXPECTED_TUSS_CODE,
  ABA_INDIVIDUAL_EXPECTED_TUSS_DESCRIPTION,
  findSuggestedTissAuthorizationForFinancialPlan,
  getPatientTissAuthorizationQuantitySummary,
  getPatientTissAuthorizationVisualState,
  groupPatientTissAuthorizations,
  hasConfirmedPatientTissAuthorizationBalance,
} from "../utils/patientTissAuthorizationView";
import {
  APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS,
  APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE,
  normalizeAppointmentFinancialContextType,
  type AppointmentFinancialContextType,
} from "../utils/appointmentFinancialContext";

const normalizeUtf8Text = (value: any) => String(value ?? "").normalize("NFC");

const normalizeLookupText = (value: any) =>
  normalizeUtf8Text(value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const stripGenericProfessionalPrefix = (value: any) =>
  normalizeUtf8Text(value)
    .trim()
    .replace(/^(terapeuta|profissional)\s+/i, "")
    .trim();

const pickProfessionalSpecialty = (source: any) => {
  const candidates = [
    source?.profession,
    source?.profissao,
    source?.professionName,
    source?.profession_name,
    source?.professionalTitle,
    source?.professional_title,
    source?.professionalRole,
    source?.professional_role,
    source?.professionalRoleTitle,
    source?.professional_role_title,
    source?.specialty,
    source?.specialtyName,
    source?.specialty_name,
    source?.professionalSpecialty,
    source?.professional_specialty,
    source?.clinicalRole,
    source?.clinical_role,
    source?.roleTitle,
    source?.role_title,
  ];
  if (Array.isArray(source?.specialties)) {
    candidates.push(...source.specialties);
  } else if (source?.specialties) {
    candidates.push(...String(source.specialties).split(/[,;|]/));
  }
  return normalizeUtf8Text(
    candidates.find((item) => String(item || "").trim()) || "",
  ).trim();
};

const inferProfessionalTitle = (source: any) => {
  const raw = pickProfessionalSpecialty(source);
  const normalized = normalizeLookupText(raw);
  const gender = normalizeLookupText(
    source?.gender ||
      source?.genero ||
      source?.professionalGender ||
      source?.professional_gender,
  );
  const isFemale = ["f", "female", "feminino", "mulher"].includes(gender);
  if (!normalized) return "";
  if (/psic[oó]loga/i.test(raw)) return "Psicóloga";
  if (/psic[oó]logo/i.test(raw)) return "Psicólogo";
  if (normalized.includes("neuropsicolog")) return isFemale ? "Neuropsicóloga" : "Neuropsicólogo";
  if (normalized.includes("psicolog")) return isFemale ? "Psicóloga" : "Psicólogo";
  if (/fonoaudi[oó]loga/i.test(raw)) return "Fonoaudióloga";
  if (/fonoaudi[oó]logo/i.test(raw)) return "Fonoaudiólogo";
  if (normalized.includes("fono")) return isFemale ? "Fonoaudióloga" : "Fonoaudiólogo";
  if (normalized.includes("terapia ocupacional") || normalized.includes("terapeuta ocupacional")) return "Terapeuta Ocupacional";
  if (/psicopedagoga/i.test(raw)) return "Psicopedagoga";
  if (/psicopedagogo/i.test(raw)) return "Psicopedagogo";
  if (normalized.includes("psicopedagog")) return isFemale ? "Psicopedagoga" : "Psicopedagogo";
  if (normalized.includes("musicoterap")) return "Musicoterapeuta";
  if (/fisioterapeuta/i.test(raw) || normalized.includes("fisioterap")) return "Fisioterapeuta";
  if (/nutricionista/i.test(raw) || normalized.includes("nutric")) return "Nutricionista";
  if (normalized === "terapeuta" || normalized === "aba" || normalized === "terapia") return "";
  return raw;
};

const formatProfessionalDisplayLabel = (source: any, fallback = "Profissional") => {
  const rawName = normalizeUtf8Text(
    source?.full_name ||
      source?.fullName ||
      source?.display_name ||
      source?.displayName ||
      source?.professional_name ||
      source?.professionalName ||
      source?.therapistName ||
      source?.name ||
      "",
  ).trim();
  const displayName = stripGenericProfessionalPrefix(rawName);
  const title = inferProfessionalTitle(source);
  const titleNormalized = normalizeLookupText(title);
  const nameNormalized = normalizeLookupText(displayName);
  if (title && displayName && !nameNormalized.startsWith(titleNormalized)) {
    return `${title} ${displayName}`;
  }
  if (displayName) return displayName;
  if (title) return title;
  return fallback;
};

const getProfessionalAccessRoleKeys = (source: any) =>
  [
    source?.role,
    source?.accessRole,
    source?.access_role,
    source?.membershipRole,
    source?.membership_role,
    source?.systemRole,
    source?.system_role,
  ]
    .map((item) => normalizeLookupText(item))
    .filter(Boolean);

const isPatientCareProfessionalMember = (source: any) => {
  const accessRoles = getProfessionalAccessRoleKeys(source);
  const professionalAccessLabels = ["therapist", "professional", "profissional", "profissional de atendimento"];
  if (accessRoles.length > 0) {
    return accessRoles.some((role) => professionalAccessLabels.includes(role));
  }
  const profileRoles = [
    source?.profileRole,
    source?.professionalProfileRole,
    source?.roleLabel,
    source?.role_label,
  ]
    .map((item) => normalizeLookupText(item))
    .filter(Boolean);
  return (
    profileRoles.some((role) => professionalAccessLabels.includes(role)) ||
    Boolean(inferProfessionalTitle(source))
  );
};

const resolvePatientResponsibleProfessionalId = (patient: any) =>
  String(
    patient?.therapist_id ||
      patient?.therapistId ||
      patient?.professional_id ||
      patient?.professionalId ||
      patient?.responsible_professional_id ||
      patient?.responsibleProfessionalId ||
      patient?.assigned_professional_id ||
      patient?.assignedProfessionalId ||
      patient?.primary_professional_id ||
      patient?.primaryProfessionalId ||
      patient?.metadata?.therapist_id ||
      patient?.metadata?.professional_id ||
      patient?.metadata?.responsible_professional_id ||
      "",
  ).trim();

const collectProfessionalIdentifierCandidates = (source: any, fallbackId: any = "") => {
  const rawIds = [
    fallbackId,
    source?.id,
    source?.user_id,
    source?.userId,
    source?.member_id,
    source?.memberId,
    source?.clinic_member_id,
    source?.clinicMemberId,
    source?.professional_id,
    source?.professionalId,
    source?.professional_profile_id,
    source?.professionalProfileId,
    source?.profile_id,
    source?.profileId,
    source?.auth_user_id,
    source?.authUserId,
    source?.therapist_id,
    source?.therapistId,
    source?.metadata?.user_id,
    source?.metadata?.userId,
    source?.metadata?.professional_id,
    source?.metadata?.professionalId,
    source?.metadata?.professional_profile_id,
    source?.metadata?.professionalProfileId,
    source?.metadata?.therapist_id,
    source?.metadata?.therapistId,
  ];
  return Array.from(
    new Set(rawIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
};

const resolvePatientResponsibleProfessionalLabel = (
  patient: any,
  professionalsById: Record<string, any>,
) => {
  const professionalId = resolvePatientResponsibleProfessionalId(patient);
  if (!professionalId) return { id: "", label: "Sem profissional responsável" };
  const professional = professionalsById[professionalId];
  if (!professional) return { id: professionalId, label: "Sem profissional responsável" };
  return {
    id: professionalId,
    label: formatProfessionalDisplayLabel({ ...professional, id: professionalId }, "Profissional"),
  };
};

const normalizeRevenueOriginLabel = (label: any) => {
  const normalized = normalizeLookupText(label);
  if (!normalized || ["nao informado", "sem origem"].includes(normalized)) return "Outras origens";
  if (normalized.includes("conven")) return "Convênios";
  if (normalized.includes("particular") || normalized.includes("private")) return "Particular";
  return normalizeUtf8Text(label).trim();
};

const getRevenueOriginColor = (label: any) => {
  const normalized = normalizeLookupText(label);
  if (normalized.includes("conven")) return "#16a34a";
  if (normalized.includes("particular")) return "#22c55e";
  return "#64748b";
};

const getFinancialSemanticValueClass = (semantic: "positive" | "negative" | "neutral" | "profit", value?: any) => {
  if (semantic === "positive") return "text-emerald-600";
  if (semantic === "negative") return "text-rose-600";
  if (semantic === "profit") return Number(value) < 0 ? "text-rose-600" : "text-emerald-600";
  return "text-slate-900";
};

const getPatientPhotoSource = (patient: any) =>
  String(
    patient?.profilePicture ||
      patient?.profile_picture ||
      patient?.profilePictureUrl ||
      patient?.profile_picture_url ||
      patient?.photoUrl ||
      patient?.photo_url ||
      ""
  ).trim();

const getPatientInitial = (patient: any) =>
  (String(patient?.name || "P").trim().charAt(0) || "P").toUpperCase();

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
  onScheduleSession: (session: any) => Promise<any> | any;
  onUpdateAppointment: (id: any, updates: any) => Promise<any> | any;
  onUpdateAgendaStatus: (id: any, status: string, details?: any) => Promise<any> | any;
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
    sessionMeta?: any,
  ) => any;
  onDeleteHistoryItem?: (id: any) => void;
  onEvaluateHistoryItem?: (id: any, score: number, note: string) => void;
  onRefreshPatientHistory?: (patientId: any) => Promise<any> | any;
  allTasks?: any[];
  onAddTask?: (task: any) => void;
  onUpdateTask?: (taskId: any, updates: any) => void;
}

const SESSION_PATIENT_INSURANCE_PAYER_VALUE = "__patient_insurance__";

const patientFormInputClass =
  "w-full rounded-xl border border-transparent bg-slate-50 p-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#7a32fc] focus:bg-white focus:ring-4 focus:ring-[#7a32fc]/10";

function FormSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-600">{title}</h3>
          {description && <p className="mt-1 text-xs font-medium leading-relaxed text-slate-400">{description}</p>}
        </div>
        {badge && (
          <span className="w-fit rounded-full bg-violet-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#7a32fc]">
            {badge}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function SubSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
      <div className="mb-3">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{title}</p>
        {description && <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function FormField({
  label,
  helperText,
  required,
  error,
  children,
}: {
  label: string;
  helperText?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-600">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {(helperText || error) && (
        <span className={`mt-1.5 block text-[11px] font-medium leading-relaxed ${error ? "text-rose-500" : "text-slate-400"}`}>
          {error || helperText}
        </span>
      )}
    </label>
  );
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
  onRefreshPatientHistory,
  allTasks = [],
  onAddTask,
  onUpdateTask,
}: CoordinatorDashboardProps) {
  const formatCnpjInput = (value: string) => maskCnpj(value);
  const formatCpfInput = (value: string) => maskCpf(value);
  const formatPhoneInput = (value: string) => maskPhoneBR(value);
  const profileMetadata = (
    user?.professionalProfile?.metadata ||
    user?.professional_profile?.metadata ||
    user?.professionalMetadata ||
    {}
  ) as Record<string, any>;
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
    payers: "clinic-settings",
    patientAuthorizations: "clinic-settings",
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
    if (tabId === "financial") return canAccessClinicFinance || isReceptionist;
    if (tabId === "closure") return !isReceptionist;
    if (tabId === "conference") return !isReceptionist && !isTherapist;
    const capability = capabilityForTab(tabId);
    if (!capability) return true;
    const status = capabilityStatusForRole(capability);
    if (status === "none") return false;
    return true;
  };

  const [activeTab, setActiveTab] = useState<
    | "dashboard"
    | "team"
    | "financial"
    | "patients"
    | "agenda"
    | "closure"
    | "conference"
    | "payers"
    | "patientAuthorizations"
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
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => readSidebarPreference(COORDINATOR_SIDEBAR_PREFERENCE_KEY));
  const toggleSidebarExpanded = useCallback(() => {
    setIsSidebarExpanded((current) => {
      const next = !current;
      writeSidebarPreference(COORDINATOR_SIDEBAR_PREFERENCE_KEY, next);
      return next;
    });
  }, []);
  const [expandedNavigationSections, setExpandedNavigationSections] = useState<Record<string, boolean>>({
    "care-root": true,
    "tiss-root": true,
    "prebilling-root": true,
    "finance-root": true,
    "settings-root": true,
    "finance-clinical": false,
    "finance-reports": false,
  });
  const [financialNavigationContext, setFinancialNavigationContext] = useState<FinancialNavigationIntent & { intentKey: number }>({
    tab: "financial",
    breadcrumb: ["Financeiro", "Dashboard financeiro"],
    intentKey: 0,
  });
  const [therapistMembersById, setTherapistMembersById] = useState<Record<string, any>>({});
  const [patientTherapistFilter, setPatientTherapistFilter] = useState<string>("all");
  const [patientQuickFilter, setPatientQuickFilter] = useState<"all" | "birthdaysToday">("all");

  const defaultFinancialNavigationIntent = (tab: DashboardTab): FinancialNavigationIntent | null => {
    if (tab === "financial") return { tab, breadcrumb: ["Financeiro", "Dashboard financeiro"] };
    if (tab === "payers") {
      return {
        tab,
        breadcrumb: ["Convênios e TISS", "Convênios"],
        payerSection: "convenios",
      };
    }
    if (tab === "patientAuthorizations") {
      return { tab, breadcrumb: ["Convênios e TISS", "Autorizações dos pacientes"] };
    }
    if (tab === "conference") {
      return {
        tab,
        breadcrumb: ["Pré-faturamento TISS", "Pré-guias TISS"],
        conferenceTab: "preGuides",
        tissPanel: "preGuides",
      };
    }
    if (tab === "closure") {
      return { tab, breadcrumb: ["Pré-faturamento TISS", "Pendências"] };
    }
    return null;
  };

  const navigateToTab = (tab: DashboardTab, intent?: Partial<FinancialNavigationIntent>) => {
    if (!canAccessTab(tab)) {
      setActiveTab("dashboard");
      return;
    }
    const navigationIntent = intent?.breadcrumb
      ? { tab, ...intent, breadcrumb: intent.breadcrumb } as FinancialNavigationIntent
      : defaultFinancialNavigationIntent(tab);
    if (navigationIntent) {
      setFinancialNavigationContext((current) => ({
        ...navigationIntent,
        intentKey: current.intentKey + 1,
      }));
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
          const ids = collectProfessionalIdentifierCandidates(member);
          const id = ids[0] || "";
          if (isPatientCareProfessionalMember(member) && id) {
            const normalizedMember = { ...member, id, matchIds: ids };
            ids.forEach((candidateId) => {
              byId[candidateId] = normalizedMember;
            });
          }
        });
        setTherapistMembersById(byId);
      } catch (error) {
        console.error("Erro ao carregar profissionais para exibição de responsáveis:", error);
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
        const optionId = String(member?.id || id || "").trim();
        const specialties = Array.isArray(member?.specialties)
          ? member.specialties
          : String(member?.specialties || member?.specialty || member?.professionalSpecialty || "")
              .split(/[,;|]/);
        const specialty = String(specialties.find((item: any) => String(item || "").trim()) || "").trim();
        const matchIds = collectProfessionalIdentifierCandidates(member, id);
        return {
          id: optionId,
          matchIds,
          label: formatProfessionalDisplayLabel(member, String(member?.email || optionId).trim() || "Profissional"),
          specialty,
          profilePicture:
            member?.profilePicture ||
            member?.profile_picture ||
            member?.profilePhotoUrl ||
            member?.profile_photo_url ||
            member?.avatarUrl ||
            member?.avatar_url ||
            member?.photoUrl ||
            member?.photo_url ||
            member?.imageUrl ||
            member?.image_url ||
            "",
          workSchedule: member?.workSchedule || member?.work_schedule || null,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    const uniqueEntries: typeof entries = [];
    const seenIds = new Set<string>();
    entries.forEach((entry) => {
      const primaryId = String(entry.id || "").trim();
      if (!primaryId || seenIds.has(primaryId)) return;
      seenIds.add(primaryId);
      uniqueEntries.push(entry);
    });
    return uniqueEntries;
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
          const therapistId = resolvePatientResponsibleProfessionalId(patient);
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
          const therapistId = resolvePatientResponsibleProfessionalId(patient);
          return !therapistId;
        });
      } else {
        filteredPatients = patientsAllowedForRole.filter((patient: any) => {
          const therapistId = resolvePatientResponsibleProfessionalId(patient);
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
        const therapistId = resolvePatientResponsibleProfessionalId(patient);
        return !therapistId;
      });
    }
    return roleScopedPatients.filter((patient: any) => {
      const therapistId = resolvePatientResponsibleProfessionalId(patient);
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
    conference: "Pré-faturamento mensal",
    payers: "Convênios",
    patientAuthorizations: "Autorizações dos pacientes",
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
  const [newRoom, setNewRoom] = useState({ name: "", specialties: "", preventOverlappingAppointments: true });
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
  const patientViewPreferenceKey = useMemo(
    () => getPatientViewPreferenceKey(user),
    [user?.id, user?.email, user?.activeWorkspaceId, user?.clinicId],
  );
  const [patientViewMode, setPatientViewMode] = useState<PatientViewMode>(() =>
    readPatientViewPreference(patientViewPreferenceKey),
  );
  useEffect(() => {
    setPatientViewMode(readPatientViewPreference(patientViewPreferenceKey));
  }, [patientViewPreferenceKey]);
  const handlePatientViewModeChange = useCallback(
    (nextMode: PatientViewMode) => {
      setPatientViewMode(nextMode);
      writePatientViewPreference(patientViewPreferenceKey, nextMode);
    },
    [patientViewPreferenceKey],
  );
  const renderPatientViewModeToggle = () => (
    <div
      className="flex rounded-xl border border-slate-200 bg-slate-50 p-1"
      aria-label="Modo de visualização dos pacientes"
    >
      <button
        type="button"
        title="Visualizar em cards"
        aria-label="Visualizar pacientes em cards"
        aria-pressed={patientViewMode === "cards"}
        onClick={() => handlePatientViewModeChange("cards")}
        className={`rounded-lg p-2 transition-colors ${
          patientViewMode === "cards"
            ? "bg-white text-[#7a32fc] shadow-sm"
            : "text-slate-400 hover:text-slate-700"
        }`}
      >
        <LayoutGrid size={16} />
      </button>
      <button
        type="button"
        title="Visualizar em lista"
        aria-label="Visualizar pacientes em lista"
        aria-pressed={patientViewMode === "list"}
        onClick={() => handlePatientViewModeChange("list")}
        className={`rounded-lg p-2 transition-colors ${
          patientViewMode === "list"
            ? "bg-white text-[#7a32fc] shadow-sm"
            : "text-slate-400 hover:text-slate-700"
        }`}
      >
        <List size={16} />
      </button>
    </div>
  );
  const [professionalFilter, setProfessionalFilter] = useState("all");
  const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
  const [isQuickRegisterModalOpen, setIsQuickRegisterModalOpen] = useState(false);
  const [isPatientRegistrationModalOpen, setIsPatientRegistrationModalOpen] =
    useState(false);
  const [activePatientRegistrationTab, setActivePatientRegistrationTab] =
    useState<PatientRegistrationTab>("personal");
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
  const [sessionProfessionalId, setSessionProfessionalId] = useState("");
  const [sessionProfessionalManuallySelected, setSessionProfessionalManuallySelected] = useState(false);
  const [sessionFinancialContextType, setSessionFinancialContextType] =
    useState<AppointmentFinancialContextType>("INSURANCE");
  const [sessionPayerId, setSessionPayerId] = useState("");
  const [sessionPayerNameSnapshot, setSessionPayerNameSnapshot] = useState("");
  const [sessionInsurancePlanName, setSessionInsurancePlanName] = useState("");
  const [sessionInsuranceCardNumber, setSessionInsuranceCardNumber] = useState("");
  const [sessionInsuranceHolderName, setSessionInsuranceHolderName] = useState("");
  const [sessionInsuranceCardValidUntil, setSessionInsuranceCardValidUntil] = useState("");
  const [sessionGuideNumber, setSessionGuideNumber] = useState("");
  const [sessionAuthorizationCode, setSessionAuthorizationCode] = useState("");
  const [sessionPatientTissAuthorizationId, setSessionPatientTissAuthorizationId] = useState("");
  const [showSessionUnavailableTissAuthorizations, setShowSessionUnavailableTissAuthorizations] = useState(false);
  const [sessionBillingSuggestionState, setSessionBillingSuggestionState] = useState<{
    loading: boolean;
    error: string;
    suggestion: any | null;
  }>({ loading: false, error: "", suggestion: null });
  const [clinicPayers, setClinicPayers] = useState<any[]>([]);
  const lastAutoPayerPatientKeyRef = useRef("");
  const sessionSubmitInFlightRef = useRef(false);
  const [isSessionSubmitting, setIsSessionSubmitting] = useState(false);
  const [sessionNumSessions, setSessionNumSessions] = useState(1);
  const [sessionRecurrencePattern, setSessionRecurrencePattern] = useState("weekly");
  const [sessionApplyAuthorizationToRecurrence, setSessionApplyAuthorizationToRecurrence] =
    useState(true);
  const [sessionReuseGuideAcrossRecurrence, setSessionReuseGuideAcrossRecurrence] =
    useState(false);
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
  const [editingAppointmentActionRequest, setEditingAppointmentActionRequest] = useState<{
    id: string;
    type: string;
  } | null>(null);
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
  const [selectedPatientProfileAuthorizations, setSelectedPatientProfileAuthorizations] = useState<any[]>([]);
  const [selectedPatientProfileAuthorizationsLoading, setSelectedPatientProfileAuthorizationsLoading] = useState(false);
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
  const [professionalPaymentAdjustmentReason, setProfessionalPaymentAdjustmentReason] = useState("");
  const [professionalTransferProfessionalFilter, setProfessionalTransferProfessionalFilter] = useState("all");
  const [professionalTransferStatusFilter, setProfessionalTransferStatusFilter] = useState("all");
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
  const [anamnesisTemplates, setAnamnesisTemplates] = useState<any[]>([]);
  const [isAnamnesisTemplateModalOpen, setIsAnamnesisTemplateModalOpen] =
    useState(false);
  const [loadingAnamnesisTemplate, setLoadingAnamnesisTemplate] =
    useState(false);
  const [clinicDocumentType, setClinicDocumentType] = useState<string>(
    String(user?.clinicSettings?.clinicDocumentType || user?.clinicSettings?.documentType || "CNPJ").toUpperCase(),
  );
  const [clinicCnpj, setClinicCnpj] = useState(
    formatDocument(
      String(user?.clinicSettings?.clinicDocumentNumber || user?.clinicSettings?.clinicCnpj || ""),
      user?.clinicSettings?.clinicDocumentType || user?.clinicSettings?.documentType || "CNPJ",
    ),
  );
  const [clinicLegalName, setClinicLegalName] = useState<string>(
    String(user?.clinicSettings?.clinicLegalName || user?.clinicSettings?.legalName || ""),
  );
  const [clinicCnesCode, setClinicCnesCode] = useState<string>(
    onlyDigits(user?.clinicSettings?.clinicCnesCode || user?.clinicSettings?.cnesCode || "", 12),
  );
  const [clinicProviderCode, setClinicProviderCode] = useState<string>(
    String(user?.clinicSettings?.clinicProviderCode || user?.clinicSettings?.providerCode || ""),
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
  const [therapistDocumentType, setTherapistDocumentType] = useState<string>(
    String(user?.professionalProfile?.documentType || user?.professional_profile?.document_type || profileMetadata?.documentType || profileMetadata?.document_type || "CPF").toUpperCase(),
  );
  const [therapistCpf, setTherapistCpf] = useState<string>(
    formatDocument(
      String(user?.cpf || profileMetadata?.cpf || profileMetadata?.professionalCpf || ""),
      user?.professionalProfile?.documentType || user?.professional_profile?.document_type || profileMetadata?.documentType || profileMetadata?.document_type || "CPF",
    ),
  );
  const [therapistPhone, setTherapistPhone] = useState<string>(
    formatPhoneInput(String(user?.phone || user?.whatsappPhone || profileMetadata?.phone || profileMetadata?.professionalPhone || "")),
  );
  const [therapistEmail, setTherapistEmail] = useState<string>(
    String(user?.email || profileMetadata?.email || profileMetadata?.professionalEmail || ""),
  );
  const [therapistRoleTitle, setTherapistRoleTitle] = useState<string>(
    String(user?.professionalRoleTitle || profileMetadata?.roleTitle || profileMetadata?.professionalRoleTitle || ""),
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
  const [therapistCouncilType, setTherapistCouncilType] = useState<string>(
    String(user?.professionalProfile?.council || user?.professional_profile?.council || profileMetadata?.council || profileMetadata?.councilType || ""),
  );
  const [therapistCouncilState, setTherapistCouncilState] = useState<string>(
    String(user?.professionalProfile?.councilState || user?.professional_profile?.council_state || profileMetadata?.councilState || profileMetadata?.council_state || "").toUpperCase().slice(0, 2),
  );
  const [therapistCboCode, setTherapistCboCode] = useState<string>(
    onlyDigits(user?.professionalProfile?.cboCode || user?.professional_profile?.cbo_code || profileMetadata?.cboCode || profileMetadata?.cbo_code || "", 12),
  );
  const [therapistSpecialtyName, setTherapistSpecialtyName] = useState<string>(
    String(user?.professionalProfile?.specialtyName || user?.professional_profile?.specialty_name || profileMetadata?.specialtyName || profileMetadata?.specialty_name || ""),
  );
  const [therapistProviderCode, setTherapistProviderCode] = useState<string>(
    String(user?.professionalProfile?.providerCode || user?.professional_profile?.provider_code || profileMetadata?.providerCode || profileMetadata?.provider_code || ""),
  );
  const [clinicDisplayName, setClinicDisplayName] = useState<string>(
    String(user?.clinicSettings?.clinicName || user?.workspaceName || ""),
  );
  const [clinicPhone, setClinicPhone] = useState<string>(
    formatPhoneInput(String(user?.clinicSettings?.clinicPhone || "")),
  );
  const [clinicWhatsapp, setClinicWhatsapp] = useState<string>(
    formatPhoneInput(String(user?.clinicSettings?.clinicWhatsapp || user?.clinicSettings?.whatsapp || "")),
  );
  const [clinicEmail, setClinicEmail] = useState<string>(
    String(user?.clinicSettings?.clinicEmail || ""),
  );
  const [clinicSite, setClinicSite] = useState<string>(
    String(user?.clinicSettings?.clinicSite || user?.clinicSettings?.site || ""),
  );
  const [clinicAddress, setClinicAddress] = useState<string>(
    String(user?.clinicSettings?.clinicAddress || ""),
  );
  const [clinicAddressLine, setClinicAddressLine] = useState<string>(
    String(user?.clinicSettings?.clinicAddressLine || user?.clinicSettings?.addressLine || user?.clinicSettings?.clinicAddress || ""),
  );
  const [clinicAddressNumber, setClinicAddressNumber] = useState<string>(
    String(user?.clinicSettings?.clinicAddressNumber || user?.clinicSettings?.addressNumber || ""),
  );
  const [clinicAddressComplement, setClinicAddressComplement] = useState<string>(
    String(user?.clinicSettings?.clinicAddressComplement || user?.clinicSettings?.addressComplement || ""),
  );
  const [clinicDistrict, setClinicDistrict] = useState<string>(
    String(user?.clinicSettings?.clinicDistrict || user?.clinicSettings?.district || ""),
  );
  const [clinicCity, setClinicCity] = useState<string>(
    String(user?.clinicSettings?.clinicCity || user?.clinicSettings?.city || ""),
  );
  const [clinicStateUf, setClinicStateUf] = useState<string>(
    String(user?.clinicSettings?.clinicState || user?.clinicSettings?.state || "").toUpperCase().slice(0, 2),
  );
  const [clinicPostalCode, setClinicPostalCode] = useState<string>(
    maskCep(String(user?.clinicSettings?.clinicPostalCode || user?.clinicSettings?.postalCode || "")),
  );
  const [mediaRefreshAttempts, setMediaRefreshAttempts] = useState({
    signature: 0,
    profile: 0,
    logo: 0,
  });
  const therapistCanRegisterClinicalData = !isTherapist || Boolean(therapistCrp.trim());
  const isDemoAccount = Boolean(user?.isDemoUser);
  const canManageProtocolLibrary = capabilityStatusForRole("protocol-library") === "full";
  const canManageClinicSettings = capabilityStatusForRole("clinic-settings") !== "none";
  const canManageBilling = !isDemoAccount && capabilityStatusForRole("billing-management") !== "none";
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
    convenioCarteirinhaValidade: "",
    convenioPlanoCategoria: "",
    convenioTitularNome: "",
    convenioTitularCpf: "",
    convenioTitularRelacao: "",
    convenioElegibilidadeObs: "",
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
    insuranceHolderSuggestedFromResponsible: false,
  });
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const defaultPatientTissAuthorizationForm = {
    id: "",
    payerId: "",
    configurationKey: "",
    serviceCatalogId: "",
    payerTussMappingId: "",
    tussCodeId: "",
    authorizationNumber: "",
    guideNumber: "",
    validFrom: "",
    validUntil: "",
    authorizedQuantity: "1",
    authorizedUnit: "sessions",
    usedQuantity: "0",
    status: "active",
    notes: "",
  };
  const [patientTissAuthorizations, setPatientTissAuthorizations] = useState<any[]>([]);
  const [patientTissAuthorizationLoading, setPatientTissAuthorizationLoading] = useState(false);
  const [patientTissAuthorizationFormOpen, setPatientTissAuthorizationFormOpen] = useState(false);
  const [editingPatientTissAuthorizationId, setEditingPatientTissAuthorizationId] = useState("");
  const [patientTissAuthorizationForm, setPatientTissAuthorizationForm] = useState<any>(defaultPatientTissAuthorizationForm);
  const [patientTissAuthorizationFeedback, setPatientTissAuthorizationFeedback] = useState<{ type: "idle" | "saving" | "success" | "error"; message: string }>({ type: "idle", message: "" });
  const [patientAuthorizationOverview, setPatientAuthorizationOverview] = useState<any[]>([]);
  const [patientAuthorizationOverviewLoading, setPatientAuthorizationOverviewLoading] = useState(false);
  const [patientAuthorizationOverviewError, setPatientAuthorizationOverviewError] = useState("");
  const [patientAuthorizationOverviewFilters, setPatientAuthorizationOverviewFilters] = useState({
    search: "",
    payerId: "all",
    status: "all",
  });
  const [patientTissAuthorizationCatalog, setPatientTissAuthorizationCatalog] = useState<{
    services: any[];
    codes: any[];
    mappings: any[];
    prices: any[];
  }>({ services: [], codes: [], mappings: [], prices: [] });

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

  const normalizeLookupText = (value: any) =>
    normalizeUtf8Text(String(value || "")).trim().toLowerCase();

  const selectedPatientInsurancePayer = useMemo(() => {
    const payerName = normalizeLookupText(newPatientForm.convenioNome);
    if (newPatientForm.convenioTipo !== "convenio" || !payerName) return null;
    return clinicPayers.find((payer: any) => normalizeLookupText(payer?.name) === payerName) || null;
  }, [clinicPayers, newPatientForm.convenioNome, newPatientForm.convenioTipo]);

  const resolveFinancialPlanPayer = (plan: any) => {
    const payerId = String(plan?.payerId || plan?.payer_id || "").trim();
    if (payerId) {
      const byId = clinicPayers.find((payer: any) => String(payer?.id || "") === payerId);
      if (byId) return byId;
    }
    const payerName = normalizeLookupText(plan?.payerNameSnapshot || plan?.payer_name_snapshot || plan?.insuranceName || plan?.insurance_name || newPatientForm.convenioNome);
    if (!payerName) return null;
    return clinicPayers.find((payer: any) => normalizeLookupText(payer?.name) === payerName) || null;
  };

  const patientAuthorizationBillingConfigurations = useMemo(() => {
    const { services, codes, mappings, prices } = patientTissAuthorizationCatalog;
    const servicesById = new Map<string, any>(services.map((service: any) => [String(service.id || ""), service]));
    const codesById = new Map<string, any>(codes.map((code: any) => [String(code.id || ""), code]));
    const activePrices = prices.filter((price: any) => price?.active === true);
    return mappings
      .filter((mapping: any) => mapping?.active === true)
      .map((mapping: any) => {
        const service = servicesById.get(String(mapping.serviceCatalogId || ""));
        const code = codesById.get(String(mapping.tussCodeId || ""));
        const price =
          activePrices.find((item: any) => String(item.payerTussMappingId || "") === String(mapping.id || "")) ||
          activePrices.find((item: any) =>
            String(item.serviceCatalogId || "") === String(mapping.serviceCatalogId || "") &&
            String(item.tussCodeId || "") === String(mapping.tussCodeId || "")
          ) ||
          null;
        return {
          key: `${mapping.id}:${price?.id || "sem-preco"}`,
          mapping,
          service,
          code,
          price,
          isOperational: service?.active === true && code?.active === true && mapping?.active === true && price?.active === true,
        };
      })
      .filter((configuration: any) => configuration.isOperational);
  }, [patientTissAuthorizationCatalog]);

  const selectedPatientAuthorizationConfiguration = useMemo(
    () => patientAuthorizationBillingConfigurations.find((configuration: any) => configuration.key === patientTissAuthorizationForm.configurationKey) || null,
    [patientAuthorizationBillingConfigurations, patientTissAuthorizationForm.configurationKey],
  );

  const formatPatientAuthorizationAmount = (amountCents: any) => {
    if (!Number.isFinite(Number(amountCents))) return "Valor pendente";
    return (Number(amountCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const formatPatientAuthorizationDate = (value: any) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "sem data";
  };

  const patientTissAuthorizationGroups = useMemo(
    () => groupPatientTissAuthorizations(patientTissAuthorizations),
    [patientTissAuthorizations],
  );
  const getPatientTissAuthorizationIdentity = (authorization: any) =>
    String(authorization?.id || [
      authorization?.authorizationNumber || authorization?.authorizationCode || "",
      authorization?.guideNumber || "",
      authorization?.validFrom || "",
      authorization?.validUntil || "",
      authorization?.tussCode || "",
    ].join("|"));
  const patientTissSuggestedAuthorizationGroup = patientTissAuthorizationGroups.find((group: any) => group.suggestedAuthorization) || null;
  const patientTissSuggestedAuthorization = patientTissSuggestedAuthorizationGroup?.suggestedAuthorization || null;
  const patientTissSuggestedAuthorizationIdentity = getPatientTissAuthorizationIdentity(patientTissSuggestedAuthorization);
  const patientTissSimilarAuthorizations = patientTissSuggestedAuthorizationGroup
    ? patientTissSuggestedAuthorizationGroup.currentAuthorizations.filter((authorization: any) =>
        getPatientTissAuthorizationIdentity(authorization) !== patientTissSuggestedAuthorizationIdentity,
      )
    : [];
  const patientTissOtherCurrentAuthorizations = patientTissAuthorizationGroups
    .filter((group: any) => group.key !== patientTissSuggestedAuthorizationGroup?.key)
    .flatMap((group: any) => group.currentAuthorizations || []);
  const patientTissCollapsedCurrentAuthorizations = [...patientTissSimilarAuthorizations, ...patientTissOtherCurrentAuthorizations];
  const patientTissLegacyAuthorizations = patientTissAuthorizationGroups.flatMap((group: any) => group.legacyAuthorizations || []);
  const patientTissHistoricalAuthorizations = patientTissAuthorizationGroups.flatMap((group: any) => group.historicalAuthorizations || []);

  const patientAuthorizationStatusClass = (authorization: any) => {
    const state = getPatientTissAuthorizationVisualState(authorization);
    if (state.tone === "green") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    if (state.tone === "amber") return "bg-amber-50 text-amber-700 ring-amber-100";
    if (state.tone === "blue") return "bg-sky-50 text-sky-700 ring-sky-100";
    if (state.tone === "red") return "bg-rose-50 text-rose-700 ring-rose-100";
    return "bg-slate-50 text-slate-600 ring-slate-100";
  };

  const formatPatientAuthorizationBalance = (authorization: any) => {
    if (!hasConfirmedPatientTissAuthorizationBalance(authorization)) return "saldo não confirmado";
    const summary = getPatientTissAuthorizationQuantitySummary(authorization);
    if (!summary.hasPackageLimit && summary.available === null) return "sem limite informado";
    return String(summary.available ?? 0);
  };

  const describePatientAuthorizationSuggestion = (authorization: any) => {
    if (!authorization) return "";
    const balance = formatPatientAuthorizationBalance(authorization);
    const until = formatPatientAuthorizationDate(authorization.validUntil);
    return `Senha ${authorization.authorizationNumber || authorization.authorizationCode || "-"} · saldo ${balance} · válida até ${until}`;
  };

  const loadPatientAuthorizationOverview = useCallback(async () => {
    setPatientAuthorizationOverviewLoading(true);
    setPatientAuthorizationOverviewError("");
    try {
      const result = await dataService.getPatientTissAuthorizationsOverview({ limit: 800 });
      if (!result?.success) {
        setPatientAuthorizationOverview([]);
        setPatientAuthorizationOverviewError(result?.error || "Não foi possível carregar as autorizações TISS dos pacientes.");
        return;
      }
      setPatientAuthorizationOverview(Array.isArray(result.data) ? result.data : []);
    } catch {
      setPatientAuthorizationOverview([]);
      setPatientAuthorizationOverviewError("Não foi possível carregar as autorizações TISS dos pacientes.");
    } finally {
      setPatientAuthorizationOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "patientAuthorizations") {
      void loadPatientAuthorizationOverview();
    }
  }, [activeTab, loadPatientAuthorizationOverview]);

  useEffect(() => {
    if (activeTab !== "patientAuthorizations") return;
    setPatientAuthorizationOverviewFilters((current) => ({
      ...current,
      payerId: financialNavigationContext.payerId || "all",
    }));
  }, [activeTab, financialNavigationContext.intentKey, financialNavigationContext.payerId]);

  const patientAuthorizationOverviewPayerOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const authorization of patientAuthorizationOverview) {
      const payerId = String(authorization?.payerId || authorization?.payer_id || authorization?.payerName || "").trim();
      const payerName = normalizeUtf8Text(String(authorization?.payerName || authorization?.payer_name || "Convênio não informado")).trim();
      if (payerId) options.set(payerId, payerName || "Convênio não informado");
    }
    return Array.from(options.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [patientAuthorizationOverview]);

  const filteredPatientAuthorizationOverview = useMemo(() => {
    const search = normalizeLookupText(patientAuthorizationOverviewFilters.search);
    return patientAuthorizationOverview.filter((authorization: any) => {
      const state = getPatientTissAuthorizationVisualState(authorization);
      const payerId = String(authorization?.payerId || authorization?.payer_id || authorization?.payerName || "").trim();
      if (patientAuthorizationOverviewFilters.payerId !== "all" && payerId !== patientAuthorizationOverviewFilters.payerId) {
        return false;
      }
      if (patientAuthorizationOverviewFilters.status !== "all") {
        if (patientAuthorizationOverviewFilters.status === "legacy") {
          if (!state.isLegacyOrInadequate) return false;
        } else if (patientAuthorizationOverviewFilters.status === "current") {
          if (!["current", "expiring"].includes(state.status)) return false;
        } else if (state.status !== patientAuthorizationOverviewFilters.status) {
          return false;
        }
      }
      if (!search) return true;
      const haystack = normalizeLookupText([
        authorization?.patientName,
        authorization?.patient_name,
        authorization?.payerName,
        authorization?.payer_name,
        authorization?.serviceName,
        authorization?.service_name,
        authorization?.internalCode,
        authorization?.internal_code,
        authorization?.tussCode,
        authorization?.tuss_code,
        authorization?.guideNumber,
        authorization?.guide_number,
        authorization?.authorizationNumber,
        authorization?.authorization_number,
        authorization?.authorizationCode,
        authorization?.authorization_code,
      ].filter(Boolean).join(" "));
      return haystack.includes(search);
    });
  }, [patientAuthorizationOverview, patientAuthorizationOverviewFilters, normalizeLookupText]);

  const resetPatientTissAuthorizationForm = () => {
    setEditingPatientTissAuthorizationId("");
    setPatientTissAuthorizationForm({
      ...defaultPatientTissAuthorizationForm,
      payerId: selectedPatientInsurancePayer?.id || "",
    });
    setPatientTissAuthorizationFeedback({ type: "idle", message: "" });
  };

  const loadPatientTissAuthorizations = async (patientId: string) => {
    if (!patientId || !canAccessClinicFinance) return;
    setPatientTissAuthorizationLoading(true);
    try {
      const result = await dataService.getPatientTissAuthorizations(patientId);
      setPatientTissAuthorizations(result?.success && Array.isArray(result.data) ? result.data : []);
    } finally {
      setPatientTissAuthorizationLoading(false);
    }
  };

  const loadPatientTissAuthorizationCatalog = async (payerId: string) => {
    if (!payerId || !canAccessClinicFinance) {
      setPatientTissAuthorizationCatalog({ services: [], codes: [], mappings: [], prices: [] });
      return;
    }
    const [servicesResult, codesResult, mappingsResult, pricesResult] = await Promise.all([
      dataService.getTussServices({ limit: 200 }),
      dataService.getTussCodes({ limit: 300 }),
      dataService.getPayerTussMappings({ payerId, limit: 200 }),
      dataService.getPayerProcedurePrices({ payerId, limit: 200 }),
    ]);
    setPatientTissAuthorizationCatalog({
      services: servicesResult?.success && Array.isArray(servicesResult.data) ? servicesResult.data : [],
      codes: codesResult?.success && Array.isArray(codesResult.data) ? codesResult.data : [],
      mappings: mappingsResult?.success && Array.isArray(mappingsResult.data) ? mappingsResult.data : [],
      prices: pricesResult?.success && Array.isArray(pricesResult.data) ? pricesResult.data : [],
    });
  };

  const openNewPatientTissAuthorizationForm = () => {
    if (!editingPatientId) {
      showToast("Salve o cadastro do paciente antes de criar uma autorização TISS.", "error");
      return;
    }
    if (!selectedPatientInsurancePayer?.id) {
      showToast("Configure o convênio do paciente antes de criar uma autorização TISS.", "error");
      return;
    }
    if (patientAuthorizationBillingConfigurations.length === 0) {
      setPatientTissAuthorizationFeedback({
        type: "error",
        message: "Nenhuma configuração ativa com De/Para e valor negociado foi encontrada para este convênio.",
      });
      return;
    }
    const firstConfig = patientAuthorizationBillingConfigurations[0];
    setEditingPatientTissAuthorizationId("");
    setPatientTissAuthorizationForm({
      ...defaultPatientTissAuthorizationForm,
      payerId: selectedPatientInsurancePayer.id,
      configurationKey: firstConfig.key,
      serviceCatalogId: firstConfig.mapping?.serviceCatalogId || firstConfig.price?.serviceCatalogId || "",
      payerTussMappingId: firstConfig.mapping?.id || "",
      tussCodeId: firstConfig.mapping?.tussCodeId || firstConfig.price?.tussCodeId || "",
    });
    setPatientTissAuthorizationFormOpen(true);
    setPatientTissAuthorizationFeedback({ type: "idle", message: "" });
  };

  const handlePatientTissAuthorizationConfigurationChange = (configurationKey: string) => {
    const configuration = patientAuthorizationBillingConfigurations.find((item: any) => item.key === configurationKey);
    setPatientTissAuthorizationForm((current: any) => ({
      ...current,
      configurationKey,
      serviceCatalogId: configuration?.mapping?.serviceCatalogId || configuration?.price?.serviceCatalogId || "",
      payerTussMappingId: configuration?.mapping?.id || "",
      tussCodeId: configuration?.mapping?.tussCodeId || configuration?.price?.tussCodeId || "",
      authorizedUnit: configuration?.mapping?.billingUnit || current.authorizedUnit || "sessions",
    }));
  };

  const editPatientTissAuthorization = (authorization: any) => {
    const config = patientAuthorizationBillingConfigurations.find((item: any) =>
      String(item.mapping?.id || "") === String(authorization.payerTussMappingId || "") ||
      String(item.mapping?.serviceCatalogId || "") === String(authorization.serviceCatalogId || "")
    );
    setEditingPatientTissAuthorizationId(String(authorization.id || ""));
    setPatientTissAuthorizationForm({
      ...defaultPatientTissAuthorizationForm,
      id: String(authorization.id || ""),
      payerId: String(authorization.payerId || selectedPatientInsurancePayer?.id || ""),
      configurationKey: config?.key || "",
      serviceCatalogId: String(authorization.serviceCatalogId || config?.mapping?.serviceCatalogId || ""),
      payerTussMappingId: String(authorization.payerTussMappingId || config?.mapping?.id || ""),
      tussCodeId: String(authorization.tussCodeId || config?.mapping?.tussCodeId || ""),
      authorizationNumber: String(authorization.authorizationNumber || authorization.authorizationCode || ""),
      guideNumber: String(authorization.guideNumber || ""),
      validFrom: String(authorization.validFrom || ""),
      validUntil: String(authorization.validUntil || ""),
      authorizedQuantity: String(authorization.authorizedQuantity || "1"),
      authorizedUnit: String(authorization.authorizedUnit || config?.mapping?.billingUnit || "sessions"),
      usedQuantity: String(authorization.usedQuantity || "0"),
      status: authorization.active === false ? "cancelled" : String(authorization.status || "active"),
      notes: String(authorization.notes || ""),
    });
    setPatientTissAuthorizationFormOpen(true);
    setPatientTissAuthorizationFeedback({ type: "idle", message: "" });
  };

  const savePatientTissAuthorization = async () => {
    if (!editingPatientId || patientTissAuthorizationFeedback.type === "saving") return;
    const configuration = selectedPatientAuthorizationConfiguration;
    const quantity = Number(patientTissAuthorizationForm.authorizedQuantity || 0);
    if (!selectedPatientInsurancePayer?.id || !configuration?.isOperational) {
      setPatientTissAuthorizationFeedback({ type: "error", message: "Selecione uma configuração ativa com De/Para e valor negociado." });
      return;
    }
    if (!patientTissAuthorizationForm.authorizationNumber.trim()) {
      setPatientTissAuthorizationFeedback({ type: "error", message: "Informe o número da autorização/senha." });
      return;
    }
    if (!patientTissAuthorizationForm.validFrom || !patientTissAuthorizationForm.validUntil || patientTissAuthorizationForm.validUntil < patientTissAuthorizationForm.validFrom) {
      setPatientTissAuthorizationFeedback({ type: "error", message: "Informe uma vigência válida para a autorização." });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPatientTissAuthorizationFeedback({ type: "error", message: "Informe uma quantidade autorizada maior que zero." });
      return;
    }
    setPatientTissAuthorizationFeedback({ type: "saving", message: "Salvando..." });
    const payload = {
      id: editingPatientTissAuthorizationId || undefined,
      patientId: editingPatientId,
      payerId: selectedPatientInsurancePayer.id,
      serviceCatalogId: configuration.mapping?.serviceCatalogId,
      payerTussMappingId: configuration.mapping?.id,
      tussCodeId: configuration.mapping?.tussCodeId,
      authorizationNumber: patientTissAuthorizationForm.authorizationNumber.trim(),
      guideNumber: patientTissAuthorizationForm.guideNumber.trim() || null,
      validFrom: patientTissAuthorizationForm.validFrom,
      validUntil: patientTissAuthorizationForm.validUntil,
      authorizedQuantity: quantity,
      authorizedUnit: patientTissAuthorizationForm.authorizedUnit || configuration.mapping?.billingUnit || "sessions",
      usedQuantity: Number(patientTissAuthorizationForm.usedQuantity || 0) || 0,
      status: patientTissAuthorizationForm.status === "cancelled" ? "cancelled" : "active",
      active: patientTissAuthorizationForm.status !== "cancelled",
      notes: patientTissAuthorizationForm.notes.trim() || null,
    };
    const result = await dataService.upsertPatientPayerAuthorization(payload);
    if (!result?.success) {
      setPatientTissAuthorizationFeedback({ type: "error", message: result?.error || "Não foi possível salvar a autorização." });
      return;
    }
    setPatientTissAuthorizationFeedback({ type: "success", message: "✓ Salvo" });
    await loadPatientTissAuthorizations(editingPatientId);
    window.setTimeout(() => {
      setPatientTissAuthorizationFormOpen(false);
      resetPatientTissAuthorizationForm();
    }, 500);
  };

  const setPatientTissAuthorizationActive = async (authorization: any, active: boolean) => {
    if (!editingPatientId) return;
    const result = await dataService.setPatientTissAuthorizationActive(editingPatientId, authorization.id, active);
    if (!result?.success) {
      showToast(result?.error || "Não foi possível atualizar a autorização.", "error");
      return;
    }
    await loadPatientTissAuthorizations(editingPatientId);
    showToast(active ? "Autorização reativada." : "Autorização inativada.");
  };

  const deletePatientTissAuthorization = async (authorization: any) => {
    if (!editingPatientId || !authorization?.id) return;
    const confirmed = window.confirm("Excluir esta autorização TISS? Se ela já foi usada em Pré-guia ou XML, a exclusão será bloqueada.");
    if (!confirmed) return;
    const result = await dataService.deletePatientTissAuthorization(editingPatientId, authorization.id);
    if (!result?.success) {
      showToast(result?.error || "Esta autorização não pode ser excluída. Inative para preservar o histórico.", "error");
      return;
    }
    setPatientTissAuthorizations((current) => current.filter((item) => String(item.id) !== String(authorization.id)));
    showToast("Autorização excluída.");
  };

  const renderPatientTissAuthorizationCard = (authorization: any, options: { compact?: boolean } = {}) => {
    const visualState = getPatientTissAuthorizationVisualState(authorization);
    const authorized = Number(authorization?.authorizedQuantity || 0) || 0;
    const used = Number(authorization?.usedQuantity || 0) || 0;
    const balance = formatPatientAuthorizationBalance(authorization);
    return (
      <div key={authorization.id || `${authorization.authorizationNumber}-${authorization.validFrom}-${authorization.validUntil}`} className={`rounded-2xl border border-slate-100 bg-white p-4 shadow-sm ${options.compact ? "opacity-90" : ""}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">{authorization.serviceName || "Procedimento faturável"}</p>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ring-1 ${patientAuthorizationStatusClass(authorization)}`}>
                {visualState.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Convênio: {authorization.payerName || newPatientForm.convenioNome || "Não informado"}</p>
            <p className="mt-1 text-xs text-slate-600">
              TUSS {authorization.tussCode || "não informado"} · {formatPatientAuthorizationAmount(authorization.amountCents)}
            </p>
            {visualState.isLegacyOrInadequate && (
              <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                <p>{visualState.legacyReason || "Este código TUSS parece legado ou inadequado para o XML atual."}</p>
                <p className="mt-1 font-black">
                  De/Para ativo esperado: {visualState.expectedTussCode || ABA_INDIVIDUAL_EXPECTED_TUSS_CODE} — {visualState.expectedTussDescription || ABA_INDIVIDUAL_EXPECTED_TUSS_DESCRIPTION}.
                </p>
              </div>
            )}
            <div className="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
              <span>Autorização/Senha: {authorization.authorizationNumber || authorization.authorizationCode || "-"}</span>
              <span>Guia: {authorization.guideNumber || "-"}</span>
              <span>Validade: {formatPatientAuthorizationDate(authorization.validFrom)} a {formatPatientAuthorizationDate(authorization.validUntil)}</span>
              <span>Consumo: {used} de {authorized || "sem limite"} {authorization.authorizedUnit || "sessões"}</span>
              <span>Saldo: {balance}</span>
              {authorization.preGuideCount ? <span>Usado em Pré-guia TISS: {authorization.preGuideCount}</span> : <span>Pré-guia TISS: ainda não usada</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => editPatientTissAuthorization(authorization)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-600">Editar</button>
            {authorization.active === false ? (
              <button type="button" onClick={() => void setPatientTissAuthorizationActive(authorization, true)} className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-normal text-emerald-700">Reativar</button>
            ) : (
              <button type="button" onClick={() => void setPatientTissAuthorizationActive(authorization, false)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-600">Inativar</button>
            )}
            <button type="button" onClick={() => void deletePatientTissAuthorization(authorization)} className="rounded-xl border border-rose-100 px-3 py-2 text-xs font-normal text-rose-700">Excluir</button>
          </div>
        </div>
      </div>
    );
  };

  const scrollToPatientTissAuthorizations = () => {
    setActivePatientRegistrationTab("tiss");
    window.setTimeout(() => {
      document.getElementById("patient-tiss-authorizations-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const goToNewPatientTissAuthorization = () => {
    setActivePatientRegistrationTab("tiss");
    window.setTimeout(() => {
      openNewPatientTissAuthorizationForm();
      document.getElementById("patient-tiss-authorizations-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  useEffect(() => {
    const fetchFinancialData = async () => {
      if (!canAccessClinicFinance && !isReceptionist) return;
      const paymentsResult = await dataService.getPayments();
      if (paymentsResult.success) setPayments(paymentsResult.data || []);
      if (canAccessClinicFinance) {
        const [professionalResult, entriesResult] = await Promise.all([
          dataService.getProfessionalPayments(),
          dataService.getClinicFinancialEntries(),
        ]);
        if (professionalResult.success) setProfessionalPayments(professionalResult.data || []);
        if (entriesResult.success) setFinancialEntries(entriesResult.data || []);
      }
    };
    if (activeTab === "financial" && (canAccessClinicFinance || isReceptionist)) {
      fetchFinancialData();
    }
  }, [activeTab, canAccessClinicFinance, isReceptionist]);

  useEffect(() => {
    if (!isPatientRegistrationModalOpen || !canAccessClinicFinance) return;
    if (clinicPayers.length > 0) return;
    let cancelled = false;
    dataService.getPayers({ status: "ACTIVE", limit: 80 }).then((result: any) => {
      if (cancelled) return;
      if (result?.success) setClinicPayers(Array.isArray(result.data) ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [canAccessClinicFinance, clinicPayers.length, isPatientRegistrationModalOpen]);

  useEffect(() => {
    if (!["conference", "patientAuthorizations", "payers"].includes(activeTab) || isTherapist || clinicPayers.length > 0) return;
    let cancelled = false;
    dataService.getPayers({ status: "ACTIVE", limit: 80 }).then((result: any) => {
      if (!cancelled && result?.success) setClinicPayers(Array.isArray(result.data) ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, clinicPayers.length, isTherapist]);

  useEffect(() => {
    if (!isPatientRegistrationModalOpen || !canAccessClinicFinance) return;
    if (!selectedPatientInsurancePayer?.id) {
      setPatientTissAuthorizationCatalog({ services: [], codes: [], mappings: [], prices: [] });
      return;
    }
    void loadPatientTissAuthorizationCatalog(selectedPatientInsurancePayer.id);
  }, [canAccessClinicFinance, isPatientRegistrationModalOpen, selectedPatientInsurancePayer?.id]);

  useEffect(() => {
    if (!isPatientRegistrationModalOpen || !canAccessClinicFinance) return;
    if (!editingPatientId) {
      setPatientTissAuthorizations([]);
      resetPatientTissAuthorizationForm();
      return;
    }
    void loadPatientTissAuthorizations(editingPatientId);
  }, [canAccessClinicFinance, editingPatientId, isPatientRegistrationModalOpen]);

  useEffect(() => {
    const nextProfileMetadata = (
      user?.professionalProfile?.metadata ||
      user?.professional_profile?.metadata ||
      user?.professionalMetadata ||
      {}
    ) as Record<string, any>;
    const nextDocumentType = String(
      user?.professionalProfile?.documentType ||
        user?.professional_profile?.document_type ||
        nextProfileMetadata?.documentType ||
        nextProfileMetadata?.document_type ||
        "CPF",
    ).toUpperCase();
    setTherapistCrp(String(user?.crp || ""));
    setTherapistDocumentType(nextDocumentType);
    setTherapistCpf(formatDocument(String(user?.cpf || nextProfileMetadata?.cpf || nextProfileMetadata?.professionalCpf || ""), nextDocumentType));
    setTherapistPhone(formatPhoneInput(String(user?.phone || user?.whatsappPhone || nextProfileMetadata?.phone || nextProfileMetadata?.professionalPhone || "")));
    setTherapistEmail(String(user?.email || nextProfileMetadata?.email || nextProfileMetadata?.professionalEmail || ""));
    setTherapistRoleTitle(String(user?.professionalRoleTitle || nextProfileMetadata?.roleTitle || nextProfileMetadata?.professionalRoleTitle || ""));
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
    setTherapistCouncilType(
      String(user?.professionalProfile?.council || user?.professional_profile?.council || nextProfileMetadata?.council || nextProfileMetadata?.councilType || ""),
    );
    setTherapistCouncilState(
      String(user?.professionalProfile?.councilState || user?.professional_profile?.council_state || nextProfileMetadata?.councilState || nextProfileMetadata?.council_state || "").toUpperCase().slice(0, 2),
    );
    setTherapistCboCode(onlyDigits(user?.professionalProfile?.cboCode || user?.professional_profile?.cbo_code || nextProfileMetadata?.cboCode || nextProfileMetadata?.cbo_code || "", 12));
    setTherapistSpecialtyName(
      String(user?.professionalProfile?.specialtyName || user?.professional_profile?.specialty_name || nextProfileMetadata?.specialtyName || nextProfileMetadata?.specialty_name || ""),
    );
    setTherapistProviderCode(
      String(user?.professionalProfile?.providerCode || user?.professional_profile?.provider_code || nextProfileMetadata?.providerCode || nextProfileMetadata?.provider_code || ""),
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
    const nextClinicDocumentType = String(user?.clinicSettings?.clinicDocumentType || user?.clinicSettings?.documentType || "CNPJ").toUpperCase();
    setClinicDocumentType(nextClinicDocumentType);
    setClinicCnpj(formatDocument(String(user?.clinicSettings?.clinicDocumentNumber || user?.clinicSettings?.clinicCnpj || ""), nextClinicDocumentType));
    setClinicLegalName(String(user?.clinicSettings?.clinicLegalName || user?.clinicSettings?.legalName || ""));
    setClinicCnesCode(onlyDigits(user?.clinicSettings?.clinicCnesCode || user?.clinicSettings?.cnesCode || "", 12));
    setClinicProviderCode(String(user?.clinicSettings?.clinicProviderCode || user?.clinicSettings?.providerCode || ""));
    setClinicDisplayName(String(user?.clinicSettings?.clinicName || user?.workspaceName || ""));
    setClinicPhone(formatPhoneInput(String(user?.clinicSettings?.clinicPhone || "")));
    setClinicWhatsapp(formatPhoneInput(String(user?.clinicSettings?.clinicWhatsapp || user?.clinicSettings?.whatsapp || "")));
    setClinicEmail(String(user?.clinicSettings?.clinicEmail || ""));
    setClinicSite(String(user?.clinicSettings?.clinicSite || user?.clinicSettings?.site || ""));
    setClinicAddress(String(user?.clinicSettings?.clinicAddress || ""));
    setClinicAddressLine(String(user?.clinicSettings?.clinicAddressLine || user?.clinicSettings?.addressLine || user?.clinicSettings?.clinicAddress || ""));
    setClinicAddressNumber(String(user?.clinicSettings?.clinicAddressNumber || user?.clinicSettings?.addressNumber || ""));
    setClinicAddressComplement(String(user?.clinicSettings?.clinicAddressComplement || user?.clinicSettings?.addressComplement || ""));
    setClinicDistrict(String(user?.clinicSettings?.clinicDistrict || user?.clinicSettings?.district || ""));
    setClinicCity(String(user?.clinicSettings?.clinicCity || user?.clinicSettings?.city || ""));
    setClinicStateUf(String(user?.clinicSettings?.clinicState || user?.clinicSettings?.state || "").toUpperCase().slice(0, 2));
    setClinicPostalCode(maskCep(String(user?.clinicSettings?.clinicPostalCode || user?.clinicSettings?.postalCode || "")));
  }, [
    user?.crp,
    user?.cpf,
    user?.phone,
    user?.whatsappPhone,
    user?.email,
    user?.professionalRoleTitle,
    user?.professionalProfile,
    user?.professional_profile,
    user?.professionalMetadata,
    user?.professionalProfile?.documentType,
    user?.professional_profile?.document_type,
    user?.professionalProfile?.providerCode,
    user?.professional_profile?.provider_code,
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
    user?.clinicSettings?.clinicDocumentNumber,
    user?.clinicSettings?.clinicDocumentType,
    user?.clinicSettings?.documentType,
    user?.clinicSettings?.clinicLegalName,
    user?.clinicSettings?.legalName,
    user?.clinicSettings?.clinicCnesCode,
    user?.clinicSettings?.cnesCode,
    user?.clinicSettings?.clinicProviderCode,
    user?.clinicSettings?.providerCode,
    user?.clinicSettings?.clinicName,
    user?.clinicSettings?.clinicPhone,
    user?.clinicSettings?.clinicWhatsapp,
    user?.clinicSettings?.whatsapp,
    user?.clinicSettings?.clinicEmail,
    user?.clinicSettings?.clinicSite,
    user?.clinicSettings?.site,
    user?.clinicSettings?.clinicAddress,
    user?.clinicSettings?.clinicAddressLine,
    user?.clinicSettings?.addressLine,
    user?.clinicSettings?.clinicAddressNumber,
    user?.clinicSettings?.addressNumber,
    user?.clinicSettings?.clinicAddressComplement,
    user?.clinicSettings?.addressComplement,
    user?.clinicSettings?.clinicDistrict,
    user?.clinicSettings?.district,
    user?.clinicSettings?.clinicCity,
    user?.clinicSettings?.city,
    user?.clinicSettings?.clinicState,
    user?.clinicSettings?.state,
    user?.clinicSettings?.clinicPostalCode,
    user?.clinicSettings?.postalCode,
    user?.workspaceName,
  ]);

  useEffect(() => {
    if (activeTab !== "settings" || !isTherapist) return;
    const professionalId = String(user?.id || "").trim();
    if (!professionalId) return;
    let cancelled = false;
    const loadOwnBillingProfile = async () => {
      const result = await dataService.getOwnProfessionalBillingProfile();
      if (cancelled || !result?.success || !result.data) return;
      const profile = result.data || {};
      const documentType = String(profile.document_type || profile.documentType || "CPF").toUpperCase();
      setTherapistDocumentType(documentType);
      setTherapistCpf(formatDocument(profile.document_number || profile.documentNumber || "", documentType));
      setTherapistFullName(String(profile.display_name || profile.displayName || user?.name || ""));
      setTherapistCouncilType(String(profile.council_type || profile.councilType || ""));
      setTherapistCrp(String(profile.council_number || profile.councilNumber || ""));
      setTherapistCouncilState(String(profile.council_state || profile.councilState || "").toUpperCase().slice(0, 2));
      setTherapistCboCode(onlyDigits(profile.cbo_code || profile.cboCode || "", 12));
      setTherapistSpecialtyName(String(profile.specialty_name || profile.specialtyName || ""));
      setTherapistProviderCode(String(profile.provider_code || profile.providerCode || ""));
    };
    void loadOwnBillingProfile();
    return () => {
      cancelled = true;
    };
  }, [activeTab, isTherapist, user?.id, user?.name]);

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
    setProfessionalPaymentAdjustmentReason(String(payment?.adjustment_reason || payment?.adjustmentReason || payment?.notes || ""));
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
    if (additionalAmount > 0 && professionalPaymentAdjustmentReason.trim().length < 3) {
      showToast("Informe o motivo do ajuste manual do repasse.", "error");
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
        adjustment_reason: additionalAmount > 0 ? professionalPaymentAdjustmentReason.trim() : null,
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
      setProfessionalPaymentAdjustmentReason("");
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
        adjustment_reason: shouldApplyAdditional && additionalAmount > 0 ? professionalPaymentAdjustmentReason.trim() : null,
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
      setProfessionalPaymentAdjustmentReason("");
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
      return "Pacientes ativos";
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

  const isPreferredPatientInsurancePlan = (plan: any, rawPlan: any = {}) => {
    const preferredValues = [
      plan?.isPrimary,
      plan?.is_primary,
      plan?.primary,
      plan?.isCurrent,
      plan?.is_current,
      plan?.current,
      plan?.isDefault,
      plan?.is_default,
      plan?.default,
      plan?.preferred,
      plan?.principal,
      plan?.isPrimaryInsurance,
      plan?.is_primary_insurance,
      rawPlan?.isPrimary,
      rawPlan?.is_primary,
      rawPlan?.primary,
      rawPlan?.isCurrent,
      rawPlan?.is_current,
      rawPlan?.current,
      rawPlan?.isDefault,
      rawPlan?.is_default,
      rawPlan?.default,
      rawPlan?.preferred,
      rawPlan?.principal,
      rawPlan?.isPrimaryInsurance,
      rawPlan?.is_primary_insurance,
    ];
    return preferredValues.some((value) => value === true || value === "true" || value === 1 || value === "1");
  };

  const emptyPatientInsurancePayer = () => ({
    payerId: "",
    payerName: "",
    insurancePlanName: "",
    insuranceCardNumber: "",
    insuranceHolderName: "",
    insuranceCardValidUntil: "",
  });

  const resolvePatientInsurancePayer = (patient: any, serviceType: any = "") => {
    if (!patient) {
      return emptyPatientInsurancePayer();
    }
    const insuranceEligibility = normalizePatientInsuranceEligibility(patient);
    const rawPlans = Array.isArray(patient?.financialPlans)
      ? patient.financialPlans
      : Array.isArray(patient?.financial_plans)
        ? patient.financial_plans
        : [];
    const plans = normalizePatientFinancialPlans(rawPlans);
    const insurancePlans = plans.filter(
      (plan: any) =>
        plan?.billingMode === "INSURANCE" &&
        String(plan?.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
        (String(plan?.payerId || "").trim() ||
          String(plan?.payerNameSnapshot || "").trim()),
    );
    const preferredInsurancePlans = insurancePlans.filter((plan: any) => {
      const rawIndex = plans.findIndex((item: any) => String(item?.id || "") === String(plan?.id || ""));
      return isPreferredPatientInsurancePlan(plan, rawIndex >= 0 ? rawPlans[rawIndex] : {});
    });
    const matchingPlans = serviceType
      ? insurancePlans.filter((plan: any) => financialPlanMatchesAppointmentService(plan, serviceType))
      : [];
    const preferredMatchingPlans = matchingPlans.filter((plan: any) => preferredInsurancePlans.some((preferred: any) => String(preferred?.id || "") === String(plan?.id || "")));
    const insurancePlan =
      preferredMatchingPlans.length === 1
        ? preferredMatchingPlans[0]
        : matchingPlans.length === 1
        ? matchingPlans[0]
        : preferredInsurancePlans.length === 1
          ? preferredInsurancePlans[0]
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
      const eligibilityPayerName = normalizeUtf8Text(String(insuranceEligibility.insuranceName || "")).trim();
      const eligibilityMatchesPlan =
        !eligibilityPayerName ||
        !planPayerName ||
        normalizePayerLookup(eligibilityPayerName) === normalizePayerLookup(planPayerName);
      return {
        payerId: planPayerId,
        payerName: planPayerName,
        insurancePlanName: String(
          insurancePlan?.insurancePlanName ||
            (eligibilityMatchesPlan ? insuranceEligibility.insurancePlanCategory : "") ||
            "",
        ).trim(),
        insuranceCardNumber: String(
          insurancePlan?.insuranceCardNumber ||
            (eligibilityMatchesPlan ? insuranceEligibility.insuranceCardNumber : "") ||
            "",
        ).trim(),
        insuranceHolderName: String(
          insurancePlan?.insuranceCardHolder ||
            (eligibilityMatchesPlan ? insuranceEligibility.insuranceHolderName : "") ||
            "",
        ).trim(),
        insuranceCardValidUntil: String(
          insurancePlan?.insuranceCardValidUntil ||
            (eligibilityMatchesPlan ? insuranceEligibility.insuranceCardValidUntil : "") ||
            "",
        ).trim(),
      };
    }

    if (insurancePlans.length > 0) {
      return emptyPatientInsurancePayer();
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
      return emptyPatientInsurancePayer();
    }
    return {
      payerId: "",
      payerName: insuranceName,
      insurancePlanName: String(insuranceEligibility.insurancePlanCategory || "").trim(),
      insuranceCardNumber: String(insuranceEligibility.insuranceCardNumber || "").trim(),
      insuranceHolderName: String(insuranceEligibility.insuranceHolderName || "").trim(),
      insuranceCardValidUntil: String(insuranceEligibility.insuranceCardValidUntil || "").trim(),
    };
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

  const findSessionPatientByName = useCallback((name: string) => {
    const normalizedName = normalizeUtf8Text(name).trim().toLowerCase();
    if (!normalizedName) return null;
    return (
      allPatients.find(
        (item: any) => normalizeUtf8Text(item?.name).trim().toLowerCase() === normalizedName,
      ) || null
    );
  }, [allPatients]);

  const findProfessionalOptionById = useCallback((professionalId: any) => {
    const targetId = String(professionalId || "").trim();
    if (!targetId) return null;
    return (
      therapistFilterOptions.find((member) => String(member.id || "") === targetId) ||
      therapistFilterOptions.find(
        (member) =>
          Array.isArray((member as any).matchIds) &&
          (member as any).matchIds.some((candidateId: any) => String(candidateId || "").trim() === targetId),
      ) ||
      null
    );
  }, [therapistFilterOptions]);

  const selectPatientForSession = (name: string) => {
    const patient = findSessionPatientByName(name);
    const responsibleProfessionalId = resolvePatientResponsibleProfessionalId(patient);
    const responsibleProfessional = findProfessionalOptionById(responsibleProfessionalId);
    const patientPayer = resolvePatientInsurancePayer(patient, sessionApproach);
    const matchingPayer = resolveClinicPayerForPatientInsurance(patientPayer);
    lastAutoPayerPatientKeyRef.current = getPatientAutoPayerKey(patient, name);
    setSessionPatientName(name);
    setSessionProfessionalManuallySelected(false);
    setSessionProfessionalId(responsibleProfessional?.id ? String(responsibleProfessional.id) : "");
    setSessionProfessional(responsibleProfessional?.label || "");
    if (matchingPayer?.id || patientPayer.payerId) setSessionFinancialContextType("INSURANCE");
    setSessionPayerId(String(matchingPayer?.id || patientPayer.payerId || ""));
    setSessionPayerNameSnapshot(String(matchingPayer?.name || patientPayer.payerName || ""));
    setSessionInsurancePlanName(String(patientPayer.insurancePlanName || ""));
    setSessionInsuranceCardNumber(String(patientPayer.insuranceCardNumber || ""));
    setSessionInsuranceHolderName(String(patientPayer.insuranceHolderName || ""));
    setSessionInsuranceCardValidUntil(String(patientPayer.insuranceCardValidUntil || ""));
    setSessionGuideNumber("");
    setSessionAuthorizationCode("");
    setSessionPatientTissAuthorizationId("");
    setSessionBillingSuggestionState({ loading: false, error: "", suggestion: null });
    setFilteredPatients([]);
  };

  const handleSessionPatientNameChange = (value: string) => {
    setSessionPatientName(value);
    setSessionProfessionalManuallySelected(false);
    const patient = findSessionPatientByName(value);
    if (patient) return;
    setSessionProfessionalId("");
    setSessionProfessional("");
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

  const selectedSessionPatientResponsibleProfessionalId = useMemo(
    () => resolvePatientResponsibleProfessionalId(selectedSessionPatient),
    [selectedSessionPatient],
  );

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
      findProfessionalOptionById(sessionProfessionalId) ||
      therapistFilterOptions.find((member) => String(member.id || "") === normalizedName) ||
      therapistFilterOptions.find((member) => member.label === normalizedName) ||
      null
    );
  }, [findProfessionalOptionById, sessionProfessional, sessionProfessionalId, therapistFilterOptions]);

  useEffect(() => {
    if (!isAddSessionModalOpen || editingAppointmentId || !selectedSessionPatient) return;
    if (!selectedSessionPatientResponsibleProfessionalId) return;
    const responsibleProfessional = findProfessionalOptionById(selectedSessionPatientResponsibleProfessionalId);
    if (!responsibleProfessional?.id) return;
    if (sessionProfessionalManuallySelected && selectedSessionProfessional?.id) return;
    if (String(sessionProfessionalId || "") !== String(responsibleProfessional.id)) {
      setSessionProfessionalId(String(responsibleProfessional.id));
      setSessionProfessional(responsibleProfessional.label || "");
    }
  }, [
    editingAppointmentId,
    findProfessionalOptionById,
    isAddSessionModalOpen,
    selectedSessionPatient,
    selectedSessionPatientResponsibleProfessionalId,
    selectedSessionProfessional?.id,
    sessionProfessionalId,
    sessionProfessionalManuallySelected,
    therapistFilterOptions,
  ]);

  const selectedSessionPatientResponsibleProfessionalOption = selectedSessionPatientResponsibleProfessionalId
    ? findProfessionalOptionById(selectedSessionPatientResponsibleProfessionalId)
    : null;

  const sessionProfessionalNotice = selectedSessionPatient
    ? !selectedSessionPatientResponsibleProfessionalId
      ? "Este paciente ainda não possui profissional responsável atribuído. Selecione um profissional para esta consulta ou defina no prontuário."
      : !selectedSessionPatientResponsibleProfessionalOption
        ? "O profissional responsável deste paciente não está disponível na lista da clínica. Revise o cadastro da equipe antes de agendar."
        : ""
    : "";

  const sessionBufferMinutes = useMemo(() => {
    const schedule = selectedSessionProfessional?.workSchedule || selectedSessionProfessional?.work_schedule || {};
    const raw = schedule?.sessionBufferMinutes ?? schedule?.session_buffer_minutes ?? 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.min(120, Math.max(0, Math.round(parsed))) : 0;
  }, [selectedSessionProfessional]);
  useEffect(() => {
    if (!selectedSessionProfessional?.id || !selectedSessionProfessional?.label) return;
    if (sessionProfessionalId !== String(selectedSessionProfessional.id)) {
      setSessionProfessionalId(String(selectedSessionProfessional.id));
    }
    if (sessionProfessional !== selectedSessionProfessional.label) {
      setSessionProfessional(selectedSessionProfessional.label);
    }
  }, [
    selectedSessionProfessional?.id,
    selectedSessionProfessional?.label,
    sessionProfessional,
    sessionProfessionalId,
  ]);

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
    setSessionFinancialContextType("INSURANCE");
    if (value === SESSION_PATIENT_INSURANCE_PAYER_VALUE) {
      setSessionPayerId("");
      setSessionPayerNameSnapshot(sessionPayerSnapshotOptionLabel);
      setSessionInsurancePlanName(selectedSessionPatientInsurancePayer.insurancePlanName || "");
      setSessionInsuranceCardNumber(selectedSessionPatientInsurancePayer.insuranceCardNumber || "");
      setSessionInsuranceHolderName(selectedSessionPatientInsurancePayer.insuranceHolderName || "");
      setSessionInsuranceCardValidUntil(selectedSessionPatientInsurancePayer.insuranceCardValidUntil || "");
      setSessionGuideNumber("");
      setSessionAuthorizationCode("");
      setSessionPatientTissAuthorizationId("");
      setSessionBillingSuggestionState({ loading: false, error: "", suggestion: null });
      return;
    }
    const payer = clinicPayers.find((item: any) => String(item?.id || "") === String(value || ""));
    setSessionPayerId(value);
    setSessionPayerNameSnapshot(payer?.name || "");
    const payerMatchesPatient =
      Boolean(value) &&
      (String(selectedSessionPatientInsuranceClinicPayer?.id || "") === String(value) ||
        normalizePayerLookup(payer?.name) ===
          normalizePayerLookup(selectedSessionPatientInsurancePayer.payerName));
    setSessionInsurancePlanName(
      payerMatchesPatient ? selectedSessionPatientInsurancePayer.insurancePlanName || "" : "",
    );
    setSessionInsuranceCardNumber(
      payerMatchesPatient ? selectedSessionPatientInsurancePayer.insuranceCardNumber || "" : "",
    );
    setSessionInsuranceHolderName(
      payerMatchesPatient ? selectedSessionPatientInsurancePayer.insuranceHolderName || "" : "",
    );
    setSessionInsuranceCardValidUntil(
      payerMatchesPatient ? selectedSessionPatientInsurancePayer.insuranceCardValidUntil || "" : "",
    );
    setSessionGuideNumber("");
    setSessionAuthorizationCode("");
    setSessionPatientTissAuthorizationId("");
    setSessionBillingSuggestionState({ loading: false, error: "", suggestion: null });
  };

  const sessionBillingSuggestion = sessionBillingSuggestionState.suggestion || null;
  const sessionAvailableTissAuthorizations = useMemo(() => {
    const fromSuggestion = Array.isArray(sessionBillingSuggestion?.availableTissAuthorizations)
      ? sessionBillingSuggestion.availableTissAuthorizations
      : Array.isArray(sessionBillingSuggestion?.available_tiss_authorizations)
        ? sessionBillingSuggestion.available_tiss_authorizations
        : [];
    return fromSuggestion;
  }, [sessionBillingSuggestion]);
  const sessionUnavailableTissAuthorizations = useMemo(() => {
    const explicit = Array.isArray(sessionBillingSuggestion?.unavailableTissAuthorizations)
      ? sessionBillingSuggestion.unavailableTissAuthorizations
      : Array.isArray(sessionBillingSuggestion?.unavailable_tiss_authorizations)
        ? sessionBillingSuggestion.unavailable_tiss_authorizations
        : null;
    if (explicit) return explicit;
    return sessionAvailableTissAuthorizations.filter((authorization: any) =>
      !Boolean(authorization?.canUseForAppointment || authorization?.isEligibleForAppointment) ||
      !hasConfirmedPatientTissAuthorizationBalance(authorization)
    );
  }, [sessionAvailableTissAuthorizations, sessionBillingSuggestion]);
  const sessionUsableTissAuthorizations = useMemo(
    () => sessionAvailableTissAuthorizations.filter((authorization: any) =>
      Boolean(authorization?.canUseForAppointment || authorization?.isEligibleForAppointment) &&
      hasConfirmedPatientTissAuthorizationBalance(authorization)
    ),
    [sessionAvailableTissAuthorizations],
  );
  const sessionAuthorizationUnavailableInsight = useMemo(() => {
    const payerName = selectedSessionPayerName || "este convênio";
    const reasons = sessionUnavailableTissAuthorizations
      .map((authorization: any) =>
        normalizeUtf8Text(
          authorization?.unavailableReason ||
            authorization?.availabilityLabel ||
            authorization?.status ||
            "",
        ).toLowerCase(),
      )
      .filter(Boolean);
    const hasOtherPayer = reasons.some((reason: string) => reason.includes("convênio") || reason.includes("convenio") || reason.includes("pagador"));
    const hasExpired = reasons.some((reason: string) => reason.includes("venc") || reason.includes("validade"));
    const hasTussMismatch = reasons.some((reason: string) => reason.includes("tuss") || reason.includes("procedimento"));
    const hasNoBalance = reasons.some((reason: string) => reason.includes("saldo") || reason.includes("quantidade"));
    return {
      title: `Nenhuma autorização utilizável para ${payerName} nesta data.`,
      detail: hasOtherPayer
        ? `Há autorizações cadastradas para outro convênio, mas nenhuma compatível com ${payerName}.`
        : hasExpired
          ? "Há autorização cadastrada, mas fora da validade da sessão."
          : hasTussMismatch
            ? "Há autorização cadastrada, mas o procedimento/TUSS não é compatível com esta sessão."
            : hasNoBalance
              ? "Há autorização cadastrada, mas sem saldo disponível para esta consulta."
              : "Verifique autorização ativa, validade, saldo, TUSS/procedimento e convênio correto.",
    };
  }, [selectedSessionPayerName, sessionUnavailableTissAuthorizations]);
  const sessionModalLabelClass = "block text-xs font-medium text-slate-500 mb-1";
  const sessionModalInputClass = "w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm font-medium text-slate-700 outline-none focus:border-violet-200 focus:ring-2 focus:ring-violet-100";
  const sessionModalSelectClass = sessionModalInputClass;
  const sessionModalSectionLabelClass = "text-sm font-semibold text-slate-800";
  const formatSessionReadonlyValue = (value: any) => {
    const text = normalizeUtf8Text(String(value || "")).trim();
    return text || "não cadastrado";
  };
  const formatSessionReadonlyDate = (value: any) => {
    const text = String(value || "").trim();
    if (!text) return "não cadastrada";
    const datePart = text.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [year, month, day] = datePart.split("-");
      return `${day}/${month}/${year}`;
    }
    return normalizeUtf8Text(text);
  };
  const getSessionAuthorizationBalanceParts = (authorization: any) => {
    const summary = getPatientTissAuthorizationQuantitySummary(authorization);
    return {
      authorized: summary.authorized,
      consumed: summary.consumed,
      reserved: summary.reserved,
      available: summary.available,
      confirmed: hasConfirmedPatientTissAuthorizationBalance(authorization),
    };
  };
  const applySessionTissAuthorization = (authorization: any) => {
    if (!authorization) return;
    if (!hasConfirmedPatientTissAuthorizationBalance(authorization)) {
      setSessionBillingSuggestionState((prev) => ({
        ...prev,
        error: "Não foi possível confirmar o saldo desta autorização. Atualize os dados antes de aplicá-la.",
      }));
      return;
    }
    setSessionGuideNumber(String(authorization?.guideNumber || ""));
    setSessionAuthorizationCode(String(authorization?.authorizationCode || authorization?.authorizationNumber || ""));
    setSessionPatientTissAuthorizationId(String(authorization?.authorizationId || authorization?.patientTissAuthorizationId || ""));
  };
  const renderSessionTissAuthorizationCard = (authorization: any, options: { compact?: boolean; history?: boolean } = {}) => {
    const canUse = Boolean(authorization?.canUseForAppointment || authorization?.isEligibleForAppointment) &&
      hasConfirmedPatientTissAuthorizationBalance(authorization);
    const authorizationId = String(authorization?.authorizationId || authorization?.patientTissAuthorizationId || "");
    const isSelected = Boolean(authorizationId && authorizationId === sessionPatientTissAuthorizationId);
    const key = authorizationId || `${authorization?.guideNumber}-${authorization?.authorizationCode}-${authorization?.validFrom}-${authorization?.validUntil}`;
    const validity = [authorization?.validFrom, authorization?.validUntil]
      .filter(Boolean)
      .map((value: string) => String(value).slice(0, 10).split("-").reverse().join("/"))
      .join(" a ");
    const balance = getSessionAuthorizationBalanceParts(authorization);
    return (
      <div
        key={key}
        className={`rounded-xl border px-3 py-2 ${
          canUse
            ? isSelected
              ? "border-emerald-300 bg-emerald-100"
              : "border-emerald-200 bg-emerald-50"
            : "border-slate-100 bg-slate-50"
        }`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={`text-xs font-semibold ${canUse ? "text-emerald-800" : "text-slate-700"}`}>
              Guia {authorization?.guideNumber || "sem guia"} · Senha {authorization?.authorizationCode || authorization?.authorizationNumber || "sem senha"}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              {authorization?.procedureName || authorization?.tussDescription || "Procedimento"} {authorization?.tussCode ? `· TUSS ${authorization.tussCode}` : ""}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">
              {canUse ? "Utilizável para esta consulta" : authorization?.availabilityLabel || authorization?.status || "Status não informado"}
              {validity ? ` · Validade ${validity}` : ""}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-medium text-slate-500 sm:grid-cols-4">
              <span>Disponíveis: {balance.confirmed ? balance.available ?? "sem limite" : "não confirmado"}</span>
              <span>Reservadas: {balance.confirmed ? balance.reserved : "não confirmado"}</span>
              <span>Consumidas: {balance.consumed}</span>
              <span>Autorizadas: {balance.authorized || "sem limite"}</span>
            </div>
            {!canUse && authorization?.unavailableReason && (
              <p className="mt-1 text-[11px] font-medium text-amber-700">Motivo: {authorization.unavailableReason}</p>
            )}
          </div>
          {canUse && !options.history && (
            <button
              type="button"
              onClick={() => applySessionTissAuthorization(authorization)}
              className={`rounded-xl px-3 py-2 text-[11px] font-semibold ${isSelected ? "bg-emerald-700 text-white" : "bg-emerald-600 text-white"}`}
            >
              {isSelected ? "Selecionada" : "Usar esta autorização"}
            </button>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!isAddSessionModalOpen || isTherapist) return;
    const patientId = String(selectedSessionPatient?.id || "").trim();
    if (
      sessionFinancialContextType !== "INSURANCE" ||
      !patientId ||
      !sessionPayerId ||
      !sessionApproach ||
      !sessionDate
    ) {
      setSessionBillingSuggestionState({ loading: false, error: "", suggestion: null });
      setShowSessionUnavailableTissAuthorizations(false);
      return;
    }
    let cancelled = false;
    setSessionBillingSuggestionState({ loading: true, error: "", suggestion: null });
    setShowSessionUnavailableTissAuthorizations(false);
    dataService.getAppointmentBillingSuggestion({
      patientId,
      payerId: sessionPayerId,
      payerName: selectedSessionPayerName,
      serviceType: sessionApproach,
      appointmentDate: sessionDate,
      currentAppointmentId: editingAppointmentId || undefined,
    }).then((result: any) => {
      if (cancelled) return;
      if (!result?.success) {
        setSessionBillingSuggestionState({
          loading: false,
          error: result?.error || "Não foi possível carregar autorizações disponíveis.",
          suggestion: null,
        });
        return;
      }
      const suggestion = result.data?.suggestion || result.data || null;
      if (suggestion) {
        setSessionInsurancePlanName((current) => current || String(suggestion?.insurancePlanName || suggestion?.insurance_plan_name || ""));
        setSessionInsuranceCardNumber((current) => current || String(suggestion?.insuranceCardNumber || suggestion?.insurance_card_number || ""));
        setSessionInsuranceHolderName((current) => current || String(suggestion?.insuranceHolderName || suggestion?.insurance_holder_name || ""));
        setSessionInsuranceCardValidUntil((current) => current || String(suggestion?.insuranceCardValidUntil || suggestion?.insurance_card_valid_until || ""));
      }
      setSessionBillingSuggestionState({ loading: false, error: "", suggestion });
    }).catch(() => {
      if (!cancelled) {
        setSessionBillingSuggestionState({
          loading: false,
          error: "Não foi possível carregar autorizações disponíveis.",
          suggestion: null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    editingAppointmentId,
    isAddSessionModalOpen,
    isTherapist,
    selectedSessionPatient?.id,
    selectedSessionPayerName,
    sessionApproach,
    sessionDate,
    sessionFinancialContextType,
    sessionPayerId,
  ]);

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
      setSessionFinancialContextType("INSURANCE");
      setSessionPayerId(nextPayerId);
      setSessionPayerNameSnapshot(nextPayerName);
      setSessionInsurancePlanName(patientPayer.insurancePlanName || "");
      setSessionInsuranceCardNumber(patientPayer.insuranceCardNumber || "");
      setSessionInsuranceHolderName(patientPayer.insuranceHolderName || "");
      setSessionInsuranceCardValidUntil(patientPayer.insuranceCardValidUntil || "");
      return;
    }

    const currentSnapshotMatchesPatient =
      normalizePayerLookup(sessionPayerNameSnapshot) === normalizePayerLookup(patientPayer.payerName);
    if (!sessionPayerId && matchingPayer?.id && currentSnapshotMatchesPatient) {
      setSessionFinancialContextType("INSURANCE");
      setSessionPayerId(String(matchingPayer.id));
      setSessionPayerNameSnapshot(String(matchingPayer.name || patientPayer.payerName || ""));
      setSessionInsurancePlanName((current) => current || patientPayer.insurancePlanName || "");
      setSessionInsuranceCardNumber((current) => current || patientPayer.insuranceCardNumber || "");
      setSessionInsuranceHolderName((current) => current || patientPayer.insuranceHolderName || "");
      setSessionInsuranceCardValidUntil((current) => current || patientPayer.insuranceCardValidUntil || "");
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
      selectedSessionProfessional?.id &&
      sessionDurationMinutes >= 15 &&
      (sessionLocationType !== "clinica" || sessionRoom),
  );
  const selectedFinancialContextOption = APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS.find(
    (option) => option.value === sessionFinancialContextType,
  );
  const sessionNeedsFinancialContext = Boolean(sessionApproach.trim());
  const sessionFinancialContextError =
    !isTherapist && sessionNeedsFinancialContext && !sessionFinancialContextType
      ? APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE
      : !isTherapist && sessionNeedsFinancialContext && sessionFinancialContextType === "INSURANCE" && !sessionPayerId
        ? "Selecione um pagador/convênio cadastrado ou escolha outro contexto financeiro válido."
        : "";
  const canSubmitSession =
    requiredSessionFieldsReady &&
    !scheduleConflictState.blocking &&
    !scheduleConflictState.loading &&
    !isSessionSubmitting &&
    !sessionFinancialContextError;

  useEffect(() => {
    if (!isAddSessionModalOpen) return;
    if (!sessionPatientName || !sessionDate || !sessionTime || !sessionApproach || !selectedSessionProfessional?.id) {
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
      room_prevent_overlapping_appointments: selectedSessionRoom?.prevent_overlapping_appointments ?? selectedSessionRoom?.preventOverlappingAppointments,
      rooms,
      location_type: sessionLocationType,
      date: sessionDate,
      start_time: sessionTime,
      end_time: sessionEndTime,
      duration_minutes: sessionDurationMinutes,
      session_buffer_minutes: sessionBufferMinutes,
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
          room_prevent_overlapping_appointments:
            selectedSessionRoom?.prevent_overlapping_appointments ??
            selectedSessionRoom?.preventOverlappingAppointments,
          location_type: sessionLocationType,
          date: sessionDate,
          start_time: sessionTime,
          end_time: sessionEndTime,
          duration_minutes: sessionDurationMinutes,
          session_buffer_minutes: sessionBufferMinutes,
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
    setSessionProfessionalId("");
    setSessionProfessionalManuallySelected(false);
    setSessionFinancialContextType("INSURANCE");
    setSessionPayerId("");
    setSessionPayerNameSnapshot("");
    setSessionInsurancePlanName("");
    setSessionInsuranceCardNumber("");
    setSessionInsuranceHolderName("");
    setSessionInsuranceCardValidUntil("");
    setSessionGuideNumber("");
    setSessionAuthorizationCode("");
    setSessionPatientTissAuthorizationId("");
    setSessionBillingSuggestionState({ loading: false, error: "", suggestion: null });
    setSessionNumSessions(1);
    setSessionRecurrencePattern("weekly");
    setSessionApplyAuthorizationToRecurrence(true);
    setSessionReuseGuideAcrossRecurrence(false);
    setEditingAppointmentId(null);
    setEditingAppointmentActionRequest(null);
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
    const clickedDate = String(date || "").trim() || new Date().toISOString().split("T")[0];
    const clickedTime = String(time || "").trim();
    const normalizedClickedTime = /^\d{2}:\d{2}/.test(clickedTime)
      ? clickedTime.slice(0, 5)
      : "08:00";
    resetSessionForm();
    setSessionDate(clickedDate);
    setSessionTime(normalizedClickedTime);
    setIsDayDetailsModalOpen(false);
    setIsAddSessionModalOpen(true);
  };

  const handleSessionSubmit = async () => {
    if (!requiredSessionFieldsReady) {
      showToast("Preencha paciente, data, horário, duração, tipo, profissional e sala quando o local for clínica.", "error");
      return;
    }
    if (sessionFinancialContextError) {
      showToast(`${APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE} ${sessionFinancialContextError}`, "error");
      return;
    }
    if (scheduleConflictState.blocking) {
      showToast(scheduleConflictState.message || "Existe conflito bloqueante nesse horário.", "error");
      return;
    }
    if (sessionSubmitInFlightRef.current) return;
    sessionSubmitInFlightRef.current = true;
    setIsSessionSubmitting(true);
    const releaseSessionSubmit = () => {
      sessionSubmitInFlightRef.current = false;
      setIsSessionSubmitting(false);
    };
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
      releaseSessionSubmit();
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
        financialContextType: sessionFinancialContextType,
        financial_context_type: sessionFinancialContextType,
        billingContextType: sessionFinancialContextType,
        billing_context_type: sessionFinancialContextType,
        payerType: sessionFinancialContextType,
        payer_type: sessionFinancialContextType,
        payerId: sessionFinancialContextType === "INSURANCE" ? sessionPayerId || null : null,
        payer_id: sessionFinancialContextType === "INSURANCE" ? sessionPayerId || null : null,
        payerName: sessionFinancialContextType === "INSURANCE" ? selectedSessionPayerName : "",
        payer_name_snapshot: sessionFinancialContextType === "INSURANCE" ? selectedSessionPayerName : "",
        insurancePlanName: sessionFinancialContextType === "INSURANCE" ? sessionInsurancePlanName : "",
        insurance_plan_name: sessionFinancialContextType === "INSURANCE" ? sessionInsurancePlanName : "",
        insuranceCardNumber: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardNumber : "",
        insurance_card_number: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardNumber : "",
        insuranceHolderName: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceHolderName : "",
        insurance_holder_name: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceHolderName : "",
        insuranceCardValidUntil: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardValidUntil : "",
        insurance_card_valid_until: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardValidUntil : "",
        guideNumber: sessionFinancialContextType === "INSURANCE" ? sessionGuideNumber : "",
        guide_number: sessionFinancialContextType === "INSURANCE" ? sessionGuideNumber : "",
        authorizationCode: sessionFinancialContextType === "INSURANCE" ? sessionAuthorizationCode : "",
        authorization_code: sessionFinancialContextType === "INSURANCE" ? sessionAuthorizationCode : "",
        patientTissAuthorizationId: sessionFinancialContextType === "INSURANCE" ? sessionPatientTissAuthorizationId || null : null,
        patient_tiss_authorization_id: sessionFinancialContextType === "INSURANCE" ? sessionPatientTissAuthorizationId || null : null,
        professional: selectedSessionProfessional?.label || sessionProfessional,
        professionalId: selectedSessionProfessional?.id || sessionProfessionalId,
        professional_id: selectedSessionProfessional?.id || sessionProfessionalId,
        therapistId: selectedSessionProfessional?.id || sessionProfessionalId,
        therapist_id: selectedSessionProfessional?.id || sessionProfessionalId,
        therapistName: selectedSessionProfessional?.label || sessionProfessional,
        therapist_name: selectedSessionProfessional?.label || sessionProfessional,
        recurrencePattern: sessionRecurrencePattern,
        recurrenceScope: isEditingRecurringAppointment
          ? appointmentEditScope
          : "single",
      };
      const result: any = await onUpdateAppointment(editingAppointmentId, updates);
      if (result && !result.success) {
        hideProcessing();
        releaseSessionSubmit();
        showToast((result.errors || [result.error || "Não foi possível confirmar o agendamento."]).join(" | "), "error");
        return;
      }
      const appointmentWasRescheduled = Boolean(
        result?.scheduleChanged ||
          String(editingAppointment?.date || "") !== String(sessionDate || "") ||
          String(editingAppointment?.time || "").slice(0, 5) !== String(sessionTime || "").slice(0, 5) ||
          String(editingAppointmentActionRequest?.type || "").toUpperCase() === "RESCHEDULE",
      );
      onAddActivityLog(
        "Agendamento editado",
        isEditingRecurringAppointment && appointmentEditScope === "future"
          ? `Série recorrente de ${sessionPatientName} atualizada a partir de ${sessionDate} às ${sessionTime}.`
          : `Sessão de ${sessionPatientName} atualizada para ${sessionDate} às ${sessionTime}.`,
        "management",
      );
      const billingResult = await dataService.updateAppointmentBillingContext(String(editingAppointmentId), {
        financialContextType: sessionFinancialContextType,
        billingContextType: sessionFinancialContextType,
        payerType: sessionFinancialContextType,
        payerId: sessionFinancialContextType === "INSURANCE" ? sessionPayerId || null : null,
        payerName: sessionFinancialContextType === "INSURANCE" ? selectedSessionPayerName : null,
        serviceType: sessionApproach || "Consulta Padrão",
        insurancePlanName: sessionFinancialContextType === "INSURANCE" ? sessionInsurancePlanName || null : null,
        insuranceCardNumber: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardNumber || null : null,
        insuranceHolderName: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceHolderName || null : null,
        insuranceCardValidUntil: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardValidUntil || null : null,
        guideNumber: sessionFinancialContextType === "INSURANCE" ? sessionGuideNumber || null : null,
        authorizationCode: sessionFinancialContextType === "INSURANCE" ? sessionAuthorizationCode || null : null,
        patientTissAuthorizationId: sessionFinancialContextType === "INSURANCE" ? sessionPatientTissAuthorizationId || null : null,
        source: "APPOINTMENT_CONTEXT",
      });
      if (!billingResult?.success) {
        hideProcessing();
        releaseSessionSubmit();
        showToast(billingResult?.error || "Não foi possível salvar o contexto financeiro do atendimento.", "error");
        return;
      }
      if (editingAppointmentActionRequest?.id) {
        const buildEditedAppointmentIso = (timeValue: string) => {
          const parsed = new Date(`${sessionDate}T${timeValue}:00`);
          return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
        };
        const actionResult = await dataService.approveAppointmentActionRequest(editingAppointmentActionRequest.id, {
          scheduledStart: buildEditedAppointmentIso(sessionTime),
          scheduledEnd: buildEditedAppointmentIso(sessionEndTime),
          resolutionNote: editingAppointmentActionRequest.type === "RESCHEDULE"
            ? "Consulta remarcada pela clínica após solicitação do responsável."
            : "",
        });
        if (!actionResult?.success) {
          hideProcessing();
          releaseSessionSubmit();
          showToast(actionResult?.error || "Não foi possível resolver a solicitação do responsável.", "error");
          return;
        }
      }
      setIsAddSessionModalOpen(false);
      resetSessionForm();
      hideProcessing();
      releaseSessionSubmit();
      showToast(
        appointmentWasRescheduled
          ? Number(result?.scheduleChangedCount || 0) > 1
            ? "Consultas remarcadas com sucesso!"
            : "Consulta remarcada com sucesso!"
          : "Consulta atualizada com sucesso!",
      );
      return;
    }

    const newSession = {
      patientName: sessionPatientName,
      patientId: selectedSessionPatient?.id,
      patient_id: selectedSessionPatient?.id,
      patientEmail: selectedSessionPatient?.email,
      patient_email: selectedSessionPatient?.email,
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
      financialContextType: sessionFinancialContextType,
      financial_context_type: sessionFinancialContextType,
      billingContextType: sessionFinancialContextType,
      billing_context_type: sessionFinancialContextType,
      payerType: sessionFinancialContextType,
      payer_type: sessionFinancialContextType,
      payerId: sessionFinancialContextType === "INSURANCE" ? sessionPayerId || null : null,
      payer_id: sessionFinancialContextType === "INSURANCE" ? sessionPayerId || null : null,
      payerName: sessionFinancialContextType === "INSURANCE" ? selectedSessionPayerName : "",
      payer_name_snapshot: sessionFinancialContextType === "INSURANCE" ? selectedSessionPayerName : "",
      insurancePlanName: sessionFinancialContextType === "INSURANCE" ? sessionInsurancePlanName : "",
      insurance_plan_name: sessionFinancialContextType === "INSURANCE" ? sessionInsurancePlanName : "",
      insuranceCardNumber: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardNumber : "",
      insurance_card_number: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardNumber : "",
      insuranceHolderName: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceHolderName : "",
      insurance_holder_name: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceHolderName : "",
      insuranceCardValidUntil: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardValidUntil : "",
      insurance_card_valid_until: sessionFinancialContextType === "INSURANCE" ? sessionInsuranceCardValidUntil : "",
      guideNumber: sessionFinancialContextType === "INSURANCE" ? sessionGuideNumber : "",
      guide_number: sessionFinancialContextType === "INSURANCE" ? sessionGuideNumber : "",
      authorizationCode: sessionFinancialContextType === "INSURANCE" ? sessionAuthorizationCode : "",
      authorization_code: sessionFinancialContextType === "INSURANCE" ? sessionAuthorizationCode : "",
      patientTissAuthorizationId: sessionFinancialContextType === "INSURANCE" ? sessionPatientTissAuthorizationId || null : null,
      patient_tiss_authorization_id: sessionFinancialContextType === "INSURANCE" ? sessionPatientTissAuthorizationId || null : null,
      professional: selectedSessionProfessional?.label || sessionProfessional,
      professionalName: selectedSessionProfessional?.label || sessionProfessional,
      professionalId: selectedSessionProfessional?.id || sessionProfessionalId,
      professional_id: selectedSessionProfessional?.id || sessionProfessionalId,
      therapistId: selectedSessionProfessional?.id || sessionProfessionalId,
      therapist_id: selectedSessionProfessional?.id || sessionProfessionalId,
      numSessions: Math.min(52, Math.max(1, Number(sessionNumSessions) || 1)),
      recurrencePattern: sessionRecurrencePattern,
      applyAuthorizationToRecurrence:
        Number(sessionNumSessions) <= 1 || sessionApplyAuthorizationToRecurrence,
      apply_authorization_to_recurrence:
        Number(sessionNumSessions) <= 1 || sessionApplyAuthorizationToRecurrence,
      reuseGuideAcrossRecurrence:
        Number(sessionNumSessions) > 1 && sessionReuseGuideAcrossRecurrence,
      reuse_guide_across_recurrence:
        Number(sessionNumSessions) > 1 && sessionReuseGuideAcrossRecurrence,
    };
    const result = await onScheduleSession(newSession);
    if (result && !result.success) {
      hideProcessing();
      releaseSessionSubmit();
      showToast((result.errors || [result.error || "Não foi possível confirmar o agendamento."]).join(" | "), "error");
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
    releaseSessionSubmit();
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

  const handleStatusUpdate = async (id: number, status: string, details: any = {}) => {
    const result = await onUpdateAgendaStatus(id, status, details);
    if (result?.success === false) {
      showToast(result.error || "Não foi possível confirmar a atualização da agenda.", "error");
      return;
    }
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

  const applyInsuranceHolderSuggestion = (form: any) => {
    if (form?.convenioTipo !== "convenio") return form;
    const hasHolder = Boolean(
      String(form?.convenioTitularNome || "").trim() ||
        String(form?.convenioTitularCpf || "").trim() ||
        String(form?.convenioTitularRelacao || "").trim(),
    );
    const hasResponsible = Boolean(
      String(form?.responsavelNome || "").trim() ||
        String(form?.responsavelCpf || "").trim() ||
        String(form?.responsavelRelacao || "").trim(),
    );
    if (hasHolder || !hasResponsible) return form;
    return {
      ...form,
      convenioTitularNome: form.responsavelNome || "",
      convenioTitularCpf: form.responsavelCpf || "",
      convenioTitularRelacao: form.responsavelRelacao || "",
      insuranceHolderSuggestedFromResponsible: true,
    };
  };

  const handlePatientFormChange = (field: string, value: any) => {
    if (field === "cpf" || field === "responsavelCpf" || field === "convenioTitularCpf") {
      setNewPatientForm((prev: any) => ({
        ...prev,
        [field]: formatCpf(String(value || "")),
        ...(field === "convenioTitularCpf" ? { insuranceHolderSuggestedFromResponsible: false } : {}),
      }));
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
        ...applyInsuranceHolderSuggestion({
          ...prev,
          convenioTipo: value,
        }),
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
    if (field === "convenioTitularNome" || field === "convenioTitularRelacao") {
      setNewPatientForm((prev: any) => ({
        ...prev,
        [field]: value,
        insuranceHolderSuggestedFromResponsible: false,
      }));
      return;
    }
    setNewPatientForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleFinancialPlanChange = (planId: string, field: string, value: any) => {
    setNewPatientForm((prev: any) => {
      const nextPlans = normalizePatientFinancialPlans(prev.financialPlans, prev).map((plan: any) => {
        if (plan.id !== planId) {
          if (
            field === "isPrimaryInsurance" &&
            (value === true || value === "true") &&
            plan.billingMode === "INSURANCE"
          ) {
            return createPatientFinancialPlan({ ...plan, isPrimaryInsurance: false });
          }
          return plan;
        }
        return createPatientFinancialPlan({
          ...plan,
          [field]: value,
          ...(field === "billingMode" && value === "INSURANCE"
            ? { payerNameSnapshot: plan.payerNameSnapshot || prev.convenioNome || "" }
            : {}),
          ...(field === "billingMode" && value !== "INSURANCE"
            ? {
                payerNameSnapshot: "",
                insuranceName: "",
                insurancePlanName: "",
                insuranceCardNumber: "",
                insuranceCardHolder: "",
                insuranceCardValidUntil: "",
                isPrimaryInsurance: false,
                authorizationCode: "",
                authorizationValidUntil: "",
                copaymentAmount: "",
              }
            : {}),
          ...(field === "payerId"
            ? {
                insurancePlanName: "",
                insuranceCardNumber: "",
                insuranceCardHolder: "",
                insuranceCardValidUntil: "",
                authorizationCode: "",
                authorizationValidUntil: "",
              }
            : {}),
          ...(field === "serviceType" && value !== "CUSTOM" ? { customServiceName: "" } : {}),
          ...(field === "payerNameSnapshot" ? { insuranceName: value } : {}),
        });
      });
      return {
        ...prev,
        financialPlans: nextPlans,
      };
    });
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
    setActivePatientRegistrationTab("personal");
    setNewPatientForm({
      nome: "",
      nomeSocial: "",
      telefone: "",
      dataNascimento: "",
      genero: "",
      convenioTipo: "particular",
      convenioNome: "",
      convenioCarteirinha: "",
      convenioCarteirinhaValidade: "",
      convenioPlanoCategoria: "",
      convenioTitularNome: "",
      convenioTitularCpf: "",
      convenioTitularRelacao: "",
      convenioElegibilidadeObs: "",
      insuranceHolderSuggestedFromResponsible: false,
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
      insuranceCardValidUntil:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioCarteirinhaValidade || null
          : null,
      insurance_card_valid_until:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioCarteirinhaValidade || null
          : null,
      insurancePlanCategory:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioPlanoCategoria || null
          : null,
      insurance_plan_category:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioPlanoCategoria || null
          : null,
      insuranceHolderName:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioTitularNome || null
          : null,
      insurance_holder_name:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioTitularNome || null
          : null,
      insuranceHolderCpf:
        newPatientForm.convenioTipo === "convenio"
          ? normalizeCpfInput(newPatientForm.convenioTitularCpf) || null
          : null,
      insurance_holder_cpf:
        newPatientForm.convenioTipo === "convenio"
          ? normalizeCpfInput(newPatientForm.convenioTitularCpf) || null
          : null,
      insuranceHolderRelationship:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioTitularRelacao || null
          : null,
      insurance_holder_relationship:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioTitularRelacao || null
          : null,
      eligibilityNotes:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioElegibilidadeObs || null
          : null,
      eligibility_notes:
        newPatientForm.convenioTipo === "convenio"
          ? newPatientForm.convenioElegibilidadeObs || null
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

  const handleEditPatient = (patient: any, initialTab: PatientRegistrationTab = "personal") => {
    const insuranceEligibility = normalizePatientInsuranceEligibility(patient, { useResponsibleFallback: true });
    setEditingPatientId(String(patient.id));
    setActivePatientRegistrationTab(initialTab);
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
      convenioTipo: insuranceEligibility.convenioTipo === "convenio" ? "convenio" : "particular",
      convenioNome: insuranceEligibility.convenioNome || "",
      convenioCarteirinha: insuranceEligibility.convenioCarteirinha || "",
      convenioCarteirinhaValidade: insuranceEligibility.convenioCarteirinhaValidade || "",
      convenioPlanoCategoria: insuranceEligibility.convenioPlanoCategoria || "",
      convenioTitularNome: insuranceEligibility.convenioTitularNome || "",
      convenioTitularCpf: formatCpf(insuranceEligibility.convenioTitularCpf || ""),
      convenioTitularRelacao: insuranceEligibility.convenioTitularRelacao || "",
      convenioElegibilidadeObs: insuranceEligibility.convenioElegibilidadeObs || "",
      insuranceHolderSuggestedFromResponsible: insuranceEligibility.holderPrefilledFromResponsible,
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
        convenioTipo: insuranceEligibility.convenioTipo === "convenio" ? "convenio" : "particular",
        convenioNome: insuranceEligibility.convenioNome || "",
      }),
    });
    setIsPatientRegistrationModalOpen(true);
  };

  const openSelectedSessionPatientInsuranceRegistration = () => {
    if (!selectedSessionPatient) {
      showToast("Selecione o paciente antes de editar o convênio.", "error");
      return;
    }
    setIsAddSessionModalOpen(false);
    handleEditPatient(selectedSessionPatient, "financial");
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
    const appointmentInsurancePlanSnapshot = String(
      appointment.insurancePlanName || appointment.insurance_plan_name || "",
    );
    const appointmentInsuranceCardSnapshot = String(
      appointment.insuranceCardNumber || appointment.insurance_card_number || "",
    );
    const actionRequestId = String(
      appointment.pendingActionRequestId ||
        appointment.actionRequestId ||
        appointment.action_request_id ||
        appointment.appointment_action_request_id ||
        "",
    ).trim();
    setEditingAppointmentId(appointment.id);
    setEditingAppointmentActionRequest(
      actionRequestId
        ? {
            id: actionRequestId,
            type: String(appointment.pendingActionRequestType || appointment.actionRequestType || appointment.request_type || ""),
          }
        : null,
    );
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
    const appointmentRoomId = String(
      appointment.roomId || appointment.room_id || appointment.room || "",
    ).trim();
    const nextLocationType = appointmentRoomId
      ? "clinica"
      : normalizeScheduleLocationType(
          appointment.location_type ||
            appointment.locationType ||
            appointment.location ||
            "online",
        );
    setSessionLocationType(nextLocationType);
    setSessionRoom(nextLocationType === "clinica" ? appointmentRoomId : "");
    setSessionLocationNotes(String(appointment.locationNotes || appointment.location_notes || ""));
    setSessionCallLink(String(appointment.callLink || appointment.call_link || ""));
    const appointmentProfessionalId = String(
      appointment.therapistId ||
        appointment.therapist_id ||
        appointment.professionalId ||
        appointment.professional_id ||
        "",
    ).trim();
    const appointmentProfessionalName = String(
      appointment.therapistName ||
        appointment.therapist_name ||
        appointment.professionalName ||
        appointment.professional ||
        "",
    ).trim();
    setSessionProfessionalId(appointmentProfessionalId);
    setSessionProfessionalManuallySelected(false);
    setSessionProfessional(
      ["equipe", "team"].includes(appointmentProfessionalName.toLowerCase())
        ? ""
        : appointmentProfessionalName,
    );
    setSessionFinancialContextType(
      normalizeAppointmentFinancialContextType(
        appointment.financialContextType ||
          appointment.financial_context_type ||
          appointment.billingContextType ||
          appointment.billing_context_type ||
          appointment.payerType ||
          appointment.payer_type ||
          (appointment.payerId || appointment.payer_id ? "INSURANCE" : "INSURANCE"),
      ) || "INSURANCE",
    );
    setSessionPayerId(String(appointment.payerId || appointment.payer_id || ""));
    setSessionPayerNameSnapshot(String(appointment.payerName || appointment.payer_name_snapshot || ""));
    setSessionInsurancePlanName(appointmentInsurancePlanSnapshot);
    setSessionInsuranceCardNumber(appointmentInsuranceCardSnapshot);
    setSessionInsuranceHolderName(String(
      appointment.insuranceHolderName ||
        appointment.insurance_holder_name ||
        appointment.insuranceCardHolder ||
        appointment.insurance_card_holder ||
        "",
    ));
    setSessionInsuranceCardValidUntil(String(
      appointment.insuranceCardValidUntil ||
        appointment.insurance_card_valid_until ||
        appointment.cardValidUntil ||
        appointment.card_valid_until ||
        "",
    ));
    setSessionGuideNumber(String(appointment.guideNumber || appointment.guide_number || ""));
    setSessionAuthorizationCode(String(appointment.authorizationCode || appointment.authorization_code || ""));
    setSessionPatientTissAuthorizationId(String(appointment.patientTissAuthorizationId || appointment.patient_tiss_authorization_id || ""));
    if (appointment.id && !isTherapist) {
      dataService.getAppointmentBillingContext(String(appointment.id)).then((result: any) => {
        if (!result?.success || !result.data) return;
        setSessionFinancialContextType(
          normalizeAppointmentFinancialContextType(
            result.data.financialContextType ||
              result.data.financial_context_type ||
              result.data.billingContextType ||
              result.data.billing_context_type ||
              result.data.payerType ||
              result.data.payer_type ||
              (result.data.payerId ? "INSURANCE" : ""),
          ) || "INSURANCE",
        );
        setSessionPayerId(String(result.data.payerId || ""));
        setSessionPayerNameSnapshot(String(result.data.payerName || ""));
        setSessionInsurancePlanName(String(
          result.data.hasContext
            ? result.data.insurancePlanName || ""
            : appointmentInsurancePlanSnapshot || result.data.insurancePlanName || "",
        ));
        setSessionInsuranceCardNumber(String(
          result.data.hasContext
            ? result.data.insuranceCardNumber || ""
            : appointmentInsuranceCardSnapshot || result.data.insuranceCardNumber || "",
        ));
        setSessionInsuranceHolderName(String(
          result.data.hasContext
            ? result.data.insuranceHolderName || result.data.insuranceCardHolder || ""
            : appointment.insuranceHolderName ||
              appointment.insurance_holder_name ||
              result.data.insuranceHolderName ||
              result.data.insuranceCardHolder ||
              "",
        ));
        setSessionInsuranceCardValidUntil(String(
          result.data.hasContext
            ? result.data.insuranceCardValidUntil || result.data.cardValidUntil || ""
            : appointment.insuranceCardValidUntil ||
              appointment.insurance_card_valid_until ||
              result.data.insuranceCardValidUntil ||
              result.data.cardValidUntil ||
              "",
        ));
        setSessionGuideNumber(String(result.data.guideNumber || ""));
        setSessionAuthorizationCode(String(result.data.authorizationCode || ""));
        setSessionPatientTissAuthorizationId(String(
          result.data.patientTissAuthorizationId ||
            result.data.patient_tiss_authorization_id ||
            result.data.tissAuthorization?.authorizationId ||
            result.data.tiss_authorization?.authorizationId ||
            "",
        ));
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
    if (nextOptions.tab === "history" || !nextOptions.tab) {
      void Promise.resolve(onRefreshPatientHistory?.(resolvedPatient.id)).catch((error) => {
        console.warn("Falha ao atualizar histórico persistido do paciente:", error);
      });
    }
  };

  const openPatientProfileModal = (patient: any) => {
    const profile = patient && typeof patient === "object" ? patient : {};
    const profilePatientId = String(profile?.id || profile?.patient_id || "").trim();
    const anamnesisData =
      profile?.anamnesisData && typeof profile.anamnesisData === "object"
        ? profile.anamnesisData
        : {};
    const insuranceEligibility = normalizePatientInsuranceEligibility(profile);
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
      name: readFirstText(profile?.name, profile?.fullName, profile?.full_name, profile?.nome, anamnesisData?.nome),
      socialName: readFirstText(profile?.socialName, profile?.nomeSocial, anamnesisData?.nomeSocial),
      phone: readFirstText(profile?.phone, anamnesisData?.telefone),
      email: readFirstText(profile?.email, anamnesisData?.email),
      insuranceType: insuranceEligibility.convenioTipo || readFirstText(profile?.insuranceType, anamnesisData?.convenioTipo),
      insuranceName: insuranceEligibility.convenioNome || readFirstText(profile?.insuranceName, anamnesisData?.convenioNome),
      cardNumber: insuranceEligibility.convenioCarteirinha || readFirstText(profile?.cardNumber, anamnesisData?.convenioCarteirinha),
      insurancePlanCategory: insuranceEligibility.convenioPlanoCategoria || readFirstText(profile?.insurancePlanCategory, profile?.insurance_plan_category),
      insuranceCardValidUntil: insuranceEligibility.convenioCarteirinhaValidade || readFirstText(profile?.insuranceCardValidUntil, profile?.insurance_card_valid_until),
      insuranceHolderName: insuranceEligibility.convenioTitularNome || readFirstText(profile?.insuranceHolderName, profile?.insurance_holder_name),
      insuranceHolderCpf: insuranceEligibility.convenioTitularCpf || readFirstText(profile?.insuranceHolderCpf, profile?.insurance_holder_cpf),
      insuranceHolderRelationship: insuranceEligibility.convenioTitularRelacao || readFirstText(profile?.insuranceHolderRelationship, profile?.insurance_holder_relationship),
      eligibilityNotes: insuranceEligibility.convenioElegibilidadeObs || readFirstText(profile?.eligibilityNotes, profile?.eligibility_notes),
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
      financialPlans: normalizePatientFinancialPlans(profile?.financialPlans || profile?.financial_plans, profile),
    });
    setSelectedPatientProfileAuthorizations([]);
    if (canAccessClinicFinance && profilePatientId) {
      setSelectedPatientProfileAuthorizationsLoading(true);
      void dataService.getPatientTissAuthorizations(profilePatientId)
        .then((result) => {
          setSelectedPatientProfileAuthorizations(result?.success && Array.isArray(result.data) ? result.data : []);
        })
        .catch(() => {
          setSelectedPatientProfileAuthorizations([]);
        })
        .finally(() => setSelectedPatientProfileAuthorizationsLoading(false));
    } else {
      setSelectedPatientProfileAuthorizationsLoading(false);
    }
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

  const openPatientEditFromAdministrativeFlow = useCallback((row: any) => {
    const patientId = String(row?.patientId || row?.patient_id || "").trim();
    const fallbackName = normalizeUtf8Text(String(row?.patientName || row?.patient_name || row?.name || "")).trim();
    const normalizedFallback = fallbackName.toLowerCase();
    const patient =
      allPatients.find((item: any) => patientId && String(item?.id) === patientId) ||
      allPatients.find((item: any) => normalizedFallback && normalizeUtf8Text(String(item?.name || "")).trim().toLowerCase() === normalizedFallback);
    if (patient?.id && !isTherapist) {
      handleEditPatient(patient);
      setActionPopup({
        title: "Corrigir paciente",
        message: "Abrimos o cadastro do paciente para revisar carteirinha, validade e elegibilidade do convênio.",
      });
      return;
    }
    onPatientClick(patientId || undefined, { tab: "history" }, fallbackName || "Paciente");
  }, [allPatients, handleEditPatient, isTherapist, onPatientClick]);

  const openPatientAuthorizationRegistration = useCallback((authorization: any, action: "view" | "edit" | "add" = "view") => {
    const patientId = String(authorization?.patientId || authorization?.patient_id || "").trim();
    const patientName = normalizeUtf8Text(String(authorization?.patientName || authorization?.patient_name || "Paciente")).trim();
    const patient =
      allPatients.find((item: any) => patientId && String(item?.id) === patientId) ||
      (patientId ? { id: patientId, name: patientName } : null);
    if (!patient?.id || isTherapist) {
      onPatientClick(patientId || undefined, { tab: "history" }, patientName || "Paciente");
      return;
    }
    handleEditPatient(patient, "tiss");
    setActionPopup({
      title: action === "add" ? "Adicionar autorização TISS" : action === "edit" ? "Editar autorização TISS" : "Autorizações TISS",
      message:
        action === "add"
          ? "Abrimos a aba Autorizações TISS do paciente para cadastrar uma nova senha/guia."
          : "Abrimos a aba Autorizações TISS do paciente para revisar esta autorização.",
    });
  }, [allPatients, handleEditPatient, isTherapist, onPatientClick]);

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

  const openAppointmentFromAdministrativeFlow = useCallback((appointment: any) => {
    const requestedAppointmentId = String(
      appointment?.appointmentId ||
        appointment?.appointment_id ||
        appointment?.id ||
        "",
    ).trim();
    const matchedAppointment = requestedAppointmentId
      ? (normalizedAgenda || []).find((item: any) => resolvePersistedAppointmentId(item) === requestedAppointmentId)
      : null;

    navigateToTab("agenda");
    if (!matchedAppointment) {
      showToast("Abrimos a agenda. Não foi possível localizar automaticamente este agendamento na lista carregada.", "info");
      return;
    }

    const dateKey = getAgendaDateKey(
      matchedAppointment?.date ||
        matchedAppointment?.scheduled_at ||
        matchedAppointment?.scheduledAt ||
        matchedAppointment?.start,
    );
    if (dateKey) {
      setCalendarDate(new Date(`${dateKey}T12:00:00`));
      setAgendaView("day");
    }
    openAgendaActionModal({
      ...matchedAppointment,
      focusPanel: appointment?.focusPanel || null,
      actionIntent: appointment?.actionIntent || null,
      abaSessionId: appointment?.abaSessionId || appointment?.aba_session_id || matchedAppointment?.abaSessionId || matchedAppointment?.aba_session_id || null,
    });
    if (appointment?.actionIntent === "collect_signature") {
      setAgendaAppointmentObservation((current) => current || "Pendência TISS: coletar assinatura do responsável.");
      showToast("Abrimos o agendamento para coletar assinatura.", "success");
    }
  }, [normalizedAgenda, openAgendaActionModal, resolvePersistedAppointmentId, showToast]);

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
      prevent_overlapping_appointments: newRoom.preventOverlappingAppointments !== false,
      preventOverlappingAppointments: newRoom.preventOverlappingAppointments !== false,
      is_active: true,
      isActive: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setRooms((prev) => [...prev, room]);
    setNewRoom({ name: "", specialties: "", preventOverlappingAppointments: true });
  };

  const handleEditRoom = (room: any) => {
    if (!canManageRooms) return;
    setEditingRoom(room);
    setNewRoom({
      name: room.name,
      specialties: (Array.isArray(room.specialties) ? room.specialties : []).join(", "),
      preventOverlappingAppointments: room.prevent_overlapping_appointments !== false && room.preventOverlappingAppointments !== false
    });
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
          ? {
              ...r,
              name: newRoom.name,
              specialties: specialtiesArray,
              prevent_overlapping_appointments: newRoom.preventOverlappingAppointments !== false,
              preventOverlappingAppointments: newRoom.preventOverlappingAppointments !== false,
              updated_at: new Date().toISOString()
            }
          : r,
      ),
    );
    setEditingRoom(null);
    setNewRoom({ name: "", specialties: "", preventOverlappingAppointments: true });
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

  const handleSaveClinicSettings = async () => {
    const cleanFullName = therapistFullName.trim();
    const cleanCrp = therapistCrp.trim();
    const normalizedTherapistDocumentType = ["CPF", "CNPJ", "OTHER"].includes(String(therapistDocumentType || "").toUpperCase())
      ? String(therapistDocumentType || "").toUpperCase()
      : "CPF";
    const cleanCpf = onlyDigits(therapistCpf, normalizedTherapistDocumentType === "CNPJ" ? 14 : 11);
    const cleanPhone = onlyDigits(therapistPhone, 11);
    const cleanTherapistEmail = therapistEmail.trim();
    const cleanRoleTitle = therapistRoleTitle.trim();
    const cleanSpecialties = therapistSpecialties.trim();
    const cleanMiniCurriculum = therapistMiniCurriculum.trim();
    const cleanCouncilType = therapistCouncilType.trim();
    const cleanCouncilState = therapistCouncilState.trim().toUpperCase().slice(0, 2);
    const cleanCboCode = onlyDigits(therapistCboCode, 12);
    const cleanSpecialtyName = therapistSpecialtyName.trim();
    const cleanTherapistProviderCode = therapistProviderCode.trim();
    const cleanClinicName = clinicDisplayName.trim();
    const cleanClinicLegalName = clinicLegalName.trim();
    const normalizedClinicDocumentType = clinicDocumentType === "CPF" ? "CPF" : "CNPJ";
    const cleanClinicDocumentNumber = parseDocumentForStorage(clinicCnpj);
    const cleanClinicPhone = onlyDigits(clinicPhone, 11);
    const cleanClinicWhatsapp = onlyDigits(clinicWhatsapp, 11);
    const cleanClinicEmail = clinicEmail.trim();
    const cleanClinicSite = clinicSite.trim();
    const cleanClinicAddressLine = clinicAddressLine.trim();
    const cleanClinicAddressNumber = clinicAddressNumber.trim();
    const cleanClinicAddressComplement = clinicAddressComplement.trim();
    const cleanClinicDistrict = clinicDistrict.trim();
    const cleanClinicCity = clinicCity.trim();
    const cleanClinicState = clinicStateUf.trim().toUpperCase().slice(0, 2);
    const cleanClinicPostalCode = onlyDigits(clinicPostalCode, 8);
    const cleanClinicAddress =
      clinicAddress.trim() ||
      [cleanClinicAddressLine, cleanClinicAddressNumber, cleanClinicDistrict, cleanClinicCity, cleanClinicState]
        .filter(Boolean)
        .join(", ");
    const cleanClinicCnesCode = onlyDigits(clinicCnesCode, 12);
    const cleanClinicProviderCode = clinicProviderCode.trim();
    const isCrpValid =
      !cleanCrp ||
      /^[A-Za-z0-9À-ÿ .\/-]{2,80}$/u.test(cleanCrp);

    if (!cleanFullName || cleanFullName.length < 3) {
      showToast("Informe o nome completo para salvar o perfil.", "error");
      return;
    }
    if (!isCrpValid) {
      showToast("Registro profissional inválido. Revise o número do conselho.", "error");
      return;
    }
    if (cleanCpf && normalizedTherapistDocumentType !== "OTHER") {
      const expectedLength = normalizedTherapistDocumentType === "CNPJ" ? 14 : 11;
      if (cleanCpf.length !== expectedLength) {
        showToast(normalizedTherapistDocumentType === "CNPJ" ? "CNPJ do profissional inválido." : "CPF inválido. Informe 11 dígitos.", "error");
        return;
      }
    }
    if (normalizedTherapistDocumentType === "OTHER" && cleanCpf && cleanCpf.length < 3) {
      showToast("Documento profissional inválido.", "error");
      return;
    }
    if (cleanClinicDocumentNumber) {
      const expectedLength = normalizedClinicDocumentType === "CPF" ? 11 : 14;
      if (cleanClinicDocumentNumber.length !== expectedLength) {
        showToast(normalizedClinicDocumentType === "CPF" ? "CPF da clínica inválido." : "CNPJ da clínica inválido.", "error");
        return;
      }
    }
    if (!isTherapist && !canManageClinicSettings) {
      showToast("Apenas a coordenação pode alterar as configurações da clínica.", "error");
      return;
    }

    showProcessing(isTherapist ? "Salvando perfil profissional..." : "Salvando perfil e dados da clínica...");
    const clinicSettings = {
      ...(user?.clinicSettings || {}),
      defaultSessionDuration,
      workStart,
      workEnd,
      professionalSessionDurations,
      clinicName: cleanClinicName || user?.clinicSettings?.clinicName || null,
      clinicLegalName: cleanClinicLegalName || null,
      legalName: cleanClinicLegalName || null,
      clinicDocumentType: normalizedClinicDocumentType,
      documentType: normalizedClinicDocumentType,
      clinicDocumentNumber: cleanClinicDocumentNumber || null,
      clinicCnpj: cleanClinicDocumentNumber || null,
      clinicPhone: cleanClinicPhone || null,
      clinicWhatsapp: cleanClinicWhatsapp || null,
      clinicEmail: cleanClinicEmail || null,
      clinicSite: cleanClinicSite || null,
      clinicAddress: cleanClinicAddress || null,
      clinicAddressLine: cleanClinicAddressLine || null,
      clinicAddressNumber: cleanClinicAddressNumber || null,
      clinicAddressComplement: cleanClinicAddressComplement || null,
      clinicDistrict: cleanClinicDistrict || null,
      clinicCity: cleanClinicCity || null,
      clinicState: cleanClinicState || null,
      clinicPostalCode: cleanClinicPostalCode || null,
      clinicCnesCode: cleanClinicCnesCode || null,
      clinicProviderCode: cleanClinicProviderCode || null,
    };

    if (!isTherapist && canManageClinicSettings) {
      try {
        const providerResult = await dataService.updateClinicTissProfile({
          legalName: cleanClinicLegalName || cleanClinicName || null,
          tradeName: cleanClinicName || null,
          documentType: normalizedClinicDocumentType,
          documentNumber: cleanClinicDocumentNumber || null,
          cnesCode: cleanClinicCnesCode || null,
          providerCode: cleanClinicProviderCode || null,
          addressLine: cleanClinicAddressLine || null,
          addressNumber: cleanClinicAddressNumber || null,
          addressComplement: cleanClinicAddressComplement || null,
          district: cleanClinicDistrict || null,
          city: cleanClinicCity || null,
          state: cleanClinicState || null,
          postalCode: cleanClinicPostalCode || null,
          phone: cleanClinicPhone || cleanClinicWhatsapp || null,
          email: cleanClinicEmail || null,
        });
        if (!providerResult?.success) {
          showToast(providerResult?.error || "Não foi possível salvar os dados fiscais/TISS da clínica.", "error");
          hideProcessing();
          return;
        }
      } catch {
        showToast("Não foi possível salvar os dados fiscais/TISS da clínica.", "error");
        hideProcessing();
        return;
      }
    }

    const ownProfessionalId = String(user?.id || "").trim();
    const shouldPersistOwnBillingProfile = Boolean(ownProfessionalId && (isTherapist || (!isTherapist && canManageClinicSettings)));
    if (shouldPersistOwnBillingProfile) {
      const professionalBillingResult = isTherapist
        ? await dataService.updateOwnProfessionalBillingProfile({
            displayName: cleanFullName || null,
            documentType: normalizedTherapistDocumentType,
            documentNumber: cleanCpf || null,
            councilType: cleanCouncilType || cleanCrp.split(/\s|\//)[0] || null,
            councilNumber: cleanCrp || null,
            councilState: cleanCouncilState || null,
            cboCode: cleanCboCode || null,
            specialtyName: cleanSpecialtyName || cleanSpecialties || null,
            providerCode: cleanTherapistProviderCode || null,
          })
        : await dataService.updateProfessionalBillingProfile(ownProfessionalId, {
            displayName: cleanFullName || null,
            documentType: normalizedTherapistDocumentType,
            documentNumber: cleanCpf || null,
            councilType: cleanCouncilType || cleanCrp.split(/\s|\//)[0] || null,
            councilNumber: cleanCrp || null,
            councilState: cleanCouncilState || null,
            cboCode: cleanCboCode || null,
            specialtyName: cleanSpecialtyName || cleanSpecialties || null,
            providerCode: cleanTherapistProviderCode || null,
          });
      if (!professionalBillingResult?.success) {
        showToast(professionalBillingResult?.error || "Não foi possível salvar o perfil faturável do profissional.", "error");
        hideProcessing();
        return;
      }
    }

    onUpdateProfile({
      name: therapistFullName?.trim() || user?.name,
      cpf: cleanCpf || null,
      phone: cleanPhone || null,
      email: cleanTherapistEmail || user?.email,
      professionalRoleTitle: cleanRoleTitle || null,
      crp: cleanCrp || null,
      specialties: cleanSpecialties,
      miniCurriculum: cleanMiniCurriculum,
      profilePicture: therapistProfilePhotoUrl,
      signatureDataUrl: therapistSignatureDataUrl,
      professionalProfile: {
        fullName: cleanFullName,
        cpf: cleanCpf || null,
        documentType: normalizedTherapistDocumentType,
        phone: cleanPhone || null,
        email: cleanTherapistEmail || null,
        roleTitle: cleanRoleTitle || null,
        crp: cleanCrp || null,
        council: cleanCouncilType || null,
        councilState: cleanCouncilState || null,
        cboCode: cleanCboCode || null,
        specialtyName: cleanSpecialtyName || null,
        providerCode: cleanTherapistProviderCode || null,
        specialties: cleanSpecialties,
        miniCurriculum: cleanMiniCurriculum,
        profilePicture: therapistProfilePhotoUrl,
        signatureDataUrl: therapistSignatureDataUrl,
      },
      clinicSettings: {
        ...clinicSettings,
        clinicLogoUrl: !isTherapist ? clinicLogoDataUrl || undefined : user?.clinicSettings?.clinicLogoUrl,
      },
    });

    onAddActivityLog(
      isTherapist ? "Perfil profissional atualizado" : "Perfil e dados da clínica atualizados",
      isTherapist
        ? "O profissional atualizou dados cadastrais, documentos, assinatura e foto de perfil."
        : "A coordenação atualizou dados profissionais, dados institucionais da clínica, horários e branding.",
      "management",
    );
    hideProcessing();
    showToast(isTherapist ? "Perfil atualizado com sucesso!" : "Perfil e clínica salvos. Pré-guias afetadas foram atualizadas automaticamente.");
  };

  const normalizeAnamnesisTemplateForEditor = (template: any) => ({
    ...normalizeAnamnesisTemplate(template || getDefaultAnamnesisTemplate()),
    selectedTemplateId: template?.selectedTemplateId || template?.id || null,
    templateName: template?.templateName || template?.name || "Ficha personalizada",
    templateDescription: template?.templateDescription || template?.description || "",
    ageMinMonths: template?.ageMinMonths ?? template?.age_min_months ?? null,
    ageMaxMonths: template?.ageMaxMonths ?? template?.age_max_months ?? null,
    patientProfileType: template?.patientProfileType || template?.patient_profile_type || null,
  });

  const loadClinicAnamnesisTemplate = async () => {
    setLoadingAnamnesisTemplate(true);
    try {
      const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || '').trim();
      const listResult = await dataService.getClinicAnamnesisTemplates(workspaceId || undefined);
      if (listResult?.success && Array.isArray(listResult.data)) {
        const normalizedList = listResult.data.map(normalizeAnamnesisTemplateForEditor);
        setAnamnesisTemplates(normalizedList);
        if (normalizedList.length > 0) {
          const currentId = String(anamnesisTemplate?.selectedTemplateId || "");
          const currentStillExists = normalizedList.find((item: any) => String(item?.selectedTemplateId || item?.id || "") === currentId);
          setAnamnesisTemplate(currentStillExists || normalizedList[0]);
          return;
        }
      }

      const result = await dataService.getClinicAnamnesisTemplate(workspaceId || undefined);
      if (result?.success) {
        setAnamnesisTemplate(normalizeAnamnesisTemplateForEditor(result.data || getDefaultAnamnesisTemplate()));
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
    const result = await dataService.saveClinicAnamnesisTemplateRecord(template, workspaceId || undefined);
    if (!result?.success) {
      hideProcessing();
      throw new Error(
        result?.error || "Não foi possível salvar o template da anamnese.",
      );
    }
    const normalizedSavedTemplate = normalizeAnamnesisTemplateForEditor(result?.data || template);
    setAnamnesisTemplate(normalizedSavedTemplate);
    setAnamnesisTemplates((prev) => {
      const templateId = String((normalizedSavedTemplate as any)?.selectedTemplateId || (normalizedSavedTemplate as any)?.id || "");
      const withoutCurrent = prev.filter((item: any) => String(item?.selectedTemplateId || item?.id || "") !== templateId);
      return [normalizedSavedTemplate, ...withoutCurrent].slice(0, 5);
    });
    onAddActivityLog(
      "Template de anamnese atualizado",
      "A coordenação personalizou perguntas e campos da ficha de anamnese.",
      "management",
    );
    hideProcessing();
    showToast("Dados salvos com sucesso!");
    return normalizedSavedTemplate;
  };

  const handleSelectClinicAnamnesisTemplate = (template: any) => {
    setAnamnesisTemplate(normalizeAnamnesisTemplateForEditor(template));
  };

  const handleDeleteClinicAnamnesisTemplate = async (templateId: string) => {
    if (!canEditAnamnesisTemplate) {
      showToast("Apenas a coordenação pode remover fichas de anamnese.", "error");
      return;
    }
    showProcessing("Removendo ficha personalizada...");
    const workspaceId = String(user?.activeWorkspaceId || user?.clinicId || '').trim();
    const result = await dataService.deleteClinicAnamnesisTemplateRecord(templateId, workspaceId || undefined);
    if (!result?.success) {
      hideProcessing();
      throw new Error(result?.error || "Não foi possível remover a ficha.");
    }
    const nextTemplates = anamnesisTemplates.filter((item: any) => String(item?.selectedTemplateId || item?.id || "") !== String(templateId));
    setAnamnesisTemplates(nextTemplates);
    setAnamnesisTemplate(nextTemplates[0] || normalizeAnamnesisTemplateForEditor(getDefaultAnamnesisTemplate()));
    hideProcessing();
    showToast("Ficha removida da lista ativa.");
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

  const isUnallocatedSpecialtyLabel = (label: any) => {
    const normalized = String(label || "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return !normalized || ["nao informado", "sem especialidade", "sem alocacao"].includes(normalized);
  };

  const formatFinancialMonthLabel = (monthKey: string, style: "short" | "long" = "long") => {
    const [year, month] = String(monthKey || "").split("-").map(Number);
    if (!year || !month) return "Mês não informado";
    const date = new Date(year, month - 1, 1);
    const label = date.toLocaleDateString("pt-BR", {
      month: style,
      year: style === "long" ? "numeric" : undefined,
    });
    return label.charAt(0).toUpperCase() + label.slice(1).replace(".", "");
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
    const cancelledPayments = monthPayments.filter((payment: any) => normalizeStatus(payment?.status) === "canceled");
    const monthProfessionalPayments = (professionalPayments || []).filter((payment: any) => {
      const referenceDate =
        payment?.payment_date ||
        payment?.paymentDate ||
        payment?.due_date ||
        payment?.dueDate;
      return isSameFinancialMonth(referenceDate, financialMonth);
    });
    const paidProfessionalPayments = monthProfessionalPayments.filter((payment: any) => normalizeStatus(payment?.status) === "paid");
    const pendingProfessionalPayments = monthProfessionalPayments.filter((payment: any) => {
      const status = normalizeStatus(payment?.status);
      return !["paid", "canceled", "cancelled"].includes(status);
    });
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
    const cancelledAmount = cancelledPayments.reduce((sum: number, payment: any) => sum + parseCurrencyValue(payment?.amount), 0);
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
        monthKey: key,
        month: formatFinancialMonthLabel(key, "short"),
        monthFull: formatFinancialMonthLabel(key, "long"),
        projected: key === financialMonth ? projection : 0,
        realized: paid,
        profit: paid - professional,
      };
    });

    const specialtyRows = Array.from(specialtyMap.values())
      .map((row: any) => ({
        ...row,
        patients: row.patients.size,
        paidPatients: row.paidPatients.size,
      }))
      .sort((a, b) => b.projected - a.projected);
    const clinicalSpecialtyRows = specialtyRows.filter((row: any) => !isUnallocatedSpecialtyLabel(row.label));
    const unallocatedSpecialtyRows = specialtyRows.filter((row: any) => isUnallocatedSpecialtyLabel(row.label));
    const unallocatedSpecialtyTotals = unallocatedSpecialtyRows.reduce(
      (acc: any, row: any) => ({
        projected: acc.projected + (Number(row.projected) || 0),
        realized: acc.realized + (Number(row.realized) || 0),
        pending: acc.pending + (Number(row.pending) || 0),
        overdue: acc.overdue + (Number(row.overdue) || 0),
        professionalPaid: acc.professionalPaid + (Number(row.professionalPaid) || 0),
        allocatedOperationalExpenses: acc.allocatedOperationalExpenses + (Number(row.allocatedOperationalExpenses) || 0),
        netProfit: acc.netProfit + (Number(row.netProfit) || 0),
        patients: acc.patients + (Number(row.patients) || 0),
        paidPatients: acc.paidPatients + (Number(row.paidPatients) || 0),
      }),
      {
        projected: 0,
        realized: 0,
        pending: 0,
        overdue: 0,
        professionalPaid: 0,
        allocatedOperationalExpenses: 0,
        netProfit: 0,
        patients: 0,
        paidPatients: 0,
      },
    );

    return {
      activePatients,
      patientCount: activePatients.length,
      projection,
      realized,
      pendingAmount,
      cancelledAmount,
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
      specialtyRows: clinicalSpecialtyRows,
      unallocatedSpecialtyRows,
      unallocatedSpecialtyTotals,
      payerRows: Array.from(payerMap.values()).map((row: any) => ({ ...row, patients: row.patients.size })).sort((a, b) => b.amount - a.amount),
      insuranceRows: Array.from(insuranceMap.values()).map((row: any) => ({ ...row, patients: row.patients.size })).sort((a, b) => b.amount - a.amount),
      billingMethodRows: Array.from(billingMethodMap.values()).map((row: any) => ({ ...row, patients: row.patients.size })).sort((a, b) => b.amount - a.amount),
      dueRows: dueRows.sort((a, b) => a.dueDay - b.dueDay || a.patientName.localeCompare(b.patientName, "pt-BR")),
      monthPayments,
      paidPayments,
      pendingPayments,
      cancelledPayments,
      professionalPayments: monthProfessionalPayments.sort((a: any, b: any) => String(a.due_date || a.payment_date || '').localeCompare(String(b.due_date || b.payment_date || ''))),
      paidProfessionalPayments,
      pendingProfessionalPayments,
    };
  }, [allPatients, financialEntries, financialMonth, payments, professionalPayments, therapistMembersById]);

  const dreData = financialDashboard.dreRows;
  const compensationForecast = financialDashboard.dueRows.slice(0, 6);
  const activeFinancialSection = financialNavigationContext.breadcrumb[1] || (isReceptionist ? "Recebimentos de pacientes" : "Visão geral da clínica");
  const isFinancialDashboardSection = [
    "Dashboard financeiro",
    "Financeiro da clínica",
    "Visão geral da clínica",
  ].includes(activeFinancialSection);
  const isRevenueSection = activeFinancialSection === "Receitas";
  const isExpenseSection = activeFinancialSection === "Despesas";
  const isCashFlowSection = activeFinancialSection === "Fluxo de caixa" || activeFinancialSection === "Fluxo de Caixa";
  const isProfessionalTransfersSection = activeFinancialSection === "Repasses a profissionais";
  const isFinancialPayerLotsSection = activeFinancialSection === "Convênios e lotes";
  const isProductionReportSection = activeFinancialSection === "Relatórios de Produção";
  const isBillingReportSection = activeFinancialSection === "Relatórios de Faturamento";
  const patientFinanceSections = [
    "Financeiro de pacientes",
    "Recebimentos de pacientes",
    "Cobranças",
    "Pendências de pacientes",
    "Recibos",
  ];
  const isPatientReceivablesSection = patientFinanceSections.includes(activeFinancialSection);
  const patientFinanceActiveSection = activeFinancialSection === "Financeiro de pacientes"
    ? "Recebimentos de pacientes"
    : activeFinancialSection;
  const isPatientPaymentsSection = patientFinanceActiveSection === "Recebimentos de pacientes";
  const isPatientChargesSection = patientFinanceActiveSection === "Cobranças";
  const isPatientPendingSection = patientFinanceActiveSection === "Pendências de pacientes";
  const isPatientReceiptsSection = patientFinanceActiveSection === "Recibos";
  const productionReportRows = useMemo(() => {
    const monthAppointments = (therapistAgenda || []).filter((appointment: any) => {
      const referenceDate =
        appointment?.scheduled_start_at ||
        appointment?.scheduledStartAt ||
        appointment?.scheduledAt ||
        appointment?.date;
      return isSameFinancialMonth(referenceDate, financialMonth);
    });
    const normalizeAppointmentStatus = (status: any) => String(status || "").toLowerCase();
    const completed = monthAppointments.filter((appointment: any) =>
      ["completed", "complete", "realizada", "concluida", "concluída"].includes(normalizeAppointmentStatus(appointment?.status)),
    );
    const cancelled = monthAppointments.filter((appointment: any) =>
      ["cancelled", "canceled", "cancelada", "cancelado"].includes(normalizeAppointmentStatus(appointment?.status)),
    );
    const professionalMap = new Map<string, any>();
    monthAppointments.forEach((appointment: any) => {
      const professionalId = String(
        appointment?.professional_id ||
        appointment?.professionalId ||
        appointment?.therapist_id ||
        appointment?.therapistId ||
        "",
      ).trim();
      const professional = professionalId ? therapistMembersById[professionalId] : null;
      const label = professional
        ? formatProfessionalDisplayLabel({
            ...professional,
            name:
              professional?.name ||
              appointment?.professional_name ||
              appointment?.professionalName ||
              appointment?.therapistName,
          }, "Profissional não informado")
        : formatProfessionalDisplayLabel({
            name:
              appointment?.professional_name ||
              appointment?.professionalName ||
              appointment?.therapistName,
          }, "Profissional não informado");
      const current = professionalMap.get(label) || { label, scheduled: 0, completed: 0, cancelled: 0 };
      current.scheduled += 1;
      const status = normalizeAppointmentStatus(appointment?.status);
      if (["completed", "complete", "realizada", "concluida", "concluída"].includes(status)) current.completed += 1;
      if (["cancelled", "canceled", "cancelada", "cancelado"].includes(status)) current.cancelled += 1;
      professionalMap.set(label, current);
    });
    return {
      scheduledCount: monthAppointments.length,
      completedCount: completed.length,
      cancelledCount: cancelled.length,
      professionalRows: Array.from(professionalMap.values()).sort((a: any, b: any) => b.completed - a.completed || b.scheduled - a.scheduled),
    };
  }, [financialMonth, therapistAgenda, therapistMembersById]);
  const professionalTransferStatusOptions = [
    { value: "all", label: "Todos os status" },
    { value: "to_calculate", label: "A calcular" },
    { value: "calculated", label: "Calculado" },
    { value: "waiting_receipt", label: "Aguardando recebimento" },
    { value: "ready", label: "Pronto para repasse" },
    { value: "paid", label: "Pago" },
    { value: "blocked", label: "Bloqueado" },
    { value: "cancelled", label: "Cancelado" },
    { value: "review", label: "Revisão necessária" },
  ];
  const normalizeProfessionalTransferStatus = (payment: any) => {
    const raw = String(payment?.transfer_status || payment?.transferStatus || payment?.status || "").toLowerCase();
    if (["paid", "pago"].includes(raw)) return { key: "paid", label: "Pago", className: "bg-emerald-100 text-emerald-700" };
    if (["blocked", "glosa", "denied"].includes(raw)) return { key: "blocked", label: "Bloqueado", className: "bg-rose-100 text-rose-700" };
    if (["review", "revision", "revisao"].includes(raw)) return { key: "review", label: "Revisão necessária", className: "bg-amber-100 text-amber-800" };
    if (["cancelled", "canceled", "cancelado"].includes(raw)) return { key: "cancelled", label: "Cancelado", className: "bg-slate-100 text-slate-500" };
    if (["calculated", "calculado"].includes(raw)) return { key: "calculated", label: "Calculado", className: "bg-blue-100 text-blue-700" };
    if (["waiting_receipt", "aguardando_recebimento"].includes(raw)) return { key: "waiting_receipt", label: "Aguardando recebimento", className: "bg-amber-100 text-amber-800" };
    if (["pending", "ready", "pronto"].includes(raw)) return { key: "ready", label: "Pronto para repasse", className: "bg-violet-100 text-[#7a32fc]" };
    return { key: "to_calculate", label: "A calcular", className: "bg-slate-100 text-slate-600" };
  };
  const formatProfessionalPaymentDisplayName = useCallback((payment: any) => {
    const professionalId = String(payment?.professional_id || payment?.professionalId || "").trim();
    const member = professionalId ? therapistMembersById[professionalId] : null;
    if (member) {
      return formatProfessionalDisplayLabel({
        ...member,
        name:
          member?.name ||
          payment?.professional_name ||
          payment?.professionalName,
      }, "Profissional");
    }
    return formatProfessionalDisplayLabel({
      professional_name: payment?.professional_name || payment?.professionalName,
      specialty:
        payment?.professional_specialty ||
        payment?.professionalSpecialty ||
        payment?.specialty,
    }, "Profissional");
  }, [therapistMembersById]);
  const professionalTransferRows = useMemo(() => {
    return (financialDashboard.professionalPayments || [])
      .filter((payment: any) => {
        const professionalId = String(payment?.professional_id || payment?.professionalId || "").trim();
        if (professionalTransferProfessionalFilter !== "all" && professionalId !== professionalTransferProfessionalFilter) return false;
        const status = normalizeProfessionalTransferStatus(payment);
        if (professionalTransferStatusFilter !== "all" && status.key !== professionalTransferStatusFilter) return false;
        return true;
      })
      .map((payment: any) => {
        const status = normalizeProfessionalTransferStatus(payment);
        const baseAmount = parseCurrencyValue(payment?.base_amount ?? payment?.baseAmount ?? payment?.amount);
        const adjustment = parseCurrencyValue(payment?.additional_amount ?? payment?.additionalAmount ?? 0);
        const netAmount = parseCurrencyValue(payment?.amount);
        return {
          ...payment,
          status,
          baseAmount,
          adjustment,
          netAmount,
          professionalDisplayName: formatProfessionalPaymentDisplayName(payment),
          paymentOrigin: payment?.origin || payment?.payment_origin || "Registro financeiro interno",
          ruleLabel: payment?.rule_label || payment?.ruleLabel || "Regra manual/contratual",
          adjustmentReason: payment?.adjustment_reason || payment?.adjustmentReason || payment?.notes || "",
        };
      });
  }, [financialDashboard.professionalPayments, professionalTransferProfessionalFilter, professionalTransferStatusFilter, formatProfessionalPaymentDisplayName]);

  const financialProjectedVsRealizedRows = useMemo(() =>
    financialDashboard.revenueRows.map((row: any) => ({
      name: row.month,
      monthFull: row.monthFull,
      Projetado: row.projected,
      Realizado: row.realized,
    })),
  [financialDashboard.revenueRows]);

  const financialRevenueOriginRows = useMemo(() => {
    const originMap = new Map<string, any>();
    financialDashboard.payerRows.forEach((row: any) => {
      const name = normalizeRevenueOriginLabel(row.label);
      const current = originMap.get(name) || {
        name,
        Receita: 0,
        Participação: 0,
        Quantidade: 0,
        color: getRevenueOriginColor(name),
      };
      current.Receita += Number(row.amount) || 0;
      current.Quantidade += Number(row.patients) || 0;
      originMap.set(name, current);
    });
    const total = Array.from(originMap.values()).reduce((sum: number, row: any) => sum + (Number(row.Receita) || 0), 0);
    return Array.from(originMap.values())
      .map((row: any) => ({
        ...row,
        Participação: total > 0 ? (row.Receita / total) * 100 : 0,
      }))
      .sort((a: any, b: any) => b.Receita - a.Receita);
  }, [financialDashboard.payerRows]);

  const financialRevenueSpecialtyRows = useMemo(() =>
    financialDashboard.specialtyRows.map((row: any) => ({
      name: row.label,
      "Receita projetada": row.projected,
      "Receita realizada": row.realized,
      Pacientes: row.patients,
    })),
  [financialDashboard.specialtyRows]);

  const financialProfitSpecialtyRows = useMemo(() =>
    financialDashboard.specialtyRows.map((row: any) => ({
      name: row.label,
      Receita: row.realized || row.projected,
      Repasses: row.professionalPaid,
      "Despesas alocadas": row.allocatedOperationalExpenses,
      "Lucro estimado": row.netProfit,
      "Margem %": row.netMarginPct,
    })),
  [financialDashboard.specialtyRows]);

  const financialProfessionalPayoutRows = useMemo(() => {
    const rows = new Map<string, any>();
    financialDashboard.professionalPayments.forEach((payment: any) => {
      const name = formatProfessionalPaymentDisplayName(payment);
      const current = rows.get(name) || {
        name,
        Pago: 0,
        "Pendente/pronto": 0,
        "Bloqueado/revisão": 0,
        Total: 0,
      };
      const amount = parseCurrencyValue(payment?.amount);
      const status = normalizeProfessionalTransferStatus(payment).key;
      if (status === "paid") current.Pago += amount;
      else if (["blocked", "review", "cancelled"].includes(status)) current["Bloqueado/revisão"] += amount;
      else current["Pendente/pronto"] += amount;
      current.Total += amount;
      rows.set(name, current);
    });
    return Array.from(rows.values()).sort((a: any, b: any) => b.Total - a.Total);
  }, [financialDashboard.professionalPayments, formatProfessionalPaymentDisplayName]);

  const financialReceivablesStatusRows = useMemo(() => [
    { name: "Recebido", Valor: financialDashboard.realized, Quantidade: financialDashboard.paidPayments.length },
    { name: "A receber", Valor: financialDashboard.pendingAmount, Quantidade: financialDashboard.pendingPayments.length },
    { name: "Em atraso", Valor: financialDashboard.overdueAmount, Quantidade: financialDashboard.overduePayments.length },
    { name: "Cancelado", Valor: financialDashboard.cancelledAmount, Quantidade: financialDashboard.cancelledPayments.length },
  ], [
    financialDashboard.cancelledAmount,
    financialDashboard.cancelledPayments.length,
    financialDashboard.overdueAmount,
    financialDashboard.overduePayments.length,
    financialDashboard.paidPayments.length,
    financialDashboard.pendingAmount,
    financialDashboard.pendingPayments.length,
    financialDashboard.realized,
  ]);

  const financialCashFlowRows = useMemo(() =>
    financialDashboard.revenueRows.map((row: any) => ({
      name: row.month,
      "Receita realizada": row.realized,
      "Resultado estimado": row.profit,
      monthFull: row.monthFull,
    })),
  [financialDashboard.revenueRows]);

  const hasFinancialChartData = (rows: any[], keys: string[]) =>
    rows.some((row) => keys.some((key) => Math.abs(Number(row?.[key]) || 0) > 0));

  const financialChartGridColor = theme === "dark" ? "#334155" : "#F1F5F9";
  const financialChartAxisColor = theme === "dark" ? "#CBD5E1" : "#94A3B8";
  const financialChartStrongAxisColor = theme === "dark" ? "#E2E8F0" : "#64748B";
  const financialChartCursorColor = theme === "dark" ? "rgba(148, 163, 184, 0.08)" : "#F8FAFC";

  const renderFinancialTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload || {};
    const title = row.monthFull ? `Mês: ${row.monthFull}` : row.name || label;
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-3 text-xs shadow-xl">
        <p className="mb-2 font-semibold text-slate-900">{title}</p>
        <div className="space-y-1">
          {payload.map((item: any) => (
            <p key={`${item.name}-${item.dataKey}`} className="flex items-center justify-between gap-4 text-slate-600">
              <span>{item.name}</span>
              <span className="font-semibold text-slate-900">{formatCurrency(item.value)}</span>
            </p>
          ))}
        </div>
        {typeof row.Participação === "number" && (
          <p className="mt-2 text-slate-500">Participação: {row.Participação.toFixed(1)}%</p>
        )}
        {typeof row.Quantidade === "number" && (
          <p className="mt-1 text-slate-500">Quantidade: {row.Quantidade}</p>
        )}
        {typeof row["Margem %"] === "number" && (
          <p className="mt-1 text-slate-500">Margem: {row["Margem %"].toFixed(1)}%</p>
        )}
      </div>
    );
  };

  const renderFinancialChartCard = (
    chartId: string,
    title: string,
    description: string,
    hasData: boolean,
    chart: React.ReactNode,
    legend?: React.ReactNode,
  ) => (
    <div data-financial-chart={chartId} className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm">
      <div>
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      {hasData ? (
        <>
          <div className="mt-4 h-64 min-h-[260px]">{chart}</div>
          {legend}
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
          Ainda não há dados suficientes para este gráfico no período selecionado.
        </div>
      )}
    </div>
  );

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
      onNavigateTissPreGuides={
        ["owner", "admin", "coordinator"].includes(String(user?.role || "").toLowerCase())
          ? () =>
              navigateToTab("conference", {
                tab: "conference",
                breadcrumb: ["Pré-faturamento TISS", "Pré-guias TISS"],
                conferenceTab: "preGuides",
                tissPanel: "preGuides",
              })
          : undefined
      }
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
                <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <input
                    type="checkbox"
                    checked={newRoom.preventOverlappingAppointments !== false}
                    onChange={(e) => setNewRoom({ ...newRoom, preventOverlappingAppointments: e.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                  />
                  <span>
                    <span className="block text-xs font-bold text-slate-800">Impedir sobreposição nesta sala</span>
                    <span className="mt-1 block text-[10px] font-medium leading-relaxed text-slate-400">
                      Quando ativo, a agenda bloqueia mais de uma consulta no mesmo horário usando esta sala.
                    </span>
                  </span>
                </label>
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
                      setNewRoom({ name: "", specialties: "", preventOverlappingAppointments: true });
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
                  const roomPreventsOverlap = room.prevent_overlapping_appointments !== false && room.preventOverlappingAppointments !== false;
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
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                            roomPreventsOverlap
                              ? "border-amber-100 bg-amber-50 text-amber-700"
                              : "border-emerald-100 bg-emerald-50 text-emerald-700"
                          }`}>
                            {roomPreventsOverlap ? "Bloqueia sobreposição" : "Permite simultâneas"}
                          </span>
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
                src={VERTO_BRAND_ASSETS.symbol}
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
                  src={VERTO_BRAND_ASSETS.symbol}
                  alt="Símbolo da Verto"
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
                    stroke={financialChartGridColor}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: financialChartAxisColor, fontSize: 10, fontWeight: "bold" }}
                    padding={{ left: 30, right: 30 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: financialChartAxisColor, fontSize: 10, fontWeight: "bold" }}
                  />
                  <Tooltip
                    cursor={{ fill: financialChartCursorColor }}
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

  const payerIntent = (section: PayerNavigationSection, label: string): FinancialNavigationIntent => ({
    tab: "payers",
    breadcrumb: ["Convênios e TISS", label],
    payerSection: section,
  });
  const conferenceIntent = (
    label: string,
    conferenceTab: ConferenceNavigationTab,
    tissPanel?: TissPreGuidePanel,
    group: "Pré-faturamento TISS" | "Fechamento" = "Pré-faturamento TISS",
  ): FinancialNavigationIntent => ({
    tab: "conference",
    breadcrumb: [group, label],
    conferenceTab,
    tissPanel,
  });
  const patientAuthorizationsIntent = (): FinancialNavigationIntent => ({
    tab: "patientAuthorizations",
    breadcrumb: ["Convênios e TISS", "Autorizações dos pacientes"],
  });
  const financialIntent = (label: string): FinancialNavigationIntent => ({
    tab: "financial",
    breadcrumb: ["Financeiro", label],
  });

  const navigationGroups: NavigationNode[][] = [
    [
      {
        id: "care-root",
        label: "Atendimento",
        icon: ClipboardList,
        children: [
          { id: "dashboard", label: "Painel", icon: LayoutDashboard },
          { id: "agenda", label: "Agenda", icon: CalendarDays },
          { id: "patients", label: "Pacientes", icon: ClipboardList },
          { id: "birthdays", label: "Aniversariantes", icon: Heart },
          { id: "protocols", label: "Protocolos", icon: BookOpenCheck },
        ],
      },
    ],
    [
      {
        id: "tiss-root",
        label: "Convênios e TISS",
        icon: KeyRound,
        children: [
          {
            id: "payer-convenios",
            label: "Convênios",
            icon: KeyRound,
            tab: "payers",
            intent: payerIntent("convenios", "Convênios"),
            aliases: [
              { id: "payer-prices", label: "Tabela de valores", intent: payerIntent("prices", "Tabela de valores") },
              { id: "payer-tuss", label: "De/Para TUSS", intent: payerIntent("tuss", "De/Para TUSS") },
              { id: "payer-rules", label: "Regras TISS", intent: payerIntent("rules", "Regras TISS") },
            ],
          },
          { id: "patient-authorizations", label: "Autorizações dos pacientes", icon: ClipboardCheck, tab: "patientAuthorizations", intent: patientAuthorizationsIntent() },
        ],
      },
    ],
    [
      {
        id: "prebilling-root",
        label: "Pré-faturamento TISS",
        icon: FileChartColumnIncreasing,
        children: [
          {
            id: "prebilling-preguides",
            label: "Pré-guias TISS",
            icon: ClipboardCheck,
            tab: "conference",
            intent: conferenceIntent("Pré-guias TISS", "preGuides", "preGuides"),
            aliases: [
              { id: "prebilling-conference", label: "Conferência", intent: conferenceIntent("Conferência", "sessions") },
              { id: "prebilling-pending", label: "Pendências", intent: conferenceIntent("Pendências", "sessions") },
            ],
          },
          { id: "prebilling-batches", label: "Lotes XML", icon: FileText, tab: "conference", intent: conferenceIntent("Lotes XML", "preGuides", "xmlDrafts") },
        ],
      },
    ],
    [
      {
        id: "finance-root",
        label: "Financeiro",
        icon: DollarSign,
        badge: "BETA",
        children: [
          {
            id: "finance-dashboard",
            label: "Dashboard financeiro",
            icon: LayoutDashboard,
            tab: "financial",
            intent: financialIntent("Dashboard financeiro"),
            clinicFinanceOnly: true,
            aliases: [
              { id: "finance-clinic-internal", label: "Financeiro da clínica", intent: financialIntent("Dashboard financeiro") },
              { id: "finance-overview", label: "Visão geral da clínica", intent: financialIntent("Dashboard financeiro") },
              { id: "clinical-dashboard", label: "Dashboard financeiro", intent: financialIntent("Dashboard financeiro") },
            ],
          },
          { id: "clinical-revenue", label: "Receitas", icon: ArrowUpRight, tab: "financial", intent: financialIntent("Receitas"), clinicFinanceOnly: true },
          { id: "clinical-expenses", label: "Despesas", icon: ArrowDownRight, tab: "financial", intent: financialIntent("Despesas"), clinicFinanceOnly: true },
          { id: "clinical-cashflow", label: "Fluxo de caixa", icon: TrendingUp, tab: "financial", intent: financialIntent("Fluxo de caixa"), clinicFinanceOnly: true },
          { id: "clinical-transfers", label: "Repasses a profissionais", icon: CreditCard, tab: "financial", intent: financialIntent("Repasses a profissionais"), clinicFinanceOnly: true },
          { id: "clinical-payers", label: "Convênios e lotes", icon: FileSpreadsheet, tab: "financial", intent: financialIntent("Convênios e lotes"), clinicFinanceOnly: true },
          {
            id: "finance-patient-operations",
            label: "Financeiro de pacientes",
            icon: ReceiptText,
            tab: "financial",
            intent: financialIntent("Financeiro de pacientes"),
            aliases: [
              { id: "patient-receivables", label: "Recebimentos de pacientes", intent: financialIntent("Recebimentos de pacientes") },
              { id: "patient-charges", label: "Cobranças", intent: financialIntent("Cobranças") },
              { id: "patient-overdue", label: "Pendências", intent: financialIntent("Pendências de pacientes") },
              { id: "patient-receipts", label: "Recibos e comprovantes", intent: financialIntent("Recibos") },
            ],
          },
          {
            id: "finance-reports",
            label: "Relatórios",
            icon: FileChartColumnIncreasing,
            clinicFinanceOnly: true,
            children: [
              { id: "report-production", label: "Produção", icon: PieChart, tab: "financial", intent: financialIntent("Relatórios de Produção"), clinicFinanceOnly: true },
              { id: "report-billing", label: "Faturamento", icon: ReceiptText, tab: "financial", intent: financialIntent("Relatórios de Faturamento"), clinicFinanceOnly: true },
            ],
          },
        ],
      },
    ],
    [
      {
        id: "settings-root",
        label: "Configurações",
        icon: ShieldCheck,
        children: [
          { id: "settings-clinic", label: "Clínica", icon: ShieldCheck, tab: "settings" },
          { id: "settings-team", label: "Profissionais", icon: Users, tab: "team" },
          { id: "settings-rooms", label: "Salas", icon: DoorOpen, tab: "rooms" },
          { id: "settings-billing", label: "Assinatura", icon: CreditCard, tab: "billing" },
          { id: "settings-logs", label: "Log de atividades", icon: History, tab: "logs" },
        ],
      },
    ],
    [{ id: "flow", label: "Verto Flow", icon: Zap, badge: "EM BREVE" }],
  ];

  const filterNavigationNode = (item: NavigationNode): NavigationNode | null => {
    if (item.clinicFinanceOnly && !canAccessClinicFinance) return null;
    if (item.patientFinanceOnly && !isReceptionist && !canAccessClinicFinance) return null;
    if (item.children?.length) {
      const children = item.children.map(filterNavigationNode).filter(Boolean) as NavigationNode[];
      return children.length ? { ...item, children } : null;
    }
    const targetTab = item.tab || (item.id as DashboardTab);
    return canAccessTab(targetTab) ? item : null;
  };

  const visibleNavigationGroups = navigationGroups
    .map((group) => group.map(filterNavigationNode).filter(Boolean) as NavigationNode[])
    .filter((group) => group.length > 0);

  const isFinancialBreadcrumbActive = (breadcrumb?: string[]) =>
    Boolean(
      breadcrumb?.length &&
        financialNavigationContext.breadcrumb.join(" > ") === breadcrumb.join(" > "),
    );

  const isNavigationNodeActive = (item: NavigationNode): boolean => {
    if (item.aliases?.some((alias) => activeTab === alias.intent.tab && isFinancialBreadcrumbActive(alias.intent.breadcrumb))) return true;
    if (item.intent?.breadcrumb) return activeTab === item.intent.tab && isFinancialBreadcrumbActive(item.intent.breadcrumb);
    if (item.tab) return activeTab === item.tab;
    return Boolean(item.children?.some(isNavigationNodeActive));
  };

  const toggleNavigationSection = (itemId: string) => {
    setExpandedNavigationSections((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }));
  };

  const handleNavigationNodeSelect = (item: NavigationNode) => {
    if (item.children?.length) {
      toggleNavigationSection(item.id);
      return false;
    }
    const targetTab = item.intent?.tab || item.tab || (item.id as DashboardTab);
    navigateToTab(targetTab, item.intent);
    return true;
  };

  const findFirstNavigationLeaf = (item: NavigationNode): NavigationNode | null => {
    if (!item.children?.length) return item;
    for (const child of item.children) {
      const leaf = findFirstNavigationLeaf(child);
      if (leaf) return leaf;
    }
    return null;
  };

  const renderNavigationGroups = ({
    expanded,
    iconSize,
    onNavigate,
  }: {
    expanded: boolean;
    iconSize: number;
    onNavigate?: () => void;
  }) => {
    const renderNode = (item: NavigationNode, depth = 0): React.ReactNode => {
      const hasChildren = Boolean(item.children?.length);
      const isOpen = expandedNavigationSections[item.id] !== false;
      const isActive = isNavigationNodeActive(item);
      const Icon = item.icon;
      const indentClass = depth === 0 ? "" : depth === 1 ? "ml-3" : "ml-6";

      return (
        <div key={item.id} className={depth === 0 ? "space-y-1" : "space-y-1"}>
          <button
            type="button"
            onClick={() => {
              const collapsedLeaf = !expanded && hasChildren ? findFirstNavigationLeaf(item) : null;
              const navigated = collapsedLeaf ? handleNavigationNodeSelect(collapsedLeaf) : handleNavigationNodeSelect(item);
              if (navigated) onNavigate?.();
            }}
            className={`w-full flex items-center ${
              expanded ? `gap-3 px-3 ${indentClass}` : "justify-center"
            } min-h-10 py-2.5 rounded-xl transition-all font-medium ${depth > 0 ? "text-xs" : "text-sm"} ${
              isActive
                ? "text-[#7a32fc] bg-violet-50 shadow-sm ring-1 ring-violet-100"
                : hasChildren && depth > 0
                  ? "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
            }`}
            title={!expanded ? item.label : ""}
          >
            <Icon size={depth > 0 ? Math.max(14, iconSize - 3) : iconSize} />
            {expanded && (
              <>
                <span className="min-w-0 truncate">{item.label}</span>
                {item.badge && (
                  <span className="ml-auto shrink-0 rounded-full bg-violet-50 px-1.5 py-0.5 text-[8px] font-semibold text-[#7a32fc] ring-1 ring-violet-100">
                    {item.badge}
                  </span>
                )}
                {hasChildren && (
                  <ChevronRight
                    size={14}
                    className={`ml-auto shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                )}
              </>
            )}
          </button>
          {expanded && hasChildren && isOpen && (
            <div className="space-y-1">
              {item.children?.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-5">
        {visibleNavigationGroups.map((group, groupIndex) => (
          <div key={`navigation-group-${groupIndex}`} className={`${groupIndex > 0 ? "border-t border-slate-100 pt-4" : ""} space-y-2`}>
            {group.map((item) => renderNode(item))}
          </div>
        ))}
      </div>
    );
  };

  const patientRegistrationFinancialPlans = normalizePatientFinancialPlans(newPatientForm.financialPlans, newPatientForm);
  const patientRegistrationHasLegacyData = patientRegistrationFinancialPlans.some(
    (plan: any) => Boolean(plan.authorizationCode || plan.authorizationValidUntil),
  );
  const patientRegistrationHasSuggestedTissAuthorization = patientTissAuthorizationGroups.some((group: any) => Boolean(group.suggestedAuthorization));
  const patientRegistrationHasFinancialPlanWithoutValue = patientRegistrationFinancialPlans.some(
    (plan: any) => !["COURTESY", "OTHER"].includes(String(plan.billingMode || "")) && Number(plan.amountCents || 0) <= 0,
  );
  const patientRegistrationInsuranceIncomplete =
    newPatientForm.convenioTipo === "convenio" &&
    (!String(newPatientForm.convenioNome || "").trim() ||
      !String(newPatientForm.convenioCarteirinha || "").trim() ||
      !String(newPatientForm.convenioPlanoCategoria || "").trim());
  const patientRegistrationTabs: Array<{ id: PatientRegistrationTab; label: string; badge?: string }> = [
    { id: "personal", label: "Dados pessoais" },
    { id: "insurance", label: "Convênio e elegibilidade", badge: patientRegistrationInsuranceIncomplete ? "Atenção" : undefined },
    ...(canAccessClinicFinance
      ? [
          { id: "tiss" as PatientRegistrationTab, label: "Autorizações TISS", badge: newPatientForm.convenioTipo === "convenio" && !patientRegistrationHasSuggestedTissAuthorization ? "Sem vigente" : undefined },
          { id: "financial" as PatientRegistrationTab, label: "Plano financeiro", badge: patientRegistrationHasFinancialPlanWithoutValue ? "Revisar" : undefined },
          { id: "legacy" as PatientRegistrationTab, label: "Histórico / dados legados", badge: patientRegistrationHasLegacyData ? "Legado" : undefined },
        ]
      : [{ id: "legacy" as PatientRegistrationTab, label: "Histórico / dados legados", badge: patientRegistrationHasLegacyData ? "Legado" : undefined }]),
  ];

  const selectedProfileEligibility = normalizePatientInsuranceEligibility(selectedPatientProfile || {});
  const selectedProfileFinancialPlans = normalizePatientFinancialPlans(
    selectedPatientProfile?.financialPlans || selectedPatientProfile?.financial_plans || [],
    selectedPatientProfile || {},
  );
  const selectedProfileAuthorizationGroups = groupPatientTissAuthorizations(selectedPatientProfileAuthorizations);
  const selectedProfileSuggestedAuthorization =
    selectedProfileAuthorizationGroups.find((group: any) => group.suggestedAuthorization)?.suggestedAuthorization || null;
  const selectedProfilePrimaryFinancialPlan =
    selectedProfileFinancialPlans.find((plan: any) => String(plan.status || "ACTIVE").toUpperCase() === "ACTIVE") ||
    selectedProfileFinancialPlans[0] ||
    null;
  const selectedProfileAuthorizationStates = selectedPatientProfileAuthorizations.map((authorization: any) =>
    getPatientTissAuthorizationVisualState(authorization),
  );
  const selectedProfileOperationalAlerts = (() => {
    const alerts: string[] = [];
    if (
      selectedProfileEligibility.convenioTipo === "convenio" &&
      (!selectedProfileEligibility.convenioNome ||
        !selectedProfileEligibility.convenioCarteirinha ||
        !selectedProfileEligibility.convenioPlanoCategoria)
    ) {
      alerts.push("Convênio incompleto");
    }
    if (
      selectedProfileEligibility.convenioTipo === "convenio" &&
      !selectedPatientProfileAuthorizationsLoading &&
      selectedPatientProfileAuthorizations.length > 0 &&
      !selectedProfileSuggestedAuthorization
    ) {
      alerts.push("Sem autorização TISS vigente");
    }
    if (!selectedProfileSuggestedAuthorization && selectedProfileAuthorizationStates.some((state) => state.status === "expired")) {
      alerts.push("Autorização TISS vencida");
    }
    if (!selectedProfileSuggestedAuthorization && selectedProfileAuthorizationStates.some((state) => state.status === "consumed")) {
      alerts.push("Autorização TISS consumida");
    }
    if (selectedPatientProfileAuthorizations.some((authorization: any) => authorization && !authorization.tussCode && !authorization.tussCodeId)) {
      alerts.push("Sem De/Para TUSS ativo");
    }
    const relevantAuthorizationForPrice = selectedProfileSuggestedAuthorization ||
      selectedPatientProfileAuthorizations.find((authorization: any, index: number) => authorization && selectedProfileAuthorizationStates[index]?.isCurrent);
    if (relevantAuthorizationForPrice && Number(
      relevantAuthorizationForPrice.amountCents ??
      relevantAuthorizationForPrice.negotiatedAmountCents ??
      relevantAuthorizationForPrice.unitAmountCents ??
      0,
    ) <= 0) {
      alerts.push("Sem preço negociado ativo");
    }
    if (selectedProfilePrimaryFinancialPlan && Number(selectedProfilePrimaryFinancialPlan.amountCents || 0) <= 0) {
      alerts.push("Plano financeiro sem valor");
    }
    return alerts;
  })();

  const renderPatientProfileSummaryField = (label: string, value: any, className = "") => (
    <div className={className}>
      <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</span>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value || "-"}</p>
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
      <div className="h-screen overflow-hidden bg-[#F4F7FE] flex">
        {/* Sidebar */}
        <div
          className={`${patientSidebarExpanded ? "w-64" : "w-20"} h-screen shrink-0 overflow-hidden bg-white hidden lg:flex flex-col px-4 py-4 border-r border-slate-100 transition-all duration-300 ease-in-out z-20`}
        >
          <div
            className={`flex shrink-0 items-center ${patientSidebarExpanded ? "gap-2" : "flex-col justify-center gap-2"} mb-5 px-1 transition-all duration-300`}
          >
            <LogoVerto size={patientSidebarExpanded ? 30 : 38} showText={patientSidebarExpanded} />
            {patientSidebarExpanded && <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Gestão</span>}
            <button
              type="button"
              onClick={toggleSidebarExpanded}
              className={`${patientSidebarExpanded ? "ml-auto" : ""} rounded-xl border border-slate-100 bg-white p-2 text-slate-400 shadow-sm transition-all hover:bg-violet-50 hover:text-[#7a32fc]`}
              aria-label={patientSidebarExpanded ? "Recolher menu lateral" : "Expandir menu lateral"}
              title={patientSidebarExpanded ? "Recolher menu" : "Expandir menu"}
            >
              {patientSidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto no-scrollbar pr-1">
            {renderNavigationGroups({
              expanded: patientSidebarExpanded,
              iconSize: 20,
              onNavigate: () => {
                setView("home");
              },
            })}
          </nav>

          <div className="mt-auto shrink-0 pt-3 border-t border-slate-50">
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
              className={`w-full flex items-center ${patientSidebarExpanded ? "gap-3 justify-start px-3" : "justify-center px-2"} py-2.5 text-slate-400 hover:text-[#7a32fc] hover:bg-violet-50 rounded-xl transition-all font-bold text-sm`}
            >
              <LogOut size={18} />
              {patientSidebarExpanded && "Sair do Sistema"}
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="h-screen min-w-0 flex-1 overflow-y-auto">
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
                      <LogoVerto size={32} showText={true} />
                    </div>
                    <button
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="p-2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={24} />
                    </button>
                  </div>

                  <nav className="flex-1 overflow-y-auto no-scrollbar">
                    {renderNavigationGroups({
                      expanded: true,
                      iconSize: 18,
                      onNavigate: () => {
                        setView("home");
                        setIsMobileMenuOpen(false);
                      },
                    })}
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
                  user?.workspaceName ||
                  "Clínica Verto",
                cnpj: user?.clinicSettings?.clinicCnpj || "",
                phone: user?.clinicSettings?.clinicPhone || "",
                email: user?.clinicSettings?.clinicEmail || "",
                address: user?.clinicSettings?.clinicAddress || "",
                logoUrl: user?.clinicSettings?.clinicLogoUrl || null,
                professionalName: user?.name || "Profissional responsável",
                crp: user?.crp || user?.clinicSettings?.crp || "",
                professionalCpf:
                  user?.cpf ||
                  user?.professionalProfile?.cpf ||
                  user?.professionalProfile?.metadata?.cpf ||
                  "",
                professionalRoleTitle:
                  user?.professionalRoleTitle ||
                  user?.professionalProfile?.roleTitle ||
                  user?.professionalProfile?.metadata?.roleTitle ||
                  "",
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
                      return onUpdatePatient(updates);
                    }
                  : undefined
              }
              onRecordTrial={
                onRecordTrial
                  ? (pid: any, title: string, score: number, evalComment?: string, sessionMeta?: any) => {
                      if (!ensureTherapistClinicalProfile()) return null;
                      return onRecordTrial(pid, title, score, evalComment, sessionMeta);
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

  return (
    <div className="h-screen overflow-hidden bg-[#F4F7FE] flex">
      {/* Sidebar */}
      <aside
        className={`${isSidebarExpanded ? 'w-64' : 'w-20'} h-screen shrink-0 overflow-hidden bg-white hidden lg:flex flex-col px-4 py-4 border-r border-slate-100 transition-all duration-300 ease-in-out z-20`}
      >
        <div className={`flex shrink-0 items-center ${isSidebarExpanded ? 'gap-2' : 'flex-col justify-center gap-2'} mb-5 px-1 transition-all duration-300`}>
          <LogoVerto size={isSidebarExpanded ? 30 : 38} showText={isSidebarExpanded} />
          {isSidebarExpanded && <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Gestão</span>}
          <button
            type="button"
            onClick={toggleSidebarExpanded}
            className={`${isSidebarExpanded ? "ml-auto" : ""} rounded-xl border border-slate-100 bg-white p-2 text-slate-400 shadow-sm transition-all hover:bg-violet-50 hover:text-[#7a32fc]`}
            aria-label={isSidebarExpanded ? "Recolher menu lateral" : "Expandir menu lateral"}
            title={isSidebarExpanded ? "Recolher menu" : "Expandir menu"}
          >
            {isSidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto no-scrollbar pr-1">
          {renderNavigationGroups({
            expanded: isSidebarExpanded,
            iconSize: 20,
          })}
        </nav>

        <div className="mt-auto shrink-0 pt-3 border-t border-slate-50">
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
            className={`w-full flex items-center ${isSidebarExpanded ? 'gap-3 px-4' : 'justify-center'} py-3 text-slate-400 hover:text-[#7a32fc] hover:bg-violet-50 rounded-2xl transition-all font-bold text-sm`}
            title={!isSidebarExpanded ? "Sair" : ""}
          >
            <LogOut size={20} />
            {isSidebarExpanded && <span>Sair do Sistema</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="h-screen min-w-0 flex-1 overflow-y-auto relative z-10">
        {/* Header */}
        <header
          className={`px-4 lg:px-8 ${activeTab === "dashboard" ? "py-5 lg:py-6" : activeTab === "agenda" ? "py-2.5" : "py-4"} flex items-center justify-between sticky top-0 backdrop-blur-md z-30 ${
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
              {activeTab !== "agenda" && (
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${theme === "dark" ? "text-slate-300" : "text-slate-500"}`}>
                  {["financial", "payers", "patientAuthorizations", "conference", "closure"].includes(activeTab)
                    ? financialNavigationContext.breadcrumb.join(" > ")
                    : activeTab === "rooms" && !isEditingRooms
                    ? "Salas"
                    : activeTab === "dashboard"
                      ? "Painel"
                      : `Páginas / ${tabLabels[activeTab] || "Painel"}`}
                </p>
              )}
              <h1 className={`text-base lg:text-2xl font-semibold tracking-tight ${theme === "dark" ? "text-slate-100" : "text-slate-900"} ${activeTab === "dashboard" ? "max-w-[980px] leading-snug" : "capitalize"}`}>
                {["financial", "payers", "patientAuthorizations", "conference", "closure"].includes(activeTab)
                  ? financialNavigationContext.breadcrumb[financialNavigationContext.breadcrumb.length - 1] || tabLabels[activeTab]
                  : activeTab === "rooms" && !isEditingRooms
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
                    <LogoVerto size={32} showText={true} />
                  </div>
                  <button
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={24} />
                  </button>
                </div>

                <nav className="flex-1 overflow-y-auto no-scrollbar">
                  {renderNavigationGroups({
                    expanded: true,
                    iconSize: 18,
                    onNavigate: () => {
                      setIsMobileMenuOpen(false);
                    },
                  })}
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

        <main className={`px-4 lg:px-8 pt-2 ${activeTab === "agenda" ? "pb-2" : "pb-16"}`}>
          {isPaymentModalOpen && (
            <div
              className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-fade-in sm:items-center"
              onClick={() => {
                setIsPaymentModalOpen(false);
                setEditingPayment(null);
              }}
            >
              <div
                className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl animate-pop"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setIsPaymentModalOpen(false);
                    setEditingPayment(null);
                  }}
                  className="absolute right-5 top-5 z-10 text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
                <div className="flex-shrink-0 border-b border-slate-100 px-6 py-5 pr-14">
                  <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                    <DollarSign size={22} className="text-[#7a32fc]" /> Registrar pagamento
                  </h2>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Cobrança, recebimento, recorrência e comprovante do paciente.
                  </p>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
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
                </div>
                <div className="flex-shrink-0 border-t border-slate-100 bg-white p-4">
                  <button
                    onClick={handleAddPayment}
                    className="w-full rounded-2xl bg-[#7a32fc] py-4 text-sm font-semibold text-white shadow-lg shadow-purple-500/20"
                  >
                    {paymentReceipt ? "Confirmar pagamento" : "Registrar cobrança pendente"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {isProfessionalPaymentModalOpen && (
            <div
              className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-fade-in sm:items-center"
              onClick={() => {
                setIsProfessionalPaymentModalOpen(false);
                setEditingProfessionalPayment(null);
                setProfessionalPaymentAdjustmentReason("");
              }}
            >
              <div
                className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl animate-pop"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setIsProfessionalPaymentModalOpen(false);
                    setEditingProfessionalPayment(null);
                    setProfessionalPaymentAdjustmentReason("");
                  }}
                  className="absolute top-6 right-6 text-gray-400 hover:text-gray-600"
                >
                  <X size={24} />
                </button>
                <div className="shrink-0 border-b border-slate-100 px-8 pb-4 pt-8">
                  <h2 className="flex items-center gap-2 pr-8 text-2xl font-bold text-slate-900">
                    <CreditCard size={24} className="text-[#7a32fc]" /> Registrar repasse
                  </h2>
                  <p className="mt-1 pr-8 text-xs text-slate-500">
                    Cadastre ou revise pagamentos a profissionais com o botão salvar sempre visível.
                  </p>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-8 py-6">
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
                        <option value="to_calculate">A calcular</option>
                        <option value="calculated">Calculado</option>
                        <option value="waiting_receipt">Aguardando recebimento</option>
                        <option value="ready">Pronto para repasse</option>
                        <option value="pending">Pendente</option>
                        <option value="paid">Pago</option>
                        <option value="blocked">Bloqueado</option>
                        <option value="review">Revisão necessária</option>
                        <option value="cancelled">Cancelado</option>
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
                    <div className="mt-3">
                      <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400">
                        Motivo do ajuste manual
                      </label>
                      <textarea
                        value={professionalPaymentAdjustmentReason}
                        onChange={(e) => setProfessionalPaymentAdjustmentReason(e.target.value)}
                        className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 outline-none"
                        placeholder="Obrigatório quando houver adicional/desconto manual."
                      />
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 border-t border-slate-100 bg-white px-8 py-5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsProfessionalPaymentModalOpen(false);
                      setEditingProfessionalPayment(null);
                      setProfessionalPaymentAdjustmentReason("");
                    }}
                    className="min-h-[48px] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAddProfessionalPayment}
                    className="min-h-[48px] flex-1 rounded-2xl bg-[#7a32fc] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#6d28e8]"
                  >
                    Salvar repasse
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
            {(canAccessClinicFinance || isReceptionist) && activeTab === "financial" && (
              <motion.div
                key="financial"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {!isReceptionist && isFinancialDashboardSection && (
                  <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                          Dashboard financeiro da clínica
                        </h3>
                        <p className="text-sm text-slate-500">
                          Resumo executivo com origem dos números separada entre projetado, realizado, pendente e previsto.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                          Mês
                        </label>
                        <input
                          type="month"
                          value={financialMonth}
                          onChange={(e) => setFinancialMonth(e.target.value)}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-[#7a32fc]"
                        />
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: "Pacientes ativos", value: financialDashboard.patientCount, rawValue: financialDashboard.patientCount, hint: "Com plano financeiro ativo", semantic: "neutral" as const },
                        { label: "Receita projetada", value: formatCurrency(financialDashboard.projection), rawValue: financialDashboard.projection, hint: "Projetado: mensalidades/planos ativos no mês", semantic: "positive" as const },
                        { label: "Receita realizada", value: formatCurrency(financialDashboard.realized), rawValue: financialDashboard.realized, hint: "Realizado: pagamentos confirmados no mês", semantic: "positive" as const },
                        { label: "A receber", value: formatCurrency(financialDashboard.pendingAmount), rawValue: financialDashboard.pendingAmount, hint: "Pendente: cobranças em aberto no mês", semantic: "neutral" as const },
                        { label: "Em atraso", value: formatCurrency(financialDashboard.overdueAmount), rawValue: financialDashboard.overdueAmount, hint: "Pendente vencido no período", semantic: "negative" as const },
                        { label: "Repasses previstos", value: formatCurrency(financialDashboard.professionalPending), rawValue: financialDashboard.professionalPending, hint: "Previsto/a pagar a profissionais", semantic: "negative" as const },
                        { label: "Despesas", value: formatCurrency(financialDashboard.operationalExpenses), rawValue: financialDashboard.operationalExpenses, hint: "Realizado: saídas registradas no fluxo de caixa", semantic: "negative" as const },
                        { label: "Lucro estimado", value: formatCurrency(financialDashboard.netProfit), rawValue: financialDashboard.netProfit, hint: `Estimado: ${financialDashboard.netMarginPct.toFixed(1)}% de margem líquida`, semantic: "profit" as const },
                        { label: "Ticket médio", value: formatCurrency(financialDashboard.averageTicket), rawValue: financialDashboard.averageTicket, hint: "Projetado por paciente ativo", semantic: "neutral" as const },
                      ].map((metric) => (
                        <div key={metric.label} className="rounded-3xl bg-slate-50/80 p-5">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{metric.label}</p>
                          <p className={`mt-2 text-2xl font-semibold ${getFinancialSemanticValueClass(metric.semantic, metric.rawValue)}`}>{metric.value}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{metric.hint}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 rounded-3xl bg-slate-50 px-5 py-4 text-xs text-slate-500">
                      <p>
                        Projetado: soma dos planos ativos. Realizado: pagamentos confirmados. A receber: cobranças em aberto. Repasses: valores previstos ou pagos a profissionais. Lucro estimado: receita realizada menos repasses pagos e despesas conhecidas.
                      </p>
                    </div>

                    <div data-financial-dashboard-charts className="mt-8">
                      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <h4 className="text-lg font-semibold text-slate-900">Gráficos gerenciais</h4>
                          <p className="text-sm text-slate-500">Leituras rápidas do mês selecionado, sempre separando origem, especialidade, repasses e pendências.</p>
                        </div>
                        <span className="w-fit rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                          {formatFinancialMonthLabel(financialMonth, "long")}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                        {renderFinancialChartCard(
                          "realized-vs-projected",
                          "Realizado vs projetado por mês",
                          "Compara a receita projetada do mês com pagamentos confirmados.",
                          hasFinancialChartData(financialProjectedVsRealizedRows, ["Projetado", "Realizado"]),
                          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                            <BarChart data={financialProjectedVsRealizedRows}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={financialChartGridColor} />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                              <Tooltip content={renderFinancialTooltip} cursor={{ fill: financialChartCursorColor }} />
                              <Bar name="Projetado" dataKey="Projetado" fill="#86efac" radius={[6, 6, 0, 0]} />
                              <Bar name="Realizado" dataKey="Realizado" fill="#22c55e" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </SafeResponsiveContainer>,
                        )}

                        {renderFinancialChartCard(
                          "revenue-by-origin",
                          "Receita por origem",
                          "Mostra a composição entre particular, convênio e outras origens registradas.",
                          hasFinancialChartData(financialRevenueOriginRows, ["Receita"]),
                          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                            <RePieChart>
                              <Pie data={financialRevenueOriginRows} dataKey="Receita" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>
                                {financialRevenueOriginRows.map((entry: any, index: number) => (
                                  <Cell key={`origin-cell-${entry.name}`} fill={entry.color || COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip content={renderFinancialTooltip} />
                            </RePieChart>
                          </SafeResponsiveContainer>,
                          <div className="mt-3 flex flex-wrap gap-2">
                            {financialRevenueOriginRows.map((row: any, index: number) => (
                              <span key={row.name} className="rounded-full bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500">
                                 <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: row.color || COLORS[index % COLORS.length] }} />
                                {row.name}: {formatCurrency(row.Receita)}
                              </span>
                            ))}
                          </div>,
                        )}

                        {renderFinancialChartCard(
                          "revenue-by-specialty",
                          "Receita por especialidade",
                          "Especialidades reais, sem misturar valores sem alocação clínica.",
                          hasFinancialChartData(financialRevenueSpecialtyRows, ["Receita projetada", "Receita realizada"]),
                          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                            <BarChart data={financialRevenueSpecialtyRows}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={financialChartGridColor} />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 11 }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                              <Tooltip content={renderFinancialTooltip} cursor={{ fill: financialChartCursorColor }} />
                              <Bar name="Receita projetada" dataKey="Receita projetada" fill="#86efac" radius={[6, 6, 0, 0]} />
                              <Bar name="Receita realizada" dataKey="Receita realizada" fill="#22c55e" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </SafeResponsiveContainer>,
                        )}

                        {renderFinancialChartCard(
                          "profit-by-specialty",
                          "Lucro/margem por especialidade",
                          "Compara receita, repasses, despesas alocadas e lucro estimado por área clínica.",
                          hasFinancialChartData(financialProfitSpecialtyRows, ["Receita", "Repasses", "Despesas alocadas", "Lucro estimado"]),
                          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                            <BarChart data={financialProfitSpecialtyRows}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={financialChartGridColor} />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 11 }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                              <Tooltip content={renderFinancialTooltip} cursor={{ fill: financialChartCursorColor }} />
                              <Bar name="Receita" dataKey="Receita" fill="#22c55e" radius={[6, 6, 0, 0]} />
                              <Bar name="Repasses" dataKey="Repasses" fill="#fb7185" radius={[6, 6, 0, 0]} />
                              <Bar name="Despesas alocadas" dataKey="Despesas alocadas" fill="#ef4444" radius={[6, 6, 0, 0]} />
                              <Bar name="Lucro estimado" dataKey="Lucro estimado" fill="#22c55e" radius={[6, 6, 0, 0]} />
                            </BarChart>
                          </SafeResponsiveContainer>,
                        )}

                        {renderFinancialChartCard(
                          "transfers-by-professional",
                          "Repasses por profissional",
                          "Valores agrupados por profissional e status de repasse.",
                          hasFinancialChartData(financialProfessionalPayoutRows, ["Pago", "Pendente/pronto", "Bloqueado/revisão"]),
                          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                            <BarChart data={financialProfessionalPayoutRows} layout="vertical" margin={{ left: 16 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={financialChartGridColor} />
                              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: financialChartStrongAxisColor, fontSize: 11 }} width={110} />
                              <Tooltip content={renderFinancialTooltip} cursor={{ fill: financialChartCursorColor }} />
                              <Bar name="Pago" dataKey="Pago" stackId="repasse" fill="#22c55e" radius={[0, 6, 6, 0]} />
                              <Bar name="Pendente/pronto" dataKey="Pendente/pronto" stackId="repasse" fill="#7a32fc" radius={[0, 6, 6, 0]} />
                              <Bar name="Bloqueado/revisão" dataKey="Bloqueado/revisão" stackId="repasse" fill="#f43f5e" radius={[0, 6, 6, 0]} />
                            </BarChart>
                          </SafeResponsiveContainer>,
                        )}

                        {renderFinancialChartCard(
                          "receivables-status",
                          "Recebimentos e pendências",
                          "Composição entre recebido, a receber, em atraso e cancelado.",
                          hasFinancialChartData(financialReceivablesStatusRows, ["Valor"]),
                          <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
                            <RePieChart>
                              <Pie data={financialReceivablesStatusRows} dataKey="Valor" nameKey="name" outerRadius={95} paddingAngle={2}>
                                {financialReceivablesStatusRows.map((entry: any, index: number) => (
                                  <Cell
                                    key={`receivable-cell-${entry.name}`}
                                    fill={["#22c55e", "#7a32fc", "#f59e0b", "#94a3b8"][index % 4]}
                                  />
                                ))}
                              </Pie>
                              <Tooltip content={renderFinancialTooltip} />
                            </RePieChart>
                          </SafeResponsiveContainer>,
                          <div className="mt-3 flex flex-wrap gap-2">
                            {financialReceivablesStatusRows.map((row: any, index: number) => (
                              <span key={row.name} className="rounded-full bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500">
                                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ["#22c55e", "#7a32fc", "#f59e0b", "#94a3b8"][index % 4] }} />
                                {row.name}: {formatCurrency(row.Valor)}
                              </span>
                            ))}
                          </div>,
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!isFinancialDashboardSection && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                            {isProfessionalTransfersSection
                              ? "Repasses a profissionais"
                              : isRevenueSection
                                ? "Receitas"
                                : isExpenseSection
                                  ? "Despesas"
                                  : isCashFlowSection
                                    ? "Fluxo de caixa"
                                    : isFinancialPayerLotsSection
                                      ? "Convênios e lotes"
                                      : isProductionReportSection
                                        ? "Relatórios de produção"
                                        : isBillingReportSection
                                          ? "Relatórios de faturamento"
                              : isPatientReceivablesSection || isReceptionist
                                ? "Financeiro de pacientes"
                                : "Dashboard financeiro"}
                          </h3>
                          <p className="text-sm text-slate-500">
                            {isProfessionalTransfersSection
                              ? "Calcule, revise e acompanhe os valores a repassar para profissionais."
                              : isRevenueSection
                                ? "Recebimentos, cobranças, inadimplência e entradas confirmadas do período."
                                : isExpenseSection
                                  ? "Despesas operacionais, saídas registradas e próximos vencimentos."
                                  : isCashFlowSection
                                    ? "Entradas, saídas, saldo líquido e visão mensal de caixa."
                                    : isFinancialPayerLotsSection
                                      ? "Visão financeira de convênios, valores previstos, realizados e atalhos para lotes TISS."
                                      : isProductionReportSection
                                        ? "Produção assistencial por período, profissional e status de sessão."
                                        : isBillingReportSection
                                          ? "Faturamento por período, convênio, origem e status financeiro."
                                      : isPatientReceivablesSection || isReceptionist
                                        ? "Rotina de recepção: cobranças, recebimentos, comprovantes, recibos e pendências por paciente."
                                        : "Resumo executivo da clínica, com atalhos para as visões operacionais."}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                            Mês
                          </label>
                          <input
                            type="month"
                            value={financialMonth}
                            onChange={(e) => setFinancialMonth(e.target.value)}
                            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-[#7a32fc]"
                            />
                          </div>
                        </div>
                    </div>

                    {canAccessClinicFinance && !isPatientReceivablesSection && !isReceptionist && (
                      <div data-financial-clinic-internal-nav className="flex flex-wrap gap-2">
                        {[
                          ["Dashboard financeiro", "Dashboard"],
                          ["Receitas", "Receitas"],
                          ["Despesas", "Despesas"],
                          ["Fluxo de caixa", "Fluxo de caixa"],
                          ["Repasses a profissionais", "Repasses"],
                          ["Convênios e lotes", "Convênios e lotes"],
                        ].map(([section, label]) => {
                          const selected = activeFinancialSection === section || (section === "Dashboard financeiro" && ["Visão geral da clínica", "Financeiro da clínica"].includes(activeFinancialSection));
                          return (
                            <button
                              key={section}
                              type="button"
                              onClick={() => navigateToTab("financial", financialIntent(section))}
                              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                                selected
                                  ? "bg-[#7a32fc] text-white shadow-sm shadow-purple-500/10"
                                  : "border border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:text-[#7a32fc]"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {(isPatientReceivablesSection || isReceptionist) && (
                <div className="grid gap-3 md:grid-cols-2">
                  {canAccessClinicFinance && (
                    <div className={`rounded-3xl border p-5 ${isPatientReceivablesSection ? "border-slate-100 bg-white" : "border-violet-100 bg-violet-50/70"}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">Financeiro da clínica / interno</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">Resultado, convênios, lotes, despesas, relatórios e repasses.</p>
                      <p className="mt-1 text-xs text-slate-500">Visível para coordenação, dono, admin financeiro e perfis autorizados.</p>
                    </div>
                  )}
                  <div className={`rounded-3xl border p-5 ${isPatientReceivablesSection || isReceptionist ? "border-violet-100 bg-violet-50/70" : "border-slate-100 bg-white"}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">Financeiro de pacientes / recepção</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">Receber pagamentos, registrar cobranças, recibos, comprovantes e inadimplência.</p>
                    <p className="mt-1 text-xs text-slate-500">Foco operacional da recepção, sem margem, DRE ou regras internas de repasse.</p>
                  </div>
                </div>
                )}

                {(isPatientReceivablesSection || isReceptionist) && (
                  <div data-patient-finance-internal-nav className="flex flex-wrap gap-2">
                    {[
                      ["Recebimentos de pacientes", "Recebimentos"],
                      ["Cobranças", "Cobranças"],
                      ["Pendências de pacientes", "Pendências"],
                      ["Recibos", "Recibos e comprovantes"],
                    ].map(([section, label]) => {
                      const selected = patientFinanceActiveSection === section;
                      return (
                        <button
                          key={section}
                          type="button"
                          onClick={() => navigateToTab("financial", financialIntent(section))}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                            selected
                              ? "bg-[#7a32fc] text-white shadow-sm shadow-purple-500/10"
                              : "border border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:text-[#7a32fc]"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {(isRevenueSection || isPatientReceivablesSection || isReceptionist) && (
                    <button
                      onClick={() => setIsPaymentModalOpen(true)}
                      className="flex items-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-purple-500/10 transition hover:bg-[#6d28e8]"
                    >
                      <Plus size={18} /> Cobrança / Pagamento
                    </button>
                  )}
                  {canAccessClinicFinance && isProfessionalTransfersSection && (
                    <button
                      onClick={() => setIsProfessionalPaymentModalOpen(true)}
                      className="flex items-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-purple-500/10 transition hover:bg-[#6d28e8]"
                    >
                      <CreditCard size={18} /> Registrar repasse
                    </button>
                  )}
                  {isFinancialPayerLotsSection && (
                    <button
                      type="button"
                      onClick={() => navigateToTab("conference", conferenceIntent("Lotes XML", "preGuides", "xmlDrafts", "Pré-faturamento TISS"))}
                      className="flex items-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-purple-500/10 transition hover:bg-[#6d28e8]"
                    >
                      <FileText size={18} /> Abrir Lotes XML TISS
                    </button>
                  )}
                  {!isReceptionist && isFinancialPayerLotsSection && (
                    <button
                      type="button"
                      onClick={() => navigateToTab("payers", payerIntent("convenios", "Convênios"))}
                      className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-violet-200 hover:text-[#7a32fc]"
                    >
                      <KeyRound size={18} /> Convênios
                    </button>
                  )}
                </div>

                {(isPatientReceivablesSection || isReceptionist) && (
                  <div className="space-y-4">
                    {isPatientPaymentsSection && (
                      <div data-patient-finance-receipts-view className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="font-semibold text-slate-900">Recebimentos de pacientes</h4>
                        <p className="mt-1 text-sm text-slate-500">Pagamentos confirmados, método, comprovante e status operacional da recepção.</p>
                        <div className="mt-5 space-y-3">
                          {financialDashboard.paidPayments.length ? financialDashboard.paidPayments.map((payment: any, index: number) => (
                            <div key={payment.id || `patient-paid-${index}`} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                              <div>
                                <p className="font-semibold text-slate-900">{payment.patient_name || "Paciente"}</p>
                                <p className="text-xs text-slate-500">
                                  {new Date(payment.payment_date || payment.paymentDate || payment.due_date || payment.dueDate).toLocaleDateString("pt-BR")} · {payment.method || "Método não informado"}
                                </p>
                              </div>
                              <div className="text-left sm:text-right">
                                <p className="font-semibold text-emerald-600">{formatCurrency(payment.amount)}</p>
                                <p className="text-xs text-slate-500">{payment.receipt_url ? "Comprovante anexado" : "Sem comprovante anexado"}</p>
                              </div>
                            </div>
                          )) : (
                            <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">Nenhum recebimento confirmado no período.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {isPatientChargesSection && (
                      <div data-patient-finance-charges-view className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="font-semibold text-slate-900">Cobranças</h4>
                        <p className="mt-1 text-sm text-slate-500">Cobranças abertas, próximos vencimentos e valores a receber por paciente.</p>
                        <div className="mt-5 grid gap-3 md:grid-cols-2">
                          {financialDashboard.pendingPayments.concat(compensationForecast).slice(0, 8).map((charge: any, index: number) => (
                            <div key={charge.id || `patient-charge-${index}`} className="rounded-2xl bg-slate-50 p-4">
                              <p className="text-sm font-semibold text-slate-900">{charge.patient_name || charge.patientName || "Paciente"}</p>
                              <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(charge.amount)}</p>
                              <p className="text-xs text-slate-500">
                                Vencimento: {charge.dueDay ? `dia ${String(charge.dueDay).padStart(2, "0")}` : new Date(charge.due_date || charge.dueDate || charge.payment_date || charge.paymentDate).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          ))}
                          {!financialDashboard.pendingPayments.length && !compensationForecast.length && (
                            <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">Nenhuma cobrança aberta ou vencimento previsto no período.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {isPatientPendingSection && (
                      <div data-patient-finance-pending-view className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="font-semibold text-slate-900">Pendências financeiras</h4>
                        <p className="mt-1 text-sm text-slate-500">Cobranças vencidas, inadimplência e pendências sem baixa financeira.</p>
                        <div className="mt-5 space-y-3">
                          {financialDashboard.overduePayments.length ? financialDashboard.overduePayments.map((payment: any, index: number) => (
                            <div key={payment.id || `patient-overdue-${index}`} className="flex flex-col gap-2 rounded-2xl bg-rose-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-semibold text-slate-900">{payment.patient_name || "Paciente"}</p>
                                <p className="text-xs text-rose-700">Vencida em {new Date(payment.due_date || payment.dueDate || payment.payment_date || payment.paymentDate).toLocaleDateString("pt-BR")}</p>
                              </div>
                              <p className="font-semibold text-rose-700">{formatCurrency(payment.amount)}</p>
                            </div>
                          )) : (
                            <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">Nenhuma cobrança vencida no período.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {isPatientReceiptsSection && (
                      <div data-patient-finance-documents-view className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="font-semibold text-slate-900">Recibos e comprovantes</h4>
                        <p className="mt-1 text-sm text-slate-500">Comprovantes anexados e registros que ainda precisam de documento.</p>
                        <div className="mt-5 grid gap-3 md:grid-cols-2">
                          {financialDashboard.monthPayments.map((payment: any, index: number) => (
                            <div key={payment.id || `patient-document-${index}`} className="rounded-2xl bg-slate-50 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{payment.patient_name || "Paciente"}</p>
                                  <p className="text-xs text-slate-500">{new Date(payment.payment_date || payment.paymentDate || payment.due_date || payment.dueDate).toLocaleDateString("pt-BR")}</p>
                                </div>
                                <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${payment.receipt_url ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                                  {payment.receipt_url ? "Anexado" : "Pendente"}
                                </span>
                              </div>
                              <p className="mt-2 text-sm font-semibold text-emerald-600">{formatCurrency(payment.amount)}</p>
                            </div>
                          ))}
                          {!financialDashboard.monthPayments.length && (
                            <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">Nenhum recibo ou comprovante no período.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isRevenueSection && (
                  <div data-financial-revenue-view className="grid gap-3 md:grid-cols-4">
                    {[
                      { label: "Receita realizada", value: formatCurrency(financialDashboard.realized), rawValue: financialDashboard.realized, hint: "Pagamentos confirmados no mês", semantic: "positive" as const },
                      { label: "Receita projetada", value: formatCurrency(financialDashboard.projection), rawValue: financialDashboard.projection, hint: "Planos e mensalidades ativos", semantic: "positive" as const },
                      { label: "A receber", value: formatCurrency(financialDashboard.pendingAmount), rawValue: financialDashboard.pendingAmount, hint: `${financialDashboard.pendingPayments.length} cobrança(s) pendente(s)`, semantic: "neutral" as const },
                      { label: "Em atraso", value: formatCurrency(financialDashboard.overdueAmount), rawValue: financialDashboard.overdueAmount, hint: `${financialDashboard.overduePayments.length} cobrança(s) vencida(s)`, semantic: "negative" as const },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{metric.label}</p>
                        <p className={`mt-2 text-xl font-semibold ${getFinancialSemanticValueClass(metric.semantic, metric.rawValue)}`}>{metric.value}</p>
                        <p className="mt-1 text-xs text-slate-500">{metric.hint}</p>
                      </div>
                    ))}
                  </div>
                )}

                {isExpenseSection && (
                  <div data-financial-expenses-view className="grid gap-3 md:grid-cols-4">
                    {[
                      { label: "Despesas operacionais", value: formatCurrency(financialDashboard.operationalExpenses), rawValue: financialDashboard.operationalExpenses, hint: "Saídas registradas no período", semantic: "negative" as const },
                      { label: "Repasses pagos", value: formatCurrency(financialDashboard.professionalPaid), rawValue: financialDashboard.professionalPaid, hint: "Pagamentos profissionais baixados", semantic: "negative" as const },
                      { label: "Repasses pendentes", value: formatCurrency(financialDashboard.professionalPending), rawValue: financialDashboard.professionalPending, hint: "Valores ainda a repassar", semantic: "negative" as const },
                      { label: "Saldo líquido", value: formatCurrency(financialDashboard.cashFlow), rawValue: financialDashboard.cashFlow, hint: "Entradas pagas menos saídas pagas", semantic: "profit" as const },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{metric.label}</p>
                        <p className={`mt-2 text-xl font-semibold ${getFinancialSemanticValueClass(metric.semantic, metric.rawValue)}`}>{metric.value}</p>
                        <p className="mt-1 text-xs text-slate-500">{metric.hint}</p>
                      </div>
                    ))}
                  </div>
                )}

                {isCashFlowSection && (
                  <div data-financial-cashflow-view className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                    {[
                      { label: "Entradas", value: formatCurrency(financialDashboard.cashIn), rawValue: financialDashboard.cashIn, hint: "Recebimentos pagos", semantic: "positive" as const },
                      { label: "Saídas", value: formatCurrency(financialDashboard.cashOut), rawValue: financialDashboard.cashOut, hint: "Repasses pagos e despesas", semantic: "negative" as const },
                      { label: "Saldo líquido", value: formatCurrency(financialDashboard.cashFlow), rawValue: financialDashboard.cashFlow, hint: "Resultado de caixa do período", semantic: "profit" as const },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{metric.label}</p>
                        <p className={`mt-2 text-xl font-semibold ${getFinancialSemanticValueClass(metric.semantic, metric.rawValue)}`}>{metric.value}</p>
                        <p className="mt-1 text-xs text-slate-500">{metric.hint}</p>
                      </div>
                    ))}
                    </div>
                    <div data-financial-chart="cash-flow-monthly" className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                      <h4 className="mb-6 font-semibold text-slate-900">
                        Fluxo de caixa mensal
                      </h4>
                      <div className="h-64 min-h-[300px]">
                        <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                          <BarChart data={financialCashFlowRows}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={financialChartGridColor} />
                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: financialChartAxisColor, fontSize: 12 }} />
                            <Tooltip content={renderFinancialTooltip} cursor={{ fill: financialChartCursorColor }} />
                            <Bar name="Receita realizada" dataKey="Receita realizada" fill="#22c55e" radius={[4, 4, 0, 0]} />
                            <Bar name="Resultado estimado" dataKey="Resultado estimado" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </SafeResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {isFinancialPayerLotsSection && (
                  <div data-financial-payer-lots-view className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                      <h4 className="font-semibold text-slate-900">Convênios e lotes financeiros</h4>
                      <p className="mt-1 text-sm text-slate-500">
                        Acompanhe valores previstos, realizados e pendências financeiras por convênio. Lotes XML oficiais continuam no pré-faturamento TISS.
                      </p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {financialDashboard.insuranceRows.length ? financialDashboard.insuranceRows.map((row: any) => (
                          <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
                            <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-600">{formatCurrency(row.amount)}</p>
                            <p className="text-xs text-slate-500">{row.patients} paciente(s) com previsão financeira</p>
                          </div>
                        )) : (
                          <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">
                            Nenhum convênio com previsão financeira neste período.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                      <h4 className="font-semibold text-slate-900">Origem da receita</h4>
                      <div className="mt-5 space-y-3">
                        {financialRevenueOriginRows.map((row: any) => (
                          <div key={`payer-lot-${row.name}`} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
                            <div className="min-w-0">
                              <span className="font-medium text-slate-600">{row.name}</span>
                              <p className="text-[11px] text-slate-400">{row.Participação.toFixed(0)}% do período</p>
                            </div>
                            <span className="font-semibold text-emerald-600">{formatCurrency(row.Receita)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                          <span className="font-semibold text-slate-700">Total</span>
                          <span className="font-semibold text-slate-900">
                            {formatCurrency(financialRevenueOriginRows.reduce((sum: number, row: any) => sum + (Number(row.Receita) || 0), 0))}
                          </span>
                        </div>
                        {financialDashboard.insuranceRows.length > 0 && (
                          <div className="space-y-2 border-t border-slate-100 pt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Detalhe dos convênios</p>
                            {financialDashboard.insuranceRows.map((row: any) => (
                              <div key={`payer-lot-detail-${row.label}`} className="flex items-center justify-between text-xs text-slate-500">
                                <span>{row.label}</span>
                                <span className="font-semibold text-slate-700">{formatCurrency(row.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {isProductionReportSection && (
                  <div data-financial-production-report-view className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        ["Sessões agendadas", productionReportRows.scheduledCount, "Atendimentos no período selecionado"],
                        ["Sessões realizadas", productionReportRows.completedCount, "Consultas concluídas no período"],
                        ["Cancelamentos/faltas", productionReportRows.cancelledCount, "Sessões canceladas ou não realizadas"],
                      ].map(([label, value, hint]) => (
                        <div key={label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
                          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
                          <p className="mt-1 text-xs text-slate-500">{hint}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                      <h4 className="font-semibold text-slate-900">Produção por profissional</h4>
                      <div className="mt-5 space-y-3">
                        {productionReportRows.professionalRows.length ? productionReportRows.professionalRows.map((row: any) => (
                          <div key={row.label} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                            <p className="font-semibold text-slate-900">{row.label}</p>
                            <p className="text-slate-600">Agendadas: <span className="font-semibold">{row.scheduled}</span></p>
                            <p className="text-emerald-700">Realizadas: <span className="font-semibold">{row.completed}</span></p>
                            <p className="text-rose-700">Canceladas: <span className="font-semibold">{row.cancelled}</span></p>
                          </div>
                        )) : (
                          <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">Ainda não há sessões no período selecionado.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {isBillingReportSection && (
                  <div data-financial-billing-report-view className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      {[
                        ["Faturamento projetado", formatCurrency(financialDashboard.projection), "Planos ativos no período"],
                        ["Faturamento realizado", formatCurrency(financialDashboard.realized), "Pagamentos confirmados"],
                        ["A receber", formatCurrency(financialDashboard.pendingAmount), "Cobranças abertas"],
                        ["Inadimplência", formatCurrency(financialDashboard.overdueAmount), "Cobranças vencidas"],
                      ].map(([label, value, hint]) => (
                        <div key={label} className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
                          <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
                          <p className="mt-1 text-xs text-slate-500">{hint}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="font-semibold text-slate-900">Faturamento por origem</h4>
                        <div className="mt-5 space-y-3">
                          {financialDashboard.payerRows.map((row: any) => (
                            <div key={row.label} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm">
                              <span className="font-medium text-slate-600">{row.label}</span>
                              <span className="font-semibold text-slate-900">{formatCurrency(row.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="font-semibold text-slate-900">Faturamento por convênio</h4>
                        <div className="mt-5 space-y-3">
                          {financialDashboard.insuranceRows.length ? financialDashboard.insuranceRows.map((row: any) => (
                            <div key={row.label} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm">
                              <span className="font-medium text-slate-600">{row.label}</span>
                              <span className="font-semibold text-slate-900">{formatCurrency(row.amount)}</span>
                            </div>
                          )) : (
                            <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-400">Nenhum convênio com faturamento no período.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {canAccessClinicFinance && isProfessionalTransfersSection && (
                  <div data-professional-transfers-panel className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">Controle interno</p>
                        <h4 className="mt-1 text-xl font-semibold text-slate-900">Demonstrativo e revisão de repasses</h4>
                        <p className="mt-1 max-w-2xl text-sm text-slate-500">
                          Itens de repasse são acompanhados por período, profissional, status, origem, valor base, ajustes e valor líquido. Consultas canceladas não devem gerar repasse; convênios ainda não recebidos permanecem em revisão/aguardando recebimento.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setIsProfessionalPaymentModalOpen(true)}
                          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2.5 text-sm font-semibold text-white"
                        >
                          <CreditCard size={16} />
                          Registrar repasse
                        </button>
                        <button
                          type="button"
                          onClick={() => showToast("Cálculo automático será liberado quando houver atendimentos recebidos elegíveis no período.", "info")}
                          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                        >
                          Calcular repasses do período
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold text-slate-600">
                        Período
                        <input
                          type="month"
                          value={financialMonth}
                          onChange={(e) => setFinancialMonth(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-600">
                        Profissional
                        <select
                          value={professionalTransferProfessionalFilter}
                          onChange={(e) => setProfessionalTransferProfessionalFilter(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
                        >
                          <option value="all">Todos os profissionais</option>
                          {therapistFilterOptions.map((member) => (
                            <option key={`transfer-filter-${member.id}`} value={member.id}>{member.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-600">
                        Status
                        <select
                          value={professionalTransferStatusFilter}
                          onChange={(e) => setProfessionalTransferStatusFilter(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none"
                        >
                          {professionalTransferStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-5 overflow-x-auto">
                      {professionalTransferRows.length ? (
                        <table className="w-full min-w-[860px] text-left">
                          <thead>
                            <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                              <th className="pb-3">Profissional</th>
                              <th className="pb-3">Origem</th>
                              <th className="pb-3">Regra</th>
                              <th className="pb-3">Valor bruto/base</th>
                              <th className="pb-3">Ajustes</th>
                              <th className="pb-3">Líquido a repassar</th>
                              <th className="pb-3">Status</th>
                              <th className="pb-3">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {professionalTransferRows.map((payment: any, index: number) => (
                              <tr key={payment.id || `professional-transfer-${index}`} className="text-sm text-slate-700">
                                <td className="py-4 font-semibold text-slate-900">{payment.professionalDisplayName}</td>
                                <td className="py-4">
                                  <p>{payment.paymentOrigin}</p>
                                  <p className="text-[11px] text-slate-400">Convênio/paciente/procedimento conforme registro de origem.</p>
                                </td>
                                <td className="py-4">{payment.ruleLabel}</td>
                                <td className="py-4">{formatCurrency(payment.baseAmount)}</td>
                                <td className="py-4">
                                  {formatCurrency(payment.adjustment)}
                                  {payment.adjustment > 0 && payment.adjustmentReason ? (
                                    <p className="mt-1 max-w-[180px] text-[11px] text-slate-400">Motivo: {payment.adjustmentReason}</p>
                                  ) : null}
                                </td>
                                <td className="py-4 font-semibold text-rose-600">{formatCurrency(payment.netAmount)}</td>
                                <td className="py-4">
                                  <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-semibold uppercase ${payment.status.className}`}>
                                    {payment.status.label}
                                  </span>
                                </td>
                                <td className="py-4">
                                  <button
                                    type="button"
                                    onClick={() => openProfessionalPaymentEditor(payment)}
                                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600 hover:border-[#7a32fc] hover:text-[#7a32fc]"
                                  >
                                    Revisar
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                          <p className="font-semibold text-slate-900">Ainda não há atendimentos recebidos elegíveis para repasse neste período.</p>
                          <p className="mt-1">Quando houver pagamentos recebidos ou repasses registrados, eles aparecerão aqui com status, regra, ajustes e valor líquido. Não foi criado cálculo fictício.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(isRevenueSection || isExpenseSection) && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-8">
                    {!isReceptionist && isExpenseSection && (
                      <>
                        <div className="overflow-hidden rounded-[32px] border border-slate-100 bg-white shadow-sm">
                          <div className="border-b border-slate-50 p-6">
                            <h4 className="font-semibold text-slate-900">
                              Resumo Financeiro Operacional
                            </h4>
                          </div>
                          <div className="p-6">
                            <div className="space-y-4">
                              {dreData.map((item, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-center justify-between p-4 rounded-2xl ${
                                    item.type === "total"
                                      ? "bg-slate-50 font-semibold"
                                      : item.type === "profit"
                                        ? "bg-emerald-50 text-emerald-700 font-semibold"
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
                                      <p className="text-[10px] text-slate-400">
                                        {item.info}
                                      </p>
                                    </div>
                                  </div>
                                  <p className="text-lg font-medium">
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
                              <h4 className="font-semibold text-slate-900">
                                DRE por especialidade
                              </h4>
                              <p className="mt-1 text-xs text-slate-500">
                                Projeção vem do cadastro financeiro do paciente. Quando o pagamento não informa especialidade, o valor é distribuído conforme as especialidades cadastradas no paciente.
                              </p>
                            </div>
                            <span className="w-fit rounded-full bg-violet-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">
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
                                        <p className="text-base font-semibold text-slate-900">{row.label}</p>
                                        <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-slate-400">
                                          {row.patients} paciente(s) ativo(s) • {row.paidPatients} com pagamento realizado no mês
                                        </p>
                                      </div>
                                      <div className={`rounded-2xl px-4 py-2 text-right ${netPositive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                                        <p className="text-[10px] font-semibold uppercase tracking-widest">Lucro estimado</p>
                                        <p className="text-lg font-semibold">{formatCurrency(row.netProfit)}</p>
                                      </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Faturamento projetado</p>
                                        <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(row.projected)}</p>
                                      </div>
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Realizado</p>
                                        <p className="mt-1 text-lg font-semibold text-[#7a32fc]">{formatCurrency(row.realized)}</p>
                                      </div>
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Ticket médio</p>
                                        <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(row.averageTicket)}</p>
                                      </div>
                                      <div className="rounded-2xl bg-white p-4">
                                        <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">Margem líquida</p>
                                        <p className={`mt-1 text-lg font-semibold ${netPositive ? "text-emerald-600" : "text-rose-600"}`}>
                                          {row.netMarginPct.toFixed(1)}%
                                        </p>
                                      </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] font-medium text-slate-500 sm:grid-cols-2 xl:grid-cols-5">
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
                          {financialDashboard.unallocatedSpecialtyRows.length > 0 && (
                            <div data-unallocated-financial-costs className="mt-5 rounded-[28px] border border-amber-100 bg-amber-50 p-5">
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">
                                    Custos/Repasses não alocados
                                  </p>
                                  <h5 className="mt-1 text-lg font-semibold text-slate-900">
                                    {formatCurrency(financialDashboard.unallocatedSpecialtyTotals.professionalPaid + financialDashboard.unallocatedSpecialtyTotals.allocatedOperationalExpenses)}
                                  </h5>
                                  <p className="mt-1 max-w-2xl text-sm text-amber-800/80">
                                    Estes valores ainda não possuem especialidade clínica vinculada. Revise profissional, procedimento ou atendimento de origem antes de interpretar margem por especialidade.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => navigateToTab("financial", { breadcrumb: ["Financeiro", "Repasses a profissionais"] })}
                                  className="w-fit rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-300"
                                >
                                  Revisar alocação
                                </button>
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                <div className="rounded-2xl bg-white/80 p-3">
                                  <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-700">Receita projetada</p>
                                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(financialDashboard.unallocatedSpecialtyTotals.projected)}</p>
                                </div>
                                <div className="rounded-2xl bg-white/80 p-3">
                                  <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-700">Realizado</p>
                                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(financialDashboard.unallocatedSpecialtyTotals.realized)}</p>
                                </div>
                                <div className="rounded-2xl bg-white/80 p-3">
                                  <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-700">Repasses</p>
                                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(financialDashboard.unallocatedSpecialtyTotals.professionalPaid)}</p>
                                </div>
                                <div className="rounded-2xl bg-white/80 p-3">
                                  <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-700">Despesas alocadas</p>
                                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(financialDashboard.unallocatedSpecialtyTotals.allocatedOperationalExpenses)}</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                          <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                            <h4 className="font-semibold text-slate-900">
                              Ranking de faturamento por especialidade
                            </h4>
                            <div className="mt-5 space-y-3">
                              {financialDashboard.specialtyRows.length ? (
                                financialDashboard.specialtyRows.map((row: any) => (
                                  <div key={row.label} className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                                      <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                                        {row.patients} paciente(s) • ticket {formatCurrency(row.averageTicket)}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-semibold text-[#7a32fc]">{formatCurrency(row.projected)}</p>
                                      <p className="text-[10px] text-slate-400">
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
                            <h4 className="font-semibold text-slate-900">
                              Particular, convênio e faturamento
                            </h4>
                            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {financialDashboard.payerRows.map((row: any) => (
                                <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
                                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{row.label}</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(row.amount)}</p>
                                  <p className="text-[10px] text-slate-400">{row.patients} paciente(s)</p>
                                </div>
                              ))}
                              {financialDashboard.billingMethodRows.map((row: any) => (
                                <div key={row.label} className="rounded-2xl bg-slate-50 p-4">
                                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{row.label}</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(row.amount)}</p>
                                  <p className="text-[10px] text-slate-400">Meio de faturamento</p>
                                </div>
                              ))}
                            </div>
                            {financialDashboard.insuranceRows.length > 0 && (
                              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                                {financialDashboard.insuranceRows.map((row: any) => (
                                  <div key={row.label} className="flex items-center justify-between text-xs font-medium text-slate-500">
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

                    {(isRevenueSection || isPatientReceivablesSection || isReceptionist) && (
                    <div className="overflow-hidden rounded-[32px] border border-slate-100 bg-white shadow-sm">
                      <div className="border-b border-slate-50 p-6">
                        <h4 className="font-semibold text-slate-900">
                          Últimos Recebimentos
                        </h4>
                      </div>
                      <div className="overflow-x-auto p-6">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left border-b border-slate-50">
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Paciente
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Tipo
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Valor
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Data
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Método
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Comprovante
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                Status
                              </th>
                              <th className="pb-4 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
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
                                  <td className="py-4 font-medium text-slate-700">
                                    {p.patient_name}
                                  </td>
                                  <td className="py-4">
                                    <div className="flex flex-col">
                                      <span
                                        className={`text-[10px] font-semibold uppercase ${p.type === "particular" ? "text-blue-600" : "text-purple-600"}`}
                                      >
                                        {p.type || "Particular"}
                                      </span>
                                      {p.insurance_name && (
                                        <span className="text-[9px] text-slate-400">
                                          {p.insurance_name}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-4 font-semibold text-[#7a32fc]">
                                    {formatCurrency(p.amount)}
                                  </td>
                                  <td className="py-4 text-slate-500 text-sm">
                                    {new Date(
                                      p.payment_date || p.due_date,
                                    ).toLocaleDateString("pt-BR")}
                                  </td>
                                  <td className="py-4">
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-medium uppercase text-slate-600">
                                      {p.method}
                                    </span>
                                  </td>
                                  <td className="py-4 text-xs font-medium text-slate-500">
                                    {p.receipt_url ? (
                                      "Anexado"
                                    ) : (
                                      <label className="inline-flex cursor-pointer items-center rounded-full bg-violet-50 px-3 py-1 text-[10px] font-semibold uppercase text-[#7a32fc] hover:bg-violet-100">
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
                                    <span className={`rounded-full px-3 py-1 text-[10px] font-medium uppercase ${
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
                                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600 hover:border-[#7a32fc] hover:text-[#7a32fc]"
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
                    )}
                  </div>

                  <div className="space-y-8">
                    {!isReceptionist && isCashFlowSection && (
                      <div data-financial-chart="cash-flow-monthly" className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                        <h4 className="mb-6 font-semibold text-slate-900">
                          Fluxo de caixa mensal
                        </h4>
                        <div className="h-64 min-h-[300px]">
                <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
                            <BarChart data={financialCashFlowRows}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={false}
                                stroke={financialChartGridColor}
                              />
                              <XAxis
                                dataKey="month"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: financialChartAxisColor, fontSize: 12 }}
                              />
                              <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: financialChartAxisColor, fontSize: 12 }}
                              />
                              <Tooltip
                                content={renderFinancialTooltip}
                                cursor={{ fill: financialChartCursorColor }}
                              />
                              <Bar
                                name="Receita realizada"
                                dataKey="Receita realizada"
                                fill="#7a32fc"
                                radius={[4, 4, 0, 0]}
                              />
                              <Bar
                                name="Resultado estimado"
                                dataKey="Resultado estimado"
                                fill="#6AD2FF"
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          </SafeResponsiveContainer>
                        </div>
                      </div>
                    )}

                    <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                      <h4 className="mb-6 font-semibold text-slate-900">
                        Próximos vencimentos
                      </h4>
                      <div className="space-y-4">
                        {compensationForecast.map((member, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {member.patientName}
                              </p>
                              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                                {member.specialty}
                              </p>
                              <p className="mt-1 text-[10px] text-slate-500">
                                {member.payerType}{member.insuranceName ? ` • ${member.insuranceName}` : ""}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-slate-900">
                                {formatCurrency(member.amount)}
                              </p>
                              <p className="text-[10px] font-medium uppercase tracking-widest text-emerald-500">
                                Vence dia {String(member.dueDay).padStart(2, "0")}
                              </p>
                              <p className="text-[10px] text-slate-400">
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

                    {isExpenseSection && (
                    <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm">
                      <h4 className="mb-6 font-semibold text-slate-900">
                        Pagamentos de profissionais
                      </h4>
                      <div className="space-y-4">
                        {financialDashboard.professionalPayments.length ? (
                          financialDashboard.professionalPayments.map((payment: any, index: number) => (
                            <div key={payment.id || index} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                              <div>
                                <p className="text-sm font-medium text-slate-900">
                                  {formatProfessionalPaymentDisplayName(payment)}
                                </p>
                                <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                                  Vence {new Date(payment.due_date || payment.payment_date).toLocaleDateString("pt-BR")}
                                </p>
                                <p className="mt-1 text-[10px] text-slate-500">
                                  {payment.method || "pix"}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-medium text-rose-600">
                                  {formatCurrency(payment.amount)}
                                </p>
                                <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-medium uppercase ${
                                  String(payment.status || "").toLowerCase() === "paid"
                                    ? "bg-green-100 text-green-600"
                                    : "bg-amber-100 text-amber-700"
                                }`}>
                                  {String(payment.status || "").toLowerCase() === "paid" ? "Pago" : "Pendente"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openProfessionalPaymentEditor(payment)}
                                  className="mt-2 block rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-600 hover:border-[#7a32fc] hover:text-[#7a32fc]"
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
                    )}
                  </div>
                </div>
                )}
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
                          <div className="flex h-12 w-12 overflow-hidden items-center justify-center rounded-2xl bg-white text-lg font-black text-pink-600 shadow-sm">
                            <SecureImage
                              src={getPatientPhotoSource(patient)}
                              alt={`Foto de ${normalizeUtf8Text(patient?.name || "Paciente")}`}
                              className="h-full w-full object-cover"
                              fallback={<span>{getPatientInitial(patient)}</span>}
                            />
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                      Gestão de Pacientes
                    </h3>
                    <div className="flex items-center gap-2">
                      {renderPatientViewModeToggle()}
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
                  </div>
                  {!isReceptionist && (
                    <div className="w-full sm:w-[360px]">
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                        Filtrar por profissional
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
                <div
                  className={
                    patientViewMode === "list"
                      ? "grid grid-cols-1 gap-3"
                      : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
                  }
                >
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
                      className={`${patientViewMode === "list" ? "p-4 rounded-2xl" : "p-4 sm:p-6 rounded-3xl"} border transition-all group relative cursor-pointer focus:outline-none focus:ring-4 focus:ring-[#7a32fc]/15 ${
                        patientQuickFilter === "birthdaysToday"
                          ? "border-pink-200 bg-pink-50/70 hover:border-pink-300"
                          : "border-slate-100 bg-slate-50 hover:border-blue-500/30"
                      }`}
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl overflow-hidden flex items-center justify-center font-bold text-slate-900 shadow-sm group-hover:scale-110 transition-transform">
                          <SecureImage
                            src={getPatientPhotoSource(patient)}
                            alt={`Foto de ${normalizeUtf8Text(patient?.name || "Paciente")}`}
                            className="h-full w-full object-cover"
                            fallback={<span>{getPatientInitial(patient)}</span>}
                          />
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
                            const responsible = resolvePatientResponsibleProfessionalLabel(patient, therapistMembersById);
                            if (!responsible.id) {
                              return (
                                <p className="text-[10px] mt-1 font-semibold text-amber-600">
                                  Profissional: Sem profissional responsável
                                </p>
                              );
                            }
                            return (
                              <p className="text-[10px] mt-1 font-semibold text-indigo-600">
                                Profissional: {responsible.label}
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
                  onOpenAppointment={openAppointmentFromAdministrativeFlow}
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
                  initialTab={financialNavigationContext.conferenceTab}
                  tissInitialPanel={financialNavigationContext.tissPanel}
                  initialPayerId={financialNavigationContext.payerId}
                  navigationIntentKey={financialNavigationContext.intentKey}
                  onOpenAppointment={openAppointmentFromAdministrativeFlow}
                  onOpenPatient={openPatientEditFromAdministrativeFlow}
                  onNavigatePayers={(section = "convenios") => {
                    const labels: Record<PayerNavigationSection, string> = {
                      convenios: "Convênios",
                      tuss: "De/Para TUSS",
                      prices: "Tabela de Valores",
                      rules: "Regras TISS",
                    };
                    navigateToTab("payers", payerIntent(section, labels[section]));
                  }}
                  onNavigateSettings={() => navigateToTab("settings")}
                  onNavigateProfessionals={() => navigateToTab("team")}
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
            {activeTab === "patientAuthorizations" && (
              <motion.div
                key="patientAuthorizations"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="rounded-[32px] border border-slate-100 bg-white p-5 shadow-sm sm:p-8">
                  <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#7a32fc]">
                        <ClipboardCheck size={14} />
                        Convênios e TISS
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 sm:text-2xl">
                        Autorizações dos pacientes
                      </h3>
                      <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
                        Controle as senhas/guias autorizadas pelos convênios e acompanhe validade, saldo e status por paciente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadPatientAuthorizationOverview()}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition-all hover:border-[#7a32fc] hover:text-[#7a32fc]"
                    >
                      Atualizar
                    </button>
                  </div>

                  <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr_1fr]">
                    <label className="block">
                      <span className="mb-1.5 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Buscar por paciente
                      </span>
                      <input
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#7a32fc] focus:bg-white"
                        value={patientAuthorizationOverviewFilters.search}
                        onChange={(event) => setPatientAuthorizationOverviewFilters((current) => ({ ...current, search: event.target.value }))}
                        placeholder="Paciente, convênio, senha, guia ou TUSS"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Convênio
                      </span>
                      <select
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#7a32fc] focus:bg-white"
                        value={patientAuthorizationOverviewFilters.payerId}
                        onChange={(event) => setPatientAuthorizationOverviewFilters((current) => ({ ...current, payerId: event.target.value }))}
                      >
                        <option value="all">Todos os convênios</option>
                        {patientAuthorizationOverviewPayerOptions.map((payer) => (
                          <option key={payer.id} value={payer.id}>{payer.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Status
                      </span>
                      <select
                        className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-[#7a32fc] focus:bg-white"
                        value={patientAuthorizationOverviewFilters.status}
                        onChange={(event) => setPatientAuthorizationOverviewFilters((current) => ({ ...current, status: event.target.value }))}
                      >
                        <option value="all">Todos os status</option>
                        <option value="current">Vigentes</option>
                        <option value="expiring">A vencer</option>
                        <option value="future">Futuras</option>
                        <option value="expired">Expiradas</option>
                        <option value="consumed">Sem saldo</option>
                        <option value="inactive">Inativas</option>
                        <option value="legacy">TUSS legado/inadequado</option>
                      </select>
                    </label>
                  </div>

                  {patientAuthorizationOverviewError && (
                    <div className="mb-4 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
                      {patientAuthorizationOverviewError}
                    </div>
                  )}

                  <div className="overflow-hidden rounded-3xl border border-slate-100">
                    <div className="overflow-x-auto">
                      <table className="min-w-[1080px] w-full text-left text-sm">
                        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          <tr>
                            <th className="px-4 py-3">Paciente</th>
                            <th className="px-4 py-3">Convênio</th>
                            <th className="px-4 py-3">Procedimento</th>
                            <th className="px-4 py-3">TUSS</th>
                            <th className="px-4 py-3">Guia</th>
                            <th className="px-4 py-3">Autorização/Senha</th>
                            <th className="px-4 py-3">Validade</th>
                            <th className="px-4 py-3">Consumo</th>
                            <th className="px-4 py-3">Saldo</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {patientAuthorizationOverviewLoading ? (
                            <tr>
                              <td colSpan={11} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">
                                Carregando autorizações TISS...
                              </td>
                            </tr>
                          ) : filteredPatientAuthorizationOverview.length === 0 ? (
                            <tr>
                              <td colSpan={11} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">
                                Nenhuma autorização encontrada para os filtros selecionados.
                              </td>
                            </tr>
                          ) : (
                            filteredPatientAuthorizationOverview.map((authorization: any) => {
                              const visualState = getPatientTissAuthorizationVisualState(authorization);
                              const authorized = Number(authorization?.authorizedQuantity || 0) || 0;
                              const used = Number(authorization?.usedQuantity || 0) || 0;
                              return (
                                <tr key={authorization.id || `${authorization.patientId}-${authorization.authorizationNumber}`} className="align-top">
                                  <td className="px-4 py-4">
                                    <p className="font-bold text-slate-900">{normalizeUtf8Text(authorization.patientName || "Paciente")}</p>
                                    {authorization.patientEmail && <p className="mt-0.5 text-xs font-medium text-slate-400">{authorization.patientEmail}</p>}
                                  </td>
                                  <td className="px-4 py-4 font-semibold text-slate-700">{authorization.payerName || authorization.patientInsuranceName || "Convênio não informado"}</td>
                                  <td className="px-4 py-4">
                                    <p className="font-semibold text-slate-700">{authorization.serviceName || "Procedimento faturável"}</p>
                                    {authorization.internalCode && <p className="mt-0.5 text-xs font-medium text-slate-400">{authorization.internalCode}</p>}
                                  </td>
                                  <td className="px-4 py-4">
                                    <p className="font-mono text-xs font-bold text-slate-700">{authorization.tussCode || "-"}</p>
                                    {visualState.isLegacyOrInadequate && (
                                      <p className="mt-1 max-w-[220px] text-[10px] font-semibold leading-snug text-amber-700">
                                        Revisar De/Para TUSS. Esperado: {visualState.expectedTussCode}.
                                      </p>
                                    )}
                                  </td>
                                  <td className="px-4 py-4 font-semibold text-slate-700">{authorization.guideNumber || "pendente"}</td>
                                  <td className="px-4 py-4 font-semibold text-slate-700">{authorization.authorizationNumber || authorization.authorizationCode || "pendente"}</td>
                                  <td className="px-4 py-4 text-xs font-semibold text-slate-500">
                                    {formatPatientAuthorizationDate(authorization.validFrom)} até {formatPatientAuthorizationDate(authorization.validUntil)}
                                  </td>
                                  <td className="px-4 py-4 text-xs font-semibold text-slate-500">
                                    {used} de {authorized || "sem limite"}
                                  </td>
                                  <td className="px-4 py-4 text-xs font-semibold text-slate-500">{formatPatientAuthorizationBalance(authorization)}</td>
                                  <td className="px-4 py-4">
                                    <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${patientAuthorizationStatusClass(authorization)}`}>
                                      {visualState.label}
                                    </span>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="flex flex-col items-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => openPatientAuthorizationRegistration(authorization, "view")}
                                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-600 transition-all hover:border-[#7a32fc] hover:text-[#7a32fc]"
                                      >
                                        Ver paciente
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openPatientAuthorizationRegistration(authorization, "edit")}
                                        className="rounded-xl border border-purple-100 bg-purple-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#7a32fc] transition-all hover:bg-purple-100"
                                      >
                                        Editar autorização
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openPatientAuthorizationRegistration(authorization, "add")}
                                        className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition-all hover:bg-emerald-100"
                                      >
                                        Adicionar autorização
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === "payers" && (
              <motion.div
                key="payers"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <PayerRequirementsPanel
                  initialSection={financialNavigationContext.payerSection}
                  initialPayerId={financialNavigationContext.payerId}
                  navigationIntentKey={financialNavigationContext.intentKey}
                  theme={theme}
                  onNavigateToPatientAuthorizations={({ payerId, payerName }) => {
                    navigateToTab("patientAuthorizations", {
                      ...patientAuthorizationsIntent(),
                      payerId,
                      payerName,
                    });
                  }}
                  onNavigateToPreGuides={({ payerId, payerName }) => {
                    navigateToTab("conference", {
                      ...conferenceIntent("Pré-guias TISS", "preGuides", "preGuides"),
                      payerId,
                      payerName,
                    });
                  }}
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
              >
                <ClinicGlobalSettingsPanel
                  isTherapist={isTherapist}
                  canEditAnamnesisTemplate={canEditAnamnesisTemplate}
                  loadingAnamnesisTemplate={loadingAnamnesisTemplate}
                  onOpenAnamnesisTemplate={() => setIsAnamnesisTemplateModalOpen(true)}
                  canManageClinicSettings={canManageClinicSettings}
                  canManageBilling={canManageBilling}
                  normalizedPlanName={normalizedPlanName}
                  navigateToTab={navigateToTab}
                  onSave={handleSaveClinicSettings}
                  values={{
                    therapistFullName,
                    therapistDocumentType,
                    therapistCpf,
                    therapistEmail,
                    therapistPhone,
                    therapistRoleTitle,
                    therapistCouncilType,
                    therapistCrp,
                    therapistCouncilState,
                    therapistCboCode,
                    therapistSpecialtyName,
                    therapistProviderCode,
                    therapistSpecialties,
                    therapistMiniCurriculum,
                    therapistSignatureDataUrl,
                    therapistProfilePhotoUrl,
                    clinicDisplayName,
                    clinicLegalName,
                    clinicDocumentType,
                    clinicCnpj,
                    clinicCnesCode,
                    clinicProviderCode,
                    clinicLogoDataUrl,
                    clinicEmail,
                    clinicPhone,
                    clinicWhatsapp,
                    clinicSite,
                    clinicAddress,
                    clinicAddressLine,
                    clinicAddressNumber,
                    clinicAddressComplement,
                    clinicDistrict,
                    clinicCity,
                    clinicStateUf,
                    clinicPostalCode,
                    workStart,
                    workEnd,
                  }}
                  setters={{
                    setTherapistFullName,
                    setTherapistDocumentType,
                    setTherapistCpf,
                    setTherapistEmail,
                    setTherapistPhone,
                    setTherapistRoleTitle,
                    setTherapistCouncilType,
                    setTherapistCrp,
                    setTherapistCouncilState,
                    setTherapistCboCode,
                    setTherapistSpecialtyName,
                    setTherapistProviderCode,
                    setTherapistSpecialties,
                    setTherapistMiniCurriculum,
                    setTherapistSignatureDataUrl,
                    setTherapistProfilePhotoUrl,
                    setClinicDisplayName,
                    setClinicLegalName,
                    setClinicDocumentType,
                    setClinicCnpj,
                    setClinicCnesCode,
                    setClinicProviderCode,
                    setClinicLogoDataUrl,
                    setClinicEmail,
                    setClinicPhone,
                    setClinicWhatsapp,
                    setClinicSite,
                    setClinicAddress,
                    setClinicAddressLine,
                    setClinicAddressNumber,
                    setClinicAddressComplement,
                    setClinicDistrict,
                    setClinicCity,
                    setClinicStateUf,
                    setClinicPostalCode,
                    setWorkStart,
                    setWorkEnd,
                  }}
                  readImageAsDataUrl={readImageAsDataUrl}
                  retryMediaIfBroken={retryMediaIfBroken}
                />
              </motion.div>
            )}
            {activeTab === "settings_legacy" && (
              <motion.div
                key="settings-legacy"
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

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            CPF
                          </label>
                          <input
                            type="text"
                            value={therapistCpf}
                            onChange={(e) => setTherapistCpf(formatCpfInput(e.target.value))}
                            placeholder="000.000.000-00"
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Telefone / WhatsApp
                          </label>
                          <input
                            type="text"
                            value={therapistPhone}
                            onChange={(e) => setTherapistPhone(formatPhoneInput(e.target.value))}
                            placeholder="(00) 00000-0000"
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            Cargo / Função
                          </label>
                          <input
                            type="text"
                            value={therapistRoleTitle}
                            onChange={(e) => setTherapistRoleTitle(e.target.value)}
                            placeholder="Ex: Psicóloga responsável técnica"
                            className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                          />
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
                          Perfil do profissional responsável
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
                              CPF
                            </label>
                            <input
                              type="text"
                              value={therapistCpf}
                              onChange={(e) => setTherapistCpf(formatCpfInput(e.target.value))}
                              placeholder="000.000.000-00"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              CRP / Registro profissional
                            </label>
                            <input
                              type="text"
                              value={therapistCrp}
                              onChange={(e) => setTherapistCrp(e.target.value)}
                              placeholder="Ex: CRP 06/123456"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Telefone / WhatsApp
                            </label>
                            <input
                              type="text"
                              value={therapistPhone}
                              onChange={(e) => setTherapistPhone(formatPhoneInput(e.target.value))}
                              placeholder="(00) 00000-0000"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Cargo / Função
                            </label>
                            <input
                              type="text"
                              value={therapistRoleTitle}
                              onChange={(e) => setTherapistRoleTitle(e.target.value)}
                              placeholder="Ex: Coordenador clínico"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Especialidades
                            </label>
                            <input
                              type="text"
                              value={therapistSpecialties}
                              onChange={(e) => setTherapistSpecialties(e.target.value)}
                              placeholder="Ex: ABA, Neurodesenvolvimento"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Mini Currículo
                            </label>
                            <textarea
                              rows={3}
                              value={therapistMiniCurriculum}
                              onChange={(e) => setTherapistMiniCurriculum(e.target.value)}
                              placeholder="Resumo profissional usado em relatórios e documentos."
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
                        </div>

                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                          Dados da clínica
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                          <div className="md:col-span-2">
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Nome da Clínica
                            </label>
                            <input
                              type="text"
                              value={clinicDisplayName}
                              onChange={(e) => setClinicDisplayName(e.target.value)}
                              placeholder="Nome público da clínica"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
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
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              CNPJ da Clínica
                            </label>
                            <input
                              type="text"
                              value={clinicCnpj}
                              onChange={(e) => setClinicCnpj(formatCnpjInput(e.target.value))}
                              placeholder="00.000.000/0000-00"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Telefone da Clínica
                            </label>
                            <input
                              type="text"
                              value={clinicPhone}
                              onChange={(e) => setClinicPhone(formatPhoneInput(e.target.value))}
                              placeholder="(00) 00000-0000"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              E-mail institucional
                            </label>
                            <input
                              type="email"
                              value={clinicEmail}
                              onChange={(e) => setClinicEmail(e.target.value)}
                              placeholder="contato@clinica.com"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2">
                              Endereço da Clínica
                            </label>
                            <input
                              type="text"
                              value={clinicAddress}
                              onChange={(e) => setClinicAddress(e.target.value)}
                              placeholder="Rua, número, bairro, cidade"
                              className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                            />
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
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 text-sm font-semibold text-slate-500">
                        Configurações iniciais da clínica disponíveis apenas para coordenação.
                      </div>
                    )}

                    {!isTherapist && canManageClinicSettings && (
                      <div className="md:col-span-2">
                        <BillingTissSettingsPanel
                          onNavigatePayers={() => navigateToTab("payers")}
                          onNavigateProfessionals={() => navigateToTab("team")}
                        />
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
        savedTemplates={anamnesisTemplates}
        canEditTemplate={canEditAnamnesisTemplate}
        onTemplateSave={handleSaveClinicAnamnesisTemplate}
        onTemplateSelect={handleSelectClinicAnamnesisTemplate}
        onTemplateDelete={handleDeleteClinicAnamnesisTemplate}
      />

      {isAddSessionModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
          onClick={() => setIsAddSessionModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[28px] p-5 shadow-2xl animate-pop relative sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsAddSessionModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>
            <h2 className="mb-5 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <CalendarPlus size={22} className="text-[#7a32fc]" />{" "}
              {editingAppointmentId ? "Editar Agendamento" : "Agendar Sessão"}
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <label className={sessionModalLabelClass}>
                  Paciente
                </label>
                <input
                  type="text"
                  className={sessionModalInputClass}
                  placeholder="Buscar..."
                  value={sessionPatientName}
                  onChange={(e) => handleSessionPatientNameChange(e.target.value)}
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
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                <p className={sessionModalSectionLabelClass}>Quando</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className={sessionModalLabelClass}>
                    Data
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-xl border border-slate-100 bg-white p-3 text-sm font-medium text-slate-700 outline-none focus:border-violet-200 focus:ring-2 focus:ring-violet-100"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className={sessionModalLabelClass}>
                    Hora de início
                  </label>
                  <input
                    type="time"
                    className="w-full rounded-xl border border-slate-100 bg-white p-3 text-sm font-medium text-slate-700 outline-none focus:border-violet-200 focus:ring-2 focus:ring-violet-100"
                    value={sessionTime}
                    onChange={(e) => setSessionTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className={sessionModalLabelClass}>
                    Duração
                  </label>
                  <select
                    className="w-full rounded-xl border border-slate-100 bg-white p-3 text-sm font-medium text-slate-700 outline-none focus:border-violet-200 focus:ring-2 focus:ring-violet-100"
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
                  <label className={sessionModalLabelClass}>
                    Hora de fim
                  </label>
                  <div className="w-full rounded-xl border border-slate-100 bg-white p-3 text-sm font-semibold text-slate-700">
                    {sessionEndTime}
                  </div>
                </div>
                </div>
              </div>
              {sessionDurationOption === "custom" && (
                <div>
                  <label className={sessionModalLabelClass}>
                    Duração personalizada em minutos
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={720}
                    className={sessionModalInputClass}
                    value={sessionCustomDuration}
                    onChange={(e) => setSessionCustomDuration(e.target.value)}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={sessionModalLabelClass}>
                    Tipo de sessão
                  </label>
                  <select
                    className={sessionModalSelectClass}
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
                  <label className={sessionModalLabelClass}>
                    Local do atendimento
                  </label>
                  <select
                    className={sessionModalSelectClass}
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
                  <label className={sessionModalLabelClass}>
                    Sala <span className="text-red-500">*</span>
                  </label>
                  <select
                    className={sessionModalSelectClass}
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
                  <label className={sessionModalLabelClass}>
                    Link da chamada <span className="text-slate-300 normal-case tracking-normal">(opcional)</span>
                  </label>
                  <input
                    type="url"
                    className={sessionModalInputClass}
                    value={sessionCallLink}
                    onChange={(e) => setSessionCallLink(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              ) : (
                <div>
                  <label className={sessionModalLabelClass}>
                    Endereço/observação <span className="text-slate-300 normal-case tracking-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    className={sessionModalInputClass}
                    value={sessionLocationNotes}
                    onChange={(e) => setSessionLocationNotes(e.target.value)}
                    placeholder="Endereço, sala externa ou referência"
                  />
                </div>
              )}
              <div>
                <label className={sessionModalLabelClass}>
                  Profissional responsável
                </label>
                <select
                  className={sessionModalSelectClass}
                  placeholder="Nome do Profissional"
                  value={sessionProfessionalId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const nextProfessional = findProfessionalOptionById(nextId);
                    setSessionProfessionalManuallySelected(Boolean(nextId));
                    setSessionProfessionalId(nextId);
                    setSessionProfessional(nextProfessional?.label || "");
                  }}
                >
                  <option value="">Selecione...</option>
                  {therapistFilterOptions.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                  {sessionProfessionalId &&
                    !therapistFilterOptions.some(
                      (member) =>
                        String(member.id) === sessionProfessionalId ||
                        (Array.isArray((member as any).matchIds) &&
                          (member as any).matchIds.some(
                            (candidateId: any) => String(candidateId || "").trim() === sessionProfessionalId,
                          )),
                    ) && (
                      <option value={sessionProfessionalId} disabled>
                        Profissional não definido
                      </option>
                  )}
                </select>
                {sessionProfessionalNotice && (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                    {sessionProfessionalNotice}
                  </p>
                )}
              </div>
              {!isTherapist && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className={sessionModalSectionLabelClass}>
                    Pagador e conferência
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={`sm:col-span-2 ${sessionModalLabelClass}`}>
                      Contexto financeiro
                      <select
                        className={sessionModalSelectClass}
                        value={sessionFinancialContextType}
                        onChange={(e) => {
                          const nextContext =
                            normalizeAppointmentFinancialContextType(e.target.value) || "INSURANCE";
                          setSessionFinancialContextType(nextContext);
                          if (nextContext !== "INSURANCE") {
                            setSessionPayerId("");
                            setSessionPayerNameSnapshot("");
                            setSessionInsurancePlanName("");
                            setSessionInsuranceCardNumber("");
                            setSessionInsuranceHolderName("");
                            setSessionInsuranceCardValidUntil("");
                            setSessionGuideNumber("");
                            setSessionAuthorizationCode("");
                            setSessionPatientTissAuthorizationId("");
                          }
                        }}
                      >
                        {APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-2 block text-xs font-normal text-slate-500">
                        {selectedFinancialContextOption?.description || APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE}
                      </span>
                    </label>
                    {sessionFinancialContextType === "INSURANCE" && (
                      <label className={sessionModalLabelClass}>
                        Pagador/convênio
                        <select
                          className={sessionModalSelectClass}
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
                              {sessionPayerNameSnapshot || selectedSessionPatientInsurancePayer.payerName || "Pagador cadastrado"} (histórico/inativo)
                            </option>
                          )}
                          {clinicPayers.map((payer: any) => (
                            <option key={payer.id} value={payer.id}>
                              {payer.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {sessionFinancialContextType === "INSURANCE" && (
                      <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Dados do plano</p>
                            <p className="mt-1 text-xs font-normal text-slate-500">
                              Somente leitura no agendamento. Edite estes dados no cadastro do paciente.
                            </p>
                          </div>
                          {selectedSessionPatient && (
                            <button
                              type="button"
                              onClick={openSelectedSessionPatientInsuranceRegistration}
                              className="w-fit rounded-xl border border-violet-100 bg-white px-3 py-2 text-xs font-semibold text-[#7a32fc] transition-colors hover:bg-violet-50"
                            >
                              Editar dados do convênio no paciente
                            </button>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {[
                            ["Plano", formatSessionReadonlyValue(sessionInsurancePlanName)],
                            ["Carteirinha", formatSessionReadonlyValue(sessionInsuranceCardNumber)],
                            ["Titular", formatSessionReadonlyValue(sessionInsuranceHolderName)],
                            ["Validade", formatSessionReadonlyDate(sessionInsuranceCardValidUntil)],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-xl border border-white bg-white px-3 py-2">
                              <p className="text-[11px] font-medium text-slate-400">{label}</p>
                              <p className={`mt-1 text-sm font-medium ${String(value).startsWith("não cadastrad") ? "text-amber-700" : "text-slate-700"}`}>
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>
                        {selectedSessionPatient && (!sessionInsurancePlanName.trim() || !sessionInsuranceCardNumber.trim()) && (
                          <p className="mt-2 text-[11px] font-medium text-amber-700">
                            Complete o vínculo deste convênio no cadastro do paciente para evitar pendência na Pré-guia.
                          </p>
                        )}
                      </div>
                    )}
                    {sessionFinancialContextType === "INSURANCE" ? (
                      <>
                        <label className={sessionModalLabelClass}>
                          Guia
                          <input
                            className={sessionModalInputClass}
                            value={sessionGuideNumber}
                            onChange={(e) => setSessionGuideNumber(e.target.value)}
                            placeholder="Número da guia"
                          />
                        </label>
                        <label className={`sm:col-span-2 ${sessionModalLabelClass}`}>
                          Autorização/senha
                          <input
                            className={sessionModalInputClass}
                            value={sessionAuthorizationCode}
                            onChange={(e) => setSessionAuthorizationCode(e.target.value)}
                            placeholder="Código informado pelo pagador"
                          />
                        </label>
                      </>
                    ) : sessionFinancialContextType === "PRIVATE" ? (
                      <div className="sm:col-span-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                        Atendimento particular, sem pagador de convênio.
                      </div>
                    ) : null}
                    {sessionFinancialContextType === "INSURANCE" && sessionPayerId && selectedSessionPatient && (
                      <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              Autorizações disponíveis
                            </p>
                            <p className="mt-1 text-xs font-normal text-slate-500">
                              Guia/senha do paciente neste convênio, serviço e data. Selecionar não consome saldo.
                            </p>
                          </div>
                          <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-semibold text-[#7a32fc]">
                            {sessionUsableTissAuthorizations.length} utilizável(is)
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {sessionBillingSuggestionState.loading ? (
                            <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-medium text-[#7a32fc]">
                              Carregando autorizações do paciente...
                            </div>
                          ) : sessionBillingSuggestionState.error ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                              {sessionBillingSuggestionState.error}
                            </div>
                          ) : sessionUsableTissAuthorizations.length > 0 || sessionUnavailableTissAuthorizations.length > 0 ? (
                            <>
                              {sessionUsableTissAuthorizations.length > 0 ? (
                                sessionUsableTissAuthorizations.slice(0, 6).map((authorization: any) => renderSessionTissAuthorizationCard(authorization))
                              ) : (
                                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                  <p className="font-semibold">{sessionAuthorizationUnavailableInsight.title}</p>
                                  <p className="mt-1 font-normal">{sessionAuthorizationUnavailableInsight.detail}</p>
                                </div>
                              )}
                              {sessionUnavailableTissAuthorizations.length > 0 && (
                                <div className="rounded-xl border border-slate-100 bg-slate-50">
                                  <button
                                    type="button"
                                    onClick={() => setShowSessionUnavailableTissAuthorizations((current) => !current)}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium text-slate-600"
                                  >
                                    <span>Autorizações não utilizáveis · {sessionUnavailableTissAuthorizations.length} no histórico recente</span>
                                    <span>{showSessionUnavailableTissAuthorizations ? "Recolher" : "Ver detalhes"}</span>
                                  </button>
                                  {showSessionUnavailableTissAuthorizations && (
                                    <div className="space-y-2 border-t border-slate-100 p-2">
                                      {sessionUnavailableTissAuthorizations.slice(0, 8).map((authorization: any) =>
                                        renderSessionTissAuthorizationCard(authorization, { compact: true, history: true })
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              <p className="font-semibold">{sessionAuthorizationUnavailableInsight.title}</p>
                              <p className="mt-1 font-normal">{sessionAuthorizationUnavailableInsight.detail}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {sessionFinancialContextType === "INSURANCE" && !editingAppointmentId && Number(sessionNumSessions) > 1 && (
                      <div className="sm:col-span-2 space-y-3 rounded-2xl border border-violet-100 bg-white p-3">
                        <label className="flex items-start gap-3 text-xs font-semibold normal-case tracking-normal text-slate-700">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                            checked={sessionApplyAuthorizationToRecurrence}
                            onChange={(event) =>
                              setSessionApplyAuthorizationToRecurrence(event.target.checked)
                            }
                          />
                          <span>
                            Aplicar esta autorização às {sessionNumSessions} sessões
                          </span>
                        </label>
                        <label className="flex items-start gap-3 text-xs font-semibold normal-case tracking-normal text-slate-700">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                            checked={sessionReuseGuideAcrossRecurrence}
                            onChange={(event) =>
                              setSessionReuseGuideAcrossRecurrence(event.target.checked)
                            }
                          />
                          <span>Usar esta mesma guia em todas as sessões</span>
                        </label>
                        {!sessionReuseGuideAcrossRecurrence && (
                          <p className="text-[11px] font-medium text-slate-500">
                            A primeira consulta mantém a guia informada. As demais ficam com guia pendente por ocorrência.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {sessionFinancialContextError && (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                      {APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE}
                    </div>
                  )}
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
                  <p className="text-sm font-semibold text-slate-800">
                    Este agendamento faz parte de uma recorrência.
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Escolha se a remarcação vale só para esta data ou para esta e as próximas consultas da série.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setAppointmentEditScope("single")}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
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
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
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
                      <span className="block text-sm font-semibold text-slate-800">
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
                        <label className={sessionModalLabelClass}>
                          Recorrência
                        </label>
                        <select
                          className={sessionModalSelectClass}
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
                        <label className={sessionModalLabelClass}>
                          Quantidade de sessões
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={52}
                          className={sessionModalInputClass}
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
                      <p className="text-xs font-medium text-slate-500">
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
                disabled={!canSubmitSession}
                className="mt-2 w-full rounded-xl bg-[#7a32fc] py-4 font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSessionSubmitting
                  ? "Salvando..."
                  : editingAppointmentId
                  ? "Salvar alterações"
                  : "Confirmar agendamento"}
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
            className="bg-white w-full max-w-4xl rounded-3xl p-6 md:p-8 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 overflow-hidden items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-700">
                  <SecureImage
                    src={getPatientPhotoSource(selectedPatientProfile)}
                    alt={`Foto de ${normalizeUtf8Text(selectedPatientProfile?.name || "Paciente")}`}
                    className="h-full w-full object-cover"
                    fallback={<span>{getPatientInitial(selectedPatientProfile)}</span>}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#7a32fc]">Ver cadastro</p>
                  <h3 className="mt-1 truncate text-2xl font-black text-slate-900">
                    {selectedPatientProfile.name || "Paciente"}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-400">
                    Visão operacional do cadastro, convênio, autorização TISS e plano financeiro.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPatientProfileModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={22} />
              </button>
            </div>

            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <h4 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Informações cadastrais</h4>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {renderPatientProfileSummaryField("Nome completo", selectedPatientProfile.name)}
                  {renderPatientProfileSummaryField("Nome social", selectedPatientProfile.socialName)}
                  {renderPatientProfileSummaryField("Nascimento", formatBirthDateForDisplay(selectedPatientProfile.birthDate || selectedPatientProfile.birth_date || selectedPatientProfile.dataNascimento))}
                  {renderPatientProfileSummaryField("Telefone", selectedPatientProfile.phone)}
                  {renderPatientProfileSummaryField("Email", selectedPatientProfile.email)}
                  {renderPatientProfileSummaryField("CPF", formatCpf(selectedPatientProfile.cpf || ""))}
                  {renderPatientProfileSummaryField("RG", selectedPatientProfile.rg)}
                  {renderPatientProfileSummaryField("Perfil / portal", getPatientProfileTypeLabel(selectedPatientProfile.patientProfileType))}
                  {renderPatientProfileSummaryField("Endereço", [selectedPatientProfile.address?.logradouro, selectedPatientProfile.address?.numero, selectedPatientProfile.address?.complemento, selectedPatientProfile.address?.bairro, selectedPatientProfile.address?.cidade].filter(Boolean).join(" - "), "xl:col-span-2")}
                  {selectedPatientProfile.guardian?.nome || selectedPatientProfile.responsavelNome ? (
                    renderPatientProfileSummaryField("Responsável legal", selectedPatientProfile.guardian?.nome || selectedPatientProfile.responsavelNome, "xl:col-span-3")
                  ) : null}
                  {renderPatientProfileSummaryField("Observações", selectedPatientProfile.notes, "xl:col-span-3")}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-100 bg-white p-4">
                <h4 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Convênio e elegibilidade</h4>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {renderPatientProfileSummaryField("Convênio atual", selectedProfileEligibility.convenioNome || selectedPatientProfile.insuranceName || selectedPatientProfile.insuranceType)}
                  {renderPatientProfileSummaryField("Carteirinha", selectedProfileEligibility.convenioCarteirinha || selectedPatientProfile.cardNumber)}
                  {renderPatientProfileSummaryField("Plano / categoria", selectedProfileEligibility.convenioPlanoCategoria || selectedPatientProfile.insurancePlanCategory)}
                  {renderPatientProfileSummaryField("Validade da carteirinha", formatPatientAuthorizationDate(selectedProfileEligibility.convenioCarteirinhaValidade || selectedPatientProfile.insuranceCardValidUntil))}
                  {renderPatientProfileSummaryField("Titular", selectedProfileEligibility.convenioTitularNome || selectedPatientProfile.insuranceHolderName)}
                  {renderPatientProfileSummaryField("CPF do titular", formatCpf(selectedProfileEligibility.convenioTitularCpf || selectedPatientProfile.insuranceHolderCpf || ""))}
                  {renderPatientProfileSummaryField("Relação com titular", selectedProfileEligibility.convenioTitularRelacao || selectedPatientProfile.insuranceHolderRelationship)}
                  {renderPatientProfileSummaryField("Observações de elegibilidade", selectedProfileEligibility.convenioElegibilidadeObs || selectedPatientProfile.eligibilityNotes, "xl:col-span-3")}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-100 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Autorização TISS vigente</h4>
                  {selectedPatientProfileAuthorizationsLoading && <span className="text-xs font-semibold text-slate-400">Carregando...</span>}
                </div>
                {selectedProfileSuggestedAuthorization ? (
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-black text-slate-900">{selectedProfileSuggestedAuthorization.serviceName || "Procedimento faturável"}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ring-1 ${patientAuthorizationStatusClass(selectedProfileSuggestedAuthorization)}`}>
                        {getPatientTissAuthorizationVisualState(selectedProfileSuggestedAuthorization).label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 md:grid-cols-2">
                      <span>TUSS: {selectedProfileSuggestedAuthorization.tussCode || "-"}</span>
                      <span>Guia: {selectedProfileSuggestedAuthorization.guideNumber || "-"}</span>
                      <span>Autorização/Senha: {selectedProfileSuggestedAuthorization.authorizationNumber || selectedProfileSuggestedAuthorization.authorizationCode || "-"}</span>
                      <span>Validade: {formatPatientAuthorizationDate(selectedProfileSuggestedAuthorization.validFrom)} a {formatPatientAuthorizationDate(selectedProfileSuggestedAuthorization.validUntil)}</span>
                      <span>Consumidas: {getPatientTissAuthorizationQuantitySummary(selectedProfileSuggestedAuthorization).consumed}</span>
                      <span>Reservadas/comprometidas: {getPatientTissAuthorizationQuantitySummary(selectedProfileSuggestedAuthorization).reserved}</span>
                      <span>Autorizadas: {getPatientTissAuthorizationQuantitySummary(selectedProfileSuggestedAuthorization).authorized || "sem limite"}</span>
                      <span>Saldo: {formatPatientAuthorizationBalance(selectedProfileSuggestedAuthorization)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
                    {selectedPatientProfileAuthorizationsLoading ? "Buscando autorização TISS vigente..." : "Nenhuma autorização TISS vigente encontrada."}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-100 bg-white p-4">
                <h4 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Plano financeiro</h4>
                {selectedProfilePrimaryFinancialPlan ? (
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {renderPatientProfileSummaryField("Linha de cuidado", selectedProfilePrimaryFinancialPlan.specialty || selectedProfilePrimaryFinancialPlan.customServiceName || selectedProfilePrimaryFinancialPlan.serviceType)}
                    {renderPatientProfileSummaryField("Modalidade de cobrança", PATIENT_FINANCIAL_BILLING_MODE_OPTIONS.find((option) => option.value === selectedProfilePrimaryFinancialPlan.billingMode)?.label || selectedProfilePrimaryFinancialPlan.billingMode)}
                    {renderPatientProfileSummaryField("Valor planejado", selectedProfilePrimaryFinancialPlan.amount || formatPatientAuthorizationAmount(selectedProfilePrimaryFinancialPlan.amountCents))}
                    {renderPatientProfileSummaryField("Quantidade planejada", selectedProfilePrimaryFinancialPlan.sessionsQuantity)}
                    {renderPatientProfileSummaryField("Frequência", PATIENT_FINANCIAL_QUANTITY_PERIOD_OPTIONS.find((option) => option.value === selectedProfilePrimaryFinancialPlan.quantityPeriod)?.label || selectedProfilePrimaryFinancialPlan.quantityPeriod)}
                    {renderPatientProfileSummaryField("Coparticipação", selectedProfilePrimaryFinancialPlan.copaymentAmount)}
                    {renderPatientProfileSummaryField("Pagador de referência", selectedProfilePrimaryFinancialPlan.payerNameSnapshot || selectedProfilePrimaryFinancialPlan.insuranceName, "xl:col-span-3")}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
                    Nenhum plano financeiro ativo/resumido encontrado.
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-100 bg-white p-4">
                <h4 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Alertas operacionais</h4>
                {selectedProfileOperationalAlerts.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedProfileOperationalAlerts.map((alert) => (
                      <span key={alert} className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                        {alert}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm font-medium text-slate-500">Nenhum alerta operacional seguro para exibir agora.</p>
                )}
              </section>
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

            {selectedAgendaAppointment.actionIntent === "collect_signature" && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-bold">Coletar assinatura</p>
                <p className="mt-1 text-xs">
                  Assinatura do responsável exigida pelo convênio. Abra o atendimento/prontuário da sessão para registrar a assinatura e depois revalide a Pré-guia TISS.
                </p>
              </div>
            )}

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

            <div className="mb-5 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-1">
                {patientRegistrationTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActivePatientRegistrationTab(tab.id)}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                      activePatientRegistrationTab === tab.id
                        ? "bg-white text-[#7a32fc] shadow-sm"
                        : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
                    }`}
                  >
                    {tab.label}
                    {tab.badge && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              {activePatientRegistrationTab === "personal" && (
              <FormSection
                title="Dados pessoais do paciente"
                description="Informações principais de identificação, contato e acesso do paciente."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <FormField label="Nome completo" required>
                    <input className={patientFormInputClass} placeholder="Nome completo" value={newPatientForm.nome} onChange={(e) => handlePatientFormChange("nome", e.target.value)} />
                  </FormField>
                  <FormField label="Nome social">
                    <input className={patientFormInputClass} placeholder="Nome social" value={newPatientForm.nomeSocial} onChange={(e) => handlePatientFormChange("nomeSocial", e.target.value)} />
                  </FormField>
                  <FormField label="Telefone / WhatsApp" required>
                    <input className={patientFormInputClass} placeholder="(11) 91234-5678" value={newPatientForm.telefone} onChange={(e) => handlePatientFormChange("telefone", e.target.value)} />
                  </FormField>
                  <FormField label="Data de nascimento">
                    <input type="date" className={patientFormInputClass} value={newPatientForm.dataNascimento} onChange={(e) => handlePatientFormChange("dataNascimento", e.target.value)} />
                  </FormField>
                  <FormField label="Gênero">
                    <select className={patientFormInputClass} value={newPatientForm.genero} onChange={(e) => handlePatientFormChange("genero", e.target.value)}>
                      <option value="">Selecione</option>
                      <option value="feminino">Feminino</option>
                      <option value="masculino">Masculino</option>
                      <option value="nao_binario">Não binário</option>
                      <option value="prefiro_nao_informar">Prefiro não informar</option>
                    </select>
                  </FormField>
                  <FormField label="Faixa etária / categoria">
                    <select className={patientFormInputClass} value={newPatientForm.grupo} onChange={(e) => handlePatientFormChange("grupo", e.target.value)}>
                      <option value="infantil">Infantil</option>
                      <option value="adolescente">Adolescente</option>
                      <option value="adulto">Adulto</option>
                      <option value="idoso">Idoso</option>
                    </select>
                  </FormField>
                  <FormField label="RG">
                    <input className={patientFormInputClass} placeholder="RG" value={newPatientForm.rg} onChange={(e) => handlePatientFormChange("rg", e.target.value)} />
                  </FormField>
                  <FormField label="CPF">
                    <input className={patientFormInputClass} placeholder="000.000.000-00" value={newPatientForm.cpf} onChange={(e) => handlePatientFormChange("cpf", e.target.value)} />
                  </FormField>
                  <FormField label="E-mail">
                    <input className={patientFormInputClass} placeholder="paciente@email.com" value={newPatientForm.email} onChange={(e) => handlePatientFormChange("email", e.target.value)} />
                  </FormField>
                  <FormField label="Como conheceu a clínica?">
                    <select className={patientFormInputClass} value={newPatientForm.comoConheceu} onChange={(e) => handlePatientFormChange("comoConheceu", e.target.value)}>
                      <option value="">Selecione</option>
                      <option value="google">Google</option>
                      <option value="indicacao">Indicação</option>
                      <option value="email">Email</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="rede_social">Rede social</option>
                      <option value="evento">Evento</option>
                      <option value="convenio">Convênio</option>
                      <option value="outro">Outro</option>
                    </select>
                  </FormField>
                  <FormField label="CEP">
                    <input className={patientFormInputClass} placeholder="00000-000" value={newPatientForm.cep} onChange={(e) => handlePatientFormChange("cep", e.target.value)} />
                  </FormField>
                  <FormField label="Logradouro">
                    <input className={patientFormInputClass} placeholder="Rua, avenida..." value={newPatientForm.logradouro} onChange={(e) => handlePatientFormChange("logradouro", e.target.value)} />
                  </FormField>
                  <FormField label="Número">
                    <input className={patientFormInputClass} placeholder="Número" value={newPatientForm.numero} onChange={(e) => handlePatientFormChange("numero", e.target.value)} />
                  </FormField>
                  <FormField label="Complemento">
                    <input className={patientFormInputClass} placeholder="Apartamento, bloco..." value={newPatientForm.complemento} onChange={(e) => handlePatientFormChange("complemento", e.target.value)} />
                  </FormField>
                  <FormField label="Bairro">
                    <input className={patientFormInputClass} placeholder="Bairro" value={newPatientForm.bairro} onChange={(e) => handlePatientFormChange("bairro", e.target.value)} />
                  </FormField>
                  <FormField label="Cidade">
                    <input className={patientFormInputClass} placeholder="Cidade" value={newPatientForm.cidade} onChange={(e) => handlePatientFormChange("cidade", e.target.value)} />
                  </FormField>
                  <FormField
                    label="Tipo de portal do paciente"
                    helperText="Define a área de acesso do paciente no aplicativo."
                  >
                    <select className={patientFormInputClass} value={newPatientForm.patientProfileType} onChange={(e) => handlePatientFormChange("patientProfileType", e.target.value)}>
                      {PATIENT_PROFILE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </FormField>
                  <div className="flex items-center rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={newPatientForm.menorDeIdade} onChange={(e) => handlePatientFormChange("menorDeIdade", e.target.checked)} />
                      Menor de idade
                    </label>
                  </div>
                </div>

                {newPatientForm.menorDeIdade && (
                  <SubSection title="Responsável legal" description="Dados usados para contato e documentos quando o paciente é menor de idade.">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <FormField label="Nome do responsável">
                        <input className={patientFormInputClass} placeholder="Nome do responsável" value={newPatientForm.responsavelNome} onChange={(e) => handlePatientFormChange("responsavelNome", e.target.value)} />
                      </FormField>
                      <FormField label="Data de nascimento do responsável">
                        <input type="date" className={patientFormInputClass} value={newPatientForm.responsavelDataNascimento} onChange={(e) => handlePatientFormChange("responsavelDataNascimento", e.target.value)} />
                      </FormField>
                      <FormField label="CPF do responsável">
                        <input className={patientFormInputClass} placeholder="000.000.000-00" value={newPatientForm.responsavelCpf} onChange={(e) => handlePatientFormChange("responsavelCpf", e.target.value)} />
                      </FormField>
                      <FormField label="Telefone do responsável">
                        <input className={patientFormInputClass} placeholder="(11) 91234-5678" value={newPatientForm.responsavelTelefone} onChange={(e) => handlePatientFormChange("responsavelTelefone", e.target.value)} />
                      </FormField>
                      <FormField label="E-mail do responsável">
                        <input className={patientFormInputClass} placeholder="responsavel@email.com" value={newPatientForm.responsavelEmail} onChange={(e) => handlePatientFormChange("responsavelEmail", e.target.value)} />
                      </FormField>
                      <FormField label="Relação com o paciente">
                        <input className={patientFormInputClass} placeholder="Mãe, pai, tutor..." value={newPatientForm.responsavelRelacao} onChange={(e) => handlePatientFormChange("responsavelRelacao", e.target.value)} />
                      </FormField>
                    </div>
                  </SubSection>
                )}

                <div className="mt-4">
                  <FormField label="Outras informações">
                    <textarea
                      className="min-h-[110px] w-full rounded-xl border border-transparent bg-slate-50 p-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#7a32fc] focus:bg-white focus:ring-4 focus:ring-[#7a32fc]/10"
                      placeholder="Observações gerais sobre cadastro, contato ou contexto do paciente."
                      value={newPatientForm.outrasInformacoes}
                      onChange={(e) => handlePatientFormChange("outrasInformacoes", e.target.value)}
                    />
                  </FormField>
                </div>
              </FormSection>
              )}

              {activePatientRegistrationTab === "insurance" && (
              <FormSection
                title="Convênio e elegibilidade"
                description="Dados usados para validação de cobertura, carteirinha, pré-faturamento e Pré-guia TISS."
                badge="Usado na Pré-guia TISS"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    label="Tipo de atendimento / cobertura"
                    helperText="Define se este paciente será faturado como particular, convênio ou outro modelo."
                  >
                    <select className={patientFormInputClass} value={newPatientForm.convenioTipo} onChange={(e) => handlePatientFormChange("convenioTipo", e.target.value)}>
                      <option value="particular">Particular</option>
                      <option value="convenio">Convênio</option>
                    </select>
                  </FormField>
                  <FormField
                    label="Pagador / convênio"
                    helperText="Usado nas regras de cobrança, pré-faturamento e validação TISS/TUSS quando aplicável."
                  >
                    <select className={patientFormInputClass} value={newPatientForm.convenioNome} onChange={(e) => handlePatientFormChange("convenioNome", e.target.value)}>
                      <option value="">Selecione o convênio</option>
                      {insuranceOptions.map((ins) => (
                        <option key={ins} value={ins}>{ins}</option>
                      ))}
                    </select>
                  </FormField>
                </div>

                {newPatientForm.convenioTipo !== "convenio" ? (
                  <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-medium text-slate-500">
                    Dados de convênio não aplicáveis para paciente particular. Carteirinha, titular e elegibilidade não serão exigidos para Pré-guia TISS.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <SubSection title="Dados da carteirinha" description="Informações do beneficiário usadas para validação com o convênio.">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <FormField
                          label="Número da carteirinha"
                          helperText="Número de identificação do beneficiário no convênio."
                        >
                          <input className={patientFormInputClass} placeholder="Número da carteirinha" value={newPatientForm.convenioCarteirinha} onChange={(e) => handlePatientFormChange("convenioCarteirinha", e.target.value)} />
                        </FormField>
                        <FormField
                          label="Validade da carteirinha"
                          helperText="Alguns convênios exigem validade ativa para liberar a pré-guia."
                        >
                          <input type="date" className={patientFormInputClass} value={newPatientForm.convenioCarteirinhaValidade} onChange={(e) => handlePatientFormChange("convenioCarteirinhaValidade", e.target.value)} />
                        </FormField>
                        <FormField
                          label="Plano / categoria"
                          helperText="Ex.: Amil S380, Unimed Nacional, Bradesco Top."
                        >
                          <input className={patientFormInputClass} placeholder="Ex.: Amil S380" value={newPatientForm.convenioPlanoCategoria} onChange={(e) => handlePatientFormChange("convenioPlanoCategoria", e.target.value)} />
                        </FormField>
                      </div>
                    </SubSection>

                    <SubSection title="Titular do plano" description="Preencha quando o paciente não for o titular do convênio.">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <FormField
                          label="Nome do titular"
                          helperText={newPatientForm.insuranceHolderSuggestedFromResponsible
                            ? "Pré-preenchido com os dados do responsável. Você pode alterar se o titular do plano for outra pessoa."
                            : "Preencha quando o paciente não for o titular do convênio."}
                        >
                          <input className={patientFormInputClass} placeholder="Nome do titular" value={newPatientForm.convenioTitularNome} onChange={(e) => handlePatientFormChange("convenioTitularNome", e.target.value)} />
                        </FormField>
                        <FormField
                          label="CPF do titular"
                          helperText={newPatientForm.insuranceHolderSuggestedFromResponsible
                            ? "Pré-preenchido com os dados do responsável. Você pode alterar se necessário."
                            : "Pode ser exigido pelo convênio para validação do beneficiário."}
                        >
                          <input className={patientFormInputClass} placeholder="000.000.000-00" value={newPatientForm.convenioTitularCpf} onChange={(e) => handlePatientFormChange("convenioTitularCpf", e.target.value)} />
                        </FormField>
                        <FormField
                          label="Relação com titular"
                          helperText={newPatientForm.insuranceHolderSuggestedFromResponsible
                            ? "Pré-preenchido pela relação do responsável com o paciente."
                            : "Ex.: filho(a), cônjuge, dependente."}
                        >
                          <input className={patientFormInputClass} placeholder="Ex.: filho(a)" value={newPatientForm.convenioTitularRelacao} onChange={(e) => handlePatientFormChange("convenioTitularRelacao", e.target.value)} />
                        </FormField>
                      </div>
                    </SubSection>

                    <FormField
                      label="Observações de elegibilidade"
                      helperText="Informações sobre cobertura, carência, exceções ou regras do convênio."
                    >
                      <textarea
                        className="min-h-[92px] w-full rounded-xl border border-transparent bg-slate-50 p-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#7a32fc] focus:bg-white focus:ring-4 focus:ring-[#7a32fc]/10"
                        placeholder="Cobertura, carências, exceções ou regras combinadas."
                        value={newPatientForm.convenioElegibilidadeObs}
                        onChange={(e) => handlePatientFormChange("convenioElegibilidadeObs", e.target.value)}
                      />
                    </FormField>
                  </div>
                )}
              </FormSection>
              )}

              {canAccessClinicFinance && activePatientRegistrationTab === "tiss" && (
                <div id="patient-tiss-authorizations-section">
                  <FormSection
                    title="Autorizações TISS do paciente"
                    description="Use esta seção para controlar senhas/guias autorizadas pelo convênio. O Verto sugere a autorização vigente compatível para novas sessões e Pré-guias."
                    badge="Convênio"
                  >
                  {newPatientForm.convenioTipo !== "convenio" ? (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">
                      Autorizações TISS não são necessárias para paciente particular.
                    </div>
                  ) : !editingPatientId ? (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                      Salve o cadastro do paciente antes de criar autorizações TISS.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs text-slate-500">
                            Convênio selecionado: <span className="text-slate-800">{newPatientForm.convenioNome || "Não informado"}</span>
                          </p>
                          {!selectedPatientInsurancePayer?.id && (
                            <p className="mt-1 text-xs text-amber-700">
                              Este convênio ainda não foi encontrado no cadastro de Convênios/TUSS.
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={openNewPatientTissAuthorizationForm}
                          disabled={!selectedPatientInsurancePayer?.id || patientAuthorizationBillingConfigurations.length === 0}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-4 py-2 text-xs font-normal text-white shadow-sm disabled:opacity-50"
                        >
                          <Plus size={14} />
                          Nova autorização
                        </button>
                      </div>

                      {patientAuthorizationBillingConfigurations.length === 0 && selectedPatientInsurancePayer?.id ? (
                        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                          Nenhuma configuração ativa com procedimento, código TUSS, De/Para e valor negociado foi encontrada para este convênio.
                        </div>
                      ) : null}

                      {patientTissAuthorizationFeedback.message && (
                        <div className={`rounded-2xl border px-4 py-3 text-sm ${
                          patientTissAuthorizationFeedback.type === "error"
                            ? "border-rose-100 bg-rose-50 text-rose-700"
                            : patientTissAuthorizationFeedback.type === "success"
                              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                              : "border-slate-100 bg-slate-50 text-slate-600"
                        }`}>
                          {patientTissAuthorizationFeedback.message}
                        </div>
                      )}

                      {patientTissAuthorizationFormOpen && (
                        <SubSection
                          title={editingPatientTissAuthorizationId ? "Editar autorização TISS" : "Nova autorização TISS"}
                          description="O código TUSS e o valor são resolvidos pelo De/Para e pela Tabela de Valores do convênio."
                        >
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            <FormField label="Convênio">
                              <input className={patientFormInputClass} value={selectedPatientInsurancePayer?.name || newPatientForm.convenioNome || ""} readOnly />
                            </FormField>
                            <FormField label="Procedimento faturável">
                              <select
                                className={patientFormInputClass}
                                value={patientTissAuthorizationForm.configurationKey}
                                onChange={(event) => handlePatientTissAuthorizationConfigurationChange(event.target.value)}
                              >
                                {patientAuthorizationBillingConfigurations.map((configuration: any) => (
                                  <option key={configuration.key} value={configuration.key}>
                                    {configuration.service?.name || configuration.mapping?.serviceName || "Procedimento"} · TUSS {configuration.code?.code || configuration.mapping?.tussCode || ""}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <FormField label="Código TUSS resolvido" helperText="Fonte: De/Para ativo do convênio.">
                              <input
                                className={patientFormInputClass}
                                value={selectedPatientAuthorizationConfiguration
                                  ? `${selectedPatientAuthorizationConfiguration.code?.code || selectedPatientAuthorizationConfiguration.mapping?.tussCode || ""} - ${selectedPatientAuthorizationConfiguration.code?.description || selectedPatientAuthorizationConfiguration.mapping?.tussDescription || ""}`.trim()
                                  : "Nenhum De/Para ativo"}
                                readOnly
                              />
                            </FormField>
                            <FormField label="Valor negociado" helperText="Fonte operacional: Tabela de Valores negociados.">
                              <input className={patientFormInputClass} value={formatPatientAuthorizationAmount(selectedPatientAuthorizationConfiguration?.price?.amountCents)} readOnly />
                            </FormField>
                            <FormField label="Número da autorização / senha" required>
                              <input
                                className={patientFormInputClass}
                                placeholder="Ex.: 123456789"
                                value={patientTissAuthorizationForm.authorizationNumber}
                                onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, authorizationNumber: event.target.value }))}
                              />
                            </FormField>
                            <FormField label="Número da guia">
                              <input
                                className={patientFormInputClass}
                                placeholder="Ex.: 5478"
                                value={patientTissAuthorizationForm.guideNumber}
                                onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, guideNumber: event.target.value }))}
                              />
                            </FormField>
                            <FormField label="Data inicial" required>
                              <input type="date" className={patientFormInputClass} value={patientTissAuthorizationForm.validFrom} onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, validFrom: event.target.value }))} />
                            </FormField>
                            <FormField label="Data final" required>
                              <input type="date" className={patientFormInputClass} value={patientTissAuthorizationForm.validUntil} onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, validUntil: event.target.value }))} />
                            </FormField>
                            <FormField label="Quantidade autorizada" required>
                              <input
                                type="number"
                                min={1}
                                className={patientFormInputClass}
                                value={patientTissAuthorizationForm.authorizedQuantity}
                                onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, authorizedQuantity: event.target.value }))}
                              />
                            </FormField>
                            <FormField label="Unidade">
                              <input className={patientFormInputClass} value={patientTissAuthorizationForm.authorizedUnit || "sessions"} readOnly />
                            </FormField>
                            <FormField label="Quantidade consumida" helperText="Calculada por Pré-guias/sessões vinculadas quando houver histórico confiável.">
                              <input className={patientFormInputClass} value={patientTissAuthorizationForm.usedQuantity || "0"} readOnly />
                            </FormField>
                            <FormField label="Status">
                              <select className={patientFormInputClass} value={patientTissAuthorizationForm.status} onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, status: event.target.value }))}>
                                <option value="active">Ativa</option>
                                <option value="cancelled">Inativa</option>
                              </select>
                            </FormField>
                            <div className="md:col-span-2 xl:col-span-3">
                              <FormField label="Observações">
                                <textarea
                                  className="min-h-[84px] w-full rounded-xl border border-transparent bg-slate-50 p-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#7a32fc] focus:bg-white focus:ring-4 focus:ring-[#7a32fc]/10"
                                  placeholder="Observações administrativas sobre a autorização."
                                  value={patientTissAuthorizationForm.notes}
                                  onChange={(event) => setPatientTissAuthorizationForm((current: any) => ({ ...current, notes: event.target.value }))}
                                />
                              </FormField>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap justify-end gap-2">
                            <button type="button" onClick={() => { setPatientTissAuthorizationFormOpen(false); resetPatientTissAuthorizationForm(); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-normal text-slate-600">
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={savePatientTissAuthorization}
                              disabled={patientTissAuthorizationFeedback.type === "saving"}
                              className="inline-flex items-center gap-2 rounded-xl bg-[#7a32fc] px-4 py-2 text-sm font-normal text-white disabled:opacity-50"
                            >
                              {patientTissAuthorizationFeedback.type === "saving" ? "Salvando..." : editingPatientTissAuthorizationId ? "Atualizar autorização" : "Salvar autorização"}
                            </button>
                          </div>
                        </SubSection>
                      )}

                      <div className="space-y-3">
                        {patientTissAuthorizationLoading ? (
                          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500">Carregando autorizações...</div>
                        ) : patientTissAuthorizations.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                            Nenhuma autorização TISS cadastrada para este paciente.
                          </div>
                        ) : (
                          <>
                            <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4">
                              <div className="flex flex-col gap-1">
                                <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                                  Autorização vigente sugerida para novas sessões
                                </p>
                                <p className="text-sm font-medium text-emerald-800">
                                  Esta é a autorização que o Verto sugere para as próximas sessões, considerando validade, saldo e compatibilidade visual com o De/Para TUSS.
                                </p>
                              </div>
                              {patientTissSuggestedAuthorization ? (
                                <div className="mt-4">
                                  {renderPatientTissAuthorizationCard(patientTissSuggestedAuthorization)}
                                </div>
                              ) : (
                                <div className="mt-4 rounded-2xl border border-amber-100 bg-white px-4 py-3 text-sm text-amber-800">
                                  <p className="font-black">Nenhuma autorização TISS vigente elegível para novas sessões.</p>
                                  <p className="mt-1 text-xs font-medium">Verifique validade, saldo e De/Para TUSS do convênio.</p>
                                </div>
                              )}
                            </div>

                            {patientTissCollapsedCurrentAuthorizations.length > 0 && (
                              <details className="rounded-2xl border border-slate-100 bg-white">
                                <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                                  Autorizações semelhantes ({patientTissCollapsedCurrentAuthorizations.length})
                                </summary>
                                <div className="space-y-3 border-t border-slate-100 p-3">
                                  {patientTissCollapsedCurrentAuthorizations.map((authorization: any) =>
                                    renderPatientTissAuthorizationCard(authorization, { compact: true }),
                                  )}
                                </div>
                              </details>
                            )}

                            {patientTissLegacyAuthorizations.length > 0 && (
                              <details className="rounded-2xl border border-amber-100 bg-amber-50/70">
                                <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-wide text-amber-700">
                                  Autorizações legadas/inadequadas para Pré-guia ({patientTissLegacyAuthorizations.length})
                                </summary>
                                <div className="space-y-3 border-t border-amber-100 p-3">
                                  <p className="rounded-2xl bg-white px-4 py-3 text-xs font-medium text-amber-800">
                                    Registros antigos ou incompatíveis ficam preservados aqui para conferência, mas não serão sugeridos para novas Pré-guias.
                                  </p>
                                  {patientTissLegacyAuthorizations.map((authorization: any) =>
                                    renderPatientTissAuthorizationCard(authorization, { compact: true }),
                                  )}
                                </div>
                              </details>
                            )}

                            {patientTissHistoricalAuthorizations.length > 0 && (
                              <details className="rounded-2xl border border-slate-100 bg-white">
                                <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                                  Autorizações históricas/inativas ({patientTissHistoricalAuthorizations.length})
                                </summary>
                                <div className="space-y-3 border-t border-slate-100 p-3">
                                  {patientTissHistoricalAuthorizations.map((authorization: any) =>
                                    renderPatientTissAuthorizationCard(authorization, { compact: true }),
                                  )}
                                </div>
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  </FormSection>
                </div>
              )}

              {canAccessClinicFinance && activePatientRegistrationTab === "financial" && (
                <FormSection
                  title="Plano financeiro do tratamento"
                  description="Use esta seção para planejar valores, frequência e modalidade de cobrança. Autorizações TISS ficam na seção própria acima."
                >
                  <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    O plano financeiro organiza cobrança e recorrência. Senhas, guias e saldo autorizado para Pré-guia/XML devem ser mantidos em Autorizações TISS do paciente.
                  </div>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-500">Linhas de cuidado e cobrança</p>
                      <p className="text-[11px] font-medium text-slate-400">Use esta seção para planejamento financeiro, recorrência e cobrança geral.</p>
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
                        const suggestedFinancialPlanAuthorization = isInsurancePlan
                          ? findSuggestedTissAuthorizationForFinancialPlan(plan, patientTissAuthorizationGroups)
                          : null;
                        const resolvedFinancialPlanPayer = isInsurancePlan ? resolveFinancialPlanPayer(plan) : null;
                        const financialPlanPayerDisplayName =
                          resolvedFinancialPlanPayer?.name ||
                          plan.payerNameSnapshot ||
                          plan.insuranceName ||
                          newPatientForm.convenioNome ||
                          "";
                        return (
                          <div key={plan.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                              <div className="xl:col-span-2">
                                <FormField label="Linha de cuidado / especialidade">
                                  <select
                                    className={patientFormInputClass}
                                    value={plan.serviceType}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "serviceType", e.target.value)}
                                  >
                                    <option value="">Especialidade/serviço</option>
                                    {PATIENT_FINANCIAL_SERVICE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </FormField>
                              </div>
                            {plan.serviceType === "CUSTOM" && (
                              <div className="xl:col-span-2">
                                <FormField label="Nome do serviço">
                                  <input
                                    className={patientFormInputClass}
                                    placeholder="Nome do serviço"
                                    value={plan.customServiceName}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "customServiceName", e.target.value)}
                                  />
                                </FormField>
                              </div>
                            )}
                              <FormField label="Modalidade de cobrança">
                                <select
                                  className={patientFormInputClass}
                                  value={plan.billingMode}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "billingMode", e.target.value)}
                                >
                                  {PATIENT_FINANCIAL_BILLING_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </FormField>
                            {!isCourtesyPlan && (
                              <FormField label={isInsurancePlan ? "Valor planejado do convênio" : isPackagePlan ? "Valor do pacote" : isMonthlyPlan ? "Mensalidade" : "Valor"}>
                                <input
                                  className={patientFormInputClass}
                                  placeholder="R$ 0,00"
                                  inputMode="decimal"
                                  value={plan.amount}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "amount", e.target.value)}
                                />
                              </FormField>
                            )}
                              <FormField label={isInsurancePlan ? "Quantidade planejada" : "Quantidade"}>
                                <div className="flex items-center gap-2">
                                  <input
                                    className="min-w-0 flex-1 rounded-xl border border-transparent bg-slate-50 p-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-[#7a32fc] focus:bg-white focus:ring-4 focus:ring-[#7a32fc]/10"
                                    placeholder={isInsurancePlan ? "Qtde. planejada" : "Sessões"}
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
                              </FormField>
                              <FormField label="Frequência">
                                <select
                                  className={patientFormInputClass}
                                  value={plan.quantityPeriod}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "quantityPeriod", e.target.value)}
                                >
                                  {PATIENT_FINANCIAL_QUANTITY_PERIOD_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </FormField>
                            {isMonthlyPlan && (
                              <FormField label="Dia de vencimento">
                                <input
                                  className={patientFormInputClass}
                                  placeholder="Dia"
                                  type="number"
                                  min={1}
                                  max={31}
                                  value={plan.dueDay}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "dueDay", e.target.value)}
                                />
                              </FormField>
                            )}
                            {isPackagePlan && (
                              <FormField label="Validade do pacote">
                                <input
                                  type="date"
                                  className={patientFormInputClass}
                                  value={plan.packageValidUntil}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "packageValidUntil", e.target.value)}
                                />
                              </FormField>
                            )}
                            {isInsurancePlan && (
                              <>
                                <div className="xl:col-span-2">
                                  <FormField
                                    label="Convênio"
                                    helperText={financialPlanPayerDisplayName ? `Convênio: ${financialPlanPayerDisplayName}` : "Convênio não definido. Defina o convênio na aba Convênio e elegibilidade."}
                                  >
                                    <select
                                      className={patientFormInputClass}
                                      value={plan.payerId || resolvedFinancialPlanPayer?.id || ""}
                                      onChange={(e) => {
                                        const payer = clinicPayers.find((item: any) => String(item?.id) === e.target.value);
                                        handleFinancialPlanChange(plan.id, "payerId", e.target.value);
                                        handleFinancialPlanChange(plan.id, "payerNameSnapshot", payer?.name || plan.payerNameSnapshot || "");
                                      }}
                                    >
                                      <option value="">Convênio não definido</option>
                                      {clinicPayers.map((payer: any) => (
                                        <option key={`financial-payer-${plan.id}-${payer.id}`} value={payer.id}>
                                          {payer.name}
                                        </option>
                                      ))}
                                    </select>
                                  </FormField>
                                </div>
                                {!resolvedFinancialPlanPayer && plan.payerNameSnapshot && (
                                  <FormField label="Convênio exibido">
                                    <input
                                      className={patientFormInputClass}
                                      placeholder="Nome do convênio"
                                      value={plan.payerNameSnapshot}
                                      onChange={(e) => handleFinancialPlanChange(plan.id, "payerNameSnapshot", e.target.value)}
                                    />
                                  </FormField>
                                )}
                                <FormField
                                  label="Plano / categoria"
                                  helperText="Fonte oficial para o agendamento quando este convênio for selecionado."
                                >
                                  <input
                                    className={patientFormInputClass}
                                    placeholder="Ex.: Unimed Nacional"
                                    value={plan.insurancePlanName}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "insurancePlanName", e.target.value)}
                                  />
                                </FormField>
                                <FormField
                                  label="Número da carteirinha"
                                  helperText="Carteirinha específica deste convênio."
                                >
                                  <input
                                    className={patientFormInputClass}
                                    placeholder="Número da carteirinha"
                                    value={plan.insuranceCardNumber}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "insuranceCardNumber", e.target.value)}
                                  />
                                </FormField>
                                <FormField
                                  label="Titular do plano"
                                  helperText="Preencha o titular usado por este convênio."
                                >
                                  <input
                                    className={patientFormInputClass}
                                    placeholder="Nome do titular"
                                    value={plan.insuranceCardHolder}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "insuranceCardHolder", e.target.value)}
                                  />
                                </FormField>
                                <FormField
                                  label="Validade da carteirinha"
                                  helperText="Validade vinculada a este convênio."
                                >
                                  <input
                                    type="date"
                                    className={patientFormInputClass}
                                    value={plan.insuranceCardValidUntil}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "insuranceCardValidUntil", e.target.value)}
                                  />
                                </FormField>
                                <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs font-medium text-slate-600 xl:col-span-2">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#7a32fc]"
                                    checked={Boolean(plan.isPrimaryInsurance)}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "isPrimaryInsurance", e.target.checked)}
                                  />
                                  <span>
                                    <span className="block text-slate-800">Convênio principal/atual</span>
                                    <span className="mt-1 block text-slate-500">
                                      Usado como preferência ao criar novos agendamentos de convênio.
                                    </span>
                                  </span>
                                </label>
                                <FormField label="Coparticipação">
                                  <input
                                    className={patientFormInputClass}
                                    placeholder="R$ 0,00"
                                    inputMode="decimal"
                                    value={plan.copaymentAmount}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "copaymentAmount", e.target.value)}
                                  />
                                </FormField>
                                <div className="md:col-span-2 xl:col-span-6">
                                  <div className={`rounded-2xl border px-4 py-3 text-xs ${
                                    suggestedFinancialPlanAuthorization
                                      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                                      : "border-slate-100 bg-slate-50 text-slate-600"
                                  }`}>
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="font-black uppercase tracking-wide">Autorização TISS vinculada/sugerida</p>
                                        <p className="mt-1 font-medium">
                                          {suggestedFinancialPlanAuthorization
                                            ? describePatientAuthorizationSuggestion(suggestedFinancialPlanAuthorization)
                                            : "Nenhuma autorização TISS vigente para este plano."}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={suggestedFinancialPlanAuthorization ? scrollToPatientTissAuthorizations : goToNewPatientTissAuthorization}
                                        className="w-fit rounded-xl border border-white/70 bg-white px-3 py-2 text-xs font-bold text-[#7a32fc] shadow-sm"
                                      >
                                        {suggestedFinancialPlanAuthorization ? "Ver autorizações TISS" : "Adicionar autorização TISS"}
                                      </button>
                                    </div>
                                    <p className="mt-2 text-[11px] font-medium opacity-80">
                                      A Pré-guia TISS usará a autorização vigente compatível com a sessão, quando exigida pelo convênio.
                                    </p>
                                  </div>
                                </div>
                              </>
                            )}
                            {showPaymentMethod && (
                              <FormField label="Forma de pagamento">
                                <select
                                  className={patientFormInputClass}
                                  value={plan.paymentMethod}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "paymentMethod", e.target.value)}
                                >
                                  <option value="">Forma de pagamento</option>
                                  {PATIENT_FINANCIAL_PAYMENT_METHOD_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </FormField>
                            )}
                            {(isCourtesyPlan || plan.billingMode === "OTHER") && (
                              <div className="md:col-span-2 xl:col-span-3">
                                <FormField label="Observação">
                                  <input
                                    className={patientFormInputClass}
                                    placeholder="Observação"
                                    value={plan.notes}
                                    onChange={(e) => handleFinancialPlanChange(plan.id, "notes", e.target.value)}
                                  />
                                </FormField>
                              </div>
                            )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </FormSection>
              )}

              {activePatientRegistrationTab === "legacy" && (
                <FormSection
                  title="Histórico / dados legados"
                  description="Campos preservados por compatibilidade com cadastros antigos. Para Pré-guias e XML, use Autorizações TISS do paciente."
                >
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-medium leading-relaxed text-amber-800">
                    Estes campos foram preservados apenas para compatibilidade com cadastros antigos. Para Pré-guias e XML, use Autorizações TISS do paciente.
                  </div>
                  {patientRegistrationFinancialPlans.some((plan: any) => plan.authorizationCode || plan.authorizationValidUntil) ? (
                    <div className="mt-4 space-y-3">
                      {patientRegistrationFinancialPlans
                        .filter((plan: any) => plan.authorizationCode || plan.authorizationValidUntil)
                        .map((plan: any) => (
                          <details key={`legacy-financial-plan-${plan.id}`} className="rounded-2xl border border-slate-100 bg-white">
                            <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
                              Dados legados de autorização · {plan.customServiceName || plan.specialty || plan.serviceType || "Plano financeiro"} · {plan.payerNameSnapshot || plan.insuranceName || "Sem convênio"}
                            </summary>
                            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 p-4 md:grid-cols-2">
                              <FormField label="Autorização legada do plano">
                                <input
                                  className={patientFormInputClass}
                                  placeholder="Ex.: autorização legada"
                                  value={plan.authorizationCode}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "authorizationCode", e.target.value)}
                                />
                              </FormField>
                              <FormField label="Validade legada">
                                <input
                                  type="date"
                                  className={patientFormInputClass}
                                  value={plan.authorizationValidUntil}
                                  onChange={(e) => handleFinancialPlanChange(plan.id, "authorizationValidUntil", e.target.value)}
                                />
                              </FormField>
                            </div>
                          </details>
                        ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm font-semibold text-slate-400">
                      Nenhum dado legado de autorização neste cadastro.
                    </div>
                  )}
                </FormSection>
              )}
            </div>

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





