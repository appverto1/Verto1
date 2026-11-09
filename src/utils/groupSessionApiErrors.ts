export function groupSessionErrorMessage(code: string): string {
  if (/OUT_OF_SCOPE|NOT_FOUND/.test(code)) return 'Sessão ou participante não encontrado nesta clínica.';
  if (code === 'GROUP_ROOM_CAPACITY_EXCEEDED') return 'A sala selecionada não comporta todos os pacientes. Escolha uma sala com capacidade suficiente ou revise a capacidade no cadastro de salas.';
  if (code === 'GROUP_ROOM_CAPACITY_REQUIRED') return 'A sala selecionada está sem capacidade válida. Defina a capacidade no cadastro de salas antes de agendar.';
  if (/CAPACITY/.test(code)) return 'A quantidade de participantes excede a capacidade disponível da sala.';
  if (/PATIENT_BUSY/.test(code)) return 'Um dos pacientes já possui atendimento nesse horário.';
  if (/SLOT_BUSY|PROFESSIONAL_BUSY|ROOM_BUSY/.test(code)) return 'A sala ou um profissional está indisponível nesse horário.';
  if (/SCHEDULE_UNAVAILABLE|BUFFER_UNAVAILABLE|BREAK_UNAVAILABLE|EXCEPTION_UNAVAILABLE|ROOM_UNAVAILABLE|LOCATION_UNAVAILABLE/.test(code)) return 'O horário ou a sala não está disponível na agenda de um dos profissionais.';
  if (/RATE_PLAN_AMBIGUOUS|PRICING_AMBIGUOUS/.test(code)) return 'Há mais de um plano financeiro para a especialidade de um paciente. Revise o cadastro.';
  if (code === 'GROUP_PRICING_PLAN_NOT_VALID_AT_DATE') return 'O paciente possui plano particular para essa especialidade, mas ele não está vigente na data escolhida. Revise as datas de validade no plano financeiro antes de agendar.';
  if (code === 'GROUP_PRICING_PLAN_MISSING') return 'Falta um plano financeiro particular ativo para a especialidade selecionada. Abra o cadastro do paciente, acesse Plano financeiro e cadastre o plano correspondente.';
  if (code === 'GROUP_PRICING_RATE_MISSING') return 'O plano financeiro do paciente está sem preço de sessão em grupo. Abra o cadastro do paciente, acesse Plano financeiro, informe o valor coletivo e salve.';
  if (/RATE_|PRICING_(RATE|PLAN)_MISSING/.test(code)) return 'Cadastre o valor da sessão em grupo para cada paciente nessa especialidade.';
  if (/ALREADY_PARTICIPATING/.test(code)) return 'O paciente já possui um registro nesta sessão em grupo.';
  if (/IDEMPOTENCY_CONFLICT/.test(code)) return 'Esta tentativa já foi usada com outros dados. Atualize os dados e tente novamente.';
  if (/CANCEL_REQUIRES_REFUND_OR_CREDIT/.test(code)) return 'Há pagamento recebido. Regularize o estorno ou crédito no financeiro antes de cancelar.';
  if (/MANUAL_CANCELLATION_DECISION_REQUIRED/.test(code)) return 'Informe o valor de cancelamento dos pacientes sujeitos à decisão manual.';
  if (/MANUAL_POLICY_AMOUNT_INVALID|POLICY_AMOUNT_INVALID/.test(code)) return 'O valor do cancelamento deve estar entre zero e o valor reservado para o paciente.';
  if (/CLINICAL_HISTORY_IMMUTABLE/.test(code)) return 'Esta sessão já foi iniciada ou concluída. Preserve o registro clínico existente.';
  if (/NOT_RESERVED/.test(code)) return 'Esta sessão em grupo já foi encerrada.';
  if (/USE_GROUP_RESCHEDULE/.test(code)) return 'Altere o horário pela edição da sessão em grupo.';
  if (/40P01|40001|CONCURRENT/.test(code)) return 'A agenda foi alterada simultaneamente. Tente novamente para confirmar a disponibilidade.';
  if (/RECURRENCE_LIMIT/.test(code)) return 'Use até 12 ocorrências e até 120 atendimentos por confirmação.';
  if (/INVALID|DUPLICATED/.test(code)) return 'Revise pacientes, profissionais, sala, data e horário antes de salvar.';
  return 'Não foi possível confirmar a operação na sessão em grupo. Atualize a página e tente novamente.';
}
