// Versioned commercial term approved by the product owner on 2026-11-02.
// Legal enforceability remains subject to applicable law. The PDF/exported
// acceptance proof must be grounded in this frozen offer snapshot, not a live edit.
export const LOYALTY_TERMS_VERSION = '1.0' as const;

export type LoyaltyTermsFields = {
  vertoLegalName: string;
  vertoCnpj: string;
  vertoAddress: string;
  clinicLegalName: string;
  clinicCnpj: string;
  clinicAddress: string;
  representativeLabel: string;
  subscriptionId: string;
  referenceMonthlyAmount: string;
  benefitDescription: string;
  benefitValue: string;
  benefitConditions: string;
  startDate: string;
  endDate: string;
};

const TEMPLATE = `VERTO — TERMO ADITIVO DE PERMANÊNCIA E FIDELIDADE CONTRATUAL

**Versão:** 1.0
**Prazo de fidelidade:** 12 meses
**Modalidade:** Aceite eletrônico

### 1. PARTES

**CONTRATADA:** VERTO, pessoa jurídica identificada por sua razão social, CNPJ e endereço no quadro de contratação.

**CONTRATANTE:** Clínica ou pessoa jurídica identificada no quadro de contratação, representada por pessoa com poderes para assumir obrigações contratuais em seu nome.

Este termo complementa o contrato principal de prestação de serviços de software da Verto, sem substituir suas disposições que não forem expressamente alteradas.

### 2. OBJETO

2.1. O presente termo estabelece condições de permanência contratual pelo período de 12 (doze) meses, relativas à utilização da plataforma Verto.

2.2. A adesão é voluntária e depende de aceite eletrônico expresso, após disponibilização integral do documento e apresentação das condições comerciais específicas.

2.3. Para clientes já assinantes, o presente termo não altera retroativamente a contratação anterior nem reinicia a assinatura ou a cobrança mensal existente.

### 3. PRAZO DE FIDELIDADE

3.1. O período de fidelidade terá duração de 12 (doze) meses, contados da data de início da vigência informada no quadro-resumo e expressamente aceita pela CONTRATANTE.

3.2. O prazo não será contado retroativamente à contratação original da plataforma.

3.3. Encerrado o período de fidelidade, a assinatura poderá continuar conforme o contrato principal, sem nova permanência mínima automática.

3.4. Uma nova fidelização dependerá de outro aceite expresso.

### 4. CONTRAPARTIDA COMERCIAL

4.1. A permanência mínima estará associada a um benefício comercial efetivo, individualizado e previamente informado à CONTRATANTE.

**Benefício concedido:** {{benefitDescription}}

**Valor econômico ou critério de apuração:** {{benefitValue}}

**Condições de concessão:** {{benefitConditions}}

4.2. A Verto deverá manter registro das condições oferecidas e aceitas.

4.3. Na ausência de contrapartida válida e demonstrável, não será exigida multa de fidelidade.

### 5. MENSALIDADES E CONDIÇÕES DE PAGAMENTO

5.1. A CONTRATANTE continuará responsável pelas mensalidades e demais cobranças regularmente previstas em sua assinatura.

5.2. Para clientes existentes, valores, periodicidade de cobrança, módulos e demais condições permanecem inalterados, salvo modificação expressamente acordada em instrumento próprio.

5.3. O quadro-resumo identificará o valor mensal de referência utilizado exclusivamente para o cálculo da eventual multa de fidelidade.

5.4. Valores variáveis ou novas contratações não serão incorporados automaticamente à base da multa, sem acordo específico.

### 6. RESCISÃO ANTECIPADA E MULTA PROPORCIONAL

6.1. A CONTRATANTE poderá solicitar o encerramento da assinatura a qualquer momento, observadas as condições contratuais e a legislação aplicável.

6.2. Caso a CONTRATANTE encerre voluntariamente o contrato antes de completar os 12 meses, sem hipótese legal ou contratual de dispensa, poderá ser aplicada multa compensatória proporcional ao período restante.

6.3. A multa terá como teto inicial o equivalente a 2 (duas) mensalidades de referência, reduzido proporcionalmente ao tempo restante da fidelidade.

**Fórmula proposta:**

Multa = (2 × mensalidade de referência) × (dias restantes de fidelidade ÷ dias totais do período de fidelidade).

6.4. A multa não poderá exceder os limites legais aplicáveis e ficará sujeita à avaliação da proporcionalidade diante do benefício efetivamente concedido e da parcela contratual cumprida.

6.5. Não serão cobradas, como multa, todas as mensalidades futuras do período restante.

6.6. Mensalidades já vencidas e legitimamente devidas serão apuradas separadamente, sem duplicidade de cobrança.

### 7. HIPÓTESES DE DISPENSA DA MULTA

A multa de fidelidade não será exigida nas seguintes situações, sem prejuízo de outras hipóteses legais:

a) Encerramento após o cumprimento integral dos 12 meses;

b) Descumprimento contratual relevante imputável à Verto, não sanado quando cabível;

c) Falha grave ou persistente dos serviços que justifique legalmente a rescisão;

d) Exercício válido de direito legal de arrependimento, quando aplicável;

e) Rescisão por acordo formal entre as partes com dispensa da penalidade;

f) Ausência ou impossibilidade de comprovação da contrapartida prevista na cláusula 4.

### 8. PROCEDIMENTO DE CANCELAMENTO

8.1. A solicitação de cancelamento deverá ser recebida e registrada pelos canais disponibilizados pela Verto.

8.2. Havendo possibilidade de multa, a Verto apresentará previamente sua memória de cálculo, contendo a mensalidade de referência, a data de início, a data final e o prazo restante.

8.3. A existência de fidelidade não impede o recebimento de solicitação de cancelamento.

8.4. A eventual multa será tratada separadamente da cobrança recorrente e não autoriza, por si só, cobranças automáticas sem base contratual válida.

### 9. ACEITE ELETRÔNICO

9.1. A CONTRATANTE poderá aderir a este termo mediante seleção voluntária de uma caixa de aceite desmarcada por padrão e confirmação da operação.

9.2. O aceite somente poderá ser realizado por representante com poderes de contratação em nome da clínica.

9.3. Para comprovar o aceite, a Verto poderá registrar, conforme critérios de segurança e proteção de dados: identificador da clínica, identificação do representante autenticado, data e horário, versão e integridade do termo, condições comerciais aceitas e evidência técnica necessária da operação.

9.4. Uma cópia do termo e do comprovante de aceite deverá permanecer acessível à CONTRATANTE.

9.5. Eventuais alterações materiais posteriores dependerão de novo aceite.

### 10. PROTEÇÃO DE DADOS E CONTINUIDADE

10.1. A execução deste termo não altera as permissões de acesso a dados clínicos nem as responsabilidades de proteção de dados previstas no contrato principal.

10.2. A Verto tratará somente os dados necessários à formalização, execução, segurança e comprovação do contrato, observada a legislação de proteção de dados.

10.3. A fidelidade não modifica automaticamente as regras de suspensão por inadimplência, cancelamento técnico, exportação ou retenção de dados previstas no contrato principal e na legislação aplicável.

### 11. DISPOSIÇÕES GERAIS

11.1. Permanecem válidas as demais disposições do contrato principal que não contrariem este termo ou a legislação aplicável.

11.2. A interpretação e a execução do instrumento observarão a boa-fé, o equilíbrio contratual e a proporcionalidade.

11.3. Nenhuma cláusula implica renúncia a direitos legalmente indisponíveis.

11.4. A identificação das partes, a contrapartida concedida, a mensalidade de referência, as datas de vigência e as condições específicas deverão constar do quadro-resumo integrante do documento.

---

**QUADRO-RESUMO DO ACEITE**

- Contratada: {{vertoLegalName}}, CNPJ {{vertoCnpj}}, endereço {{vertoAddress}}
- Clínica contratante: {{clinicLegalName}}, CNPJ {{clinicCnpj}}, endereço {{clinicAddress}}
- Representante autorizado: {{representativeLabel}}
- Assinatura de referência: {{subscriptionId}}
- Mensalidade de referência: {{referenceMonthlyAmount}}
- Benefício concedido: {{benefitDescription}} — {{benefitValue}}. {{benefitConditions}}
- Prazo de fidelidade: 12 meses
- Início da vigência: {{startDate}}
- Término da fidelidade: {{endDate}}
- Multa máxima inicial proposta: 2 mensalidades, proporcional ao prazo restante
- Versão do termo: 1.0

**DECLARAÇÃO DE ACEITE**

Declaro que tive acesso ao Termo Aditivo de Permanência e Fidelidade da Verto, li e compreendi suas condições, especialmente o prazo de 12 meses, o benefício comercial concedido e as regras de multa proporcional por rescisão antecipada. Declaro possuir poderes para representar a clínica contratante e concordo expressamente com os termos apresentados.`;

export function renderLoyaltyTermsV1(fields: LoyaltyTermsFields): string {
  const keys = Object.keys(fields) as Array<keyof LoyaltyTermsFields>;
  let text = TEMPLATE;
  for (const key of keys) {
    const value = String(fields[key] || '').trim();
    if (!value || value.includes('{{') || value.includes('}}')) {
      throw new Error('LOYALTY_TERMS_INCOMPLETE');
    }
    text = text.split('{{' + key + '}}').join(value);
  }
  if (/\{\{[a-zA-Z]+\}\}/.test(text)) throw new Error('LOYALTY_TERMS_INCOMPLETE');
  return text;
}
