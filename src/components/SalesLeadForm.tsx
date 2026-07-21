import React from 'react';
import { SalesInterestForm } from './SalesInterestForm';

type SalesLeadFormProps = {
  initialName?: string;
  initialEmail?: string;
  acquisitionChannel?: string;
  onSubmitted?: (lead: { name: string }) => void;
};

/**
 * @deprecated Use `SalesInterestForm` diretamente.
 * Mantido como wrapper temporário para evitar quebra de imports indiretos.
 */
export const SalesLeadForm = ({
  initialName = '',
  initialEmail = '',
  acquisitionChannel = '',
  onSubmitted,
}: SalesLeadFormProps) => (
  <SalesInterestForm
    initialName={initialName}
    initialEmail={initialEmail}
    initialAcquisitionChannel={acquisitionChannel}
    onSubmitted={onSubmitted}
  />
);
