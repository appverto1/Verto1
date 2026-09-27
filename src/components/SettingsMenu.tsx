import React, { useState, useRef, useEffect } from 'react';
import {
  Settings, 
  Users, 
  LogOut, 
  User, 
  CreditCard,
  ChevronRight,
  ShoppingBag,
  ArrowLeftRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SecureImage } from './SecureMedia';
import { ModuleDiscoveryInterstitial } from './ModuleDiscoveryInterstitial';
import { HelpButton } from './HelpButton';

interface SettingsMenuProps {
  user: any;
  onLogout: () => void | Promise<void>;
  onViewTeam?: () => void;
  onOpenInvitations?: () => void;
  onViewProfile?: () => void;
  onViewClinicSettings?: () => void;
  canManageClinicSettings?: boolean;
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
  onViewClinicSettings,
  canManageClinicSettings = false,
  onViewBilling,
  onOpenOnboarding,
  onOpenMarketplace
}: SettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const [moduleDiscoveryOpen, setModuleDiscoveryOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isOpen || isLoggingOut) return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLoggingOut, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    window.requestAnimationFrame(() => firstActionRef.current?.focus());
  }, [isOpen]);

  const normalizedRole = String(
    user?.activeWorkspaceRole ||
    user?.activeOrganizationRole ||
    user?.organizationRole ||
    user?.role ||
    ''
  ).trim().toLowerCase();
  const isDirector = normalizedRole === 'director';
  const isCoordinator = normalizedRole === 'coordinator' || normalizedRole === 'admin';
  const isOwner = normalizedRole === 'owner';
  const canManageTeam = isDirector || isCoordinator || isOwner;
  const onboardingMode = String(user?.onboardingContext?.onboardingMode || '').trim().toLowerCase();
  const isClinicManagedMember = ['invited_professional', 'clinic_member'].includes(onboardingMode);
  const canSeeBilling = (isCoordinator || isOwner) && !isClinicManagedMember;
  const accessContextCount = Array.isArray(user?.accessContexts) && user.accessContexts.length > 0
    ? new Set(user.accessContexts.map((context: any) => String(context?.id || '').trim()).filter(Boolean)).size
    : new Set(
        (Array.isArray(user?.workspaces) ? user.workspaces : [])
          .map((workspace: any) => String(workspace?.clinicId || '').trim())
          .filter(Boolean)
      ).size;
  const canSwitchAccessContext = accessContextCount > 1;
  const roleLabel = normalizedRole === 'director'
    ? 'Diretor'
    : normalizedRole === 'coordinator'
      ? 'Coordenador'
    : normalizedRole === 'receptionist'
      ? 'Recepcionista/Assistente'
      : normalizedRole === 'owner' || normalizedRole === 'admin'
        ? 'Administrador'
        : String(
            user?.professionalTitle ||
            user?.professional_title ||
            user?.professionalProfile?.professionalTitle ||
            user?.professionalProfile?.professional_title ||
            user?.professionalProfile?.metadata?.professionalTitle ||
            user?.professionalProfile?.metadata?.professional_title ||
            'Profissional de atendimento'
          ).trim();
  const organizationName = String(
    user?.workspaceName ||
    user?.activeWorkspaceName ||
    user?.clinicSettings?.clinicName ||
    user?.clinicName ||
    ''
  ).trim();
  const profileImageUrl = String(
    user?.profilePictureUrl ||
    user?.profilePicture ||
    user?.profile_picture ||
    user?.profilePhotoUrl ||
    user?.profile_photo_url ||
    user?.profilePicturePath ||
    user?.profile_picture_path ||
    user?.professionalProfile?.profilePhotoUrl ||
    user?.professionalProfile?.profile_photo_url ||
    user?.professionalProfile?.profilePicture ||
    user?.professionalProfile?.profilePicturePath ||
    user?.professionalProfile?.metadata?.profilePicturePath ||
    user?.avatarUrl ||
    user?.avatar_url ||
    ''
  ).trim();
  const userInitials = String(user?.name || 'Usuário')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

  useEffect(() => {
    setProfileImageFailed(false);
  }, [profileImageUrl]);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setLogoutError('');
    setIsLoggingOut(true);
    try {
      await onLogout();
      setIsOpen(false);
    } catch {
      setLogoutError('Não foi possível sair agora. Tente novamente.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
    <HelpButton />
    <div className="relative" ref={menuRef} style={{ zIndex: 100 }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
        aria-label="Abrir menu da conta e configurações"
        aria-haspopup="menu"
        aria-expanded={isOpen}
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
            role="menu"
            aria-label="Conta e configurações"
          >
            <div className="p-4 border-b border-slate-50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-purple-50 text-sm font-medium text-[#7a32fc]">
                  {profileImageUrl && !profileImageFailed ? (
                    <SecureImage
                      src={profileImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      fallback={userInitials}
                      onError={() => setProfileImageFailed(true)}
                    />
                  ) : userInitials}
                </div>
                <div className="overflow-hidden">
                  <p className="text-sm font-medium text-slate-900 truncate">{user?.name || 'Usuário'}</p>
                  <p className="text-xs text-slate-500 truncate">{roleLabel}</p>
                  {organizationName && <p className="mt-0.5 text-[11px] text-slate-400 truncate">{organizationName}</p>}
                </div>
              </div>
            </div>

            <div className="p-2">
              <button
                ref={firstActionRef}
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onViewProfile?.();
                }}
                className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3">
                  <User size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                  <span className="text-sm font-medium">Meu perfil profissional</span>
                </div>
                <ChevronRight size={14} className="text-slate-300" />
              </button>

              {canManageClinicSettings && onViewClinicSettings && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onViewClinicSettings();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Settings size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Configurações da clínica</span>
                  </div>
                  <ChevronRight size={14} className="text-slate-300" />
                </button>
              )}

              {canSwitchAccessContext && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    window.dispatchEvent(new CustomEvent('verto:open-access-contexts'));
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <ArrowLeftRight size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Trocar clínica ou acesso</span>
                  </div>
                  <ChevronRight size={14} className="text-slate-300" />
                </button>
              )}

              {canManageTeam && (
                <button
                  type="button"
                  role="menuitem"
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
                  type="button"
                  role="menuitem"
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

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  setModuleDiscoveryOpen(true);
                }}
                className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3">
                  <ShoppingBag size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                  <span className="text-sm font-medium">Módulos e recursos</span>
                  <span className="text-[8px] bg-purple-100 text-[#7a32fc] px-1.5 py-0.5 rounded-full font-bold">
                    CONHEÇA
                  </span>
                </div>
                <ChevronRight size={14} className="text-slate-300" />
              </button>
            </div>

            <div className="p-2 border-t border-slate-50 bg-slate-50/50">
              {logoutError && (
                <p className="px-3 pb-1 text-xs text-red-600" role="alert">{logoutError}</p>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={isLoggingOut}
                onClick={() => {
                  void handleLogout();
                }}
                className="w-full flex items-center gap-3 p-3 text-red-600 hover:bg-red-50 rounded-xl transition-all group disabled:cursor-wait disabled:opacity-60"
              >
                <LogOut size={18} className="text-red-400 group-hover:text-red-600" />
                <span className="text-sm font-medium">{isLoggingOut ? 'Saindo...' : 'Sair do sistema'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    <ModuleDiscoveryInterstitial open={moduleDiscoveryOpen} onClose={() => setModuleDiscoveryOpen(false)} />
    </>
  );
}

