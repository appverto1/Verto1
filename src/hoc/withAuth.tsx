import React from 'react';

type Role = 'director' | 'coordinator' | 'supervisor' | 'therapist' | 'receptionist' | 'biller' | 'patient' | 'admin' | 'owner';

interface WithAuthOptions {
  allowedRoles?: Role[];
}

export function withAuth<P extends { user: any }>(
  WrappedComponent: React.ComponentType<P>,
  options: WithAuthOptions = {},
) {
  const WithAuthComponent = (props: P) => {
    const { user } = props;

    if (!user) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">Sessão inválida. Faça login novamente.</p>
          </div>
        </div>
      );
    }

    if (options.allowedRoles?.length && !options.allowedRoles.includes(user.role)) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">Acesso negado para este papel.</p>
          </div>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };

  WithAuthComponent.displayName = `withAuth(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;
  return WithAuthComponent;
}

