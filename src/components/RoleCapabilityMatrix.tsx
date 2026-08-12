import React from 'react';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import {
  CAPABILITY_CATALOG,
  getDefaultCapabilitiesForRole,
  type ClinicBaseRole,
} from '../constants/authorizationModel';

const ROLE_LABELS: Record<Exclude<ClinicBaseRole, 'patient'>, string> = {
  director: 'Diretor',
  coordinator: 'Coordenador',
  supervisor: 'Supervisor',
  therapist: 'Terapeuta',
  receptionist: 'Recepção',
  biller: 'Faturista',
};

const DOMAIN_LABELS: Record<string, string> = {
  clinic: 'Clínica',
  team: 'Equipe',
  patient: 'Pacientes',
  insurance: 'Convênios',
  clinical: 'Prontuário clínico',
  treatment_plan: 'Plano terapêutico',
  aba: 'ABA',
  calendar: 'Agenda',
  session: 'Sessões',
  finance: 'Financeiro',
  billing: 'Faturamento e TISS',
  documents: 'Documentos',
  reports: 'Relatórios',
  school: 'Escolas',
};

const ROLES = Object.keys(ROLE_LABELS) as Array<Exclude<ClinicBaseRole, 'patient'>>;

export function RoleCapabilityMatrix() {
  const sections = Array.from(new Set(CAPABILITY_CATALOG.map((item) => item.domain)));
  const defaults = new Map(ROLES.map((role) => [role, getDefaultCapabilitiesForRole(role)]));

  return (
    <section className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm md:p-8">
      <div className="mb-8">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Acessos padrão da equipe</h2>
        <p className="mt-2 text-sm text-slate-500">
          Esta visão mostra o acesso inicial de cada perfil. Ajustes individuais podem permitir ou bloquear ações sem ultrapassar o escopo de segurança do perfil.
        </p>
      </div>

      <div className="space-y-8">
        {sections.map((domain) => {
          const items = CAPABILITY_CATALOG.filter((item) => item.domain === domain);
          return (
            <div key={domain} className="overflow-hidden rounded-[28px] border border-slate-100">
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                <h3 className="font-bold text-slate-900">{DOMAIN_LABELS[domain] || domain}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-5 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Acesso</th>
                      {ROLES.map((role) => (
                        <th key={role} className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {ROLE_LABELS[role]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.key}>
                        <td className="px-5 py-4 align-top">
                          <p className="text-sm font-bold text-slate-900">{item.label}</p>
                          {item.sensitive && <p className="mt-1 text-xs text-amber-600">Ação sensível</p>}
                        </td>
                        {ROLES.map((role) => {
                          const allowed = defaults.get(role)?.has(item.key) === true;
                          return (
                            <td key={role} className="px-4 py-4 align-top">
                              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${allowed ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                                {allowed ? <CheckCircle2 size={12} /> : <MinusCircle size={12} />}
                                {allowed ? 'Incluído' : 'Não incluído'}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
