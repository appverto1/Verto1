# Roteiro de validação manual

## 1. Banco — aplicação manual

1. Confirmar que a aplicação ainda não foi publicada.
2. Aplicar manualmente `supabase/migrations/20260728020000_sales_modular_profitability_policy.sql`.
3. Executar as consultas somente leitura de `supabase/post_migration/20260728020000_sales_modular_profitability_policy_checks.sql`.
4. Em ambiente seguro/local, executar o teste transacional `supabase/tests/20260728020000_sales_modular_profitability_policy_test.sql`; ele termina com `ROLLBACK`.
5. Confirmar que o catálogo v3 continua ativo, sem `profitability_policy`, e que nenhum snapshot ou Checkout mudou.

## 2. Catálogo

1. Entrar como owner/Super Admin com MFA.
2. Abrir Configurações financeiras e selecionar o catálogo v3 ativo.
3. Clicar em “Nova versão”.
4. Confirmar o nome sugerido “Catálogo comercial v4 — margem EBITDA modular”.
5. Confirmar os pisos 60%, 70%, 75%, 80% e o perfil intensivo.
6. Manter franquias desabilitadas quando não houver valor aprovado; habilitar apenas preenchendo franquia, bloco e preço reais.
7. Salvar, atualizar a página, sair e entrar novamente; confirmar persistência.
8. Publicar pelo fluxo normal e confirmar que somente um catálogo ficou ativo e a v3 foi arquivada.

## 3. Propostas

1. Montar uma proposta de 150 pacientes com Verto Clínica.
2. Abrir “Economia da clínica” e conferir receita, custo intensivo, EBITDA, margens e preços mínimos 60/70/75/80.
3. Adicionar Agenda, Financeiro, TISS e Escolar individualmente; conferir margem antes, margem do módulo, margem depois e variação em pontos percentuais.
4. Criar uma condição abaixo de 60% e confirmar bloqueio de envio.
5. Criar uma condição entre 60% e 70% sem desconto temporário e confirmar bloqueio.
6. Adicionar desconto temporário e justificativa; confirmar que a condição posterior precisa atingir 70%.
7. Testar módulo gratuito temporário e confirmar impacto, duração e justificativa.
8. Alterar capacidade, drivers, implantação ou outro desconto e confirmar recálculo imediato do desconto máximo.
9. Testar 151, 160, 161 e 200 pacientes; conferir margem dos blocos de capacidade.
10. Abrir o simulador, alternar 150/160/170/200 e perfis leve/padrão/intensivo; conferir todas as combinações.

## 4. Persistência e Checkout

1. Salvar o cenário, atualizar a tela, sair e entrar novamente.
2. Confirmar que política, margens, preços mínimos e fases permanecem no snapshot.
3. Gerar proposta pública somente quando o painel indicar “Dentro da política”.
4. Registrar aceite e gerar link de teste com MFA.
5. Confirmar que o Checkout usa as fases e valores congelados.
6. Alterar o catálogo depois e confirmar que a proposta aceita não muda.
7. Confirmar que Checkout legado e assinaturas existentes continuam funcionais.

## 5. GitHub Desktop — diretamente na Main

1. Abrir o repositório no GitHub Desktop e permanecer na branch `Main`.
2. Revisar os 15 arquivos de código/SQL/teste listados no manifesto.
3. Não incluir `dist`, credenciais, arquivos locais ou o ZIP no commit de aplicação.
4. Usar o summary sugerido: `feat: garante margem EBITDA no motor modular`.
5. Descrição sugerida: `Versiona pisos de margem, concentra custos compartilhados no clinical_core, bloqueia fases insustentáveis e adiciona painel/simulador econômico.`
6. Fazer commit e push pela interface do GitHub Desktop somente após a aplicação/validação manual da migration.
