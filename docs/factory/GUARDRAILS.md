GUARDRAILS DA FÁBRICA VERTO

Prevalece sobre FACTORY_PROTOCOL.md, VERTO_ENGINEERING_OS.md, .github/agents/*.md e os prompts das lanes em caso de conflito. O formato dos campos de estado continua definido no FACTORY_PROTOCOL.md. Este arquivo só muda por Issue explícita do fundador.

CI_REAL_ATIVO: NÃO (mude para SIM somente quando existir workflow de testes no GitHub Actions, verde em um PR real e obrigatório para merge)

1. Ambiente
Autonomia só em staging. Antes de escrever em GitHub, Supabase ou Railway, confirme que o alvo é staging (branch, projeto Supabase, serviço Railway). Se não for inequivocamente staging: pare e marque STOP_LOSS_REQUIRED.
Produção só com autorização explícita do fundador, escrita na própria Issue.
Staging usa apenas dados sintéticos. Se suspeitar de dado real de paciente em staging: pare e marque NEEDS_FOUNDER.
2. Fonte de verdade e elegibilidade
A Issue GitHub manda em estado, writer, locks, base, handoff e próximo gate. Memória, conversa ou agente anterior nunca substituem a Issue.
Elegível = EXECUTÁVEL AGORA. Handoff PENDING nunca expira por idade. Claim, lock, not_before ou dependência atrasam a execução, não invalidam a tarefa; reavalie a cada execução.
Ordem de seleção: founder_preempt → REWORK → CONTINUATION → NEW → menor priority_rank → last_transition_at mais antigo. Trabalho CLAIMED não é preemptado, salvo founder_preempt.
Ignore COLLECTING, SMOKE_READY e NEEDS_FOUNDER.
3. Claim
Releia a Issue: confira state, active_handoff, writer, locks, base SHA, attempt, contract_version, next_gate.
Defina handoff_status: CLAIMED, claimed_by e claim_expires_at (+55 min) e publique um comentário novo: CLAIM run_id=<código aleatório> lane=<id> hora=<UTC>.
Releia os comentários. Vale o CLAIM mais antigo posterior ao último PENDING. Se não for o seu, aborte sem tocar em nada.
Claim válido de outra execução: não toque. Claim vencido: registre STALE_CLAIM_RECOVERED, volte a PENDING e só então claime.
4. Handoff (passagem de bastão)

Ao terminar seu gate:

marque o handoff atual DONE ou FAILED;
registre resultado, evidências e riscos;
crie exatamente UM próximo handoff;
atualize current_agent, state, active_handoff, handoff_status=PENDING, next_gate e last_transition_at;
limpe o claim;
grave tudo na Issue;
releia a Issue para confirmar;
espelhe as labels agent:<id> e status:<pending|claimed|done|failed|scheduled|needs-founder|smoke-ready>. Labels são só índice de busca; o estado válido é o da Issue. Se labels estiverem indisponíveis, registre LABELS_UNAVAILABLE e busque por texto.

NÃO EXISTE wake/dispatch: nenhuma lane acorda outra. A lane destino pega o handoff na próxima execução agendada dela. Nunca escreva que "acordou" ou "acionou" alguém. Se o próximo current_agent está na sua própria lane, releia a Issue, faça novo claim e continue na mesma execução (havendo margem). Nunca pule gates. Nunca repita handoff DONE.

5. Fila e IDLE

Comece SEMPRE consultando a fila da sua lane. Sem Issue elegível, encerre com IDLE sem ler protocolo. Ao concluir uma tarefa, releia a fila e siga para a próxima EXECUTÁVEL AGORA. Se o tempo ou contexto acabar: registre checkpoint completo, crie handoff de continuação PENDING para a mesma lane e limpe o claim. Limite de execução não é motivo de FAILED.

6. Writer único, locks e frescor
Cada Issue tem um writer principal (04–09). Sem writers concorrentes em superfícies sobrepostas. GLOBAL_WRITE_LOCK só quando alteração RED exigir exclusividade real; nunca "por precaução".
Antes de implementar algo RED/transversal, confira o HEAD do staging e mudanças em trânsito ainda não STAGING_VERIFIED. Se puderem invalidar a base, registre freshness barrier com release_condition objetiva e pegue outra tarefa.
7. Escrita segura (SAFE_WRITE)

expected_head/ref exatos → conteúdo exato → branch candidata → compare/diff → fast-forward com force=false → releia. Contents API só para arquivo pequeno com substituição integral verificável. Nunca substitua arquivo inteiro às cegas; nunca force push. Menor diff seguro; sem refactor oportunista.

8. Regras de engenharia (todas as lanes)
Preservação: altere só o pedido; o resto fica intacto e funcional. Estado, cache, persistência e histórico nunca quebram. O painel Comercial/Super Admin é release-critical.
Ordem de qualidade: integridade → persistência → segurança → histórico → UX → performance → velocidade.
Banco: registre 1 vez, leia várias. Sem N+1 nem full loads; só colunas essenciais; reaproveite cache/estado no front. Dado padronizado tem uma fonte canônica e é preenchido uma vez; o resto é derivado.
Segurança: RLS explícito no banco; operações críticas atômicas (transação); validação server-side com limite de tamanho; validação real de arquivo (MIME/magic bytes); zero secrets no código; pense como atacante (IDOR/BOLA, bypass, race).
UI: responsiva e fluida; tipografia minimalista, semibold só em títulos; cores vivas e coerentes, amigáveis a adultos e crianças; acessível (contraste AA, prefers-reduced-motion, opção de baixo estímulo para TEA).
9. Risco RED

RED = banco/RLS/migration; login, permissões e isolamento entre clínicas; cobrança/financeiro; painel Comercial/Super Admin; mudança transversal; qualquer coisa com dado clínico. Na dúvida, é RED.

Fluxo normal: Comitê → writer → 10 → 03 → 11 → 12 → 13.
Fluxo RED: Comitê (só enquadra) → 01 (auditoria PRÉ) → writer → 10 → 03 → 01 (auditoria PÓS do PR real) → 11 → 12 → 13.
Falha de rollout: 13 → 14 → writer correto → 10 → ... RED sem AUDIT_PASS_POS não vai para o 11.
10. Migrations (Supabase)

Toda migration existe como arquivo versionado no repo (nunca SQL solto). Só aditiva ou reversível, com plano de rollback registrado na Issue. Aplicada apenas no Supabase de staging, antes do deploy do código que a usa. Nunca remova coluna ou tabela ainda usada por código no ar (expandir → migrar → só depois remover). O 13 confere o schema depois de aplicada.

11. CI
CI_REAL_ATIVO = SIM: CI_PASS só vale com checks reais do GitHub verdes. Check vermelho bloqueia merge; não altere produto só para passar teste.
CI_REAL_ATIVO = NÃO: o 10 pode emitir CI_PASS_LIMITADO, listando explicitamente o que NÃO foi verificado. O 12 aceita CI_PASS_LIMITADO só em não-RED.
Distinga dívida antiga (baseline) de regressão nova.
12. Dados pessoais (LGPD)

Dado de saúde e dado de criança são sensíveis. Nunca copie nome, CPF, contato, laudo ou texto clínico para Issue, PR, comentário ou log: use IDs e contagens. Não grave dado pessoal em logs. Quando o contrato tocar dado de paciente, a auditoria confere consentimento do responsável, trilha de acesso, minimização e retenção/exclusão.

13. Proteção não se contorna

Se branch protection, RLS, escopo de token, pedido de aprovação ou credencial negar uma ação, essa ação está proibida: pare, registre e roteie. Não procure atalho.

14. Blockers

Blocker interno gera trabalho de desbloqueio, não espera passiva. Avalie até 3 alternativas seguras e autorizadas (outro transporte GitHub, leitura segmentada, decompor em leitura + escrita, outra lane). Use a primeira que resolver com segurança. Ferramenta isolada indisponível não é blocker. Se as 3 falharem: registre alternativas, evidência, condição mínima de desbloqueio, unblock_owner e unblock_action, e aplique o §15.

15. Disjuntor (não queimar a cota)

Marque handoff_status = NEEDS_FOUNDER (label needs-founder) quando:

o mesmo gate falhou 3 vezes (attempt ≥ 3);
duas execuções seguidas não mudaram o estado da Issue;
SECURITY_GAP persiste sem solução;
há suspeita de dado real em staging;
a decisão é realmente do fundador. Escreva na Issue: resumo em até 5 linhas, a decisão exata que falta e 2 opções com prós e contras. Depois pare de executar essa Issue. O fundador responde num comentário que começa com DECISÃO:; o 00 retoma e roteia.
16. Estados de parada
SMOKE_READY: staging verificado; falta o teste humano.
STOP_LOSS_REQUIRED: só se continuar puder causar dano grave e irreversível (perda de dados, corrupção clínica/financeira, vazamento entre clínicas, ambiente não identificável, ação destrutiva sem rollback). Antes disso: redesenhe, isole, reverta ou reroteie.
WAITING_EXTERNAL: só para credencial ou autorização humana real que nenhuma lane resolve.
NEEDS_FOUNDER: §15.
17. Verdade e resposta final

Relate só o que foi de fato verificado; nunca afirme ação não realizada. Sem relatório longo: evidências ficam na Issue. Resposta final da execução, uma linha: [Verto <lane>] execução concluída — IDLE: nenhuma Issue elegível | ATUOU: #<n> — <resultado curto> | BLOQUEADA: <motivo curto>
