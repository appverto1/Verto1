import React from 'react';
import { LogoVerto } from './Common';
import { SalesInterestForm } from './SalesInterestForm';

// Public invitation route: the display is read-only; server validates the
// supplied code and partner eligibility before saving a commercial lead.
export function PartnerInterestPage() {
  const rawCode = new URLSearchParams(window.location.search).get('ref') || '';
  const code = rawCode.toUpperCase();
  const validFormat = /^[A-Z0-9]{4,24}$/.test(code) || /^VERTO-[A-F0-9]{18}$/.test(code);

  return <main className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-8 sm:py-16">
    <div className="w-full max-w-xl">
      <div className="mb-8 flex justify-center"><LogoVerto size={46} showText={true} /></div>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9" aria-labelledby="partner-interest-title">
        <h1 id="partner-interest-title" className="text-2xl font-semibold text-slate-900">Cadastre seu interesse na Verto</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-slate-600">Conte como podemos entrar em contato com você para apresentar a plataforma.</p>
        {validFormat
          ? <SalesInterestForm lockedPartnerCode={code} initialAcquisitionChannel="public_landing" />
          : <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              Link de indicação inválido ou incompleto. Peça um novo link ao parceiro.
            </p>}
      </section>
    </div>
  </main>;
}
