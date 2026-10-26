import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM, PRIVACY_PATH } from "@/lib/legal";
import { ContactLine, LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Termos de uso" };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso">
      <p>
        Estes termos valem para quem usa o {PLATFORM.name}: clientes que fazem pedidos nas lojas e as lojas (com suas equipes) que usam o painel. Ao usar o sistema,
        você concorda com eles e com a <Link href={PRIVACY_PATH} className="font-bold underline">Política de privacidade</Link>.
      </p>

      <h2>1. O que é o {PLATFORM.name}</h2>
      <p>
        É uma ferramenta que restaurantes, lanchonetes, pizzarias, hamburguerias e outros negócios de comida e delivery usam para mostrar o cardápio, receber pedidos (pela loja online, no balcão, por telefone e nas mesas) e organizar a
        cozinha, as entregas e o caixa. O {PLATFORM.name} não vende, não prepara e não entrega os produtos: quem faz isso é a loja.
      </p>

      <h2>2. Para quem faz pedidos</h2>
      <ul>
        <li>
          O pedido é feito <b>com a loja</b>. Preços, cardápio, taxa de entrega, horário de funcionamento, prazos, qualidade dos produtos, trocas e cancelamentos
          são de responsabilidade dela, conforme o Código de Defesa do Consumidor.
        </li>
        <li>Os valores mostrados são calculados com o cardápio da loja no momento do pedido.</li>
        <li>Informe dados corretos (nome, telefone e endereço). Pedidos falsos ou de brincadeira podem ser recusados e bloqueados.</li>
        <li>
          Pagamento na entrega ou na retirada é combinado com a loja. Quando a loja aceitar pagamento online, o pedido só é enviado a ela depois que o pagamento for
          confirmado, e devoluções seguem a política da loja.
        </li>
        <li>Nas mesas, a conta é fechada e paga com a equipe da loja. A taxa de serviço, quando cobrada, é opcional.</li>
      </ul>

      <h2>3. Para as lojas e suas equipes</h2>
      <ul>
        <li>
          A loja é responsável pelas informações que publica (cardápio, preços, horários, fotos e promoções), pelo atendimento aos clientes e por cumprir as leis do
          seu negócio, inclusive as fiscais e a LGPD em relação aos dados dos seus clientes.
        </li>
        <li>
          Cada pessoa da equipe deve usar o próprio acesso e o próprio PIN. Não compartilhe senhas. O dono responde pelas permissões que dá à equipe e pelas ações
          feitas na conta da loja.
        </li>
        <li>
          É proibido usar o sistema para atividades ilegais, enviar mensagens indesejadas em massa, tentar acessar dados de outras lojas ou atrapalhar o funcionamento do
          sistema.
        </li>
        <li>
          Os dados da loja são da loja. Quando o recurso estiver disponível, a loja pode exportá-los, e ao encerrar a conta os dados serão apagados conforme a{" "}
          <Link href={PRIVACY_PATH} className="font-bold underline">Política de privacidade</Link>.
        </li>
      </ul>

      <h2>4. Disponibilidade</h2>
      <p>
        Trabalhamos para manter o sistema sempre funcionando, mas podem ocorrer pausas para manutenção ou falhas de serviços de terceiros (internet, hospedagem,
        provedores de pagamento e de mensagens). Quando possível, avisaremos com antecedência.
      </p>

      <h2>5. Responsabilidades</h2>
      <p>
        O {PLATFORM.name} responde pelo funcionamento da ferramenta, dentro do que a lei permite. Não responde pela relação de consumo entre o cliente e a loja
        (produto, preço, entrega e atendimento), nem por prejuízos causados pelo uso indevido das contas por quem tem acesso a elas.
      </p>

      <h2>6. Mudanças e contato</h2>
      <p>
        Estes termos podem ser atualizados, e a data no topo mostra a última versão. Dúvidas podem ser enviadas pelo painel da loja
        <ContactLine />. Estes termos seguem as leis brasileiras.
      </p>
    </LegalPage>
  );
}
