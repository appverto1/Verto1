import React, { useState, useMemo } from 'react';
import { Clock, CheckSquare, X, ClipboardCheck, Info } from 'lucide-react';

export const HistoryCard = ({ item, energyTags, isTherapist, onEvaluate, protocols = [], id, isKid, fullHistory = [], peiGoals = [] }: any) => { 
  const [isEvaluating, setIsEvaluating] = useState(false); 
  const [score, setScore] = useState(item.score !== undefined ? item.score : ''); 
  const [evalComment, setEvalComment] = useState(item.evalComment || ''); 
  const [linkedTask, setLinkedTask] = useState(item.linkedTask || '');
  
  const evaluationSkills = useMemo(() => {
    const skills: any[] = [];
    if (!protocols) return skills;
    protocols.filter((p: any) => p.category === 'evaluation' || !p.category).forEach((p: any) => {
      p.data.forEach((domain: any) => {
        domain.skills.forEach((skill: any) => {
          skills.push({ id: skill.id, name: skill.name, protocol: p.title });
        });
      });
    });
    return skills;
  }, [protocols]);

  const masteryProgress = useMemo(() => {
    if (!isKid || !item.title || item.type !== 'task' || item.score !== 1) return null;
    const goal = peiGoals.find((g: any) => g.name === item.title);
    const skillHistory = fullHistory
      .filter((h: any) => h.title === item.title && h.type === 'task' && h.id <= item.id && (!goal || h.id > goal.id))
      .sort((a: any, b: any) => b.id - a.id);
    
    let count = 0;
    for (const h of skillHistory) {
      if (h.score === 1) count++;
      else break;
    }
    return Math.min(count, 5);
  }, [isKid, item.title, item.type, fullHistory]);

  const matchedSkill = useMemo(() => { 
    if (!protocols || !item.title) return null; 
    for (const proto of protocols) { 
      for (const domain of proto.data) { 
        const skill = domain.skills.find((s: any) => s.name.trim().toLowerCase() === item.title.trim().toLowerCase()); 
        if (skill) return skill; 
      } 
    } 
    return null; 
  }, [protocols, item.title]); 

  const maxScore = useMemo(() => { 
    // Default to 1 for VB-MAPP style scoring as requested
    const val = matchedSkill && typeof matchedSkill.maxScore === 'number' ? matchedSkill.maxScore : 1; 
    return Math.max(0, val); 
  }, [matchedSkill]); 

  const handleSave = () => { 
    if (typeof onEvaluate === 'function') { 
      const updates: any = { evalComment };
      if (item.type !== 'intervention') {
        updates.score = parseFloat(score);
      } else {
        updates.linkedTask = linkedTask;
      }
      onEvaluate(item.id, updates); 
      setIsEvaluating(false); 
    } 
  }; 

  return ( 
    <div id={id} className="bg-white rounded-2xl p-5 card-shadow hover:shadow-lg transition-shadow mb-4 animate-fade-in border border-transparent hover:border-gray-100"> 
      <div className="flex justify-between items-start mb-3"> 
        <div className="flex items-center gap-2"> 
          <span className="text-xl p-2 bg-gray-50 rounded-lg">{item.icon}</span> 
          <div> 
            <h4 className="font-bold text-gray-800">{item.title}</h4> 
            <div className="flex flex-wrap gap-1 mt-0.5">
              {matchedSkill && <span className="text-[9px] bg-blue-50 text-[#4318FF] px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">Protocolo Vinculado</span>} 
              {item.linkedTask && (
                <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide border border-green-100">
                  Foco: {item.linkedTask}
                </span>
              )}
            </div>
            {masteryProgress !== null && (
              <div className="flex gap-0.5 mt-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`w-1.5 h-1.5 rounded-full ${i <= masteryProgress ? 'bg-[#4318FF]' : 'bg-gray-200'}`}></div>
                ))}
              </div>
            )}
          </div> 
          {item.tag && energyTags && ( 
            <span className="text-[10px] uppercase font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full"> 
              {energyTags.find((t: any) => t.id === item.tag)?.label || item.tag} 
            </span> 
          )} 
        </div> 
        <div className="flex flex-col items-end gap-1"> 
          <span className="text-xs font-bold text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-lg"><Clock size={12} /> {item.time}</span> 
          {isTherapist && item.score !== undefined && item.type !== 'intervention' && <span className="text-xs font-bold text-white bg-green-500 px-2 py-0.5 rounded-md shadow-sm animate-pop">Pontuação: {item.score}</span>} 
        </div> 
      </div> 
      {(item.note || item.image) && (
        <div className={`rounded-xl p-3 text-sm italic border mb-3 ${item.type === 'intervention' ? 'bg-green-50 text-green-800 border-green-100' : (item.type === 'family_note' || item.type === 'photo') ? 'bg-orange-50 text-orange-800 border-orange-100' : 'bg-[#F4F7FE] text-gray-600 border-blue-50'}`}>
          <p className="text-[10px] font-bold uppercase mb-1 opacity-60">{(item.type === 'family_note' || item.type === 'photo') ? 'Registro da Família:' : 'Anotações do Paciente:'}</p>
          {item.note && <p>"{item.note}"</p>}
          {item.image && (
            <div className={`${item.note ? 'mt-3' : ''} rounded-lg overflow-hidden border border-orange-200`}>
              <img src={item.image} alt="Registro da Família" className="w-full h-auto" referrerPolicy="no-referrer" />
            </div>
          )}
        </div>
      )} 
      {isTherapist && item.type !== 'family_note' && ( 
        <div className="mt-4 pt-3 border-t border-gray-100"> 
          {!isEvaluating ? ( 
            <div className="flex justify-between items-center"> 
              {item.evalComment ? ( <p className="text-xs text-[#7551FF] italic">Anotações do Profissional: {item.evalComment}</p> ) : <span></span>} 
              <button onClick={() => setIsEvaluating(true)} className="text-xs font-bold text-white bg-[#7551FF] px-4 py-2 rounded-xl shadow-md shadow-[#7551FF]/20 hover:opacity-90 transition-all flex items-center gap-2"> 
                <CheckSquare size={14}/> {item.score !== undefined ? 'Editar Avaliação' : 'Avaliar Tarefa'} 
              </button> 
            </div> 
          ) : ( 
            <div className="bg-gray-50 p-4 rounded-xl animate-slide-up"> 
              <div className="flex justify-between items-center mb-3"> 
                <h5 className="font-bold text-gray-700 text-sm flex items-center gap-2"><ClipboardCheck size={16} className="text-[#7551FF]"/> Avaliação Técnica</h5> 
                <button onClick={() => setIsEvaluating(false)}><X size={16} className="text-gray-400 hover:text-red-500"/></button> 
              </div> 

              {item.type !== 'intervention' && matchedSkill && matchedSkill.criteria && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Info size={12} className="text-blue-500" />
                    <span className="font-bold uppercase tracking-wider text-[10px] text-blue-500">Critérios de Pontuação</span>
                  </div>
                  <p className="text-xs text-blue-800 leading-relaxed font-medium">{matchedSkill.criteria}</p>
                </div>
              )}

              {item.type === 'intervention' ? (
                <div className="space-y-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Vincular a Habilidade de Avaliação</label>
                    <select 
                      className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-gray-700 outline-none focus:border-[#7551FF]" 
                      value={linkedTask} 
                      onChange={(e) => setLinkedTask(e.target.value)}
                    >
                      <option value="">Nenhuma vinculação</option>
                      {evaluationSkills.map((s: any) => (
                        <option key={s.id} value={s.name}>{s.name} ({s.protocol})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Anotações do Profissional</label>
                    <textarea 
                      className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-[#7551FF] h-20 resize-none" 
                      placeholder="Descreva como foi a intervenção..." 
                      value={evalComment} 
                      onChange={(e) => setEvalComment(e.target.value)} 
                    />
                  </div>
                </div>
              ) : item.type === 'photo' ? (
                <div className="mb-3">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Observação do Profissional</label>
                  <input type="text" className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-[#7551FF]" placeholder="Observação para o prontuário..." value={evalComment} onChange={(e) => setEvalComment(e.target.value)} />
                </div>
              ) : (
                <div className="grid grid-cols-[80px_1fr] gap-3 mb-3"> 
                  <div> 
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pontuação (0-{maxScore})</label> 
                    <select className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm font-bold text-gray-700 outline-none focus:border-[#7551FF]" value={score} onChange={(e) => setScore(e.target.value)}> 
                      <option value="">-</option> 
                      {[...Array(Math.floor(maxScore) + 1)].map((_, i) => (<option key={i} value={i}>{i}</option>))}
                    </select> 
                  </div> 
                  <div> 
                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Anotações do Profissional</label> 
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-[#7551FF]" placeholder="Observação para o prontuário..." value={evalComment} onChange={(e) => setEvalComment(e.target.value)} /> 
                  </div> 
                </div> 
              )}
              <button onClick={handleSave} className="w-full bg-green-500 text-white font-bold py-2 rounded-lg text-xs shadow-md hover:bg-green-600 transition-colors">Salvar Avaliação</button> 
            </div> 
          )} 
        </div> 
      )} 
    </div> 
  ); 
};
