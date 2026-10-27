Verto Factory Protocol
factory_protocol_version: 1
revisão Verto 2026-09-20: harmonizado com docs/factory/GUARDRAILS.md (wake/dispatch desabilitado; limite de 3 alternativas de desbloqueio; estado único em `state`). O resto do texto é o original.

Este arquivo é o protocolo transversal vinculante da fábrica Verto. Toda Issue que declarar factory_protocol_version: 1 deve aplicar esta versão antes de qualquer escrita, ressalvada apenas a exceção de bootstrap registrada na Issue #180.

PRECEDÊNCIA
Em caso de conflito, vale docs/factory/GUARDRAILS.md. Nesta configuração da Verto: não existe wake/dispatch (a retomada é por polling das lanes agendadas); o limite de alternativas de desbloqueio é 3; o estado da demanda é o campo `state`.

ESTADO DA ISSUE
Cada Issue factory tem um bloco de estado na Issue (a Issue é a fonte de verdade; labels só espelham). Se a Issue já tiver o bloco em outro formato, preserve o formato e garanta os campos abaixo; se não tiver, crie um bloco `FACTORY_STATE` em linhas chave: valor.
- Estado canônico da demanda: state, current_agent, writer (04–09), red (sim/não), ux_required (sim/não), contract_version, base_sha, head_sha, branch, attempt.
- Controle operacional: active_handoff, handoff_status (PENDING, CLAIMED, DONE, FAILED, SCHEDULED, NEEDS_FOUNDER), claimed_by, claim_expires_at, next_gate, priority_rank, founder_preempt, last_transition_at, not_before, dependências, locks (por exemplo GLOBAL_WRITE_LOCK), freshness/release_condition.
- Não usados: flow_status e block_status.
`state` é o estado geral da demanda. Valores de parada: COLLECTING, SMOKE_READY, NEEDS_FOUNDER, STOP_LOSS_REQUIRED, WAITING_EXTERNAL e DONE. Enquanto a demanda anda, `state` descreve o estágio e o gate exato é current_agent + next_gate. Ao marcar NEEDS_FOUNDER, registre-o também em handoff_status.
base_sha é o commit de onde o Writer começou; head_sha é o resultado final que CI, revisão e auditoria aprovam. active_handoff + current_agent + claim formam o CAS lógico usado antes de qualquer transição.

SAFE_WRITE / TRANSACTIONAL GIT
SAFE_WRITE
Capacidade de escrever não implica capacidade de escrever com segurança.

Toda alteração deve preservar código e comportamento fora do escopo contratado.

CLOUD-FIRST TRANSPORT
A fábrica não deve depender de workstation, notebook ou Remote Desktop do fundador para escritas normais no repositório.

Ordem obrigatória de transporte:

GitHub Transactional Object Transport — padrão:
fixe expected_head a partir da ref exata contratada;
obtenha conteúdo/blob exato da mesma revisão, por fetch_file, fetch_blob, Git data ou leitura segmentada verificável;
crie blob(s) de replacement sem mover nenhuma ref;
crie candidate tree baseada na tree exata de expected_head;
crie candidate commit com parent = expected_head;
compare expected_head -> candidate_sha;
valide arquivos alterados, hunks, escopo e preservações;
mova a feature branch somente após diff_validation: PASS, por fast-forward/expected-head guard e force=false;
reobtenha branch e diff após o movimento e confirme o mesmo candidate.
GitHub Contents API — permitido somente quando o arquivo alvo for pequeno/integralmente legível e o replacement completo puder ser validado exatamente contra a mesma revisão antes e depois da escrita.
Workspace Git / patch-hunk local / Remote Desktop — fallback opcional, nunca requisito estrutural da fábrica.
WRITE_TRANSPORT_BLOCKED — somente quando nenhum transporte cloud autorizado acima nem fallback seguro conseguir produzir candidate exato e revisável.
Remote Desktop offline, No devices available ou notebook do fundador desligado não constituem blocker suficiente. Fetch de conveniência truncado também não constitui blocker suficiente se primitives de ref/blob/object ou leitura segmentada puderem recuperar/materializar a revisão exata com segurança.

Antes de declarar WRITE_TRANSPORT_BLOCKED, a execução deve registrar quais primitives cloud foram tentadas ou comprovadamente indisponíveis e por que não é possível obter conteúdo exato, construir candidate isolado e validar o diff. Nunca exigir que o fundador mantenha uma máquina local ligada para a fábrica continuar.

Ordem preferencial de construção do candidate:

GitHub transacional por objetos (blob -> tree -> commit) seguindo a hierarquia cloud-first acima;
GitHub Contents API quando o replacement integral for pequeno e exatamente verificável;
patch/hunk em workspace Git ou Remote Desktop como fallback;
outro mecanismo autorizado que produza candidate commit e permita validar seu diff antes de mover a branch.
Regras obrigatórias:

fixe expected_head antes de iniciar;
mantenha a branch contratada imóvel até a validação;
construa candidate_sha sem mover a branch sempre que o transporte suportar candidate isolado;
compare expected_head -> candidate_sha;
valide arquivos e hunks alterados contra o escopo da Issue;
só após diff_validation: PASS mova a branch;
alteração fora do escopo => descarte o candidate e preserve o head original;
whole-file replacement só é aceitável se o conteúdo completo vier da mesma revisão esperada e o candidate diff for validado antes de mover a branch.
É proibido:

whole-file replace cego de arquivo compartilhado;
force push para contornar limitação de runtime;
reconstrução aproximada de arquivo grande;
mover branch antes da validação do diff quando candidate isolado estiver disponível;
aceitar mudança colateral apenas porque testes passaram;
repetir executor que já falhou por capability sem evidência de que a capability mudou;
classificar a indisponibilidade do computador do fundador como dependência humana para trabalho normal de GitHub.
Se o runtime não conseguir escrever com segurança após esgotar a hierarquia cloud-first, retornar WRITE_TRANSPORT_BLOCKED registrando:

capability/primitives cloud ausentes ou insuficientes;
arquivo/superfície afetada;
expected_head preservado;
candidate_sha, se houver;
se a branch foi movida;
transporte alternativo recomendado.
Limitação de transporte não é falha funcional e não deve reabrir arquitetura/UX sem evidência funcional nova.

CAPABILITY DISCOVERY / BLOCKER INVALIDATION
Antes de declarar blocker por ferramenta, transporte ou capability ausente, a execução deve descobrir e provar as capabilities funcionais do runtime atual. Evidência de runtime anterior não prova ausência atual.

Ordem obrigatória:

identificar a capability mínima necessária para a operação concreta;
descobrir primitives e equivalentes funcionais disponíveis no runtime atual;
preferir probes read-only e verificar usabilidade real no repositório/ref/ambiente aplicável, não apenas a presença nominal da ferramenta;
considerar a cadeia completa necessária ao safety envelope — conteúdo exato, transformação exata, candidate isolado/revisável, diff verificável e movimento guarded da ref quando houver escrita;
se uma alternativa autorizada completa satisfizer a cadeia, usar essa alternativa e encerrar a análise de blocker;
somente depois avaliar alternativas adicionais (até 3, conforme BLOCKERS PERSISTENTES).
CAPABILITY_BLOCKER_INVALIDATED só pode ser registrado quando todas as etapas materiais necessárias ao trabalho estão funcionalmente disponíveis, ou quando existe alternativa autorizada completa que produz o mesmo safety envelope. Capability exposta mas sem permissão, incompatível com repo/ref/host, truncada de forma impeditiva ou falhando em probe seguro não invalida blocker.

Ao invalidar blocker, revalidar antes de retomar ou reencaminhar: active_handoff, current_agent, claim, expected/base SHA, locks, dependências e freshness. Nunca reutilizar candidate ou transformação derivada de head stale sem compare/freshness apropriado. A invalidação é monotônica somente sobre a causa artificial: preserva diagnóstico/histórico, não converte gate em PASS e não apaga outra causa independente.

Probes de discovery não podem produzir side effect canônico. Preferir listagem/schema/read-only. Quando um probe de escrita for indispensável, deve ser não-canônico e reversível: não mover branch/ref canônica, não criar PR/merge/deploy, não alterar Issue de produto nem consumir idempotency key de negócio. Candidate Git órfão sem ref é aceitável somente quando necessário e registrado; produção é proibida.

A validade da evidência é contextual ao runtime, credencial, repositório/ref e ambiente verificados. Registrar no mínimo, quando um blocker de capability estiver em avaliação: capability_checked_at, capability_needed, capability_discovery_evidence, capability_blocker_status: VALID | INVALIDATED; quando VALID, também unblock_owner e unblock_action. Nova execução deve revalidar ausência quando o blocker depender de capability; não existe TTL fictício nem garantia de disponibilidade futura.

WRITE_TRANSPORT_BLOCKED continua legítimo quando faltar qualquer elo material para conteúdo exato, transformação exata, candidate revisável, diff verificável ou movimento guarded da ref, e Contents API/fallbacks autorizados não satisfizerem o mesmo safety envelope. Ausência apenas de patch local, workstation ou Remote Desktop não basta. Se a cadeia equivalente fetch_file/fetch_blob -> create_blob -> create_tree -> create_commit -> compare_commits -> update_ref(force=false) estiver funcionalmente disponível para a operação concreta, ausência de patch local não autoriza WRITE_TRANSPORT_BLOCKED.

O limite de 3 alternativas só começa depois deste discovery. Alternativas duplicadas, inseguras, inaplicáveis ou já refutadas pela capability atual não contam; assim que uma alternativa segura resolver, a análise termina.

O watchdog 00 deve revalidar blockers de capability contra o runtime atual. Se a causa histórica contradizer capabilities funcionais atuais, marca CAPABILITY_BLOCKER_INVALIDATED, corrige somente continuidade/orquestração necessária e reencaminha ao papel correto com um novo handoff PENDING; 00 não assume o trabalho substantivo do writer/especialista.

CONTINUIDADE, CLAIMS E WATCHDOG
Estas regras são aditivas e compatíveis com factory_protocol_version: 1; não exigem mass-edit de Issues abertas nem tornam inválido um handoff PENDING pela sua idade.

NO TASK EXPIRY: handoff PENDING não expira. Claim/lease pode expirar; a tarefa permanece válida e volta a ser reavaliada quando claim, lock, not_before, dependência ou outra condição de execução mudar.
Seleção e fairness: founder_preempt=true permanece absoluto e trabalho com claim válido permanece não-preemptivo. Entre tarefas não-founder, preserve REWORK -> CONTINUATION -> NEW, menor priority_rank e desempate por last_transition_at; porém, após 4 conclusões consecutivas que ultrapassem o oldest-eligible executável de classe/prioridade inferior, a próxima seleção não-founder deve servir esse oldest-eligible. O budget zera quando ele for servido, deixar de ser executável ou surgir founder_preempt.
Persist-first handoff (sem wake): conclua o handoff atual e persista exatamente um próximo handoff PENDING; releia a Issue para confirmar o estado persistido. Nenhuma lane acorda outra; wake e dispatch estão desabilitados nesta configuração. A lane alvo encontra o handoff na próxima execução agendada, relê a fila completa e faz claim normalmente. Exclusividade vem de reread + claim, não de notificação.
CAS lógico: imediatamente antes de concluir, falhar ou rotear um handoff, revalide active_handoff, current_agent e o claim esperado. Executor stale encerra sem produzir side effect ou sobrescrever metadata canônica.
Checkpoint/recovery: persista checkpoints incrementais após unidades seguras de trabalho e antes de operações longas quando aplicável. Kill abrupto é recuperado por claim expirado + Issue + refs/SHAs/artefatos já persistidos; não presuma que um runtime morto conseguiu escrever um checkpoint final.
Conflito de papel: se um handoff PENDING ou SCHEDULED contiver texto livre que atribua responsabilidade incompatível com o current_agent canônico, não execute o papel contraditório. Registre a divergência e roteie ao 00 para reconciliação.
BLOCKERS PERSISTENTES E LOCK ÓRFÃO
Blocker interno gera trabalho de desbloqueio, não espera passiva. Quando um blocker persistente for necessário, registre no mínimo:

blocked_on: dependência/condição objetiva;
unblock_owner: único papel/Issue responsável por produzir a liberação;
unblock_action: ação verificável que satisfaz a condição;
last_unblock_attempt_at: timestamp da última tentativa real de desbloqueio.
Antes de declarar incapacidade interna sem solução, avalie até 3 alternativas distintas, autorizadas e tecnicamente viáveis; alternativas inaplicáveis, inseguras ou meramente duplicadas não contam, e nenhum contrato eleva esse limite. Assim que uma alternativa resolver com segurança, use-a sem completar checklist artificial.

Ciclos em blocked_on devem retornar ao 00 para definir um único owner e quebrar o ciclo; nenhuma lane deve manter duas Issues esperando uma pela outra indefinidamente.

Use ORPHAN_LOCK_SUSPECTED quando um lock persistido aparentar não ter owner operacional válido, por exemplo: owner Issue inexistente/fechada/terminal incompatível, owner/handoff canônico ausente ou metadata do lock incompatível com o estado persistido. Esse estado é suspeita, não autorização de liberação. Somente o 00 revalida owner, escopo, base SHA e release gate e decide recuperar/reatribuir/liberar o lock. Claim expirado ou silêncio do runtime isoladamente nunca liberam lock.

As execuções agendadas (polling) são o mecanismo de retomada e o watchdog. Uma execução perdida não invalida a tarefa; a próxima reavaliação retoma a fila a partir da Issue como fonte de verdade.


CANDIDATE WRITER VALIDATION / CAPABILITY ESCALATION
Quando um writer 04–09 comprovar ausência de checkout/shell capaz de executar seu gate, deve registrar na Issue: capability_needed, required_head_sha, required_evidence, return_agent, capability_blocker_status, unblock_owner e unblock_action. É proibido reenviar ao mesmo runtime incapaz sem mudança factual.

O executor de writer validation é o workflow read-only `.github/workflows/candidate-writer-validation.yml` somente quando houver franquia gratuita; se indisponível, use executor alternativo autorizado com Node 20, checkout SHA exato, logs auditáveis e testes pertinentes, nos termos dos Guardrails §11. Ele valida branches `factory/**` no candidate SHA exato, usa baseline `staging` (ou SHA explícito verificável), Node 20 + `npm ci`, typecheck ratchet, build e pre-main ratchet. Testes focais só podem ser suites enumeradas no próprio workflow; texto de Issue/comentário/input nunca vira shell arbitrário.

A evidência desse executor é somente `WRITER_VALIDATION_PASS|FAIL`. Ela não é `CI_PASS`, `PR_READY`, review, merge, deploy ou `STAGING_VERIFIED`. O writer continua dono do gate e de qualquer correção. Falha retorna ao writer. Se o runner cloud estiver indisponível ou incapaz, o 00 atua como broker de capability e roteia executor autorizado, preservando autoria e gates. O papel 10 continua reservado ao CI/regressão posterior.

GLOBAL_WRITE_LOCK de Issue bloqueada por capability recebe prioridade de liveness, mas nunca é liberado por inferência. O gate de validação independente posterior permanece obrigatório: `Verto Staging CI / staging-gate` OU `CI_ALTERNATIVE_PASS` com prova auditável na Issue #511/Guardrails §11, nunca aprovação fictícia. Este mecanismo não autoriza produção, secrets, deploy, `pull_request_target`, escrita pelo workflow, mudança de scheduler/RRULE/enablement/prompt ou criação prematura de PR apenas para obter runner.


PREFLIGHT CANÔNICO OBRIGATÓRIO
Antes do primeiro side effect e imediatamente antes do CAS/transição final, todo papel 00–14 deve cumprir integralmente `docs/factory/GUARDRAILS.md §22`. Somente `CONSISTENT` autoriza continuidade; `DRIFT | AMBIGUOUS | STALE_CLAIM_SUSPECTED | ORPHAN_LOCK_SUSPECTED` falham fechado via structured routing. Registre evidência de cada preflight; check manual parcial não substitui o verifier e nenhum engine/runner paralelo é autorizado.
