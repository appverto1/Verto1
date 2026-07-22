import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DISCOUNT_EXPIRY_NOTIFICATION_DAYS,
  PUBLIC_ACTIVE_PATIENT_PRICE,
  PUBLIC_ACTIVE_PATIENT_PRICE_LABEL,
  PUBLIC_SALES_WHATSAPP_NUMBER,
  PUBLIC_SALES_WHATSAPP_URL,
  SALES_COUPON_DURATION_MONTHS,
  SALES_CONTACT_REQUIRED_ERROR,
  SALES_INTEREST_SUCCESS_MESSAGE,
  SALES_INTEREST_SUCCESS_TITLE,
  SALES_WHATSAPP_CTA_LABEL,
  buildSalesWhatsappMessage,
  buildSalesWhatsappUrl,
} from "../src/constants/salesCommercial";
import {
  normalizeSalesLeadPhone,
  validateSalesLeadPayload,
} from "../src/utils/salesLead";

const read = (path: string) => readFileSync(path, "utf8");
const server = read("server.ts");
const landing = read("src/components/LandingPage.tsx");
const salesForm = read("src/components/SalesInterestForm.tsx");
const legacySalesForm = read("src/components/SalesLeadForm.tsx");
const legacyCommercialConfig = read("src/config/commercial.ts");
const app = read("src/App.tsx");
const superAdmin = read("src/components/SuperAdminDashboard.tsx");
const subscriptionSummary = read("src/components/SubscriptionDiscountSummary.tsx");
const salesActivation = read("src/components/SalesActivationAccess.tsx");
const clinicSettings = read("src/components/ClinicGlobalSettingsPanel.tsx");
const migration = read(
  "supabase/migrations/20260720190000_sales_assisted_signup.sql",
);
const minimalCaptureMigration = read(
  "supabase/migrations/20260722170000_sales_lead_minimal_capture.sql",
);
const envExample = read(".env.example");

test("preço público oficial está centralizado e não expõe o preço antigo", () => {
  assert.equal(PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents, 7990);
  assert.equal(PUBLIC_ACTIVE_PATIENT_PRICE.currency, "BRL");
  assert.equal(PUBLIC_ACTIVE_PATIENT_PRICE.formattedUnitAmount, "R$ 79,90");
  assert.equal(
    PUBLIC_ACTIVE_PATIENT_PRICE_LABEL,
    "R$ 79,90 por paciente ativo/mês",
  );
  assert.deepEqual(SALES_COUPON_DURATION_MONTHS, [6, 12, 24]);
  assert.deepEqual(DISCOUNT_EXPIRY_NOTIFICATION_DAYS, [30, 7, 1]);
  assert.doesNotMatch(`${landing}\n${salesForm}`, /R\$\s*39[,.]90|\b3990\b/);
  assert.doesNotMatch(
    salesForm,
    /PUBLIC_ACTIVE_PATIENT_PRICE_LABEL|SALES_SPECIAL_CONDITIONS_TEXT|R\$\s*79[,.]90/,
  );
  assert.doesNotMatch(legacyCommercialConfig, /unitAmountCents\s*:\s*7990/);
  assert.match(legacyCommercialConfig, /export \* from ['"]\.\.\/constants\/salesCommercial['"]/);
});

test("WhatsApp comercial usa número canônico e mensagem codificada somente com o nome", () => {
  assert.equal(PUBLIC_SALES_WHATSAPP_NUMBER, "5511959348563");
  assert.equal(PUBLIC_SALES_WHATSAPP_URL, "https://wa.me/5511959348563");
  assert.equal(
    buildSalesWhatsappMessage("  João   da Silva  "),
    "Olá! Acabei de enviar meu interesse na Verto. Meu nome é João da Silva e gostaria de agendar uma apresentação.",
  );
  const url = buildSalesWhatsappUrl("João da Silva");
  assert.match(url, /^https:\/\/wa\.me\/5511959348563\?text=/);
  assert.match(url, /Jo%C3%A3o%20da%20Silva/);
  assert.doesNotMatch(url, /@|leadId|token|stripe/i);
});

test("formulário mínimo confirma a persistência sem criar uma segunda chamada para ação", () => {
  const successStart = salesForm.indexOf("if (submitted)");
  const formStart = salesForm.indexOf("\n  return (\n    <form", successStart);
  assert.ok(successStart >= 0);
  assert.ok(formStart > successStart);
  const successBlock = salesForm.slice(successStart, formStart);
  assert.doesNotMatch(
    successBlock,
    /buildSalesWhatsappUrl|target="_blank"|MessageCircle|SALES_WHATSAPP_CTA_LABEL/,
  );
  assert.equal(SALES_INTEREST_SUCCESS_TITLE, "Recebemos seu interesse na Verto");
  assert.equal(
    SALES_INTEREST_SUCCESS_MESSAGE,
    "Entraremos em contato para conhecer sua operação e agendar uma apresentação da plataforma.",
  );
  assert.equal(SALES_WHATSAPP_CTA_LABEL, "Conversar agora pelo WhatsApp");
  assert.match(salesForm, /submissionInFlightRef\.current/);
  assert.match(salesForm, /if \(submissionInFlightRef\.current \|\| submitted\) return/);
  assert.doesNotMatch(salesForm.slice(formStart), /buildSalesWhatsappUrl|wa\.me/);
});

test("formulário legado é apenas wrapper do formulário canônico", () => {
  assert.match(legacySalesForm, /import \{ SalesInterestForm \}/);
  assert.match(legacySalesForm, /<SalesInterestForm/);
  assert.doesNotMatch(legacySalesForm, /fetch\(|<form|submitted|wa\.me/);
});

test("configuração de destinatário permanece server-side e canônica", () => {
  assert.match(envExample, /SALES_NOTIFICATION_EMAIL=appverto1@gmail\.com/);
  assert.match(envExample, /VITE_SALES_WHATSAPP_NUMBER=5511959348563/);
  assert.doesNotMatch(envExample, /(?:SALES_EMAIL|SALES_CONTACT_URL|WHATSAPP_SALES_URL|VITE_SALES_CONTACT_URL|VITE_WHATSAPP_SALES_URL)=/);
  assert.match(server, /function resolveSalesNotificationEmail\(\)/);
  assert.match(server, /process\.env\.SALES_NOTIFICATION_EMAIL/);
  assert.match(server, /const notificationEmail = resolveSalesNotificationEmail\(\)/);
  assert.doesNotMatch(`${landing}\n${salesForm}\n${legacySalesForm}`, /appverto1@gmail\.com/);
});

test("cadastro profissional público virou lead e cadastro de paciente continua separado", () => {
  assert.match(landing, /<SalesInterestForm/);
  assert.match(salesForm, /fetch\([\"']\/api\/public\/sales-leads[\"']/);
  assert.match(salesForm, />\s*Nome\s*</);
  assert.match(salesForm, />\s*WhatsApp\s*</);
  assert.match(salesForm, /Nome da clínica/);
  assert.match(salesForm, /\(opcional\)/);
  assert.match(salesForm, /website,/);
  assert.match(salesForm, /loading \? "Enviando\.\.\." : "Enviar"/);
  assert.doesNotMatch(
    salesForm,
    /sales-email|sales-registry|sales-city|sales-state|sales-patients|sales-operation|sales-channel|sales-title|sales-professionals|sales-period|sales-notes/,
  );
  assert.doesNotMatch(
    salesForm,
    /type="checkbox"|GoogleIcon|onStartGoogle|contactConsent|consentVersion|Solicitar apresentação/,
  );
  assert.match(landing, /fetch\([\"']\/api\/auth\/signup[\"']/);
  assert.match(landing, /role: [\"']patient[\"']/);
  assert.doesNotMatch(landing, /create-checkout-registration/);
  assert.doesNotMatch(salesForm, /type="password"|password/);
});

test("validação mínima exige somente nome e WhatsApp e aceita clínica opcional", () => {
  const withoutClinic = validateSalesLeadPayload({
    name: "Ana",
    phone: "(55) 99999-9999",
  });
  assert.deepEqual(withoutClinic.errors, {});
  assert.equal(withoutClinic.value.clinicName, "");
  assert.equal(withoutClinic.value.operationType, "independent_professional");
  assert.equal(normalizeSalesLeadPhone("(55) 99999-9999"), "+5555999999999");

  const withClinic = validateSalesLeadPayload({
    name: "Mateus",
    phone: "(11) 95934-8563",
    clinicName: "Espaço Guiar",
  });
  assert.deepEqual(withClinic.errors, {});
  assert.equal(withClinic.value.operationType, "clinic");
  assert.equal(withClinic.value.email, "");
  assert.equal(withClinic.value.estimatedActivePatients, null);
});

test("migration de captura mínima é aditiva, idempotente e preserva enriquecimento", () => {
  assert.match(minimalCaptureMigration, /alter column email drop not null/i);
  assert.match(minimalCaptureMigration, /alter column normalized_email drop not null/i);
  assert.match(
    minimalCaptureMigration,
    /alter column estimated_active_patients drop not null/i,
  );
  assert.match(minimalCaptureMigration, /create or replace function public\.upsert_public_sales_lead/i);
  assert.match(minimalCaptureMigration, /email = coalesce\(v_email, email\)/i);
  assert.match(minimalCaptureMigration, /clinic_name = coalesce/i);
  assert.match(minimalCaptureMigration, /on conflict \(idempotency_key\) do nothing/i);
  assert.doesNotMatch(
    minimalCaptureMigration,
    /^\s*(?:delete\s+from|truncate|drop\s+table)\s+public\.sales_/im,
  );
});

test("endpoint legado de checkout profissional está bloqueado sem efeitos", () => {
  const routeStart = Math.max(
    server.indexOf('"/api/stripe/create-checkout-registration"'),
    server.indexOf("'/api/stripe/create-checkout-registration'"),
  );
  assert.ok(routeStart >= 0);
  const route = server.slice(routeStart, routeStart + 700);
  assert.match(route, /status\(410\)/);
  assert.match(route, /SALES_ASSISTED_SIGNUP_ERROR/);
  assert.doesNotMatch(
    route,
    /auth\.admin\.createUser|checkout\.sessions\.create|ensureClinicAndMembershipForCoordinator/,
  );
});

test("Google desconhecido exige contato comercial e não provisiona clínica antes da ativação", () => {
  assert.equal(SALES_CONTACT_REQUIRED_ERROR, "SALES_CONTACT_REQUIRED");
  assert.match(server, /if \(!validPaidActivation\)/);
  assert.match(server, /error: SALES_CONTACT_REQUIRED_ERROR/);
  assert.match(
    server,
    /A clínica somente pode ser criada após uma ativação paga persistida pelo webhook assinado/,
  );
  assert.match(app, /verto_sales_google_prefill/);
  assert.match(app, /await supabase\.auth\.signOut\(\)/);
  assert.match(app, /setUser\(null\)/);
});

test("leads e ofertas usam RLS, token hash e idempotência", () => {
  assert.match(
    migration,
    /alter table public\.sales_leads enable row level security/,
  );
  assert.match(
    migration,
    /alter table public\.sales_offers enable row level security/,
  );
  assert.match(migration, /public_token_hash text not null/);
  assert.match(migration, /sales_offers_public_token_hash_uidx/);
  assert.match(migration, /sales_offers_creator_idempotency_uidx/);
  assert.match(migration, /sales_lead_events_idempotency_uidx/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /discount_duration_months in \(6, 12, 24\)/);
  assert.match(server, /hashSalesOfferToken\(token\)/);
  assert.match(server, /deriveSalesOfferPublicToken/);
  assert.match(server, /createHmac\("sha256", secret\)/);
  assert.match(server, /IDs Stripe não são aceitos pelo cliente/);
});

test("ausência de Stripe real mantém oferta em rascunho e checkout retorna 503 controlado", () => {
  assert.match(server, /status: ready \? [\"']ready[\"'] : [\"']draft[\"']/);
  assert.match(server, /STRIPE_SALES_CONFIGURATION_PENDING/);
  assert.match(server, /status\(503\)/);
  assert.match(server, /Configuração Stripe pendente/);
  assert.match(envExample, /STRIPE_BASE_ACTIVE_PATIENT_PRICE_ID=/);
  assert.match(envExample, /STRIPE_COUPON_6_MONTHS_ID=/);
  assert.match(envExample, /STRIPE_COUPON_12_MONTHS_ID=/);
  assert.match(envExample, /STRIPE_COUPON_24_MONTHS_ID=/);
  assert.doesNotMatch(envExample, /STRIPE_COUPON_(?:6|12|24)_MONTHS_ID=\S+/);
});

test("webhook e avisos de desconto estão preparados de forma idempotente", () => {
  assert.match(server, /flowType.*sales_assisted_signup/s);
  assert.match(server, /processSalesAssistedCheckoutCompleted/);
  assert.match(server, /syncSalesSubscriptionDiscount/);
  assert.match(server, /discountEndsAt =\s*Number\(discount\?\.end/);
  assert.match(server, /payment-completed:\$\{session\.id\}/);
  assert.match(server, /activation-sent:\$\{session\.id\}/);
  assert.match(server, /run-discount-expiry/);
  assert.match(server, /DISCOUNT_EXPIRY_NOTIFICATION_DAYS\.includes/);
  assert.match(
    server,
    /stripe_subscription_id.*endAt\.toISOString\(\).*window/s,
  );
  assert.match(migration, /sales_discount_notifications_idempotency_uidx/);
});

test("painel comercial preserva legado, filtra leads e cria oferta lógica", () => {
  assert.match(superAdmin, /label="Comercial"/);
  assert.match(superAdmin, /Leads e propostas/);
  assert.match(superAdmin, /checkout legado/i);
  assert.match(superAdmin, /api\/owner\/sales\/leads/);
  assert.match(superAdmin, /api\/owner\/sales\/offers/);
  assert.match(superAdmin, /Cupom 6 meses/);
  assert.match(superAdmin, /Cupom 12 meses/);
  assert.match(superAdmin, /Cupom 24 meses/);
  assert.match(superAdmin, /"X-Idempotency-Key": requestKey/);
  assert.match(server, /idempotency_key: requestIdempotencyKey/);
});

test("ativação paga conclui o vínculo comercial uma única vez", () => {
  assert.match(server, /finalizeSalesActivationForUser/);
  assert.match(server, /activation-completed:\$\{leadId\}:\$\{params\.userId\}/);
  assert.match(server, /converted_user_id: params\.userId/);
  assert.match(server, /converted_clinic_id: params\.clinicId/);
  assert.match(server, /subscription_status: commercialPaidActivation \? "active" : "pending"/);
  assert.match(server, /onConflict: "idempotency_key", ignoreDuplicates: true/);
});



test("lead público protege identidade, origem e retries concorrentes", () => {
  assert.match(server, /\["public_landing", "google_interest"\]\.includes/);
  assert.match(server, /SALES_LEAD_IDENTITY_CONFLICT/);
  assert.match(server, /status\(missingSchema \? 503 : identityConflict \? 409 : 500\)/);
  assert.match(migration, /v_email_lead_id uuid/);
  assert.match(migration, /v_phone_lead_id uuid/);
  assert.match(migration, /v_email_lead_id <> v_phone_lead_id/);
  assert.match(migration, /exception when unique_violation/);
});

test("ativação comercial pública exige oferta paga e vínculo exato da sessão", () => {
  assert.match(app, /SalesActivationAccess/);
  assert.match(app, /ativacao-comercial/);
  assert.match(salesActivation, /\/api\/public\/sales-activations\//);
  assert.match(salesActivation, /Vincular e entrar com Google/);
  assert.match(server, /loadPublicSalesActivation/);
  assert.match(server, /\.eq\("source", "sales_assisted_signup"\)/);
  assert.match(server, /\.eq\("status", "paid"\)/);
  assert.match(server, /\.eq\("stripe_checkout_session_id", checkoutSessionId\)/);
  assert.match(server, /crypto\.randomBytes\(36\)\.toString\("base64url"\)/);
  assert.match(server, /const tokenHash = hashSalesOfferToken\(activationToken\)/);
  assert.match(server, /error: "WEAK_PASSWORD"/);
  assert.doesNotMatch(salesActivation, /clinicId|offerId|leadId|stripe_/i);
});

test("webhook só libera ativação após pagamento confirmado", () => {
  assert.match(server, /const paymentConfirmed =/);
  assert.match(server, /paymentStatus === "paid"/);
  assert.match(server, /paymentStatus === "no_payment_required"/);
  assert.match(server, /return \{ paymentConfirmed: false, activationPrepared: false \}/);
  assert.match(server, /buildSalesPostPaymentActivationEmail/);
  assert.match(server, /activation_email_sent_at/);
  assert.match(migration, /pending_activations_sales_checkout_uidx/);
  assert.match(migration, /pending_activations_sales_token_uidx/);
});

test("área de assinatura lê snapshot persistido sem consultar Stripe a cada render", () => {
  assert.match(server, /\/api\/billing\/discount-summary/);
  assert.match(server, /source: "persisted_stripe_snapshot"/);
  assert.match(server, /\.eq\("clinic_id", clinicId\)/);
  assert.match(subscriptionSummary, /fetch\("\/api\/billing\/discount-summary"/);
  assert.match(subscriptionSummary, /Após essa data:/);
  assert.match(subscriptionSummary, /Histórico de avisos/);
  assert.match(clinicSettings, /<SubscriptionDiscountSummary \/>/);
  assert.doesNotMatch(subscriptionSummary, /stripe\.subscriptions|api\.stripe/);
});
