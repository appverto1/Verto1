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
