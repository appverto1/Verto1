# Seguranca e Conformidade (MVP)

## Controles implementados neste MVP
- RBAC por papel em rotas sensiveis (`coordinator`, `receptionist`, `therapist`, `patient`, `admin`, `owner`).
- Sanitizacao e allowlist de payload para `patients`, `notes`, `history`, `tasks` e `payments`.
- Mitigacao basica de CSRF por validacao de `Origin` em operacoes mutaveis.
- Sessao com `httpOnly`, `secure` (producao), `sameSite` ajustado por ambiente.
- Armazenamento de prontuario sensivel em payload criptografado (AES-256-GCM) no endpoint `/api/patient-records/:patientId`.
- Pseudonimizacao deterministica (`pseudonym_id`) para reduzir exposicao de identificadores diretos.
- Buckets de midia privados (sem URL publica por padrao) e uso de URL assinada para acesso.

## Variaveis de ambiente obrigatorias para seguranca
- `SESSION_SECRET`: segredo de sessao.
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATA_ENCRYPTION_KEY`: chave de 32 bytes (hex 64 chars ou base64).
- `PSEUDONYMIZATION_KEY`: segredo para pseudonimizacao.
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `VERTO_APP_BASE_URL`: URL base de produção para redirects de autenticação.
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SMS_PROVIDER_URL`
- `SMS_PROVIDER_API_KEY`

## SQL de seguranca adicional
- Executar: `sql/patient_security_foundation.sql`
- Executar: `sql/workspace_onboarding_foundation.sql`
- Inclui `patient_records` (payload sensivel criptografado) e `clinic_anamnesis_templates` (customizacao de perguntas por clinica).

## Limites importantes (auditoria/certificacao)
- Este projeto **nao sai automaticamente certificado HIPAA/LGPD** apenas por codigo.
- Para certificacao real, ainda e necessario:
  - BAA com provedores (quando aplicavel), governanca, processos e treinamento.
  - DPIA/RIPD, base legal, retencao/eliminacao, trilha de auditoria formal.
  - Gestao de segredos/HSM, rotacao de chave e backup cifrado gerenciado.
  - Pentest externo e auditoria de conformidade independente.
