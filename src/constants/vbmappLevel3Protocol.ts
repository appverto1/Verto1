// Gerado a partir do PDF licenciado informado pela Verto.
// Manter este protocolo como conteudo restrito/licenciado dentro da plataforma.

const skill = (
  id: string,
  code: string,
  name: string,
  metaSucessos: number,
  objective: string,
  criteria: string,
  sourcePage: number,
  sourceDomain: string
) => ({
  id,
  code,
  name,
  maxScore: 1,
  meta_sucessos: metaSucessos,
  objective,
  question: objective,
  example: '',
  criteria,
  comment: '',
  sourcePage,
  sourceDomain
});

export const VBMAPP_LEVEL_3_PROTOCOL = {
  id: 'vb-mapp-level-3',
  canonicalKey: 'vb-mapp-level-3',
  title: 'VB-MAPP - Nivel 3',
  category: 'evaluation',
  ageGroup: 'child',
  age_minima: 2.5,
  age_maxima: 4,
  min_age: 2.5,
  max_age: 4,
  type: 'neurodevelopment',
  domain: 'VB-MAPP, Nivel 3, Marcos, 30 a 48 meses',
  isGlobal: true,
  isLicensed: true,
  sourceLabel: 'VB-MAPP3.pdf',
  versionLabel: 'VB-MAPP Nivel 3 - 30 a 48 meses de idade tipica',
  licenseScope: 'Uso licenciado/restrito informado pela Verto',
  masteryLogic: 'vbmapp_meta_sucessos',
  canonicalMeta: {
    typicalAgeRangeMonths: '30-48',
    taskCount: 65,
    domainCount: 13,
    sourcePages: 27,
    extractionMethod: 'pypdf-text-extraction-manual-structuring',
    completionPercent: 100,
    completionStatus: 'Completo para o PDF VB-MAPP Nivel 3 enviado'
  },
  data: [
    {
      id: 'dom-mando-n3',
      name: 'Mando Nivel 3',
      skills: [
        skill('mando-n3-11', 'M11', 'Faz mandos para informacoes verbais', 5, 'O aprendiz faz mandos espontaneos para diferentes informacoes verbais usando perguntas por 5 vezes.', '0,5= 3 mandos por informacao; 1= 5 mandos por informacao.', 4, 'Mando Nivel 3'),
        skill('mando-n3-12', 'M12', 'Pede para parar atividade indesejada', 5, 'O aprendiz pede educadamente para parar uma atividade indesejada ou remover estimulo aversivo em 5 circunstancias.', '0,5= 3 circunstancias; 1= 5 circunstancias.', 4, 'Mando Nivel 3'),
        skill('mando-n3-13', 'M13', 'Pede com 10 adjetivos, preposicoes ou adverbios', 10, 'O aprendiz pede usando 10 diferentes adjetivos, preposicoes ou adverbios.', '0,5= 6 usos; 1= 10 usos.', 4, 'Mando Nivel 3'),
        skill('mando-n3-14', 'M14', 'Da direcoes, instrucoes ou explicacoes', 5, 'O aprendiz da direcoes, instrucoes ou explicacoes sobre como fazer ou participar de algo em uma atividade por 5 vezes.', '0,5= 3 vezes; 1= 5 vezes.', 4, 'Mando Nivel 3'),
        skill('mando-n3-15', 'M15', 'Pede que outros atendam ao seu intraverbal', 5, 'O aprendiz pede que outras pessoas atendam ao seu proprio comportamento intraverbal por 5 vezes.', '0,5= 3 vezes; 1= 5 vezes.', 4, 'Mando Nivel 3')
      ]
    },
    {
      id: 'dom-tato-n3',
      name: 'Tato Nivel 3',
      skills: [
        skill('tato-n3-11', 'T11', 'Nomeia cor, forma e funcao de 5 objetos', 15, 'O aprendiz nomeia cores, formas e funcoes de 5 objetos em ordem misturada, totalizando 15 tentativas.', '0,5= 2 caracteristicas ou funcoes de 5 objetos; 1= cor, forma e funcao de 5 objetos.', 5, 'Tato Nivel 3'),
        skill('tato-n3-12', 'T12', 'Nomeia preposicoes e pronomes', 8, 'O aprendiz nomeia 4 preposicoes diferentes e 4 pronomes diferentes.', '0,5= repertorio parcial entre preposicoes e pronomes; 1= 4 preposicoes e 4 pronomes.', 5, 'Tato Nivel 3'),
        skill('tato-n3-13', 'T13', 'Nomeia adjetivos e adverbios', 8, 'O aprendiz nomeia 4 adjetivos diferentes, excluindo cores e formas, e 4 adverbios.', '0,5= repertorio parcial entre adjetivos e adverbios; 1= 4 adjetivos e 4 adverbios.', 5, 'Tato Nivel 3'),
        skill('tato-n3-14', 'T14', 'Nomeia com sentencas completas', 20, 'O aprendiz nomeia com sentenca completa contendo 4 ou mais palavras por 20 vezes.', '0,5= 20 sentencas com 3 ou mais palavras; 1= 20 sentencas com 4 ou mais palavras.', 5, 'Tato Nivel 3'),
        skill('tato-n3-15', 'T15', 'Nomeia 1000 estimulos nao verbais', 1000, 'O aprendiz nomeia 1000 estimulos nao verbais, incluindo substantivos, verbos, adjetivos, adverbios e pronomes.', '0,5= 750 estimulos; 1= 1000 estimulos.', 5, 'Tato Nivel 3')
      ]
    },
    {
      id: 'dom-ouvinte-n3',
      name: 'Ouvinte Nivel 3',
      skills: [
        skill('ouvinte-n3-11', 'O11', 'Seleciona itens por cor e forma', 8, 'O aprendiz seleciona itens por cor e forma em arranjo de 6 estimulos similares para 4 cores e 4 formas.', '0,5= repertorio parcial; 1= 4 cores e 4 formas.', 6, 'Ouvinte Nivel 3'),
        skill('ouvinte-n3-12', 'O12', 'Segue instrucoes com preposicoes e pronomes', 20, 'O aprendiz segue 2 instrucoes envolvendo 6 preposicoes diferentes e 4 pronomes diferentes.', '0,5= 3 preposicoes e 2 pronomes, ou uma categoria completa; 1= 6 preposicoes e 4 pronomes.', 6, 'Ouvinte Nivel 3'),
        skill('ouvinte-n3-13', 'O13', 'Discrimina adjetivos e adverbios relativos', 8, 'O aprendiz seleciona itens por 4 pares de adjetivos relativos e demonstra acoes por 4 pares de adverbios relativos.', '0,5= repertorio parcial entre adjetivos e adverbios; 1= 4 pares de cada categoria.', 7, 'Ouvinte Nivel 3'),
        skill('ouvinte-n3-14', 'O14', 'Segue 10 instrucoes de 3 passos', 10, 'O aprendiz segue instrucoes com 3 passos para 10 instrucoes diferentes.', '0,5= 6 instrucoes; 1= 10 instrucoes.', 7, 'Ouvinte Nivel 3'),
        skill('ouvinte-n3-15', 'O15', 'Tem repertorio de ouvinte de 1200 palavras', 1200, 'O aprendiz apresenta repertorio total de ouvinte com 1200 palavras testadas ou de lista acumulada.', '0,5= 800 palavras; 1= 1200 palavras.', 7, 'Ouvinte Nivel 3')
      ]
    },
    {
      id: 'dom-vpmts-n3',
      name: 'Percepcao Visual e Matching-to-Sample Nivel 3',
      skills: [
        skill('vpmts-n3-11', 'VP/MTS11', 'Pareia parte de atividade de artes ou construcao', 2, 'O aprendiz pareia espontaneamente qualquer parte de uma atividade de artes ou construcao frente ao modelo de outra pessoa por 2 vezes.', '0,5= 1 atividade; 1= 2 atividades.', 8, 'Percepcao Visual Matching-to-Sample Nivel 3'),
        skill('vpmts-n3-12', 'VP/MTS12', 'Demonstra pareamento generalizado de nao identicos', 25, 'O aprendiz demonstra pareamento generalizado de nao identicos em arranjo desordenado de 10 itens com 3 similares para 25 itens.', '0,5= 15 itens; 1= 25 itens.', 8, 'Percepcao Visual Matching-to-Sample Nivel 3'),
        skill('vpmts-n3-13', 'VP/MTS13', 'Completa 20 projetos com pelo menos 8 pecas', 20, 'O aprendiz completa 20 projetos com blocos, tangrans, quebra-cabecas de formas ou tarefas similares com pelo menos 8 pecas.', '0,5= projetos com 4 pecas; 1= projetos com 8 pecas.', 8, 'Percepcao Visual Matching-to-Sample Nivel 3'),
        skill('vpmts-n3-14', 'VP/MTS14', 'Classifica itens em categorias', 5, 'O aprendiz classifica 5 itens em 5 diferentes categorias sem modelo.', '0,5= 3 categorias; 1= 5 categorias.', 8, 'Percepcao Visual Matching-to-Sample Nivel 3'),
        skill('vpmts-n3-15', 'VP/MTS15', 'Continua 20 padroes de 3 passos', 20, 'O aprendiz continua 20 padroes, sequencias ou tarefas de seriacao com 3 passos.', '0,5= 20 padroes de 2 passos; 1= 20 padroes de 3 passos.', 8, 'Percepcao Visual Matching-to-Sample Nivel 3')
      ]
    },
    {
      id: 'dom-brincar-independente-n3',
      name: 'Brincar Independente Nivel 3',
      skills: [
        skill('brincar-ind-n3-11', 'BI11', 'Brinca de imaginacao ou faz de conta', 5, 'O aprendiz envolve-se espontaneamente em brincadeiras de imaginacao ou faz de conta em 5 ocasioes.', '0,5= 2 ocasioes; 1= 5 ocasioes.', 9, 'Brincar Independente Nivel 3'),
        skill('brincar-ind-n3-12', 'BI12', 'Repete comportamento motor grosso para efeito', 2, 'O aprendiz repete um comportamento motor grosso para obter um efeito melhor para 2 atividades.', '0,5= 1 atividade; 1= 2 atividades.', 9, 'Brincar Independente Nivel 3'),
        skill('brincar-ind-n3-13', 'BI13', 'Faz atividades grafomotoras por 5 minutos', 5, 'O aprendiz envolve-se independentemente em atividades grafomotoras por 5 minutos.', '0,5= 2 minutos; 1= 5 minutos.', 9, 'Brincar Independente Nivel 3'),
        skill('brincar-ind-n3-14', 'BI14', 'Mantem brincar continuado por 10 minutos', 10, 'O aprendiz envolve-se independentemente em atividades de brincar continuado por 10 minutos sem dicas ou reforcadores adultos.', '0,5= 5 minutos; 1= 10 minutos.', 9, 'Brincar Independente Nivel 3'),
        skill('brincar-ind-n3-15', 'BI15', 'Desenha ou escreve em atividades pre-academicas', 5, 'O aprendiz desenha ou escreve independentemente em livros de atividades pre-academicas por 5 minutos.', '0,5= 2 minutos; 1= 5 minutos.', 9, 'Brincar Independente Nivel 3')
      ]
    },
    {
      id: 'dom-social-n3',
      name: 'Comportamento Social e Brincar Social Nivel 3',
      skills: [
        skill('social-n3-11', 'SB11', 'Coopera com par para resultado especifico', 5, 'O aprendiz coopera espontaneamente com um par para obter um resultado especifico por 5 vezes.', '0,5= 2 vezes; 1= 5 vezes.', 10, 'Comportamento Social e Brincar Social Nivel 3'),
        skill('social-n3-12', 'SB12', 'Pergunta aos pares por informacoes', 5, 'O aprendiz pergunta espontaneamente aos pares "o que", "quem" ou "onde" por 5 vezes em 60 minutos.', '0,5= 2 pedidos em 1 hora; 1= 5 pedidos em 1 hora.', 10, 'Comportamento Social e Brincar Social Nivel 3'),
        skill('social-n3-13', 'SB13', 'Responde questoes feitas pelos pares', 5, 'O aprendiz responde intraverbalmente a 5 diferentes questoes ou sentencas feitas pelos pares.', '0,5= 2 respostas; 1= 5 respostas.', 10, 'Comportamento Social e Brincar Social Nivel 3'),
        skill('social-n3-14', 'SB14', 'Brinca socialmente por 5 minutos sem adulto', 5, 'O aprendiz envolve-se em atividades de brincar social ou faz de conta com os pares por 5 minutos sem ajuda de adulto.', '0,5= 2 minutos; 1= 5 minutos.', 10, 'Comportamento Social e Brincar Social Nivel 3'),
        skill('social-n3-15', 'SB15', 'Mantem trocas verbais sobre 5 assuntos', 5, 'O aprendiz envolve-se em trocas verbais sobre um mesmo assunto com pares para 5 assuntos diferentes.', '0,5= 2 trocas; 1= 5 assuntos.', 10, 'Comportamento Social e Brincar Social Nivel 3')
      ]
    },
    {
      id: 'dom-lrffc-n3',
      name: 'LRFFC Nivel 3',
      skills: [
        skill('lrffc-n3-11', 'LRFFC11', 'Seleciona 25 itens por perguntas LRFFC', 25, 'O aprendiz seleciona o item correto em arranjo de 10 itens com 3 similares para 25 perguntas de discriminacao por funcao, classe ou caracteristica.', '0,5= 15 perguntas; 1= 25 perguntas.', 12, 'LRFFC Nivel 3'),
        skill('lrffc-n3-12', 'LRFFC12', 'Seleciona itens por 2 componentes verbais', 25, 'O aprendiz seleciona itens de um livro baseado em 2 componentes verbais para 25 tarefas de discriminacao por funcao, classe ou caracteristica.', '0,5= 15 tarefas; 1= 25 tarefas.', 12, 'LRFFC Nivel 3'),
        skill('lrffc-n3-13', 'LRFFC13', 'Seleciona itens por 3 componentes verbais', 25, 'O aprendiz seleciona itens de livro ou ambiente natural baseado em 3 componentes verbais para 25 perguntas LRFFC.', '0,5= 15 itens; 1= 25 itens.', 13, 'LRFFC Nivel 3'),
        skill('lrffc-n3-14', 'LRFFC14', 'Responde 4 perguntas sobre 25 temas', 25, 'O aprendiz seleciona itens em livro ou ambiente natural dadas 4 perguntas diferentes de discriminacao sobre o mesmo tema para 25 temas.', '0,5= repertorio parcial de temas; 1= 25 temas.', 14, 'LRFFC Nivel 3'),
        skill('lrffc-n3-15', 'LRFFC15', 'Demonstra 1000 respostas LRFFC', 1000, 'O aprendiz demonstra 1000 respostas diferentes de discriminacao por funcao, classe ou caracteristicas, testadas ou conhecidas.', '0,5= 750 respostas; 1= 1000 respostas.', 17, 'LRFFC Nivel 3')
      ]
    },
    {
      id: 'dom-intraverbal-n3',
      name: 'Intraverbal Nivel 3',
      skills: [
        skill('intraverbal-n3-11', 'IV11', 'Emite 20 comentarios intraverbais', 20, 'O aprendiz emite espontaneamente 20 comentarios intraverbais.', '0,5= 10 comentarios; 1= 20 comentarios.', 18, 'Intraverbal Nivel 3'),
        skill('intraverbal-n3-12', 'IV12', 'Demonstra 300 respostas intraverbais', 300, 'O aprendiz demonstra 300 respostas intraverbais diferentes, testadas ou conhecidas.', '0,5= 200 respostas; 1= 300 respostas.', 18, 'Intraverbal Nivel 3'),
        skill('intraverbal-n3-13', 'IV13', 'Responde perguntas apos frases curtas', 25, 'O aprendiz responde 2 questoes depois de ler frases curtas de livros para 25 trechos.', '0,5= repertorio parcial; 1= 25 trechos com 2 perguntas.', 19, 'Intraverbal Nivel 3'),
        skill('intraverbal-n3-14', 'IV14', 'Descreve 25 eventos com 8 palavras ou mais', 25, 'O aprendiz descreve 25 diferentes eventos, videos ou historias com 8 palavras ou mais.', '0,5= 12 eventos com 5 palavras; 1= 25 eventos com 8 palavras.', 20, 'Intraverbal Nivel 3'),
        skill('intraverbal-n3-15', 'IV15', 'Responde 4 perguntas sobre 10 topicos', 10, 'O aprendiz responde 4 perguntas como onde, quem, o que e qual sobre um unico topico para 10 topicos.', '0,5= 3 perguntas para 5 topicos; 1= 4 perguntas para 10 topicos.', 21, 'Intraverbal Nivel 3')
      ]
    },
    {
      id: 'dom-grupo-n3',
      name: 'Grupo Nivel 3',
      skills: [
        skill('grupo-n3-11', 'G11', 'Usa banheiro e lava as maos com dicas verbais', 1, 'O aprendiz usa o banheiro e lava as maos apenas com dicas verbais.', '0,5= precisa de ajuda fisica; 1= como apresentado.', 23, 'Grupo Nivel 3'),
        skill('grupo-n3-12', 'G12', 'Responde instrucoes coletivas em grupo', 5, 'O aprendiz responde a 5 instrucoes coletivas ou questoes sem dicas diretas em grupo de 3 ou mais criancas.', '0,5= 2 respostas; 1= 5 respostas.', 23, 'Grupo Nivel 3'),
        skill('grupo-n3-13', 'G13', 'Trabalha independentemente por 5 minutos', 5, 'O aprendiz trabalha de forma independente por 5 minutos em grupo e permanece na tarefa por 50% do periodo.', '0,5= 2 minutos; 1= 5 minutos.', 23, 'Grupo Nivel 3'),
        skill('grupo-n3-14', 'G14', 'Adquire comportamentos em ensino coletivo', 2, 'O aprendiz adquire 2 comportamentos novos em formato de ensino coletivo de 15 minutos com cinco ou mais criancas.', '0,5= 1 comportamento novo; 1= 2 comportamentos novos.', 23, 'Grupo Nivel 3'),
        skill('grupo-n3-15', 'G15', 'Participa de sessao de grupo por 20 minutos', 5, 'O aprendiz senta-se em sessao de grupo com 5 criancas por 20 minutos sem disruptivos e responde a 5 questoes intraverbais.', '0,5= responde a 2 questoes; 1= criterio completo.', 23, 'Grupo Nivel 3')
      ]
    },
    {
      id: 'dom-linguistica-n3',
      name: 'Estrutura Linguistica Nivel 3',
      skills: [
        skill('linguistica-n3-11', 'EL11', 'Emite flexoes de substantivos', 20, 'O aprendiz emite flexoes de substantivos combinando 10 substantivos com plurais e 10 com possessivos.', '0,5= uma categoria completa; 1= plurais e possessivos.', 24, 'Estrutura Linguistica Nivel 3'),
        skill('linguistica-n3-12', 'EL12', 'Emite flexoes de verbos', 20, 'O aprendiz emite flexoes de verbos combinando 10 verbos no passado simples e 10 no futuro simples.', '0,5= uma categoria completa; 1= passado e futuro.', 24, 'Estrutura Linguistica Nivel 3'),
        skill('linguistica-n3-13', 'EL13', 'Emite 10 frases nominais com modificadores', 10, 'O aprendiz emite 10 frases nominais com pelo menos 3 palavras e 2 modificadores.', '0,5= 5 frases nominais; 1= 10 frases nominais.', 24, 'Estrutura Linguistica Nivel 3'),
        skill('linguistica-n3-14', 'EL14', 'Emite 10 frases verbais com modificadores', 10, 'O aprendiz emite 10 frases verbais com pelo menos 3 palavras e 2 modificadores.', '0,5= 5 frases verbais; 1= 10 frases verbais.', 24, 'Estrutura Linguistica Nivel 3'),
        skill('linguistica-n3-15', 'EL15', 'Produz 10 sentencas sintaticamente corretas', 10, 'O aprendiz combina frases nominais e verbais para produzir 10 oracoes ou sentencas sintaticamente corretas com pelo menos 5 palavras.', '0,5= 5 sentencas; 1= 10 sentencas.', 24, 'Estrutura Linguistica Nivel 3')
      ]
    },
    {
      id: 'dom-leitura-n3',
      name: 'Leitura Nivel 3',
      skills: [
        skill('leitura-n3-11', 'L11', 'Atenta a leitura de livro', 75, 'O aprendiz atenta a um livro quando uma historia e lida por pelo menos 75% do tempo em observacao de 3 minutos.', '0,5= 50% do tempo; 1= 75% do tempo.', 25, 'Leitura Nivel 3'),
        skill('leitura-n3-12', 'L12', 'Seleciona 10 letras maiusculas', 10, 'O aprendiz seleciona letra maiuscula correta em arranjo de 5 letras para 10 letras diferentes.', '0,5= 5 letras; 1= 10 letras.', 25, 'Leitura Nivel 3'),
        skill('leitura-n3-13', 'L13', 'Nomeia 10 letras maiusculas', 10, 'O aprendiz nomeia 10 letras maiusculas sob instrucao.', '0,5= 5 letras; 1= 10 letras.', 25, 'Leitura Nivel 3'),
        skill('leitura-n3-14', 'L14', 'Le o proprio nome', 1, 'O aprendiz le seu proprio nome.', '1= sim; 0= nao.', 25, 'Leitura Nivel 3'),
        skill('leitura-n3-15', 'L15', 'Emparelha 5 palavras a figuras ou itens', 5, 'O aprendiz emparelha 5 palavras a figuras ou itens correspondentes em arranjo de 5 e vice-versa.', '0,5= 3 palavras; 1= 5 palavras.', 25, 'Leitura Nivel 3')
      ]
    },
    {
      id: 'dom-escrita-n3',
      name: 'Escrita Nivel 3',
      skills: [
        skill('escrita-n3-11', 'E11', 'Imita 5 acoes de escrita', 5, 'O aprendiz imita 5 diferentes acoes de escrita apos modelo adulto usando instrumento e superficie para escrita.', '0,5= 3 acoes; 1= 5 acoes.', 26, 'Escrita Nivel 3'),
        skill('escrita-n3-12', 'E12', 'Traca 5 formas geometricas', 5, 'O aprendiz traca 5 diferentes formas geometricas de forma independente.', '0,5= 3 formas; 1= 5 formas.', 26, 'Escrita Nivel 3'),
        skill('escrita-n3-13', 'E13', 'Copia 10 letras ou numeros', 10, 'O aprendiz copia 10 letras ou numeros de forma legivel.', '0,5= 5 letras ou numeros; 1= 10 letras ou numeros.', 26, 'Escrita Nivel 3'),
        skill('escrita-n3-14', 'E14', 'Escreve o proprio nome sem copiar', 1, 'O aprendiz soletra e escreve de forma legivel seu proprio nome sem copiar.', '0,5= letras nao ficam claras; 1= como apresentado.', 26, 'Escrita Nivel 3'),
        skill('escrita-n3-15', 'E15', 'Copia o alfabeto em maiusculas e minusculas', 52, 'O aprendiz copia todas as 26 letras do alfabeto em maiusculas e minusculas de forma legivel.', '0,5= letras nao ficam claras; 1= como apresentado.', 26, 'Escrita Nivel 3')
      ]
    },
    {
      id: 'dom-matematica-n3',
      name: 'Matematica Nivel 3',
      skills: [
        skill('matematica-n3-11', 'MAT11', 'Identifica numeros de 1 a 5 como ouvinte', 5, 'O aprendiz identifica como ouvinte os numeros de 1 a 5 em arranjo com 5 numeros diferentes.', '0,5= numeros de 1 a 3; 1= numeros de 1 a 5.', 27, 'Matematica Nivel 3'),
        skill('matematica-n3-12', 'MAT12', 'Nomeia numeros de 1 a 5', 5, 'O aprendiz nomeia os numeros de 1 a 5.', '0,5= 3 numeros; 1= 5 numeros.', 27, 'Matematica Nivel 3'),
        skill('matematica-n3-13', 'MAT13', 'Quantifica de 1 a 5 itens', 5, 'O aprendiz conta e quantifica de 1 a 5 itens de um grupo maior com correspondencia um a um.', '0,5= 1 a 3 itens; 1= 1 a 5 itens.', 27, 'Matematica Nivel 3'),
        skill('matematica-n3-14', 'MAT14', 'Identifica 8 comparacoes de medidas', 8, 'O aprendiz identifica como ouvinte 8 diferentes comparacoes envolvendo medidas.', '0,5= 6 comparacoes; 1= 8 comparacoes.', 27, 'Matematica Nivel 3'),
        skill('matematica-n3-15', 'MAT15', 'Emparelha numerais e quantidades de 1 a 5', 5, 'O aprendiz emparelha corretamente numerais com quantidades e quantidades com numerais para os numeros de 1 a 5.', '0,5= numeros de 1 a 3; 1= numeros de 1 a 5.', 27, 'Matematica Nivel 3')
      ]
    }
  ]
};

export const VBMAPP_LEVEL_3_CANONICAL_PROTOCOL = VBMAPP_LEVEL_3_PROTOCOL;
