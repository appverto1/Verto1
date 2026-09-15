# Verto Factory Protocol

`factory_protocol_version: 1`

Este arquivo é o protocolo transversal vinculante da fábrica Verto. Toda Issue que declarar `factory_protocol_version: 1` deve aplicar esta versão antes de qualquer escrita, ressalvada apenas a exceção de bootstrap registrada na Issue #180.

## SAFE_WRITE / TRANSACTIONAL GIT

### SAFE_WRITE

Capacidade de escrever não implica capacidade de escrever com segurança.

Toda alteração deve preservar código e comportamento fora do escopo contratado.

Ordem preferencial de escrita:
1. patch/hunk em workspace Git;
2. Git transacional por objetos (`blob -> tree -> commit`);
3. outro mecanismo que permita produzir um candidate commit e validar seu diff antes de mover a branch.

Regras obrigatórias:
- fixe `expected_head` antes de iniciar;
- mantenha a branch contratada imóvel até a validação;
- construa `candidate_sha` sem mover a branch;
- compare `expected_head -> candidate_sha`;
- valide arquivos e hunks alterados contra o escopo da Issue;
- só após `diff_validation: PASS` mova a branch;
- alteração fora do escopo => descarte o candidate e preserve o head original;
- whole-file replacement só é aceitável se o conteúdo completo vier da mesma revisão esperada e o candidate diff for validado antes de mover a branch.

É proibido:
- whole-file replace cego de arquivo compartilhado;
- force push para contornar limitação de runtime;
- reconstrução aproximada de arquivo grande;
- mover branch antes da validação do diff;
- aceitar mudança colateral apenas porque testes passaram;
- repetir executor que já falhou por capability sem evidência de que a capability mudou.

Se o runtime não conseguir escrever com segurança, retornar `WRITE_TRANSPORT_BLOCKED` registrando:
- capability ausente;
- arquivo/superfície afetada;
- `expected_head` preservado;
- `candidate_sha`, se houver;
- se a branch foi movida;
- transporte alternativo recomendado.

Limitação de transporte não é falha funcional e não deve reabrir arquitetura/UX sem evidência funcional nova.
