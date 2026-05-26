import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { filterHumanDisplayEntries, isTechnicalFieldName, maskTechnicalId, safeDisplayValue } from '../utils/displayLabels';

const AUTHORIZED_TECHNICAL_ROLES = new Set(['owner', 'admin', 'super_admin', 'support', 'dev', 'developer']);

export const canViewTechnicalDetails = (role?: string | null, devMode = Boolean((import.meta as any).env?.DEV)) => {
  if (devMode) return true;
  return AUTHORIZED_TECHNICAL_ROLES.has(String(role || '').trim().toLowerCase());
};

type TechnicalDetailsProps = {
  details?: Record<string, any> | null;
  role?: string | null;
  title?: string;
  defaultOpen?: boolean;
  className?: string;
};

export const TechnicalDetails = ({
  details,
  role,
  title = 'Detalhes tecnicos',
  defaultOpen = false,
  className = ''
}: TechnicalDetailsProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const canView = canViewTechnicalDetails(role);
  const rows = useMemo(() => {
    return Object.entries(details || {})
      .filter(([key, value]) => isTechnicalFieldName(key) || !filterHumanDisplayEntries({ [key]: value }).length)
      .map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? maskTechnicalId(value) : safeDisplayValue(value, 'Valor tecnico oculto')
      }));
  }, [details]);

  if (!canView || rows.length === 0) return null;

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 font-bold text-slate-700"
      >
        <span>{title}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="mt-3 grid gap-2">
          {rows.map((row) => (
            <div key={row.key} className="grid gap-1 rounded-md bg-white p-2">
              <dt className="font-bold uppercase tracking-widest text-slate-400">{row.key}</dt>
              <dd className="break-all font-mono text-[11px] text-slate-600">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};

export default TechnicalDetails;
