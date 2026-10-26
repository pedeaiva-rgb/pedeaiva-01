import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM, TERMS_PATH } from "@/lib/legal";
import { ContactLine, LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade">
      <p>
        O {PLATFORM.name} é um sistema que restaurantes, lanchonetes, pizzarias, hamburguerias e outros negócios de comida e delivery usam para receber pedidos pela internet, no balcão e nas mesas, e para organizar a cozinha, as
        entregas e o caixa. Esta política explica, de forma simples, quais dados pessoais passam pelo sistema, para que são usados e quais são os seus direitos,
        conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, a LGPD).
      </p>

      <h2>1. Quem cuida dos seus dados</h2>
      <ul>
        <li>
          <b>Quando você faz um pedido</b> numa loja, quem decide como os seus dados são usados é a <b>loja</b> (ela é a controladora). O {PLATFORM.name}{" "}
          guarda e processa esses dados em nome dela, como operador.
        </li>
        <li>
          <b>Quando você tem uma conta no painel</b> (dono, gerente ou equipe da loja), o {PLATFORM.name} é o controlador dos dados da sua conta.
        </li>
      </ul>

      <h2>2. Quais dados usamos</h2>
      <p>
        <b>De quem faz pedidos:</b>
      </p>
      <ul>
        <li>nome e telefone (WhatsApp), para a loja confirmar e acompanhar o pedido;</li>
        <li>endereço de entrega e, se você permitir, a localização marcada no celular, para o entregador chegar ao lugar certo;</li>
        <li>itens do pedido, observações, cupom usado e forma de pagamento escolhida;</li>
        <li>nas mesas, o nome que você informar no pedido pelo QR Code (é opcional).</li>
      </ul>
      <p>
        <b>Da equipe das lojas:</b> e-mail e senha de acesso, nome, função na loja e PIN pessoal (guardado de forma cifrada, ninguém consegue ler). Para entregadores,
        quando a loja usar o acompanhamento de entregas, também o telefone e a localização durante o turno.
      </p>
      <p>
        <b>Dados técnicos:</b> registros de acesso (como endereço IP e data e hora), necessários para a segurança do sistema.
      </p>
      <p>
        <b>Não guardamos dados de cartão.</b> Quando a loja aceita pagamento online, ele é feito diretamente com o provedor de pagamentos (por exemplo, o Mercado
        Pago), que segue regras próprias de segurança.
      </p>

      <h2>3. Para que usamos</h2>
      <ul>
        <li>receber, preparar, entregar e cobrar o seu pedido (execução do contrato com a loja);</li>
        <li>avisar sobre o andamento do pedido;</li>
        <li>evitar fraudes e pedidos falsos e manter o sistema seguro (legítimo interesse);</li>
        <li>cumprir obrigações legais, como as fiscais e as de defesa do consumidor;</li>
        <li>
          enviar ofertas da loja, como cupons, somente quando a loja tiver uma base legal para isso, e você sempre pode pedir para não receber mais.
        </li>
      </ul>
      <p>Não vendemos dados pessoais e não os usamos para propaganda de terceiros.</p>

      <h2>4. Com quem os dados são compartilhados</h2>
      <ul>
        <li>com a <b>loja</b> onde você fez o pedido e com a equipe dela, cada função vendo só o que precisa (a cozinha, por exemplo, não vê telefone nem endereço);</li>
        <li>com o <b>entregador</b> do seu pedido: nome, telefone e endereço da entrega;</li>
        <li>
          com os <b>serviços que mantêm o sistema no ar</b>, como hospedagem e banco de dados (por exemplo, Vercel e Supabase), e com o provedor de pagamentos,
          quando usado. Esses serviços podem guardar dados em servidores fora do Brasil, com as garantias previstas na LGPD;
        </li>
        <li>com autoridades, quando a lei exigir.</li>
      </ul>

      <h2>5. Por quanto tempo guardamos</h2>
      <p>
        Pelo tempo necessário para as finalidades acima e para cumprir prazos legais (por exemplo, fiscais e de defesa do consumidor). Depois disso, os dados são
        apagados ou anonimizados. Os dados de uma conta do painel são apagados quando a conta é encerrada, salvo o que a lei obriga a manter.
      </p>

      <h2>6. Seus direitos</h2>
      <p>Pela LGPD, você pode pedir, a qualquer momento:</p>
      <ul>
        <li>confirmação de que tratamos seus dados e acesso a eles;</li>
        <li>correção de dados incompletos ou errados;</li>
        <li>anonimização, bloqueio ou eliminação de dados desnecessários;</li>
        <li>portabilidade e informação sobre com quem os dados foram compartilhados;</li>
        <li>revogação do consentimento, quando ele for a base do uso.</li>
      </ul>
      <p>
        Para dados de um pedido, fale com a <b>loja</b> onde você pediu (o telefone dela aparece na loja). Também é possível falar com o {PLATFORM.name} pelo
        painel da loja
        <ContactLine />.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Usamos conexão protegida (HTTPS), controle de acesso por função, separação entre os dados de cada loja, senhas e PINs guardados de forma cifrada e
        credenciais de pagamento criptografadas. Nenhum sistema é 100% imune, e se ocorrer um incidente relevante, os envolvidos e a autoridade serão avisados como a
        lei determina.
      </p>

      <h2>8. Navegador e cookies</h2>
      <p>
        Usamos apenas o que é necessário para o sistema funcionar: manter você conectado ao painel, lembrar a loja escolhida e guardar a sacola e o último pedido no
        seu próprio navegador. Não usamos cookies de propaganda.
      </p>

      <h2>9. Crianças</h2>
      <p>O sistema não é voltado a menores de 18 anos fazerem pedidos sem acompanhamento de um responsável.</p>

      <h2>10. Mudanças nesta política</h2>
      <p>
        Esta política pode ser atualizada. A data no topo mostra a última versão. Veja também os <Link href={TERMS_PATH} className="font-bold underline">Termos de uso</Link>.
      </p>
    </LegalPage>
  );
}
