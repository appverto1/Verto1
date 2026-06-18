export type TissRevenueCycleState =
  | "draft"
  | "missing_data"
  | "awaiting_authorization"
  | "authorized"
  | "in_execution"
  | "ready_for_billing"
  | "xml_draft_generated"
  | "billing_batch_draft"
  | "official_xml_validated"
  | "sent"
  | "processed"
  | "paid"
  | "denied"
  | "partially_denied"
  | "appealed";

export type TissRevenueCycleEventType =
  | "PRE_GUIDE_MATERIALIZED"
  | "PRE_GUIDE_VALIDATED"
  | "PRE_GUIDE_READY_FOR_BILLING"
  | "PRE_GUIDE_PENDING"
  | "AUTHORIZATION_ATTACHED"
  | "XML_DRAFT_GENERATED"
  | "XML_DRAFT_VALIDATED"
  | "XML_DRAFT_SUPERSEDED"
  | "TISS_BILLING_BATCH_DRAFT_CREATED"
  | "TISS_BILLING_BATCH_DRAFT_CANCELLED"
  | "TISS_OFFICIAL_XML_GENERATED"
  | "TISS_OFFICIAL_XML_XSD_VALIDATED"
  | "MANUAL_OVERRIDE_APPLIED";

export type TissRevenueCycleTransition = {
  ok: boolean;
  previousState: TissRevenueCycleState;
  newState: TissRevenueCycleState;
  eventType?: TissRevenueCycleEventType;
  reason: string;
  errorCode?: string;
};

const RESERVED_FUTURE_STATES = new Set<TissRevenueCycleState>([
  "sent",
  "processed",
  "paid",
  "denied",
  "partially_denied",
  "appealed",
]);

const ALLOWED_TRANSITIONS: Record<TissRevenueCycleState, TissRevenueCycleState[]> = {
  draft: ["missing_data", "awaiting_authorization", "authorized", "in_execution", "ready_for_billing", "xml_draft_generated", "billing_batch_draft"],
  missing_data: ["missing_data", "awaiting_authorization", "authorized", "in_execution", "ready_for_billing"],
  awaiting_authorization: ["missing_data", "authorized", "ready_for_billing"],
  authorized: ["missing_data", "in_execution", "ready_for_billing"],
  in_execution: ["missing_data", "authorized", "ready_for_billing"],
  ready_for_billing: ["missing_data", "xml_draft_generated", "billing_batch_draft", "official_xml_validated"],
  xml_draft_generated: ["missing_data", "awaiting_authorization", "authorized", "ready_for_billing", "billing_batch_draft", "xml_draft_generated", "official_xml_validated"],
  billing_batch_draft: ["missing_data", "awaiting_authorization", "authorized", "ready_for_billing", "xml_draft_generated", "billing_batch_draft", "official_xml_validated"],
  official_xml_validated: ["official_xml_validated"],
  sent: [],
  processed: [],
  paid: [],
  denied: [],
  partially_denied: [],
  appealed: [],
};

const text = (value: unknown) => String(value ?? "").trim();

export function normalizeTissRevenueCycleState(value: unknown): TissRevenueCycleState {
  const normalized = text(value).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, normalized)) {
    return normalized as TissRevenueCycleState;
  }
  return "draft";
}

export function isFutureOfficialTissRevenueState(state: unknown) {
  return RESERVED_FUTURE_STATES.has(normalizeTissRevenueCycleState(state));
}

export function deriveTissRevenueCycleStateFromPreGuide(input: {
  status?: string | null;
  validationErrorCodes?: string[] | null;
  snapshot?: Record<string, any> | null;
}): { state: TissRevenueCycleState; reason: string } {
  const status = text(input.status).toLowerCase();
  const errorCodes = Array.isArray(input.validationErrorCodes) ? input.validationErrorCodes.map((code) => text(code)) : [];
  const authorization = input.snapshot?.authorization || {};

  if (status === "valid") {
    return { state: "ready_for_billing", reason: "Pré-guia válida e sem pendências bloqueantes." };
  }
  if (status === "not_applicable") {
    return { state: "draft", reason: "Atendimento não aplicável ao fluxo TISS de convênio." };
  }
  if (errorCodes.some((code) => code.includes("AUTHORIZATION") || code.includes("GUIDE"))) {
    return { state: "awaiting_authorization", reason: "Pré-guia depende de autorização/guia para avançar." };
  }
  if (authorization.authorizationId && !errorCodes.some((code) => code.includes("AUTHORIZATION") || code.includes("GUIDE"))) {
    return { state: "authorized", reason: "Autorização vinculada, mas ainda há pendências antes do faturamento." };
  }
  if (status === "pending_data") {
    return { state: "missing_data", reason: "Pré-guia possui dados pendentes." };
  }
  return { state: "draft", reason: "Pré-guia em digitação ou ainda não validada." };
}

export function transitionTissRevenueCycleState(input: {
  previousState?: string | null;
  newState: string;
  reason?: string | null;
  eventType?: TissRevenueCycleEventType;
}): TissRevenueCycleTransition {
  const previousState = normalizeTissRevenueCycleState(input.previousState);
  const newState = normalizeTissRevenueCycleState(input.newState);
  const reason = text(input.reason) || "Transição operacional do ciclo TISS.";
  if (isFutureOfficialTissRevenueState(newState)) {
    return {
      ok: false,
      previousState,
      newState,
      reason: "Estado reservado para ciclo oficial futuro; não pode ser usado neste marco.",
      errorCode: "TISS_REVENUE_STATE_RESERVED_FOR_FUTURE",
    };
  }
  if (previousState === newState) {
    return { ok: true, previousState, newState, eventType: input.eventType, reason };
  }
  const allowed = ALLOWED_TRANSITIONS[previousState] || [];
  if (!allowed.includes(newState)) {
    return {
      ok: false,
      previousState,
      newState,
      reason: "Transição inválida para o ciclo operacional TISS.",
      errorCode: "TISS_REVENUE_INVALID_STATE_TRANSITION",
    };
  }
  return { ok: true, previousState, newState, eventType: input.eventType, reason };
}

export function buildTissRevenueCycleEventPayload(input: {
  organizationId: string;
  clinicId?: string | null;
  patientId?: string | null;
  appointmentId?: string | null;
  preGuideId?: string | null;
  xmlDraftId?: string | null;
  officialDocumentId?: string | null;
  payerId?: string | null;
  eventType: TissRevenueCycleEventType;
  previousState?: string | null;
  newState: string;
  reason?: string | null;
  performedBy?: string | null;
  metadata?: Record<string, any> | null;
}) {
  const transition = transitionTissRevenueCycleState({
    previousState: input.previousState,
    newState: input.newState,
    eventType: input.eventType,
    reason: input.reason,
  });
  return {
    ok: transition.ok,
    errorCode: transition.errorCode,
    payload: {
      organization_id: input.organizationId,
      clinic_id: input.clinicId || input.organizationId,
      patient_id: input.patientId || null,
      appointment_id: input.appointmentId || null,
      pre_guide_id: input.preGuideId || null,
      xml_draft_id: input.xmlDraftId || null,
      official_document_id: input.officialDocumentId || null,
      payer_id: input.payerId || null,
      event_type: input.eventType,
      previous_state: transition.previousState,
      new_state: transition.newState,
      reason: transition.reason,
      performed_by: input.performedBy || null,
      performed_at: new Date().toISOString(),
      metadata: input.metadata || {},
    },
  };
}
