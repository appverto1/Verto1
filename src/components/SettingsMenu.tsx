import React, { useState, useRef, useEffect } from 'react';
import {
  Settings, 
  Users, 
  LogOut, 
  User, 
  CreditCard,
  ChevronRight,
  ShoppingBag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SettingsMenuProps {
  user: any;
  onLogout: () => void;
  onViewTeam?: () => void;
  onOpenInvitations?: () => void;
  onViewProfile?: () => void;
  onViewBilling?: () => void;
  onOpenOnboarding?: () => void;
  onOpenMarketplace?: () => void;
}

export function SettingsMenu({ 
  user, 
  onLogout, 
  onViewTeam, 
  onOpenInvitations, 
  onViewProfile, 
  onViewBilling,
  onOpenOnboarding,
  onOpenMarketplace
}: SettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isCoordinator = user?.role === 'coordinator' || user?.role === 'admin';
  const isOwner = user?.role === 'owner';
  const canManageTeam = isCoordinator || isOwner;
  const canSeeBilling = isCoordinator || isOwner;

  return (
    <div className="relative" ref={menuRef} style={{ zIndex: 100 }}>
      <button
        onClick={() => {
          console.log('Settings gear clicked, current state:', isOpen);
          setIsOpen(!isOpen);
        }}
        className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
      >
        <Settings size={20} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-[100]"
          >
            <div className="p-4 border-b border-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-50 text-[#7a32fc] rounded-xl flex items-center justify-center font-bold">
                  {user?.name?.charAt(0) || '?'}
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-bold text-slate-900 truncate">{user?.name || 'Usuário'}</p>
                  <p className="text-[10px] text-slate-400 truncate uppercase tracking-widest font-semibold">{user?.role || 'Profissional'}</p>
                </div>
              </div>
            </div>

            <div className="p-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onViewProfile?.();
                }}
                className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3">
                  <User size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                  <span className="text-sm font-medium">Meu Perfil</span>
                </div>
                <ChevronRight size={14} className="text-slate-300" />
              </button>

              {canManageTeam && (
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onViewTeam?.();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Users size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Gestão da Equipe</span>
                  </div>
                  <ChevronRight size={14} className="text-slate-300" />
                </button>
              )}

              {canSeeBilling && (
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onViewBilling?.();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Assinatura e Faturamento</span>
                  </div>
                  <ChevronRight size={14} className="text-slate-300" />
                </button>
              )}

              {canManageTeam && (
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onViewBilling?.();
                  }}
                  className="w-full flex items-center justify-between p-3 text-[#7a32fc] bg-purple-50 hover:bg-purple-100 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard size={18} className="text-[#7a32fc]" />
                    <span className="text-sm font-semibold">Upgrade Simplificado</span>
                  </div>
                  <ChevronRight size={14} className="text-[#7a32fc]" />
                </button>
              )}

              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenMarketplace?.();
                }}
                className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3">
                  <ShoppingBag size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                  <span className="text-sm font-medium">Marketplace</span>
                  <span className="text-[8px] bg-purple-100 text-[#7a32fc] px-1.5 py-0.5 rounded-full font-bold">
                    EM BREVE
                  </span>
                </div>
                <ChevronRight size={14} className="text-slate-300" />
              </button>
            </div>

            <div className="p-2 border-t border-slate-50 bg-slate-50/50">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-3 p-3 text-red-600 hover:bg-red-50 rounded-xl transition-all group"
              >
                <LogOut size={18} className="text-red-400 group-hover:text-red-600" />
                <span className="text-sm font-bold">Sair do Sistema</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

