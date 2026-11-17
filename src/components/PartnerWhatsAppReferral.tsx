import React, {useCallback,useEffect,useRef,useState} from 'react';
import {Check, Loader2, MessageCircle, Plus, Trash2} from 'lucide-react';
import {buildPartnerWhatsAppUrl,normalizeBrazilWhatsApp,preparePartnerWhatsAppMessage} from '../utils/partnerWhatsApp';
import {PARTNER_WHATSAPP_COPY} from '../constants/partnerWhatsAppCopy';

type Contact={id:string;clinic_name:string;phone_e164:string;created_at:string};
type Props={mode:'external'|'professional';referralLink:string;partnerName:string;messageTemplate?:string|null};
const inputClass='w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';

export function PartnerWhatsAppReferral({mode,referralLink,partnerName,messageTemplate=PARTNER_WHATSAPP_COPY}:Props){
  const [clinicName,setClinicName]=useState('');
  const [phoneRows,setPhoneRows]=useState([{id:0,value:''}]);
  const nextPhoneId=useRef(1);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [savedRows,setSavedRows]=useState<Record<number,Contact>>({});
  const [savedCount,setSavedCount]=useState(0);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const base='/api/partnerships/'+(mode==='external'?'portal':'me')+'/whatsapp-contacts';
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(base,{credentials:'include',cache:'no-store',signal});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success!==true)throw new Error('Não foi possível consultar os contatos.');
    return Array.isArray(result.contacts)?result.contacts as Contact[]:[];
  },[base]);
  useEffect(()=>{
    const controller=new AbortController();
    void load(controller.signal).then(data=>{
      if(!controller.signal.aborted)setContacts(data);
    }).catch(()=>{
      if(!controller.signal.aborted)setError('Os contatos salvos estão indisponíveis. Tente novamente.');
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[load]);
  const updatePhone=(id:number,value:string)=>{
    setPhoneRows(previous=>previous.map(row=>row.id===id?{...row,value}:row));
    setSavedRows(previous=>{const next={...previous};delete next[id];return next;});
    setSavedCount(0);
  };
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(saving)return;
    const name=clinicName.trim();
    const normalized=phoneRows.map(row=>normalizeBrazilWhatsApp(row.value));
    if(name.length<2||name.length>180||normalized.some(value=>!value)
      ||new Set(normalized).size!==normalized.length){
      setError('Informe a clínica e números válidos com DDD, sem repetições.');
      return;
    }
    setSaving(true);setError('');setSavedCount(0);
    try{
      const response=await fetch(base,{
        method:'POST',credentials:'include',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({clinicName:name,phones:phoneRows.map(row=>row.value)}),
      });
      const result=await response.json().catch(()=>({}));
      const saved=Array.isArray(result.contacts)?result.contacts as Contact[]:[];
      if(!response.ok||result.success!==true||saved.length!==phoneRows.length
        ||saved.some(contact=>!contact.id))
        throw new Error('Não foi possível salvar as oportunidades. Tente novamente.');
      const byPhone=new Map(saved.map(contact=>[contact.phone_e164,contact]));
      const nextSaved:Record<number,Contact>={};
      for(const row of phoneRows){
        const contact=byPhone.get(normalizeBrazilWhatsApp(row.value)!);
        if(!contact)throw new Error('Não foi possível confirmar todos os números salvos.');
        nextSaved[row.id]=contact;
      }
      setSavedRows(nextSaved);
      setSavedCount(saved.length);
      setContacts(previous=>[
        ...saved,...previous.filter(contact=>!saved.some(item=>item.id===contact.id))
      ].slice(0,25));
    }catch(err:any){setError(err?.message||'Não foi possível salvar as oportunidades.');}
    finally{setSaving(false);}
  };
  const messageFor=(contact:Contact)=>messageTemplate
    ? preparePartnerWhatsAppMessage(messageTemplate,{partnerName,clinicName:contact.clinic_name,referralLink})
    : '';
  const linkFor=(contact:Contact)=>buildPartnerWhatsAppUrl(contact.phone_e164,messageFor(contact));
  const shareButton=(contact:Contact)=> {
    const href=linkFor(contact);
    return href
      ? <a href={href} target="_blank" rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800">
          <MessageCircle size={16}/> Enviar mensagem
        </a>
      : <button type="button" disabled
          title="Aguardando aprovação da mensagem comercial"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-500">
          <MessageCircle size={16}/> Mensagem em definição
        </button>;
  };
  return <section className="mb-7 rounded-2xl border border-violet-100 bg-violet-50/40 p-4 sm:p-5" aria-labelledby="partner-whatsapp-title">
    <h3 id="partner-whatsapp-title" className="text-sm font-semibold text-violet-800">Cadastre aqui suas oportunidades</h3>
    <p className="mt-2 text-xs leading-5 text-slate-600">Cadastre a clínica e um ou mais números de WhatsApp. Depois de salvar, use “Enviar mensagem” ao lado de cada contato para abrir a conversa com o texto pronto. Você escolhe quando enviar.</p>
    <form onSubmit={event=>{void save(event);}} className="mt-4 space-y-3">
      <label className="block space-y-1 text-xs font-medium text-slate-700">
        Nome da clínica
        <input id="partner-whatsapp-clinic" className={inputClass} maxLength={180} required
          value={clinicName} onChange={e=>{setClinicName(e.target.value);setSavedRows({});setSavedCount(0);}}
          placeholder="Nome da clínica" autoComplete="organization"/>
      </label>
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-700">Números de WhatsApp da clínica</p>
        {phoneRows.map((row,index)=><div key={row.id} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[160px] flex-1 space-y-1 text-xs text-slate-600">
            <span>WhatsApp {index+1}</span>
            <input id={index===0?'partner-whatsapp-phone':'partner-whatsapp-phone-'+row.id}
              className={inputClass} type="tel" inputMode="tel" maxLength={32} required
              value={row.value} onChange={e=>updatePhone(row.id,e.target.value)}
              placeholder="(11) 99999-9999" autoComplete="off"/>
          </label>
          {savedRows[row.id]
            ? shareButton(savedRows[row.id])
            : <button type="button" disabled title="Salve a oportunidade para liberar o envio"
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-500">
                <MessageCircle size={16}/> Enviar mensagem
              </button>}
          {phoneRows.length>1&&<button type="button" disabled={saving}
            aria-label={'Remover WhatsApp '+(index+1)}
            onClick={()=>{setPhoneRows(previous=>previous.filter(item=>item.id!==row.id));
              setSavedRows(previous=>{const next={...previous};delete next[row.id];return next;});
              setSavedCount(0);}}
            className="rounded-lg p-2.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            <Trash2 size={16}/>
          </button>}
        </div>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={saving||phoneRows.length>=10}
          onClick={()=>{setPhoneRows(previous=>[...previous,{id:nextPhoneId.current++,value:''}]);setSavedCount(0);}}
          className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-xs font-semibold text-violet-700 disabled:opacity-50">
          <Plus size={16}/> Adicionar outro número
        </button>
        <button type="submit" disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>}
          {saving?'Salvando...':'Salvar oportunidades'}
        </button>
        {savedCount>0 && <span role="status" className="text-xs font-medium text-emerald-700">
          {savedCount===1?'1 contato salvo.':savedCount+' contatos salvos.'}
        </span>}
      </div>
    </form>
    {error && <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
    {!messageTemplate && <p className="mt-3 text-xs text-amber-800">O texto comercial está em definição. O botão do WhatsApp será liberado após a aprovação da mensagem.</p>}
    <p className="mt-3 text-xs text-slate-500">Salvar oportunidades não registra indicações nem gera comissões. A atribuição ocorre quando a clínica se cadastra pelo seu link exclusivo. Aborde apenas contatos comerciais com quem você tenha relação ou autorização.</p>
    {loading
      ? <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin"/> Carregando contatos...</p>
      : contacts.length>0 && <div className="mt-5 border-t border-violet-100 pt-4">
        <p className="mb-2 text-xs font-semibold text-slate-700">Oportunidades salvas recentemente</p>
        <ul className="divide-y divide-violet-100">
          {contacts.map(contact=><li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 text-xs text-slate-700"><strong className="block truncate">{contact.clinic_name}</strong>{contact.phone_e164}</span>
            {shareButton(contact)}
          </li>)}
        </ul>
      </div>}
  </section>;
}
