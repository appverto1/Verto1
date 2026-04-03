import React, { useState, useEffect, useMemo } from 'react';
import { X, ChevronLeft, Info, Zap, CheckCircle2, RotateCcw, Camera } from 'lucide-react';
import { SuccessOverlay } from './Common';

export const SessionMode = ({ patient, onClose, onRecordTrial, onDeleteHistoryItem, onUpdateHistoryItem }: any) => {
  const sessionGoals = (patient.pei?.filter((g: any) => g.isPriority || g.status === 'in_progress') || [])
    .sort((a: any, b: any) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0));
  const [trialCount, setTrialCount] = useState(0);
  const [activeCriteria, setActiveCriteria] = useState<string | null>(null);
  
  const [lastRecordedTrialId, setLastRecordedTrialId] = useState<any>(null);
  const [lastRecordedGoalId, setLastRecordedGoalId] = useState<any>(null);
  const [pendingTrial, setPendingTrial] = useState<any>(null);
  const [showTrialConfirmation, setShowTrialConfirmation] = useState(false);
  const [trialObservation, setTrialObservation] = useState("");
  const [isSavingObservation, setIsSavingObservation] = useState(false);
  
  const patientPhotos = useMemo(() => {
    return (patient.history || [])
      .filter((h: any) => h.type === 'photo' && h.image)
      .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [patient.history]);

  const handleScore = (goal: any, score: number) => {
    setPendingTrial({ goal, score });
    setLastRecordedGoalId(goal.id);
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
      const newId = onRecordTrial(patient.id, pendingTrial.goal.name, pendingTrial.score, trialObservation);
      setTrialCount(prev => prev + 1);
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

  if (sessionGoals.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-6">
        <button onClick={onClose} className="absolute top-6 left-6 p-2 hover:bg-gray-100 rounded-full transition-all">
          <ChevronLeft size={32} className="text-gray-400" />
        </button>
        <Zap size={64} className="text-gray-200 mb-4" />
        <h2 className="text-xl font-bold text-gray-800 text-center">Nenhuma meta em treino ou prioritária.</h2>
        <p className="text-gray-500 text-center mt-2">Altere o status de uma meta para "Em Treino" ou marque como prioridade para iniciar a sessão.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#F4F7FE] flex flex-col overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="bg-white px-8 py-6 shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <button onClick={onClose} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-all">
            <ChevronLeft size={32} className="text-gray-400" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800 tracking-tight">Sessão: <span className="text-[#4318FF]">{patient.name}</span></h1>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mt-1">Dashboard de Ensino Dinâmico</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Registros</p>
          <p className="text-4xl font-bold text-[#4318FF] leading-none">{trialCount}</p>
        </div>
      </div>

      {/* Goals List */}
      <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
        <div className="max-w-4xl mx-auto space-y-8">
          {sessionGoals.map((goal: any) => (
            <div key={goal.id} className="bg-white rounded-[40px] p-10 shadow-xl shadow-blue-900/5 border border-white relative group animate-slide-up overflow-hidden">
              {showTrialConfirmation && lastRecordedGoalId === goal.id && (
                <div className="absolute inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur-sm border-t border-gray-100 p-8 animate-slide-up rounded-b-[40px]">
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <input 
                        type="text"
                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-6 py-4 text-lg outline-none focus:border-green-500 transition-all"
                        placeholder="Observação rápida (opcional)..."
                        value={trialObservation}
                        onChange={(e) => setTrialObservation(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-4 shrink-0">
                      <button 
                        onClick={handleUndoTrial}
                        className="px-8 py-4 bg-red-50 text-red-500 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-red-100 transition-all active:scale-95"
                      >
                        Desfazer
                      </button>
                      <button 
                        onClick={handleSaveTrialObservation}
                        className="px-10 py-4 bg-green-500 text-white rounded-2xl text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-all active:scale-95 shadow-xl shadow-green-500/20"
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Domain Tag */}
              <div className="mb-4">
                <span className="bg-[#4318FF]/10 text-[#4318FF] text-[10px] font-bold px-4 py-1.5 rounded-full uppercase tracking-widest">
                  {goal.domainName}
                </span>
              </div>

              {/* Goal Name */}
              <h2 className="text-3xl font-bold text-gray-800 mb-2 tracking-tight group-hover:text-[#4318FF] transition-colors">
                {goal.name}
              </h2>

              {/* Mastery Progress for Kids */}
              {patient.age <= 12 && (
                <div className="flex gap-2 mb-8 items-center">
                  {[1, 2, 3, 4, 5].map((i) => {
                    // Calculate consecutive 1s for this goal
                    // Only count trials recorded AFTER the goal was created in the PEI
                    const skillHistory = (patient.history || [])
                      .filter((h: any) => h.title === goal.name && h.type === 'task' && h.id > goal.id)
                      .sort((a: any, b: any) => b.id - a.id);
                    
                    let count = 0;
                    for (const h of skillHistory) {
                      if (h.score === 1) count++;
                      else break;
                    }
                    
                    const isMastered = goal.status === 'completed';
                    const isActive = i <= count || isMastered;

                    return (
                      <div 
                        key={i} 
                        className={`w-4 h-4 rounded-full transition-all duration-500 ${
                          isMastered ? 'bg-green-500 shadow-lg shadow-green-200' : 
                          isActive ? 'bg-[#4318FF] scale-110 shadow-lg shadow-blue-200' : 
                          'bg-gray-100'
                        }`}
                      ></div>
                    );
                  })}
                  <span className="text-xs font-bold text-gray-400 ml-2 uppercase tracking-widest">
                    {goal.status === 'completed' ? 'Adquirida' : 'Progresso de Maestria'}
                  </span>
                </div>
              )}

              {/* Scoring Buttons */}
              <div className={`grid gap-6 relative ${(goal.maxScore || 1) > 1 || ((goal.maxScore || 1) === 1 && patient.age > 12) ? 'grid-cols-5' : 'grid-cols-3'}`}>
                {(goal.maxScore || 1) === 1 && patient.age <= 12 ? (
                  <>
                    {/* Score 1 */}
                    <button 
                      onClick={() => handleScore(goal, 1)}
                      className="bg-[#05CD99] text-white h-24 rounded-3xl flex items-center justify-center text-4xl font-bold shadow-lg shadow-green-500/20 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                      1
                    </button>

                    {/* Score 0.5 */}
                    <div className="relative">
                      <button 
                        onClick={() => handleScore(goal, 0.5)}
                        className="w-full bg-[#FFB547] text-white h-24 rounded-3xl flex items-center justify-center text-4xl font-bold shadow-lg shadow-orange-500/20 hover:scale-[1.02] active:scale-95 transition-all"
                      >
                        0.5
                      </button>
                      
                      {/* Criteria Tooltip */}
                      {activeCriteria === goal.id && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-64 bg-[#1B254B] text-white p-6 rounded-3xl shadow-2xl animate-pop z-20">
                          <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest mb-2">Critério Pontuação 0.5</p>
                          <p className="text-sm font-medium leading-relaxed">
                            {goal.criteria || "Faz com ajuda física ou verbal parcial."}
                          </p>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[#1B254B]"></div>
                        </div>
                      )}
                    </div>

                    {/* Score 0 */}
                    <button 
                      onClick={() => handleScore(goal, 0)}
                      className="bg-[#EE5D50] text-white h-24 rounded-3xl flex items-center justify-center text-4xl font-bold shadow-lg shadow-red-500/20 hover:scale-[1.02] active:scale-95 transition-all"
                    >
                      0
                    </button>
                  </>
                ) : (
                  // Dynamic buttons for AFLS or other protocols with maxScore > 1
                  Array.from({ length: (goal.maxScore || 1) + 1 }, (_, i) => (goal.maxScore || 1) - i).map((score) => {
                    const colors = [
                      'bg-[#EE5D50] shadow-red-500/20',     // 0
                      'bg-[#FFB547] shadow-orange-500/20',  // 1
                      'bg-[#4318FF] shadow-blue-500/20',    // 2
                      'bg-[#7551FF] shadow-indigo-500/20',  // 3
                      'bg-[#05CD99] shadow-green-500/20'    // 4
                    ];
                    const colorClass = colors[score] || 'bg-gray-500';
                    
                    return (
                      <button 
                        key={score}
                        onClick={() => handleScore(goal, score)}
                        className={`${colorClass} text-white h-24 rounded-3xl flex items-center justify-center text-4xl font-bold shadow-lg hover:scale-[1.02] active:scale-95 transition-all`}
                      >
                        {score}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Criteria Hint */}
              <div className="mt-6 text-center">
                <button 
                  onMouseDown={() => setActiveCriteria(goal.id)}
                  onMouseUp={() => setActiveCriteria(null)}
                  onMouseLeave={() => setActiveCriteria(null)}
                  onTouchStart={() => setActiveCriteria(goal.id)}
                  onTouchEnd={() => setActiveCriteria(null)}
                  className="text-[10px] font-bold text-gray-300 uppercase tracking-[0.3em] hover:text-gray-400 transition-colors"
                >
                  Segure para ver critérios
                </button>
              </div>

              {/* Decorative Icon */}
              <div className="absolute top-10 right-10 opacity-10 group-hover:opacity-30 transition-opacity">
                <Zap size={32} className="text-orange-500" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Patient Photos (Interação durante a sessão) */}
      {patientPhotos.length > 0 && (
        <div className="shrink-0 bg-white border-t border-gray-100 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
              <Camera size={16} className="text-[#4318FF]" />
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Mural de Fotos do Paciente</h3>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
              {patientPhotos.map((photo: any) => (
                <div key={photo.id} className="shrink-0 w-32 h-32 rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:scale-105 transition-all cursor-pointer relative group">
                  <img src={photo.image} alt="Foto do paciente" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2">
                    <p className="text-[8px] font-bold text-white text-center uppercase leading-tight">{photo.title}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
