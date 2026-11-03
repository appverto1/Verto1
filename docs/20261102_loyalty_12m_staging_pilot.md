# Fidelidade Verto — termo aprovado e aceite eletrônico (staging)

## Escopo
- Prazo fixo de **12 meses**, sem retroagir à assinatura existente e sem nova fidelidade automática.
- Teto inicial de **duas mensalidades de referência**, proporcional a dias restantes/dias totais, conforme o documento aprovado pelo responsável da Verto.
- A eventual cobrança está **fora do escopo**: não há criação de invoice, alteração de Stripe, suspensão/cancelamento técnico ou débito de multa.
- Benefício comercial concreto, valor econômico, condições, partes e datas devem ser preenchidos antes da oferta.
- Abrange clientes já pagantes, identificados pelo ledger servidor da Stripe e vinculados à clínica.
- O termo comercial é uma proposta de adesão voluntária; sua validade/exigibilidade jurídica deve ser avaliada por profissional habilitado.

## Estrutura e trilha de consentimento
1. Super Admin/MFA acessa "Clientes e Lucro" e clica "Preparar contrato".
2. Super Admin preenche identificação contratual das partes, CNPJs numéricos ou alfanuméricos, endereço, benefício, valor econômico, condições, mensalidade de referência e data de início; somente **Salvar e disponibilizar** faz o registro da oferta (não há autosave).
3. Backend deriva o ID da assinatura ativa e paga do ledger; gera documento completo baseado no template de versão 1.0; banco grava texto integral com SHA-256, datas e status **offered**. Oferta publicada é imutável por rotas.
4. Diretor autenticado da clínica abre **Menu da conta > Contrato de fidelidade**, vê o texto completo e pode salvar cópia.
5. Caixa "Li e aceito..." inicia desmarcada. Clique separado em **Confirmar aceite** chama POST protegido.
6. Backend usa clínica ativa validada, identidade do diretor, capability não delegável e RPC restrita. Banco valida `clinic_memberships` ativo/diretor, estado paid+active vinculado, hash exato, janela de início e grava `accepted_at`, `accepted_by`, nome e e-mail do representante. Reenvio idêntico é idempotente; aceite concorrente diferente não sobrescreve o primeiro.
7. Documento aceito permanece disponível para leitura e cópia mesmo que o status da cobrança mude posteriormente.
8. Nenhuma atualização clínica, financeira, de usuários, módulos, acessos ou de assinaturas Stripe.

## Segurança / isolamento
- Banco de staging: projeto **irspungjhapqdbgqroyc**.
- Backend só habilita com `VERTO_LOYALTY_STAGING_ENABLED=true`, `VERTO_DEPLOYMENT_ENV=staging` e `SUPABASE_EXPECTED_PROJECT_REF=irspungjhapqdbgqroyc`.
- Frontend de staging só mostra painéis com `VITE_FEATURE_LOYALTY_STAGING=true`.
- Em produção esses flags devem permanecer desabilitados; APIs retornam 404.
- RLS com acesso apenas a service-role e RPCs sob backend autenticado. Contrato sempre vinculado a `organization_id`; frontend não envia Stripe ID, papel, clínica, valor ou data no aceite.
- Operações atômicas com lock e controle de duplicação; sem Realtime, cron, polling ou leituras clínicas.
- Após aceite o texto e seu hash permanecem congelados; ausência de mudança de termos sem novo procedimento.

## Homologação obrigatória antes do merge
- Testes estruturais e SQL transacional com rollback em staging (dados não persistidos).
- Executar suíte Node/TypeScript, build e revisão de diff do PR.
- Verificar 401/403/404 em contas sem acesso, IDs manipulados, POST sem checkbox, hash errado e múltiplos aceites.
- Conferir persistência após recarregamento; atualizações no mesmo fluxo sem F5.
- Deploy somente para staging, sem nova infraestrutura nem custo adicional intencional.
- Após validação, smoke humano um passo por vez.

## Juridico e condicoes comerciais
A "versão aprovada" nesta entrega representa aprovação do texto pelo responsável do produto. **Não representa parecer jurídico emitido por advogado**. Antes de oferecer a um cliente real, confirmar a adequação da multa proporcional, a contrapartida real, eventuais direitos do consumidor e os dados completos de cada instrumento. Nenhuma multa é lançada automaticamente.
