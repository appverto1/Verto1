import React, { useState, useRef, useEffect } from 'react';
import {
  Settings, 
  Users, 
  LogOut, 
  User, 
  CreditCard,
  ChevronRight,
  ShoppingBag,
  ArrowLeftRight,
  BookOpenCheck,
  CircleHelp,
  Moon,
  Sun,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import { SecureImage } from './SecureMedia';
import { ModuleDiscoveryInterstitial } from './ModuleDiscoveryInterstitial';
import { ClinicLoyaltyTermsPreview } from './ClinicLoyaltyTermsPreview';
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
  onOpenGuidedTutorial?: () => void;
  /** Render account actions as rows within the containing navigation drawer. */
  inline?: boolean;
  /** Close the containing drawer after an account action navigates elsewhere. */
  onAction?: () => void;
  /** Mobile drawer-only theme control, directly after professional identity. */
  themeMode?: 'light' | 'dark';
  onToggleTheme?: () => void;
  /** The drawer renders professional identity and theme above navigation instead. */
  showAccountIdentity?: boolean;
}

/**
 * Reuse the account portrait, displayed name and workspace role across the
 * desktop settings popover and the professional mobile navigation drawers.
 */
function ProfessionalAccountIdentity({ user }: { user: any }) {
  const [profileImageFailed, setProfileImageFailed] = useState(false);
  const normalizedRole = String(
    user?.activeWorkspaceRole ||
    user?.activeOrganizationRole ||
    user?.organizationRole ||
    user?.role ||
    ''
  ).trim().toLowerCase();
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

  return (
    <div className="flex min-w-0 items-center gap-3">
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
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">{user?.name || 'Usuário'}</p>
        <p className="truncate text-xs text-slate-500">{roleLabel}</p>
        {organizationName && <p className="mt-0.5 truncate text-[11px] text-slate-400">{organizationName}</p>}
      </div>
    </div>
  );
}

interface ProfessionalMobileDrawerHeaderProps {
  user: any;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onClose: () => void;
}

/** Shared top section for every clinic professional's mobile hamburger menu. */
export function ProfessionalMobileDrawerHeader({
  user, themeMode, onToggleTheme, onClose
}: ProfessionalMobileDrawerHeaderProps) {
  return (
    <div className="mb-4 shrink-0 border-b border-slate-100 pb-3" data-mobile-professional-header>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1"><ProfessionalAccountIdentity user={user} /></div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="shrink-0 rounded-xl p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={20} />
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={themeMode === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}
        className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
      >
        {themeMode === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        <span>{themeMode === 'light' ? 'Tema escuro' : 'Tema claro'}</span>
      </button>
    </div>
  );
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
  onOpenMarketplace,
  onOpenGuidedTutorial,
  inline = false,
  onAction,
  themeMode = 'light',
  onToggleTheme,
  showAccountIdentity = true
}: SettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [moduleDiscoveryOpen, setModuleDiscoveryOpen] = useState(false);
  const [loyaltyPreviewOpen, setLoyaltyPreviewOpen] = useState(false);
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

  const accountActions = (
    <>
            {showAccountIdentity && (
              <div className={inline ? "px-3 py-3" : "p-4 border-b border-slate-50"}>
                <ProfessionalAccountIdentity user={user} />
              </div>
            )}
            {inline && onToggleTheme && (
              <div className="px-2 pb-3">
                <button
                  type="button"
                  onClick={onToggleTheme}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                  aria-label={themeMode === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}
                >
                  {themeMode === 'light' ? <Moon size={18} className="text-slate-400" /> : <Sun size={18} className="text-slate-400" />}
                  {themeMode === 'light' ? 'Tema escuro' : 'Tema claro'}
                </button>
              </div>
            )}

            <div className="p-2">
              <button
                ref={firstActionRef}
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  onAction?.();
                  onViewProfile?.();
                }}
                className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-3">
                  <User size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                  <span className="text-sm font-medium">Meu perfil profissional</span>
                </div>
                <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
              </button>

              {onOpenGuidedTutorial && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onAction?.();
                    onOpenGuidedTutorial();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <BookOpenCheck size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Reiniciar tutorial guiado</span>
                  </div>
                  <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
                </button>
              )}

              {canManageClinicSettings && onViewClinicSettings && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onAction?.();
                    onViewClinicSettings();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Settings size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Configurações da clínica</span>
                  </div>
                  <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
                </button>
              )}

              {canSwitchAccessContext && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onAction?.();
                    window.dispatchEvent(new CustomEvent('verto:open-access-contexts'));
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <ArrowLeftRight size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Trocar clínica ou acesso</span>
                  </div>
                  <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
                </button>
              )}

              {canManageTeam && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onAction?.();
                    onViewTeam?.();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <Users size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Gestão da Equipe</span>
                  </div>
                  <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
                </button>
              )}

              {import.meta.env.VITE_FEATURE_LOYALTY_STAGING === 'true'
                && String(user?.role || '').trim().toLowerCase() === 'director' && (
                <button type="button" role="menuitem"
                  onClick={() => { setIsOpen(false); onAction?.(); setLoyaltyPreviewOpen(true); }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group">
                  <div className="flex items-center gap-3">
                    <BookOpenCheck size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Contrato de fidelidade</span>
                  </div>
                  <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
                </button>
              )}

              {canSeeBilling && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOpen(false);
                    onAction?.();
                    onViewBilling?.();
                  }}
                  className="w-full flex items-center justify-between p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard size={18} className="text-slate-400 group-hover:text-[#7a32fc]" />
                    <span className="text-sm font-medium">Assinatura e Faturamento</span>
                  </div>
                  <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
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
                <ChevronRight size={14} className={inline ? "hidden" : "text-slate-300"} />
              </button>
            </div>

            {inline && (
              <div className="px-2 pb-2">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => window.open('/ajuda', '_blank', 'noopener,noreferrer')}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  <CircleHelp size={18} className="text-slate-400" />
                  Central de ajuda e tutoriais
                </button>
              </div>
            )}

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
    </>
  );

  return (
    <>
      {inline ? (
        <div className="w-full min-w-0 overflow-hidden rounded-xl bg-white" role="menu" aria-label="Conta e configurações">
          {accountActions}
        </div>
      ) : (
        <>
          <HelpButton />
          <div className="relative" ref={menuRef} style={{ zIndex: 100 }} data-tutorial-anchor="account-menu">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setIsOpen(!isOpen)}
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
                  {accountActions}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    {inline && typeof document !== 'undefined'
      ? createPortal(
          <ModuleDiscoveryInterstitial open={moduleDiscoveryOpen} onClose={() => setModuleDiscoveryOpen(false)} />,
          document.body,
        )
      : <ModuleDiscoveryInterstitial open={moduleDiscoveryOpen} onClose={() => setModuleDiscoveryOpen(false)} />}
    {typeof document !== 'undefined' && createPortal(
      <ClinicLoyaltyTermsPreview open={loyaltyPreviewOpen} onClose={() => setLoyaltyPreviewOpen(false)} />,
      document.body
    )}

    </>
  );
}
