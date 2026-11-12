export const createSchoolErrorResponse = (sanitizeString: (value: any, max?: number) => string) => (res: any, error: any, fallback = 'Não foi possível concluir a operação escolar.') => {
    const raw = String(error?.message || error?.code || error || '');
    const conflictMatch = raw.match(/SCHOOL_PROFESSIONAL_CONFLICT:(\{.*\})/);
    if (conflictMatch) {
      let conflict: any = null;
      try { conflict = JSON.parse(conflictMatch[1]); } catch { conflict = { detail: conflictMatch[1] }; }
      return res.status(409).json({ success: false, error: 'SCHOOL_PROFESSIONAL_CONFLICT', message: 'Um profissional já possui outro compromisso nesse horário.', conflict });
    }
    if (/IDEMPOTENCY_CONFLICT|23505|duplicate/i.test(raw)) return res.status(409).json({ success: false, error: 'SCHOOL_CONFLICT', message: 'A operação conflita com um registro existente ou com outra tentativa.' });
    if (/CONSENT_REQUIRED|CONSENT_INVALID|ACCESS_DENIED|PATIENT_ACCESS_DENIED/i.test(raw)) return res.status(/CONSENT/i.test(raw) ? 422 : 403).json({ success: false, error: /CONSENT/i.test(raw) ? 'SCHOOL_CONSENT_REQUIRED' : 'SCHOOL_ACCESS_DENIED', message: /CONSENT/i.test(raw) ? 'A autorização necessária não está válida.' : 'Você não possui acesso a este recurso.' });
    if (/NOT_FOUND|PGRST116/i.test(raw)) return res.status(404).json({ success: false, error: 'SCHOOL_NOT_FOUND', message: 'Recurso não encontrado no seu escopo.' });
    if (/SCHOOL_UNIT_REQUIRED/i.test(raw)) return res.status(422).json({ success: false, error: 'SCHOOL_UNIT_REQUIRED', message: 'Selecione a unidade correta: esta escola possui unidades ativas.' });
    if (/INVALID|MISMATCH|TRANSITION|CHECK|REQUIRED/i.test(raw)) return res.status(422).json({ success: false, error: 'SCHOOL_BUSINESS_RULE', message: 'Os dados não atendem às regras da operação escolar.' });
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, error: raw, message: fallback });
    console.error('[SchoolManagement]', { code: sanitizeString(error?.code, 80), message: sanitizeString(raw, 240) });
    return res.status(500).json({ success: false, error: 'SCHOOL_OPERATION_FAILED', message: fallback });
};
