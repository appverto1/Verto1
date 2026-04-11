import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, LogOut, BookOpen, X, BatteryCharging, BatteryFull, Zap, Check, RefreshCcw, Smile, ChevronDown, CheckCircle, Camera, Image as ImageIcon, Trash2, Pencil, Menu, MessageCircle } from 'lucide-react';
import { EvolutionLineChart, EvolutionBarChart } from './Charts';
import { LogoVerto, SuccessOverlay, BigEnergySlider, ENERGY_TAGS } from './Common';
import { HistoryCard } from './History';
import { DrawingCanvas } from './DrawingCanvas';
import { dataService } from '../services/dataService';

export const PatientDashboard = ({ user, onLogout, onMoodCheckin, tasks, onCompleteTask, history, energyTags, sharedNotes, protocols, onAddFamilyNote }: any) => { 
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState("all");
  const [selectedTask, setSelectedTask] = useState<any>(null); 
  const [taskEnergy, setTaskEnergy] = useState(50); 
  const [taskNote, setTaskNote] = useState(""); 
  const [interventionResponse, setInterventionResponse] = useState("");
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

  const [isUploading, setIsUploading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const moodOptions = [ { value: 10, emoji: "😫", label: "Esgotado", color: "bg-red-100 border-red-200 hover:bg-red-200" }, { value: 30, emoji: "😕", label: "Baixo", color: "bg-orange-100 border-orange-200 hover:bg-orange-200" }, { value: 50, emoji: "😐", label: "Normal", color: "bg-yellow-100 border-yellow-200 hover:bg-yellow-200" }, { value: 70, emoji: "🙂", label: "Bem", color: "bg-blue-100 border-blue-200 hover:bg-blue-200" }, { value: 90, emoji: "🤩", label: "Ótimo!", color: "bg-green-100 border-green-200 hover:bg-green-200" } ];

  const availableSnapshots = useMemo(() => {
    const dates = history.filter((h: any) => h.dateGroup).map((h: any) => h.dateGroup);
    return Array.from(new Set(dates)).sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime());
  }, [history]);

  const kidChartData = useMemo(() => {
    // Prioritize VB-MAPP for crianças, otherwise use first protocol
    const vbmapp = protocols?.find((p: any) => p.title.includes('VB-MAPP'));
    const selectedProto = vbmapp || protocols?.[0] || { data: [] };
    const labels = selectedProto.data.map((d: any) => d.name);
    
    // Current scores (latest for each skill)
    const currentData = selectedProto.data.map((domain: any) => {
      const skillNames = domain.skills.map((s: any) => s.name.trim().toLowerCase());
      const skillLatestScoreMap: any = {};
      const skillLatestIdMap: any = {};
      
      history.forEach((h: any) => {
        const title = h.title.trim().toLowerCase();
        if (h.type === 'task' && h.score !== undefined && skillNames.includes(title)) {
          if (!skillLatestIdMap[title] || h.id > skillLatestIdMap[title]) {
            skillLatestIdMap[title] = h.id;
            
            // Use 0-1 scale for the chart
            const peiGoal = user.pei?.find((g: any) => g.name.trim().toLowerCase() === title);
            if (peiGoal?.status === 'completed') {
              skillLatestScoreMap[title] = 1;
            } else {
              skillLatestScoreMap[title] = h.score;
            }
          }
        }
      });

      const latestScores: any[] = Object.values(skillLatestScoreMap);
      return latestScores.length > 0 ? (latestScores.reduce((a: any, b: any) => a + b, 0) / latestScores.length) : 0;
    });

    const currentDataset = {
      label: 'Meus Super Poderes (Agora)',
      data: currentData,
      backgroundColor: 'rgba(5, 205, 153, 0.15)',
      borderColor: '#05CD99',
      borderWidth: 3,
      pointBackgroundColor: '#05CD99',
      pointRadius: 6
    };

    const datasets: any[] = [];

    if (selectedSnapshotDate !== "all") {
      const historicalData = selectedProto.data.map((domain: any) => {
        const skillNames = domain.skills.map((s: any) => s.name.trim().toLowerCase());
        const skillLatestScoreMap: any = {};
        const skillLatestIdMap: any = {};
        
        history.forEach((h: any) => {
          const title = h.title.trim().toLowerCase();
          if (h.type === 'task' && h.score !== undefined && h.dateGroup === selectedSnapshotDate && skillNames.includes(title)) {
            if (!skillLatestIdMap[title] || h.id > skillLatestIdMap[title]) {
              skillLatestIdMap[title] = h.id;
              skillLatestScoreMap[title] = h.score;
            }
          }
        });

        const latestScores: any[] = Object.values(skillLatestScoreMap);
        return latestScores.length > 0 ? (latestScores.reduce((a: any, b: any) => a + b, 0) / latestScores.length) : 0;
      });

      datasets.push({
        label: `Meus Poderes em ${selectedSnapshotDate}`,
        data: historicalData,
        backgroundColor: 'rgba(238, 93, 80, 0.15)',
        borderColor: '#EE5D50',
        borderWidth: 2,
        borderDash: [5, 5],
        pointBackgroundColor: '#EE5D50',
        pointRadius: 4
      });
    }

    datasets.push(currentDataset);

    return { labels, datasets };
  }, [history, protocols, selectedSnapshotDate, user]);

  const handleConfirmFamilyNote = () => {
    if (familyNote.trim() || familyImage) {
      setShowFamilySuccess(true);
      setTimeout(() => {
        onAddFamilyNote(user.id, familyNote, familyImage || undefined);
        setShowFamilySuccess(false);
        setFamilyNote("");
        setFamilyImage(null);
        setIsFamilyLogOpen(false);
      }, 2000);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
          alert('Erro ao enviar imagem. O sistema tentará criar o bucket "patient-photos" automaticamente. Por favor, tente novamente em alguns instantes.');
          // Attempt to create bucket via API if it fails
          fetch('/api/storage/create-bucket', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucketName: 'patient-photos' })
          }).catch(err => console.error('Failed to trigger bucket creation:', err));
        }
      } catch (error) {
        console.error('Upload error:', error);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const filteredHistoryList = useMemo(() => {
    if (selectedSnapshotDate === "all") return history;
    return history.filter((h: any) => h.dateGroup === selectedSnapshotDate);
  }, [history, selectedSnapshotDate]);

  const groupedHistory = filteredHistoryList.reduce((groups: any, item: any) => { const group = groups[item.dateGroup] || []; group.push(item); group.sort((a: any, b: any) => b.id - a.id); groups[item.dateGroup] = group; return groups; }, {}); 
  const sortedDateKeys = Object.keys(groupedHistory).sort((a, b) => { if (a === "Hoje") return -1; if (b === "Hoje") return 1; if (a === "Ontem") return -1; if (b === "Ontem") return 1; return b.localeCompare(a); }); 

  if (user.age <= 12 || user.anamnesisData?.formType === 'child') {
    return (
        <div className="min-h-screen bg-[#F4F7FE] p-4 sm:p-6 flex flex-col items-center relative overflow-y-auto">
            {(showFamilySuccess) && <SuccessOverlay />} 
            <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-blue-100 to-transparent -z-0"></div>
            <div className="w-full max-w-md relative z-10 flex flex-col h-full">
                <div className="flex justify-between items-center mb-6 sm:mb-8">
                    <div className="flex items-center gap-3">
                         <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-full flex items-center justify-center shadow-md text-xl sm:text-2xl">🚀</div>
                         <div>
                             <h1 className="text-xl sm:text-2xl font-semibold text-[#4318FF]">Oi, {user.name}!</h1>
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
                            <button 
                              onClick={() => { setIsFamilyLogOpen(true); setIsMenuOpen(false); }}
                              className="w-full flex items-center gap-3 p-3 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                            >
                              <BookOpen size={18} /> Diário da Família
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

                <div className="bg-white p-4 sm:p-6 rounded-[32px] sm:rounded-[40px] shadow-xl border border-blue-50 flex flex-col justify-center mb-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 sm:w-32 h-24 sm:h-32 bg-yellow-100 rounded-bl-full opacity-50 -z-0"></div>
                    <div className="flex items-center justify-between mb-4 sm:mb-6 px-1 sm:px-2">
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-700 flex items-center gap-2"><Trophy className="text-yellow-500" size={20}/> Nível de Herói</h2>
                        <div className="relative w-28 sm:w-32">
                            <select 
                                className="w-full bg-blue-50 border border-blue-100 text-[9px] sm:text-[10px] font-semibold text-[#4318FF] px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl outline-none appearance-none uppercase tracking-wider"
                                value={selectedSnapshotDate}
                                onChange={(e) => setSelectedSnapshotDate(e.target.value)}
                            >
                                <option value="all">Hoje</option>
                                {availableSnapshots.map((date: any) => (
                                    <option key={date} value={date}>{date}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-[#4318FF] pointer-events-none" size={10} />
                        </div>
                    </div>
                    <div className="w-full min-h-[300px] sm:min-h-[350px]">
                        <EvolutionBarChart chartData={kidChartData} />
                    </div>
                </div>

                <div className="mt-4 mb-10"> 
                  <div className="flex items-center justify-between mb-4">
                     <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest flex items-center gap-2"> <Trophy size={16} /> Histórico </h2>
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
                              energyTags={ENERGY_TAGS} 
                              isTherapist={false} 
                              isKid={true}
                              fullHistory={history}
                              peiGoals={user.pei || []}
                              protocols={protocols}
                            /> 
                          ))} 
                        </div> 
                      </div> 
                    )) : ( <p className="text-center text-gray-400 text-xs py-4 italic">Nenhuma atividade registrada.</p> )} 
                  </div> 
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
                          <img src={familyImage} alt="Preview" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button onClick={() => setIsDrawingMode(true)} className="p-1.5 bg-white rounded-full text-blue-500 shadow-sm" title="Rabiscar na foto"><Pencil size={14}/></button>
                            <button onClick={() => setFamilyImage(null)} className="p-1.5 bg-white rounded-full text-red-500 shadow-sm"><Trash2 size={14}/></button>
                          </div>
                        </div>
                      ) : (
                        <label className={`w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-blue-300 hover:text-blue-400 transition-all cursor-pointer ${isUploading ? 'opacity-50 cursor-wait' : ''}`}>
                          {isUploading ? (
                            <RefreshCcw size={24} className="animate-spin" />
                          ) : (
                            <Camera size={24} />
                          )}
                          <span className="text-[10px] font-bold uppercase">{isUploading ? 'Enviando' : 'Foto'}</span>
                          {!isUploading && <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />}
                        </label>
                      )}
                    </div>
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

  const handleEmojiClick = (mood: any) => { setSelectedMood(mood); setSelectedTag(null); setMoodNote(""); setIsMoodModalOpen(true); }; 
  const handleConfirmMood = () => { 
    if (selectedMood) { 
      setShowMoodSuccess(true); 
      setTimeout(() => { onMoodCheckin(selectedMood.value, moodNote, selectedMood.emoji, selectedTag); setIsMoodModalOpen(false); setShowMoodSuccess(false); setMoodNote(""); setSelectedMood(null); setSelectedTag(null); setDailyCheckinDone(true); }, 2000); 
    } 
  }; 
  const openTaskModal = (task: any) => { setSelectedTask(task); setTaskEnergy(50); setTaskNote(""); setTaskStep(1); }; 
  const handleEnergyCommit = () => { setTaskStep(2); }; 
  const handleConfirmTask = () => { 
    if (selectedTask) { 
      setShowTaskSuccess(true); 
      const finalNote = selectedTask.type === 'intervention' ? interventionResponse : taskNote;
      setTimeout(() => { 
        onCompleteTask(selectedTask, taskEnergy, finalNote); 
        setShowTaskSuccess(false); 
        setSelectedTask(null); 
        setInterventionResponse("");
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
    <div className="min-h-screen bg-[#F4F7FE] p-6 flex flex-col overflow-x-hidden"> 
      {(showTaskSuccess || showMoodSuccess) && <SuccessOverlay />} 
      {isMessagesOpen && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setIsMessagesOpen(false)}> 
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl animate-pop relative" onClick={e => e.stopPropagation()}> 
            <button onClick={() => setIsMessagesOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button> 
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2 tracking-tight"><BookOpen className="text-[#4318FF]"/> Mensagens do Terapeuta</h2> 
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
          <LogoVerto size={50} showText={true} className="drop-shadow-sm shrink-0" />
          <div className="w-px h-8 bg-gray-200 mx-2 hidden sm:block"></div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 tracking-tight leading-none"> Olá, <span className="text-[#4318FF]">{user.name}</span>! </h1> 
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
                <button 
                  onClick={() => { setIsMessagesOpen(true); setIsMenuOpen(false); }}
                  className="w-full flex items-center justify-between p-3 text-sm font-medium text-[#4318FF] hover:bg-blue-50 rounded-xl transition-colors"
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
      {!dailyCheckinDone ? ( 
        <div className="mb-8 animate-slide-up"> 
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2 px-1"> {user.type === 'conventional' ? <Smile size={16} /> : <BatteryCharging size={16} />} {user.type === 'conventional' ? 'Como você se sente?' : 'Como se sente agora?'} </h2> 
          <div className="flex overflow-x-auto pb-8 pt-4 -mx-6 px-6 gap-4 snap-x snap-mandatory no-scrollbar items-center"> 
            {moodOptions.map((mood) => { 
              const isHovered = hoveredMood === mood.value; 
              const isDimmed = hoveredMood !== null && !isHovered; 
              return ( 
                <button key={mood.value} onClick={() => handleEmojiClick(mood)} onMouseEnter={() => setHoveredMood(mood.value)} onMouseLeave={() => setHoveredMood(null)} className={` snap-center shrink-0 w-40 h-56 sm:w-48 sm:h-64 rounded-[32px] flex flex-col items-center p-6 transition-all duration-500 border-4 shadow-lg ${mood.color} ${isHovered ? 'scale-110 -translate-y-4 shadow-2xl z-10 rotate-1' : 'scale-100'} ${isDimmed ? 'opacity-50 scale-95 blur-[1px]' : 'opacity-100'} group relative overflow-hidden `} > 
                  <div className="absolute top-[-20%] right-[-20%] w-24 h-24 rounded-full bg-white/20 blur-xl"></div> 
                  <div className="absolute bottom-[-10%] left-[-10%] w-20 h-20 rounded-full bg-white/30 blur-lg"></div> 
                  <div className="w-full flex justify-between items-center opacity-60 group-hover:opacity-100 transition-opacity z-10"> {user.type !== 'conventional' && <React.Fragment><BatteryFull size={20} className="text-gray-700" /> <span className="text-xs font-semibold text-gray-700">{mood.value}%</span></React.Fragment>} </div> 
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
            <div> <h3 className="font-semibold text-gray-800 tracking-tight">{user.type === 'conventional' ? 'Sentimento Registrado!' : 'Energia Registrada!'}</h3> <p className="text-xs text-gray-400">Obrigado por compartilhar.</p> </div> 
          </div> 
          <button onClick={() => setDailyCheckinDone(false)} className="text-[10px] font-semibold text-[#4318FF] bg-[#4318FF]/10 px-4 py-2 rounded-xl hover:bg-[#4318FF]/20 transition-colors flex items-center gap-2 uppercase tracking-widest" > <RefreshCcw size={14} /> Ajustar </button> 
        </div> 
      )} 
      <div className="flex-1 overflow-y-auto no-scrollbar"> 
        <div className="mb-8"> 
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2"> <Zap size={16} /> Suas Atividades </h2> 
          {tasks && tasks.length > 0 ? ( 
            <div className="grid gap-3"> 
              {tasks.map((task: any) => ( 
                <div key={task.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between group hover:shadow-md transition-all"> 
                  <div className="flex items-center gap-4"> 
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl ${task.color || 'bg-blue-100 text-blue-600'}`}> {task.icon || '📋'} </div> 
                    <div> <h3 className="font-semibold text-gray-800 tracking-tight">{task.title}</h3> {task.description && <p className="text-xs text-gray-400 line-clamp-1">{task.description}</p>} </div> 
                  </div> 
                  <button onClick={() => openTaskModal(task)} className="p-3 bg-gray-50 text-gray-400 rounded-xl hover:bg-green-500 hover:text-white transition-all active:scale-95" > <Check size={20} /> </button> 
                </div> 
              ))} 
            </div> 
          ) : ( 
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 bg-white/50 rounded-3xl border-2 border-dashed border-gray-200"> <Smile size={48} className="mb-2 opacity-50"/> <p className="font-medium">Tudo feito por hoje!</p> </div> 
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
                    <option key={date} value={date}>{date}</option>
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
                      energyTags={ENERGY_TAGS} 
                      isTherapist={false} 
                      isKid={user.age <= 12}
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
            <button onClick={() => setIsMoodModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
            <div className="text-center mb-4"> 
              {user.type !== 'conventional' && (
                <div className="inline-flex items-center gap-2 bg-gray-100 px-4 py-1.5 rounded-full mb-4"> <BatteryFull size={16} className="text-gray-500" /> <span className="text-sm font-semibold text-gray-600">Energia registrada: <span className="text-[#4318FF]">{selectedMood.value}%</span></span> </div> 
              )}
              <div className="text-6xl mb-2 animate-bounce-slight">{selectedMood.emoji}</div> 
              <h3 className="text-xl font-semibold text-gray-800 tracking-tight">{user.type === 'conventional' ? 'Como você se sente?' : 'O que influenciou?'}</h3> 
            </div> 
            <div className="grid grid-cols-2 gap-3 mb-4"> 
              {energyTags.map((tag: any) => ( 
                <button key={tag.id} onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)} className={`p-3 rounded-2xl flex items-center gap-3 border-2 transition-all ${selectedTag === tag.id ? 'border-[#4318FF] bg-[#4318FF]/5 shadow-sm' : 'border-transparent bg-gray-100'}`} > 
                  <div className={`p-2 rounded-xl ${tag.color} shrink-0`}> {tag.icon} </div> <span className={`text-xs font-semibold ${selectedTag === tag.id ? 'text-[#4318FF]' : 'text-gray-500'}`}>{tag.label}</span> 
                </button> 
              ))} 
            </div> 
            <textarea className="w-full h-20 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#4318FF]/50 transition-all resize-none mb-4" placeholder="Quer escrever algo sobre isso?" value={moodNote} onChange={(e) => setMoodNote(e.target.value)} ></textarea> 
            <button onClick={handleConfirmMood} disabled={showMoodSuccess} className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showMoodSuccess ? 'bg-green-500 text-white' : 'bg-[#4318FF] text-white shadow-[#4318FF]/30 hover:opacity-90'}`} > {showMoodSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Registrar</React.Fragment>} </button> 
          </div> 
        </div> 
      )} 
      {selectedTask && ( 
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"> 
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-pop relative"> 
            <button onClick={() => setSelectedTask(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600" > <X size={24} /> </button> 
            <div className="text-center mb-6"> 
              <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-3 ${selectedTask.color || 'bg-blue-100 text-blue-600'}`}> {selectedTask.icon || '📋'} </div> 
              <h3 className="text-xl font-semibold text-gray-800 tracking-tight">{selectedTask.title}</h3> 
              <p className="text-gray-500 text-sm mt-1">{selectedTask.type === 'intervention' ? 'Instruções de Escrita' : 'Como foi realizar esta atividade?'}</p> 
            </div> 
            {selectedTask.type === 'intervention' ? (
              <div className="animate-slide-up space-y-4">
                <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                  <p className="text-sm text-gray-600 font-medium leading-relaxed italic">"{selectedTask.description}"</p>
                </div>
                <textarea 
                  className="w-full h-48 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-green-500/50 transition-all resize-none font-medium" 
                  placeholder="Escreva sua resposta aqui..." 
                  value={interventionResponse} 
                  onChange={(e) => setInterventionResponse(e.target.value)} 
                  autoFocus 
                ></textarea> 
                <button 
                  onClick={handleConfirmTask} 
                  disabled={showTaskSuccess || !interventionResponse.trim()} 
                  className={`w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${showTaskSuccess ? 'bg-green-500 text-white' : 'bg-green-600 text-white shadow-green-600/30 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                > 
                  {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Enviar Resposta</React.Fragment>} 
                </button> 
              </div>
            ) : taskStep === 1 ? ( 
              <div className="animate-slide-up"> 
                {user.age <= 12 ? (
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
                            'bg-[#4318FF] shadow-blue-500/20',    // 3
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
                    <BigEnergySlider value={taskEnergy} onChange={(e: any) => setTaskEnergy(e.target.value)} onCommit={handleEnergyCommit} /> 
                    <p className="text-center text-[10px] text-[#4318FF]/50 mt-4 font-medium animate-pulse italic uppercase tracking-widest">(Solte para continuar)</p> 
                  </React.Fragment>
                )}
              </div> 
            ) : ( 
              <div className="animate-slide-up"> 
                <div className="mb-4"> 
                  <div className="flex items-center justify-between mb-2"> 
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{user.age <= 12 ? 'Sua Pontuação' : 'Energia'}</span> 
                    <span className="text-sm font-semibold text-[#4318FF]">{user.age <= 12 ? taskEnergy : `${taskEnergy}%`}</span> 
                  </div> 
                  <div className="w-full bg-gray-100 rounded-full h-2"> 
                    <div className="bg-[#4318FF] h-2 rounded-full" style={{ width: user.age <= 12 ? `${taskEnergy * 100}%` : `${taskEnergy}%` }}></div> 
                  </div> 
                </div> 
                <textarea className="w-full h-24 bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm focus:outline-none focus:border-[#4318FF]/50 transition-all resize-none mb-4 font-medium" placeholder={user.age <= 12 ? "Quer contar como foi?" : "Quer adicionar alguma observação?"} value={taskNote} onChange={(e) => setTaskNote(e.target.value)} autoFocus ></textarea> 
                <button onClick={handleConfirmTask} disabled={showTaskSuccess} className="w-full font-semibold text-lg py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 bg-green-500 text-white shadow-green-500/30 hover:opacity-90" > {showTaskSuccess ? <React.Fragment><CheckCircle size={24}/> Sucesso!</React.Fragment> : <React.Fragment><Check size={20} strokeWidth={3} /> Concluir</React.Fragment>} </button> 
              </div> 
            )} 
          </div> 
        </div> 
      )} 
    </div> 
  ); 
};
