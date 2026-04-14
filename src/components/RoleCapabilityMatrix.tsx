import React from 'react';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import {
  ROLE_CAPABILITY_LABELS,
  ROLE_CAPABILITY_SECTIONS,
  RoleCapabilityStatus,
} from '../constants/roleCapabilities';

const statusStyles: Record<RoleCapabilityStatus, { label: string; className: string; icon: any }> = {
  full: {
    label: 'Completo',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    icon: CheckCircle2,
  },
  limited: {
    label: 'Parcial',
    className: 'bg-amber-50 text-amber-700 border-amber-100',
    icon: MinusCircle,
  },
  none: {
    label: 'Sem acesso',
    className: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: XCircle,
  },
};

function CapabilityBadge({ status }: { status: RoleCapabilityStatus }) {
  const config = statusStyles[status];
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-widest ${config.className}`}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}

export function RoleCapabilityMatrix() {
  return (
    <section className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-6 md:p-8">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Matriz de Capacidade por Role</h2>
        <p className="text-sm text-slate-500 mt-2">
          Fonte única para separar os papéis no produto e facilitar personalizações futuras no Google IA Studio.
          Ajuste central em <code>src/constants/roleCapabilities.ts</code>.
        </p>
      </div>

      <div className="space-y-8">
        {ROLE_CAPABILITY_SECTIONS.map((section) => (
          <div key={section.id} className="border border-slate-100 rounded-[28px] overflow-hidden">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-900">{section.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{section.description}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">Capacidade</th>
                    <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{ROLE_CAPABILITY_LABELS.coordinator}</th>
                    <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{ROLE_CAPABILITY_LABELS.receptionist}</th>
                    <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{ROLE_CAPABILITY_LABELS.therapist}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {section.items.map((item) => (
                    <tr key={item.key}>
                      <td className="px-5 py-4 align-top">
                        <p className="text-sm font-bold text-slate-900">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-1">{item.description}</p>
                      </td>
                      <td className="px-5 py-4 align-top"><CapabilityBadge status={item.coordinator} /></td>
                      <td className="px-5 py-4 align-top"><CapabilityBadge status={item.receptionist} /></td>
                      <td className="px-5 py-4 align-top"><CapabilityBadge status={item.therapist} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
