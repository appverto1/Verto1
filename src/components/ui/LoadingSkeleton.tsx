import React from 'react';

type SkeletonVariant = 'admin' | 'team' | 'partner' | 'onboarding' | 'commercial' | 'external-timeline';

type LoadingSkeletonProps = {
  variant: SkeletonVariant;
  label: string;
};

const Block = ({ className = '' }: { className?: string }) => (
  <div aria-hidden="true" className={`animate-pulse motion-reduce:animate-none rounded-lg bg-slate-200/80 ${className}`} />
);

const PartnerCard = () => (
  <article className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-start gap-3">
      <Block className="h-14 w-14 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2"><Block className="h-4 w-2/3" /><Block className="h-3 w-1/3" /><Block className="h-4 w-3/4" /></div>
    </div>
    <Block className="mt-3 h-4 w-1/2" />
    <Block className="mt-4 h-3 w-full" /><Block className="mt-2 h-3 w-5/6" />
    <div className="mt-4 flex gap-2"><Block className="h-10 w-28 rounded-xl" /><Block className="h-10 w-28 rounded-xl" /></div>
  </article>
);

/** Presentation-only placeholders. No requests, user data, or persistence effects. */
export function LoadingSkeleton({ variant, label }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      data-loading-skeleton={variant}
      className={variant === 'admin' ? 'flex min-h-screen bg-[#F4F7FE]' : variant === 'onboarding' ? 'fixed inset-0 z-[200] overflow-y-auto bg-slate-50 p-4 md:p-6' : ''}
    >
      {variant === 'admin' && (
        <>
          <aside className="hidden h-screen w-24 shrink-0 border-r border-gray-100 bg-white p-5 sm:block">
            <Block className="mx-auto mb-12 h-10 w-10 rounded-xl" />
            <div className="space-y-5">{[0, 1, 2, 3, 4].map(i => <Block key={i} className="mx-auto h-10 w-10 rounded-xl" />)}</div>
          </aside>
          <main className="min-w-0 flex-1 space-y-8 p-4 sm:p-8">
            <div className="flex items-center justify-between gap-4"><div className="space-y-3"><Block className="h-3 w-36" /><Block className="h-8 w-52" /></div><Block className="hidden h-11 w-64 rounded-xl md:block" /></div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map(i => <div key={i} className="rounded-2xl bg-white p-6 shadow-sm"><Block className="h-4 w-28" /><Block className="mt-5 h-9 w-24" /><Block className="mt-3 h-3 w-36" /></div>)}
            </div>
            <div className="grid gap-6 lg:grid-cols-2"><div className="rounded-2xl bg-white p-6"><Block className="h-5 w-44" /><Block className="mt-5 h-56 w-full rounded-xl" /></div><div className="rounded-2xl bg-white p-6"><Block className="h-5 w-36" /><Block className="mt-5 h-56 w-full rounded-xl" /></div></div>
          </main>
        </>
      )}
      {variant === 'team' && (
        <div className="divide-y divide-slate-100">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3"><Block className="h-11 w-11 shrink-0 rounded-xl" /><div className="space-y-2"><Block className="h-4 w-32 sm:w-44" /><Block className="h-3 w-40 max-w-full" /></div></div>
              <div className="flex items-center gap-4"><Block className="hidden h-4 w-24 md:block" /><Block className="h-9 w-9 rounded-xl" /></div>
            </div>
          ))}
        </div>
      )}
      {variant === 'partner' && (
        <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
          {[0, 1, 2, 3].map(i => <PartnerCard key={i} />)}
        </div>
      )}
      {variant === 'onboarding' && (
        <div className="flex min-h-full w-full items-start justify-center py-2 md:py-6">
          <div className="grid min-h-[680px] w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl md:grid-cols-[320px_1fr]">
            <div className="space-y-5 bg-[#7a32fc] p-8"><Block className="h-8 w-52 bg-violet-300/60" /><Block className="h-4 w-full bg-violet-300/60" /><Block className="h-4 w-4/5 bg-violet-300/60" /><div className="space-y-4 pt-8">{[0, 1, 2].map(i => <Block key={i} className="h-4 w-48 bg-violet-300/60" />)}</div></div>
            <div className="space-y-6 p-6 sm:p-10"><Block className="h-7 w-56" /><Block className="h-4 w-3/4" /><div className="grid gap-5 sm:grid-cols-2">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="space-y-2"><Block className="h-3 w-24" /><Block className="h-12 w-full rounded-xl" /></div>)}</div><Block className="ml-auto h-12 w-40 rounded-xl" /></div>
          </div>
        </div>
      )}
      {variant === 'commercial' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><Block className="h-3 w-3/4" /><Block className="mt-4 h-8 w-20" /><Block className="mt-3 h-3 w-full" /><Block className="mt-3 h-3 w-24" /></div>)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map(i => <div key={i} className="rounded-xl border border-slate-200 bg-white p-4"><Block className="h-4 w-3/4" /><Block className="mt-3 h-7 w-24" /><Block className="mt-2 h-3 w-4/5" /></div>)}</div>
          <div className="grid gap-4 xl:grid-cols-2">{[0, 1].map(i => <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4"><Block className="h-5 w-52" /><Block className="mt-2 h-3 w-3/4" /><Block className="mt-5 h-64 w-full rounded-xl" /></div>)}</div>
        </div>
      )}
      {variant === 'external-timeline' && (
        <div className="min-h-[320px] space-y-5 py-4"><Block className="h-7 w-3/4" /><Block className="h-4 w-1/2" /><Block className="h-12 w-full rounded-xl" /><Block className="h-20 w-full rounded-2xl" /><Block className="h-20 w-full rounded-2xl" /></div>
      )}
    </div>
  );
}
