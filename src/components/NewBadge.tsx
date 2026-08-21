import React from 'react';

export const NewBadge = ({ label = 'Novo' }: { label?: string }) => (
  <span className="inline-flex shrink-0 items-center rounded-full border border-violet-300/90 bg-slate-50 px-1.5 py-0.5 text-[8px] font-medium leading-none text-slate-600">
    {label}
  </span>
);
