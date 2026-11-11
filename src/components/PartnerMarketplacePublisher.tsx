import React,{useCallback,useEffect,useState} from 'react';
import {CheckCircle2, Loader2, Store} from 'lucide-react';

type Profile={service_name:string;category:string;description:string;logo_url:string|null;photo_url:string|null;logo_preview_url?:string|null;photo_preview_url?:string|null};
type PartnerLead={
  id:string;contact_name:string;contact_email:string;contact_phone?:string|null;status:string;
  agreed_monthly_cents:number|null;created_at:string;clinic:{name:string}|null;
};
const req=async(path:string,init?:RequestInit)=>{
  const r=await fetch(path,{credentials:'include',cache:'no-store',...init});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data.success!==true)throw new Error(data.error||'Serviço indisponível.');
  return data;
};
const asJson=(method:string,body:unknown):RequestInit=>({
  method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
});

export function PartnerMarketplacePublisher(){
  const [profile,setProfile]=useState({serviceName:'',category:'',description:'',logoUrl:'',photoUrl:''});
  const [logoFile,setLogoFile]=useState<File|null>(null);
  const [photoFile,setPhotoFile]=useState<File|null>(null);
  const [imagePreview,setImagePreview]=useState({logo:'',photo:''});
  const [inbox,setInbox]=useState<PartnerLead[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [confirming,setConfirming]=useState<string|null>(null);
  const [amount,setAmount]=useState('');
  const load=useCallback(async()=>{
    setError('');
    try{
      const d=await req('/api/partnerships/marketplace/partner');
      const p:Profile|null=d.profile||null;
      setProfile({
        serviceName:p?.service_name||'',category:p?.category||'',
        description:p?.description||'',logoUrl:p?.logo_url||'',photoUrl:p?.photo_url||''
      });
      setImagePreview({logo:p?.logo_preview_url||'',photo:p?.photo_preview_url||''});
      setInbox(Array.isArray(d.inbox)?d.inbox:[]);
    }catch(e:any){setError(e.message);}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const selectImage=(kind:'logo'|'photo',file:File|null)=>{
    if(file && (file.size>10*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))){
      setError('Escolha uma imagem JPG, PNG ou WebP com no máximo 10 MB.');
      return;
    }
    setError('');
    if(kind==='logo')setLogoFile(file);
    else setPhotoFile(file);
  };
  const uploadImage=async(kind:'logo'|'photo',file:File)=>{
    const response=await fetch('/api/partnerships/marketplace/partner/image/'+kind,{
      method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':file.type},body:file
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success!==true||typeof result.path!=='string')
      throw new Error(response.status===413?'Imagem ultrapassa o limite de 10 MB.':'Não foi possível enviar a imagem.');
    return result.path as string;
  };
  const saveProfile=async(e:React.FormEvent)=>{
    e.preventDefault();if(saving)return;
    setSaving(true);setError('');setNotice('');
    try{
      // Persist only when Salvar is pressed; no automatic upload on file selection.
      const values={...profile};
      if(logoFile)values.logoUrl=await uploadImage('logo',logoFile);
      if(photoFile)values.photoUrl=await uploadImage('photo',photoFile);
      await req('/api/partnerships/marketplace/partner/profile',asJson('PATCH',values));
      setLogoFile(null);setPhotoFile(null);
      setNotice('Perfil comercial e fotos salvos na vitrine.');
      await load();
    }catch(e:any){setError(e.message);}
    finally{setSaving(false);}
  };
  const confirm=async(e:React.FormEvent)=>{
    e.preventDefault();if(!confirming||saving)return;
    const value=Number(amount);
    const cents=Math.round(value*100);
    if(!Number.isSafeInteger(cents)||cents<1||cents>100000000){
      setError('Informe uma mensalidade válida.');return;
    }
    setSaving(true);setError('');setNotice('');
    try{
      await req('/api/partnerships/marketplace/partner/confirm/'+encodeURIComponent(confirming),
        asJson('POST',{monthlyCents:cents}));
      setNotice('Valor declarado. A clínica deverá confirmar a contratação.');
      setConfirming(null);setAmount('');
      await load();
    }catch(e:any){setError(e.message);}
    finally{setSaving(false);}
  };
  return <section className="space-y-5" aria-label="Sua vitrine de serviços">
    <div className="flex items-start gap-3">
      <Store size={21} className="mt-1 text-violet-700"/>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Sua vitrine na Verto</h2>
        <p className="text-sm text-slate-600">Divulgue seu serviço a clínicas da plataforma e acompanhe contatos autorizados.</p>
      </div>
    </div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
    {loading?<p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin"/>Carregando...</p>:<>
      <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Apresentação comercial</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Nome do serviço
            <input required minLength={2} maxLength={120} value={profile.serviceName}
              onChange={e=>setProfile({...profile,serviceName:e.target.value})}
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Gestão de tráfego pago"/>
          </label>
          <label className="block text-sm font-medium text-slate-700">Categoria
            <input required minLength={2} maxLength={70} value={profile.category}
              onChange={e=>setProfile({...profile,category:e.target.value})}
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Marketing e publicidade"/>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Logo da empresa (até 10 MB)
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={e=>selectImage('logo',e.target.files?.[0]||null)}
              className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm"/>
            {logoFile?<span className="mt-1 block text-xs text-violet-700">{logoFile.name} — será enviado ao salvar</span>
              :imagePreview.logo?<img src={imagePreview.logo} alt="Logo atual" className="mt-2 h-20 w-20 rounded-xl object-contain"/>:null}
          </label>
          <label className="block text-sm font-medium text-slate-700">Foto de apresentação (até 10 MB)
            <input type="file" accept="image/jpeg,image/png,image/webp"
              onChange={e=>selectImage('photo',e.target.files?.[0]||null)}
              className="mt-1 block w-full rounded-xl border border-slate-300 p-3 text-sm"/>
            {photoFile?<span className="mt-1 block text-xs text-violet-700">{photoFile.name} — será enviado ao salvar</span>
              :imagePreview.photo?<img src={imagePreview.photo} alt="Foto atual" className="mt-2 h-20 max-w-full rounded-xl object-cover"/>:null}
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Arquivos JPG, PNG ou WebP. Use fotos autorizadas da empresa ou do serviço;
          não publique imagens identificáveis de pacientes sem consentimento específico.
        </p>
        <label className="block text-sm font-medium text-slate-700">Descrição do serviço
          <textarea required minLength={20} maxLength={2000} rows={4} value={profile.description}
            onChange={e=>setProfile({...profile,description:e.target.value})}
            className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" placeholder="Conte como sua empresa pode ajudar as clínicas."/>
        </label>
        <button type="submit" disabled={saving} className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving?'Salvando...':'Salvar apresentação'}
        </button>
      </form>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Interesses recebidos</h3>
        <p className="mt-1 text-xs text-slate-500">Contato liberado expressamente pelo representante da clínica. Não use para outras finalidades.</p>
        {inbox.length===0?<p className="mt-4 text-sm text-slate-500">Nenhuma indicação recebida.</p>
          :<ul className="mt-3 divide-y divide-slate-100">
            {inbox.map(lead=><li key={lead.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{lead.clinic?.name||'Clínica interessada'}</p>
                  <p className="mt-1 text-sm text-slate-700">{lead.contact_name}</p>
                  <p className="break-all text-sm text-slate-600">{lead.contact_email}</p>
                  {lead.contact_phone && <p className="text-sm text-slate-600">{lead.contact_phone}</p>}
                  <p className="mt-1 text-xs text-slate-500">{lead.status==='active'?'Contratação confirmada por ambas as partes':lead.status==='awaiting_clinic'?'Aguardando confirmação da clínica':lead.status==='declined'?'Parceria ou interesse encerrado':'Interesse recebido'}</p>
                </div>
                {lead.status==='interested' && <button type="button" onClick={()=>{setConfirming(lead.id);setAmount('');}}
                  className="rounded-xl border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-700">Declarar contratação</button>}
                {lead.status==='active' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={16}/> Confirmada</span>}
              </div>
            </li>)}
          </ul>}
        <p className="mt-3 text-xs text-slate-500">Comissões de indicação da Verto ao parceiro (proposta: 10% por 6 meses) dependem de contrato e comprovação de pagamentos. Não há repasse automático.</p>
      </div>
    </>}
    {confirming&&<div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Declarar contratação">
      <form onSubmit={confirm} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="font-semibold text-slate-900">Declarar contratação</h3>
        <p className="mt-2 text-sm text-slate-600">Informe o valor mensal real do serviço contratado, sem incluir a verba de anúncios. A clínica deverá confirmar esse valor.</p>
        <label className="mt-4 block text-sm font-medium text-slate-700">Mensalidade do serviço (R$)
          <input type="number" required min="0.01" max="1000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm"/>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={()=>setConfirming(null)} className="rounded-xl px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar declaração</button>
        </div>
      </form>
    </div>}
  </section>;
}
