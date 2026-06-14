import React from "react";
import { X } from "lucide-react";

type ActiveFilterBannerProps = {
  label: string;
  count: number;
  onClear: () => void;
  noun?: string;
};

export function ActiveFilterBanner({
  label,
  count,
  onClear,
  noun = "sessões",
}: ActiveFilterBannerProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Filtro aplicado: {label} — {count} {noun} encontradas nesta página
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex w-fit items-center gap-1 rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
      >
        <X size={13} />
        Limpar filtro
      </button>
    </div>
  );
}
