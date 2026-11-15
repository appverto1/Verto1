import type { MouseEventHandler, ReactNode } from 'react';
import { getPatientWhatsAppUrl } from '../utils/patientWhatsapp';

type PatientWhatsAppLinkProps = {
  phone: unknown;
  className: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export const PatientWhatsAppLink = ({ phone, className, children, onClick }: PatientWhatsAppLinkProps) => {
  const href = getPatientWhatsAppUrl(phone);
  return (
    <a
      href={href ?? undefined}
      aria-disabled={!href}
      title={href ? 'Abrir WhatsApp' : 'Cadastre um telefone válido com DDD'}
      target="_blank"
      rel="noopener noreferrer"
      className={className + ' aria-disabled:opacity-40 aria-disabled:cursor-not-allowed'}
      onClick={onClick}
    >
      {children}
    </a>
  );
};
