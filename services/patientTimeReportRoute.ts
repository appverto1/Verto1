import type { Express } from 'express';

type PatientTimeReportDeps = {
  checkAuth: any;
  requireClinicCapability: any;
  sanitizeString: any;
  currentClinicId: any;
  sanitizeIsoDateTime: any;
  fetchTimeReportAppointments: any;
  buildPatientTimeReport: any;
};

// Registration stays at the original server.ts position with the same middleware.
export function registerPatientTimeReportRoute(app: Express, deps: PatientTimeReportDeps) {
  const { checkAuth, requireClinicCapability, sanitizeString, currentClinicId, sanitizeIsoDateTime, fetchTimeReportAppointments, buildPatientTimeReport } = deps;
  app.get('/api/reports/time/patient', checkAuth, requireClinicCapability('reports.view'), async (req: any, res) => {
    try {
      const clinicId = sanitizeString(currentClinicId(req.session.user), 120);
      const organizationId = sanitizeString(req.session.user?.organizationId || req.session.user?.organization_id || clinicId, 120);
      const fromIso = sanitizeIsoDateTime(req.query?.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
      const toIso = sanitizeIsoDateTime(req.query?.to || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).toISOString());
      const limit = Math.min(1000, Math.max(1, Math.round(Number(req.query?.limit || 500) || 500)));
      const appointments = await fetchTimeReportAppointments({
        clinicId,
        organizationId,
        fromIso,
        toIso,
        limit,
        patientId: sanitizeString(req.query?.patientId || req.query?.patient_id, 120),
        professionalId: sanitizeString(req.query?.professionalId || req.query?.professional_id, 120),
        serviceType: sanitizeString(req.query?.serviceType || req.query?.service_type, 120),
        status: sanitizeString(req.query?.status, 40)
      });
      const report = buildPatientTimeReport(appointments, {
        patient_id: req.query?.patientId || req.query?.patient_id,
        patient_name: req.query?.patientName || req.query?.patient_name,
        from: fromIso,
        to: toIso,
        service_type: req.query?.serviceType || req.query?.service_type,
        professional_id: req.query?.professionalId || req.query?.professional_id,
        status: req.query?.status
      });
      return res.json({ success: true, data: report });
    } catch (error: any) {
      console.warn('[Reports] patient time failed:', error?.message || String(error));
      return res.status(500).json({ success: false, error: 'Não foi possível gerar o relatório de tempo do paciente.' });
    }
  });}
