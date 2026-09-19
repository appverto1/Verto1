# Verto Factory Protocol

`factory_protocol_version: 1`

Este arquivo é o protocolo transversal vinculante da fábrica Verto. Toda Issue que declarar `factory_protocol_version: 1` deve aplicar esta versão antes de qualquer escrita, ressalvada apenas a exceção de bootstrap registrada na Issue #180.

## SAFE_WRITE / TRANSACTIONAL GIT

### SAFE_WRITE

Capacidade de escrever não implica capacidade de escrever com segurança.

Toda alteração deve preservar código e comportamento fora do escopo contratado.

### CLOUD-FIRST TRANSPORT

A fábrica não deve depender de workstation, notebook ou Remote Desktop do fundador para escritas normais no repositório.

Ordem obrigatória de transporte:
1. **GitHub Transactional Object Transport — padrão**:
   - fixe `expected_head` a partir da ref exata contratada;
   - obtenha conteúdo/blob exato da mesma revisão, por `fetch_file`, `fetch_blob`, Git data ou leitura segmentada verificável;
   - crie blob(s) de replacement sem mover nenhuma ref;
   - crie candidate tree baseada na tree exata de `expected_head`;
   - crie candidate commit com `parent = expected_head`;
   - compare `expected_head -> candidate_sha`;
   - valide arquivos alterados, hunks, escopo e preservações;
   - mova a feature branch somente após `diff_validation: PASS`, por fast-forward/expected-head guard e `force=false`;
   - reobtenha branch e diff após o movimento e confirme o mesmo candidate.
2. **GitHub Contents API** — permitido somente quando o arquivo alvo for pequeno/integralmente legível e o replacement completo puder ser validado exatamente contra a mesma revisão antes e depois da escrita.
3. **Workspace Git / patch-hunk local / Remote Desktop** — fallback opcional, nunca requisito estrutural da fábrica.
4. **WRITE_TRANSPORT_BLOCKED** — somente quando nenhum transporte cloud autorizado acima nem fallback seguro conseguir produzir candidate exato e revisável.

`Remote Desktop offline`, `No devices available` ou notebook do fundador desligado **não constituem blocker suficiente**. Fetch de conveniência truncado também não constitui blocker suficiente se primitives de ref/blob/object ou leitura segmentada puderem recuperar/materializar a revisão exata com segurança.

Antes de declarar `WRITE_TRANSPORT_BLOCKED`, a execução deve registrar quais primitives cloud foram tentadas ou comprovadamente indisponíveis e por que não é possível obter conteúdo exato, construir candidate isolado e validar o diff. Nunca exigir que o fundador mantenha uma máquina local ligada para a fábrica continuar.

Ordem preferencial de construção do candidate:
1. GitHub transacional por objetos (`blob -> tree -> commit`) seguindo a hierarquia cloud-first acima;
2. GitHub Contents API quando o replacement integral for pequeno e exatamente verificável;
3. patch/hunk em workspace Git ou Remote Desktop como fallback;
4. outro mecanismo autorizado que produza candidate commit e permita validar seu diff antes de mover a branch.

Regras obrigatórias:
- fixe `expected_head` antes de iniciar;
- mantenha a branch contratada imóvel até a validação;
- construa `candidate_sha` sem mover a branch sempre que o transporte suportar candidate isolado;
- compare `expected_head -> candidate_sha`;
- valide arquivos e hunks alterados contra o escopo da Issue;
- só após `diff_validation: PASS` mova a branch;
- alteração fora do escopo => descarte o candidate e preserve o head original;
- whole-file replacement só é aceitável se o conteúdo completo vier da mesma revisão esperada e o candidate diff for validado antes de mover a branch.

É proibido:
- whole-file replace cego de arquivo compartilhado;
- force push para contornar limitação de runtime;
- reconstrução aproximada de arquivo grande;
- mover branch antes da validação do diff quando candidate isolado estiver disponível;
- aceitar mudança colateral apenas porque testes passaram;
- repetir executor que já falhou por capability sem evidência de que a capability mudou;
- classificar a indisponibilidade do computador do fundador como dependência humana para trabalho normal de GitHub.

Se o runtime não conseguir escrever com segurança após esgotar a hierarquia cloud-first, retornar `WRITE_TRANSPORT_BLOCKED` registrando:
- capability/primitives cloud ausentes ou insuficientes;
- arquivo/superfície afetada;
- `expected_head` preservado;
- `candidate_sha`, se houver;
- se a branch foi movida;
- transporte alternativo recomendado.

Limitação de transporte não é falha funcional e não deve reabrir arquitetura/UX sem evidência funcional nova.

## CONTINUIDADE, CLAIMS E WATCHDOG

Estas regras são aditivas e compatíveis com `factory_protocol_version: 1`; não exigem mass-edit de Issues abertas nem tornam inválido um handoff PENDING pela sua idade.

- **NO TASK EXPIRY:** handoff `PENDING` não expira. Claim/lease pode expirar; a tarefa permanece válida e volta a ser reavaliada quando claim, lock, `not_before`, dependência ou outra condição de execução mudar.
- **Seleção e fairness:** `founder_preempt=true` permanece absoluto e trabalho com claim válido permanece não-preemptivo. Entre tarefas não-founder, preserve `REWORK -> CONTINUATION -> NEW`, menor `priority_rank` e desempate por `last_transition_at`; porém, após 4 conclusões consecutivas que ultrapassem o `oldest-eligible` executável de classe/prioridade inferior, a próxima seleção não-founder deve servir esse `oldest-eligible`. O budget zera quando ele for servido, deixar de ser executável ou surgir `founder_preempt`.
- **Persist-first dispatch:** conclua o handoff atual e persista exatamente um próximo handoff `PENDING` antes de qualquer wake. Revalide o estado persistido; só então envie wake advisory. A lane alvo deve reler a fila completa e fazer claim normalmente. Wake, receipt e `dispatch_status` são telemetria, nunca autoridade nem prova de conclusão.
- **Dispatch idempotente:** quando persistido para observabilidade, `dispatch_key` deve identificar de forma estável `repo + issue + active_handoff`. Duplicidade de wake é tolerada; exclusividade vem de reread + claim, não de entrega exactly-once.
- **CAS lógico:** imediatamente antes de concluir, falhar ou rotear um handoff, revalide `active_handoff`, `current_agent` e o claim esperado. Executor stale encerra sem produzir side effect ou sobrescrever metadata canônica.
- **Checkpoint/recovery:** persista checkpoints incrementais após unidades seguras de trabalho e antes de operações longas quando aplicável. Kill abrupto é recuperado por claim expirado + Issue + refs/SHAs/artefatos já persistidos; não presuma que um runtime morto conseguiu escrever um checkpoint final.
- **Conflito de papel:** se um handoff `PENDING` ou `SCHEDULED` contiver texto livre que atribua responsabilidade incompatível com o `current_agent` canônico, não execute o papel contraditório. Registre a divergência e roteie ao 00 para reconciliação.

### ZERO-WAIT DISPATCH CANÔNICO

A GitHub Issue também é a autoridade da entrega do handoff. Todo novo handoff `PENDING` deve registrar, quando aplicável: `dispatch_required`, `dispatch_target_agent`, `dispatch_target_lane`, `dispatch_target_automation_id`, `dispatch_attempted_at` e `dispatch_result` (`PENDING | REQUESTED | DEGRADED`). Esses campos são somente telemetria/continuidade; nunca substituem `current_agent`, `active_handoff`, claim, locks, dependências ou gates.

Mapa físico canônico de dispatch: 00 → lane 00 → `6aa82e50adf88191a4e09ffc91e0169b`; 01 → lane 01 → `6aa82ec555ac8191b28f66ae50edf69c`; 02 → lane 02 → `6aae582d30fc81919d5c4ee28f934bfb`; 03 e 10–14 → lane Q → `6aa8333456c081918e084379ff9d2378`; 04–09 → lane W → `6aae5b6a1530819195fac2824ab0c602`.

`PENDING` significa pronto para claim, não espera por polling. Depois de persistir e revalidar um próximo handoff executável, o executor anterior deve tentar imediatamente o wake autorizado da lane alvo. `REQUESTED` significa apenas wake solicitado; não significa entrega, claim, início, PASS ou conclusão. Não há promessa de exactly-once.

Se o próximo papel estiver na mesma lane física, continuidade imediata não reserva a Issue anterior: antes do novo claim a lane deve reler a fila completa e reaplicar `founder_preempt`, não-preempção, prioridade e fairness. Um trabalho recém-elegível pode vencer conforme as regras canônicas.

A telemetria pós-dispatch é CAS-guarded pela identidade do mesmo `active_handoff` e pelo `current_agent` esperado. Se o alvo já claimou, avançou o handoff ou alterou estado de modo incompatível, o executor anterior não deve fazer whole-body write stale, rebaixar claim nem sobrescrever metadata canônica. Perder telemetria é aceitável; autoridade nunca é revertida. `REQUESTED`/`DEGRADED` só podem avançar monotonicamente para o mesmo handoff ainda vigente.

`HANDOFF_NOT_DISPATCHED` é a inconsistência objetiva em que um handoff executável permanece com dispatch obrigatório e `dispatch_result=PENDING` depois de o executor anterior ter concluído. Qualquer lane/watchdog que a detectar deve tentar o dispatch imediatamente, sem assumir o papel alvo. Para handoffs legados sem metadata de dispatch, trate `PENDING` executável como `dispatch_required=true` implicitamente e derive lane/automation somente do `current_agent` canônico vigente após reread, nunca de texto livre histórico.

Falha da primeira tentativa de dispatch deve marcar `DEGRADED` somente se o mesmo handoff continuar vigente, tentar outro wake autorizado quando disponível e acionar 00 quando possível. O handoff continua `PENDING` e válido; não vira `WAITING_EXTERNAL` sem dependência humana real. Morte após persist e antes do wake resulta em `HANDOFF_NOT_DISPATCHED`; morte após wake e antes da telemetria pode causar wake duplicado no recovery, o que é seguro por reread + claim. Polling permanece watchdog/recovery para wake perdido, duplicado ou silenciosamente descartado.

`FACTORY_RUNTIME_DRIFT` é divergência material entre este contrato versionado e o mapeamento/prompts físicos 00/01/02/W/Q. Deve retornar ao 00 para reconciliação; não autoriza renumerar Issues, pular gates ou usar runtime divergente como segunda autoridade.

## BLOCKERS PERSISTENTES E LOCK ÓRFÃO

Blocker interno gera trabalho de desbloqueio, não espera passiva. Quando um blocker persistente for necessário, registre no mínimo:
- `blocked_on`: dependência/condição objetiva;
- `unblock_owner`: único papel/Issue responsável por produzir a liberação;
- `unblock_action`: ação verificável que satisfaz a condição;
- `last_unblock_attempt_at`: timestamp da última tentativa real de desbloqueio.

Antes de declarar incapacidade interna sem solução, avalie alternativas distintas, autorizadas e tecnicamente viáveis; quando o contrato exigir 10+, alternativas inaplicáveis, inseguras ou meramente duplicadas não contam. Assim que uma alternativa resolver com segurança, use-a sem completar checklist artificial.

Ciclos em `blocked_on` devem retornar ao 00 para definir um único owner e quebrar o ciclo; nenhuma lane deve manter duas Issues esperando uma pela outra indefinidamente.

Use `ORPHAN_LOCK_SUSPECTED` quando um lock persistido aparentar não ter owner operacional válido, por exemplo: owner Issue inexistente/fechada/terminal incompatível, owner/handoff canônico ausente ou metadata do lock incompatível com o estado persistido. Esse estado é suspeita, não autorização de liberação. Somente o 00 revalida owner, escopo, base SHA e release gate e decide recuperar/reatribuir/liberar o lock. Falha de wake, claim expirado ou silêncio do runtime isoladamente nunca liberam lock.

Pollings existentes permanecem ativos como watchdog/retomada. Polling perdido ou wake indisponível não invalida a tarefa; a próxima reavaliação retoma a fila a partir da Issue como fonte de verdade.
