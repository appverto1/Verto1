import React, { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, CreditCard, Info } from "lucide-react";
import { PUBLIC_ACTIVE_PATIENT_PRICE_LABEL } from "../constants/salesCommercial";

type DiscountNotification = {
  window: string;
  internalSentAt: string | null;
  emailSentAt: string | null;
};

type DiscountSummary = {
  discountType: "none" | "coupon";
  discountPercentage: number | null;
  discountDurationMonths: 6 | 12 | 24 | null;
  discountStartedAt: string | null;
  discountEndsAt: string | null;
  nextBillingAt: string | null;
  postDiscountUnitAmountCents: number;
  estimatedNextInvoiceAmountCents: number | null;
  initialActivePatientQuantity: number | null;
  status: string;
  lastSyncedAt: string | null;
  notifications: DiscountNotification[];
};

const formatDate = (value: string | null) => {
  if (!value) return "Ainda não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ainda não informado";
  return new Intl.DateTimeFormat("pt-BR").format(date);
};

const formatCurrency = (amountCents: number | null) => {
  if (amountCents == null || !Number.isFinite(amountCents)) return "Ainda não informado";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
};

export function SubscriptionDiscountSummary() {
  const [summary, setSummary] = useState<DiscountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/billing/discount-summary", {
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar a condição da assinatura.");
        setSummary(payload?.data?.discount || null);
        setWarning(payload?.data?.warning || "");
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          setWarning(error?.message || "Não foi possível carregar a condição da assinatura.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-50 p-2 text-[#7a32fc]">
          <CreditCard size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-slate-900">Condição da assinatura</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Preço oficial: {PUBLIC_ACTIVE_PATIENT_PRICE_LABEL}.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-slate-100" aria-label="Carregando condição da assinatura" />
      ) : summary ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <CheckCircle2 size={16} aria-hidden="true" />
              {summary.discountPercentage != null
                ? `${summary.discountPercentage}% de desconto até ${formatDate(summary.discountEndsAt)}`
                : `Condição promocional até ${formatDate(summary.discountEndsAt)}`}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-emerald-800/80">
              Após essa data: {formatCurrency(summary.postDiscountUnitAmountCents)} por paciente ativo/mês.
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="text-slate-500">Próxima renovação</dt>
              <dd className="mt-1 font-semibold text-slate-800">{formatDate(summary.nextBillingAt)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="text-slate-500">Pacientes da oferta inicial</dt>
              <dd className="mt-1 font-semibold text-slate-800">
                {summary.initialActivePatientQuantity ?? "Ainda não informado"}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="text-slate-500">Próxima fatura estimada</dt>
              <dd className="mt-1 font-semibold text-slate-800">
                {formatCurrency(summary.estimatedNextInvoiceAmountCents)}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="text-slate-500">Última sincronização</dt>
              <dd className="mt-1 font-semibold text-slate-800">{formatDate(summary.lastSyncedAt)}</dd>
            </div>
          </dl>

          {summary.notifications.length > 0 ? (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <CalendarClock size={15} aria-hidden="true" /> Histórico de avisos
              </div>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {summary.notifications.map((notification) => (
                  <li key={`${notification.window}-${notification.internalSentAt || notification.emailSentAt || "pending"}`}>
                    Aviso de {notification.window.replace("days", "dias")} registrado em {formatDate(notification.emailSentAt || notification.internalSentAt)}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          Nenhum desconto temporário sincronizado para esta clínica. A cobrança segue a configuração oficial da assinatura.
        </div>
      )}

      {warning ? <p className="mt-3 text-xs text-amber-700">{warning}</p> : null}
    </section>
  );
}
