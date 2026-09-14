# Verto Engineering OS

## Purpose
Transformar intenção do fundador em implementação segura, revisada e validada em `staging`, com GitHub Issue como contrato operacional e sem exigir microgerenciamento humano.

## Lei central
Classificação define COMO executar, não SE executar.

- 🟢: especialista direto + gates normais.
- 🟡: coordenação/isolamento adicional.
- 🔴: transversal/high-risk; normalmente 05 Integration e `GLOBAL_WRITE_LOCK = ACTIVE`.

Produção nunca faz parte da autonomia padrão. Maior estado automático: `SMOKE_READY`. `DONE` só após smoke humano.

## 5 Projetos físicos / 15 papéis lógicos

Projetos físicos do ChatGPT:
- 00 — Orchestrator, exclusivo.
- 01 — Auditor / Red Team, exclusivo.
- 02 — Product & UX Architect, exclusivo.
- W — Writer Lane, runtime dos papéis 04–09.
- Q — Quality & Release, runtime dos papéis 03 e 10–14.

Papéis lógicos canônicos:
00 Orchestrator; 01 Auditor/Red Team; 02 Product & UX; 03 Reviewer/QA; 04 Prontuário; 05 Integration; 06 Financeiro; 07 Agenda; 08 ABA; 09 Supabase/Data; 10 CI/Regression; 11 PR Engineer; 12 Merge Gatekeeper; 13 Rollout/Deploy; 14 Recovery/Incident.

Cada execução de W ou Q assume EXATAMENTE UM papel por handoff, determinado por `current_agent`. A mesma rodada pode encadear outro papel da mesma lane somente depois de fechar formalmente o handoff anterior e carregar o novo contrato de papel.

## Debate estratégico
Ciclo completo: `00 -> 01 -> 02 -> 00`.
Máximo: 2 ciclos completos, de dia ou à noite.
Se houver consenso antes, encerrar antes. Persistindo divergência após o segundo ciclo, 00 decide tecnicamente, registra racional e libera o fluxo.

## Fonte de verdade
Toda execução relevante exige GitHub Issue compreensível sem a conversa original. A Issue deve registrar, quando aplicável: objetivo, contexto, comportamento atual/esperado, classificação, arquitetura, critérios de aceite, fora de escopo, riscos, preservações, módulos, banco, segurança, UX, testes, branch/base SHA, writer, write_lock, current_agent, state, active_handoff, attempt e next_gate.

Handoffs materiais ficam na mesma Issue. Não criar nova Issue para cada troca comum de agente.

## Invariantes
1. Um writer principal por Issue.
2. Preservar estado, cache, persistência, histórico, APIs, permissões e comportamento fora do escopo.
3. Commercial/Super Admin são release-critical.
4. Banco: registre uma vez, leia várias; evite N+1/full loads e duplicação de fonte canônica.
5. Segurança: tenant isolation/RLS, validação server-side, atomicidade quando crítica, zero segredos e defesa contra IDOR/BOLA/races.
6. Falha de gate retorna para correção; nunca avançar artificialmente.
7. Writers não revisam/aprovam a própria implementação.
8. Produção exige autorização própria.

## Write isolation / Critical Integration
Toda Issue tem exatamente um writer principal.

Para alteração 🔴 verdadeiramente transversal — especialmente quando cruza múltiplos módulos, contratos compartilhados, banco/RLS ou integrações críticas — use `GLOBAL_WRITE_LOCK = ACTIVE` como janela exclusiva de escrita de produto em `staging`.

Campos canônicos quando ativo:
- `GLOBAL_WRITE_LOCK: ACTIVE | INACTIVE`;
- `lock_owner_issue: #<n>`;
- `lock_owner_writer: <04-09>`;
- `lock_base_sha: <staging SHA>`;
- `lock_scope: PRODUCT_STAGING`;
- `lock_acquired_at: <timestamp>`;
- `lock_release_gate: STAGING_VERIFIED`.

Regras obrigatórias:
1. Lock ativo congela toda escrita concorrente de produto que possa alterar a base de `staging`, não apenas arquivos/superfícies obviamente sobrepostos.
2. Existe exatamente uma Issue dona do lock e um writer principal. Outros writers 04–09 não podem implementar produto enquanto o lock estiver ativo, salvo trabalho sequencial explicitamente coordenado dentro da própria Issue dona.
3. Nenhuma Issue de produto que não seja dona do lock pode ser mergeada em `staging`. O gate 12 deve recusar esse merge mesmo sem conflito Git textual.
4. 00/01/02 podem continuar intake, auditoria, arquitetura e especificação read-only de outras Issues. Q pode executar CI/review read-only quando seguro, mas não pode liberar merge/deploy concorrente que altere `staging`.
5. O lock só é liberado quando a Issue dona atingir `STAGING_VERIFIED`; não liberar ao fim do writer, CI, review ou apenas no merge.
6. Ao adquirir o lock, registrar `lock_base_sha`. Antes do CI final e imediatamente antes do merge, comparar o HEAD atual de `staging` com a base esperada. Drift inesperado => `SHA_DRIFT`, sem merge, com refresh/rebase controlado e revalidação dos gates impactados.
7. Mudanças aparentemente distantes também ficam bloqueadas porque podem alterar contratos, tipos, APIs, cache, permissões ou serviços compartilhados sem conflito textual.
8. Exceção somente por ordem explícita do fundador com `founder_preempt: true`. Nesse caso, pausar formalmente a integração, registrar a intervenção, atualizar `staging`, renovar `lock_base_sha` e revalidar a integração antes de continuar.
9. Smoke humano não mantém o lock: após `STAGING_VERIFIED`, liberar o lock e permitir que a fábrica retome outras escritas enquanto a Issue segue para `SMOKE_READY`.

## Fila, prioridade e não-preempção
Campos canônicos de fila:
- `priority`: `P000 | P00 | P0 | P1 | P2 | P3`;
- `priority_rank`: `10 | 50 | 100 | 200 | 300 | 400`;
- `queue_mode`: `NEW | CONTINUATION | REWORK`;
- `flow_status`: `QUEUED | ACTIVE | WAITING_EXTERNAL | SMOKE_READY`;
- `founder_preempt`: `false | true`.

Ordem de seleção dentro de cada Projeto físico:
1. `founder_preempt=true`;
2. `REWORK`;
3. `CONTINUATION`;
4. `NEW`.

Dentro da mesma classe, vence o menor `priority_rank`; empate: `last_transition_at` mais antigo.

Regra não-preemptiva: uma Issue já iniciada deve ser terminada antes de começar Issue `NEW`, mesmo que a nova Issue tenha prioridade nominal maior. Somente ordem explícita do fundador pode definir `founder_preempt=true` e interromper a ordem normal. `SMOKE_READY` não entra na fila automática.

## Claims
Todo handoff executável usa ciclo `PENDING -> CLAIMED -> DONE | FAILED`.

Antes de claim, releia a Issue e valide `state`, `active_handoff`, `writer`, `write_lock`, branch/base SHA, preservações e `attempt`.

- Claim válido: não tocar.
- Claim expirado: registrar `STALE_CLAIM_RECOVERED` antes de recuperar.
- TTL padrão: 55 minutos.
- Ao claimar: preencher `claimed_by` e `claim_expires_at`.
- Ao concluir ou falhar: limpar claim antes de criar/liberar o próximo handoff.
- Nunca repetir handoff `DONE`.

Uma execução atrasada que encontre `active_handoff`, `current_agent` ou estado já alterado deve encerrar sem repetir trabalho.

## Rotas comuns
- UI/UX: `00 -> 01/02 quando necessário -> writer -> 10 -> 03 -> 11 -> 12 -> 13`.
- Regra local: `00 -> especialista 04/06/07/08 -> 10 -> 03 -> 11 -> 12 -> 13`.
- Banco/RLS: `00 -> 01 -> 09 ou 05 -> 10 -> 03 -> 11 -> 12 -> 13`.
- Transversal: `00 -> 01 -> 05 -> 10 -> 03 -> 11 -> 12 -> 13`.
- Falha de rollout: `13 -> 14 -> writer correto -> 10 -> 03 -> 11 -> 12 -> 13`.

A rota é referência, não fila cega. `current_agent` deve refletir o próximo responsável real.

## Estados
Fluxo típico:
`INTAKE -> DESIGN_AUDIT -> SPEC_APPROVED -> IMPLEMENTATION -> DB_GATE (se necessário) -> CI -> REVIEW -> PR -> MERGE -> ROLLOUT -> STAGING_VERIFIED -> SMOKE_READY`.

Falha:
`DIAGNOSE -> ROUTE -> FIX -> REVALIDATE -> continuar`.

Estados bloqueantes úteis: `SPEC_CONFLICT`, `TEST_FAILED`, `SECURITY_FAILED`, `REGRESSION_DETECTED`, `MIGRATION_UNSAFE`, `SHA_DRIFT`, `ENVIRONMENT_MISMATCH`, `ROLLOUT_FAILED`, `STOP_LOSS_REQUIRED`.

## Stop-loss
Use `STOP_LOSS_REQUIRED` apenas quando continuar inevitavelmente puder causar dano grave concreto e não mitigável: perda irreversível de dados, corrupção clínica/financeira, cross-tenant, ambiente não identificável ou ação destrutiva sem rollback viável. Antes, tente redesenhar para solução reversível/isolada.

## Polling e queue-drain
Cada Projeto físico pode ter uma tarefa recorrente. O polling é watchdog/retomada, não intervalo obrigatório. Ao acordar:
1. buscar Issues abertas da fábrica;
2. agir apenas nas Issues cujo `current_agent` pertença ao Projeto e cujo `handoff_status` seja `PENDING`;
3. ignorar `SMOKE_READY` e respeitar dependências/locks;
4. ordenar a fila pelas regras canônicas de prioridade e não-preempção;
5. validar `state`, `active_handoff` e claim antes de qualquer ação;
6. se nenhuma Issue for elegível, encerrar imediatamente;
7. ler histórico e contrato completos;
8. executar somente o papel ativo;
9. registrar resultado e atualizar `current_agent`, `state`, `active_handoff`, `attempt` quando aplicável e `next_gate`.

Mapeamento de polling:
- Projeto 00: somente 00.
- Projeto 01: somente 01.
- Projeto 02: somente 02.
- W: 04,05,06,07,08,09.
- Q: 03,10,11,12,13,14.

### Execução encadeada W/Q
W e Q podem continuar na mesma Issue enquanto o próximo `current_agent` permanecer na mesma lane, desde que:
1. o handoff anterior esteja `DONE` ou `FAILED` com evidências;
2. exista novo `active_handoff` formalmente criado;
3. `handoff_status` volte a `PENDING` e o claim anterior esteja limpo;
4. `state`, `last_transition_at`, `next_gate` e `attempt` tenham sido atualizados quando necessário;
5. a Issue e o OS sejam relidos;
6. o novo contrato de papel seja carregado;
7. um novo claim seja feito;
8. não exista dependência externa, necessidade de 00/01/02, conflito de writer/lock ou outro gate fora da lane.

Ao trocar de papel, o runtime continua sendo W ou Q, mas apenas um papel lógico pode estar ativo por handoff. Se o próximo agente sair da lane, deixar o handoff `PENDING` e encerrar essa Issue.

### Queue-drain entre Issues
Depois que uma Issue sair da lane, o mesmo Projeto pode selecionar a próxima Issue elegível e continuar na mesma execução, sempre sequencialmente. Nunca iniciar a próxima antes de fechar formalmente a atual. Não iniciar nova Issue sem margem razoável para concluir o gate. Smoke humano de uma Issue não bloqueia outras Issues independentes.

## Work Packages / Correction Blocks
Uma Issue pode representar um bloco de itens compatíveis para reduzir overhead sem virar escopo ilimitado.

Campos canônicos quando aplicável:
- `work_package: <DOMAIN>-<YYYYMMDD>-<SEQ> | NONE`;
- `scope_group: <domínio/superfície>`;
- `block_mode: BATCH | SINGLE`;
- `block_status: COLLECTING | READY | ACTIVE | REWORK | WAITING_EXTERNAL | SMOKE_READY`;
- `contract_version: <inteiro>`;
- `items`: checklist com IDs estáveis por item.

Regras:
1. `BATCH` agrupa somente itens tecnicamente compatíveis, de mesmo domínio/superfície, mesmo writer principal e prioridade aproximadamente compatível.
2. O risco/classificação do bloco é o maior risco entre seus itens; batching nunca pode esconder risco maior.
3. `COLLECTING` não é executável: permanece sob 00 e não libera handoff de implementação.
4. Ao congelar o bloco, incrementar `contract_version`, definir `block_status: READY` e liberar o primeiro handoff executável.
5. Depois de `ACTIVE`, novas ideias ordinárias vão para novo bloco. Alterar bloco ativo somente para correção/requisito indispensável ao escopo já contratado; nesse caso incrementar `contract_version` e revalidar gates afetados.
6. Prioridade/fila pertence à Issue/bloco inteiro; não misturar prioridades incompatíveis apenas para economizar handoff.
7. Auditoria, UX, writer, CI, review, PR, merge e rollout tratam o bloco como unidade e registram resultado por item.
8. Falha de um item coloca o bloco em `REWORK`; corrigir somente o item afetado e revalidar impactos necessários, preservando trabalho saudável.
9. Smoke humano pode ser checklist único do bloco. `SMOKE_READY` encerra a automação daquele bloco sem bloquear outros.
10. Locks, stop-loss, tenant isolation, banco/RLS, integridade e gates obrigatórios prevalecem sobre batching.
11. W/Q podem drenar papéis internos do mesmo bloco e, após entregá-lo, pegar o próximo bloco elegível da fila na mesma execução se houver margem segura.

## Gates
Writer: menor diff seguro, branch/base SHA corretos, testes targeted e evidências na Issue; se houver `GLOBAL_WRITE_LOCK = ACTIVE`, somente a Issue dona pode escrever produto.
09: valida schema/migration/RLS quando houver banco.
10: CI/regressão, separando dívida pré-existente de regressão nova; para lock ativo, revalida `lock_base_sha` contra `staging` antes do CI final e bloqueia em `SHA_DRIFT`.
03: compara diff real com contrato; não corrige código.
11: prepara PR fiel ao contrato.
12: merge em staging somente com review/CI/head/base válidos; lock ativo bloqueia merge de qualquer Issue de produto que não seja a dona.
13: verifica Railway staging, SHA, build/runtime/health e Supabase quando aplicável; `STAGING_VERIFIED` é o gate de liberação do lock.
14: contém/reverte rollout falho e devolve para revalidação.

## Conclusão
`SMOKE_READY` só após implementação aderente, testes/CI, review, merge correto e staging saudável. Ao chegar em `SMOKE_READY`, parar a cadeia automática e fornecer exatamente um passo de smoke humano.
