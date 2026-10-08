#!/usr/bin/env node
/**
 * One-time, fail-closed GitHub Actions patch for the oversized legacy server.ts.
 * Creates a normal, reviewable server.ts diff; never runs during application startup.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), 'server.ts');
let source = readFileSync(file, 'utf8');

const importStatement = "import { canManageAppointmentActionInClinic, resolveAuthenticatedCalendarScope } from './services/appointmentTenantGuards';";
if (source.includes(importStatement)) {
  if (!source.includes('canManageAppointmentActionInClinic({') || !source.includes('resolveAuthenticatedCalendarScope(currentClinicId(user)')) {
    throw new Error('Partial P0 backend patch detected: manual review required.');
  }
  console.log('[p0-backend] already applied');
  process.exit(0);
}
function replaceExact(oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error('Patch refused: ' + label + ' anchor count=' + count);
  source = source.replace(oldText, newText);
}
replaceExact("import express from 'express';", "import express from 'express';\n" + importStatement, 'import');

replaceExact(
  "    const clinicId = sanitizeString(rawInput?.clinic_id || rawInput?.clinicId || currentClinicId(user), 120);\n    const organizationId = sanitizeString(rawInput?.organization_id || rawInput?.organizationId || user?.organizationId || user?.organization_id || clinicId, 120);",
  "    // Never trust browser-supplied clinic or organization IDs for conflict detection.\n    const { clinicId, organizationId } = resolveAuthenticatedCalendarScope(currentClinicId(user), user?.organizationId || user?.organization_id);",
  'calendar conflict tenant scope'
);

const oldAdminStart = "  const fetchAppointmentActionRequestForAdmin = async (requestId: string, user: any) => {";
const oldAdminEnd = "\n  const mapAuditLogToHumanHistory =";
const adminStartIndex = source.indexOf(oldAdminStart);
const adminEndIndex = source.indexOf(oldAdminEnd, adminStartIndex);
if (adminStartIndex < 0 || adminEndIndex < 0) throw new Error('Patch refused: administrative appointment resolver not found.');
const oldAdmin = source.slice(adminStartIndex, adminEndIndex);
if (!oldAdmin.includes('const appointmentContext = await fetchPortalAppointmentForUser(')) {
  throw new Error('Patch refused: legacy admin resolver changed.');
}
const newAdmin = `  const fetchAppointmentActionRequestForAdmin = async (requestId: string, user: any) => {
    const safeRequestId = sanitizeString(requestId, 120);
    if (!isUuid(safeRequestId)) return { ok: false, status: 400, error: 'Solicitação inválida.' };
    const { data, error } = await supabase
      .from('appointment_action_requests')
      .select(APPOINTMENT_ACTION_REQUEST_SELECT)
      .eq('id', safeRequestId)
      .limit(1)
      .maybeSingle();
    if (error) {
      if (hasMissingFinancialSchema(error)) return { ok: false, status: 503, error: 'Solicitações indisponíveis.' };
      throw error;
    }
    if (!data?.id) return { ok: false, status: 404, error: 'Solicitação não encontrada.' };
    const appointmentId = sanitizeString(data.appointment_id, 120);
    const requestOrganizationId = sanitizeString(data.organization_id, 120);
    const requestPatientId = sanitizeString(data.patient_id, 120);
    const activeClinicId = sanitizeString(currentClinicId(user), 120);
    const globalAccess = hasGlobalClinicAccess(user);
    if (!isUuid(appointmentId) || !isUuid(requestOrganizationId) || !isUuid(requestPatientId)
      || (!globalAccess && !isUuid(activeClinicId))) {
      return { ok: false, status: 404, error: 'Solicitação não encontrada.' };
    }
    // Route middleware checks calendar.requests.manage. Scope by persisted clinic;
    // do not reuse clinical-chart permissions for authorized reception staff.
    const appointmentResult = await queryPortalAppointmentsWithSchemaFallback(
      (columns) => {
        let query = supabase.from('appointments').select(columns).eq('id', appointmentId);
        if (!globalAccess) query = query.eq('clinic_id', activeClinicId);
        return query.limit(1).maybeSingle();
      },
      'appointment_admin_action_request'
    );
    if (appointmentResult.error) {
      if (hasMissingFinancialSchema(appointmentResult.error)) {
        return { ok: false, status: 503, error: 'Agenda indisponível.' };
      }
      throw appointmentResult.error;
    }
    const appointment = appointmentResult.data;
    if (!appointment?.id || !canManageAppointmentActionInClinic({
      activeClinicId,
      appointmentClinicId: appointment.clinic_id,
      requestOrganizationId,
      appointmentOrganizationId: appointment.organization_id || appointment.clinic_id,
      requestPatientId,
      appointmentPatientId: appointment.patient_id,
      globalAccess
    })) {
      return { ok: false, status: 404, error: 'Solicitação não encontrada.' };
    }
    return { ok: true, request: data, appointment };
  };
`;
replaceExact(oldAdmin, newAdmin, 'appointment request administrative authorization');

const notificationStart = "      const notificationUpdate = await acknowledgePortalAppointmentNotifications({";
const afterAudit = "      void regenerateClosureForAppointments([appointment.id], req.session.user, 'appointment_confirmed_by_responsible');";
const notifyStart = source.indexOf(notificationStart, source.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'"));
const notifyEnd = source.indexOf(afterAudit, notifyStart);
if (notifyStart < 0 || notifyEnd < 0) throw new Error('Patch refused: confirmation side-effects not found.');
const oldEffects = source.slice(notifyStart, notifyEnd);
if (!oldEffects.includes("action: 'CONFIRMED_BY_RESPONSIBLE'")) throw new Error('Patch refused: audit step not recognized.');
const newEffects = `      // Confirmation has already been persisted. Secondary effects must not
      // produce a false HTTP 500/404 after durable confirmation.
      let notificationIds: string[] = [];
      try {
        const notificationUpdate = await acknowledgePortalAppointmentNotifications({
          appointment: persistedAppointment,
          user: req.session.user,
          action: 'confirmed_by_family',
          notificationId: req.body?.notificationId || req.body?.notification_id
        });
        if (notificationUpdate.ok) {
          notificationIds = notificationUpdate.notificationIds;
        } else {
          console.warn('[PortalAppointments] confirmation persisted; notification acknowledgement rejected:', (notificationUpdate as any).status);
        }
      } catch (notificationError: any) {
        console.warn('[PortalAppointments] confirmation persisted; notification acknowledgement failed:', notificationError?.message || String(notificationError));
      }
      try {
        await writeAppointmentStatusAuditLog({
          organizationId: appointment.organization_id || appointment.clinic_id,
          appointmentId: appointment.id,
          patientId: appointment.patient_id,
          action: 'CONFIRMED_BY_RESPONSIBLE',
          previousStatus,
          newStatus: 'CONFIRMED',
          performedBy: actorId,
          performedByRole: actorRole,
          metadata: { source: 'portal' }
        });
      } catch (auditError: any) {
        console.warn('[PortalAppointments] confirmation persisted; audit log failed:', auditError?.message || String(auditError));
      }
`;
replaceExact(oldEffects, newEffects, 'post-commit notification/audit effects');
replaceExact("        notificationIds: notificationUpdate.notificationIds", "        notificationIds", 'confirmation response identifiers');
writeFileSync(file, source, 'utf8');
console.log('[p0-backend] patched server.ts: authenticated conflicts, admin rescheduling, post-commit confirmation effects');
