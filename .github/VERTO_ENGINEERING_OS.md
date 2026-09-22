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

Essa tabela é a autoridade única de identidade papel→lane. Runtime cloud, automações e prompts físicos divergentes devem ser reconciliados a ela antes de `FACTORY_RUNTIME_VERIFIED`; divergência de runtime não autoriza renumerar Issues ou contratos versionados.

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
10. Lock owner aparentemente órfão nunca é liberado por suposição, por claim expirado ou por falha de wake. O 00 deve revalidar Issue dona, estado, lease/claim, refs/SHAs e gate de liberação e então decidir recuperação ou manutenção do lock.

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

### Fairness / bounded starvation
`founder_preempt=true`, claims válidos, locks e dependências continuam soberanos. Fora desses casos, cada Projeto físico mantém um budget de ultrapassagem do `oldest-eligible` não-founder de classe/prioridade inferior. Depois de 4 conclusões consecutivas que selecionaram trabalho à frente desse `oldest-eligible`, a próxima seleção não-founder deve servi-lo. O budget zera quando o `oldest-eligible` é servido, deixa de ser executável ou surge `founder_preempt=true`. A regra não preempta handoff já `CLAIMED` e não torna Issue bloqueada elegível.

## Claims
Todo handoff executável usa ciclo `PENDING -> CLAIMED -> DONE | FAILED`.

Antes de claim, releia a Issue e valide `state`, `active_handoff`, `writer`, `write_lock`, branch/base SHA, preservações e `attempt`.

- `PENDING` não expira por idade, polling perdido, duração da fila ou troca de runtime. O que expira é o claim/lease.
- Claim válido: não tocar.
- Claim expirado: registrar `STALE_CLAIM_RECOVERED` antes de recuperar.
- TTL padrão: 55 minutos.
- Ao claimar: preencher `claimed_by` e `claim_expires_at`.
- Ao concluir ou falhar: limpar claim antes de criar/liberar o próximo handoff.
- Nunca repetir handoff `DONE`.

Uma execução atrasada que encontre `active_handoff`, `current_agent` ou estado já alterado deve encerrar sem repetir trabalho.

## Continuidade imediata / dispatch advisory
A Issue continua sendo a única autoridade operacional. Dispatch/wake é aceleração best-effort, nunca segunda fonte de verdade e nunca requisito para a validade do handoff.

Sequência vinculante ao rotear trabalho:
1. persistir primeiro na Issue o próximo `active_handoff`, `current_agent`, `handoff_status: PENDING`, claim limpo e demais campos de transição;
2. reler/revalidar o estado persistido;
3. somente então emitir wake advisory para o Projeto/lane alvo quando houver mecanismo disponível;
4. o alvo acordado relê a fila completa, aplica prioridade/fairness/locks/dependências e tenta claim; payload de wake não concede autoridade;
5. polling permanece ativo como watchdog/retomada para wake perdido, duplicado ou indisponível.

Wake duplicado é seguro por desenho. `dispatch_key`, receipt e status podem existir para deduplicação/telemetria, mas não autorizam execução, não substituem reread+claim e não precisam ser exactly-once.

Antes de concluir um handoff, registrar resultado ou criar o próximo, o executor deve fazer CAS lógico: reler e confirmar que `active_handoff`, `current_agent` e o claim vigente ainda são exatamente os esperados. Drift torna o executor stale; ele encerra sem side effect operacional concorrente.

Gates longos devem persistir checkpoints incrementais ao fim de cada unidade segura e antes de operações demoradas quando possível. Kill abrupto não é tratado como falha funcional: claim expirado + Issue + refs/SHAs/artefatos persistidos permitem recuperação idempotente pelo watchdog. Não existe garantia de que um runtime morto consiga escrever um último checkpoint.

Se o runtime estiver chegando ao limite e o gate lógico ainda não terminou, isso não é `FAILED`: persistir checkpoint e criar continuação PENDING para o mesmo papel quando ainda houver oportunidade de escrita segura. Nunca deixar claim órfão voluntariamente.

## Capability discovery / blocker invalidation
Antes de declarar blocker por ferramenta ou capability ausente, a execução deve descobrir as capabilities realmente disponíveis no runtime atual. Evidência de runtime anterior não prova ausência atual, e nome de primitive exposta não prova usabilidade funcional.

Ordem obrigatória:
1. identificar a capability mínima necessária para a operação concreta e o safety envelope exigido;
2. consultar primitives atuais e equivalentes funcionais no mesmo repo/ref/ambiente/credencial relevante;
3. preferir probe seguro/read-only suficiente para provar disponibilidade funcional;
4. considerar a capability disponível somente quando todos os elos materiais necessários funcionarem — conteúdo exato, transformação exata, candidate revisável, diff verificável e movimento guarded da ref quando a operação exigir escrita — ou quando uma alternativa autorizada completa preservar o mesmo safety envelope;
5. se uma alternativa segura completa resolver, usá-la e encerrar a análise de blocker; somente depois avaliar alternativas adicionais.

`CAPABILITY_BLOCKER_INVALIDATED` aplica-se somente à causa artificial comprovadamente superada. A invalidation não apaga diagnóstico/histórico, não converte gate em PASS e não remove outra causa independente. Antes de retomar ou redispatchar, revalidar `active_handoff`, `current_agent`, claim, expected/base SHA, locks, dependências e freshness; candidate ou transformação derivada de head antigo não pode ser reutilizada sem compare/freshness apropriado.

Capability exposta mas sem permissão, incompatível com repo/ref/host, truncada de modo impeditivo ou falhando no probe seguro permanece indisponível para aquela operação. A validade da descoberta é contextual ao runtime, escopo, credencial e ambiente observados; nova execução revalida blockers baseados em ausência de capability e não presume disponibilidade futura.

Probes de escrita não podem produzir side effect canônico. Quando forem estritamente necessários, devem ser não-canônicos/reversíveis: não mover branch/ref canônica, não criar PR/merge/deploy, não alterar Issue de produto e não consumir idempotency key de negócio. Candidate Git órfão sem ref é aceitável somente quando necessário e registrado; produção é proibida.

`WRITE_TRANSPORT_BLOCKED` continua legítimo quando faltar qualquer elo material para conteúdo exato, transformação exata, candidate revisável, diff verificável ou movimento guarded da ref e nenhum transporte/fallback autorizado satisfizer o mesmo safety envelope. Ausência isolada de patch local, notebook ou Remote Desktop nunca basta.

Metadata mínima de blocker de capability: `capability_checked_at`, capability mínima necessária, primitives/probes e resultados funcionais, repo/ref/ambiente relevante, `capability_blocker_status: VALID | INVALIDATED` e, quando VALID, `unblock_owner` + `unblock_action`.

A regra das 10 alternativas começa somente após capability discovery atual. Alternativas duplicadas, inseguras, inaplicáveis ou já refutadas não contam; a primeira alternativa autorizada que resolver com segurança encerra a análise.

O 00, como watchdog, deve revalidar blockers de capability contra o runtime atual. Se a causa antiga contradizer capabilities atuais, pode marcar `CAPABILITY_BLOCKER_INVALIDATED`, corrigir somente continuidade/orquestração e redispatchar ao papel correto; 00 não assume o trabalho substantivo do writer/especialista.

## Blockers internos, ciclos e eventual completion
Blocker interno/engenharia deve ser resolvido ou roteado pela fábrica; não vira espera humana só por limitação de uma ferramenta. Antes de declarar incapacidade interna, avaliar e registrar pelo menos 10 alternativas realmente viáveis e distintas quando esse requisito for aplicável ao blocker; alternativas inseguras, duplicadas ou tecnicamente inaplicáveis não contam e não precisam ser executadas.

Dependências `blocked_on` devem ser verificadas contra ciclos. Ciclo de blockers retorna ao 00 para definir owner único de desbloqueio e ordem de resolução; não criar espera circular. Lock owner órfão também retorna ao 00 para revalidação objetiva, nunca para liberação presumida.

`WAITING_EXTERNAL` só cabe quando a dependência realmente exige ação humana, credencial ou decisão externa que nenhum agente possa executar. `STOP_LOSS_REQUIRED` mantém a definição estrita abaixo.

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
4. ordenar a fila pelas regras canônicas de prioridade, não-preempção e fairness;
5. validar `state`, `active_handoff` e claim antes de qualquer ação;
6. se nenhuma Issue for elegível, encerrar imediatamente;
7. ler histórico e contrato completos;
8. executar somente o papel ativo;
9. registrar resultado e atualizar `current_agent`, `state`, `active_handoff`, `attempt` quando aplicável e `next_gate`;
10. depois de persistir o próximo handoff, usar dispatch advisory quando disponível e continuar queue-drain sem esperar o próximo polling.

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

Ao trocar de papel, o runtime continua sendo W ou Q, mas apenas um papel lógico pode estar ativo por handoff. Se o próximo agente sair da lane, deixar o handoff `PENDING`, emitir wake advisory quando disponível e então drenar outra Issue elegível; não aguardar polling como requisito de continuidade.

### Queue-drain entre Issues
Depois que uma Issue sair da lane, o mesmo Projeto deve selecionar a próxima Issue elegível e continuar na mesma execução, sempre sequencialmente, enquanto houver capacidade de execução segura. Nunca iniciar a próxima antes de fechar formalmente a atual. Se o runtime não comportar concluir o próximo gate, preserve a Issue PENDING; tarefas não expiram e o watchdog retoma. Smoke humano de uma Issue não bloqueia outras Issues independentes.

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