import React, { useState, useMemo } from 'react';
import { Clock, CheckSquare, X, ClipboardCheck, Info } from 'lucide-react';
import { SecureImage } from './SecureMedia';
import { sanitizeDescriptionForDisplay } from '../utils/mediaSecurity';

const repairMojibake = (value: any): string => {
  const raw = String(value ?? '');
  if (!raw) return '';
  if (!/[Ãâð]/.test(raw)) return raw;
  try {
    const bytes = Uint8Array.from([...raw].map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return decoded || raw;
  } catch {
    return raw;
  }
};

const getMasteryTarget = (goal: any, fallbackSkill?: any) => {
  const target = Number(
    goal?.meta_sucessos ??
    goal?.metaSucessos ??
    goal?.masteryTarget ??
    goal?.mastery_target ??
    fallbackSkill?.meta_sucessos ??
    fallbackSkill?.metaSucessos ??
    fallbackSkill?.masteryTarget ??
    fallbackSkill?.mastery_target
  );
  return Number.isFinite(target) && target > 0 ? Math.floor(target) : 5;
};

const firstHistoryText = (...values: any[]) =>
  values.map((value) => String(value || '').trim()).find(Boolean) || '';

const getFamilyHistoryImageSource = (item: any) => {
  const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const attachments = [
    ...(Array.isArray(item?.attachments) ? item.attachments : []),
    ...(Array.isArray(item?.files) ? item.files : []),
    ...(Array.isArray(item?.photos) ? item.photos : []),
    ...(Array.isArray(metadata?.attachments) ? metadata.attachments : []),
    ...(Array.isArray(metadata?.files) ? metadata.files : []),
    ...(Array.isArray(metadata?.photos) ? metadata.photos : [])
  ].filter((entry) => entry && typeof entry === 'object');
  const direct = firstHistoryText(
    item?.image,
    item?.image_url,
    item?.imageUrl,
    item?.photo,
    item?.photo_url,
    item?.photoUrl,
    item?.url,
    metadata?.image,
    metadata?.image_url,
    metadata?.imageUrl,
    metadata?.photo,
    metadata?.photo_url,
    metadata?.photoUrl,
    metadata?.url,
    ...attachments.flatMap((entry: any) => [
      entry?.image,
      entry?.image_url,
      entry?.imageUrl,
      entry?.photo,
      entry?.photo_url,
      entry?.photoUrl,
      entry?.url
    ])
  );
  if (direct) return direct;
  const path = firstHistoryText(
    item?.image_path,
    item?.imagePath,
    item?.storage_path,
    item?.storagePath,
    item?.photo_path,
    item?.photoPath,
    item?.path,
    metadata?.image_path,
    metadata?.imagePath,
    metadata?.storage_path,
    metadata?.storagePath,
    metadata?.photo_path,
    metadata?.photoPath,
    metadata?.path,
    ...attachments.flatMap((entry: any) => [
      entry?.image_path,
      entry?.imagePath,
      entry?.storage_path,
      entry?.storagePath,
      entry?.photo_path,
      entry?.photoPath,
      entry?.path
    ])
  );
  if (!path) return '';
  return path.startsWith('patient-photos/') ? path : `patient-photos/${path}`;
};

export const HistoryCard = ({ item, energyTags, isTherapist, onEvaluate, protocols = [], id, isKid, fullHistory = [], peiGoals = [] }: any) => { 
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isSavingMilestone, setIsSavingMilestone] = useState(false); 
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

  const masteryProgress = useMemo(() => {
    if (!isKid || !item.title || item.type !== 'task' || item.score !== 1) return null;
    const goal = peiGoals.find((g: any) => g.name === item.title);
    const target = getMasteryTarget(goal, matchedSkill);
    const skillHistory = fullHistory
      .filter((h: any) => h.title === item.title && h.type === 'task' && h.id <= item.id && (!goal || h.id > goal.id))
      .sort((a: any, b: any) => b.id - a.id);
    
    let count = 0;
    for (const h of skillHistory) {
      if (h.score === 1) count++;
      else break;
    }
    return { count: Math.min(count, target), target };
  }, [isKid, item.title, item.type, fullHistory, peiGoals, matchedSkill]);

  const maxScore = useMemo(() => { 
    // Default to 1 for VB-MAPP style scoring as requested
    const val = matchedSkill && typeof matchedSkill.maxScore === 'number' ? matchedSkill.maxScore : 1; 
    return Math.max(0, val); 
  }, [matchedSkill]); 

  const emitEvaluate = (updates: any) => {
    if (typeof onEvaluate !== 'function') return;
    if (onEvaluate.length >= 3) {
      return onEvaluate(item.id, updates?.score, updates?.evalComment || '');
    }
    return onEvaluate(item.id, updates);
  };

  const handleSave = () => { 
    const updates: any = { evalComment };
    if (item.type !== 'intervention') {
      updates.score = parseFloat(score);
    } else {
      updates.linkedTask = linkedTask;
    }
    emitEvaluate(updates);
    setIsEvaluating(false); 
  }; 

  const isFamilyEntry = item.type === 'family_note' || item.type === 'photo';
  const familyImageSource = getFamilyHistoryImageSource(item);
  const displayTitle = repairMojibake(item?.title);
  const displayNote = sanitizeDescriptionForDisplay(repairMojibake(item?.note));
  const displayIcon = (() => {
    const raw = repairMojibake(item?.icon).trim();
    const looksCorrupted = /�|ðŸ|Ã|â/.test(raw);
    if (raw && raw !== '??' && !looksCorrupted && raw.length <= 4) return raw;
    if (item?.type === 'photo') return '📷';
    if (item?.type === 'family_note') return '🏠';
    if (item?.type === 'intervention') return '🧩';
    if (item?.type === 'task') return '🎯';
    return '📝';
  })();
  const energyValue =
    item?.energy !== null && item?.energy !== undefined
      ? Number(item.energy)
      : item?.patientEffort !== null && item?.patientEffort !== undefined
        ? Number(item.patientEffort)
        : null;
  const hasStarMarker = /\u2b50|⭐/.test(String(item?.subject || ''));
  const isMilestoneAwarded = Boolean(item?.milestoneAwarded) || Number(item?.score ?? 0) >= 1 || hasStarMarker;
  const handleToggleMilestone = async () => {
    if (isSavingMilestone) return;
    setIsSavingMilestone(true);
    try {
      await emitEvaluate({
        score: isMilestoneAwarded ? 0 : 1,
        evalComment: evalComment || item.evalComment || ''
      });
    } finally {
      setIsSavingMilestone(false);
    }
  };

  return ( 
    <div id={id} className="bg-white rounded-2xl p-5 card-shadow hover:shadow-lg transition-shadow mb-4 animate-fade-in border border-transparent hover:border-gray-100"> 
      <div className="flex justify-between items-start mb-3"> 
        <div className="flex items-center gap-2"> 
          <span className="text-xl p-2 bg-gray-50 rounded-lg">{displayIcon}</span> 
          <div> 
            <h4 className="font-semibold text-gray-800">{displayTitle}</h4> 
            <div className="flex flex-wrap gap-1 mt-0.5">
              {matchedSkill && <span className="text-[9px] bg-purple-50 text-[#7a32fc] px-1.5 py-0.5 rounded uppercase font-semibold tracking-wide">Protocolo Vinculado</span>} 
              {item.linkedTask && (
                <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded uppercase font-semibold tracking-wide border border-green-100">
                  Foco: {item.linkedTask}
                </span>
              )}
            </div>
            {masteryProgress !== null && (
              <div className="flex gap-0.5 mt-1 flex-wrap max-w-[160px]">
                {Array.from({ length: masteryProgress.target }, (_, index) => index + 1).map((i) => (
                  <div key={i} className={`${masteryProgress.target > 30 ? 'w-1 h-1' : 'w-1.5 h-1.5'} rounded-full ${i <= masteryProgress.count ? 'bg-[#7a32fc]' : 'bg-gray-200'}`}></div>
                ))}
              </div>
            )}
          </div> 
          {item.tag && energyTags && ( 
            <span className="text-[10px] uppercase font-semibold bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full"> 
              {energyTags.find((t: any) => t.id === item.tag)?.label || item.tag} 
            </span> 
          )} 
        </div> 
        <div className="flex flex-col items-end gap-1"> 
          <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-lg"><Clock size={12} /> {item.time}</span> 
          {isTherapist && item.score !== undefined && item.type !== 'intervention' && !isFamilyEntry && <span className="text-[10px] font-semibold text-white bg-green-500 px-2 py-0.5 rounded-md shadow-sm animate-pop">Pontuação: {item.score}</span>} 
        </div> 
      </div> 
      {(item.note || familyImageSource) && (
        <div className={`rounded-xl p-3 text-sm italic border mb-3 ${item.type === 'intervention' ? 'bg-green-50 text-green-800 border-green-100' : (item.type === 'family_note' || item.type === 'photo') ? 'bg-orange-50 text-orange-800 border-orange-100' : 'bg-[#F4F7FE] text-gray-600 border-blue-50'}`}>
          <p className="text-[10px] font-semibold uppercase mb-1 opacity-60">{(item.type === 'family_note' || item.type === 'photo') ? 'Registro da Família:' : 'Anotações do Paciente:'}</p>
          {displayNote && <p>"{displayNote}"</p>}
          {familyImageSource && (
            <div className={`${item.note ? 'mt-3' : ''} rounded-lg overflow-hidden border border-orange-200`}>
              <SecureImage src={familyImageSource} alt="Registro da Família" className="w-full max-w-[380px] max-h-56 object-contain bg-white mx-auto" />
            </div>
          )}
        </div>
      )} 
      {isTherapist && energyValue !== null && Number.isFinite(energyValue) && (
        <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600">Energia do paciente</p>
          <p className="text-sm font-semibold text-emerald-800">{energyValue}%</p>
        </div>
      )}
      {isTherapist && isFamilyEntry && (
        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
          <button type="button" onClick={() => void handleToggleMilestone()} disabled={isSavingMilestone} aria-busy={isSavingMilestone} className={`text-[10px] font-semibold px-4 py-2 rounded-xl shadow-sm transition-all uppercase tracking-widest disabled:cursor-wait disabled:opacity-60 ${isMilestoneAwarded ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-[#7551FF] text-white hover:opacity-90'}`}> 
            {isSavingMilestone ? 'Salvando...' : isMilestoneAwarded ? 'Remover Estrelinha' : 'Validar Marco ⭐'}
          </button>
        </div>
      )}
      {isTherapist && item.type !== 'family_note' && item.type !== 'photo' && ( 
        <div className="mt-4 pt-3 border-t border-gray-100"> 
          {!isEvaluating ? ( 
            <div className="flex justify-between items-center"> 
              {item.evalComment ? ( <p className="text-xs text-[#7551FF] italic">Anotações do Profissional: {sanitizeDescriptionForDisplay(item.evalComment)}</p> ) : <span></span>} 
              <button onClick={() => setIsEvaluating(true)} className="text-[10px] font-semibold text-white bg-[#7551FF] px-4 py-2 rounded-xl shadow-md shadow-[#7551FF]/20 hover:opacity-90 transition-all flex items-center gap-2 uppercase tracking-widest"> 
                <CheckSquare size={14}/> {item.score !== undefined ? 'Editar Avaliação' : 'Avaliar Tarefa'} 
              </button> 
            </div> 
          ) : ( 
            <div className="bg-gray-50 p-4 rounded-xl animate-slide-up"> 
              <div className="flex justify-between items-center mb-3"> 
                <h5 className="font-semibold text-gray-700 text-sm flex items-center gap-2"><ClipboardCheck size={16} className="text-[#7551FF]"/> Avaliação Técnica</h5> 
                <button onClick={() => setIsEvaluating(false)}><X size={16} className="text-gray-400 hover:text-red-500"/></button> 
              </div> 

              {item.type !== 'intervention' && matchedSkill && matchedSkill.criteria && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Info size={12} className="text-blue-500" />
                    <span className="font-semibold uppercase tracking-widest text-[10px] text-blue-500">Critérios de Pontuação</span>
                  </div>
                  <p className="text-xs text-blue-800 leading-relaxed font-medium">{matchedSkill.criteria}</p>
                </div>
              )}

              {item.type === 'intervention' ? (
                <div className="space-y-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 tracking-widest">Vincular a Habilidade de Avaliação</label>
                    <select 
                      className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-semibold text-gray-700 outline-none focus:border-[#7551FF]" 
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
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 tracking-widest">Anotações do Profissional</label>
                    <textarea 
                      className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-[#7551FF] h-20 resize-none font-medium" 
                      placeholder="Descreva como foi a intervenção..." 
                      value={evalComment} 
                      onChange={(e) => setEvalComment(e.target.value)} 
                    />
                  </div>
                </div>
              ) : item.type === 'photo' ? (
                <div className="mb-3">
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 tracking-widest">Observação do Profissional</label>
                  <input type="text" className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-[#7551FF] font-medium" placeholder="Observação para o prontuário..." value={evalComment} onChange={(e) => setEvalComment(e.target.value)} />
                </div>
              ) : (
                <div className="grid grid-cols-[80px_1fr] gap-3 mb-3"> 
                  <div> 
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 tracking-widest">Pontuação (0-{maxScore})</label> 
                    <select className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm font-semibold text-gray-700 outline-none focus:border-[#7551FF]" value={score} onChange={(e) => setScore(e.target.value)}> 
                      <option value="">-</option> 
                      {maxScore === 1 ? (
                        <React.Fragment>
                          <option value={0}>0</option>
                          <option value={0.5}>0.5</option>
                          <option value={1}>1</option>
                        </React.Fragment>
                      ) : (
                        [...Array(Math.floor(maxScore) + 1)].map((_, i) => (<option key={i} value={i}>{i}</option>))
                      )}
                    </select> 
                  </div> 
                  <div> 
                    <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1 tracking-widest">Anotações do Profissional</label> 
                    <input type="text" className="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs outline-none focus:border-[#7551FF] font-medium" placeholder="Observação para o prontuário..." value={evalComment} onChange={(e) => setEvalComment(e.target.value)} /> 
                  </div> 
                </div> 
              )}
              <button onClick={handleSave} className="w-full bg-green-500 text-white font-semibold py-2 rounded-lg text-[10px] shadow-md hover:bg-green-600 transition-colors uppercase tracking-widest">Salvar Avaliação</button> 
            </div> 
          )} 
        </div> 
      )} 
    </div> 
  ); 
};
