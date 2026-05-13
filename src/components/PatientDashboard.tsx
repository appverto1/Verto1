import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, LogOut, BookOpen, X, BatteryCharging, BatteryFull, Zap, Check, RefreshCcw, Smile, ChevronDown, CheckCircle, Camera, Trash2, Pencil, Menu, MessageCircle, Settings, User, MapPin, Bell } from 'lucide-react';
import { EvolutionBarChart } from './Charts';
import { CumulativeGrowthChart } from './CumulativeGrowthChart';
import { LogoVerto, SuccessOverlay, BigEnergySlider, ENERGY_TAGS } from './Common';
import { HistoryCard } from './History';
import { DrawingCanvas } from './DrawingCanvas';
import { dataService } from '../services/dataService';
import { SecureImage } from './SecureMedia';
import { calculateDomainMastery } from '../utils/clinicalMath';

export const PatientDashboard = ({ user, onLogout, onMoodCheckin, tasks, onCompleteTask, history, energyTags, sharedNotes, protocols, onAddFamilyNote, isReadOnlyMode = false }: any) => { 
  const [selectedBaseDate, setSelectedBaseDate] = useState("");
  const [selectedCompareDate, setSelectedCompareDate] = useState("");
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("all");
  const [selectedTask, setSelectedTask] = useState<any>(null); 
  const [taskEnergy, setTaskEnergy] = useState(50); 
  const [taskNote, setTaskNote] = useState(""); 
  const [interventionResponse, setInterventionResponse] = useState("");
  const [interventionImages, setInterventionImages] = useState<string[]>([]);
  const [isInterventionUploading, setIsInterventionUploading] = useState(false);
  const [taskStep, setTaskStep] = useState(1); 
  const [showTaskSuccess, setShowTaskSuccess] = useState(false); 
  const [selectedMood, setSelectedMood] = useState<any>(null); 
  const [hoveredMood, setHoveredMood] = useState<any>(null); 
  const [isMoodModalOpen, setIsMoodModalOpen] = useState(false); 
  const [moodNote, setMoodNote] = useState(""); 
  const [showMoodSuccess, setShowMoodSuccess] = useState(false); 
  const [isMessagesOpen, setIsMessagesOpen] = useState(false); 
  const [selectedTag, setSelectedTag] = useState<any>(null); 
  const [dailyCheckinDone, setDailyCheckinDone] = useState(false);
  const [familyNote, setFamilyNote] = useState("");
  const [familyImage, setFamilyImage] = useState<string | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [showFamilySuccess, setShowFamilySuccess] = useState(false);
  const [isFamilyLogOpen, setIsFamilyLogOpen] = useState(false);
  const initialAddress = String(user?.address || user?.endereco || user?.anamnesisData?.endereco || '').trim();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [displayName, setDisplayName] = useState(String(user?.name || 'Paciente'));
  const [profilePicture, setProfilePicture] = useState<string | null>(user?.profilePicture || user?.profile_picture || null);
  const [settingsForm, setSettingsForm] = useState({
    name: String(user?.name || 'Paciente'),
    address: initialAddress,
    profilePicture: user?.profilePicture || user?.profile_picture || ''
  });
  const [settingsMessage, setSettingsMessage] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isEnablingNotifications, setIsEnablingNotifications] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const [isUploading, setIsUploading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showStarCelebration, setShowStarCelebration] = useState(false);
  const [celebrationKey, setCelebrationKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [latestProtocolReference, setLatestProtocolReference] = useState<any>(null);
  const previousStarsRef = useRef<number>(0);
  const userType = typeof user.type === 'string' ? user.type.toLowerCase() : '';
  const hasExplicitPatientType = Boolean(userType);
  const userAge =
    typeof user.age === 'number'
      ? user.age
      : (user.age !== null && user.age !== undefined && Number.isFinite(Number(user.age)))
        ? Number(user.age)
        : null;
  const isKidsProfile =
    userType === 'kids_tea' ||
    (!hasExplicitPatientType && ((userAge !== null && userAge <= 12) || user.anamnesisData?.formType === 'child'));
  const isConventionalAdult = (userType === 'conventional' || userType === 'adult_conventional') && !isKidsProfile;
  const readOnlyNotice = "Você não possui um tratamento ativo no momento. Entre em contato com sua clínica para retomar o acompanhamento.";

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextName = String(user?.name || 'Paciente');
    const nextPicture = user?.profilePicture || user?.profile_picture || null;
    const nextAddress = String(user?.address || user?.endereco || user?.anamnesisData?.endereco || '').trim();
    setDisplayName(nextName);
    setProfilePicture(nextPicture);
    setSettingsForm({
      name: nextName,
      address: nextAddress,
      profilePicture: nextPicture || ''
    });
  }, [user?.name, user?.profilePicture, user?.profile_picture, user?.address, user?.endereco, user?.anamnesisData?.endereco]);

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  };

  const enablePatientNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotificationStatus('unsupported');
      setSettingsMessage('Este dispositivo ou navegador não suporta notificações push.');
      return false;
    }

    setIsEnablingNotifications(true);
    setSettingsMessage('');
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission !== 'granted') {
        setSettingsMessage('As notificações não foram liberadas. Se você bloqueou antes, habilite nas configurações do navegador.');
        return false;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      const keyResponse = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
      const keyPayload = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || !keyPayload?.publicKey) {
        setSettingsMessage('As notificações ainda não estão configuradas no servidor.');
        return false;
      }

      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription =
        existingSubscription ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(String(keyPayload.publicKey)),
        }));

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscription }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        setSettingsMessage(result?.error || result?.warning || 'Não foi possível ativar as notificações agora.');
        return false;
      }

      setSettingsMessage('Notificações ativadas neste dispositivo.');
      return true;
    } catch (error: any) {
      console.warn('Patient notification permission failed:', error);
      setSettingsMessage(error?.message || 'Não foi possível ativar as notificações.');
      return false;
    } finally {
      setIsEnablingNotifications(false);
    }
  };

  const handleProfilePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSettingsMessage('Envie uma imagem válida para a foto do perfil.');
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSettingsMessage('Escolha uma imagem de até 2MB para manter o painel leve.');
      event.target.value = '';
      return;
    }

    setIsSavingSettings(true);
    setSettingsMessage('Enviando foto...');
    try {
      const extension = file.type.includes('jpeg') || file.type.includes('jpg') ? 'jpg' : file.type.includes('webp') ? 'webp' : 'png';
      const fileName = `${user.id}/profile-${Date.now()}.${extension}`;
      const upload = await dataService.uploadFile('patient-photos', fileName, file);
      if (!upload?.success || !upload.url) {
        setSettingsMessage(upload?.error || 'Não foi possível enviar a foto.');
        return;
      }
      setSettingsForm((prev) => ({ ...prev, profilePicture: upload.url, profilePicturePath: upload.path } as any));
      setProfilePicture(upload.url);
      setSettingsMessage('Foto pronta. Clique em salvar para confirmar.');
    } finally {
      setIsSavingSettings(false);
      event.target.value = '';
    }
  };

  const handleSavePatientSettings = async () => {
    const nextName = settingsForm.name.trim();
    if (!nextName) {
      setSettingsMessage('Informe seu nome para salvar.');
      return;
    }

    setIsSavingSettings(true);
    setSettingsMessage('');
    try {
      const result = await dataService.updatePatientSelfProfile({
        name: nextName,
        address: settingsForm.address.trim(),
        profilePicture: settingsForm.profilePicture || null,
        profilePicturePath: (settingsForm as any).profilePicturePath || null
      });

      if (!result?.success) {
        setSettingsMessage(result?.error || 'Não foi possível salvar suas configurações.');
        return;
      }

      setDisplayName(nextName);
      setProfilePicture(settingsForm.profilePicture || null);
      setSettingsMessage('Configurações salvas com sucesso.');
      setTimeout(() => setIsSettingsOpen(false), 700);
    } catch (error: any) {
      setSettingsMessage(error?.message || 'Não foi possível salvar suas configurações.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const visiblePatientTasks = useMemo(() => {
    const list = Array.isArray(tasks) ? tasks : [];
    if (isKidsProfile) return list;
    const startOfToday = new Date(currentTime);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    return list.filter((task: any) => {
      const scheduledRaw = task?.scheduledAt || task?.scheduled_at;
      if (!scheduledRaw) return false;
      const scheduledAt = new Date(scheduledRaw);
      if (Number.isNaN(scheduledAt.getTime())) return false;
      return scheduledAt >= startOfToday && scheduledAt < endOfToday && scheduledAt <= currentTime;
    });
  }, [tasks, isKidsProfile, currentTime]);

  const conventionalMoodTags = [
    { id: 'family', label: 'Família', icon: '👨‍👩‍👧‍👦', color: 'bg-blue-100 text-blue-600' },
    { id: 'work', label: 'Trabalho', icon: '💼', color: 'bg-orange-100 text-orange-600' },
    { id: 'relationships', label: 'Relacionamentos', icon: '❤️', color: 'bg-pink-100 text-pink-600' },
    { id: 'money', label: 'Dinheiro', icon: '💰', color: 'bg-green-100 text-green-600' },
    { id: 'thoughts', label: 'Pensamentos', icon: '🧠', color: 'bg-purple-100 text-purple-600' },
    { id: 'others', label: 'Outros', icon: '🧩', color: 'bg-gray-100 text-gray-600' }
  ];
  const moodInfluenceTags = isConventionalAdult ? conventionalMoodTags : (energyTags || []);

  const moodOptions = [ { value: 10, emoji: "😫", label: "Esgotado", color: "bg-red-100 border-red-200 hover:bg-red-200" }, { value: 30, emoji: "😕", label: "Baixo", color: "bg-orange-100 border-orange-200 hover:bg-orange-200" }, { value: 50, emoji: "😐", label: "Normal", color: "bg-yellow-100 border-yellow-200 hover:bg-yellow-200" }, { value: 70, emoji: "🙂", label: "Bem", color: "bg-blue-100 border-blue-200 hover:bg-blue-200" }, { value: 90, emoji: "🤩", label: "Ótimo!", color: "bg-green-100 border-green-200 hover:bg-green-200" } ];

  const getSnapshotKey = (item: any) => {
    const raw = String(item?.dateGroup || '').trim();
    if (raw && raw !== 'Hoje' && raw !== 'Ontem') return raw;
    const dt = new Date(item?.created_at || item?.date || 0);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const formatFilterDate = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-');
      return `${day}/${month}/${year}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString('pt-BR');
  };

  const parseScore = (value: any): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = String(value).replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getEventScore = (item: any): number | null => {
    const direct = parseScore(item?.score);
    if (direct !== null) return direct;
    const professional = parseScore(item?.pro_score);
    if (professional !== null) return professional;
    const nestedTask = parseScore(item?.task_data?.pro_score ?? item?.task_data?.score);
    if (nestedTask !== null) return nestedTask;
    return null;
  };

  const normalizeClinicalKey = (value: any) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const isSameClinicalSkill = (a: string, b: string) => {
    const left = normalizeClinicalKey(a);
    const right = normalizeClinicalKey(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
  };

  const scoredClinicalEvents = useMemo(() => {
    const fromHistory = (Array.isArray(history) ? history : [])
      .filter((h: any) => {
        const type = String(h?.type || '').toLowerCase();
        if (type === 'family_note' || type === 'photo') return false;
        return getEventScore(h) !== null;
      })
      .map((h: any) => ({
        ...h,
        score: getEventScore(h),
        _source: 'history'
      }));

    const fromTasks = (Array.isArray(tasks) ? tasks : [])
      .filter((t: any) => getEventScore(t) !== null)
      .map((t: any) => ({
        id: t?.id || `task-${t?.task_id || Math.random()}`,
        patientId: user?.id,
        patient_id: user?.id,
        type: 'task_scored',
        title: t?.title || t?.task_data?.title || '',
        domain: t?.domain || t?.task_data?.domain || t?.domainName || '',
        dateGroup: t?.dateGroup || '',
        created_at: t?.completed_at || t?.updated_at || t?.scheduled_at || t?.created_at || null,
        date: t?.completed_at || t?.scheduled_at || t?.created_at || null,
        task_data: t?.task_data || null,
        score: getEventScore(t),
        _source: 'task'
      }));

    const merged = [...fromHistory, ...fromTasks];
    const dedup = new Map<string, any>();
    merged.forEach((item: any) => {
      const key = String(item?.id || `${item?._source}-${item?.title || ''}-${item?.created_at || item?.date || ''}-${item?.domain || ''}`);
      const prev = dedup.get(key);
      if (!prev) {
        dedup.set(key, item);
        return;
      }
      const prevTs = new Date(prev?.created_at || prev?.date || 0).getTime() || 0;
      const curTs = new Date(item?.created_at || item?.date || 0).getTime() || 0;
      if (curTs >= prevTs) dedup.set(key, item);
    });
    return Array.from(dedup.values());
  }, [history, tasks, user?.id]);

  const availableSnapshots = useMemo(() => {
    const dates = scoredClinicalEvents.map((h: any) => getSnapshotKey(h)).filter(Boolean);
    return Array.from(new Set(dates)).sort((a: any, b: any) => new Date(String(b)).getTime() - new Date(String(a)).getTime());
  }, [scoredClinicalEvents]);

  useEffect(() => {
    let cancelled = false;

    const loadLatestProtocolReference = async () => {
      const patientId = String(user?.id || '').trim();
      if (!patientId) {
        if (!cancelled) setLatestProtocolReference(null);
        return;
      }

      const result = await dataService.discoverLatestPatientProtocol(patientId);
      if (!cancelled) {
        setLatestProtocolReference(result?.success ? result.data || null : null);
      }
    };

    void loadLatestProtocolReference();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const activeKidsProtocol = useMemo(() => {
    const list = Array.isArray(protocols) ? protocols : [];
    const resolveProtocolMatch = (rawId: any, rawName: any) => {
      const targetId = String(rawId || '').trim();
      const targetName = normalizeClinicalKey(rawName || '');
      return list.find((protocol: any) => {
        const protocolId = String(protocol?.id || '').trim();
        const protocolTitle = normalizeClinicalKey(protocol?.title || protocol?.name || '');
        return (targetId && protocolId === targetId) || (targetName && protocolTitle === targetName);
      }) || null;
    };

    const latestScoredEvent = [...scoredClinicalEvents]
      .sort((a: any, b: any) => {
        const left = new Date(a?.created_at || a?.date || 0).getTime() || 0;
        const right = new Date(b?.created_at || b?.date || 0).getTime() || 0;
        return right - left;
      })
      .find((event: any) => {
        const taskData = event?.task_data && typeof event.task_data === 'object' ? event.task_data : {};
        const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : {};
        return Boolean(
          event?.protocol_id ||
          event?.protocolId ||
          taskData?.protocol_id ||
          taskData?.protocolId ||
          taskData?.protocolTitle ||
          taskData?.protocol_name ||
          metadata?.protocol_id ||
          metadata?.protocolId ||
          metadata?.protocolTitle ||
          metadata?.protocol_name
        );
      });

    if (latestScoredEvent) {
      const taskData = latestScoredEvent?.task_data && typeof latestScoredEvent.task_data === 'object' ? latestScoredEvent.task_data : {};
      const metadata = latestScoredEvent?.metadata && typeof latestScoredEvent.metadata === 'object' ? latestScoredEvent.metadata : {};
      const matchedFromLatestScore = resolveProtocolMatch(
        latestScoredEvent?.protocol_id ||
          latestScoredEvent?.protocolId ||
          taskData?.protocol_id ||
          taskData?.protocolId ||
          metadata?.protocol_id ||
          metadata?.protocolId ||
          '',
        latestScoredEvent?.protocolTitle ||
          latestScoredEvent?.protocol_name ||
          taskData?.protocolTitle ||
          taskData?.protocol_name ||
          metadata?.protocolTitle ||
          metadata?.protocol_name ||
          metadata?.canonicalName ||
          ''
      );
      if (matchedFromLatestScore) return matchedFromLatestScore;
    }

    const discoveredProtocolId = String(
      latestProtocolReference?.protocolId || latestProtocolReference?.levelId || ''
    ).trim();
    const discoveredProtocolName = normalizeClinicalKey(latestProtocolReference?.protocolName || '');

    if (discoveredProtocolId || discoveredProtocolName) {
      const discovered = resolveProtocolMatch(discoveredProtocolId, discoveredProtocolName);
      if (discovered) return discovered;
    }

    const peiGoals = Array.isArray(user?.pei) ? user.pei : [];
    const activeGoal = peiGoals.find((goal: any) => {
      const status = String(goal?.status || '').toLowerCase();
      return goal?.protocolTitle && status !== 'completed';
    }) || peiGoals.find((goal: any) => goal?.protocolTitle);

    if (activeGoal) {
      const goalProtocolId = String(activeGoal?.protocolId ?? activeGoal?.protocol_id ?? '').trim();
      const goalProtocolTitle = normalizeClinicalKey(activeGoal?.protocolTitle || '');
      const matched = resolveProtocolMatch(goalProtocolId, goalProtocolTitle);
      if (matched) return matched;
    }

    return list.find((p: any) => /vb[\s-]?mapp/i.test(String(p?.title || p?.name || ''))) || list[0] || { data: [] };
  }, [latestProtocolReference, protocols, scoredClinicalEvents, user?.pei]);

  const activeKidsProtocolEvents = useMemo(() => {
    const domainTasks = (Array.isArray(activeKidsProtocol?.data) ? activeKidsProtocol.data : [])
      .flatMap((domain: any) => (Array.isArray(domain?.skills) ? domain.skills : []).map((skill: any) => ({
        domainName: String(domain?.name || '').trim(),
        skillName: String(skill?.name || '').trim()
      })));

    if (!domainTasks.length) return scoredClinicalEvents;

    return scoredClinicalEvents.filter((event: any) => {
      const eventTitle = String(event?.title || event?.taskTitle || event?.task_data?.title || '').trim();
      const eventDomain = String(event?.domain || event?.domainName || event?.task_data?.domain || event?.task_data?.domainName || '').trim();
      return domainTasks.some((task: any) =>
        isSameClinicalSkill(task.skillName, eventTitle) ||
        (task.domainName && normalizeClinicalKey(task.domainName) === normalizeClinicalKey(eventDomain))
      );
    });
  }, [activeKidsProtocol, scoredClinicalEvents]);

  const activeProtocolSnapshots = useMemo(() => {
    const dates = activeKidsProtocolEvents.map((h: any) => getSnapshotKey(h)).filter(Boolean);
    return Array.from(new Set(dates)).sort((a: any, b: any) => new Date(String(b)).getTime() - new Date(String(a)).getTime());
  }, [activeKidsProtocolEvents]);

  useEffect(() => {
    if (!activeProtocolSnapshots.length) {
      setSelectedBaseDate("");
      setSelectedCompareDate("");
      return;
    }
    if (!selectedBaseDate || !activeProtocolSnapshots.includes(selectedBaseDate)) {
      setSelectedBaseDate(activeProtocolSnapshots[0]);
      return;
    }
    if (!selectedCompareDate || selectedCompareDate === selectedBaseDate || !activeProtocolSnapshots.includes(selectedCompareDate)) {
      const firstDifferent = activeProtocolSnapshots.find((d: any) => d !== selectedBaseDate) || "";
      setSelectedCompareDate(firstDifferent);
    }
  }, [activeProtocolSnapshots, selectedBaseDate, selectedCompareDate]);

  const kidChartData = useMemo(() => {
    const defaultKidsDomains = [
      'Mando (Mand)',
      'Tato (Tact)',
      'Ouvinte (Listener)',
      'Percepção Visual (VP-MTS)',
      'Brincar Independente (Play)',
      'Imitação Motora (Imitation)',
      'Ecoico (Echoic)'
    ];

    const inferKidsDomainFromTitle = (title: any): string => {
      const n = normalizeClinicalKey(title);
      if (!n) return '';
      if (n.includes('mando') || n.includes('mand')) return 'Mando (Mand)';
      if (n.includes('tato') || n.includes('tact')) return 'Tato (Tact)';
      if (n.includes('ouvinte') || n.includes('listener')) return 'Ouvinte (Listener)';
      if (n.includes('percepcao visual') || n.includes('visual') || n.includes('vp mts') || n.includes('vpmts')) return 'Percepção Visual (VP-MTS)';
      if (n.includes('brincar') || n.includes('play')) return 'Brincar Independente (Play)';
      if (n.includes('imitacao') || n.includes('imitation') || n.includes('motora')) return 'Imitação Motora (Imitation)';
      if (n.includes('ecoico') || n.includes('echoic')) return 'Ecoico (Echoic)';
      return '';
    };

    const selectedProto = activeKidsProtocol || { data: [] };
    const protocolDomains = Array.isArray(selectedProto?.data)
      ? selectedProto.data
          .map((d: any) => ({
            name: String(d?.name || '').trim(),
            skills: Array.isArray(d?.skills) ? d.skills : []
          }))
          .filter((d: any) => d.name)
      : [];

    const sourceHistory = Array.isArray(activeKidsProtocolEvents) ? activeKidsProtocolEvents : [];
    const scoredEvents = sourceHistory
      .map((h: any) => {
        const scoreRaw = getEventScore(h);
        if (scoreRaw === null) return null;
        const score = Math.max(0, Math.min(1, Number(scoreRaw) || 0));
        const ts = new Date(h?.created_at || h?.date || 0).getTime() || 0;
        const title = String(h?.title || h?.taskTitle || h?.task_data?.title || '').trim();
        const domain = String(
          h?.domain ||
            h?.domainName ||
            h?.task_data?.domain ||
            h?.task_data?.domainName ||
            h?.metadata?.domain ||
            inferKidsDomainFromTitle(title) ||
            'Geral'
        ).trim();
        return {
          ...h,
          _score: score,
          _timestamp: ts,
          _title: title,
          _titleKey: normalizeClinicalKey(title),
          _domain: domain || 'Geral',
          _domainKey: normalizeClinicalKey(domain || 'Geral')
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a._timestamp - b._timestamp);

    const fallbackDomainMap = new Map<string, Set<string>>();
    scoredEvents.forEach((event: any) => {
      const domainName = event._domain || 'Geral';
      if (!fallbackDomainMap.has(domainName)) fallbackDomainMap.set(domainName, new Set<string>());
      if (event._title) fallbackDomainMap.get(domainName)!.add(event._title);
    });

    const fallbackDomains = Array.from(fallbackDomainMap.entries()).map(([name, skillsSet]) => ({
      name,
      skills: Array.from(skillsSet).map((s) => ({ name: s }))
    }));

    const fallbackHasOnlyGeneral =
      fallbackDomains.length === 1 && normalizeClinicalKey(fallbackDomains[0]?.name) === 'geral';
    const effectiveDomains = protocolDomains.length
      ? protocolDomains
      : fallbackDomains.length && !fallbackHasOnlyGeneral
        ? fallbackDomains
        : defaultKidsDomains.map((name) => ({ name, skills: [{ name }] }));

    const labels = effectiveDomains.map((d: any) => d.name);

    const resolveCutoffTimestamp = (dateFilter: string | null) => {
      if (!dateFilter) return Number.POSITIVE_INFINITY;
      const parsed = new Date(`${dateFilter}T23:59:59.999`).getTime();
      return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    };

    const isVbMappProtocol = /vb[\s-]?mapp/i.test(String(selectedProto?.title || ''));
    const vbmappCriterion = Number((selectedProto as any)?.masteryCriterion ?? (selectedProto as any)?.vbmapp_mastery_criterion ?? 5) || 5;

    const resolveDomainProgressPercent = (dateFilter: string | null, mode: 'first' | 'latest') => {
      const cutoffTs = resolveCutoffTimestamp(dateFilter);
      const modeNormalized = mode === 'first' ? 'baseline' : 'latest';
      return effectiveDomains.map((domain: any) => {
        const domainName = String(domain?.name || 'Geral').trim() || 'Geral';
        const domainTasks = (Array.isArray(domain?.skills) ? domain.skills : []).map((skill: any) => ({
          name: String(skill?.name || '').trim(),
          maxScore: Math.max(1, Number(skill?.maxScore ?? skill?.max_score ?? 1) || 1)
        }));
        const domainEvents = scoredEvents
          .filter((event: any) => event._timestamp <= cutoffTs)
          .filter((event: any) => {
            const matchesDomain = normalizeClinicalKey(event?._domain || '') === normalizeClinicalKey(domainName);
            const matchesSkill = domainTasks.some((task: any) => isSameClinicalSkill(task.name, event?._title || ''));
            return matchesDomain || matchesSkill;
          })
          .map((event: any) => ({
            title: event?._title || '',
            score: event?._score,
            maxScore: 1,
            consecutive_successes: event?.consecutive_successes,
            created_at: event?.created_at || event?.date || null
          }));
        return calculateDomainMastery(domainEvents, domainTasks, {
          mode: modeNormalized as any,
          protocolKind: isVbMappProtocol ? 'vbmapp' : 'other',
          vbmappMasteryCriterion: vbmappCriterion
        });
      });
    };

    const resolvedBaseDate = selectedBaseDate || activeProtocolSnapshots[0] || "";
    const resolvedCurrentDate = selectedCompareDate || activeProtocolSnapshots[0] || "";
    const baselineData = resolveDomainProgressPercent(resolvedBaseDate || null, 'first');
    const currentData = resolveDomainProgressPercent(resolvedCurrentDate || null, 'latest');

    return {
      labels,
      datasets: [
        {
          label: `Avaliação ${formatFilterDate(resolvedBaseDate || selectedBaseDate || '') || 'Inicial'}`,
          data: baselineData,
          backgroundColor: 'rgba(122, 50, 252, 0.9)',
          borderColor: '#7a32fc',
          borderWidth: 2
        },
        {
          label: `Intervenção ${formatFilterDate(resolvedCurrentDate || selectedCompareDate || '') || 'Atual'}`,
          data: currentData,
          backgroundColor: 'rgba(5, 205, 153, 0.9)',
          borderColor: '#05CD99',
          borderWidth: 2
        }
      ]
    };
  }, [activeKidsProtocol, activeKidsProtocolEvents, selectedBaseDate, selectedCompareDate, activeProtocolSnapshots]);

  const familyDiaryHistory = useMemo(() => {
    return history
      .filter((item: any) => item.type === 'family_note' || item.type === 'photo')
      .sort((a: any, b: any) => {
        const aTime = new Date(a.date || a.created_at || 0).getTime();
        const bTime = new Date(b.date || b.created_at || 0).getTime();
        if (aTime === bTime) return (b.id || 0) - (a.id || 0);
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [history]);

  const kidsGamification = useMemo(() => {
    const today = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(today.getDate() - 7);
    const weekLogs = familyDiaryHistory.filter((item: any) => {
      const when = new Date(item.date || item.created_at || 0);
      return when >= weekAgo;
    }).length;
    const weekPhotos = familyDiaryHistory.filter((item: any) => {
      const when = new Date(item.date || item.created_at || 0);
      return item.type === 'photo' && when >= weekAgo;
    }).length;
    const stars = familyDiaryHistory.filter((item: any) => {
      const isFamily = item.type === 'family_note' || item.type === 'photo';
      const hasStarMarker = /\u2b50|⭐/.test(String(item?.subject || '')) || /\[STAR\]/i.test(String(item?.note || item?.text || ''));
      return isFamily && (Number(item?.score ?? 0) >= 1 || hasStarMarker);
    }).length;
    const sharedFamilyStars = (Array.isArray(sharedNotes) ? sharedNotes : []).filter((item: any) => {
      const type = String(item?.type || '').toLowerCase();
      const visibility = String(item?.visibility || '').toLowerCase();
      const isFamily = type === 'family_note' || type === 'photo' || visibility === 'family';
      const hasStarMarker = /\u2b50|⭐/.test(String(item?.subject || '')) || /\[STAR\]/i.test(String(item?.text || item?.note || ''));
      return isFamily && (Number(item?.score ?? 0) >= 1 || hasStarMarker);
    }).length;
    const milestoneBySource = new Map<string, { awarded: boolean; ts: number }>();
    (Array.isArray(sharedNotes) ? sharedNotes : []).forEach((item: any) => {
      const subject = String(item?.subject || '').trim().toLowerCase();
      const text = String(item?.text || item?.note || '').trim();
      const isEvent = subject === 'milestone_event' || text.startsWith('MILESTONE_EVENT|');
      if (!isEvent) return;
      const sourceMatch = text.match(/source=([^|]+)/i);
      const awardedMatch = text.match(/awarded=([01])/i);
      const source = String(sourceMatch?.[1] || '').trim();
      if (!source) return;
      const awarded = String(awardedMatch?.[1] || '0') === '1';
      const ts = new Date(item?.created_at || item?.date || 0).getTime() || 0;
      const prev = milestoneBySource.get(source);
      if (!prev || ts >= prev.ts) {
        milestoneBySource.set(source, { awarded, ts });
      }
    });
    const milestoneEventStars = Array.from(milestoneBySource.values()).filter((e) => e.awarded).length;
    return { weekLogs, weekPhotos, stars: Math.max(stars, sharedFamilyStars, milestoneEventStars) };
  }, [familyDiaryHistory, history, sharedNotes]);
  const kidsCheckpointLevel = useMemo(() => Math.floor((kidsGamification.stars || 0) / 5), [kidsGamification.stars]);

  useEffect(() => {
    if (!isKidsProfile) return;
    const patientKey = String(user?.id || user?.email || 'unknown');
    const storageKey = `kids_star_seen_total:${patientKey}`;
    const stored = Number(window.localStorage.getItem(storageKey) || '0');
    const baseline = Number.isFinite(stored) ? stored : 0;
    const previous = Math.max(previousStarsRef.current || 0, baseline);
    const current = Number(kidsGamification.stars || 0);
    if (current > previous) {
      setCelebrationKey((v) => v + 1);
      setShowStarCelebration(true);
      const timer = window.setTimeout(() => setShowStarCelebration(false), 1800);
      previousStarsRef.current = current;
      window.localStorage.setItem(storageKey, String(current));
      return () => window.clearTimeout(timer);
    }
    previousStarsRef.current = current;
    if (current >= baseline) {
      window.localStorage.setItem(storageKey, String(current));
    }
  }, [kidsGamification.stars, isKidsProfile, user?.id, user?.email]);

  const hasFamilyPhotoToday = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return familyDiaryHistory.some((item: any) => {
      if (item.type !== 'photo') return false;
      const raw = item.date || item.created_at;
      if (!raw) return false;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed.toISOString().slice(0, 10) === todayStr;
    });
  }, [familyDiaryHistory]);

  const handleConfirmFamilyNote = () => {
    if (isReadOnlyMode) return;
    if (familyNote.trim() || familyImage) {
      setShowFamilySuccess(true);
      setTimeout(async () => {
        let persistedImage = familyImage || undefined;
        let persistedImagePath: string | undefined;
        if (persistedImage && persistedImage.startsWith('data:image/')) {
          const extension = persistedImage.includes('image/jpeg') ? 'jpg' : persistedImage.includes('image/webp') ? 'webp' : 'png';
          const fileName = `${user.id}/family-${Date.now()}.${extension}`;
          const uploadResult = await dataService.uploadDataUrl('patient-photos', fileName, persistedImage, `image/${extension === 'jpg' ? 'jpeg' : extension}`);
          if (uploadResult?.success && uploadResult.url) {
            persistedImage = uploadResult.url;
            persistedImagePath = uploadResult.path;
          } else {
            setShowFamilySuccess(false);
            alert(`Não foi possível salvar a foto no armazenamento: ${uploadResult?.error || 'erro desconhecido'}`);
            return;
          }
        }

        onAddFamilyNote(user.id, familyNote, persistedImage, persistedImagePath);
        setShowFamilySuccess(false);
        setFamilyNote("");
        setFamilyImage(null);
        setIsFamilyLogOpen(false);
      }, 2000);
    }
  };

  const formatDiaryTimestamp = (value: any) => {
    if (!value) return 'Agora';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Agora';
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnlyMode) return;
    if (hasFamilyPhotoToday && !familyImage) {
      alert('A família já enviou uma foto hoje. Você pode editar com desenho na foto atual ou enviar nova foto amanhã.');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      try {
        const fileName = `${user.id}/${Date.now()}-${file.name}`;
        const result = await dataService.uploadFile('patient-photos', fileName, file);
        
        if (result.success && result.url) {
          setFamilyImage(result.url);
          setIsDrawingMode(true);
        } else {
          alert('Erro ao enviar imagem. Tente novamente em alguns instantes.');
        }
      } catch (error) {
        console.error('Upload error:', error);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleInterventionImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnlyMode) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setIsInterventionUploading(true);
    try {
      const fileName = `${user.id}/interventions/${Date.now()}-${file.name}`;
      const result = await dataService.uploadFile('patient-photos', fileName, file);
      if (result.success && result.url) {
        setInterventionImages((prev) => [...prev, result.url!]);
      } else {
        alert('Erro ao anexar imagem da tarefa. Tente novamente.');
      }
    } catch (error) {
      console.error('Intervention upload error:', error);
    } finally {
      setIsInterventionUploading(false);
      e.target.value = '';
    }
  };

  const filteredHistoryList = useMemo(() => {
    const scopedByDate =
      selectedSnapshotDate === "all"
        ? history
        : history.filter((h: any) => h.dateGroup === selectedSnapshotDate);

    if (!isConventionalAdult) return scopedByDate;

    return scopedByDate.filter((item: any) => {
      const directScore = parseScore(item?.score);
      const proScore = parseScore(item?.pro_score);
      const nestedScore = parseScore(item?.task_data?.pro_score ?? item?.task_data?.score);
      const hasProfessionalScore = directScore !== null || proScore !== null || nestedScore !== null;
      return !hasProfessionalScore;
    });
  }, [history, selectedSnapshotDate, isConventionalAdult]);

  const groupedHistory = filteredHistoryList.reduce((groups: any, item: any) => { const group = groups[item.dateGroup] || []; group.push(item); group.sort((a: any, b: any) => b.id - a.id); groups[item.dateGroup] = group; return groups; }, {}); 
  const sortedDateKeys = Object.keys(groupedHistory).sort((a, b) => { if (a === "Hoje") return -1; if (b === "Hoje") return 1; if (a === "Ontem") return -1; if (b === "Ontem") return 1; return b.localeCompare(a); }); 
  const kidsTimelineHistory = useMemo(() => {
    return filteredHistoryList.filter((item: any) => item.type !== 'family_note' && item.type !== 'photo');
  }, [filteredHistoryList]);
  const groupedKidsTimeline = useMemo(() => {
    return kidsTimelineHistory.reduce((groups: any, item: any) => {
      const group = groups[item.dateGroup] || [];
      group.push(item);
      group.sort((a: any, b: any) => b.id - a.id);
      groups[item.dateGroup] = group;
      return groups;
    }, {});
  }, [kidsTimelineHistory]);
  const sortedKidsDateKeys = useMemo(() => {
    return Object.keys(groupedKidsTimeline).sort((a, b) => {
      if (a === "Hoje") return -1;
      if (b === "Hoje") return 1;
      if (a === "Ontem") return -1;
      if (b === "Ontem") return 1;
      return b.localeCompare(a);
    });
  }, [groupedKidsTimeline]);

  const patientSettingsModal = isSettingsOpen ? (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-950/45 px-4 py-5 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: -18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -18, scale: 0.98 }}
        className="w-full max-w-lg overflow-hidden rounded-[30px] border border-white/70 bg-white shadow-2xl shadow-purple-500/20"
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-[#7a32fc] via-[#8B5CF6] to-[#05CD99] px-6 py-5 text-white">
          <div className="absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/20 blur-2xl"></div>
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/75">Configurações</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Seu perfil na Verto</h2>
              <p className="mt-1 text-sm font-medium text-white/80">Atualize foto, nome, endereço e notificações do dispositivo.</p>
            </div>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="rounded-2xl bg-white/15 p-2 text-white transition hover:bg-white/25"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto p-6">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[24px] border border-purple-100 bg-purple-50 shadow-inner">
              {profilePicture ? (
                <SecureImage src={profilePicture} alt="Foto do paciente" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[#7a32fc]">
                  <User size={34} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#7a32fc]/10 px-4 py-2 text-sm font-bold text-[#7a32fc] transition hover:bg-[#7a32fc]/15">
                <Camera size={16} />
                Trocar foto
                <input type="file" accept="image/*" className="hidden" onChange={handleProfilePhotoChange} disabled={isSavingSettings} />
              </label>
              <p className="mt-2 text-xs font-medium text-slate-500">Use uma foto nítida, de até 2MB.</p>
            </div>
          </div>

          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                <User size={14} /> Nome
              </span>
              <input
                value={settingsForm.name}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#7a32fc] focus:bg-white"
                placeholder="Seu nome"
              />
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                <MapPin size={14} /> Endereço
              </span>
              <input
                value={settingsForm.address}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#7a32fc] focus:bg-white"
                placeholder="Rua, número, bairro e cidade"
              />
            </label>
          </div>

          <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-emerald-300 text-emerald-600 accent-emerald-500"
                checked={notificationStatus === 'granted'}
                disabled={notificationStatus === 'granted' || isEnablingNotifications || notificationStatus === 'unsupported'}
                onChange={() => void enablePatientNotifications()}
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-black text-emerald-800">
                  <Bell size={16} /> Permitir notificações neste dispositivo
                </span>
                <span className="mt-1 block text-xs font-medium leading-relaxed text-emerald-700">
                  Use esta opção se você pulou ou não aprovou o aviso inicial. Se o navegador bloqueou, libere nas configurações do site.
                </span>
              </span>
            </label>
          </div>

          {settingsMessage && (
            <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3 text-sm font-semibold text-purple-700">
              {settingsMessage}
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-500 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSavePatientSettings}
              disabled={isSavingSettings}
              className="rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-black text-white shadow-lg shadow-purple-500/25 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingSettings ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  ) : null;

  const closeMoodModal = () => {
    setIsMoodModalOpen(false);
    setSelectedMood(null);
    setSelectedTag(null);
    setMoodNote("");
  };

  const closeTaskModal = () => {
    setSelectedTask(null);
    setTaskStep(1);
    setTaskNote("");
    setInterventionResponse("");
    setInterventionImages([]);
  };

  if (isKidsProfile) {
    return (
        <div className="min-h-screen bg-gradient-to-b from-[#F2FAFF] via-[#F6F2FF] to-[#FFF8EF] p-4 sm:p-6 flex flex-col items-center relative overflow-y-auto">
            {(showFamilySuccess) && <SuccessOverlay />} 
            <AnimatePresence>{patientSettingsModal}</AnimatePresence>
            <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-blue-100 to-transparent -z-0"></div>
            <div className="w-full max-w-md relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-center mb-6 sm:mb-8">
                    <div className="flex items-center gap-3">
                         <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-full flex items-center justify-center shadow-md text-xl sm:text-2xl overflow-hidden">
                           {profilePicture ? <SecureImage src={profilePicture} alt="Foto do paciente" className="w-full h-full object-cover" /> : '🚀'}
                         </div>
                         <div>
                             <h1 className="text-xl sm:text-2xl font-semibold text-[#7a32fc]">Oi, {displayName}!</h1>
                             <p className="text-[10px] sm:text-sm text-gray-400 font-medium">Vamos ver seus poderes?</p>
                         </div>
                    </div>
                    
                    <div className="relative">
                      <button 
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="p-2.5 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm text-gray-500 hover:bg-white transition-all border border-white/50"
                      >
                        <Menu size={20} />
                      </button>

                    <AnimatePresence>
                        {isMenuOpen && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            className="absolute right-0 mt-2 w-48 bg-white rounded-[24px] shadow-xl border border-blue-50 z-[60] overflow-hidden p-2"
                          >
                            {!isReadOnlyMode && (
                              <button 
                                onClick={() => { setIsFamilyLogOpen(true); setIsMenuOpen(false); }}
                                className="w-full flex items-center gap-3 p-3 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                              >
                                <BookOpen size={18} /> Diário da Família
                              </button>
                            )}
                            <button
                              onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                              className="w-full flex items-center gap-3 p-3 text-sm font-medium text-[#7a32fc] hover:bg-purple-50 rounded-xl transition-colors"
                            >
                              <Settings size={18} /> Configurações
                            </button>
                            <button 
                              onClick={() => { onLogout(); setIsMenuOpen(false); }}
                              className="w-full flex items-center gap-3 p-3 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                            >
                              <LogOut size={18} /> Sair da Conta
                            </button>
                          </motion.div>
                        )}
                    </AnimatePresence>
                  </div>
                </div>
                {isReadOnlyMode && (
                  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs sm:text-sm text-amber-800">
                    {readOnlyNotice}
                  </div>
                )}

                <div className="bg-white p-4 sm:p-6 rounded-[32px] sm:rounded-[40px] shadow-xl border border-blue-50 flex flex-col justify-center mb-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 sm:w-32 h-24 sm:h-32 bg-yellow-100 rounded-bl-full opacity-50 -z-0"></div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-center">
                        <p className="text-[10px] uppercase text-blue-600 font-bold tracking-widest">Registros 7d</p>
                        <p className="text-lg font-extrabold text-blue-700">{kidsGamification.weekLogs}</p>
                      </div>
                      <div className="bg-yellow-50 border border-yellow-100 rounded-2xl p-3 text-center relative overflow-hidden">
                        {showStarCelebration && (
                          <div key={celebrationKey} className="pointer-events-none absolute inset-0">
                            <div className="absolute left-3 top-2 animate-bounce text-sm">✨</div>
                            <div className="absolute right-4 top-3 animate-ping text-xs">⭐</div>
                            <div className="absolute left-1/2 -translate-x-1/2 top-1 animate-pulse text-lg">🎉</div>
                            <div className="absolute left-6 bottom-3 animate-bounce text-xs">🌟</div>
                            <div className="absolute right-5 bottom-2 animate-pulse text-sm">💜</div>
                          </div>
                        )}
                        <p className="text-base sm:text-lg font-extrabold text-yellow-700">{kidsGamification.stars} ⭐</p>
                        <p className="text-[10px] text-yellow-700 font-semibold mt-1">{kidsCheckpointLevel > 0 ? '⭐'.repeat(Math.min(5, kidsCheckpointLevel)) : ''}</p>
                      </div>
                      <div className="bg-green-50 border border-green-100 rounded-2xl p-3 text-center">
                        <p className="text-[10px] uppercase text-green-600 font-bold tracking-widest">Fotos 7d</p>
                        <p className="text-lg font-extrabold text-green-700">{kidsGamification.weekPhotos}</p>
                      </div>
                    </div>
                    <div className="mb-4 sm:mb-5 px-1 sm:px-2">
                      <h2 className="text-2xl sm:text-3xl font-semibold text-[#7a32fc] flex items-center justify-center gap-2 text-center">
                        <span role="img" aria-label="Troféu">🏆</span>
                      </h2>
                      <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
                        Protocolo ativo atual
                      </p>
                    </div>
                    <div className="mb-4 sm:mb-5 px-1 sm:px-2 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 items-end">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-blue-500 mb-1.5">Data Atual</p>
                        <div className="relative">
                          <select
                            className="w-full bg-blue-50 border border-blue-100 text-[10px] sm:text-[11px] font-semibold text-[#7a32fc] px-3 py-2 rounded-xl outline-none appearance-none uppercase tracking-wider"
                            value={selectedBaseDate}
                            onChange={(e) => setSelectedBaseDate(e.target.value)}
                            disabled={activeProtocolSnapshots.length === 0}
                          >
                            {activeProtocolSnapshots.length === 0 && <option value="">Sem dados avaliados</option>}
                            {activeProtocolSnapshots.map((date: any) => (
                              <option key={date} value={date}>{formatFilterDate(String(date))}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-[#7a32fc] pointer-events-none" size={10} />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 mb-1.5">Data Comparação</p>
                        <div className="relative">
                          <select
                            className="w-full bg-emerald-50 border border-emerald-100 text-[10px] sm:text-[11px] font-semibold text-emerald-700 px-3 py-2 rounded-xl outline-none appearance-none uppercase tracking-wider"
                            value={selectedCompareDate}
                            onChange={(e) => setSelectedCompareDate(e.target.value)}
                            disabled={activeProtocolSnapshots.length === 0}
                          >
                            <option value="">Sem comparação</option>
                            {activeProtocolSnapshots
                              .filter((date: any) => date !== selectedBaseDate)
                              .map((date: any) => (
                                <option key={`compare-${date}`} value={date}>{formatFilterDate(String(date))}</option>
                              ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" size={10} />
                        </div>
                      </div>
                    </div>
                    <div className="w-full min-h-[300px] sm:min-h-[350px]">
                      <EvolutionBarChart chartData={kidChartData} maxScore={100} />
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-widest text-center mt-2">Filtro por datas para comparação do progresso</p>
                </div>

                <div className="mb-6">
                  <CumulativeGrowthChart
                    patientId={user.id}
                    history={activeKidsProtocolEvents.map((event: any) => ({
                      ...event,
                      patientId: event?.patientId || event?.patient_id || user.id,
                      patient_id: event?.patient_id || event?.patientId || user.id
                    }))}
                  />
                </div>

                <div className="bg-white p-4 sm:p-6 rounded-[28px] shadow-lg border border-blue-100 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm sm:text-base font-semibold text-blue-700 tracking-tight">Últimos Registros do Diário da Família</h2>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500 bg-blue-50 px-2 py-1 rounded-full">
                      {familyDiaryHistory.length} itens
                    </span>
                  </div>
                  {familyDiaryHistory.length > 0 ? (
                    <div className="space-y-3">
                      {familyDiaryHistory.map((entry: any) => (
                        <div key={`family-${entry.id}`} className="rounded-2xl border border-blue-50 bg-blue-50/30 p-3">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-500">
                              {entry.type === 'photo' ? 'Foto enviada' : 'Registro da família'}
                            </span>
                            <span className="text-[10px] text-gray-500 font-medium">
                              {formatDiaryTimestamp(entry.date || entry.created_at)}
                            </span>
                          </div>
                          {entry.note && <p className="text-xs sm:text-sm text-gray-700 leading-relaxed mb-2">{entry.note}</p>}
                          {(entry.image || entry.imageUrl || entry.photoUrl || entry.image_url || entry.url) && (
                            <img
                              src={entry.image || entry.imageUrl || entry.photoUrl || entry.image_url || entry.url}
                              alt="Registro do diário"
                              className="w-full max-h-40 object-cover rounded-xl border border-blue-100"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-5 text-center">
                      <p className="text-sm font-semibold text-blue-700 mb-1">Vamos começar o Diário da Família?</p>
                      <p className="text-xs text-blue-500">Registre texto, fotos e rabiscos para acompanhar a evolução da criança dia a dia.</p>
                    </div>
                  )}
                </div>
            </div>

            {isFamilyLogOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"> 
                <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
                  <button onClick={() => setIsFamilyLogOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
                  <div className="text-center mb-6"> 
                    <div className="w-16 h-16 mx-auto bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mb-3"> 🏠 </div> 
                    <h3 className="text-xl font-bold text-gray-800 tracking-tight">Diário da Família</h3> 
                    <p className="text-gray-500 text-sm mt-1">Como foi o dia do pequeno herói?</p> 
                  </div> 
                  <div className="mb-4">
                    <textarea 
                      className="w-full h-32 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all resize-none font-medium mb-3" 
                      placeholder="Conte-nos como foi o dia, comportamentos, alimentação ou qualquer observação importante..." 
                      value={familyNote} 
                      onChange={(e) => setFamilyNote(e.target.value)} 
                      autoFocus 
                    ></textarea> 

                    <div className="flex flex-wrap gap-2">
                      {familyImage ? (
                        <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-blue-100 group">
                          <SecureImage src={familyImage} alt="Preview" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button onClick={() => setIsDrawingMode(true)} className="p-1.5 bg-white rounded-full text-blue-500 shadow-sm" title="Rabiscar na foto"><Pencil size={14}/></button>
                            <button onClick={() => setFamilyImage(null)} className="p-1.5 bg-white rounded-full text-red-500 shadow-sm"><Trash2 size={14}/></button>
                          </div>
                        </div>
                      ) : (
                        <label className={`w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 transition-all ${isUploading || hasFamilyPhotoToday ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-300 hover:text-blue-400 cursor-pointer'}`}>
                          {isUploading ? (
                            <RefreshCcw size={24} className="animate-spin" />
                          ) : (
                            <Camera size={24} />
                          )}
                          <span className="text-[10px] font-bold uppercase">{isUploading ? 'Enviando' : hasFamilyPhotoToday ? '1 foto/dia' : 'Foto'}</span>
                          {!isUploading && !hasFamilyPhotoToday && <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />}
                        </label>
                      )}
                    </div>
                    {hasFamilyPhotoToday && !familyImage && (
                      <p className="mt-2 text-[11px] text-amber-600 font-medium">
                        Limite diário: já existe uma foto enviada hoje no Diário da Família.
                      </p>
                    )}
                  </div>
                  <button 
                    onClick={handleConfirmFamilyNote} 
                    disabled={showFamilySuccess || (!familyNote.trim() && !familyImage)} 
                    className={`w-full font-bold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showFamilySuccess ? 'bg-green-500 text-white' : 'bg-blue-600 text-white shadow-blue-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                  > 
                    {showFamilySuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Registrar no Histórico</React.Fragment>} 
                  </button> 
                </div> 
              </div>
            )}
            {isDrawingMode && familyImage && (
              <DrawingCanvas 
                image={familyImage} 
                onSave={(edited) => { setFamilyImage(edited); setIsDrawingMode(false); }} 
                onCancel={() => { setIsDrawingMode(false); }} 
              />
            )}
        </div>
    );
  }

  const handleEmojiClick = (mood: any) => {
    if (isReadOnlyMode) return;
    setSelectedMood(mood);
    setSelectedTag(null);
    setMoodNote("");
    setIsMoodModalOpen(true);
  }; 
  const handleConfirmMood = () => { 
    if (isReadOnlyMode) return;
    if (selectedMood) { 
      setShowMoodSuccess(true); 
      const moodValue = selectedMood.value;
      setTimeout(() => { onMoodCheckin(moodValue, moodNote, selectedMood.emoji, selectedTag); setIsMoodModalOpen(false); setShowMoodSuccess(false); setMoodNote(""); setSelectedMood(null); setSelectedTag(null); setDailyCheckinDone(true); }, 2000); 
    } 
  }; 
  const openTaskModal = (task: any) => {
    if (isReadOnlyMode) return;
    setSelectedTask(task);
    setTaskEnergy(50);
    setTaskNote("");
    setInterventionResponse("");
    setInterventionImages([]);
    if (task.type === 'intervention' && isConventionalAdult) {
      setTaskStep(0);
    } else {
      setTaskStep(1);
    }
  };
  const handleEnergyCommit = () => { setTaskStep(2); }; 
  const handleConfirmTask = () => { 
    if (isReadOnlyMode) return;
    if (selectedTask) { 
      setShowTaskSuccess(true); 
      const interventionDetails = [
        interventionResponse?.trim() ? `Resposta:\n${interventionResponse.trim()}` : '',
        taskNote?.trim() ? `Observação:\n${taskNote.trim()}` : '',
        interventionImages.length > 0 ? `Anexos:\n${interventionImages.join('\n')}` : ''
      ].filter(Boolean).join('\n\n');
      const finalNote = selectedTask.type === 'intervention'
        ? interventionDetails
        : taskNote;
      setTimeout(() => { 
        onCompleteTask(selectedTask, isConventionalAdult ? null : taskEnergy, finalNote); 
        setShowTaskSuccess(false); 
        setSelectedTask(null); 
        setInterventionResponse("");
        setInterventionImages([]);
        setTaskStep(1);
      }, 2000); 
    } 
  }; 

  const dailyReviewTasks = useMemo(() => {
    const interventions = history.filter((h: any) => h.type === 'intervention' && h.isDailyReminder);
    const latestByTitle: any = {};
    interventions.forEach((h: any) => {
      if (!latestByTitle[h.title] || h.id > latestByTitle[h.title].id) {
        latestByTitle[h.title] = h;
      }
    });
    return Object.values(latestByTitle);
  }, [history]);

  return ( 
    <div className={`min-h-screen p-6 flex flex-col overflow-x-hidden ${isConventionalAdult ? 'bg-gradient-to-b from-[#FFF9F3] to-[#F8F5FF]' : 'bg-[#F4F7FE]'}`}> 
      {(showTaskSuccess || showMoodSuccess) && <SuccessOverlay />} 
      <AnimatePresence>{patientSettingsModal}</AnimatePresence>
      {isMessagesOpen && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setIsMessagesOpen(false)}> 
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}> 
            <button onClick={() => setIsMessagesOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button> 
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2 tracking-tight"><BookOpen className="text-[#7a32fc]"/> Mensagens do Terapeuta</h2> 
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar"> 
              {sharedNotes.length > 0 ? sharedNotes.map((note: any) => ( 
                <div key={note.id} className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl"> 
                  <span className="text-[10px] font-bold text-blue-400 uppercase block mb-1">{note.date}</span> 
                  <p className="text-sm text-gray-700">{note.text}</p> 
                </div> 
              )) : ( <p className="text-center text-gray-400 text-sm py-8 italic">Nenhuma mensagem por enquanto.</p> )} 
            </div> 
          </div> 
        </div> 
      )} 
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6"> 
        <div className="flex items-center gap-4"> 
          {profilePicture ? (
            <div className="h-[50px] w-[50px] shrink-0 overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
              <SecureImage src={profilePicture} alt="Foto do paciente" className="h-full w-full object-cover" />
            </div>
          ) : (
            <LogoVerto size={50} showText={true} className="drop-shadow-sm shrink-0" />
          )}
          <div className="w-px h-8 bg-gray-200 mx-2 hidden sm:block"></div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 tracking-tight leading-none"> Olá, <span className="text-[#7a32fc]">{displayName}</span>! </h1> 
            <p className="text-gray-400 font-medium mt-1 text-xs"> Vamos cuidar de você hoje? </p> 
          </div>
        </div> 
        
        <div className="relative self-end sm:self-auto"> 
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-3 bg-white rounded-2xl shadow-sm text-gray-500 hover:bg-white transition-all border border-white/50 relative"
          >
            <Menu size={20} />
            {sharedNotes.length > 0 && <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white"></div>}
          </button>

          <AnimatePresence>
            {isMenuOpen && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                className="absolute right-0 mt-2 w-56 bg-white rounded-[24px] shadow-xl border border-blue-50 z-[60] overflow-hidden p-2"
              >
                {!isReadOnlyMode && (
                  <button 
                    onClick={() => { setIsMessagesOpen(true); setIsMenuOpen(false); }}
                    className="w-full flex items-center justify-between p-3 text-sm font-medium text-[#7a32fc] hover:bg-blue-50 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <MessageCircle size={18} /> Mensagens
                    </div>
                    {sharedNotes.length > 0 && (
                      <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {sharedNotes.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={() => { setIsSettingsOpen(true); setIsMenuOpen(false); }}
                  className="w-full flex items-center gap-3 p-3 text-sm font-medium text-[#7a32fc] hover:bg-purple-50 rounded-xl transition-colors"
                >
                  <Settings size={18} /> Configurações
                </button>
                <button 
                  onClick={() => { onLogout(); setIsMenuOpen(false); }}
                  className="w-full flex items-center gap-3 p-3 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <LogOut size={18} /> Sair da Conta
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div> 
      </div> 
      {isReadOnlyMode && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {readOnlyNotice}
        </div>
      )}
      {!dailyCheckinDone ? ( 
        <div className="mb-8 animate-slide-up"> 
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2 px-1"> {isConventionalAdult ? <Smile size={16} /> : <BatteryCharging size={16} />} {isConventionalAdult ? 'Como está se sentindo?' : 'Como se sente agora?'} </h2> 
          <div className="flex overflow-x-auto pb-8 pt-4 -mx-6 px-6 gap-4 snap-x snap-mandatory no-scrollbar items-center"> 
            {moodOptions.map((mood) => { 
              const isHovered = hoveredMood === mood.value; 
              const isDimmed = hoveredMood !== null && !isHovered; 
              return ( 
                <button key={mood.value} disabled={isReadOnlyMode} onClick={() => handleEmojiClick(mood)} onMouseEnter={() => setHoveredMood(mood.value)} onMouseLeave={() => setHoveredMood(null)} className={` snap-center shrink-0 w-40 h-56 sm:w-48 sm:h-64 rounded-[32px] flex flex-col items-center p-6 transition-all duration-500 border-4 shadow-lg ${mood.color} ${isHovered ? 'scale-110 -translate-y-4 shadow-2xl z-10 rotate-1' : 'scale-100'} ${isDimmed ? 'opacity-50 scale-95 blur-[1px]' : 'opacity-100'} group relative overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed`} > 
                  <div className="absolute top-[-20%] right-[-20%] w-24 h-24 rounded-full bg-white/20 blur-xl"></div> 
                  <div className="absolute bottom-[-10%] left-[-10%] w-20 h-20 rounded-full bg-white/30 blur-lg"></div> 
                  <div className="w-full flex justify-between items-center opacity-60 group-hover:opacity-100 transition-opacity z-10"> {!isConventionalAdult && <React.Fragment><BatteryFull size={20} className="text-gray-700" /> <span className="text-xs font-semibold text-gray-700">{mood.value}%</span></React.Fragment>} </div> 
                  <span className="text-7xl sm:text-8xl filter drop-shadow-md transform transition-transform duration-500 group-hover:scale-125 group-hover:rotate-12 z-10 my-auto"> {mood.emoji} </span> 
                </button> 
              ); 
            })} 
            <div className="w-2 shrink-0"></div> 
          </div> 
          <p className="text-center text-[10px] text-gray-400 font-medium animate-pulse mt-[-10px] italic"> Deslize para escolher ou clique </p> 
        </div> 
      ) : ( 
        <div className="bg-white rounded-[32px] p-6 shadow-sm border border-gray-100 mb-6 animate-fade-in flex items-center justify-between"> 
          <div className="flex items-center gap-4"> 
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600"> <Check size={24} /> </div> 
            <div> <h3 className="font-semibold text-gray-800 tracking-tight">{isConventionalAdult ? 'Sentimento Registrado!' : 'Energia Registrada!'}</h3> <p className="text-xs text-gray-400">Obrigado por compartilhar.</p> </div> 
          </div> 
          <button disabled={isReadOnlyMode} onClick={() => setDailyCheckinDone(false)} className="text-[10px] font-semibold text-[#7a32fc] bg-[#7a32fc]/10 px-4 py-2 rounded-xl hover:bg-[#7a32fc]/20 transition-colors flex items-center gap-2 uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed" > <RefreshCcw size={14} /> Ajustar </button> 
        </div> 
      )} 
      <div className="flex-1 overflow-y-auto no-scrollbar"> 
        <div className="mb-8"> 
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"> <Zap size={16} /> Suas Atividades </h2> 
          {visiblePatientTasks && visiblePatientTasks.length > 0 ? ( 
            <div className="grid gap-3"> 
              {visiblePatientTasks.map((task: any) => ( 
                <div key={task.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-all"> 
                  <div className="flex items-center gap-4"> 
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${task.completed ? 'bg-emerald-100 text-emerald-700' : (task.color || 'bg-[#7a32fc]/10 text-[#7a32fc]')}`}> {task.icon || '📋'} </div> 
                    <div>
                      <h3 className="font-semibold text-gray-800 tracking-tight">{task.title}</h3>
                      {task.description && <p className="text-xs text-gray-400 line-clamp-1">{task.description}</p>}
                      {(task.scheduledAt || task.scheduled_at) && (
                        <p className="text-[10px] text-[#7a32fc] font-semibold uppercase tracking-widest mt-1">
                          Hoje às {new Date(task.scheduledAt || task.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div> 
                  </div> 
                  <button disabled={isReadOnlyMode || task.completed || String(task.status || '').toLowerCase() === 'completed'} onClick={() => openTaskModal(task)} className={`p-3 rounded-xl transition-all active:scale-95 disabled:cursor-not-allowed ${task.completed || String(task.status || '').toLowerCase() === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-50 text-gray-400 hover:bg-green-500 hover:text-white disabled:opacity-50'}`} > <Check size={20} /> </button> 
                </div> 
              ))} 
            </div> 
          ) : ( 
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 bg-white/50 rounded-3xl border-2 border-dashed border-gray-200"> <Smile size={48} className="mb-2 opacity-50"/> <p className="font-medium">Nenhuma tarefa para agora.</p> </div> 
          )} 
        </div> 

        {dailyReviewTasks.length > 0 && (
          <div className="mb-8 animate-fade-in">
            <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"> <BookOpen size={16} /> Revisão Diária </h2>
            <div className="grid gap-3">
              {dailyReviewTasks.map((review: any) => (
                <div key={review.id} className="bg-green-50/50 p-5 rounded-[32px] border border-green-100 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">✍️</span>
                    <div>
                      <h3 className="font-semibold text-gray-800 tracking-tight">{review.title}</h3>
                      <p className="text-[10px] text-green-600 font-semibold uppercase">Lembrete de Revisão</p>
                    </div>
                  </div>
                  <div className="bg-white/80 p-4 rounded-2xl border border-green-50 mb-3">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Sua Resposta:</p>
                    <p className="text-sm text-gray-600 leading-relaxed italic">"{review.note}"</p>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-400 font-semibold uppercase">
                    <span>Concluído em {review.dateGroup}</span>
                    <span className="flex items-center gap-1 text-green-600"><CheckCircle size={12}/> Revisado</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-8 mb-6"> 
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2"> <Trophy size={16} /> Histórico </h2>
             <div className="relative w-48">
                <select 
                  className="w-full bg-white border border-gray-200 text-[10px] font-semibold text-gray-500 px-3 py-2 rounded-xl outline-none focus:border-[#4318FF] transition-all appearance-none uppercase tracking-widest"
                  value={selectedSnapshotDate}
                  onChange={(e) => setSelectedSnapshotDate(e.target.value)}
                >
                  <option value="all">Todos os dias</option>
                  {availableSnapshots.map((date: any) => (
                    <option key={date} value={date}>{formatFilterDate(String(date))}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
             </div>
          </div>
          <div className="border-l-2 border-gray-100 ml-3 pb-4 pl-6 space-y-8"> 
            {sortedDateKeys.length > 0 ? sortedDateKeys.map(dateKey => ( 
              <div key={dateKey} className="relative animate-slide-up"> 
                <div className="absolute -left-[31px] top-0 w-4 h-4 rounded-full bg-[#4318FF] border-2 border-white ring-4 ring-blue-50"></div> 
                <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 bg-gray-50 px-3 py-1 rounded-full w-fit">{dateKey}</h3> 
                <div className="space-y-4"> 
                  {groupedHistory[dateKey].map((item: any) => ( 
                    <HistoryCard 
                      key={item.id} 
                      item={item} 
                      energyTags={moodInfluenceTags} 
                      isTherapist={false} 
                      isKid={isKidsProfile}
                      fullHistory={history}
                      peiGoals={user.pei || []}
                      protocols={protocols}
                    /> 
                  ))} 
                </div> 
              </div> 
            )) : ( <p className="text-center text-gray-400 text-xs py-4 italic">Nenhuma atividade registrada para esta seleção.</p> )} 
          </div> 
        </div> 
      </div> 
      {isMoodModalOpen && selectedMood && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <button onClick={closeMoodModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
            <div className="text-center mb-4"> 
              {!isConventionalAdult && (
                <div className="inline-flex items-center gap-2 bg-gray-100 px-4 py-1.5 rounded-full mb-4"> <BatteryFull size={16} className="text-gray-500" /> <span className="text-sm font-semibold text-gray-600">Energia registrada: <span className="text-[#7a32fc]">{selectedMood.value}%</span></span> </div> 
              )}
              <div className="text-6xl mb-2 animate-bounce-slight">{selectedMood.emoji}</div> 
              <h3 className="text-xl font-semibold text-gray-800 tracking-tight">O que influenciou?</h3> 
            </div> 
            <div className="grid grid-cols-2 gap-3 mb-4"> 
              {moodInfluenceTags.map((tag: any) => ( 
                <button key={tag.id} onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)} className={`p-3 rounded-2xl flex items-center gap-3 border-2 transition-all ${selectedTag === tag.id ? 'border-[#7a32fc] bg-[#7a32fc]/5 shadow-sm' : 'border-transparent bg-gray-100'}`} > 
                  <div className={`p-2 rounded-xl ${tag.color} shrink-0`}>{typeof tag.icon === 'string' ? <span className="text-base">{tag.icon}</span> : tag.icon}</div> <span className={`text-xs font-semibold ${selectedTag === tag.id ? 'text-[#7a32fc]' : 'text-gray-500'}`}>{tag.label}</span> 
                </button> 
              ))} 
            </div> 
            <textarea className="w-full h-20 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#7a32fc]/50 transition-all resize-none mb-4" placeholder="Quer escrever algo sobre isso?" value={moodNote} onChange={(e) => setMoodNote(e.target.value)} ></textarea> 
            <button onClick={handleConfirmMood} disabled={showMoodSuccess} className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showMoodSuccess ? 'bg-green-500 text-white' : 'bg-[#7a32fc] text-white shadow-[#7a32fc]/30 hover:opacity-90'}`} > {showMoodSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Registrar</React.Fragment>} </button> 
          </div> 
        </div> 
      )} 
      {selectedTask && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <button onClick={closeTaskModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
            <div className="text-center mb-6"> 
              <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-3 ${selectedTask.color || 'bg-blue-100 text-blue-600'}`}> {selectedTask.icon || '📋'} </div> 
              <h3 className="text-xl font-semibold text-gray-800 tracking-tight">{selectedTask.title}</h3> 
              <p className="text-gray-500 text-sm mt-1">
                {selectedTask.type === 'intervention'
                  ? 'Instruções da tarefa de intervenção'
                  : isConventionalAdult
                    ? 'Como foi fazer essa tarefa?'
                    : 'Como foi realizar esta atividade?'}
              </p> 
            </div> 
            {selectedTask.type === 'intervention' ? (
              <div className="animate-slide-up space-y-4">
                {isConventionalAdult && taskStep === 0 && (
                  <div className="space-y-4">
                    <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                      <p className="text-[10px] text-green-700 uppercase tracking-widest font-semibold mb-2">Instruções do profissional</p>
                      <p className="text-sm text-gray-600 font-medium leading-relaxed italic">"{selectedTask.description}"</p>
                    </div>
                    <button
                      onClick={() => setTaskStep(1)}
                      className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-[#7a32fc] text-white shadow-[#7a32fc]/30 hover:opacity-90"
                    >
                      Iniciar tarefa
                    </button>
                  </div>
                )}

                {(!isConventionalAdult || taskStep === 1) && (
                  <React.Fragment>
                    <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                      <p className="text-sm text-gray-600 font-medium leading-relaxed italic">"{selectedTask.description}"</p>
                    </div>
                    <textarea 
                      className="w-full h-40 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-green-500/50 transition-all resize-none font-medium" 
                      placeholder="Escreva sua resposta aqui..." 
                      value={interventionResponse} 
                      onChange={(e) => setInterventionResponse(e.target.value)} 
                      autoFocus 
                    ></textarea>

                    {isConventionalAdult && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <label className={`px-3 py-2 rounded-xl border border-dashed border-gray-300 text-xs font-semibold text-gray-500 cursor-pointer hover:border-[#7a32fc]/40 hover:text-[#7a32fc] transition-colors ${isInterventionUploading ? 'opacity-50 cursor-wait' : ''}`}>
                            {isInterventionUploading ? 'Enviando...' : 'Anexar/Tirar Foto'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={handleInterventionImageUpload}
                              disabled={isInterventionUploading}
                            />
                          </label>
                        </div>
                        {interventionImages.length > 0 && (
                          <div className="grid grid-cols-3 gap-2">
                            {interventionImages.map((image, idx) => (
                              <div key={`intervention-img-${idx}`} className="relative rounded-xl overflow-hidden border border-gray-200">
                                <SecureImage src={image} alt={`Anexo ${idx + 1}`} className="w-full h-20 object-cover" />
                                <button
                                  onClick={() => setInterventionImages((prev) => prev.filter((_, i) => i !== idx))}
                                  className="absolute top-1 right-1 p-1 rounded-full bg-white/90 text-red-500"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {isConventionalAdult ? (
                      <button
                        onClick={handleConfirmTask}
                        disabled={showTaskSuccess || !interventionResponse.trim()}
                        className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      >
                        {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Enviar Resposta</React.Fragment>}
                      </button>
                    ) : (
                      <button 
                        onClick={handleConfirmTask} 
                        disabled={showTaskSuccess || !interventionResponse.trim()} 
                        className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                      > 
                        {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Enviar Resposta</React.Fragment>} 
                      </button>
                    )}
                  </React.Fragment>
                )}

              </div>
            ) : taskStep === 1 ? ( 
              <div className="animate-slide-up"> 
                {isKidsProfile ? (
                  <div className="space-y-6">
                    <p className="text-center text-sm font-semibold text-gray-600 mb-4">Como você se saiu nessa missão?</p>
                    <div className={`grid gap-4 ${selectedTask.maxScore > 1 ? 'grid-cols-3' : 'grid-cols-3'}`}>
                      {selectedTask.maxScore === 1 ? (
                        <>
                          {[0, 0.5, 1].map((score) => {
                            const colors: any = {
                              0: 'bg-[#EE5D50] shadow-red-500/20',
                              0.5: 'bg-[#FFB547] shadow-orange-500/20',
                              1: 'bg-[#05CD99] shadow-green-500/20'
                            };
                            const labels: any = {
                              0: "Não fiz",
                              0.5: "Quase lá",
                              1: "Consegui!"
                            };
                            return (
                              <button 
                                key={score}
                                onClick={() => { setTaskEnergy(score); handleEnergyCommit(); }}
                                className={`${colors[score]} text-white h-20 rounded-2xl flex flex-col items-center justify-center shadow-lg hover:scale-[1.02] active:scale-95 transition-all`}
                              >
                                <span className="text-2xl font-semibold">{score}</span>
                                <span className="text-[8px] font-semibold uppercase">{labels[score]}</span>
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        Array.from({ length: (selectedTask.maxScore || 2) + 1 }, (_, i) => i).map((score) => {
                          const colors = [
                            'bg-[#EE5D50] shadow-red-500/20',     // 0
                            'bg-[#FFB547] shadow-orange-500/20',  // 1
                            'bg-[#05CD99] shadow-green-500/20',   // 2
                            'bg-[#7a32fc] shadow-blue-500/20',    // 3
                            'bg-[#7551FF] shadow-indigo-500/20'   // 4
                          ];
                          const labels = ["Não fiz", "Quase lá", "Consegui!", "Incrível!", "Mestre!"];
                          const colorClass = colors[score] || 'bg-gray-500';
                          
                          return (
                            <button 
                              key={score}
                              onClick={() => { setTaskEnergy(score); handleEnergyCommit(); }}
                              className={`${colorClass} text-white h-20 rounded-2xl flex flex-col items-center justify-center shadow-lg hover:scale-[1.02] active:scale-95 transition-all`}
                            >
                              <span className="text-2xl font-semibold">{score}</span>
                              <span className="text-[8px] font-semibold uppercase">{labels[score] || "Pontuação"}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <React.Fragment>
                    {isConventionalAdult ? (
                      <div className="space-y-4">
                        <textarea
                          className="w-full h-24 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#7a32fc]/50 transition-all resize-none mb-2 font-medium"
                          placeholder="Como foi fazer essa tarefa?"
                          value={taskNote}
                          onChange={(e) => setTaskNote(e.target.value)}
                          autoFocus
                        ></textarea>
                        <button
                          onClick={handleConfirmTask}
                          disabled={showTaskSuccess}
                          className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-green-500 text-white shadow-green-500/30 hover:opacity-90"
                        >
                          {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Concluir</React.Fragment>}
                        </button>
                      </div>
                    ) : (
                      <React.Fragment>
                        <BigEnergySlider value={taskEnergy} onChange={(e: any) => setTaskEnergy(e.target.value)} onCommit={handleEnergyCommit} /> 
                        <p className="text-center text-[10px] text-[#7a32fc]/50 mt-4 font-medium animate-pulse italic uppercase tracking-widest">(Solte para continuar)</p>
                      </React.Fragment>
                    )}
                  </React.Fragment>
                )}
              </div> 
            ) : ( 
              <div className="animate-slide-up"> 
                <div className="mb-4"> 
                  <div className="flex items-center justify-between mb-2"> 
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{isKidsProfile ? 'Sua Pontuação' : isConventionalAdult ? 'Esforço' : 'Energia'}</span> 
                    <span className="text-sm font-semibold text-[#7a32fc]">{isKidsProfile ? taskEnergy : `${taskEnergy}%`}</span> 
                  </div> 
                  <div className="w-full bg-gray-100 rounded-full h-2"> 
                    <div className="bg-[#7a32fc] h-2 rounded-full" style={{ width: isKidsProfile ? `${taskEnergy * 100}%` : `${taskEnergy}%` }}></div> 
                  </div> 
                  {isConventionalAdult && (
                    <div className="flex justify-between text-[10px] text-gray-400 font-semibold mt-1">
                      <span>Mais difícil 😟</span>
                      <span>Mais fácil 🙂</span>
                    </div>
                  )}
                </div> 
                <textarea className="w-full h-24 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#7a32fc]/50 transition-all resize-none mb-4 font-medium" placeholder={isKidsProfile ? "Quer contar como foi?" : isConventionalAdult ? "Observação opcional sobre o esforço..." : "Quer adicionar alguma observação?"} value={taskNote} onChange={(e) => setTaskNote(e.target.value)} autoFocus ></textarea> 
                <button onClick={handleConfirmTask} disabled={showTaskSuccess} className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-green-500 text-white shadow-green-500/30 hover:opacity-90" > {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Concluir</React.Fragment>} </button> 
              </div> 
            )} 
          </div> 
        </div> 
      )} 
    </div> 
  ); 
};







