import React, { useEffect, useMemo, useState } from 'react';
import { Plus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import {
  PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS,
  isEligiblePatientProfessionalLinkCandidate,
  patientProfessionalCaseRoleLabel,
  resolveProfessionalProfileSpecialty
} from '../utils/patientProfessionalLinks';
import { formatDateInAppointmentTimezone } from '../utils/scheduling';
import { SecureImage } from './SecureMedia';

type ProfessionalLink = {
  id: string;
  professional_id: string;
  specialty: string;
  case_role: string;
  relationship_type: 'primary' | 'collaborator';
  starts_at: string;
  ends_at: string | null;
  status: 'active' | 'ended';
  integrityStatus?:
    | 'membership_inactive'
    | 'professional_missing'
    | 'profile_missing'
    | 'tenant_mismatch'
    | null;
  accessEnabled?: boolean;
  canBeEnded?: boolean;
  professional?: {
    id: string;
    name?: string | null;
    email?: string | null;
    specialty?: string | null;
    profile_photo_url?: string | null;
    profile_picture?: string | null;
    profile_picture_path?: string | null;
    membershipActive?: boolean;
  } | null;
};

const professionalPhotoSource = (professional: any) => String(
  professional?.profilePicture
  || professional?.profile_picture
  || professional?.profilePictureUrl
  || professional?.profile_picture_url
  || professional?.profilePhotoUrl
  || professional?.profile_photo_url
  || professional?.avatarUrl
  || professional?.avatar_url
  || professional?.photoUrl
  || professional?.photo_url
  || professional?.imageUrl
  || professional?.image_url
  || professional?.professional_profile?.profile_photo_url
  || professional?.professionalProfile?.profilePhotoUrl
  || ''
).trim();

const professionalInitials = (value: unknown) => String(value || 'P')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.charAt(0).toUpperCase())
  .join('') || 'P';

const api = async (url: string, init?: RequestInit) => {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || 'Não foi possível atualizar a equipe.');
  }
  return payload;
};

export const PatientProfessionalLinksPanel = ({
  patientId,
  professionals,
  canManage,
  dark = false,
  refreshKey = 0,
  onLinksChanged,
}: {
  patientId: string;
  professionals: any[];
  canManage: boolean;
  dark?: boolean;
  refreshKey?: string | number;
  onLinksChanged?: (links: ProfessionalLink[]) => void;
}) => {
  const [links, setLinks] = useState<ProfessionalLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    professionalId: '',
    caseRole: 'therapist',
    relationshipType: 'collaborator' as 'primary' | 'collaborator'
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api(`/api/patients/${encodeURIComponent(patientId)}/professional-links`);
      const nextLinks = Array.isArray(data.links) ? data.links : [];
      setLinks(nextLinks);
      onLinksChanged?.(nextLinks);
      setError('');
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar a equipe.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [patientId, refreshKey]);

  const active = useMemo(
    () => links.filter((link) => link.status === 'active'),
    [links]
  );
  const history = useMemo(
    () => links.filter((link) => link.status === 'ended'),
    [links]
  );
  const activeProfessionalIds = useMemo(
    () => new Set(active.map((link) => String(link.professional_id || '').trim())),
    [active]
  );
  const available = useMemo(
    () => professionals.filter((professional) =>
      isEligiblePatientProfessionalLinkCandidate(
        professional,
        activeProfessionalIds
      )
    ),
    [activeProfessionalIds, professionals]
  );
  const selectedProfessional = useMemo(
    () => available.find(
      (professional) => String(professional?.id || '') === draft.professionalId
    ) || null,
    [available, draft.professionalId]
  );
  const professionalById = useMemo(
    () => new Map(
      professionals.map((professional) => [String(professional?.id || '').trim(), professional])
    ),
    [professionals]
  );
  const selectedSpecialty = resolveProfessionalProfileSpecialty(selectedProfessional);
  const selectedProfessionalIsEligible =
    isEligiblePatientProfessionalLinkCandidate(
      selectedProfessional,
      activeProfessionalIds
    );
  const selectedProfessionalCanSupervise = Boolean(
    selectedProfessional?.canSupervise === true
    || selectedProfessional?.can_supervise === true,
  );
  const currentClinicalDate = () =>
    formatDateInAppointmentTimezone(new Date());

  const add = async () => {
    if (!draft.professionalId || !selectedSpecialty || !selectedProfessionalIsEligible) return;
    if (draft.caseRole === 'supervisor' && !selectedProfessionalCanSupervise) {
      setError('Habilite este profissional para supervisão antes de atribuir a função no caso.');
      return;
    }
    setBusy('add');
    setError('');
    try {
      await api(`/api/patients/${encodeURIComponent(patientId)}/professional-links`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          replacePrimary: draft.relationshipType === 'primary',
          startsAt: currentClinicalDate(),
          permissions: { read: true, write: true }
        })
      });
      setDraft({
        professionalId: '',
        caseRole: 'therapist',
        relationshipType: 'collaborator'
      });
      setShowForm(false);
      await load();
    } catch (addError: any) {
      const code = String(addError?.message || '');
      if (code.includes('DUPLICATE')) {
        // The desired relationship already exists. Re-read the canonical server state
        // instead of presenting an idempotent retry as a destructive error.
        setShowForm(false);
        await load();
        return;
      }
      setError(code.includes('LIMIT')
        ? 'Este paciente já possui cinco profissionais ativos. Encerre um vínculo antes de adicionar outro.'
          : code.includes('SUPERVISION')
            ? 'Este profissional não está habilitado para supervisão.'
          : code.includes('SPECIALTY')
          ? 'O cadastro do profissional precisa de uma especialidade antes de criar o vínculo.'
          : code.includes('MEMBERSHIP')
            ? 'Este profissional não possui vínculo ativo com a clínica.'
          : 'Não foi possível adicionar o profissional.');
    } finally {
      setBusy('');
    }
  };

  const end = async (link: ProfessionalLink) => {
    setBusy(`end:${link.id}`);
    setError('');
    try {
      await api(
        `/api/patients/${encodeURIComponent(patientId)}/professional-links/${encodeURIComponent(link.id)}/end`,
        {
          method: 'PATCH',
          body: JSON.stringify({ endsAt: currentClinicalDate() })
        }
      );
      await load();
    } catch {
      setError('Não foi possível encerrar o vínculo. O histórico foi preservado.');
    } finally {
      setBusy('');
    }
  };

  const shell = dark ? 'text-slate-100' : 'text-slate-900';

  return (
    <section className={`w-full min-w-0 ${shell}`} aria-label="Equipe do caso">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
            <p className="text-sm font-semibold">Equipe do caso</p>
            <p className={`mt-0.5 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              {loading ? 'Carregando...' : `${active.length} de 5 vínculos ativos`}
            </p>
            {canManage ? (
              <p className={`mt-1 max-w-2xl text-[11px] leading-4 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Para definir supervisão, habilite o profissional para supervisionar na tela Equipe e use Adicionar → Função no caso → Supervisão.
              </p>
            ) : null}
          </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            disabled={active.length >= 5 || loading}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dark ? 'border-slate-700 bg-slate-800 text-violet-200 hover:bg-slate-700' : 'border-slate-200 bg-white text-[#6542a8] hover:bg-violet-50'}`}
          >
            <Plus size={15} /> Adicionar
          </button>
        ) : null}
      </div>

      {active.length >= 5 ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">
          Limite de cinco profissionais ativos atingido. O prontuário e os vínculos anteriores continuam preservados.
        </p>
      ) : null}

      {showForm ? (
        <div className={`mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${dark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'}`}>
          <label className="text-xs font-medium">
            Profissional
            <select
              value={draft.professionalId}
              onChange={(event) => {
                const professionalId = event.target.value;
                const nextProfessional = available.find(
                  (professional) => String(professional?.id || '') === professionalId,
                );
                const nextCanSupervise = nextProfessional?.canSupervise === true
                  || nextProfessional?.can_supervise === true;
                setDraft((current) => ({
                  ...current,
                  professionalId,
                  caseRole: current.caseRole === 'supervisor' && !nextCanSupervise
                    ? 'therapist'
                    : current.caseRole,
                }));
              }}
              className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-slate-800"
            >
              <option value="">Selecione</option>
              {available.map((professional) => (
                <option key={professional.id} value={professional.id}>
                  {professional.name || professional.email}
                  {resolveProfessionalProfileSpecialty(professional)
                    ? ` — ${resolveProfessionalProfileSpecialty(professional)}`
                    : ' — especialidade não informada'}
                </option>
              ))}
            </select>
            {available.length === 0 ? (
              <span className="mt-1.5 block font-normal leading-5 text-amber-700">
                Nenhum terapeuta elegível disponível. É necessário vínculo ativo com a clínica, especialidade cadastrada e ausência de vínculo ativo com este paciente.
              </span>
            ) : null}
          </label>
          <div className="text-xs font-medium">
            Especialidade
            <div
              className={`mt-1 flex min-h-10 items-center rounded-lg border px-3 font-normal ${
                selectedProfessional && !selectedSpecialty
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : dark
                    ? 'border-slate-700 bg-slate-900 text-slate-200'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
              aria-live="polite"
            >
              {selectedProfessional
                ? selectedSpecialty || 'Especialidade pendente no cadastro profissional'
                : 'Selecione um profissional'}
            </div>
          </div>
          <label className="text-xs font-medium">
            Função no caso
            <select
              value={draft.caseRole}
              onChange={(event) => setDraft((current) => ({ ...current, caseRole: event.target.value }))}
              className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-slate-800"
            >
              {PATIENT_PROFESSIONAL_CASE_ROLE_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.value === 'supervisor' && !selectedProfessionalCanSupervise}
                >
                  {option.label}
                  {option.value === 'supervisor' && !selectedProfessionalCanSupervise
                    ? ' — requer habilitação'
                    : ''}
                </option>
              ))}
            </select>
            {selectedProfessional && !selectedProfessionalCanSupervise ? (
              <span className="mt-1.5 block font-normal leading-5 text-slate-500">
                A função Supervisão só fica disponível para profissionais habilitados para supervisionar na tela Equipe.
              </span>
            ) : null}
          </label>
          <label className="text-xs font-medium">
            Participação
            <select value={draft.relationshipType} onChange={(event) => setDraft((current) => ({ ...current, relationshipType: event.target.value as 'primary' | 'collaborator' }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal text-slate-800">
              <option value="collaborator">Colaborador</option>
              <option value="primary">Principal (substituir atual)</option>
            </select>
          </label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-medium text-slate-700">Vigência</span>
            <p className="mt-0.5 text-slate-500">Início na data de criação; encerramento preserva o histórico.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-medium text-slate-700">Permissões</span>
            <p className="mt-0.5 text-slate-500">Leitura, edição e consulta histórica autorizadas.</p>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setShowForm(false)} className="min-h-10 rounded-lg px-3 text-xs font-medium text-slate-600">Cancelar</button>
            <button type="button" onClick={() => void add()} disabled={busy === 'add' || !draft.professionalId || !selectedSpecialty || !selectedProfessionalIsEligible} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50"><UserRoundCheck size={15} /> Salvar vínculo</button>
          </div>
        </div>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
        {active.map((link) => (
          <article
            key={link.id}
            className={`overflow-hidden rounded-xl border shadow-sm ${
              link.integrityStatus
                ? dark
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-amber-200 bg-amber-50/70'
                : dark
                  ? 'border-slate-700 bg-slate-800'
                  : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex min-h-[4.75rem] items-start justify-between gap-2 p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                {(() => {
                  const professionalRecord = professionalById.get(String(link.professional_id || '').trim()) || link.professional;
                  const photoSource = professionalPhotoSource(professionalRecord);
                  const displayName = link.professional?.name || professionalRecord?.name || link.professional?.email || professionalRecord?.email || 'Profissional';
                  return photoSource ? (
                    <SecureImage src={photoSource} alt={`Foto de ${displayName}`} className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] ${dark ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-600'}`}>{professionalInitials(displayName)}</span>
                  );
                })()}
                <div className="min-w-0">
                <p className="truncate text-xs font-medium">{link.professional?.name || professionalById.get(String(link.professional_id || '').trim())?.name || link.professional?.email || 'Profissional'}</p>
                <p className={`mt-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                  {patientProfessionalCaseRoleLabel(link.case_role)} · {link.specialty || 'Especialidade não informada'}
                </p>
                </div>
              </div>
              <span className={link.relationship_type === 'primary' ? 'rounded-full bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700' : 'rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600'}>
                {link.relationship_type === 'primary' ? 'Principal' : 'Colaborador'}
              </span>
            </div>
            {link.integrityStatus ? (
              <p className={`mx-3 mb-2 text-xs leading-5 ${dark ? 'text-amber-200' : 'text-amber-800'}`}>
                Vínculo ativo com cadastro profissional inconsistente. O acesso clínico está bloqueado; encerre o vínculo ou regularize a membership.
              </p>
            ) : null}
            {canManage && link.canBeEnded !== false ? (
              <div className={`border-t px-3 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
                <button type="button" onClick={() => void end(link)} disabled={busy === `end:${link.id}`} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 text-xs font-medium text-rose-600 disabled:opacity-50"><UserRoundX size={14} /> Encerrar vínculo</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {!loading && active.length === 0 ? (
        <p className={`mt-3 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Nenhum vínculo ativo. Adicione o primeiro profissional para formar a equipe.</p>
      ) : null}
      {history.length > 0 ? (
        <details className={`mt-3 border-t pt-3 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <summary className="cursor-pointer text-xs font-medium text-slate-500">
            Histórico de vínculos ({history.length})
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {history.map((link) => (
              <div key={link.id} className={`rounded-lg border px-3 py-2 text-xs ${dark ? 'border-slate-700 text-slate-400' : 'border-slate-200 bg-white text-slate-600'}`}>
                <p className="font-medium">{link.professional?.name || link.professional?.email || 'Profissional'}</p>
                <p className="mt-0.5">{link.specialty || 'Especialidade não informada'}</p>
                <p className="mt-0.5">Encerrado em {link.ends_at ? new Date(`${link.ends_at}T12:00:00`).toLocaleDateString('pt-BR') : 'data não informada'}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-xs leading-5 text-rose-600">{error}</p> : null}
    </section>
  );
};
