# P0 — Governança de compartilhamento de gráficos infantis

**Data:** 23/10/2026. **Base:** Staging pós PR #478 (proteção da identidade da RPC). **PR:** #479. Este documento é checkpoint técnico da implementação, não certificação de smoke.

## Contrato preservado
- Portal infantil usa exclusivamente seleção clínica `PLAN_PTS` / `ABA_V3` do PR #440 e suas séries canônicas. Nenhuma série de dados é copiada para a tabela de seleção.
- Portal adulto mantém bem-estar fixo. Prontuários, Salvar clínico, histórico, Stripe, convites e portais não foram alterados.
- A rota legada `/api/portal/patients/:patientId/mastery-growth` retorna `403 GRAPH_NOT_SHARED` após autenticação e verificação de escopo. Ela não é fonte autorizada para gráfico compartilhado.

## Autoridade e persistência
- Diretor/coordenador e liderança da clínica: podem publicar e gerir autorizações dentro da própria clínica. Supervisor precisa de vínculo ativo com o caso.
- Profissionais terapeutas precisam de delegação ativa e vínculo profissional ativo **no mesmo caso e clínica**, além de capacidade clínica do middleware. O backend revalida; IDs e controles do browser não são autoridade.
- Delegações são gravadas apenas após botão **Salvar** e resposta confirmada da RPC; revogações são verificadas a cada operação. Auditoria append-only sem séries clínicas.
- Salvar/substituir/remover continuam usando as RPCs canônicas V2 em transação, agora com autorização clínica reforçada.
- Nenhuma associação de identidade global é criada automaticamente.

## Identidade global condicional
- Quando `patients.global_patient_identity_id` estiver ausente: preservar compartilhamento canônico por clínica, sem request extra no portal ou bloqueio de pacientes existentes.
- Quando identidade global estiver presente e autorizada no cadastro canônico: o trigger do banco publica um único `PLAN_PTS`/`ABA_V3` globalmente por identidade, com row lock, conflito de outra clínica e auditoria transacional. Repetir Salvar da mesma seleção não grava audit duplicado.
- Portal revalida paciente ativo e clínica da sessão; com identidade global, também compara owner, paciente, família e hash do gráfico com o registry antes de projetar. Nunca mostra o gráfico de outra clínica.
- Desvincular, arquivar, desativar ou transferir o paciente invalida a publicação global ativa.
- Staging possuía **0/12** pacientes ativos com identidade global verificada na auditoria; não são gerados vínculos artificiais. Identidades futuras exigem reconciliação/prova externa antes de preenchimento autorizado.

## Banco, compatibilidade e custos
- Migrações nesta ordem: `20261023235530` (bootstrap idempotente de objetos presentes em Staging pela migração histórica do Draft #429); `20261023235600` (controle de caso, grants, RPCs atuais e auditoria); `20261023235700` (bridge singleton, bloqueio cross-clinic, desligamento no unlink).
- RLS segue habilitada; `anon` e `authenticated` não recebem execução de mutações nem leitura direta das tabelas privilegiadas. A RPC pública de controle da Issue #477 permanece vinculada ao JWT.
- Um RPC de autoridade é consultado junto da seleção ao montar o controle profissional. Lista de delegações só é buscada ao abrir a gestão. Registry extra só é lido quando existe ID global. Sem polling, N+1 ou cópia de pontos.
- O código não modifica Supabase Produção nem associa dados reais. A migração de Staging, CI completo, deploy e smoke por papéis são gates distintos.

## Negativos obrigatórios
- Browser sem sessão, outro paciente/clínica, outro papel, profissional não delegado, vínculo revogado, ID malformado, concorrência de duas clínicas com identidade global, reenvio e salvamento duplicado, leitura do endpoint legado.
- Confirmar `Salvar/F5/relogin`, continuidade adulto e portais corretos apenas após smoke autenticado.
