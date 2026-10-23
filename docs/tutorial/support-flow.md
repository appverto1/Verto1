# Tutorial e suporte por tópico

Decisão do fundador em 06/10/2026: o chat filtra o suporte. Não há painel,
relatório, notificação de progresso, chamado nem e-mail no superadmin.

A Central existente (`/ajuda`, acessível pelo menu da conta) recebe os tópicos
revisados conforme o vínculo, as permissões e os módulos da clínica atual.
Cada aula exibe uma instrução e um print com destaque, Anterior, Próximo e
Marcar como Concluído. A conclusão é uma declaração do usuário, não uma
comprovação de leitura. Não é necessário concluir toda a trilha.

O balão pergunta o assunto e uma descrição curta, busca somente os tópicos
autorizados e oferece até quatro correspondências. Abrir tutorial seleciona
o tópico exato sem fechar o chat. Cerca de 60 segundos depois, uma única
pergunta verifica se a dúvida foi resolvida. Minimizar preserva a conversa e o temporizador; no celular, o balão é recolhido ao abrir a aula para permitir a leitura. Não há polling nem serviço de IA.

Ainda preciso de ajuda consulta a conclusão atual do tópico/revisão no servidor.
Se pendente, o chat orienta consultar a aula, marcar Concluído caso já tenha
visto e reenviar a resposta. Não há nova espera obrigatória. Se concluído e a
dúvida continuar, retorna somente uma mensagem de texto com o número privado
`HELP_SUPPORT_WHATSAPP_NUMBER` e a orientação de explicar a dúvida. Sem botão,
link wa.me, envio automático ou persistência do texto da conversa.

O número deve ser informado pelo fundador com código de país e DDD. Não usar
um telefone comercial como fallback. A ausência da configuração mantém o
contato indisponível sem interromper as aulas ou suas conclusões.

O backend determina usuário/clínica/vínculo; o navegador envia apenas tópico,
revisão, conclusão e uma chave de contexto para detectar mudanças. As duas
RPCs conferem novamente vínculo ativo e papel. RLS e grants negam a tabela e
as RPCs a `anon` e `authenticated`; só o backend recebe acesso. A chave única versionada é usuário/clínica/vínculo/papel/tópico/revisão.
Alterar de papel não reutiliza uma conclusão do papel anterior, mesmo quando
os mesmos artigos possuem identificadores e revisões idênticos. A tabela
legada permanece intacta; apenas históricos com um único vínculo ativo
inequívoco foram copiados uma vez. A projeção e as permissões continuam
revalidadas no backend e no banco.

O POST usa a proteção central de origem/CSRF já existente na Verto, inclusive
o domínio confiável configurado para o aplicativo quando houver proxy.

Os 65 JPGs são cópias exatas dos prints revisados, sem barra de navegador,
URL de staging ou metadados EXIF. Ficam em `services/help-media`, fora dos
arquivos públicos, e são servidos por uma rota autenticada após autorização
do tópico. O catálogo completo fica exclusivamente no servidor.

## Partes em OFF

| ID | Tópico | Condição de retomada |
| --- | --- | --- |
| OFF-001 | Cancelar sessão (`agenda-cancelar`) | Formulário expandido e motivo do cancelamento prontos; recapturar e revisar os prints. |
| OFF-002 | Agendamento recorrente (`agenda-recorrencia`) | Formulário expandido de recorrência pronto; recapturar e revisar os prints. |
| OFF-003 | Ajustes financeiros (`recebimento-ajustes`) | Campos de desconto, cortesia e estorno prontos; recapturar e revisar os prints. |
| OFF-004 | Escola | Fora desta trilha; aguardar módulo pronto e autorização de inclusão. |
| OFF-005 | Convênios/TISS/XML/faturista | Fora da trilha inicial; aguardar revisão própria. O artigo de faturamento preexistente permanece preservado. |

OFF não aparece nas sugestões nem exige conclusão. Consultas explícitas sobre
esses assuntos informam que a aula está em preparação. O fundador ainda não
definiu uma exceção de contato para funcionalidades sem aula publicada.

## Validação e rollout

- Migração legada `20261006191832_help_tutorial_progress.sql` já existente.
- Aplicar a migração aditiva `20261023202000_help_tutorial_role_progress_v2.sql` somente em staging antes do deploy do backend v2; validar grants e persistência por vínculo/papel.
- Rodar `node --import tsx tests/helpTutorialSupport.test.ts` e os três testes
  `helpCenterRoutes`, `helpCenterManifest`, `helpCenterIntegration`.
- Rodar `tests/sql/helpTutorialSupport.rollback.sql` no banco de staging:
  fixtures sintéticas são integralmente desfeitas.
- Verificar o CI do PR em staging, merge autorizado e SHA do deploy Railway.
- Smoke: abrir Ajuda com conta profissional, escolher uma aula e abrir o chat;
  confirmar o tópico pendente, salvar Concluído e responder novamente.

Não há dependência de mudança no fluxo de pacientes, cobranças, Stripe,
boletos, Google, convites ou painel de superadmin.
