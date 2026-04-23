export type VertoRole =
  | 'coordinator'
  | 'receptionist'
  | 'therapist'
  | 'patient'
  | 'admin'
  | 'owner';

export type RoleCapabilityStatus = 'full' | 'limited' | 'none';

export interface RoleCapabilityItem {
  key: string;
  label: string;
  description: string;
  coordinator: RoleCapabilityStatus;
  receptionist: RoleCapabilityStatus;
  therapist: RoleCapabilityStatus;
}

export interface RoleCapabilitySection {
  id: string;
  title: string;
  description: string;
  items: RoleCapabilityItem[];
}

export const ROLE_CAPABILITY_SECTIONS: RoleCapabilitySection[] = [
  {
    id: 'agenda',
    title: 'Agenda e Operação',
    description: 'Organiza a rotina clínica, reservas e acompanhamento dos atendimentos.',
    items: [
      {
        key: 'agenda-multi-view',
        label: 'Agenda diária, semanal e mensal',
        description: 'Visualização operacional em cards para a clínica.',
        coordinator: 'full',
        receptionist: 'full',
        therapist: 'limited',
      },
      {
        key: 'schedule-edit',
        label: 'Agendar e editar sessões',
        description: 'Criar, remarcar e atualizar status dos atendimentos.',
        coordinator: 'full',
        receptionist: 'full',
        therapist: 'limited',
      },
      {
        key: 'rooms',
        label: 'Reserva e edição de salas',
        description: 'Reservar salas e ajustar disponibilidade operacional.',
        coordinator: 'full',
        receptionist: 'limited',
        therapist: 'limited',
      },
    ],
  },
  {
    id: 'patients',
    title: 'Pacientes e Prontuários',
    description: 'Controla cadastro, prontuários e documentos clínicos.',
    items: [
      {
        key: 'patient-intake',
        label: 'Cadastro inicial de pacientes',
        description: 'Inclusão e atualização cadastral básica.',
        coordinator: 'full',
        receptionist: 'full',
        therapist: 'none',
      },
      {
        key: 'medical-records',
        label: 'Acesso a prontuários',
        description: 'Consulta clínica detalhada com histórico do paciente.',
        coordinator: 'full',
        receptionist: 'none',
        therapist: 'full',
      },
      {
        key: 'anamnesis',
        label: 'Anamnese adulto e infantil',
        description: 'Abertura e preenchimento das fichas clínicas da plataforma.',
        coordinator: 'full',
        receptionist: 'none',
        therapist: 'full',
      },
    ],
  },
  {
    id: 'clinical',
    title: 'Protocolos e Evolução',
    description: 'Centraliza protocolos, biblioteca clínica e evolução terapêutica.',
    items: [
      {
        key: 'protocol-library',
        label: 'Biblioteca de protocolos',
        description: 'Consulta e manutenção de protocolos e materiais clínicos.',
        coordinator: 'full',
        receptionist: 'none',
        therapist: 'limited',
      },
    ],
  },
  {
    id: 'financial',
    title: 'Financeiro Operacional',
    description: 'Foca em recebimentos, repasses e histórico operacional, sem DRE.',
    items: [
      {
        key: 'team-compensation',
        label: 'Gestão de profissionais e repasses',
        description: 'Nome, CRP, modelo de remuneração e previsão de pagamento.',
        coordinator: 'full',
        receptionist: 'none',
        therapist: 'none',
      },
      {
        key: 'patient-financial',
        label: 'Financeiro de pacientes',
        description: 'Data de pagamento, valor, convênio ou particular.',
        coordinator: 'full',
        receptionist: 'limited',
        therapist: 'none',
      },
      {
        key: 'payment-proof',
        label: 'Comprovantes e histórico de pagamento',
        description: 'Recebimento com anexo e consulta do histórico por data e método.',
        coordinator: 'full',
        receptionist: 'limited',
        therapist: 'none',
      },
    ],
  },
  {
    id: 'governance',
    title: 'Governança e Experiência',
    description: 'Define acessos administrativos e widgets auxiliares do painel.',
    items: [
      {
        key: 'clinic-settings',
        label: 'Configurações iniciais da clínica',
        description: 'CNPJ, horários de expediente e identidade da clínica.',
        coordinator: 'full',
        receptionist: 'none',
        therapist: 'none',
      },
      {
        key: 'billing-management',
        label: 'Assinatura e cobrança',
        description: 'Gestão do plano contratado e histórico de faturamento da conta.',
        coordinator: 'full',
        receptionist: 'none',
        therapist: 'none',
      },
      {
        key: 'engagement-widgets',
        label: 'Widgets de engajamento',
        description: 'Módulos Verto Flow e aniversariantes na interface principal.',
        coordinator: 'full',
        receptionist: 'limited',
        therapist: 'none',
      },
    ],
  },
];

export const ROLE_CAPABILITY_LABELS: Record<'coordinator' | 'receptionist' | 'therapist', string> = {
  coordinator: 'Coordenador',
  receptionist: 'Recepcionista',
  therapist: 'Terapeuta',
};

export const RECEPTIONIST_ALLOWED_VIEWS = [
  'home',
  'patients_registry',
  'room_reservation',
  'profile',
] as const;

export function getRoleDescription(role: 'coordinator' | 'receptionist' | 'therapist') {
  const descriptions = {
    coordinator:
      'Opera a clínica, acessa prontuários, protocolos, financeiro operacional e gestão da equipe.',
    receptionist:
      'Foca em agenda, reservas de sala, cadastro inicial e acompanhamento operacional sem prontuários.',
    therapist:
      'Atua no cuidado clínico, prontuários, anamnese, protocolos e evolução terapêutica.',
  };

  return descriptions[role];
}
