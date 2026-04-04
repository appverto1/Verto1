import React, { useState, useEffect } from 'react';
import { GlobalStyles, ENERGY_TAGS } from './components/Common';
import { LandingPage } from './components/LandingPage';
import { PatientDashboard } from './components/PatientDashboard';
import { TherapistDashboard } from './components/TherapistDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { TeamManagement } from './components/TeamManagement';
import { InvitationModal } from './components/InvitationModal';
import { testSupabaseConnection, getSupabase } from './lib/supabase';
import { Database, CheckCircle2, AlertCircle, Lock, WifiOff, LayoutDashboard, Users } from 'lucide-react';
import { syncOfflineData } from './services/localDb';
import { dataService } from './services/dataService';

export default function App() {
  const [user, setUser] = useState<any>(null); 
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineData();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Initial sync
    if (navigator.onLine) syncOfflineData();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const initSupabase = async () => {
      const supabase = await getSupabase();
      if (!supabase) return;

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const intendedRole = localStorage.getItem('verto_intended_role') || 'therapist';
          localStorage.removeItem('verto_intended_role');
          await handleLoginSuccess(session, intendedRole);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
        }
      });

      return () => subscription.unsubscribe();
    };
    initSupabase();
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me');
        const data = await response.json();
        if (data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('Session check error:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
      // Refresh session to get active status
      const checkSession = async () => {
        try {
          const response = await fetch('/api/auth/me');
          const data = await response.json();
          if (data.user) {
            setUser(data.user);
            // Clear URL params
            window.history.replaceState({}, document.title, "/");
          }
        } catch (error) {
          console.error('Session refresh error:', error);
        }
      };
      checkSession();
    }
  }, []);

  const handleLoginSuccess = async (supabaseSession: any, intendedRole?: string) => {
    try {
      const accessToken = supabaseSession.access_token;
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, intendedRole })
      });
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
        if (data.isFirstLogin && (data.user.role === 'coordinator' || data.user.role === 'admin')) {
          setShowInvitationModal(true);
        }
      }
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const initialHistory = [ 
    { id: 106, patientId: 102, type: 'task', title: "Olha por onde anda", time: "08:30", energy: 85, note: "Ótima atenção hoje.", icon: "🚶", dateGroup: "Hoje", score: 2 },
    { id: 105, patientId: 102, type: 'task', title: "Usa os utensílios da forma apropriada", time: "12:15", energy: 70, note: "Usou garfo e faca independentemente.", icon: "🍴", dateGroup: "Hoje", score: 4 },
    { id: 104, patientId: 102, type: 'task', title: "Responde às saudações de forma apropriada", time: "14:00", energy: 90, note: "Contato visual mantido.", icon: "👋", dateGroup: "Hoje", score: 3 },
    { id: 103, patientId: 102, type: 'task', title: "Muda de atividade quando o alarme tocar", time: "16:00", energy: 60, note: "Trocou sem frustração.", icon: "⏰", dateGroup: "Hoje", score: 2 },
    { id: 102, patientId: 102, type: 'task', title: "Classifica o dinheiro", time: "10:00", energy: 50, note: "Acertou moedas e notas de 10.", icon: "💵", dateGroup: "Ontem", score: 2 },
    { id: 101, patientId: 102, type: 'task', title: "Olha por onde anda", time: "09:00", energy: 40, note: "Esbarrou em dois móveis.", icon: "🚶", dateGroup: "Ontem", score: 1 },
    { id: 100, patientId: 102, type: 'task', title: "Responde às saudações de forma apropriada", time: "15:00", energy: 30, note: "Respondeu mas olhou para o chão.", icon: "👋", dateGroup: "Ontem", score: 1 },
    { id: 99, patientId: 102, type: 'task', title: "Classifica o dinheiro", time: "11:00", energy: 20, note: "Confundiu moedas.", icon: "💵", dateGroup: "25/01/2026", score: 1 },
    { id: 98, patientId: 102, type: 'task', title: "Usa os utensílios da forma apropriada", time: "12:30", energy: 45, note: "Dificuldade em segurar o garfo.", icon: "🍴", dateGroup: "25/01/2026", score: 2 },
    // Data for Alexandre (101) - VB-MAPP
    { id: 210, patientId: 101, type: 'task', title: "Emite 2 mandos sem ajuda", time: "09:00", energy: 90, note: "Pediu água e bola.", icon: "🗣️", dateGroup: "Hoje", score: 1 },
    { id: 209, patientId: 101, type: 'task', title: "Atende ao chamado do nome", time: "09:15", energy: 85, note: "Atendeu prontamente.", icon: "👂", dateGroup: "Hoje", score: 1 },
    { id: 208, patientId: 101, type: 'task', title: "Encaixa 2 peças de quebra-cabeça", time: "09:30", energy: 80, note: "Encaixou círculo e quadrado.", icon: "🧩", dateGroup: "Hoje", score: 0.5 },
    { id: 207, patientId: 101, type: 'task', title: "Imita 2 movimentos motoros grossos", time: "09:45", energy: 75, note: "Imitou bater palmas.", icon: "🙌", dateGroup: "Hoje", score: 1 },
    { id: 206, patientId: 101, type: 'task', title: "Olha por onde anda", time: "08:30", energy: 95, note: "Super herói atento!", icon: "🚶", dateGroup: "Hoje", score: 1 },
    { id: 205, patientId: 101, type: 'task', title: "Responde às saudações de forma apropriada", time: "10:00", energy: 80, note: "Cumprimentou todo mundo!", icon: "👋", dateGroup: "Hoje", score: 0.5 },
    { id: 204, patientId: 101, type: 'task', title: "Olha por onde anda", time: "09:00", energy: 60, note: "Um pouco distraído.", icon: "🚶", dateGroup: "Ontem", score: 0.5 },
    { id: 203, patientId: 101, type: 'task', title: "Responde às saudações de forma apropriada", time: "11:00", energy: 50, note: "Precisou de ajuda.", icon: "👋", dateGroup: "Ontem", score: 0 },
    // Mock Photos for Mural
    { id: 301, patientId: 101, type: 'photo', title: "Desenho do Alexandre", time: "10:00", note: "Olha o que eu fiz hoje!", image: "https://picsum.photos/seed/drawing/400/400", dateGroup: "Hoje", date: new Date().toISOString(), icon: "🖼️" },
    { id: 302, patientId: 101, type: 'photo', title: "Atividade de hoje", time: "11:30", note: "Brincando com blocos", image: "https://picsum.photos/seed/activity/400/400", dateGroup: "Hoje", date: new Date().toISOString(), icon: "📸" }
  ];
  const initialTasks = [ { id: 1, patientId: 102, title: "Tomar Medicação", icon: "💊", color: "bg-blue-100 text-blue-600", completed: false, type: 'task', description: "Lembre-se de tomar com água." } ];
  const [therapistNotes, setTherapistNotes] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>(initialTasks);
  const [clinicalRecords, setClinicalRecords] = useState<any[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [view, setView] = useState<'dashboard' | 'team'>('dashboard');
  const [rooms, setRooms] = useState<any[]>([
    { id: 'room1', name: 'Sala 01 - Kids', specialties: ['ABA', 'TCC'] },
    { id: 'room2', name: 'Sala 02 - Terapia Ocupacional', specialties: ['Integração Sensorial', 'TO'] },
    { id: 'room3', name: 'Sala 03 - Avaliação', specialties: ['Neuropsicologia'] },
    { id: 'room4', name: 'Sala 04 - TO', specialties: ['Integração Sensorial', 'TO'] },
  ]);
  const [roomReservations, setRoomReservations] = useState<any[]>([
    {
      id: '1',
      roomId: 'room1',
      roomName: 'Sala 01 - Kids',
      professionalId: 'prof1',
      professionalName: 'Dra. Raísa',
      date: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00'
    }
  ]);
  const [specialtySettings, setSpecialtySettings] = useState<any>({
    'ABA': 60,
    'TCC': 50,
    'TO': 45,
    'Neuropsicologia': 90
  });
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [crp, setCrp] = useState<string>('');
  const [showInvitationModal, setShowInvitationModal] = useState(false);

  const onAddActivityLog = async (action: string, details: string, category: 'clinical' | 'management' | 'system' = 'clinical') => {
    const newLog = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      professional: user?.name || "Profissional",
      action,
      details,
      category
    };
    
    setActivityLogs(prev => [newLog, ...prev]);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.saveActivityLog(newLog);
  };
  
  const initialAFLSProtocol = [
    { id: 'dom-mb', name: 'Mobilidade Básica', skills: [{ id: 'mb1', name: 'Olha por onde anda', objective: 'O aprendiz observa por onde anda e evita obstáculos', criteria: '2=Independente; 1=Com ajuda; 0=Não faz', example: 'Poças, lombadas, pessoas', maxScore: 2 }] },
    { id: 'dom-ep', name: 'Comer em Público', skills: [{ id: 'ep1', name: 'Usa os utensílios da forma apropriada', objective: 'O aprendiz irá usar os utensílios da forma apropriada', criteria: '4=Corta carne com faca; 3=Usa faca para espalhar; 2=Usa garfo/colher bem; 1=Usa com ajuda; 0=Não usa', example: 'Garfo para espetar, faca para cortar', maxScore: 4 }] },
    { id: 'dom-mo', name: 'Dinheiro', skills: [{ id: 'mo1', name: 'Classifica o dinheiro', objective: 'O aprendiz irá classificar vários tipos de cédulas e moedas em grupos', criteria: '2=Cédulas e moedas; 1=Apenas um tipo; 0=Não faz', example: 'Grupos de moedas e cédulas', maxScore: 2 }] },
    { id: 'dom-ts', name: 'Horário', skills: [{ id: 'ts1', name: 'Muda de atividade quando o alarme tocar', objective: 'O aprendiz irá mudar de atividade quando o alarme tocar', criteria: '2=Independente; 1=Com ajuda; 0=Não faz', example: 'Desliga computador, sai da banheira', maxScore: 2 }] },
    { id: 'dom-sa', name: 'Consciência Social e Modos', skills: [{ id: 'sa1', name: 'Responde às saudações de forma apropriada', objective: 'O aprendiz irá responder a todas as saudações com contato visual', criteria: '3=Independente com contato visual; 2=Responde sem contato visual; 1=Com ajuda; 0=Não faz', example: "Hey, Oi, Olá", maxScore: 3 }] }
  ];
  
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  const handleCheckout = async () => {
    try {
      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Erro ao iniciar pagamento. Tente novamente.');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Erro de conexão. Tente novamente.');
    }
  };

  const SubscriptionRequired = ({ user, onLogout }: { user: any, onLogout: () => void }) => (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl shadow-blue-500/5 p-10 text-center border border-slate-100 animate-pop">
        <div className="w-20 h-20 bg-blue-50 text-[#4318FF] rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
          <Lock size={40} />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">Ative sua conta</h2>
        <p className="text-slate-500 font-normal mb-8 leading-relaxed">
          Para acessar a plataforma Verto, é necessário ativar sua assinatura. 
          {user.role === 'patient' ? (
            <span> O valor para pacientes é de apenas <strong>R$ 4,90/mês</strong>.</span>
          ) : (
            <span> Selecione o plano ideal para sua clínica e comece a evoluir.</span>
          )}
        </p>
        
        <div className="space-y-4">
          <button 
            onClick={handleCheckout}
            className="w-full bg-[#4318FF] text-white py-4 rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/20 hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            Pagar Agora (R$ {user.planPrice?.toFixed(2).replace('.', ',') || '0,00'})
          </button>
          
          <button 
            onClick={onLogout}
            className="w-full bg-white text-slate-400 py-4 rounded-2xl font-semibold text-xs hover:text-slate-600 transition-all"
          >
            Sair da conta
          </button>
        </div>
        
        <p className="mt-8 text-[10px] text-slate-400 font-medium uppercase tracking-widest">
          Pagamento processado com segurança pelo Stripe
        </p>
      </div>
    </div>
  );

  const initialVBMAPPProtocol = [
    { id: 'vbm-mand', name: 'Mando (Mand)', skills: [
      { id: 'm1', name: 'Emite 2 mandos sem ajuda', objective: 'O aprendiz pede 2 itens desejados sem ajuda física ou verbal', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Pede água, bolacha', maxScore: 1 },
      { id: 'm2', name: 'Emite 5 mandos com ajuda ecoica', objective: 'O aprendiz pede 5 itens diferentes com ajuda ecoica', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Diz "bola" após o terapeuta', maxScore: 1 }
    ]},
    { id: 'vbm-tact', name: 'Tato (Tact)', skills: [
      { id: 't1', name: 'Tateia 2 itens familiares', objective: 'O aprendiz nomeia 2 itens comuns quando apresentados', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Diz "carro" ao ver um brinquedo', maxScore: 1 }
    ]},
    { id: 'vbm-listener', name: 'Ouvinte (Listener)', skills: [
      { id: 'l1', name: 'Atende ao chamado do nome', objective: 'O aprendiz olha para o interlocutor quando chamado pelo nome', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Olha ao ouvir "Alexandre"', maxScore: 1 },
      { id: 'l2', name: 'Segue 2 instruções de um passo', objective: 'O aprendiz segue 2 instruções motoras simples', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Bata palmas, dê tchau', maxScore: 1 }
    ]},
    { id: 'vbm-visual', name: 'Percepção Visual (VP-MTS)', skills: [
      { id: 'v1', name: 'Encaixa 2 peças de quebra-cabeça', objective: 'O aprendiz encaixa 2 peças em um tabuleiro', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Quebra-cabeça de formas', maxScore: 1 }
    ]},
    { id: 'vbm-play', name: 'Brincar Independente (Play)', skills: [
      { id: 'p1', name: 'Brinca com um brinquedo por 1 min', objective: 'O aprendiz manipula um brinquedo funcionalmente por 1 min', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Empilha blocos, empurra carro', maxScore: 1 }
    ]},
    { id: 'vbm-imitation', name: 'Imitação Motora (Imitation)', skills: [
      { id: 'i1', name: 'Imita 2 movimentos motores grossos', objective: 'O aprendiz imita movimentos como bater palmas ou levantar braços', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Bater palmas, tocar cabeça', maxScore: 1 }
    ]},
    { id: 'vbm-echoic', name: 'Ecooico (Echoic)', skills: [
      { id: 'e1', name: 'Ecoa 2 sons simples', objective: 'O aprendiz repete sons vocais simples', criteria: '1=Sem ajuda; 0.5=Com ajuda parcial; 0=Não faz', example: 'Diz "ah", "ba"', maxScore: 1 }
    ]}
  ];

  const [protocols, setProtocols] = useState<any[]>([ 
    { id: 1, title: 'AFLS - Protocolo de Vida Diária', data: initialAFLSProtocol, ageGroup: 'all', type: 'neurodevelopment', domain: 'Autonomia, Vida Diária', category: 'evaluation' },
    { id: 2, title: 'VB-MAPP - Nível 1', data: initialVBMAPPProtocol, ageGroup: 'kid', type: 'neurodevelopment', domain: 'Linguagem, Comportamento', category: 'evaluation' },
    { id: 3, title: 'Treino de Habilidades Sociais', data: [
      { id: 'soc-1', name: 'Iniciação Social', skills: [
        { id: 's1', name: 'Inicia conversa com pares', objective: 'O aprendiz inicia uma interação verbal com um colega', criteria: 'Independente; Com ajuda; Não realiza', example: 'Diz "Oi, quer brincar?"', maxScore: 1 }
      ]}
    ], ageGroup: 'child', type: 'neurodevelopment', domain: 'Socialização', category: 'intervention' }
  ]);
  const [therapistAgenda, setTherapistAgenda] = useState<any[]>([ 
    { id: 101, name: 'Alexandre', date: todayStr, time: '09:00', status: 'confirmed', type: 'ABA / AFLS', color: 'bg-blue-100 text-blue-600' }, 
    { id: 102, name: 'Júlia S.', date: todayStr, time: '10:30', status: 'pending', type: 'Avaliação', color: 'bg-pink-100 text-pink-600' },
    { id: 103, name: 'Marcos P.', date: tomorrowStr, time: '14:00', status: 'confirmed', type: 'TCC', color: 'bg-green-100 text-green-600' },
    { id: 104, name: 'Ana Clara', date: nextWeekStr, time: '11:00', status: 'pending', type: 'TO', color: 'bg-orange-100 text-orange-600' },
    { id: 105, name: 'Pedro H.', date: todayStr, time: '16:00', status: 'canceled', type: 'Psicomotricidade', color: 'bg-red-100 text-red-600' }
  ]);
  const [allPatients, setAllPatients] = useState<any[]>([ 
    { id: 101, name: 'Alexandre', phone: '11999999999', age: 8, type: 'neurodevelopment', approach: 'ABA' }, 
    { id: 102, name: 'Júlia S.', phone: '11988888888', age: 24, type: 'conventional', approach: 'TCC' } 
  ]);

  useEffect(() => {
    // Initialize clinical records for mock patients
    setClinicalRecords([
      { 
        patientId: 101, 
        diagnosis: "TEA", 
        anamnesisData: { formType: 'child', motivoConsulta: "Dificuldade na socialização e fala." },
        pei: [
          { id: 1, name: "Emite 2 mandos sem ajuda", status: 'in-progress', category: 'Linguagem' },
          { id: 2, name: "Atende ao chamado do nome", status: 'in-progress', category: 'Social' }
        ],
        evaluationLinks: {},
        interventionTaskLinks: {}
      },
      { 
        patientId: 102, 
        diagnosis: "Ansiedade", 
        anamnesisData: { formType: 'adult', motivoConsulta: "Ansiedade e dificuldade de sono." },
        pei: [],
        evaluationLinks: {},
        interventionTaskLinks: {}
      }
    ]);
  }, []);
  
  // Fetch patients, notes, and history from Backend on load
  useEffect(() => {
    const fetchData = async () => {
      if (user) {
        const { dataService } = await import('./services/dataService');
        
        if (user.role === 'therapist') {
          // Load Patients
          const patientsRes = await dataService.getPatients();
          if (patientsRes.success && patientsRes.data) {
            setAllPatients(prev => {
              const existingIds = prev.map(p => p.id);
              const newPatients = patientsRes.data.filter((p: any) => !existingIds.includes(p.id));
              return [...prev, ...newPatients];
            });

            // Load Notes, History and Tasks for each patient
            const allNotes: any[] = [];
            const allHistory: any[] = [];
            const allTasks: any[] = [];

            for (const patient of [...allPatients, ...patientsRes.data]) {
              if (!patient.id) continue;
              const notesRes = await dataService.getNotes(String(patient.id));
              if (notesRes.success && notesRes.data) {
                allNotes.push(...notesRes.data.map((n: any) => ({
                  ...n,
                  patientId: n.patient_id,
                  date: new Date(n.created_at).toLocaleString()
                })));
              }

              const historyRes = await dataService.getHistory(String(patient.id));
              if (historyRes.success && historyRes.data) {
                allHistory.push(...historyRes.data.map((h: any) => ({
                  ...h,
                  patientId: h.patient_id,
                  time: new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  dateGroup: new Date(h.created_at).toDateString() === new Date().toDateString() ? "Hoje" : new Date(h.created_at).toLocaleDateString()
                })));
              }

              const tasksRes = await dataService.getTasks(String(patient.id));
              if (tasksRes.success && tasksRes.data) {
                allTasks.push(...tasksRes.data.map((t: any) => ({
                  ...t,
                  patientId: t.patient_id
                })));
              }
            }

            if (allNotes.length > 0) setTherapistNotes(allNotes);
            if (allHistory.length > 0) setHistory(allHistory);
            if (allTasks.length > 0) setTasks(allTasks);
          }
        } else if (user.role === 'patient') {
          // Load Patient's own history and tasks by email
          const historyRes = await dataService.getHistoryByEmail(user.email);
          if (historyRes.success && historyRes.data) {
            setHistory(historyRes.data.map((h: any) => ({
              ...h,
              patientId: user.id,
              time: new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              dateGroup: new Date(h.created_at).toDateString() === new Date().toDateString() ? "Hoje" : new Date(h.created_at).toLocaleDateString()
            })));
          }

          const tasksRes = await dataService.getTasksByEmail(user.email);
          if (tasksRes.success && tasksRes.data) {
            setTasks(tasksRes.data.map((t: any) => ({
              ...t,
              patientId: user.id
            })));
          }
        }
      }
    };
    fetchData();
  }, [user]);

  // Fetch activity logs from Backend on load
  useEffect(() => {
    const fetchLogs = async () => {
      if (user && user.role === 'therapist') {
        const { dataService } = await import('./services/dataService');
        const { success, data } = await dataService.getActivityLogs();
        if (success && data) {
          setActivityLogs(data);
        }
      }
    };
    fetchLogs();
  }, [user]);

  const handleAddTask = async (t: any) => {
    setTasks(prev => [...prev, t]);
    onAddActivityLog("Criação de Tarefa", `Tarefa "${t.title}" criada para o paciente ID ${t.patientId}.`);

    // Sync to Backend
    const patient = allPatients.find(p => p.id === t.patientId);
    const { dataService } = await import('./services/dataService');
    await dataService.addTask({
      ...t,
      patient_id: String(t.patientId),
      patient_email: patient?.email || null
    });
  };
  const handleUpdateTask = async (id: any, fields: any) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t));
    onAddActivityLog("Atualização de Tarefa", `Tarefa ID ${id} atualizada.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.addTask({
      id: String(id),
      ...fields
    });
  };
  const handleAddNote = async (pid: any, txt: string, visibility: string, subject?: string) => {
    const patient = allPatients.find(p => p.id === pid);
    const newNote = { 
      id: Date.now(), 
      patientId: pid, 
      text: txt, 
      date: new Date().toLocaleString(), 
      visibility, 
      subject: subject || "Geral" 
    };
    setTherapistNotes(prev => [newNote, ...prev]);
    onAddActivityLog("Registro de Evolução", `Nova nota (${visibility}) adicionada ao prontuário do paciente ID ${pid}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.addNote({
      patient_id: String(pid),
      patient_email: patient?.email || null,
      text: txt,
      visibility,
      subject: subject || "Geral"
    });
  };
  const handleUpdateHistoryItem = (id: any, updates: any) => { 
    const item = history.find(i => i.id === id);
    if (item) {
      const updatedItem = { ...item, ...updates };
      const noteText = `📝 ATUALIZAÇÃO DE REGISTRO\nAtividade: ${updatedItem.title}\nPontuação: ${updatedItem.score}\nObs: ${updatedItem.evalComment || "Nenhuma observação."}`;
      handleAddNote(item.patientId, noteText, 'private', 'Sessão');
      setHistory(prev => prev.map(i => i.id === id ? updatedItem : i));
      onAddActivityLog("Edição de Histórico", `Registro de atividade "${item.title}" (ID ${id}) editado.`);
    }
  };
  const handleUpdateAgendaStatus = (id: any, status: string) => {
    setTherapistAgenda(prev => prev.map(item => item.id === id ? { ...item, status } : item));
  };

  const handleAddPatient = async (data: any) => { 
    const newId = data.id || Date.now(); 
    
    // Identity Data (Pseudonymized)
    const newPatient = { 
      id: newId, 
      name: data.name, 
      email: data.email,
      phone: data.phone, 
      age: data.anamnesisData?.idade || data.age || 0, 
      approach: data.approach, 
      type: data.approach === 'ABA' ? 'neurodevelopment' : data.approach === 'TO' ? 'occupational' : 'conventional' 
    };

    // Clinical Data (Sensitive - linked by ID only)
    const newClinicalRecord = {
      patientId: newId,
      diagnosis: data.diagnosis,
      anamnesisData: data.anamnesisData,
      pei: data.pei || [],
      evaluationLinks: data.evaluationLinks || {},
      interventionTaskLinks: data.interventionTaskLinks || {}
    };

    setAllPatients(prev => [...prev, newPatient]); 
    setClinicalRecords(prev => [...prev, newClinicalRecord]);

    if(data.scheduleImmediate) setTherapistAgenda(prev => [...prev, {id: newId, name: data.name, date: data.date || todayStr, time: data.time, status: 'pending', type: 'Primeira', color: 'bg-blue-100 text-blue-600'}].sort((a,b) => a.time.localeCompare(b.time))); 
    onAddActivityLog("Cadastro de Paciente", `Paciente ID ${newId} cadastrado no sistema.`, 'management');

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    
    // 1. Create patient user account if email provided
    if (data.email) {
      const userResult = await dataService.createPatientUser(data.email, data.name);
      if (userResult.success) {
        console.log(`User account created for patient: ${data.email}`);
        if (userResult.tempPassword) {
          alert(`Conta criada para o paciente!\nEmail: ${data.email}\nSenha temporária: ${userResult.tempPassword}\n\nPor favor, informe ao paciente.`);
        } else if (userResult.message === 'User already exists') {
          // If user already exists, we should inform that history will be linked
          alert(`O paciente com o email ${data.email} já possui uma conta no sistema. Todo o histórico clínico anterior será vinculado a este novo prontuário.`);
          
          // Fetch existing history and notes by email
          const historyRes = await dataService.getHistoryByEmail(data.email);
          if (historyRes.success && historyRes.data) {
            const existingHistory = historyRes.data.map((h: any) => ({
              ...h,
              patientId: newId, // Link to the temporary ID, will be updated to realId later
              time: new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              dateGroup: new Date(h.created_at).toDateString() === new Date().toDateString() ? "Hoje" : new Date(h.created_at).toLocaleDateString()
            }));
            setHistory(prev => [...prev, ...existingHistory]);
          }

          const notesRes = await dataService.getNotesByEmail(data.email);
          if (notesRes.success && notesRes.data) {
            const existingNotes = notesRes.data.map((n: any) => ({
              ...n,
              patientId: newId,
              date: new Date(n.created_at).toLocaleString()
            }));
            setTherapistNotes(prev => [...prev, ...existingNotes]);
          }
        }
      }
    }

    // 2. Save patient record
    const fbResult = await dataService.savePatient({
      name: data.name,
      email: data.email || '',
      phone: data.phone,
      age: data.anamnesisData?.idade || data.age || 0,
      diagnosis: data.diagnosis
    });

    if (fbResult.success && fbResult.data) {
      const realId = fbResult.data.id;
      setAllPatients(prev => prev.map(p => p.id === newId ? { ...p, id: realId } : p));
      setClinicalRecords(prev => prev.map(r => r.patientId === newId ? { ...r, patientId: realId } : r));
    }
  };
  const handleUpdatePatient = async (updatedData: any) => { 
    // Split updates
    const { diagnosis, anamnesisData, pei, evaluationLinks, interventionTaskLinks, ...identityData } = updatedData;

    // If unlinking (clinic_id is null), remove from local state
    if (updatedData.clinic_id === null) {
      setAllPatients(prev => prev.filter(p => p.id !== updatedData.id));
      setClinicalRecords(prev => prev.filter(r => r.patientId !== updatedData.id));
      setTherapistAgenda(prev => prev.filter(a => a.id !== updatedData.id));
      onAddActivityLog("Desvinculação de Paciente", `Paciente ID ${updatedData.id} foi desvinculado.`, 'management');
    } else {
      if (Object.keys(identityData).length > 1) { // More than just 'id'
        setAllPatients(prev => prev.map(p => p.id === updatedData.id ? { ...p, ...identityData } : p)); 
      }

      if (diagnosis !== undefined || anamnesisData !== undefined || pei !== undefined || evaluationLinks !== undefined || interventionTaskLinks !== undefined) {
        setClinicalRecords(prev => prev.map(r => r.patientId === updatedData.id ? { 
          ...r, 
          ...(diagnosis !== undefined && { diagnosis }),
          ...(anamnesisData !== undefined && { anamnesisData }),
          ...(pei !== undefined && { pei }),
          ...(evaluationLinks !== undefined && { evaluationLinks }),
          ...(interventionTaskLinks !== undefined && { interventionTaskLinks })
        } : r));
      }

      setTherapistAgenda(prev => prev.map(a => a.id === updatedData.id ? { ...a, name: updatedData.name || a.name } : a)); 
      onAddActivityLog("Atualização de Cadastro", `Dados do paciente ID ${updatedData.id} atualizados.`, 'management');
    }

    // Sync to Backend
    if (typeof updatedData.id === 'string' || typeof updatedData.id === 'number') {
      const { dataService } = await import('./services/dataService');
      await dataService.updatePatient(String(updatedData.id), {
        name: updatedData.name,
        email: updatedData.email,
        phone: updatedData.phone,
        age: updatedData.age,
        diagnosis: updatedData.diagnosis,
        clinic_id: updatedData.clinic_id,
        status: updatedData.status
      });
    }
  };
  const handleScheduleSession = (sess: any) => { 
    const pid = allPatients.find(p => p.name === sess.patientName)?.id || Date.now(); 
    const numSessions = sess.numSessions || 1;
    const newItems = [];
    
    for (let i = 0; i < numSessions; i++) {
      const date = new Date(sess.date + 'T00:00:00');
      date.setDate(date.getDate() + (i * 7)); // Weekly recurrence
      const dateStr = date.toISOString().split('T')[0];
      
      newItems.push({
        id: Date.now() + i, // Unique ID for each session
        patientId: pid,
        name: sess.patientName, 
        date: dateStr, 
        time: sess.time, 
        status: 'pending', 
        type: sess.approach, 
        color: 'bg-blue-100 text-blue-600',
        professional: sess.professional,
        room: sess.room
      });
    }

    setTherapistAgenda(prev => [...prev, ...newItems].sort((a,b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    })); 

    // Update room reservations
    if (sess.room) {
      const newRoomReservations = newItems.map(item => ({
        id: 'res-' + item.id,
        roomId: sess.room,
        roomName: rooms.find(r => r.id === sess.room)?.name || sess.room,
        professionalId: user.id,
        professionalName: user.name,
        date: item.date,
        startTime: item.time,
        endTime: calculateEndTime(item.time, sess.approach)
      }));
      setRoomReservations(prev => [...prev, ...newRoomReservations]);
    }

    onAddActivityLog("Agendamento de Sessão", `${numSessions} sessões agendadas para "${sess.patientName}" começando em ${sess.date}.`, 'management');
  };

  const calculateEndTime = (startTime: string, approach: string) => {
    const duration = specialtySettings[approach] || 60;
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + duration);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const handleMoodCheckin = (l: number, n: string, i: string, t: any) => setHistory(prev => [{ id: Date.now(), patientId: user.id, type: 'checkin', title: "Check-in", time: new Date().toLocaleTimeString(), energy: l, note: n, icon: i, dateGroup: "Hoje", tag: t }, ...prev]);
  const handleCompleteTask = async (t: any, e: number, n: string) => { 
    const time = new Date().toLocaleTimeString();
    const isKid = user.age <= 12;
    const newHistoryItem = { 
      id: Date.now(), 
      patientId: user.id, 
      type: t.type || 'task', 
      title: t.title, 
      time, 
      energy: isKid ? (e / (t.maxScore || 1) * 100) : e, 
      score: isKid ? e : undefined,
      note: n, 
      icon: t.icon, 
      dateGroup: "Hoje",
      isDailyReminder: t.isDailyReminder,
      linkedTask: t.linkedTask
    };
    setHistory(prev => [newHistoryItem, ...prev]); 
    setTasks(prev => prev.filter(x => x.id !== t.id)); 
    
    // Add a note about the patient completing the task
    const noteText = `✅ TAREFA CONCLUÍDA PELO PACIENTE\nAtividade: ${t.title}\n${isKid ? `Pontuação: ${e}\n` : ''}Anotações do Paciente: ${n || "Nenhuma observação."}`;
    handleAddNote(user.id, noteText, 'private', 'Evolução');

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.addHistoryItem({
      patient_id: String(user.id),
      patient_email: user.email || null,
      type: t.type || 'task',
      title: t.title,
      score: isKid ? e : null,
      energy: isKid ? (e / (t.maxScore || 1) * 100) : e,
      note: n,
      icon: t.icon
    });
  };
  const handleRecordTrial = async (pid: any, title: string, score: number, evalComment?: string) => {
    const targetPatient = allPatients.find(p => p.id === pid);
    const clinicalRecord = clinicalRecords.find(r => r.patientId === pid);
    const isKid = (targetPatient?.age !== undefined && targetPatient.age <= 12) || clinicalRecord?.anamnesisData?.formType === 'child';
    
    // Find the skill to get its maxScore
    let skillMaxScore = 1;
    protocols.forEach(p => {
      p.data.forEach((domain: any) => {
        const skill = domain.skills.find((s: any) => s.name === title);
        if (skill) skillMaxScore = skill.maxScore || 1;
      });
    });

    // Normalize score for kids if it's not already 0, 0.5 or 1
    let finalScore = score;
    if (isKid && skillMaxScore === 1 && ![0, 0.5, 1].includes(score)) {
      if (score >= 3) finalScore = 1;
      else if (score >= 1.5) finalScore = 0.5;
      else finalScore = 0;
    }

    const newId = Date.now();
    const newHistoryItem = {
      id: newId,
      patientId: pid,
      type: 'task',
      title: title,
      time: new Date().toLocaleTimeString(),
      score: finalScore,
      evalComment: evalComment || "",
      dateGroup: "Hoje",
      icon: "🎯"
    };
    
    // Add a note about the trial
    const noteText = `🎯 NOVO REGISTRO\nAtividade: ${title}\nPontuação: ${score}${evalComment ? `\nAnotações do Profissional: ${evalComment}` : ""}`;
    handleAddNote(pid, noteText, 'private', 'Sessão');

    onAddActivityLog("Registro de Avaliação", `Avaliação da habilidade "${title}" registrada para o paciente ID ${pid}. Pontuação: ${score}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.addHistoryItem({
      patient_id: String(pid),
      patient_email: targetPatient?.email || null,
      type: 'task',
      title: title,
      score: finalScore,
      note: evalComment || "",
      icon: "🎯"
    });

    setHistory(prev => {
      const updatedHistory = [newHistoryItem, ...prev];
      
      // Regra de Maestria para Kids: 5 vezes consecutivas nota 1.0
      const targetPatient = allPatients.find(p => p.id === pid);
      const clinicalRecord = clinicalRecords.find(r => r.patientId === pid);
      const isKid = (targetPatient?.age !== undefined && targetPatient.age <= 12) || clinicalRecord?.anamnesisData?.formType === 'child';

      if (isKid) {
        const peiGoal = clinicalRecord?.pei?.find((g: any) => g.name === title);
        
        // Filtra o histórico deste paciente para esta habilidade específica
        // Considera apenas registros feitos APÓS a criação da meta no PEI
        const skillHistory = updatedHistory
          .filter(h => h.patientId === pid && h.title === title && h.type === 'task' && (!peiGoal || h.id > peiGoal.id))
          .sort((a, b) => b.id - a.id);

        let consecutiveCount = 0;
        for (const h of skillHistory) {
          if (h.score === 1) consecutiveCount++;
          else break;
        }

        const progress = Math.min(consecutiveCount * 20, 100);
        const isMastered = progress === 100;

        // Atualiza o status no PEI do paciente
        setAllPatients(allPrev => allPrev.map(p => {
          if (p.id === pid && p.pei) {
            const updatedPei = p.pei.map((goal: any) => {
              if (goal.name === title) {
                return { 
                  ...goal, 
                  status: isMastered ? 'completed' : 'in_progress', 
                  progress: progress 
                };
              }
              return goal;
            });
            return { ...p, pei: updatedPei };
          }
          return p;
        }));

        if (isMastered && peiGoal?.status !== 'completed') {
          // Adiciona uma nota automática sobre a conquista
          handleAddNote(pid, `🏆 CRITÉRIO DE MAESTRIA ATINGIDO!\nA habilidade "${title}" foi realizada de forma independente por 5 vezes consecutivas. Status atualizado para Adquirida.`, 'private', 'Maestria');
        }
      } else {
        // Para pacientes adultos, se registrar um treino, marca como em progresso
        setAllPatients(allPrev => allPrev.map(p => {
          if (p.id === pid && p.pei) {
            const updatedPei = p.pei.map((goal: any) => {
              if (goal.name === title && goal.status === 'not_started') {
                return { ...goal, status: 'in_progress' };
              }
              return goal;
            });
            return { ...p, pei: updatedPei };
          }
          return p;
        }));
      }
      
      return updatedHistory;
    });

    return newId;
  };

  const handleDeleteHistoryItem = (id: any) => {
    const item = history.find(h => h.id === id);
    setHistory(prev => prev.filter(h => h.id !== id));
    onAddActivityLog("Exclusão de Registro", `Registro de atividade "${item?.title}" (ID ${id}) excluído do histórico.`, 'system');
  };
  
  useEffect(() => { 
    (window as any).handleToggleNoteTypeApp = (id: any, targetVisibility: string) => {
      setTherapistNotes(prev => {
        const noteIndex = prev.findIndex(n => n.id === id);
        if (noteIndex === -1) return prev;
        const note = prev[noteIndex];

        // If trying to remove a copy
        if ((note.visibility === targetVisibility || note.type === targetVisibility) && note.originalId) {
          const newNotes = prev.filter(n => n.id !== id);
          return newNotes.map(n => {
            if (n.id === note.originalId) {
              if (targetVisibility === 'patient' || targetVisibility === 'shared') return { ...n, hasSharedCopy: false };
              if (targetVisibility === 'professional') return { ...n, hasProfessionalCopy: false };
            }
            return n;
          });
        }
        
        // If trying to create a copy
        const copyKey = (targetVisibility === 'patient' || targetVisibility === 'shared') ? 'hasSharedCopy' : 'hasProfessionalCopy';
        if (note[copyKey]) {
          // Remove existing copy
          const copy = prev.find(n => n.originalId === id && (n.visibility === targetVisibility || n.type === targetVisibility));
          let newNotes = prev;
          if (copy) {
            newNotes = prev.filter(n => n.id !== copy.id);
          }
          return newNotes.map(n => n.id === id ? { ...n, [copyKey]: false } : n);
        }

        // Create new copy
        const newCopy = {
          ...note,
          id: Date.now() + Math.random(),
          visibility: targetVisibility,
          type: targetVisibility, // Keep type for legacy compatibility
          originalId: id,
          hasSharedCopy: false,
          hasProfessionalCopy: false
        };
        
        // Sync copy to Backend
        (async () => {
          const { dataService } = await import('./services/dataService');
          const patient = allPatients.find(p => p.id === note.patientId);
          await dataService.addNote({
            patient_id: String(note.patientId),
            patient_email: patient?.email || null,
            text: note.text,
            visibility: targetVisibility,
            subject: note.subject || "Geral",
            original_id: String(id)
          });
        })();

        return prev.map(n => n.id === id ? { ...n, [copyKey]: true } : n).concat(newCopy);
      });
    };
  }, [allPatients]);

  const handleAddFamilyNote = async (pid: any, txt: string, image?: string) => {
    const noteText = `🏠 REGISTRO DA FAMÍLIA\n${txt}`;
    handleAddNote(pid, noteText, 'family', 'Família');
    
    const newHistoryItem = {
      id: Date.now(),
      patientId: pid,
      type: image ? 'photo' : 'family_note',
      title: image ? "Foto enviada" : "Registro da Família",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      note: txt,
      image: image,
      icon: image ? "📸" : "🏠",
      dateGroup: "Hoje",
      date: new Date().toISOString()
    };

    // Also add to history timeline
    setHistory(prev => [newHistoryItem, ...prev]);

    onAddActivityLog("Registro da Família", `Nova anotação da família adicionada para o paciente ID ${pid}.`);

    // Sync to Backend
    const { dataService } = await import('./services/dataService');
    await dataService.addHistoryItem({
      patient_id: String(pid),
      type: image ? 'photo' : 'family_note',
      title: image ? "Foto enviada" : "Registro da Família",
      note: txt,
      image: image,
      icon: image ? "📸" : "🏠"
    });
  };

  const handleLogout = async () => {
    onAddActivityLog("Logout do Sistema", "O profissional encerrou a sessão com segurança.", "system");
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      const supabase = await getSupabase();
      if (supabase) await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
    setUser(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4318FF]"></div>
      </div>
    );
  }

  return (
    <React.Fragment>
      <GlobalStyles />
      
      {!user ? (
        <LandingPage onLogin={handleLoginSuccess} />
      ) : user.subscriptionStatus === 'pending' ? (
        <SubscriptionRequired user={user} onLogout={handleLogout} />
      ) : user.role === 'patient' ? (
        <PatientDashboard user={user} onLogout={handleLogout} onMoodCheckin={handleMoodCheckin} tasks={tasks.filter(t => t.patientId === user.id)} onCompleteTask={handleCompleteTask} history={history.filter(h => h.patientId === user.id)} energyTags={ENERGY_TAGS} sharedNotes={therapistNotes.filter(n => n.patientId === user.id && n.type === 'shared')} protocols={protocols} onAddFamilyNote={handleAddFamilyNote} />
      ) : user.role === 'admin' ? (
        <AdminDashboard onLogout={handleLogout} />
      ) : view === 'team' && user.role === 'coordinator' ? (
        <div className="min-h-screen bg-slate-50 flex">
          {/* Sidebar for Team View */}
          <div className="w-64 bg-white border-r border-slate-100 hidden lg:flex flex-col p-6 sticky top-0 h-screen">
            <div className="flex items-center gap-3 mb-10 px-2">
              <div className="w-10 h-10 bg-[#4318FF] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Database size={20} />
              </div>
              <span className="font-bold text-xl text-slate-900 tracking-tight">Verto</span>
            </div>

            <nav className="space-y-2 flex-1">
              <button 
                onClick={() => setView('dashboard')}
                className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-slate-900 hover:bg-slate-50 rounded-2xl transition-all font-medium text-sm"
              >
                <LayoutDashboard size={20} />
                Painel Principal
              </button>
              <button 
                className="w-full flex items-center gap-3 px-4 py-3 text-[#4318FF] bg-blue-50 rounded-2xl transition-all font-bold text-sm"
              >
                <Users size={20} />
                Gestão da Equipe
              </button>
            </nav>

            <button 
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all font-medium text-sm"
            >
              <Lock size={20} />
              Sair
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <TeamManagement user={user} />
          </div>
        </div>
      ) : (
        <TherapistDashboard 
          user={{...user, profilePicture, crp}} 
          onLogout={handleLogout} 
          onViewTeam={() => setView('team')}
          therapistAgenda={therapistAgenda} 
          patientsHistory={history} 
          therapistNotes={therapistNotes} 
          onAddNote={handleAddNote} 
          protocols={protocols} 
          setProtocols={setProtocols} 
          allTasks={tasks} 
          onAddTask={handleAddTask} 
          onUpdateHistoryItem={handleUpdateHistoryItem} 
          onAddPatient={handleAddPatient} 
          onUpdateTask={handleUpdateTask} 
          allPatients={allPatients} 
          clinicalRecords={clinicalRecords}
          onScheduleSession={handleScheduleSession} 
          onUpdatePatient={handleUpdatePatient} 
          onRecordTrial={handleRecordTrial} 
          onDeleteHistoryItem={handleDeleteHistoryItem} 
          onUpdateAgendaStatus={handleUpdateAgendaStatus}
          activityLogs={activityLogs} 
          onAddActivityLog={onAddActivityLog} 
          rooms={rooms}
          setRooms={setRooms}
          roomReservations={roomReservations}
          setRoomReservations={setRoomReservations}
          specialtySettings={specialtySettings}
          setSpecialtySettings={setSpecialtySettings}
          onUpdateProfile={(data: any) => {
            if (data.profilePicture !== undefined) setProfilePicture(data.profilePicture);
            if (data.crp !== undefined) setCrp(data.crp);
          }}
        />
      )}

      {showInvitationModal && (
        <InvitationModal 
          user={user} 
          onClose={() => setShowInvitationModal(false)} 
        />
      )}
    </React.Fragment>
  );
}
