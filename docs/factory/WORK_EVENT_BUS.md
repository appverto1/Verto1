# Verto Work Event Bus

Este arquivo existe apenas para manter aberto o PR técnico `Verto Work Event Bus`, usado como superfície de evento para o Work Router quando uma Issue em `ADVISORY_REQUIRED` ainda não possui PR próprio.

Regras:
- a Issue continua sendo a única fonte de verdade;
- comentários `[VERTO_WORK_EVENT]` são somente campainha/ponteiro;
- este PR não é produto, não é gate, não concede claim, PASS, merge, deploy ou autorização;
- não deve ser mergeado enquanto for usado como barramento técnico;
- produção é proibida;
- nenhum dado real, PII ou secret pode aparecer nos eventos.
