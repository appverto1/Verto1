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

export const VBMAPP_LEVEL_2_PROTOCOL = {
  id: 'vb-mapp-level-2',
  canonicalKey: 'vb-mapp-level-2',
  title: 'VB-MAPP - Nivel 2',
  category: 'evaluation',
  ageGroup: 'child',
  age_minima: 1.5,
  age_maxima: 2.5,
  min_age: 1.5,
  max_age: 2.5,
  type: 'neurodevelopment',
  domain: 'VB-MAPP, Nivel 2, Marcos, 18 a 30 meses',
  isGlobal: true,
  isLicensed: true,
  sourceLabel: 'VB-MAPP2.pdf',
  versionLabel: 'VB-MAPP Nivel 2 - 18 a 30 meses de idade tipica',
  licenseScope: 'Uso licenciado/restrito informado pela Verto',
  masteryLogic: 'vbmapp_meta_sucessos',
  canonicalMeta: {
    typicalAgeRangeMonths: '18-30',
    taskCount: 60,
    domainCount: 12,
    sourcePages: 24,
    extractionMethod: 'pypdf-text-extraction-manual-structuring',
    completionPercent: 100,
    completionStatus: 'Completo para o PDF VB-MAPP Nivel 2 enviado'
  },
  data: [
    {
      id: 'dom-mando-n2',
      name: 'Mando Nivel 2',
      skills: [
        skill('mando-n2-6', 'M6', 'Pede 20 itens ausentes sem dica', 20, 'O aprendiz pede por 20 itens diferentes ausentes sem dica.', '0,5= pede 10 itens ausentes; 1= pede 20 itens ausentes.', 4, 'Mando Nivel 2'),
        skill('mando-n2-7', 'M7', 'Pede 5 acoes necessarias para uma atividade', 5, 'O aprendiz pede para outra pessoa emitir 5 diferentes acoes necessarias para executar uma atividade.', '0,5= 2 acoes; 1= 5 acoes.', 4, 'Mando Nivel 2'),
        skill('mando-n2-8', 'M8', 'Emite 5 mandos com 2 ou mais palavras', 5, 'O aprendiz emite 5 diferentes mandos contendo 2 ou mais palavras, sem contar apenas "eu quero".', '0,5= 2 mandos; 1= 5 mandos.', 4, 'Mando Nivel 2'),
        skill('mando-n2-9', 'M9', 'Emite espontaneamente 15 mandos diferentes', 15, 'O aprendiz emite espontaneamente 15 mandos diferentes.', '0,5= 10 mandos espontaneos; 1= 15 mandos espontaneos.', 4, 'Mando Nivel 2'),
        skill('mando-n2-10', 'M10', 'Emite 10 mandos novos sem treino especifico', 10, 'O aprendiz emite 10 mandos novos sem que cada mando especifico tenha sido treinado.', '0,5= 6 mandos novos; 1= 10 mandos novos.', 4, 'Mando Nivel 2')
      ]
    },
    {
      id: 'dom-tato-n2',
      name: 'Tato Nivel 2',
      skills: [
        skill('tato-n2-6', 'T6', 'Nomeia 25 itens quando perguntado', 25, 'O aprendiz nomeia 25 itens quando perguntado "O que e isso?".', '0,5= nomeia 20 itens; 1= nomeia 25 itens.', 5, 'Tato Nivel 2'),
        skill('tato-n2-7', 'T7', 'Generaliza tatos para 50 itens', 50, 'O aprendiz generaliza tatos entre 3 exemplares para 50 itens testados ou de lista acumulada.', '0,5= nomeia somente 2 exemplos de cada item; 1= generaliza 3 exemplares para 50 itens.', 5, 'Tato Nivel 2'),
        skill('tato-n2-8', 'T8', 'Tateia 10 acoes', 10, 'O aprendiz tateia 10 acoes quando perguntado o que alguem esta fazendo.', '0,5= 5 acoes; 1= 10 acoes.', 6, 'Tato Nivel 2'),
        skill('tato-n2-9', 'T9', 'Faz 50 tatos de dois componentes', 50, 'O aprendiz faz 50 tatos de 2 componentes, como combinacoes de verbos e substantivos.', '0,5= 25 tatos de 2 componentes; 1= 50 tatos de 2 componentes.', 6, 'Tato Nivel 2'),
        skill('tato-n2-10', 'T10', 'Nomeia 200 substantivos e/ou verbos', 200, 'O aprendiz nomeia um total de 200 substantivos, verbos ou outras partes da linguagem.', '0,5= 150 tatos; 1= 200 tatos.', 6, 'Tato Nivel 2')
      ]
    },
    {
      id: 'dom-ouvinte-n2',
      name: 'Ouvinte Nivel 2',
      skills: [
        skill('ouvinte-n2-6', 'O6', 'Seleciona 40 objetos ou figuras em arranjo de 6', 40, 'O aprendiz seleciona o item correto em um arranjo desordenado de 6 estimulos para 40 objetos ou figuras diferentes.', '0,5= 12 itens; 1= 40 itens.', 7, 'Ouvinte Nivel 2'),
        skill('ouvinte-n2-7', 'O7', 'Generaliza discriminacoes de ouvinte para 50 itens', 50, 'O aprendiz generaliza discriminacoes de ouvinte em arranjo de 8 estimulos para 3 exemplos diferentes de 50 itens.', '0,5= 2 exemplos por item; 1= 3 exemplos por item.', 8, 'Ouvinte Nivel 2'),
        skill('ouvinte-n2-8', 'O8', 'Realiza 10 acoes motoras sob instrucao', 10, 'O aprendiz realiza 10 acoes motoras especificas sob instrucao.', '0,5= 5 acoes; 1= 10 acoes.', 8, 'Ouvinte Nivel 2'),
        skill('ouvinte-n2-9', 'O9', 'Segue 50 instrucoes com 2 componentes', 50, 'O aprendiz segue 50 instrucoes com 2 componentes envolvendo substantivo-verbo e/ou verbo-substantivo.', '0,5= 25 instrucoes; 1= 50 instrucoes.', 9, 'Ouvinte Nivel 2'),
        skill('ouvinte-n2-10', 'O10', 'Seleciona 250 itens nomeados em livro, cena ou ambiente', 250, 'O aprendiz seleciona o item correto em livro, cena ilustrada ou ambiente natural quando nomeado para 250 itens.', '0,5= 150 itens; 1= 250 itens.', 9, 'Ouvinte Nivel 2')
      ]
    },
    {
      id: 'dom-vpmts-n2',
      name: 'Percepcao Visual e Matching-to-Sample Nivel 2',
      skills: [
        skill('vpmts-n2-6', 'VP/MTS6', 'Pareia 25 objetos ou figuras identicas', 25, 'O aprendiz pareia objetos ou figuras identicas em arranjo de 6 para 25 itens.', '0,5= 15 itens; 1= 25 itens.', 10, 'Percepcao Visual Matching-to-Sample Nivel 2'),
        skill('vpmts-n2-7', 'VP/MTS7', 'Pareia 10 cores e formas semelhantes', 10, 'O aprendiz pareia cores e formas semelhantes para 10 diferentes cores e formas apresentadas como modelo.', '0,5= 5 cores/formas; 1= 10 cores/formas.', 10, 'Percepcao Visual Matching-to-Sample Nivel 2'),
        skill('vpmts-n2-8', 'VP/MTS8', 'Pareia 25 itens em arranjo com estimulos similares', 25, 'O aprendiz pareia objetos ou figuras em arranjo desordenado de 8 estimulos contendo 3 estimulos similares para 25 itens.', '0,5= 15 itens; 1= 25 itens.', 10, 'Percepcao Visual Matching-to-Sample Nivel 2'),
        skill('vpmts-n2-9', 'VP/MTS9', 'Pareia 25 objetos ou figuras nao identicos', 25, 'O aprendiz pareia objetos ou figuras nao identicos em arranjo desordenado de 10 estimulos para 25 itens.', '0,5= 15 itens; 1= 25 itens.', 11, 'Percepcao Visual Matching-to-Sample Nivel 2'),
        skill('vpmts-n2-10', 'VP/MTS10', 'Pareia 25 objetos 3D com figuras 2D nao identicas', 25, 'O aprendiz pareia objetos 3D com figuras 2D nao identicas, e/ou vice-versa, em arranjo de 10 estimulos contendo 3 similares para 25 itens.', '0,5= 15 itens; 1= 25 itens.', 11, 'Percepcao Visual Matching-to-Sample Nivel 2')
      ]
    },
    {
      id: 'dom-brincar-independente-n2',
      name: 'Brincar Independente Nivel 2',
      skills: [
        skill('brincar-ind-n2-6', 'BI6', 'Procura brinquedo ausente ou parte de conjunto', 5, 'O aprendiz procura um brinquedo ausente, correspondente ou parte de um conjunto para 5 itens ou conjuntos.', '0,5= 2 cenarios/atividades; 1= 5 cenarios/atividades.', 12, 'Brincar Independente Nivel 2'),
        skill('brincar-ind-n2-7', 'BI7', 'Usa 5 brinquedos conforme suas funcoes', 5, 'O aprendiz demonstra independentemente a utilizacao de brinquedos ou objetos de acordo com suas funcoes para 5 itens.', '0,5= 2 itens; 1= 5 itens.', 12, 'Brincar Independente Nivel 2'),
        skill('brincar-ind-n2-8', 'BI8', 'Brinca criativamente 2 vezes ao dia', 2, 'O aprendiz brinca todos os dias com itens de forma criativa por 2 vezes.', '0,5= 1 vez; 1= 2 vezes.', 12, 'Brincar Independente Nivel 2'),
        skill('brincar-ind-n2-9', 'BI9', 'Brinca em parque infantil por 5 minutos', 5, 'O aprendiz envolve-se independentemente em brincadeiras estruturadas e equipamentos de parque por 5 minutos em observacao de 30 minutos.', '0,5= 2 minutos; 1= 5 minutos.', 12, 'Brincar Independente Nivel 2'),
        skill('brincar-ind-n2-10', 'BI10', 'Monta brinquedos com multiplas partes', 5, 'O aprendiz monta brinquedos com multiplas partes para 5 diferentes conjuntos de materiais.', '0,5= 2 conjuntos; 1= 5 conjuntos.', 12, 'Brincar Independente Nivel 2')
      ]
    },
    {
      id: 'dom-social-n2',
      name: 'Comportamento Social e Brincar Social Nivel 2',
      skills: [
        skill('social-n2-6', 'SB6', 'Inicia interacao fisica com par 2 vezes', 2, 'O aprendiz inicia interacao fisica com um par por 2 vezes em observacao de 30 minutos.', '0,5= 1 vez; 1= 2 vezes.', 13, 'Comportamento Social e Brincar Social Nivel 2'),
        skill('social-n2-7', 'SB7', 'Pede espontaneamente aos pares 5 vezes', 5, 'O aprendiz pede espontaneamente para seus pares por 5 vezes em observacao de 60 minutos.', '0,5= 2 vezes; 1= 5 vezes.', 13, 'Comportamento Social e Brincar Social Nivel 2'),
        skill('social-n2-8', 'SB8', 'Mantem brincadeira social continua', 5, 'O aprendiz envolve-se em brincadeira social continua com pares sem ajuda de adulto ou reforco em observacao de 30 minutos.', '0,5= 2 minutos; 1= 5 minutos.', 13, 'Comportamento Social e Brincar Social Nivel 2'),
        skill('social-n2-9', 'SB9', 'Responde espontaneamente a pedidos dos pares', 5, 'O aprendiz responde espontaneamente aos pedidos dos pares por 5 vezes.', '0,5= 2 respostas; 1= 5 respostas.', 13, 'Comportamento Social e Brincar Social Nivel 2'),
        skill('social-n2-10', 'SB10', 'Pede para participar de jogos ou brincadeiras', 2, 'O aprendiz pede espontaneamente aos pares para participar de jogos, brincadeiras sociais etc. por 2 vezes.', '0,5= 1 vez em uma hora; 1= 2 vezes.', 13, 'Comportamento Social e Brincar Social Nivel 2')
      ]
    },
    {
      id: 'dom-imitacao-motora-n2',
      name: 'Imitacao Motora Nivel 2',
      skills: [
        skill('imitacao-n2-6', 'IM6', 'Imita 10 acoes com objeto especifico', 10, 'O aprendiz imita 10 acoes que requerem selecao de um objeto especifico a partir de um arranjo.', '0,5= 6 acoes; 1= 10 acoes.', 14, 'Imitacao Motora Nivel 2'),
        skill('imitacao-n2-7', 'IM7', 'Imita 20 acoes motoras finas', 20, 'O aprendiz imita 20 acoes motoras finas com a instrucao "Faca igual".', '0,5= 10 acoes; 1= 20 acoes.', 14, 'Imitacao Motora Nivel 2'),
        skill('imitacao-n2-8', 'IM8', 'Imita 10 sequencias de tres componentes', 10, 'O aprendiz imita 10 sequencias de acoes de tres componentes diferentes quando solicitado a fazer igual.', '0,5= sequencias de 2 componentes; 1= 10 sequencias de 3 componentes.', 15, 'Imitacao Motora Nivel 2'),
        skill('imitacao-n2-9', 'IM9', 'Imita espontaneamente 5 atividades funcionais', 5, 'O aprendiz imita espontaneamente 5 atividades funcionais no ambiente natural.', '0,5= 2 habilidades funcionais; 1= 5 habilidades funcionais.', 15, 'Imitacao Motora Nivel 2'),
        skill('imitacao-n2-10', 'IM10', 'Imita novos movimentos modelados por adulto', 7, 'O aprendiz imita ou tenta com aproximacoes qualquer novo movimento motor modelado por adulto, com e sem objetos.', '1= lista novos movimentos motores imitados ou aproximados.', 15, 'Imitacao Motora Nivel 2')
      ]
    },
    {
      id: 'dom-ecoico-n2',
      name: 'Ecoico Nivel 2',
      skills: [
        skill('ecoico-n2-6', 'E6', 'Pontua pelo menos 50 no EESA', 50, 'O aprendiz pontua pelo menos 50 no subteste EESA, incluindo pelo menos 20 pontos do Grupo 2.', '0,5= 40 no EESA com 20 pontos do Grupo 2; 1= 50 ou mais.', 16, 'Ecoico Nivel 2'),
        skill('ecoico-n2-7', 'E7', 'Pontua pelo menos 60 no EESA', 60, 'O aprendiz pontua pelo menos 60 no subteste EESA.', '0,5= 55 no EESA; 1= 60 no EESA.', 16, 'Ecoico Nivel 2'),
        skill('ecoico-n2-8', 'E8', 'Pontua pelo menos 70 no EESA', 70, 'O aprendiz pontua pelo menos 70 no subteste EESA.', '0,5= 65 no EESA; 1= 70 ou mais.', 16, 'Ecoico Nivel 2'),
        skill('ecoico-n2-9', 'E9', 'Pontua pelo menos 80 no EESA', 80, 'O aprendiz pontua pelo menos 80 no subteste EESA.', '0,5= 75 no EESA; 1= 80 no EESA.', 16, 'Ecoico Nivel 2'),
        skill('ecoico-n2-10', 'E10', 'Pontua pelo menos 90 no EESA', 90, 'O aprendiz pontua pelo menos 90 no subteste EESA, incluindo pelo menos 10 pontos dos Grupos 4 e 5.', '0,5= 85 no EESA com criterio dos Grupos 4 e 5; 1= 90 ou mais.', 16, 'Ecoico Nivel 2')
      ]
    },
    {
      id: 'dom-lrffc-n2',
      name: 'LRFFC Nivel 2',
      skills: [
        skill('lrffc-n2-6', 'LRFFC6', 'Seleciona 5 comidas e bebidas por funcao', 5, 'O aprendiz seleciona 5 comidas e bebidas quando apresentadas em arranjo de 5 com outros itens, completando frases como "voce come..." e "voce bebe...".', '0,5= 2 itens; 1= 5 itens.', 17, 'LRFFC Nivel 2'),
        skill('lrffc-n2-7', 'LRFFC7', 'Seleciona 25 itens por sentencas de completar', 25, 'O aprendiz seleciona o item correto em arranjo de 8 itens para 25 sentencas de completar de funcao, caracteristica ou classe.', '0,5= repertorio parcial; 1= 25 sentencas.', 17, 'LRFFC Nivel 2'),
        skill('lrffc-n2-8', 'LRFFC8', 'Responde 25 perguntas de funcao, caracteristica ou classe', 25, 'O aprendiz seleciona o item correto em arranjo de 10 itens ou livro para 25 perguntas do tipo o que, qual ou quem sobre verbos/substantivos.', '0,5= 15 perguntas; 1= 25 perguntas.', 18, 'LRFFC Nivel 2'),
        skill('lrffc-n2-9', 'LRFFC9', 'Seleciona 25 itens por 3 sentencas verbais', 25, 'O aprendiz seleciona um item dadas 3 diferentes sentencas verbais sobre cada item, apresentadas separadamente, para 25 itens.', '0,5= repertorio parcial; 1= 25 itens com 3 sentencas.', 19, 'LRFFC Nivel 2'),
        skill('lrffc-n2-10', 'LRFFC10', 'Nomeia espontaneamente em 50% das tentativas LRFFC', 50, 'O aprendiz nomeia espontaneamente o item em 50% das tentativas de repertorio de ouvinte por funcao, caracteristica ou classe.', '0,5= 25% das tentativas ou tateia em 50% com condicoes; 1= 50% das tentativas.', 20, 'LRFFC Nivel 2')
      ]
    },
    {
      id: 'dom-intraverbal-n2',
      name: 'Intraverbal Nivel 2',
      skills: [
        skill('intraverbal-n2-6', 'IV6', 'Completa 10 lacunas em frases', 10, 'O aprendiz completa 10 diferentes lacunas em frases de qualquer natureza.', '0,5= 5 lacunas; 1= 10 lacunas.', 21, 'Intraverbal Nivel 2'),
        skill('intraverbal-n2-7', 'IV7', 'Diz o proprio nome quando perguntado', 1, 'O aprendiz diz seu nome quando perguntado qual e o seu nome.', '1= sim; 0= nao.', 21, 'Intraverbal Nivel 2'),
        skill('intraverbal-n2-8', 'IV8', 'Completa 25 sentencas', 25, 'O aprendiz completa 25 diferentes sentencas.', '0,5= 13 sentencas; 1= 25 sentencas.', 21, 'Intraverbal Nivel 2'),
        skill('intraverbal-n2-9', 'IV9', 'Responde 25 perguntas com o que', 25, 'O aprendiz responde a 25 diferentes perguntas com "o que".', '0,5= 13 perguntas; 1= 25 perguntas.', 22, 'Intraverbal Nivel 2'),
        skill('intraverbal-n2-10', 'IV10', 'Responde 25 perguntas com quem ou onde', 25, 'O aprendiz responde a 25 diferentes perguntas com "quem" ou "onde".', '0,5= 13 perguntas; 1= 25 perguntas.', 22, 'Intraverbal Nivel 2')
      ]
    },
    {
      id: 'dom-grupo-n2',
      name: 'Grupo Nivel 2',
      skills: [
        skill('grupo-n2-6', 'G6', 'Senta-se a mesa com grupo por 3 minutos', 3, 'O aprendiz senta-se a mesa com o grupo para lanchar e almocar sem comportamentos socialmente inadequados por 3 minutos.', '0,5= 1 minuto; 1= 3 minutos.', 23, 'Grupo Nivel 2'),
        skill('grupo-n2-7', 'G7', 'Organiza itens pessoais e vai a mesa', 1, 'O aprendiz guarda e organiza seus itens pessoais e dirige-se ate uma mesa com apenas uma instrucao verbal.', '0,5= requer duas instrucoes verbais; 1= como apresentado.', 23, 'Grupo Nivel 2'),
        skill('grupo-n2-8', 'G8', 'Faz transicoes com uma instrucao', 1, 'O aprendiz faz transicoes entre atividades da sala com somente uma instrucao gestual ou verbal.', '0,5= requer duas ou mais instrucoes verbais; 1= como apresentado.', 23, 'Grupo Nivel 2'),
        skill('grupo-n2-9', 'G9', 'Senta-se com grupo pequeno por 5 minutos', 5, 'O aprendiz senta-se com grupo pequeno por 5 minutos sem comportamentos disruptivos e sem tentar sair do grupo.', '0,5= 2 minutos; 1= 5 minutos.', 23, 'Grupo Nivel 2'),
        skill('grupo-n2-10', 'G10', 'Senta-se com grupo por 10 minutos e responde SDs', 5, 'O aprendiz senta-se com grupo pequeno por 10 minutos, atenta-se ao professor/material em 50% do periodo e responde a 5 SDs.', '0,5= atencao em 33% e responde a 2 questoes/instrucoes; 1= criterio completo.', 23, 'Grupo Nivel 2')
      ]
    },
    {
      id: 'dom-linguistica-n2',
      name: 'Estrutura Linguistica Nivel 2',
      skills: [
        skill('linguistica-n2-6', 'EL6', 'Articulacao compreensivel de 10 tatos', 10, 'A articulacao de 10 tatos emitidos pela crianca pode ser entendida por adultos familiares que nao veem o item nomeado.', '0,5= 5 tatos compreensiveis; 1= 10 tatos compreensiveis.', 24, 'Estrutura Linguistica Nivel 2'),
        skill('linguistica-n2-7', 'EL7', 'Vocabulario de ouvinte de 100 palavras', 100, 'O aprendiz apresenta vocabulario de ouvinte de 100 palavras.', '0,5= 50 palavras; 1= 100 palavras.', 24, 'Estrutura Linguistica Nivel 2'),
        skill('linguistica-n2-8', 'EL8', 'Emite 10 enunciados de 2 palavras por dia', 10, 'O aprendiz emite 10 diferentes enunciados de 2 palavras por dia, exceto ecoico.', '0,5= 5 enunciados; 1= 10 enunciados.', 24, 'Estrutura Linguistica Nivel 2'),
        skill('linguistica-n2-9', 'EL9', 'Emite prosodia funcional em 5 ocasioes', 5, 'O aprendiz emite prosodia funcional, como ritmo, enfase e entonacao, em 5 ocasioes em um dia.', '0,5= 2 ocasioes; 1= 5 ocasioes.', 24, 'Estrutura Linguistica Nivel 2'),
        skill('linguistica-n2-10', 'EL10', 'Tem vocabulario total de 300 palavras', 300, 'O aprendiz tem vocabulario total de 300 palavras em operantes diversos, exceto ecoico.', '0,5= 200 palavras; 1= 300 palavras.', 24, 'Estrutura Linguistica Nivel 2')
      ]
    }
  ]
};

export const VBMAPP_LEVEL_2_CANONICAL_PROTOCOL = VBMAPP_LEVEL_2_PROTOCOL;
