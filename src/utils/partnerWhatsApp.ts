export const normalizeBrazilWhatsApp=(raw:string):string|null=>{
  if(typeof raw!=='string'||raw.length>32)return null;
  const digits=raw.replace(/\D/g,'');
  const full=digits.length===10||digits.length===11?'55'+digits:digits;
  return /^55[1-9][0-9][2-9][0-9]{7,8}$/.test(full)?full:null;
};

export const preparePartnerWhatsAppMessage=(template:string,fields:{
  partnerName:string;clinicName:string;referralLink:string;
}):string=>{
  if(!template.trim()||!/^https:\/\/[^/]+\/interesse\?ref=/.test(fields.referralLink))return '';
  const includesLink=template.includes('{{link}}');
  const body=template.trim().replaceAll('{{parceiro}}',fields.partnerName.trim())
    .replaceAll('{{clinica}}',fields.clinicName.trim())
    .replaceAll('{{link}}',fields.referralLink);
  return includesLink?body:body+'\n\n'+fields.referralLink;
};

export const buildPartnerWhatsAppUrl=(phone:string,message:string):string|null=>{
  const normalized=normalizeBrazilWhatsApp(phone);
  if(!normalized||!message.trim())return null;
  return 'https://wa.me/'+normalized+'?text='+encodeURIComponent(message);
};
