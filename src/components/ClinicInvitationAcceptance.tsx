import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, Link2, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { dataService } from '../services/dataService';

type ClinicInvitationAcceptanceProps = {
  invitationId: string;
  onAccepted: (user: any) => Promise<void>;
  onDismiss: () => void;
};

const isInvitationId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const invitationErrorMessage = (result: any) => {
  const code = String(result?.error || '').trim();
  const message = String(result?.message || '').trim();
  if (message) return message;
  if (code === 'CLINIC_INVITATION_EMAIL_MISMATCH') {
    return 'Este convite foi enviado para outro e-mail. Entre com a conta convidada para continuar.';
  }
  if (code === 'CLINIC_INVITATION_NOT_AVAILABLE' || code === 'CLINIC_INVITATION_ALREADY_USED') {
    return 'Este convite não está mais disponível. Solicite um novo convite à clínica.';
  }
  return 'Não foi possível validar este convite agora. Tente novamente ou solicite um novo convite à clínica.';
};

/**
 * The invitation id is only context for the logged-in professional. No clinic,
 * role, name, or e-mail comes from the URL or from the browser as authority.
 */
export const ClinicInvitationAcceptance = ({
  invitationId,
  onAccepted,
  onDismiss,
}: ClinicInvitationAcceptanceProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<{ user: any; onboardingContext: any } | null>(null);

  const acceptedClinicName = String(accepted?.onboardingContext?.clinic?.name || '').trim() || 'Clínica convidante';
  const acceptedRole = String(accepted?.onboardingContext?.membership?.role || '').trim().toLowerCase();
  const acceptedSpecialty = String(accepted?.onboardingContext?.membership?.specialty || '').trim();
  const acceptedRoleLabel = acceptedRole === 'director'
    ? 'Direção'
    : acceptedRole === 'coordinator'
      ? 'Coordenação'
      : acceptedRole === 'supervisor'
        ? 'Profissional · Supervisor'
        : acceptedRole === 'therapist'
          ? 'Profissional de atendimento'
          : acceptedRole === 'receptionist'
            ? 'Recepção'
            : acceptedRole === 'biller'
              ? 'Faturamento'
              : 'Membro da clínica';

  const handleAccept = async () => {
    if (!isInvitationId(invitationId)) {
      setError('O link do convite é inválido. Solicite um novo convite à clínica.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const result = await dataService.acceptInvitation(invitationId);
      if (!result?.success || !result?.user) {
        throw result;
      }
      setAccepted({
        user: result.user,
        onboardingContext: result.onboardingContext || {},
      });
    } catch (acceptanceError) {
      setError(invitationErrorMessage(acceptanceError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnterClinic = async () => {
    if (!accepted?.user) return;
    setIsSubmitting(true);
    setError('');
    try {
      await onAccepted(accepted.user);
    } catch (enterError) {
      setError(invitationErrorMessage(enterError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5 sm:p-8">
      <section
        className="w-full max-w-lg rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_18px_55px_rgba(15,23,42,0.10)] sm:p-8"
        aria-labelledby="clinic-invitation-title"
      >
        <LogoVerto size={34} showText className="mb-7" />
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-[#7a32fc]">
            <Link2 size={21} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-violet-700">{accepted ? 'Vínculo confirmado' : 'Novo vínculo profissional'}</p>
            <h1 id="clinic-invitation-title" className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {accepted ? 'Tudo pronto para entrar' : 'Revisar convite da clínica'}
            </h1>
          </div>
        </div>

        {accepted ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm leading-6 text-slate-600">
              Seu acesso existente foi associado com segurança. Nenhum dado pessoal ou profissional foi substituído.
            </p>
            <dl className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-slate-700">
              <div className="flex items-start justify-between gap-4 border-b border-emerald-100 pb-3">
                <dt className="text-slate-500">Clínica</dt>
                <dd className="text-right font-medium text-slate-900">{acceptedClinicName}</dd>
              </div>
              <div className="flex items-start justify-between gap-4 pt-3">
                <dt className="text-slate-500">Acesso</dt>
                <dd className="text-right font-medium text-slate-900">
                  {acceptedRoleLabel}{acceptedSpecialty ? ` · ${acceptedSpecialty}` : ''}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            <p className="mt-5 text-sm leading-6 text-slate-600">
              Você continuará usando a mesma conta Verto. Seus dados pessoais e profissionais já cadastrados serão preservados; este aceite adiciona somente um novo vínculo à clínica convidante.
            </p>

            <div className="mt-6 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600">
              <div className="flex gap-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} aria-hidden="true" />
                <span>Não será necessário refazer seu cadastro, enviar documentos ou escolher um plano.</span>
              </div>
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 shrink-0 text-slate-500" size={18} aria-hidden="true" />
                <span>A clínica, o papel e a elegibilidade são validados no servidor antes do vínculo ser criado.</span>
              </div>
            </div>
          </>
        )}

        {error ? (
          <p className="mt-5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm leading-5 text-rose-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {!accepted ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={isSubmitting}
              className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continuar depois
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void (accepted ? handleEnterClinic() : handleAccept())}
            disabled={isSubmitting}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#6925e8] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Validando convite…' : accepted ? 'Entrar na clínica' : 'Aceitar vínculo'}
            {!isSubmitting ? <ChevronRight size={17} aria-hidden="true" /> : null}
          </button>
        </div>
      </section>
    </main>
  );
};
