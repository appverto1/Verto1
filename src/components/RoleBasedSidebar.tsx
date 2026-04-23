import React, { useMemo } from 'react';
import {
  Calendar,
  ClipboardList,
  FileText,
  NotebookPen,
  BookOpenText,
  DoorOpen,
  House,
  UserCircle,
  LogOut,
  CircleDot,
} from 'lucide-react';
import {
  ROLE_CAPABILITY_SECTIONS,
  type RoleCapabilityStatus,
} from '../constants/roleCapabilities';
import type { ClinicalRole } from '../lib/rbac';
import { CAPABILITY_TO_ROUTE } from '../lib/rbac';
import { LogoVerto } from './Common';

interface RoleBasedSidebarProps {
  role: ClinicalRole;
  activeRoute: string;
  onNavigate: (route: string) => void;
  onLogout: () => void;
}

type MenuItem = {
  route: string;
  label: string;
  status: RoleCapabilityStatus;
  icon: React.ComponentType<any>;
};

const ROUTE_META: Record<string, { label: string; icon: React.ComponentType<any> }> = {
  home: { label: 'Painel', icon: House },
  profile: { label: 'Perfil', icon: UserCircle },
  agenda: { label: 'Agenda', icon: Calendar },
  rooms: { label: 'Salas', icon: DoorOpen },
  'patient-intake': { label: 'Cadastro', icon: ClipboardList },
  'medical-records': { label: 'Prontuários', icon: FileText },
  anamnesis: { label: 'Anamnese', icon: NotebookPen },
  'protocol-library': { label: 'Protocolos', icon: BookOpenText },
};

const MENU_ORDER = ['home', 'profile', 'agenda', 'rooms', 'patient-intake', 'medical-records', 'anamnesis', 'protocol-library'];

function pickStatus(current: RoleCapabilityStatus, next: RoleCapabilityStatus): RoleCapabilityStatus {
  const weight: Record<RoleCapabilityStatus, number> = { none: 0, limited: 1, full: 2 };
  return weight[next] > weight[current] ? next : current;
}

export function RoleBasedSidebar({ role, activeRoute, onNavigate, onLogout }: RoleBasedSidebarProps) {
  const menuItems = useMemo(() => {
    const byRoute = new Map<string, MenuItem>();

    byRoute.set('home', {
      route: 'home',
      label: ROUTE_META.home.label,
      status: 'full',
      icon: ROUTE_META.home.icon,
    });
    byRoute.set('profile', {
      route: 'profile',
      label: ROUTE_META.profile.label,
      status: 'full',
      icon: ROUTE_META.profile.icon,
    });

    ROLE_CAPABILITY_SECTIONS.forEach((section) => {
      section.items.forEach((capability) => {
        const status = capability[role];
        if (status === 'none') return;
        const route = CAPABILITY_TO_ROUTE[capability.key];
        const meta = route ? ROUTE_META[route] : null;
        if (!route || !meta) return;

        const existing = byRoute.get(route);
        if (!existing) {
          byRoute.set(route, {
            route,
            label: meta.label,
            status,
            icon: meta.icon,
          });
          return;
        }

        byRoute.set(route, { ...existing, status: pickStatus(existing.status, status) });
      });
    });

    return MENU_ORDER
      .map((route) => byRoute.get(route))
      .filter((item): item is MenuItem => Boolean(item));
  }, [role]);

  return (
    <aside
      className="w-20 hover:w-64 bg-white hidden lg:flex flex-col p-5 sticky top-6 rounded-[28px] shadow-sm border border-slate-100 transition-all duration-300 group"
      aria-label="Menu principal"
    >
      <div className="flex items-center justify-center group-hover:justify-start gap-2 mb-7 px-1 transition-all">
        <LogoVerto size={38} />
        <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none group-hover:pointer-events-auto">
          <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">Workspace</p>
          <p className="text-sm font-black text-slate-900 capitalize">{role}</p>
        </div>
      </div>

      <nav className="space-y-2 flex-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeRoute === item.route;
          return (
            <button
              key={item.route}
              onClick={() => onNavigate(item.route)}
              className={`w-full flex items-center justify-center group-hover:justify-start gap-3 px-4 py-3 rounded-2xl transition-all font-bold text-sm ${
                isActive
                  ? 'bg-[#7a32fc] text-white shadow-lg shadow-purple-500/25'
                  : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
              }`}
              title={item.label}
            >
              <Icon size={20} />
              <span className="hidden group-hover:inline">{item.label}</span>
              {item.status === 'limited' && (
                <span
                  className={`hidden group-hover:inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ml-auto px-2 py-1 rounded-full ${
                    isActive ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  <CircleDot size={10} />
                  Limitado
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <button
        onClick={onLogout}
        className="w-full flex items-center justify-center group-hover:justify-start gap-3 px-4 py-3 rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all font-bold text-sm"
        title="Sair"
      >
        <LogOut size={20} />
        <span className="hidden group-hover:inline">Sair do Sistema</span>
      </button>
    </aside>
  );
}

