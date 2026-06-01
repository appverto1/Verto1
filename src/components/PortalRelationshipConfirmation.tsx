import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { dataService } from '../services/dataService';

export function PortalRelationshipConfirmation({ onLogin }: { onLogin?: (user: any) => void }) {
  const token = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return String(new URLSearchParams(window.location.search).get('token') || '').trim();
  }, []);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [shareHistory, setShareHistory] = useState(false);
  const [scope, setScope] = useState({
    demographics: true,
    patientVisibleNotes: true,
    professionalSharedNotes: false,
    reports: false,
    files: false,
    abaSummary: false,
    peiSummary: false,
    sharedNotes: false
  });

  const loadRequest = async () => {
    if (!token) {
      setError('Link de confirmação inválido.');
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await dataService.getRelationshipConfirmation(token);
    if (!result?.success) {
      setError(result?.message || result?.error || 'Não foi possível carregar a solicitação.');
    } else {
      setRequest(result.data);
      setConfirmed(Boolean(result.data?.canAuthorizeSharedHistory));
      setError('');
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadRequest();
  }, [token]);

  const requestCode = async () => {
    setError('');
    setMessage('');
    const result = await dataService.requestPortalLoginCode(email, token);
    if (!result?.success) setError(result?.message || result?.error || 'Não foi possível enviar o código.');
    else setMessage(result.message || 'Se este e-mail estiver cadastrado, enviaremos um código de acesso.');
  };

  const verifyCode = async () => {
    setError('');
    const result = await dataService.verifyPortalLoginCode(email, code);
    if (!result?.success) {
      setError(result?.message || result?.error || 'Código inválido ou expirado.');
      return;
    }
    onLogin?.(result.user);
    setMessage('Login confirmado. Carregando solicitação...');
    await loadRequest();
  };

  const confirm = async () => {
    setError('');
    const result = await dataService.confirmRelationship(token);
    if (!result?.success) {
      setError(result?.message || result?.error || 'Não foi possível confirmar o vínculo.');
      return;
    }
    setConfirmed(true);
    setMessage(result.message || 'Vínculo confirmado com sucesso.');
    await loadRequest();
  };

  const reject = async () => {
    setError('');
    const result = await dataService.rejectRelationship(token);
    if (!result?.success) {
      setError(result?.message || result?.error || 'Não foi possível recusar o vínculo.');
      return;
    }
    setMessage(result.message || 'Vínculo recusado.');
    await loadRequest();
  };

  const authorizeHistory = async () => {
    setError('');
    const result = await dataService.authorizeRelationshipHistory(token, scope);
    if (!result?.success) {
      setError(result?.message || result?.error || 'Não foi possível compartilhar o histórico.');
      return;
    }
    setMessage(result.message || 'Histórico compartilhável autorizado.');
    setShareHistory(false);
  };

  const toggleScope = (key: keyof typeof scope) => {
    setScope((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-violet-100 p-3 text-violet-700">
            <ShieldCheck size={24} />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-600">Portal Verto</p>
            <h1 className="text-2xl font-black">Confirmar novo vínculo</h1>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Carregando solicitação...</p>
        ) : request?.requiresAuth ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              Para revisar esta solicitação, entre com um código de 6 dígitos enviado ao e-mail responsável.
            </p>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              placeholder={request?.emailMasked || 'seu@email.com'}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-400"
            />
            <button onClick={requestCode} className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white">
              Enviar código
            </button>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="Código de 6 dígitos"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-400"
            />
            <button onClick={verifyCode} className="w-full rounded-2xl border border-violet-200 px-4 py-3 text-sm font-black text-violet-700">
              Entrar
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm leading-6 text-slate-700">
                Uma clínica/profissional solicitou vínculo com o perfil de <strong>{request?.patientName || 'Paciente'}</strong> na Verto.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                O link não troca senha e não compartilha histórico sozinho. O compartilhamento depende da sua autorização.
              </p>
            </div>

            {!confirmed ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={reject} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600">
                  Recusar vínculo
                </button>
                <button onClick={confirm} className="rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white">
                  Confirmar vínculo
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">
                  <CheckCircle2 size={18} /> Vínculo confirmado.
                </div>
                {!shareHistory ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button onClick={() => setMessage('Vínculo confirmado sem compartilhar histórico.')} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600">
                      Não compartilhar histórico
                    </button>
                    <button onClick={() => setShareHistory(true)} className="rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white">
                      Escolher dados para compartilhar
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm font-black">Deseja compartilhar histórico com esta clínica?</p>
                    <p className="text-xs leading-5 text-slate-500">Anotações privadas de clínicas anteriores não serão compartilhadas.</p>
                    {[
                      ['demographics', 'Dados cadastrais'],
                      ['patientVisibleNotes', 'Anotações compartilhadas com paciente'],
                      ['professionalSharedNotes', 'Anotações compartilháveis com profissionais'],
                      ['reports', 'Relatórios liberados'],
                      ['files', 'Documentos liberados'],
                      ['abaSummary', 'Resumo ABA'],
                      ['peiSummary', 'Resumo PEI'],
                      ['sharedNotes', 'Histórico importado anteriormente']
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 text-sm text-slate-700">
                        <input type="checkbox" checked={Boolean(scope[key as keyof typeof scope])} onChange={() => toggleScope(key as keyof typeof scope)} />
                        {label}
                      </label>
                    ))}
                    <button onClick={authorizeHistory} className="w-full rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white">
                      Autorizar compartilhamento
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {message ? <p className="mt-5 rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-5 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
