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

Cada execução de W ou Q assume EXATAMENTE UM papel, determinado por `current_agent`. Nunca misturar papéis na mesma rodada.

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

## Write isolation
Toda Issue tem exatamente um writer principal. Em alteração transversal: `GLOBAL_WRITE_LOCK = ACTIVE`. Nenhum segundo writer pode alterar superfície sobreposta enquanto o lock estiver ativo.

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

## Polling
Cada Projeto físico pode ter uma tarefa recorrente. Ao acordar:
1. buscar Issues abertas da fábrica;
2. agir apenas nas Issues cujo `current_agent` pertença ao Projeto;
3. validar `state` e `active_handoff` antes de qualquer ação;
4. se nenhuma Issue for elegível, encerrar imediatamente;
5. se houver mais de uma, priorizar a mais antiga/prioritária sem quebrar locks;
6. ler histórico e contrato completos;
7. executar somente o papel ativo;
8. registrar resultado e atualizar `current_agent`, `state`, `active_handoff`, `attempt` quando aplicável e `next_gate`.

Mapeamento de polling:
- Projeto 00: somente 00.
- Projeto 01: somente 01.
- Projeto 02: somente 02.
- W: 04,05,06,07,08,09.
- Q: 03,10,11,12,13,14.

Uma execução atrasada que encontrar handoff já alterado deve encerrar sem repetir trabalho.

## Gates
Writer: menor diff seguro, branch/base SHA corretos, testes targeted e evidências na Issue.
09: valida schema/migration/RLS quando houver banco.
10: CI/regressão, separando dívida pré-existente de regressão nova.
03: compara diff real com contrato; não corrige código.
11: prepara PR fiel ao contrato.
12: merge em staging somente com review/CI/head/base válidos.
13: verifica Railway staging, SHA, build/runtime/health e Supabase quando aplicável.
14: contém/reverte rollout falho e devolve para revalidação.

## Conclusão
`SMOKE_READY` só após implementação aderente, testes/CI, review, merge correto e staging saudável. Ao chegar em `SMOKE_READY`, parar a cadeia automática e fornecer exatamente um passo de smoke humano.
