
export const AFLS_COMMUNITY_PROTOCOL = {
  id: 'afls-community-global',
  title: "AFLS - Participação Social",
  category: 'evaluation',
  ageGroup: 'all',
  type: 'neurodevelopment',
  domain: 'AFLS, Autonomia, Vida Diária',
  isGlobal: true,
  data: [
    {
      id: 'dom-mb',
      name: 'Mobilidade Básica',
      skills: [
        {
          id: 'mb1',
          code: 'MB1',
          name: 'Olha por onde anda',
          maxScore: 4,
          objective: 'O aprendiz observa por onde anda e evita obstáculos',
          question: 'O aprendiz olha por onde anda?',
          example: 'Poças, lombadas, desníveis na estrada, calçadas irregulares, outras pessoas, etc.',
          criteria: '4= geralmente observa e evita todos os obstáculos e pessoas, 3= geralmente observa e evita todos os obstáculos no chão, 2= geralmente observa por onde anda e evita os principais obstáculos, 1= às vezes precisa de estímulos verbais para evitar os principais obstáculos',
          comment: ''
        },
        {
          id: 'mb2',
          code: 'MB2',
          name: 'Meio-fio e degraus',
          maxScore: 4,
          objective: 'O aprendiz irá subir e descer do meio-fio e de degraus',
          question: 'O aprendiz sobe e desce do meio-fio?',
          example: '',
          criteria: '4= sobe e desce degraus sem segurar no corrimão com um pé por degrau, 3= sobe e desce degraus sem segurar no corrimão mas com ambos os pés em cada degrau, 2= sobe e desce degraus segurando no corrimão, 1= sobe e desce do meio-fio',
          comment: ''
        },
        {
          id: 'mb3',
          code: 'MB3',
          name: 'Caminha com a postura, a cadência e a velocidade apropriadas',
          maxScore: 2,
          objective: 'O aprendiz irá caminhar com a postura, a cadência e a velocidade apropriadas para a situação',
          question: 'O aprendiz caminha com a postura, a cadência e a velocidade apropriadas?',
          example: 'Muda o ritmo quando for necessário ficar com os outros e não anda na ponta dos pés ou galopando ou de outra maneira considerada estranha',
          criteria: '2= anda na cadência, postura e velocidade apropriadas para a situação, 1= anda no ritmo adequado para a situação mas requer estímulos verbais para caminhar na cadência e na postura apropriadas',
          comment: ''
        },
        {
          id: 'mb4',
          code: 'MB4',
          name: 'Atitudes apropriadas enquanto caminha',
          maxScore: 2,
          objective: 'O aprendiz irá geralmente caminhar sem apresentar comportamentos incomuns ou inapropriados',
          question: 'O aprendiz apresenta atitudes apropriadas enquanto caminha?',
          example: 'Não fala sozinho, canta alto, se joga no chão, faz caretas incomuns para os outros ou os toca, etc.',
          criteria: '2= geralmente anda sem apresentar comportamentos incomuns, 1= anda de forma apropriada somente mediante estímulos verbais',
          comment: ''
        },
        {
          id: 'mb5',
          code: 'MB5',
          name: 'Fica ao lado do cuidador',
          maxScore: 4,
          objective: 'O aprendiz geralmente irá caminhar na calçada ao lado do cuidador e começa e para de se mover junto com ele, sem que precise estar de mãos dadas',
          question: 'O aprendiz caminha ao lado do cuidador na calçada?',
          example: '',
          criteria: '4= fica à distância de um braço enquanto atravessa ruas, 3= fica à distância de um braço em estacionamentos ou áreas abertas, 2= fica à distância de um braço na calçada ou no caminho, 1= fica à distância de um braço na calçada ou no caminho somente mediante estímulos verbais',
          comment: 'Está tudo bem ficar um pouco distante, desde que sob supervisão'
        }
      ]
    },
    {
      id: 'dom-ck',
      name: 'Conhecimento Comunitário',
      skills: [
        {
          id: 'ck1',
          code: 'CK1',
          name: 'Identifica placas de segurança e comunitárias',
          maxScore: 4,
          objective: 'O aprendiz irá identificar pelo menos 10 placas de segurança',
          question: 'O aprendiz escolhe a placa de segurança correta quando alguém a nomeia?',
          example: 'Saída, bebedouro, hospital, perigo, mantenha distância, extintor, etc.',
          criteria: '4= identifica pelo menos 10 placas de segurança, 3= identifica pelo menos 7 placas de segurança, 2= identifica pelo menos 5 placas de segurança, 1= identifica pelo menos 2 placas de segurança',
          comment: ''
        },
        {
          id: 'ck3',
          code: 'CK3',
          name: 'Identifica as autoridades comunitárias',
          maxScore: 4,
          objective: 'O aprendiz irá identificar pelo menos 6 autoridades comunitárias',
          question: 'O aprendiz consegue escolher a foto correta de uma autoridade comunitária quando alguém a nomeia?',
          example: 'Policial, bombeiro, médico, enfermeira, guarda, etc.',
          criteria: '4= identifica pelo menos 6 autoridades comunitárias, 3= identifica pelo menos 5 autoridades comunitárias, 2= identifica pelo menos 4 autoridades comunitárias, 1= identifica pelo menos 2 autoridades comunitárias',
          comment: ''
        }
      ]
    },
    {
      id: 'dom-sh',
      name: 'Compras',
      skills: [
        {
          id: 'sh1',
          code: 'SH1',
          name: 'Pede dinheiro ao cuidador para comprar algo',
          maxScore: 2,
          objective: 'O aprendiz irá pedir dinheiro ao cuidador para comprar algo ou pede a ele que o compre',
          question: 'O aprendiz pede dinheiro ao cuidador para comprar algo?',
          example: 'Quando o aprendiz quer um item que deve ser comprado, pede dinheiro ao cuidador para comprar algo ou pede a ele que o compre',
          criteria: '2= pede dinheiro ao cuidador para comprar algo ou pede a ele que o compre, 1= pede dinheiro para fazer a compra somente quando recebe estímulos verbais',
          comment: ''
        }
      ]
    },
    {
      id: 'dom-mo',
      name: 'Dinheiro',
      skills: [
        {
          id: 'mo1',
          code: 'MO1',
          name: 'Classifica o dinheiro',
          maxScore: 4,
          objective: 'O aprendiz irá classificar vários tipos de cédulas e moedas em grupos, sem que haja exemplos',
          question: 'O aprendiz consegue classificar o dinheiro?',
          example: '',
          criteria: '4= classifica vários tipos de cédulas e moedas em grupos, sem que haja exemplos, 3= vários tipos de cédulas e moedas em grupos, desde que haja exemplos, 2= classifica o dinheiro em grupos de “moedas” e “cédulas” sem exemplos, 1= classifica o dinheiro em grupos de “moedas” e “cédulas” com exemplos',
          comment: ''
        }
      ]
    }
  ]
};
