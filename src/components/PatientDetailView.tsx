import React, { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, MessageCircle, FileText, SlidersHorizontal, ChevronDown, Calendar, FileOutput, Download, EyeOff, Share2, Eye, Edit, X, UploadCloud, FileUp, File, Trash2, Activity, Search, Plus, Filter, Target, Zap, Info, BarChart2, CheckCircle2, RotateCcw } from 'lucide-react';
import { TutorialOverlay } from './Tutorial';
import { AnamnesisModal } from './Anamnesis';
import { ComparisonBarChart, EvolutionLineChart } from './Charts';
import { HistoryCard } from './History';
import { SessionMode } from './SessionMode';
import { ENERGY_TAGS } from './Common';

export const PatientDetailView = ({ patient, onBack, history, notes, onAddNote, protocols, setProtocols, onAddTask, patientTasks, onToggleNoteType, onEvaluateHistoryItem, onUpdateTask, isTutorialActive, tutorialStep, setTutorialStep, onUpdatePatient, onRecordTrial, onDeleteHistoryItem }: any) => { 
  const [activeTab, setActiveTab] = useState('history'); 
  const [newNote, setNewNote] = useState(""); 
  const [noteMode, setNoteMode] = useState('private'); 
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSubjectFilter, setNoteSubjectFilter] = useState("");
  const [noteDateFilter, setNoteDateFilter] = useState("");
  const [newNoteSubject, setNewNoteSubject] = useState("");
  const [showNoteFilters, setShowNoteFilters] = useState(false);
  const [showAnamnesis, setShowAnamnesis] = useState(false); 
  const [reportPeriod, setReportPeriod] = useState('monthly');
  const [comparisonDate1, setComparisonDate1] = useState('');
  const [comparisonDate2, setComparisonDate2] = useState('');
  const [selectedReportNotes, setSelectedReportNotes] = useState<number[]>([]);
  const [planType, setPlanType] = useState('task'); 
  const [isCreatingNewTask, setIsCreatingNewTask] = useState(false); 
  const [filterAge, setFilterAge] = useState(""); 
  const [filterType, setFilterType] = useState(""); 
  const [filterDomain, setFilterDomain] = useState(""); 
  const [selectedProtocolId, setSelectedProtocolId] = useState(''); 
  const [selectedDomainId, setSelectedDomainId] = useState(''); 
  const [selectedSkillId, setSelectedSkillId] = useState(''); 
  const [newTaskName, setNewTaskName] = useState(''); 
  const [newTaskCode, setNewTaskCode] = useState(''); 
  const [newTaskMaxScore, setNewTaskMaxScore] = useState(2); 
  const [newTaskObjective, setNewTaskObjective] = useState(''); 
  const [newTaskExample, setNewTaskExample] = useState(''); 
  const [newTaskCriteria, setNewTaskCriteria] = useState(''); 
  const [newTaskComment, setNewTaskComment] = useState(''); 
  const [addToProtocolMode, setAddToProtocolMode] = useState('existing'); 
  const [targetProtocolId, setTargetProtocolId] = useState(''); 
  const [targetDomainId, setTargetDomainId] = useState(''); 
  const [newProtocolName, setNewProtocolName] = useState(''); 
  const [newDomainName, setNewDomainName] = useState(''); 
  const [message, setMessage] = useState(''); 
  const [scheduleDate, setScheduleDate] = useState(''); 
  const [scheduleTime, setScheduleTime] = useState(''); 
  const [finalTaskTitle, setFinalTaskTitle] = useState(""); 
  const [finalTaskSubtitle, setFinalTaskSubtitle] = useState(""); 
  const [isCustomizationOpen, setIsCustomizationOpen] = useState(false); 
  const [isDailyReminder, setIsDailyReminder] = useState(false);
  const [linkedTask, setLinkedTask] = useState("");
  const [linkedInterventionProtocolId, setLinkedInterventionProtocolId] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false); 
  const [editingTask, setEditingTask] = useState<any>(null); 
  const [isPlanFilterOpen, setIsPlanFilterOpen] = useState(false);
  const [isAddingPEIGoal, setIsAddingPEIGoal] = useState(false);
  const [selectedPEIProtocolId, setSelectedPEIProtocolId] = useState("");
  const [selectedPEIDomainId, setSelectedPEIDomainId] = useState("");
  const [selectedPEISkillId, setSelectedPEISkillId] = useState("");
  const [isSessionModeOpen, setIsSessionModeOpen] = useState(false);
  const [isUnlinkingModalOpen, setIsUnlinkingModalOpen] = useState(false);
  
  const [patientFiles, setPatientFiles] = useState([
    { id: 1, name: 'Avaliação_Neuropsicológica.pdf', size: '2.4 MB', date: '15/01/2026', type: 'application/pdf' },
    { id: 2, name: 'Exame_EEG_Resultado.jpg', size: '840 KB', date: '20/01/2026', type: 'image/jpeg' }
  ]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lastRecordedTrialId, setLastRecordedTrialId] = useState<any>(null);
  const [lastRecordedGoalId, setLastRecordedGoalId] = useState<any>(null);
  const [pendingTrial, setPendingTrial] = useState<any>(null);
  const [showTrialConfirmation, setShowTrialConfirmation] = useState(false);
  const [trialObservation, setTrialObservation] = useState("");
  const [isSavingObservation, setIsSavingObservation] = useState(false);

  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");

  const [selectedChartProtocolId, setSelectedChartProtocolId] = useState(() => {
    const isKid = (patient.age !== undefined && patient.age <= 12) || patient.anamnesisData?.formType === 'child';
    if (isKid) {
      const vbmapp = protocols.find((p: any) => p.title.includes('VB-MAPP'));
      if (vbmapp) return vbmapp.id;
    }
    return protocols[0]?.id || '';
  });
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("all");

  const availableSnapshots = useMemo(() => {
    const dates = history
      .filter((h: any) => h.patientId === patient.id && h.type === 'task' && h.score !== undefined)
      .map((h: any) => h.dateGroup);
    return Array.from(new Set(dates));
  }, [history, patient.id]);

  const patientCategory = useMemo(() => {
     if (patient.anamnesisData?.formType) {
        return patient.anamnesisData.formType === 'child' ? 'Kids' : 'Adulto';
     }
     return (patient.age !== undefined && patient.age <= 12) ? 'Kids' : 'Adulto';
  }, [patient]);

  const evaluationSkills = useMemo(() => {
    const skills: any[] = [];
    protocols.filter((p: any) => p.category === 'evaluation' || !p.category).forEach((p: any) => {
      p.data.forEach((domain: any) => {
        domain.skills.forEach((skill: any) => {
          skills.push({ id: skill.id, name: skill.name, protocol: p.title });
        });
      });
    });
    
    // Sort: Linked skills first
    return skills.sort((a, b) => {
      const aLinked = (patient.evaluationLinks && patient.evaluationLinks[a.name]) || (patient.interventionTaskLinks && patient.interventionTaskLinks[a.name]);
      const bLinked = (patient.evaluationLinks && patient.evaluationLinks[b.name]) || (patient.interventionTaskLinks && patient.interventionTaskLinks[b.name]);
      
      if (aLinked && !bLinked) return -1;
      if (!aLinked && bLinked) return 1;
      return 0;
    });
  }, [protocols, patient.evaluationLinks, patient.interventionTaskLinks]);

  const selectedProtocolMaxScore = useMemo(() => {
    const proto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!proto) return 1;
    let max = 1;
    proto.data.forEach((domain: any) => {
      domain.skills.forEach((skill: any) => {
        if (skill.maxScore > max) max = skill.maxScore;
      });
    });
    return max;
  }, [protocols, selectedChartProtocolId]);

  const radarChartData = useMemo(() => {
    const selectedProto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!selectedProto) return { labels: [], datasets: [] };

    const labels = selectedProto.data.map((d: any) => d.name);
    
    const latestHistory = history.filter((h: any) => h.patientId === patient.id && h.type === 'task' && h.score !== undefined);
    const currentData = selectedProto.data.map((domain: any) => {
      const skillNames = domain.skills.map((s: any) => s.name.trim().toLowerCase());
      const useMasteryLogic = selectedProto.title.includes('VB-MAPP');
      
      const skillLatestScoreMap: any = {};
      const skillLatestIdMap: any = {};
      const skillScoresMap: any = {};
      
      latestHistory.forEach((evalItem: any) => {
        const title = evalItem.title.trim().toLowerCase();
        if (skillNames.includes(title)) {
          if (useMasteryLogic) {
            // Logic for VB-MAPP: Latest score / Mastery
            if (!skillLatestIdMap[title] || evalItem.id > skillLatestIdMap[title]) {
              skillLatestIdMap[title] = evalItem.id;
              
              // Check if mastered in PEI first
              const peiGoal = patient.pei?.find((g: any) => g.name.trim().toLowerCase() === title);
              if (peiGoal?.status === 'completed') {
                skillLatestScoreMap[title] = 1;
              } else {
                skillLatestScoreMap[title] = evalItem.score;
              }
            }
          } else {
            // Logic for AFLS and others: Averages
            if (!skillScoresMap[title]) skillScoresMap[title] = [];
            skillScoresMap[title].push(evalItem.score);
          }
        }
      });

      if (useMasteryLogic) {
        const latestScores: any[] = Object.values(skillLatestScoreMap);
        return latestScores.length > 0 ? (latestScores.reduce((a: any, b: any) => a + b, 0) / latestScores.length) : 0;
      } else {
        const skillAverages = Object.values(skillScoresMap).map((scores: any) => 
          scores.reduce((a: any, b: any) => a + b, 0) / scores.length
        );
        return skillAverages.length > 0 ? (skillAverages.reduce((a: any, b: any) => a + b, 0) / skillAverages.length) : 0;
      }
    });

    const datasets = [];

    if (selectedSnapshotDate === "all") {
      datasets.push({
        label: 'Desempenho Geral Atual',
        data: currentData,
        backgroundColor: 'rgba(67, 24, 255, 0.25)',
        borderColor: '#4318FF',
        pointBackgroundColor: '#4318FF',
        borderWidth: 4
      });
    } else {
      const dayHistory = history.filter((h: any) => 
        h.patientId === patient.id && 
        h.type === 'task' && 
        h.score !== undefined && 
        h.dateGroup === selectedSnapshotDate
      );
      const historicalData = selectedProto.data.map((domain: any) => {
        const skillNames = domain.skills.map((s: any) => s.name.trim().toLowerCase());
        const useMasteryLogic = selectedProto.title.includes('VB-MAPP');
        const skillLatestScoreMap: any = {};
        const skillLatestIdMap: any = {};
        const skillScoresMap: any = {};
        
        dayHistory.forEach((h: any) => {
          const title = h.title.trim().toLowerCase();
          if (skillNames.includes(title)) {
            if (useMasteryLogic) {
              if (!skillLatestIdMap[title] || h.id > skillLatestIdMap[title]) {
                skillLatestIdMap[title] = h.id;
                skillLatestScoreMap[title] = h.score;
              }
            } else {
              if (!skillScoresMap[title]) skillScoresMap[title] = [];
              skillScoresMap[title].push(h.score);
            }
          }
        });

        if (useMasteryLogic) {
          const latestScores: any[] = Object.values(skillLatestScoreMap);
          return latestScores.length > 0 ? (latestScores.reduce((a: any, b: any) => a + b, 0) / latestScores.length) : 0;
        } else {
          const skillAverages = Object.values(skillScoresMap).map((scores: any) => 
            scores.reduce((a: any, b: any) => a + b, 0) / scores.length
          );
          return skillAverages.length > 0 ? (skillAverages.reduce((a: any, b: any) => a + b, 0) / skillAverages.length) : 0;
        }
      });

      datasets.push({
        label: `Avaliação em ${selectedSnapshotDate}`,
        data: historicalData,
        backgroundColor: 'rgba(5, 205, 153, 0.35)', 
        borderColor: '#05CD99',
        pointBackgroundColor: '#05CD99',
        borderWidth: 4
      });

      datasets.push({
        label: 'Referência (Média Atual)',
        data: currentData,
        backgroundColor: 'rgba(67, 24, 255, 0.03)',
        borderColor: 'rgba(67, 24, 255, 0.25)',
        borderDash: [8, 4],
        pointRadius: 0,
        borderWidth: 2
      });
    }

    return { labels, datasets };
  }, [history, protocols, patient.id, selectedChartProtocolId, selectedSnapshotDate]);

  const safeProtocols = protocols || []; 
  const filteredProtocols = useMemo(() => { 
    return safeProtocols.filter((p: any) => { 
      const matchAge = filterAge ? (p.ageGroup === filterAge || p.ageGroup === 'all') : true; 
      const matchType = filterType ? p.type === filterType : true; 
      const matchDomain = filterDomain ? (p.domain && p.domain.toLowerCase().includes(filterDomain.toLowerCase())) : true; 
      return matchAge && matchType && matchDomain; 
    }); 
  }, [safeProtocols, filterAge, filterType, filterDomain]); 

  const selectedProtocol = safeProtocols.find((p: any) => String(p.id) === String(selectedProtocolId)); 
  const selectedDomain = selectedProtocol?.data.find((d: any) => String(d.id) === String(selectedDomainId)); 
  const targetProtocol = safeProtocols.find((p: any) => String(p.id) === String(targetProtocolId)); 
  const targetDomain = targetProtocol?.data.find((d: any) => String(d.id) === String(targetDomainId)); 

  useEffect(() => { 
    if (!isCreatingNewTask && selectedSkillId && selectedDomain) { 
      const skill = selectedDomain.skills.find((s: any) => String(s.id) === String(selectedSkillId)); 
      if (skill) { setFinalTaskTitle(skill.name); setFinalTaskSubtitle(skill.objective || ""); } 
    } 
  }, [selectedSkillId, selectedDomain, isCreatingNewTask]); 

  useEffect(() => { 
    if (isCreatingNewTask) { setFinalTaskTitle(newTaskName); setFinalTaskSubtitle(newTaskObjective); } 
  }, [newTaskName, newTaskObjective, isCreatingNewTask]); 

  const groupedHistory = history.reduce((groups: any, item: any) => { const group = groups[item.dateGroup] || []; group.push(item); groups[item.dateGroup] = group; return groups; }, {}); 
  const sortedDateKeys = Object.keys(groupedHistory).sort((a, b) => { if (a === "Hoje") return -1; if (b === "Hoje") return 1; if (a === "Ontem") return -1; if (b === "Ontem") return 1; return b.localeCompare(a); }); 
  
  const filteredNotes = useMemo(() => {
    return notes.filter((n: any) => {
      const matchPatient = n.patientId === patient.id;
      const matchVisibility = (n.visibility || n.type || 'private') === noteMode;
      
      const searchLower = noteSearchQuery.toLowerCase();
      const matchSearch = !noteSearchQuery || 
        n.text.toLowerCase().includes(searchLower) || 
        (n.subject && n.subject.toLowerCase().includes(searchLower));
        
      const matchSubject = !noteSubjectFilter || (n.subject && n.subject.toLowerCase().includes(noteSubjectFilter.toLowerCase()));
      
      // Date format in notes is "DD/MM/YYYY • HH:mm"
      // noteDateFilter is "YYYY-MM-DD"
      let matchDate = true;
      if (noteDateFilter) {
        const [y, m, d] = noteDateFilter.split('-');
        const formattedFilterDate = `${d}/${m}/${y}`;
        matchDate = n.date.startsWith(formattedFilterDate);
      }
      
      return matchPatient && matchVisibility && matchSearch && matchSubject && matchDate;
    });
  }, [notes, patient.id, noteMode, noteSearchQuery, noteSubjectFilter, noteDateFilter]);
  
  const handleAddNoteWithSubject = () => {
    if (newNote.trim()) {
      onAddNote(patient.id, newNote, noteMode, newNoteSubject);
      setNewNote("");
      setNewNoteSubject("");
    }
  };

  const comparisonChartData = useMemo(() => {
    const selectedProto = protocols.find((p: any) => String(p.id) === String(selectedChartProtocolId));
    if (!selectedProto) return [];

    if (!comparisonDate1 || !comparisonDate2) {
      // Return stable mock data if dates are not selected
      return selectedProto.data.map((domain: any, idx: number) => ({
        name: domain.name,
        "Período A": idx % 2 === 0 ? 1 : 0,
        "Período B": idx % 2 === 0 ? 2 : 1
      }));
    }

    const getDomainScoresForDate = (date: string) => {
      const dateHistory = history.filter((h: any) => (h.dateGroup === date || h.date === date) && h.patientId === patient.id && h.score !== undefined);
      
      return selectedProto.data.map((domain: any) => {
        const skillLatestScoreMap: any = {};
        const domainSkillNames = domain.skills.map((s: any) => s.name.trim().toLowerCase());
        
        dateHistory.forEach((h: any) => {
          const hTitle = h.title.trim().toLowerCase();
          if (domainSkillNames.includes(hTitle)) {
            // Find the original skill name to use as key
            const skill = domain.skills.find((s: any) => s.name.trim().toLowerCase() === hTitle);
            if (skill) {
              skillLatestScoreMap[skill.name] = h.score;
            }
          }
        });

        const scores = Object.values(skillLatestScoreMap) as number[];
        if (scores.length === 0) return 0;
        const sum = scores.reduce((a, b) => a + b, 0);
        return parseFloat((sum / scores.length).toFixed(2));
      });
    };

    // Sort dates to ensure older is comparisonDate1 (left) and newer is comparisonDate2 (right)
    const dates = [comparisonDate1, comparisonDate2].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const d1 = dates[0];
    const d2 = dates[1];

    const scores1 = getDomainScoresForDate(d1);
    const scores2 = getDomainScoresForDate(d2);

    const data = selectedProto.data.map((domain: any, idx: number) => ({
      name: domain.name,
      [d1]: scores1[idx] || 0,
      [d2]: scores2[idx] || 0
    }));

    return data;
  }, [history, protocols, selectedChartProtocolId, patient.id, comparisonDate1, comparisonDate2]);

  const toggleReportNote = (id: number) => {
    setSelectedReportNotes(prev => 
      prev.includes(id) ? prev.filter(nId => nId !== id) : [...prev, id]
    );
  };
  
  const handleSchedule = () => { 
    if (!scheduleDate || !scheduleTime) { alert("Selecione data e hora."); return; } 
    let scheduledAt; try { scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString(); } catch (e) { alert("Data inválida"); return; } 
    if (planType === 'task' || planType === 'intervention') { 
      const taskPayload = { 
        id: Date.now() + (isCreatingNewTask ? 1 : 0), 
        patientId: patient.id, 
        title: finalTaskTitle || newTaskName, 
        icon: planType === 'intervention' ? "✍️" : "📋", 
        color: planType === 'intervention' ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600", 
        completed: false, 
        type: planType, 
        scheduledAt: scheduledAt, 
        description: finalTaskSubtitle,
        isDailyReminder: planType === 'intervention' ? isDailyReminder : false,
        linkedTask: planType === 'intervention' ? linkedTask : undefined,
        linkedProtocolId: planType === 'task' ? linkedInterventionProtocolId : undefined
      }; 
      if (planType === 'task' && linkedInterventionProtocolId) {
        const updatedPatient = {
          ...patient,
          evaluationLinks: {
            ...(patient.evaluationLinks || {}),
            [finalTaskTitle || newTaskName]: linkedInterventionProtocolId
          }
        };
        onUpdatePatient(updatedPatient);
      }
      if (planType === 'intervention' && linkedTask) {
        const updatedPatient = {
          ...patient,
          interventionTaskLinks: {
            ...(patient.interventionTaskLinks || {}),
            [linkedTask]: finalTaskTitle || newTaskName
          }
        };
        onUpdatePatient(updatedPatient);
      }
      if (isCreatingNewTask) { 
        if (!newTaskName) { alert("Digite o nome da tarefa."); return; } 
        let finalSkill = { id: Date.now(), name: newTaskName, code: newTaskCode, maxScore: parseInt(newTaskMaxScore as any), objective: newTaskObjective, example: newTaskExample, criteria: newTaskCriteria, comment: newTaskComment }; 
        if (addToProtocolMode === 'existing') { 
          if (!targetProtocolId || !targetDomainId) { alert("Selecione onde salvar a tarefa."); return; } 
          const updatedProtocols = protocols.map((p: any) => { 
            if (p.id && String(p.id) === targetProtocolId) { 
              const updatedData = p.data.map((d: any) => { 
                if (d.id && String(d.id) === targetDomainId) { 
                  return { ...d, skills: [...d.skills, finalSkill] }; 
                } 
                return d; 
              }); 
              return { ...p, data: updatedData }; 
            } 
            return p; 
          }); 
          setProtocols(updatedProtocols); 
        } else { 
          if (!newProtocolName || !newDomainName) { alert("Preencha os dados do novo protocolo."); return; } 
          const newProtocol = { id: Date.now(), title: newProtocolName, data: [{ id: `dom-${Date.now()}`, name: newDomainName, skills: [finalSkill] }] }; 
          setProtocols([...protocols, newProtocol]); 
        } 
      } else { if (!selectedSkillId) { alert("Selecione uma tarefa."); return; } } 
      onAddTask(taskPayload); 
    } else { 
      if (!message) { alert("Escreva uma mensagem."); return; } 
      onAddTask({ id: Date.now(), patientId: patient.id, title: "Reforço Positivo", icon: "🌟", color: "bg-yellow-100 text-yellow-600", completed: false, type: 'reinforcement', scheduledAt: scheduledAt, description: message }); 
    } 
    setShowConfirmation(true); setMessage(''); setNewTaskName(''); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setNewProtocolName(''); setNewDomainName(''); setNewTaskCode(''); setNewTaskObjective(''); setNewTaskExample(''); setNewTaskCriteria(''); setNewTaskComment(''); setSelectedProtocolId(''); setSelectedDomainId(''); setSelectedSkillId(''); setLinkedTask(''); setLinkedInterventionProtocolId('');
  }; 

  const isFormValid = () => { 
    if (planType === 'task' || planType === 'intervention') { 
      if (isCreatingNewTask) return newTaskName && scheduleDate && scheduleTime; 
      return selectedSkillId && scheduleDate && scheduleTime; 
    } 
    return message && scheduleDate && scheduleTime; 
  }; 
  const handleSaveTaskEdit = () => { if (editingTask && editingTask.title) { onUpdateTask(editingTask.id, { title: editingTask.title, description: editingTask.description }); setEditingTask(null); } }; 
  const handleUpdateAnamnesis = (updatedData: any) => { if (onUpdatePatient) { onUpdatePatient({ id: patient.id, name: updatedData.nome, phone: updatedData.telefone, address: updatedData.endereco, diagnosis: updatedData.motivoConsulta, anamnesisData: updatedData }); } }; 
  
  const handleUnlinkPatient = () => {
    if (onUpdatePatient) {
      // When unlinking, we keep the history but remove the clinic association
      onUpdatePatient({ 
        id: patient.id, 
        clinic_id: null, 
        status: 'unlinked',
        unlinkedAt: new Date().toISOString()
      });
      setIsUnlinkingModalOpen(false);
      onBack(); // Go back to dashboard
    }
  };
  
  const handleFileUpload = (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploadingFile(true);
    setUploadProgress(0);
    
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setUploadProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          const newFile = {
            id: Date.now(),
            name: file.name,
            size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
            date: new Date().toLocaleDateString('pt-BR'),
            type: file.type
          };
          setPatientFiles((prev: any) => [newFile, ...prev]);
          setIsUploadingFile(false);
        }, 500);
      }
    }, 150);
  };

  const handleRecordTrialWithConfirmation = (pid: any, goalId: any, title: string, score: number) => {
    setPendingTrial({ pid, goalId, title, score });
    setLastRecordedGoalId(goalId);
    setTrialObservation("");
    setShowTrialConfirmation(true);
  };

  const handleUndoTrial = () => {
    setShowTrialConfirmation(false);
    setLastRecordedGoalId(null);
    setPendingTrial(null);
  };

  const handleSaveTrialObservation = () => {
    if (pendingTrial) {
      setIsSavingObservation(true);
      const newId = onRecordTrial(pendingTrial.pid, pendingTrial.title, pendingTrial.score, trialObservation);
      setLastRecordedTrialId(newId);
      
      setTimeout(() => {
        setIsSavingObservation(false);
        setShowTrialConfirmation(false);
        setLastRecordedGoalId(null);
        setPendingTrial(null);
      }, 500);
    } else {
      setShowTrialConfirmation(false);
      setLastRecordedGoalId(null);
    }
  };

  const removeFile = (id: any) => {
      if (confirm("Deseja remover este arquivo?")) {
          setPatientFiles((prev: any) => prev.filter((f: any) => f.id !== id));
      }
  };

  const handleDownloadReport = () => {
    if (!reportStartDate || !reportEndDate) {
      alert("Selecione o período para gerar o relatório.");
      return;
    }
    const start = new Date(reportStartDate);
    const end = new Date(reportEndDate);
    
    const reportData = notes.filter((n: any) => {
      if (n.patientId !== patient.id) return false;
      const parts = n.date.split(' ')[0].split('/');
      const noteDate = new Date(parts[2], parts[1]-1, parts[0]);
      return noteDate >= start && noteDate <= end;
    });

    if (reportData.length === 0) {
      alert("Nenhum registro encontrado no período selecionado.");
      return;
    }

    let csvContent = "Data,Tipo,Anotacao\n";
    reportData.forEach((n: any) => {
      csvContent += `"${n.date}","${(n.visibility === 'patient' || n.type === 'shared') ? 'Paciente' : (n.visibility === 'professional' || n.type === 'professional') ? 'Profissional' : 'Privada'}","${n.text.replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Relatorio_Evolucao_${patient.name}_${reportStartDate}_a_${reportEndDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getMasteryProgress = (skillName: string) => {
    if (patientCategory !== 'Kids') return null;
    const goal = patient.pei?.find((g: any) => g.name === skillName);
    const skillHistory = history
      .filter((h: any) => h.patientId === patient.id && h.title === skillName && h.type === 'task' && (!goal || h.id > goal.id))
      .sort((a: any, b: any) => b.id - a.id);
    
    let count = 0;
    for (const h of skillHistory) {
      if (h.score === 1) count++;
      else break;
    }
    return Math.min(count, 5);
  };

  const MasteryDots = ({ count, status }: { count: number, status?: string }) => {
    if (status === 'completed') {
      return (
        <div className="flex gap-1 items-center">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-green-500 shadow-sm shadow-green-200"></div>
          ))}
          <CheckCircle2 size={12} className="text-green-500 ml-1" />
        </div>
      );
    }
    return (
      <div className="flex gap-1 items-center">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`w-2 h-2 rounded-full transition-all ${i <= count ? 'bg-[#4318FF] scale-110 shadow-sm shadow-blue-200' : 'bg-gray-200'}`}></div>
        ))}
        <span className="text-[9px] font-semibold text-gray-400 ml-1 uppercase">{count}/5</span>
      </div>
    );
  };

  useEffect(() => {
    if (isTutorialActive) {
      if (tutorialStep >= 6) setActiveTab('plan');
      else if (tutorialStep >= 0) setActiveTab('history');
    }
  }, [isTutorialActive, tutorialStep]);

  useEffect(() => {
    if (isTutorialActive) {
      if (tutorialStep >= 19) setActiveTab('files');
      else if (tutorialStep >= 17) setActiveTab('session');
      else if (tutorialStep >= 14) setActiveTab('plan');
      else if (tutorialStep >= 11) setActiveTab('report');
      else if (tutorialStep >= 7) setActiveTab('notes');
      else if (tutorialStep >= 0) setActiveTab('history');
    }
  }, [isTutorialActive, tutorialStep]);

  return ( 
    <div className="min-h-screen bg-gray-50 flex flex-col animate-slide-up relative overflow-y-auto"> 
      {isSessionModeOpen && (
        <SessionMode 
          patient={{ ...patient, history: history.filter((h: any) => h.patientId === patient.id) }} 
          onClose={() => setIsSessionModeOpen(false)} 
          onRecordTrial={onRecordTrial} 
          onDeleteHistoryItem={onDeleteHistoryItem}
          onUpdateHistoryItem={onEvaluateHistoryItem}
        />
      )}
      {isTutorialActive && ( 
        <TutorialOverlay 
          steps={[
            { targetId: 'back-btn', title: 'Voltar ao Dashboard', content: 'Clique aqui para retornar à tela principal a qualquer momento.', placement: 'bottom' },
            { targetId: 'patient-header-info', title: 'Informações do Paciente', content: 'Aqui você vê o nome, categoria (Kids/Adulto) e acessa o WhatsApp ou Ficha de Anamnese.', placement: 'bottom' },
            { targetId: 'tab-nav', title: 'Navegação por Abas', content: 'O prontuário é organizado em abas para facilitar o acesso a diferentes tipos de informação.', placement: 'bottom' },
            { targetId: 'tab-history', title: 'Aba Histórico', content: 'Veja a evolução clínica e o histórico de todas as atividades realizadas pelo paciente.', placement: 'bottom' },
            { targetId: 'history-filters', title: 'Filtros e Comparação', content: 'Filtre por protocolo ou data para comparar o desempenho em diferentes momentos.', placement: 'bottom' },
            { targetId: 'evolution-chart-container', title: 'Gráfico de Evolução', content: 'Visualize o progresso quantitativo através de gráficos de radar ou linha.', placement: 'bottom' },
            { targetId: 'history-item-0', title: 'Detalhes da Atividade', content: 'Clique nos cards de histórico para ver notas, áudios e vídeos enviados pela família.', placement: 'top' },
            { targetId: 'tab-notes', title: 'Aba Anotações', content: 'Registre suas observações clínicas, orientações para a família ou notas para a equipe.', placement: 'bottom' },
            { targetId: 'note-export-card', title: 'Exportar Histórico', content: 'Gere um arquivo CSV com todo o histórico de notas do paciente para o período selecionado.', placement: 'bottom' },
            { targetId: 'note-type-toggles', title: 'Tipos de Notas', content: 'Alterne entre notas Privadas, compartilhadas com o Paciente ou visíveis para a Equipe.', placement: 'bottom' },
            { targetId: 'note-input-area', title: 'Registro de Notas', content: 'Escolha o tipo de nota e salve suas observações. Você pode definir temas para facilitar a busca.', placement: 'top' },
            { targetId: 'tab-report', title: 'Aba Relatório', content: 'Gere relatórios automáticos de evolução com gráficos comparativos para os pais.', placement: 'bottom' },
            { targetId: 'report-config-card', title: 'Configurar Relatório', content: 'Selecione o período e as datas de comparação para gerar o gráfico de desempenho.', placement: 'bottom' },
            { targetId: 'report-download-btn', title: 'Gerar PDF', content: 'Clique aqui para gerar o relatório final com gráficos e observações selecionadas.', placement: 'top' },
            { targetId: 'tab-plan', title: 'Aba Plano', content: 'Aqui você define o Plano de Ensino Individualizado (PEI) e prescreve tarefas.', placement: 'bottom' },
            { targetId: 'new-schedule-card', title: 'Prescrever Atividade', content: 'Envie novas tarefas ou reforços positivos diretamente para o aplicativo do paciente.', placement: 'top' },
            { targetId: 'plan-type-toggles', title: 'Tipos de Envio', content: 'Alterne entre Tarefas Técnicas dos protocolos ou Reforços Positivos motivadores.', placement: 'top' },
            { targetId: 'tab-session', title: 'Aba Sessão', content: 'Use esta aba durante o atendimento presencial para registrar tentativas em tempo real.', placement: 'bottom' },
            { targetId: 'session-start-btn', title: 'Modo Sessão', content: 'Inicie o modo de registro rápido para pontuar metas prioritárias com apenas um clique.', placement: 'top' },
            { targetId: 'tab-files', title: 'Aba Arquivos', content: 'Armazene documentos, exames, laudos e fotos importantes do paciente com segurança.', placement: 'bottom' },
            { targetId: 'file-upload-btn', title: 'Upload de Arquivos', content: 'Arraste ou selecione arquivos para manter todo o prontuário digitalizado em um só lugar.', placement: 'top' }
          ]} 
          onClose={() => setTutorialStep(-1)} 
          currentStepIndex={tutorialStep} 
          onStepChange={setTutorialStep} 
        /> 
      )} 
      {showConfirmation && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white rounded-3xl p-8 shadow-2xl text-center max-w-sm animate-pop"> 
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600"><Activity size={32} /></div> 
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Agendamento Confirmado!</h3> 
            <p className="text-gray-500 text-sm mb-6">A tarefa foi enviada para a agenda do paciente e salva no protocolo.</p> 
            <button onClick={() => setShowConfirmation(false)} className="w-full py-3 bg-gray-100 rounded-xl font-semibold text-gray-700 hover:bg-gray-200 transition-colors">Fechar</button> 
          </div> 
        </div> 
      )} 
      {editingTask && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <div className="flex justify-between items-center mb-4"> 
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2"><Edit size={18} className="text-[#7551FF]"/> Editar Tarefa</h3> 
              <button onClick={() => setEditingTask(null)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button> 
            </div> 
            <div className="space-y-4"> 
              <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Título da Tarefa</label> <input type="text" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-colors" value={editingTask.title} onChange={(e) => setEditingTask({...editingTask, title: e.target.value})} /> </div> 
              <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Subtítulo / Descrição</label> <textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-[#7551FF] transition-colors resize-none" rows={3} value={editingTask.description || ''} onChange={(e) => setEditingTask({...editingTask, description: e.target.value})} placeholder="Instruções para o paciente..."></textarea> </div> 
              <button onClick={handleSaveTaskEdit} className="w-full bg-[#7551FF] text-white font-semibold py-3 rounded-xl shadow-md hover:opacity-90 transition-all">Salvar Alterações</button> 
            </div> 
          </div> 
        </div> 
      )} 
      <AnamnesisModal isOpen={showAnamnesis} onClose={() => setShowAnamnesis(false)} initialData={patient.anamnesisData || { nome: patient.name }} onSave={handleUpdateAnamnesis} mode="edit" /> 
      
      {isUnlinkingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-[32px] p-8 shadow-2xl text-center max-w-sm animate-pop border border-red-50">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
              <EyeOff size={32} />
            </div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Desvincular Paciente?</h3>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">
              O paciente será removido da sua lista, mas todo o <strong>histórico clínico e anotações</strong> serão preservados e poderão ser acessados por um novo profissional caso ele seja vinculado novamente.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={handleUnlinkPatient} 
                className="w-full py-3 bg-red-500 text-white rounded-xl font-semibold shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
              >
                Sim, Desvincular
              </button>
              <button 
                onClick={() => setIsUnlinkingModalOpen(false)} 
                className="w-full py-3 bg-gray-100 rounded-xl font-semibold text-gray-700 hover:bg-gray-200 transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white px-6 pt-10 pb-6 shadow-sm z-20"> 
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4"> 
          <div className="flex items-center gap-4"> 
            <button id="back-btn" onClick={onBack} className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full"><ChevronLeft size={24}/></button> 
            <div id="patient-header-info">
                <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-semibold text-gray-800 tracking-tight">{patient.name}</h1>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${patientCategory === 'Kids' ? 'bg-pink-100 text-pink-500' : 'bg-indigo-50 text-indigo-500'}`}>
                       {patientCategory === 'Kids' ? 'Kids' : 'Adulto'}
                    </span>
                </div>
                <p className="text-gray-500 text-xs">Detalhes do Paciente</p>
            </div> 
          </div> 
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <a 
              id="whatsapp-btn"
              href={`https://wa.me/${(patient.phone || '').replace(/\D/g, '')}`} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="flex-1 sm:flex-none bg-green-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-lg shadow-green-200 hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              <MessageCircle size={16} /> WhatsApp
            </a>
            <button id="anamnesis-btn" onClick={() => setShowAnamnesis(true)} className="flex-1 sm:flex-none bg-[#F4F7FE] text-[#4318FF] px-4 py-2.5 rounded-xl text-xs font-semibold hover:bg-[#4318FF]/10 transition-colors flex items-center justify-center gap-2 border border-blue-100"> 
              <FileText size={16} /> Ficha Anamnese 
            </button> 
            <button 
              onClick={() => setIsUnlinkingModalOpen(true)}
              className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              title="Desvincular Paciente"
            >
              <EyeOff size={20} />
            </button>
          </div>
        </div> 
        <div id="tab-nav" className="flex gap-2 bg-gray-100 p-1 rounded-xl overflow-x-auto no-scrollbar"> 
          <button id="tab-history" onClick={() => setActiveTab('history')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'history' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Histórico</button> 
          <button id="tab-notes" onClick={() => setActiveTab('notes')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'notes' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Anotações</button> 
          <button id="tab-report" onClick={() => setActiveTab('report')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'report' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Relatório</button>
          <button id="tab-plan" onClick={() => setActiveTab('plan')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'plan' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Plano</button> 
          {patient.age <= 12 && (
            <button id="tab-session" onClick={() => setActiveTab('session')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'session' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Sessão</button>
          )}
          <button id="tab-files" onClick={() => setActiveTab('files')} className={`shrink-0 flex-1 py-2 px-4 text-xs font-semibold rounded-lg transition-all ${activeTab === 'files' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Arquivos</button> 
        </div> 
      </div> 
      <div className="p-6"> 
        {activeTab === 'history' ? ( 
          <div className="space-y-6"> 
            <div id="history-filters" className="bg-white/80 border border-gray-100 p-4 rounded-3xl shadow-sm mb-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="flex-1 w-full">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-2 ml-1">
                    <SlidersHorizontal size={12} className="text-[#4318FF]"/> Protocolo Ativo
                  </label>
                  <div className="relative">
                    <select 
                      id="protocol-selector"
                      className="w-full bg-gray-50 border border-gray-100 text-sm font-semibold text-gray-700 px-4 py-3 rounded-2xl outline-none focus:border-[#4318FF]/30 transition-all appearance-none"
                      value={selectedChartProtocolId}
                      onChange={(e) => setSelectedChartProtocolId(e.target.value)}
                    >
                      {protocols.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>
                </div>
                <div className="flex-1 w-full">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 flex items-center gap-2 ml-1">
                    <Calendar size={12} className="text-[#05CD99]"/> Ponto no Tempo
                  </label>
                  <div className="relative">
                    <select 
                      id="snapshot-selector"
                      className="w-full bg-gray-50 border border-gray-100 text-sm font-semibold text-gray-700 px-4 py-3 rounded-2xl outline-none focus:border-[#05CD99]/30 transition-all appearance-none"
                      value={selectedSnapshotDate}
                      onChange={(e) => setSelectedSnapshotDate(e.target.value)}
                    >
                      <option value="all">Visão Geral (Últimas Notas)</option>
                      {availableSnapshots.map((date: any) => (
                        <option key={date} value={date}>Avaliação de {date}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>
                </div>
              </div>
            </div>
            <div id="evolution-chart-container">
              <EvolutionLineChart chartData={radarChartData} maxScore={selectedProtocolMaxScore} />
            </div>
            {sortedDateKeys.length > 0 ? sortedDateKeys.map((dateKey, gIdx) => ( 
              <div key={dateKey} className="relative pl-6 border-l-2 border-gray-200 ml-2"> 
                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-[#7551FF] border-4 border-white ring-1 ring-gray-100"></div> 
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">{dateKey}</h3> 
                <div className="space-y-4"> 
                  {groupedHistory[dateKey].map((item: any, idx: number) => (
                    <HistoryCard 
                      id={gIdx === 0 && idx === 0 ? 'history-item-0' : ''} 
                      key={item.id} 
                      item={item} 
                      energyTags={ENERGY_TAGS} 
                      isTherapist={true} 
                      onEvaluate={onEvaluateHistoryItem} 
                      protocols={protocols} 
                      isKid={patientCategory === 'Kids'}
                      fullHistory={history.filter((h: any) => h.patientId === patient.id)}
                      peiGoals={patient.pei || []}
                    />
                  ))} 
                </div> 
              </div> 
            )) : <p className="text-center text-gray-400 mt-10">Nenhum histórico disponível.</p>} 
          </div> 
        ) : activeTab === 'notes' ? ( 
          <div className="space-y-4 animate-fade-in"> 
            <div id="note-export-card" className="bg-white border border-gray-200 p-5 rounded-[24px] shadow-sm mb-6 animate-fade-in">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="flex-1">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-tight mb-3 flex items-center gap-2">
                    <FileOutput size={14} className="text-[#4318FF]" /> Exportar Relatório de Evolução
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Início</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#4318FF] transition-all text-gray-700" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Fim</label>
                      <input type="date" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#4318FF] transition-all text-gray-700" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} />
                    </div>
                  </div>
                </div>
                <button 
                  id="note-export-btn"
                  onClick={handleDownloadReport}
                  className="bg-[#4318FF] text-white font-semibold px-6 py-2.5 rounded-xl shadow-md shadow-[#4318FF]/20 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 text-xs whitespace-nowrap"
                >
                  <Download size={16} /> Baixar .CSV
                </button>
              </div>
            </div>

            <div id="note-type-toggles" className="flex bg-gray-100 p-1 rounded-xl mb-4"> 
              <button onClick={() => setNoteMode('private')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'private' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}><EyeOff size={12} /> Privadas</button> 
              <button onClick={() => setNoteMode('patient')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'patient' ? 'bg-white text-[#4318FF] shadow-sm' : 'text-gray-400'}`}><Share2 size={12} /> Paciente</button> 
              <button onClick={() => setNoteMode('professional')} className={`flex-1 py-2 text-[10px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${noteMode === 'professional' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}><SlidersHorizontal size={12} /> Profissionais</button> 
            </div> 

            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                {noteMode === 'private' ? <FileText size={16} className="text-gray-500"/> : noteMode === 'patient' ? <Share2 size={16} className="text-[#4318FF]"/> : <SlidersHorizontal size={16} className="text-indigo-600"/>}
                {noteMode === 'private' ? "Nova Anotação Privada" : noteMode === 'patient' ? "Enviar para Paciente (Portátil)" : "Compartilhar com Profissionais (Portátil)"}
              </h3>
              <button id="note-filters-btn" onClick={() => setShowNoteFilters(!showNoteFilters)} className={`text-[10px] font-semibold px-3 py-1 rounded-full transition-all flex items-center gap-1 ${showNoteFilters ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-400'}`}>
                <Filter size={10} /> {showNoteFilters ? "Fechar Filtros" : "Filtrar Notas"}
              </button>
            </div>

            {showNoteFilters && (
              <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-sm mb-4 animate-slide-up space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Data</label>
                    <input type="date" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#4318FF]" value={noteDateFilter} onChange={e => setNoteDateFilter(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-[9px] font-semibold text-gray-400 uppercase mb-1 ml-1">Assunto/Tema</label>
                    <input type="text" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 text-xs outline-none focus:border-[#4318FF]" placeholder="Ex: Evolução..." value={noteSubjectFilter} onChange={e => setNoteSubjectFilter(e.target.value)} />
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                  <input type="text" className="w-full bg-gray-50 border border-gray-100 rounded-xl p-2 pl-9 text-xs outline-none focus:border-[#4318FF]" placeholder="Palavra-chave no conteúdo..." value={noteSearchQuery} onChange={e => setNoteSearchQuery(e.target.value)} />
                </div>
                <button onClick={() => { setNoteSearchQuery(""); setNoteSubjectFilter(""); setNoteDateFilter(""); }} className="text-[9px] font-semibold text-[#4318FF] uppercase tracking-wider hover:underline">Limpar Filtros</button>
              </div>
            )}

            <div id="note-input-area" className={`bg-white p-4 rounded-2xl shadow-sm border border-gray-100 transition-colors ${noteMode === 'patient' ? 'border-[#4318FF]/20 bg-blue-50/30' : noteMode === 'professional' ? 'border-indigo-100 bg-indigo-50/30' : ''}`}> 
              <div className="mb-3">
                <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 ml-1">Assunto / Tema</label>
                <input type="text" className="w-full bg-gray-50 rounded-xl p-2 text-xs outline-none border border-transparent focus:border-[#7551FF] focus:bg-white transition-all" placeholder="Ex: Comportamento, Evolução, Social..." value={newNoteSubject} onChange={e => setNewNoteSubject(e.target.value)} />
              </div>
              <textarea className="w-full h-24 bg-gray-50 rounded-xl p-3 text-sm outline-none border border-transparent focus:border-[#7551FF] focus:bg-white transition-all resize-none" placeholder={noteMode === 'private' ? "Digite observações clínicas..." : noteMode === 'patient' ? "Escreva uma orientação ou feedback (Portátil)..." : "Informações para outros profissionais (Portátil)..."} value={newNote} onChange={(e) => setNewNote(e.target.value)}></textarea> 
              <button onClick={handleAddNoteWithSubject} className={`w-full mt-3 text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 ${noteMode === 'private' ? 'bg-[#7551FF]' : noteMode === 'patient' ? 'bg-[#4318FF]' : 'bg-indigo-600'}`}>{noteMode === 'private' ? "Salvar Nota" : noteMode === 'patient' ? "Enviar Mensagem" : "Compartilhar com Equipe"}</button> 
            </div> 

            <div className="space-y-3"> 
              {filteredNotes.length > 0 ? (filteredNotes.map((note: any) => ( 
                <div key={note.id} className={`bg-white p-4 rounded-2xl border shadow-sm relative group transition-all ${(note.visibility === 'patient' || note.type === 'shared') ? 'border-[#4318FF]/30 bg-blue-50/20' : (note.visibility === 'professional' || note.type === 'professional') ? 'border-indigo-200 bg-indigo-50/20' : 'border-gray-100'}`}> 
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">{note.date}</span>
                      {note.subject && <span className="text-[11px] font-semibold text-gray-700 mt-0.5 uppercase tracking-tight">#{note.subject}</span>}
                    </div>
                    <div className="flex gap-1">
                      {(note.visibility === 'private' || note.type === 'private' || !note.visibility) && (
                        <React.Fragment>
                          <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, 'patient')} className={`p-1.5 rounded-lg transition-all ${note.hasSharedCopy ? 'bg-[#4318FF] text-white' : 'bg-gray-100 text-gray-400 hover:bg-blue-100 hover:text-[#4318FF]'}`} title="Compartilhar com Paciente">
                            <Share2 size={14} />
                          </button>
                          <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, 'professional')} className={`p-1.5 rounded-lg transition-all ${note.hasProfessionalCopy ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400 hover:bg-indigo-100 hover:text-indigo-600'}`} title="Compartilhar com Profissionais">
                            <SlidersHorizontal size={14} />
                          </button>
                        </React.Fragment>
                      )}
                      {note.originalId && (
                        <button onClick={() => (window as any).handleToggleNoteTypeApp(note.id, note.visibility || note.type)} className="p-1.5 bg-red-50 text-red-400 rounded-lg hover:bg-red-100 transition-all" title="Remover Cópia">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div> 
                  <p className="text-sm text-gray-700 whitespace-pre-wrap mb-1">{note.text}</p> 
                  <div className="flex items-center gap-2 mt-2">
                    {(note.visibility === 'patient' || note.type === 'shared') && <span className="text-[9px] font-semibold bg-[#4318FF] text-white px-2 py-0.5 rounded-full uppercase">Visível para Paciente (Portátil)</span>}
                    {(note.visibility === 'professional' || note.type === 'professional') && <span className="text-[9px] font-semibold bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase">Visível para Equipe (Portátil)</span>}
                    {note.hasSharedCopy && <span className="text-[9px] font-semibold bg-blue-100 text-[#4318FF] px-2 py-0.5 rounded-full uppercase">Cópia no Paciente</span>}
                    {note.hasProfessionalCopy && <span className="text-[9px] font-semibold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full uppercase">Cópia na Equipe</span>}
                  </div>
                </div> 
              ))) : (<p className="text-center text-gray-400 text-sm mt-10">Nenhuma anotação encontrada com os filtros atuais.</p>)} 
            </div> 
          </div> 
        ) : activeTab === 'report' ? (
          <div className="space-y-6 animate-fade-in">
            <div id="report-config-card" className="bg-white border border-gray-100 p-6 rounded-[32px] shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-indigo-50 rounded-2xl text-[#4318FF]">
                  <BarChart2 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 tracking-tight">Relatório de Progresso</h3>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest">Análise Comparativa para Clínicas e Operadores</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Período de Análise</label>
                  <select 
                    id="report-period-selector"
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                    value={reportPeriod}
                    onChange={(e) => setReportPeriod(e.target.value)}
                  >
                    <option value="monthly">Mensal</option>
                    <option value="bimonthly">Bimestral</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="semiannual">Semestral</option>
                    <option value="annual">Anual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data de Início (Base)</label>
                  <select 
                    id="report-date-1"
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                    value={comparisonDate1}
                    onChange={(e) => setComparisonDate1(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {availableSnapshots.map((date: any) => (
                      <option key={date} value={date}>{date}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Data de Comparação (Final)</label>
                  <select 
                    id="report-date-2"
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#4318FF]"
                    value={comparisonDate2}
                    onChange={(e) => setComparisonDate2(e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {availableSnapshots.map((date: any) => (
                      <option key={date} value={date}>{date}</option>
                    ))}
                  </select>
                </div>
              </div>

              <ComparisonBarChart 
                data={comparisonChartData} 
                title={(!comparisonDate1 || !comparisonDate2) ? "Exemplo de Comparativo de Domínios (Dados Fictícios)" : `Comparativo de Domínios: ${comparisonDate1} vs ${comparisonDate2}`} 
                maxScore={selectedProtocolMaxScore}
              />

              {selectedReportNotes.length > 0 && (
                <div className="mt-8 p-8 bg-gray-50 rounded-[32px] border border-gray-100 animate-fade-in">
                  <h4 className="text-sm font-semibold text-gray-800 uppercase tracking-tight mb-6 flex items-center gap-2">
                    <FileText size={18} className="text-[#4318FF]" /> Observações Selecionadas para o Relatório
                  </h4>
                  <div className="space-y-4">
                    {notes.filter((n: any) => selectedReportNotes.includes(n.id)).map((note: any) => (
                      <div key={note.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-semibold text-gray-400 uppercase">{note.date}</span>
                          {note.subject && <span className="text-[10px] font-semibold text-[#4318FF] uppercase tracking-widest">#{note.subject}</span>}
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{note.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-tight flex items-center gap-2">
                    <FileText size={16} className="text-[#4318FF]" /> Incluir Observações Clínicas
                  </h4>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase">{selectedReportNotes.length} selecionadas</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {notes.filter((n: any) => n.patientId === patient.id).map((note: any) => (
                    <div 
                      key={note.id} 
                      onClick={() => toggleReportNote(note.id)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all ${selectedReportNotes.includes(note.id) ? 'border-[#4318FF] bg-blue-50/50 shadow-sm' : 'border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9px] font-semibold text-gray-400 uppercase">{note.date}</span>
                        {selectedReportNotes.includes(note.id) && <div className="w-2 h-2 rounded-full bg-[#4318FF]"></div>}
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-3">{note.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-3">
                <button className="px-6 py-3 bg-gray-100 text-gray-600 font-semibold rounded-xl text-xs hover:bg-gray-200 transition-all">Visualizar PDF</button>
                <button id="report-download-btn" className="px-6 py-3 bg-[#4318FF] text-white font-semibold rounded-xl text-xs shadow-lg shadow-[#4318FF]/20 hover:opacity-90 transition-all flex items-center gap-2">
                  <Download size={16} /> Gerar Relatório Final
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'plan' ? ( 
          <div className="space-y-6 animate-fade-in"> 
            {patient.age <= 12 && (
              <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 mb-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#05CD99]/5 rounded-bl-full -z-0"></div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-800 tracking-tight">PEI - Plano de Ensino Individualizado</h3>
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mt-1">Metas e Objetivos de Intervenção</p>
                  </div>
                  <div className="flex gap-2">
                    {patient.pei?.some((g: any) => g.isPriority || g.status === 'in_progress') && (
                      <button 
                        onClick={() => setIsSessionModeOpen(true)}
                        className="bg-[#4318FF] text-white font-semibold px-6 py-3 rounded-2xl shadow-lg shadow-[#4318FF]/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 text-sm"
                      >
                        <Activity size={20} /> Iniciar Sessão
                      </button>
                    )}
                    <div className="p-3 bg-[#05CD99]/10 rounded-2xl text-[#05CD99]">
                      <Target size={24} />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mb-8">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Metas Ativas</h4>
                    <button 
                      onClick={() => setIsAddingPEIGoal(!isAddingPEIGoal)}
                      className="text-xs font-semibold text-[#05CD99] bg-[#05CD99]/10 px-4 py-2 rounded-xl hover:bg-[#05CD99]/20 transition-all flex items-center gap-2"
                    >
                      {isAddingPEIGoal ? <X size={14} /> : <Plus size={14} />}
                      {isAddingPEIGoal ? "Cancelar" : "Adicionar Meta do Protocolo"}
                    </button>
                  </div>

                  {isAddingPEIGoal && (
                    <div className="bg-gray-50 p-5 rounded-3xl border border-dashed border-[#05CD99]/30 animate-slide-up mb-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Protocolo</label>
                          <select 
                            className="w-full bg-white border border-gray-100 rounded-xl p-3 text-sm outline-none focus:border-[#05CD99] font-semibold text-gray-700"
                            value={selectedPEIProtocolId}
                            onChange={(e) => {
                              setSelectedPEIProtocolId(e.target.value);
                              setSelectedPEIDomainId("");
                              setSelectedPEISkillId("");
                            }}
                          >
                            <option value="">Selecione...</option>
                            {protocols.map((p: any) => (
                              <option key={p.id} value={p.id}>{p.title}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Domínio</label>
                          <select 
                            className="w-full bg-white border border-gray-100 rounded-xl p-3 text-sm outline-none focus:border-[#05CD99] font-semibold text-gray-700"
                            value={selectedPEIDomainId}
                            onChange={(e) => {
                              setSelectedPEIDomainId(e.target.value);
                              setSelectedPEISkillId("");
                            }}
                            disabled={!selectedPEIProtocolId}
                          >
                            <option value="">Selecione...</option>
                            {protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.data.map((d: any) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      
                      {selectedPEIDomainId && (
                        <div className="space-y-3 animate-fade-in">
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1.5 ml-1">Habilidade / Meta</label>
                          <div className="grid grid-cols-1 gap-2">
                            {protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.data.find((d: any) => String(d.id) === String(selectedPEIDomainId))?.skills.map((s: any) => (
                              <button 
                                key={s.id}
                                onClick={() => {
                                  const peiGoal = {
                                    id: Date.now(),
                                    skillId: s.id,
                                    name: s.name,
                                    objective: s.objective,
                                    criteria: s.criteria,
                                    maxScore: s.maxScore || 1,
                                    status: 'not_started',
                                    progress: 0,
                                    term: 'short',
                                    isPriority: false,
                                    protocolTitle: protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.title,
                                    domainName: protocols.find((p: any) => String(p.id) === String(selectedPEIProtocolId))?.data.find((d: any) => String(d.id) === String(selectedPEIDomainId))?.name
                                  };
                                  const updatedPatient = {
                                    ...patient,
                                    pei: [...(patient.pei || []), peiGoal]
                                  };
                                  onUpdatePatient(updatedPatient);
                                  setIsAddingPEIGoal(false);
                                  setSelectedPEIProtocolId("");
                                  setSelectedPEIDomainId("");
                                }}
                                className="text-left p-4 bg-white border border-gray-100 rounded-2xl hover:border-[#05CD99] hover:bg-[#05CD99]/5 transition-all group"
                              >
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                                    <p className="text-[10px] text-gray-500 mt-1">{s.objective}</p>
                                  </div>
                                  <Plus size={16} className="text-gray-300 group-hover:text-[#05CD99]" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-6">
                    {patient.pei && patient.pei.length > 0 ? (
                      ['short', 'medium', 'long'].map(term => {
                        const termGoals = patient.pei.filter((g: any) => g.term === term);
                        if (termGoals.length === 0) return null;
                        
                        return (
                          <div key={term} className="space-y-3">
                            <h5 className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.2em] ml-2">
                              {term === 'short' ? 'Curto Prazo' : term === 'medium' ? 'Médio Prazo' : 'Longo Prazo'}
                            </h5>
                            {termGoals.sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0)).map((goal: any) => (
                              <div key={goal.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm group hover:shadow-md transition-all">
                                <div className="flex justify-between items-start mb-3">
                                  <div>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[9px] font-semibold text-[#05CD99] bg-[#05CD99]/10 px-2 py-0.5 rounded-full uppercase">{goal.protocolTitle}</span>
                                      <span className="text-[9px] font-semibold text-gray-400 uppercase">{goal.domainName}</span>
                                      <select 
                                        className="text-[9px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase outline-none"
                                        value={goal.term}
                                        onChange={(e) => {
                                          const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, term: e.target.value } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                      >
                                        <option value="short">Curto Prazo</option>
                                        <option value="medium">Médio Prazo</option>
                                        <option value="long">Longo Prazo</option>
                                      </select>
                                    </div>
                                    <h4 className="font-semibold text-gray-800 text-base flex items-center gap-2">
                                      {goal.name}
                                      <button 
                                        onClick={() => {
                                          const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, isPriority: !g.isPriority } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                        className={`p-1 rounded-md transition-all ${goal.isPriority ? 'text-orange-500 bg-orange-50' : 'text-gray-300 hover:text-orange-300'}`}
                                        title={goal.isPriority ? "Remover Prioridade" : "Marcar como Prioridade para Sessão"}
                                      >
                                        <Zap size={14} fill={goal.isPriority ? "currentColor" : "none"} />
                                      </button>
                                    </h4>
                                    {patientCategory === 'Kids' && (
                                      <div className="mt-1 mb-2">
                                        <MasteryDots count={getMasteryProgress(goal.name) || 0} status={goal.status} />
                                      </div>
                                    )}
                                    <p className="text-xs text-gray-500 mt-1">{goal.objective}</p>
                                  </div>
                                    <div className="flex items-center gap-2">
                                      <select 
                                        className={`text-[10px] font-semibold px-3 py-1.5 rounded-xl outline-none appearance-none uppercase tracking-wider border-2 transition-all ${
                                          goal.status === 'completed' ? 'bg-green-100 text-green-600 border-green-200' : 
                                          goal.status === 'in_progress' ? 'bg-blue-100 text-blue-600 border-blue-200' : 
                                          'bg-gray-100 text-gray-400 border-gray-200'
                                        }`}
                                        value={goal.status}
                                        onChange={(e) => {
                                          const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, status: e.target.value } : g);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                      >
                                        <option value="not_started">Não Iniciado</option>
                                        <option value="in_progress">Em Treino</option>
                                        <option value="completed">Adquirido</option>
                                      </select>
                                      {patientCategory === 'Kids' && goal.status !== 'completed' && (
                                        <button 
                                          onClick={() => {
                                            if (confirm("Deseja zerar o progresso de maestria desta meta? Isso reiniciará a contagem de acertos consecutivos.")) {
                                              const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, id: Date.now(), progress: 0, status: 'not_started' } : g);
                                              onUpdatePatient({ ...patient, pei: updatedPEI });
                                            }
                                          }}
                                          className="p-2 text-gray-300 hover:text-orange-500 hover:bg-orange-50 rounded-xl transition-all"
                                          title="Zerar Progresso de Maestria"
                                        >
                                          <RotateCcw size={16} />
                                        </button>
                                      )}
                                      <button 
                                        onClick={() => {
                                          const updatedPEI = patient.pei.filter((g: any) => g.id !== goal.id);
                                          onUpdatePatient({ ...patient, pei: updatedPEI });
                                        }}
                                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Progresso da Meta</span>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
                                      goal.progress >= 100 ? 'bg-green-100 text-green-600' : 
                                      goal.progress >= 60 ? 'bg-blue-100 text-blue-600' : 
                                      'bg-gray-100 text-gray-600'
                                    }`}>{goal.progress}%</span>
                                  </div>
                                  <div className="relative w-full h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner border border-gray-200/50">
                                    {/* Progress Fill with Gradient */}
                                    <div 
                                      className={`absolute top-0 left-0 h-full transition-all duration-1000 ease-out ${
                                        goal.progress >= 100 ? 'bg-gradient-to-r from-green-400 to-emerald-600' :
                                        goal.progress >= 80 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' :
                                        goal.progress >= 60 ? 'bg-gradient-to-r from-cyan-400 to-blue-500' :
                                        goal.progress >= 40 ? 'bg-gradient-to-r from-yellow-400 to-orange-500' :
                                        goal.progress >= 20 ? 'bg-gradient-to-r from-orange-400 to-red-500' :
                                        'bg-gradient-to-r from-red-500 to-rose-600'
                                      }`}
                                      style={{ width: `${goal.progress}%` }}
                                    >
                                      {/* Animated Shine Effect */}
                                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-pulse"></div>
                                    </div>
                                    
                                    {/* Milestone Markers */}
                                    <div className="absolute inset-0 flex justify-between px-1 pointer-events-none">
                                      {[20, 40, 60, 80].map(m => (
                                        <div key={m} className="w-px h-full bg-white/30"></div>
                                      ))}
                                    </div>

                                    {/* Invisible range input for interaction */}
                                    <input 
                                      type="range" 
                                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                      value={goal.progress}
                                      onChange={(e) => {
                                        const updatedPEI = patient.pei.map((g: any) => g.id === goal.id ? { ...g, progress: parseInt(e.target.value) } : g);
                                        onUpdatePatient({ ...patient, pei: updatedPEI });
                                      }}
                                    />
                                  </div>
                                  {patientCategory === 'Kids' && (
                                    <div className="flex justify-between px-1">
                                      <span className="text-[8px] font-semibold text-gray-300 uppercase">Início</span>
                                      <span className="text-[8px] font-semibold text-gray-300 uppercase">Maestria</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-12 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                        <Target size={40} className="mx-auto mb-3 text-gray-300 opacity-50" />
                        <p className="text-sm font-semibold text-gray-400">Nenhuma meta definida no PEI ainda.</p>
                        <p className="text-[10px] text-gray-400 mt-1">Adicione metas dos protocolos para começar o planejamento.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {patient.age > 12 && (
              <React.Fragment>
                <div id="new-schedule-card" className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"> 
                  <h3 className="font-semibold text-gray-800 text-lg mb-4 tracking-tight">Novo Agendamento</h3> 
                  <div className="flex bg-gray-100 p-1 rounded-xl mb-6"> 
                    <button onClick={() => { setPlanType('task'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'task' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>{patient.age > 12 ? 'Avaliação' : 'Tarefa'}</button> 
                    <button onClick={() => { setPlanType('intervention'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'intervention' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Intervenção</button> 
                    <button onClick={() => { setPlanType('reinforcement'); setFinalTaskTitle(""); setFinalTaskSubtitle(""); setSelectedSkillId(""); }} className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${planType === 'reinforcement' ? 'bg-white text-[#7551FF] shadow-sm' : 'text-gray-500'}`}>Reforço</button> 
                  </div> 
                  <div className="space-y-4"> 
                    {(planType === 'task' || planType === 'intervention') ? ( 
                      <React.Fragment> 
                        <div className="flex items-center justify-between mb-2"> 
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Modo</span> 
                          <button onClick={() => setIsCreatingNewTask(!isCreatingNewTask)} className="text-xs font-semibold text-[#7551FF] bg-[#7551FF]/10 px-3 py-1 rounded-full transition-colors hover:bg-[#7551FF]/20">{isCreatingNewTask ? "Selecionar Existente" : "Criar Nova"}</button> 
                        </div> 
                        {isCreatingNewTask ? ( 
                          <div className={`animate-fade-in space-y-4 p-4 rounded-2xl border ${planType === 'intervention' ? 'bg-green-50/30 border-green-100' : 'bg-[#F4F7FE] border-blue-100'}`}> 
                            <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Nome da Nova {planType === 'intervention' ? 'Intervenção' : (patient.age > 12 ? 'Avaliação' : 'Tarefa')}</label><input type="text" className="w-full bg-white rounded-xl p-3 text-sm outline-none border border-transparent focus:border-[#7551FF]" placeholder={planType === 'intervention' ? "Ex: Autoestima" : (patient.age > 12 ? "Ex: Avaliação de Autonomia" : "Ex: Arrumar a cama")} value={newTaskName} onChange={e => setNewTaskName(e.target.value)} /></div> 
                            {planType === 'task' && (
                              <div className="grid grid-cols-2 gap-3 opacity-80 hover:opacity-100 transition-opacity"> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Código</label><input type="text" className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent focus:border-[#7551FF]" placeholder="Ex: A-1" value={newTaskCode} onChange={e => setNewTaskCode(e.target.value)} /></div> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Pontuação Máx.</label><select className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent focus:border-[#7551FF]" value={newTaskMaxScore} onChange={e => setNewTaskMaxScore(parseFloat(e.target.value))}><option value="1">0-1 (VB-MAPP)</option><option value="2">0-2</option><option value="3">0-3</option><option value="4">0-4</option></select></div> 
                              </div> 
                            )}
                            <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">{planType === 'intervention' ? 'Objetivo / Instruções de Escrita' : 'Objetivo (Base para descrição)'}</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={planType === 'intervention' ? 4 : 2} placeholder={planType === 'intervention' ? "Ex: Liste 20 qualidades que você tem..." : "Objetivo da tarefa..."} value={newTaskObjective} onChange={e => setNewTaskObjective(e.target.value)}></textarea></div> 
                            {planType === 'task' && (
                              <>
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Exemplos</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={2} placeholder="Ex: Passo a passo..." value={newTaskExample} onChange={e => setNewTaskExample(e.target.value)}></textarea></div> 
                                <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Critérios</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={2} placeholder="Critérios para pontuação..." value={newTaskCriteria} onChange={e => setNewTaskCriteria(e.target.value)}></textarea></div> 
                              </>
                            )}
                            <div><label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Anotações do Profissional</label><textarea className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-transparent resize-none" rows={2} value={newTaskComment || ''} onChange={(e) => setNewTaskComment(e.target.value)} placeholder="Anotações do profissional..."></textarea></div> 
                            <div className={`pt-2 border-t mt-2 ${planType === 'intervention' ? 'border-green-100' : 'border-blue-100'}`}> 
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-2">Salvar no Protocolo:</label> 
                              <div className="flex gap-2 mb-3"> 
                                <button onClick={() => setAddToProtocolMode('existing')} className={`flex-1 py-2 text-xs font-semibold rounded-lg border ${addToProtocolMode === 'existing' ? 'bg-white border-[#7551FF] text-[#7551FF]' : 'border-transparent bg-gray-100 text-gray-500'}`}>Existente</button> 
                                <button onClick={() => setAddToProtocolMode('new')} className={`flex-1 py-2 text-xs font-semibold rounded-lg border ${addToProtocolMode === 'new' ? 'bg-white border-[#7551FF] text-[#7551FF]' : 'border-transparent bg-gray-100 text-gray-500'}`}>Novo</button> 
                              </div> 
                              {addToProtocolMode === 'existing' ? ( 
                                <div className="space-y-2"> 
                                  <select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-xs outline-none" value={targetProtocolId} onChange={e => setTargetProtocolId(e.target.value)}><option value="">Selecione Protocolo...</option>{protocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}</select> 
                                  {targetProtocol && (<select className="w-full bg-white border border-gray-200 rounded-xl p-2 text-xs outline-none" value={targetDomainId} onChange={e => setTargetDomainId(e.target.value)}><option value="">Selecione Domínio...</option>{targetProtocol.data.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>)} 
                                </div> 
                              ) : ( 
                                <div className="space-y-2"> 
                                  <input type="text" className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-gray-200" placeholder="Nome do Novo Protocolo" value={newProtocolName} onChange={e => setNewProtocolName(e.target.value)} /> 
                                  <input type="text" className="w-full bg-white rounded-xl p-2 text-xs outline-none border border-gray-200" placeholder="Nome do Domínio (Categoria)" value={newDomainName} onChange={e => setNewDomainName(e.target.value)} /> 
                                </div> 
                              )} 
                            </div> 
                          </div> 
                        ) : ( 
                          <div className="animate-fade-in space-y-4"> 
                            <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 mb-2"> 
                              <button onClick={() => setIsPlanFilterOpen(!isPlanFilterOpen)} className="w-full flex items-center justify-between text-[#4318FF] mb-2">
                                <div className="flex items-center gap-2"><Filter size={14}/><span className="text-[10px] font-semibold uppercase tracking-widest">Filtrar Protocolos</span></div> 
                                <ChevronDown size={14} className={`transition-transform ${isPlanFilterOpen ? 'rotate-180' : ''}`} />
                              </button>

                              {isPlanFilterOpen && (
                                <div className="space-y-2 animate-fade-in">
                                  <div className="grid grid-cols-2 gap-2 mb-2"> 
                                    <select className="bg-white border border-blue-100 rounded-lg p-1.5 text-xs outline-none font-semibold text-gray-700" value={filterAge} onChange={(e) => setFilterAge(e.target.value)}> 
                                      <option value="">Faixa Etária (Todas)</option> <option value="child">0 a 12 anos</option> <option value="teen">13 a 18 anos</option> <option value="adult">19 a 59 anos</option> <option value="senior">60 anos ou mais</option> 
                                    </select> 
                                    <select className="bg-white border border-blue-100 rounded-lg p-1.5 text-xs outline-none font-semibold text-gray-700" value={filterType} onChange={(e) => setFilterType(e.target.value)}> 
                                      <option value="">Tipo (Todos)</option> <option value="conventional">Convencional</option> <option value="neurodevelopment">Neurodesenvolvimento</option> <option value="occupational">T. Ocupacional</option> 
                                    </select> 
                                  </div> 
                                  <div className="relative"> 
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={12} /> <input type="text" className="w-full bg-white border border-blue-100 rounded-lg p-1.5 pl-7 text-xs outline-none font-semibold text-gray-700" placeholder="Buscar por tema..." value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)} /> 
                                  </div> 
                                </div>
                              )}
                            </div> 
                            <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Protocolo ({filteredProtocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).length})</label>
                              <select 
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" 
                                value={selectedProtocolId} 
                                onChange={e => { setSelectedProtocolId(e.target.value); setSelectedDomainId(''); setSelectedSkillId(''); }}
                              >
                                <option value="">Selecione...</option>
                                {planType === 'task' && patient.pei && patient.pei.length > 0 && (
                                  <optgroup label="Plano de Ensino (PEI)">
                                    <option value="pei-goals">Metas do PEI</option>
                                  </optgroup>
                                )}
                                <optgroup label={planType === 'intervention' ? "Protocolos de Intervenção" : "Protocolos de Avaliação"}>
                                  {filteredProtocols.filter((p: any) => planType === 'intervention' ? p.category === 'intervention' : (p.category === 'evaluation' || !p.category)).map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}
                                </optgroup>
                              </select>
                            </div> 
                            {selectedProtocolId === 'pei-goals' ? (
                              <div>
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Meta do PEI</label>
                                <select 
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" 
                                  value={selectedSkillId} 
                                  onChange={e => {
                                    const goal = patient.pei.find((g: any) => String(g.id) === e.target.value);
                                    setSelectedSkillId(e.target.value);
                                    if (goal) {
                                      setFinalTaskTitle(goal.name);
                                      setFinalTaskSubtitle(goal.objective);
                                    }
                                  }}
                                >
                                  <option value="">Selecione uma meta...</option>
                                  {patient.pei.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              </div>
                            ) : (
                              <React.Fragment>
                                {selectedProtocol && (<div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Domínio</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={selectedDomainId} onChange={e => { setSelectedDomainId(e.target.value); setSelectedSkillId(''); }}><option value="">Selecione...</option>{selectedProtocol.data.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>)} 
                                {selectedDomain && (<div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{planType === 'intervention' ? 'Tarefa de Intervenção' : 'Habilidade / Tarefa'}</label><select className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none font-semibold text-gray-700" value={selectedSkillId} onChange={e => {
                                  const skill = selectedDomain.skills.find((s: any) => String(s.id) === e.target.value);
                                  setSelectedSkillId(e.target.value);
                                  if (skill) {
                                    setFinalTaskTitle(skill.name);
                                    setFinalTaskSubtitle(skill.objective);
                                  }
                                }}><option value="">Selecione...</option>{selectedDomain.skills.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>)} 
                                {planType === 'task' && selectedSkillId && patient.interventionTaskLinks && patient.interventionTaskLinks[finalTaskTitle] && (
                                  <div className="mt-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-2 animate-pulse">
                                    <Zap size={14} className="text-indigo-600" />
                                    <p className="text-[10px] font-semibold text-indigo-700">
                                      Vinculado à Intervenção: <span className="underline">{patient.interventionTaskLinks[finalTaskTitle]}</span>
                                    </p>
                                  </div>
                                )}
                              </React.Fragment>
                            )}
                          </div> 
                        )} 
                        <div className="mt-4"> 
                          <button onClick={() => setIsCustomizationOpen(!isCustomizationOpen)} className="text-[10px] font-semibold text-gray-400 hover:text-[#7551FF] flex items-center gap-1 transition-colors ml-auto mb-2"> 
                            {isCustomizationOpen ? <ChevronDown size={14} className="rotate-180"/> : <Edit size={14} />} {isCustomizationOpen ? 'Fechar Personalização' : 'Personalizar Título e Instruções'} 
                          </button> 
                          {isCustomizationOpen && ( 
                            <div className="bg-[#F4F7FE]/50 p-4 rounded-2xl border border-blue-100 animate-slide-up relative"> 
                              <div className="absolute top-0 left-0 bg-blue-100 text-blue-600 text-[10px] font-semibold px-3 py-1 rounded-br-xl rounded-tl-xl uppercase">Personalizar Envio</div> 
                              <div className="mt-4 space-y-3"> 
                                <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Título da Tarefa (O que o paciente vê)</label> <input type="text" className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-colors" placeholder="Ex: Escovar os dentes" value={finalTaskTitle} onChange={(e) => setFinalTaskTitle(e.target.value)} /> </div> 
                                <div> <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Subtítulo / Instruções</label> <textarea className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none focus:border-[#7551FF] transition-colors resize-none" rows={2} placeholder="Ex: Lembre-se de escovar a língua..." value={finalTaskSubtitle} onChange={(e) => setFinalTaskSubtitle(e.target.value)} ></textarea> </div> 
                              </div> 
                            </div> 
                          )} 
                        </div> 
                        {planType === 'task' && patient.age > 12 && (
                          <div className="mt-4 space-y-4">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Vincular Protocolo de Intervenção</label>
                              <select 
                                className="w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-all" 
                                value={linkedInterventionProtocolId} 
                                onChange={(e) => setLinkedInterventionProtocolId(e.target.value)}
                              >
                                <option value="">Nenhum protocolo vinculado</option>
                                {protocols.filter((p: any) => p.category === 'intervention').map((p: any) => (
                                  <option key={p.id} value={p.id}>{p.title}</option>
                                ))}
                              </select>
                              <p className="text-[9px] text-gray-400 mt-1 font-medium italic">* Define qual protocolo será sugerido para intervenção após esta avaliação.</p>
                            </div>
                          </div>
                        )}
                        {planType === 'intervention' && (
                          <div className="space-y-4">
                            <div>
                              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Vincular a Habilidade de Avaliação</label>
                              <select 
                                className="w-full bg-white border border-gray-200 rounded-xl p-3 text-xs font-semibold text-gray-700 outline-none focus:border-[#7551FF] transition-all" 
                                value={linkedTask} 
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setLinkedTask(val);
                                  if (patient.evaluationLinks && patient.evaluationLinks[val]) {
                                    setSelectedProtocolId(patient.evaluationLinks[val]);
                                    setSelectedDomainId('');
                                    setSelectedSkillId('');
                                  }
                                }}
                              >
                                <option value="">Nenhuma vinculação</option>
                                {evaluationSkills.map((s: any) => {
                                  const isLinked = (patient.evaluationLinks && patient.evaluationLinks[s.name]) || (patient.interventionTaskLinks && patient.interventionTaskLinks[s.name]);
                                  return (
                                    <option key={s.id} value={s.name}>
                                      {isLinked ? '✨ ' : ''}{s.name} ({s.protocol})
                                    </option>
                                  );
                                })}
                              </select>
                              {linkedTask && patient.evaluationLinks && patient.evaluationLinks[linkedTask] && (
                                <p className="text-[9px] text-[#05CD99] mt-1 font-semibold animate-pulse">
                                  ✨ Protocolo de intervenção sugerido automaticamente!
                                </p>
                              )}
                            </div>
                            <div className="bg-green-50/50 p-4 rounded-2xl border border-green-100 flex items-center justify-between">
                              <div>
                                <p className="text-xs font-semibold text-gray-700">Lembrete Diário</p>
                                <p className="text-[10px] text-gray-500">Notificar o paciente para ler esta tarefa todos os dias.</p>
                              </div>
                              <button 
                                onClick={() => setIsDailyReminder(!isDailyReminder)}
                                className={`w-12 h-6 rounded-full transition-all relative ${isDailyReminder ? 'bg-green-500' : 'bg-gray-200'}`}
                              >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${isDailyReminder ? 'left-7' : 'left-1'}`}></div>
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 mt-2"> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Data</label><input type="date" className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></div> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Hora</label><input type="time" className="w-full bg-white border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} /></div> 
                        </div> 
                        <button onClick={handleSchedule} disabled={!isFormValid()} className={`w-full font-semibold py-3 rounded-xl shadow-lg transition-opacity mt-4 ${isFormValid() ? 'bg-[#7551FF] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Confirmar Agendamento</button> 
                      </React.Fragment> 
                    ) : ( 
                      <div> 
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Mensagem de Reforço</label> 
                        <textarea className="w-full h-24 bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none resize-none" placeholder="Ex: Parabéns pela dedicação hoje!" value={message} onChange={e => setMessage(e.target.value)}></textarea> 
                        <div className="grid grid-cols-2 gap-4 mt-2"> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Data</label><input type="date" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /></div> 
                          <div><label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Hora</label><input type="time" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm outline-none" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} /></div> 
                        </div> 
                        <button onClick={handleSchedule} disabled={!isFormValid()} className={`w-full font-semibold py-3 rounded-xl shadow-lg transition-opacity mt-4 ${isFormValid() ? 'bg-[#7551FF] text-white hover:opacity-90' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>Confirmar Agendamento</button> 
                      </div> 
                    )} 
                  </div> 
                </div> 
                <div className="space-y-3"> 
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider ml-2 tracking-widest">Agendados</h3> 
                  {patientTasks.length > 0 ? patientTasks.map((task: any) => ( 
                    <div key={task.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between"> 
                      <div className="flex items-center gap-3"> 
                        <span className="text-xl">{task.type === 'reinforcement' ? '🌟' : task.type === 'intervention' ? '✍️' : '📋'}</span> 
                        <div><p className="font-semibold text-gray-800 text-sm tracking-tight">{task.title}</p><p className="text-xs text-gray-500">{new Date(task.scheduledAt).toLocaleDateString('pt-BR')} • {new Date(task.scheduledAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</p></div> 
                      </div> 
                      <div className="flex items-center gap-2"> 
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase ${task.type === 'reinforcement' ? 'bg-yellow-100 text-yellow-600' : task.type === 'intervention' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>{task.type === 'reinforcement' ? 'Reforço' : task.type === 'intervention' ? 'Intervenção' : (patient.age > 12 ? 'Avaliação' : 'Tarefa')}</span> 
                        <button onClick={() => setEditingTask(task)} className="p-2 text-gray-400 hover:text-[#7551FF] hover:bg-gray-100 rounded-lg transition-colors"> <Edit size={16} /> </button> 
                      </div> 
                    </div> 
                  )) : <p className="text-center text-gray-400 text-sm py-4 italic">Nada agendado ainda.</p>} 
                </div>
              </React.Fragment>
            )}
 
          </div> 
        ) : activeTab === 'session' ? (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#4318FF]/5 rounded-bl-full -z-0"></div>
              <div className="flex items-center justify-between mb-8 relative z-10">
                <div>
                  <h3 className="text-2xl font-semibold text-gray-800 tracking-tight">Registro de Sessão</h3>
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mt-1">Pontuação Dinâmica de Metas Prioritárias</p>
                </div>
                <button 
                  id="session-start-btn"
                  onClick={() => setIsSessionModeOpen(true)}
                  className="bg-[#4318FF] text-white font-semibold px-6 py-3 rounded-2xl shadow-lg shadow-[#4318FF]/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 text-sm"
                >
                  <Activity size={20} /> Modo Tela Cheia
                </button>
              </div>

              <div className="space-y-6">
                {patient.pei?.filter((g: any) => g.isPriority || g.status === 'in_progress').length > 0 ? (
                  patient.pei.filter((g: any) => g.isPriority || g.status === 'in_progress').map((goal: any) => (
                      <div key={goal.id} className="bg-gray-50 p-6 rounded-[32px] border border-gray-100 relative group">
                        {showTrialConfirmation && lastRecordedGoalId === goal.id && (
                          <div className="absolute inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur-sm border-t border-gray-100 p-4 animate-slide-up rounded-b-[32px]">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <input 
                                  type="text"
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[11px] outline-none focus:border-green-500 transition-all"
                                  placeholder="Anotações do Profissional (opcional)..."
                                  value={trialObservation}
                                  onChange={(e) => setTrialObservation(e.target.value)}
                                  autoFocus
                                />
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button 
                                  onClick={handleUndoTrial}
                                  className="px-3 py-2 bg-red-50 text-red-500 rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:bg-red-100 transition-all"
                                >
                                  Desfazer
                                </button>
                                <button 
                                  onClick={handleSaveTrialObservation}
                                  className="px-4 py-2 bg-green-500 text-white rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:opacity-90 transition-all shadow-md shadow-green-500/20"
                                >
                                  Confirmar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <span className="text-[9px] font-semibold text-[#4318FF] bg-[#4318FF]/10 px-3 py-1 rounded-full uppercase tracking-widest mb-2 inline-block">
                              {goal.domainName}
                            </span>
                            <h4 className="text-xl font-semibold text-gray-800 tracking-tight">{goal.name}</h4>
                            {patientCategory === 'Kids' && (
                              <div className="mt-2">
                                <MasteryDots count={getMasteryProgress(goal.name) || 0} status={goal.status} />
                              </div>
                            )}
                            <p className="text-xs text-gray-500 mt-1 font-medium">{goal.objective}</p>
                          </div>
                        </div>

                        <div className={`grid gap-4 ${(goal.maxScore || 1) > 1 ? 'grid-cols-5' : 'grid-cols-3'}`}>
                          {(goal.maxScore || 1) === 1 ? (
                            <>
                              <button 
                                onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, 1)}
                                className="bg-[#05CD99] text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                              >
                                1
                              </button>
                              <button 
                                onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, 0.5)}
                                className="bg-[#FFB547] text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                              >
                                0.5
                              </button>
                              <button 
                                onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, 0)}
                                className="bg-[#EE5D50] text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all"
                              >
                                0
                              </button>
                            </>
                          ) : (
                            Array.from({ length: (goal.maxScore || 1) + 1 }, (_, i) => (goal.maxScore || 1) - i).map((score) => {
                              const colors = ['bg-[#EE5D50]', 'bg-[#FFB547]', 'bg-[#4318FF]', 'bg-[#7551FF]', 'bg-[#05CD99]'];
                              const colorClass = colors[score] || 'bg-gray-500';
                              return (
                                <button 
                                  key={score}
                                  onClick={() => handleRecordTrialWithConfirmation(patient.id, goal.id, goal.name, score)}
                                  className={`${colorClass} text-white py-4 rounded-2xl flex items-center justify-center text-2xl font-semibold shadow-md hover:scale-[1.02] active:scale-95 transition-all`}
                                >
                                  {score}
                                </button>
                              );
                            })
                          )}
                        </div>
                      
                      <div className="mt-4 flex items-center justify-center gap-2">
                        <Info size={12} className="text-gray-300" />
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                          Critério: {goal.criteria || "Nenhum critério definido"}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-16 bg-gray-50 rounded-[32px] border-2 border-dashed border-gray-200">
                    <Zap size={48} className="mx-auto mb-4 text-gray-300 opacity-50" />
                    <p className="text-lg font-semibold text-gray-400">Nenhuma meta prioritária.</p>
                    <p className="text-sm text-gray-400 mt-1">Marque metas no PEI como prioridade para vê-las aqui.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-800 text-lg mb-4 flex items-center gap-2 tracking-tight">
                <UploadCloud className="text-[#4318FF]" size={20} /> Upload de Documentos
              </h3>
              <div id="file-upload-btn" className="relative group">
                <input 
                  type="file" 
                  id="patient-file-upload" 
                  className="hidden" 
                  onChange={handleFileUpload}
                  disabled={isUploadingFile}
                />
                <label 
                  htmlFor="patient-file-upload" 
                  className={`w-full py-10 border-2 border-dashed rounded-[24px] flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${isUploadingFile ? 'bg-gray-50 border-gray-200' : 'bg-blue-50/30 border-blue-200 hover:border-[#4318FF] hover:bg-blue-50'}`}
                >
                  {isUploadingFile ? (
                    <div className="w-full max-w-[240px] text-center">
                      <div className="h-2 w-full bg-gray-100 rounded-full mb-3 overflow-hidden">
                        <div className="h-full bg-[#4318FF] transition-all duration-200" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                      <span className="text-sm font-semibold text-gray-500 animate-pulse">Enviando arquivo... {uploadProgress}%</span>
                    </div>
                  ) : (
                    <React.Fragment>
                      <div className="p-4 bg-blue-100 rounded-full text-[#4318FF] mb-3 shadow-sm group-hover:rotate-6 transition-transform">
                        <FileUp size={32} />
                      </div>
                      <p className="text-base font-semibold text-gray-700">Clique para selecionar ou arraste arquivos</p>
                      <p className="text-xs text-gray-400 mt-1 uppercase font-medium">PDF, JPG, PNG, DOCX (Máx. 10MB)</p>
                    </React.Fragment>
                  )}
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider ml-2 flex items-center gap-2 tracking-widest">
                <File size={16} /> Arquivos Salvos ({patientFiles.length})
              </h3>
              {patientFiles.length > 0 ? patientFiles.map((file: any) => (
                <div key={file.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-blue-100 transition-all animate-slide-up">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-[#4318FF]">
                      {file.type.includes('pdf') ? <FileText size={24} /> : file.type.includes('image') ? <Activity size={24} /> : <File size={24} />}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm truncate max-w-[200px] tracking-tight">{file.name}</p>
                      <p className="text-[10px] text-gray-400 font-semibold uppercase">{file.size} • {file.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button title="Download" className="p-2.5 text-gray-400 hover:text-[#4318FF] hover:bg-blue-50 rounded-xl transition-all">
                      <Download size={18} />
                    </button>
                    <button onClick={() => removeFile(file.id)} title="Excluir" className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 bg-white/50 rounded-3xl border border-dashed border-gray-200">
                  <FileText size={40} className="mx-auto mb-2 text-gray-300 opacity-50" />
                  <p className="text-sm text-gray-400 font-medium italic">Nenhum arquivo anexado a este prontuário.</p>
                </div>
              )}
            </div>
          </div>
        )} 
      </div> 
    </div> 
  ); 
};
