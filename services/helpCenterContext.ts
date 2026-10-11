import { createHash } from 'node:crypto';

const setValues = (value:any): string[] => value instanceof Set ? Array.from(value).map(String) : Array.isArray(value) ? value.map(String) : [];

export const createHelpContext = (currentClinicId: (user:any) => string | null) => (req:any) => {
    const clinicId = currentClinicId(req.session?.user);
    const context = req.authorizationContext;
    const audience = String(context?.role || req.session?.user?.role || '').trim().toLowerCase();
    const capabilities = setValues(context?.capabilities);
    const modules = setValues(context?.modules);
    const clinicName = String(context?.clinicName || req.session?.user?.activeAccessContext?.clinicName || req.session?.user?.clinicName || 'Clínica atual');
    const userId=String(context?.userId||req.session?.user?.id||'');
    const membershipId=String(context?.membershipId||'');
    const contextKey=createHash('sha256').update(JSON.stringify([userId,clinicId,membershipId,audience,[...capabilities].sort(),[...modules].sort()])).digest('hex');
    return { clinicId, clinicName, audience, capabilities, modules, userId, membershipId, contextKey };
};
