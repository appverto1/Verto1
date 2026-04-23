import React, { useMemo } from 'react';
import { Calendar, ClipboardList, FileText, NotebookPen, BookOpenText, DoorOpen, House, UserCircle } from 'lucide-react';
import { ROLE_CAPABILITY_SECTIONS } from '../constants/roleCapabilities';
import type { ClinicalRole } from '../lib/rbac';
import { CAPABILITY_TO_ROUTE } from '../lib/rbac';

interface RoleBasedSidebarProps {
  role: ClinicalRole;
  activeRoute: string;
  onNavigate: (route: string) => void;
}

const ROUTE_META: Record<string, { label: string; icon: React.ComponentType<any> }> = {
  home: { label: 'Início', icon: House },
  agenda: { label: 'Agenda', icon: Calendar },
  'patient-intake': { label: 'Cadastro', icon: ClipboardList },
  'medical-records': { label: 'Prontuários', icon: FileText },
  anamnesis: { label: 'Anamnese', icon: NotebookPen },
  'protocol-library': { label: 'Protocolos', icon: BookOpenText },
  rooms: { label: 'Salas', icon: DoorOpen },
  profile: { label: 'Perfil', icon: UserCircle },
};

export function RoleBasedSidebar({ role, activeRoute, onNavigate }: RoleBasedSidebarProps) {
  const allowedRoutes = useMemo(() => {
    const routes = new Set<string>(['home', 'profile']);
    ROLE_CAPABILITY_SECTIONS.forEach((section) => {
      section.items.forEach((item) => {
        if (item[role] === 'none') return;
        const route = CAPABILITY_TO_ROUTE[item.key];
        if (route) routes.add(route);
      });
    });
    return Array.from(routes);
  }, [role]);

  return (
    <aside className="w-full lg:w-72 rounded-3xl bg-white border border-slate-100 shadow-sm p-4 lg:p-5">
      <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">Navegação</p>
      <div className="space-y-2">
        {allowedRoutes.map((route) => {
          const meta = ROUTE_META[route];
          if (!meta) return null;
          const Icon = meta.icon;
          const isActive = activeRoute === route;

          return (
            <button
              key={route}
              onClick={() => onNavigate(route)}
              className={`w-full text-left flex items-center gap-3 rounded-2xl px-3 py-3 transition-all text-sm font-semibold ${
                isActive
                  ? 'bg-[#7a32fc] text-white shadow-lg shadow-purple-500/20'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon size={16} />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

