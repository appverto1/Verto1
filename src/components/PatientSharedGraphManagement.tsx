import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LockKeyhole, Share2, ShieldCheck, XCircle } from 'lucide-react';
import { dataService } from '../services/dataService';

type GraphOption = { graphType:string; graphKey:string; label:string };
type GraphState = {
  canPublish:boolean; canDelegate:boolean; identityReady:boolean;
  publication?:{graph_type:string;graph_key:string;status:string}|null;
  ownedByOtherClinic:boolean; version:number;
  candidates:GraphOption[]; professionals:{id:string;name:string;delegated:boolean}[];
};
export function PatientSharedGraphManagement({patientId}:{patientId:string}) {
  const [state,setState]=useState<GraphState|null>(null);
  const [selection,setSelection]=useState('');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirm,setConfirm]=useState<'publish'|'disable'|null>(null);
  const refresh=useCallback(async()=>{
    const result=await dataService.getPatientSharedGraphManagement(patientId);
    if(result?.success && result.data){
      const current=result.data as GraphState;
      setState(current);
      const selected=current.publication ?
        [current.publication.graph_type,current.publication.graph_key].join('|'):'';
      setSelection(selected);
    }else setError(result?.message||result?.error||'Não foi possível consultar o compartilhamento.');
  },[patientId]);
  useEffect(()=>{
    let active=true;
    setState(null);setError('');setNotice('');
    dataService.getPatientSharedGraphManagement(patientId).then((result:any)=>{
      if(!active)return;
      if(result?.success&&result.data){
        const current=result.data as GraphState;
        setState(current);
        setSelection(current.publication ? [current.publication.graph_type,current.publication.graph_key].join('|') : '');
      }else setError(result?.message||result?.error||'Compartilhamento indisponível.');
    });
    return ()=>{active=false;};
  },[patientId]);
  const apply=async(action:'PUBLISH'|'DISABLE')=>{
    if(!state)return;
    setWorking(true);setError('');setNotice('');
    const selected=state.candidates.find(x=>[x.graphType,x.graphKey].join('|')===selection);
    if(action==='PUBLISH'&&!selected){
      setError('Selecione um gráfico válido antes de salvar.');setWorking(false);setConfirm(null);return;
    }
    const result=await dataService.savePatientSharedGraphPublication(patientId,{
      action,graphType:selected?.graphType||null,graphKey:selected?.graphKey||'',
      expectedVersion:state.version,
    });
    setWorking(false);setConfirm(null);
    if(!result?.success){setError(result?.message||result?.error||'Não foi possível salvar. Atualize para tentar novamente.');await refresh();return;}
    setNotice(action==='PUBLISH'?'Gráfico compartilhado atualizado.':'Compartilhamento desativado.');
    await refresh();
  };
  const changeDelegation=async(professionalId:string,allowed:boolean)=>{
    setWorking(true);setError('');setNotice('');
    const result=await dataService.setPatientSharedGraphDelegation(patientId,professionalId,allowed);
    setWorking(false);
    if(!result?.success){setError(result?.message||result?.error||'Não foi possível alterar a autorização.');return;}
    setNotice(allowed?'Profissional autorizado para este caso.':'Autorização revogada.');
    await refresh();
  };
  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-testid="patient-shared-graph-management">
      <div className="mb-3 flex items-center gap-2"><Share2 size={18} className="text-violet-600"/><h3 className="text-sm font-semibold">Gráfico compartilhado com o responsável</h3></div>
      <p className="mb-4 text-xs leading-5 text-slate-500 dark:text-slate-300">Somente um gráfico clínico pode aparecer no portal infantil. A publicação exige autorização por caso.</p>
      {!state && !error && <p className="text-sm text-slate-500">Verificando permissões...</p>}
      {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
      {state && (
        <>
          {!state.identityReady && <div role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><LockKeyhole size={16} className="mb-1"/> A identidade global deste paciente ainda precisa ser validada. Não é seguro publicar enquanto os vínculos entre clínicas não estiverem confirmados.</div>}
          {state.ownedByOtherClinic && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Há uma publicação ativa de outra clínica. Ela não pode ser substituída automaticamente aqui.</p>}
          {state.publication?.status==='ACTIVE' && <p className="mb-3 flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 size={15}/> Existe um gráfico publicado neste caso.</p>}
          {state.identityReady && state.canPublish && !state.ownedByOtherClinic && (
            <>
              <label className="mb-2 block text-xs font-semibold" htmlFor="graph-sharing-select">Gráfico a compartilhar</label>
              <select id="graph-sharing-select" value={selection} onChange={e=>{setSelection(e.target.value);setConfirm(null);}}
                className="mb-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800">
                <option value="">Selecione um gráfico</option>
                {state.candidates.map(row=><option key={[row.graphType,row.graphKey].join('|')} value={[row.graphType,row.graphKey].join('|')}>{row.label}</option>)}
              </select>
              {confirm && (
                <div role="alertdialog" aria-label="Confirmação de compartilhamento" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="mb-3">{confirm==='disable'?'Ao desativar, o portal infantil ficará sem gráfico até nova publicação.':'Salvar este gráfico desativará o anterior. Apenas o selecionado ficará visível no portal infantil.'}</p>
                  <div className="flex gap-2">
                    <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2" onClick={()=>setConfirm(null)} disabled={working}>Cancelar</button>
                    <button type="button" className="rounded-lg bg-violet-600 px-3 py-2 font-semibold text-white disabled:opacity-50" onClick={()=>void apply(confirm==='disable'?'DISABLE':'PUBLISH')} disabled={working}>Confirmar e salvar</button>
                  </div>
                </div>
              )}
              {!confirm && <div className="flex flex-wrap gap-2">
                <button type="button" disabled={working||!selection} onClick={()=>setConfirm('publish')} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Salvar compartilhamento</button>
                {state.publication?.status==='ACTIVE' && <button type="button" disabled={working} onClick={()=>setConfirm('disable')} className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Desativar</button>}
              </div>}
            </>
          )}
          {state.identityReady&&!state.canPublish&&!state.ownedByOtherClinic && <p className="text-xs text-slate-500">Somente a liderança do caso ou um profissional delegado pode selecionar e compartilhar gráficos.</p>}
          {state.canDelegate && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={16}/> Autorizações dos profissionais do caso</h4>
              {state.professionals.length===0 && <p className="text-xs text-slate-500">Nenhum profissional ativo vinculado a este caso.</p>}
              {state.professionals.map(pro=>(
                <div key={pro.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2">
                  <span className="min-w-0 truncate text-xs">{pro.name}</span>
                  <button type="button" disabled={working||!state.identityReady}
                    onClick={()=>void changeDelegation(pro.id,!pro.delegated)}
                    className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${pro.delegated?'border-rose-200 text-rose-700':'border-violet-200 text-violet-700'}`}>
                    {pro.delegated?<><XCircle size={13} className="mr-1 inline"/>Revogar</>:'Autorizar'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
