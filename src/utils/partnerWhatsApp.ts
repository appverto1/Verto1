export const normalizeBrazilWhatsApp=(raw:string):string|null=>{
  if(typeof raw!=='string'||raw.length>32)return null;
  const digits=raw.replace(/\D/g,'');
  const full=digits.length===10||digits.length===11?'55'+digits:digits;
  return /^55[1-9][0-9][2-9][0-9]{7,8}$/.test(full)?full:null;
};

export const preparePartnerWhatsAppMessage=(template:string,fields:{
  partnerName:string;clinicName:string;
}):string=>{
  if(!template.trim())return '';
  return template.trim().replaceAll('{{parceiro}}',fields.partnerName.trim())
    .replaceAll('{{clinica}}',fields.clinicName.trim())
    .replaceAll('{{link}}','').trim();
};

export const buildPartnerWhatsAppUrl=(phone:string,message:string):string|null=>{
  const normalized=normalizeBrazilWhatsApp(phone);
  if(!normalized||!message.trim())return null;
  return 'https://wa.me/'+normalized+'?text='+encodeURIComponent(message);
};
