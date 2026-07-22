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
  acquisitionChannel = '',
  onSubmitted,
}: SalesLeadFormProps) => (
  <SalesInterestForm
    initialName={initialName}
    initialAcquisitionChannel={acquisitionChannel}
    onSubmitted={onSubmitted}
  />
);
