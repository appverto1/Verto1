import React, { useEffect, useMemo, useState } from "react";
import { MessageCircle, Minus, X } from "lucide-react";
import { createPortal } from "react-dom";

interface PatientInternalChatPreviewProps {
  patientName?: string;
  compact?: boolean;
  className?: string;
}

export const PatientInternalChatPreview = ({
  patientName,
  compact = false,
  className = "",
}: PatientInternalChatPreviewProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const displayName = useMemo(() => {
    const normalizedName = String(patientName || "").trim();
    return normalizedName || "este paciente";
  }, [patientName]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const stopCardClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const drawer =
    typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[140] pointer-events-none">
            <div
              className="absolute inset-0 pointer-events-auto"
              onClick={() => setIsOpen(false)}
            />
            <section
              role="dialog"
              aria-label={`Chat interno sobre ${displayName}`}
              onClick={stopCardClick}
              className="absolute bottom-4 right-4 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-[28px] border border-violet-100 bg-white shadow-2xl shadow-slate-900/15 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-[#fbf9ff] px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#7a32fc]/10 text-[#7a32fc]">
                      <MessageCircle size={17} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Chat interno
                      </h3>
                      <p className="text-[11px] font-medium text-slate-500">
                        {displayName}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl p-2 text-slate-400 transition-all hover:bg-white hover:text-slate-700"
                  aria-label="Recolher chat interno"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4 px-5 py-5">
                <div className="w-fit rounded-full border border-[#7a32fc]/15 bg-[#7a32fc]/10 px-3 py-1 text-[10px] font-bold uppercase text-[#7a32fc]">
                  Em breve
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium leading-relaxed text-slate-700">
                  A conversa interna e privada da equipe multidisciplinar sobre{" "}
                  <strong>{displayName}</strong> aparecerá aqui.
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-3 py-2">
                  <span className="text-xs font-semibold text-slate-400">
                    Canal privado em preparação
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-600 transition-all hover:bg-slate-200"
                  >
                    <Minus size={13} />
                    Recolher
                  </button>
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        title="Chat interno da equipe"
        aria-label={`Abrir chat interno sobre ${displayName}`}
        onClick={(event) => {
          stopCardClick(event);
          setIsOpen(true);
        }}
        className={`inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-[#7a32fc]/15 bg-white/90 text-[#7a32fc] shadow-sm transition-all hover:border-[#7a32fc]/30 hover:bg-[#f7f2ff] ${
          compact
            ? "px-2 py-1 text-[9px] font-bold"
            : "px-3 py-2 text-[10px] font-bold"
        } ${className}`}
      >
        <MessageCircle size={compact ? 12 : 14} />
        {!compact && <span>Chat</span>}
        <span className="rounded-full bg-[#7a32fc]/10 px-1.5 py-0.5 text-[8px] font-bold uppercase">
          Em breve
        </span>
      </button>
      {isOpen && drawer}
    </>
  );
};
