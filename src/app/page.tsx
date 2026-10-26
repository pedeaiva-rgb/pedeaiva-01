import Link from "next/link";
import { ArrowRight, Bell, Bike, ChefHat, Layers, Link2, Monitor, QrCode, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { PavLogo, PavSymbol } from "@/components/brand/logo";

const FEATURES = [
  { icon: Link2, title: "Loja com link próprio", text: "Seu cardápio num link só seu (…/sua-loja), pronto para o WhatsApp e o Instagram." },
  { icon: Layers, title: "Monte do jeito do cliente", text: "Tamanhos, meio a meio, sabores e adicionais, com o preço calculado sozinho. Serve para pizza, lanche, açaí e marmita." },
  { icon: Monitor, title: "PDV no mesmo lugar", text: "Pedidos de balcão, telefone e WhatsApp entram na mesma fila dos pedidos online." },
  { icon: QrCode, title: "Mesas com QR Code", text: "O cliente pede pela mesa, chama o garçom e pede a conta. A equipe divide a conta e fecha com taxa de serviço." },
  { icon: ChefHat, title: "Tela da cozinha", text: "Pedidos chegam na TV ou no tablet da cozinha, sem preço nem telefone, e avançam com um toque." },
  { icon: Bell, title: "Pedidos em tempo real", text: "Chegou pedido, toca o aviso. Confirme, prepare e despache sem perder nada." },
  { icon: Smartphone, title: "Cliente acompanha", text: "Cada pedido tem um link para o cliente ver a situação, sem precisar ligar." },
  { icon: Wallet, title: "Caixa e equipe", text: "Caixa do dia com fechamento às cegas, acerto de entregadores e PIN do gerente para cancelar e estornar." },
  { icon: ShieldCheck, title: "Seguro por padrão", text: "Preço conferido no servidor, pedido nunca duplica e cada loja só vê os próprios dados." },
];

const STEPS = [
  ["Crie sua loja", "Cadastre-se, diga o tipo do seu negócio e escolha o endereço da loja. Ela já nasce com categorias de exemplo."],
  ["Monte o cardápio", "Cadastre produtos, preços, tamanhos e adicionais, ou cole o cardápio que você já tem e a IA organiza."],
  ["Divulgue o link", "Mande o link para seus clientes e acompanhe os pedidos pelo painel, pelo PDV e pelas mesas."],
];

/** Quem usa: o sistema serve para qualquer negócio de comida e delivery. */
const SEGMENTS = ["Pizzarias", "Hamburguerias", "Lanchonetes", "Açaí e sorvetes", "Restaurantes", "Marmitarias", "Comida japonesa", "Docerias"];

export default function Home() {
  return (
    <div className="overflow-x-clip bg-paper">
      <header className="sticky top-0 z-40 border-b border-charcoal/10 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" aria-label="Pede aí, vá — início">
            <PavLogo />
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-semibold md:flex">
            <a href="#recursos" className="hover:underline">
              Recursos
            </a>
            <a href="#como-funciona" className="hover:underline">
              Como funciona
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/entrar" className="btn-ghost !px-4 !py-2">
              Entrar
            </Link>
            <Link href="/cadastro" className="btn hidden !px-4 !py-2 sm:inline-flex">
              Criar minha loja
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 md:grid-cols-[1.1fr_1fr] md:py-20">
          <div>
            <p className="eyebrow">Sistema para delivery, restaurantes e lanchonetes</p>
            <h1 className="mt-3 text-5xl leading-[0.95] font-extrabold md:text-7xl">
              Pediu aí, <span className="text-tomato">já vai.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted">
              Cardápio online, pedidos, mesas e balcão do seu negócio em um só lugar. O cliente monta o pedido pelo celular e ele cai direto na sua tela, sem comissão por pedido.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/cadastro" className="btn !px-6 !py-3.5 text-base">
                Criar minha loja grátis <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#como-funciona" className="btn-ghost !px-6 !py-3.5 text-base">
                Ver como funciona
              </a>
            </div>
          </div>
          <HeroMock />
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-12">
          <p className="text-sm font-bold text-muted">Feito para</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {SEGMENTS.map((x) => (
              <li key={x} className="rounded-full border border-charcoal/15 bg-surface px-3.5 py-1.5 text-sm font-semibold">
                {x}
              </li>
            ))}
          </ul>
        </section>

        <section id="recursos" className="scroll-mt-20 bg-cream py-16">
          <div className="mx-auto max-w-6xl px-5">
            <p className="eyebrow">Recursos</p>
            <h2 className="mt-2 max-w-2xl text-4xl font-extrabold">Do pedido no celular até a entrega na porta do cliente.</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="card p-6">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-charcoal text-dende">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-lg font-extrabold">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16">
          <p className="eyebrow">Como funciona</p>
          <h2 className="mt-2 text-4xl font-extrabold">Sua loja no ar em três passos.</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="rounded-[1.5rem] border border-charcoal/10 p-6">
                <span className="font-brand text-5xl font-extrabold text-tomato">{i + 1}</span>
                <h3 className="mt-2 text-xl font-extrabold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-5 pb-16">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 rounded-[2rem] bg-charcoal p-8 text-cream md:flex-row md:items-center md:p-12">
            <div>
              <h2 className="text-3xl font-extrabold md:text-4xl">Bora colocar sua loja online?</h2>
              <p className="mt-2 text-cream/70">Crie a loja agora e monte o cardápio no seu ritmo.</p>
            </div>
            <Link href="/cadastro" className="btn !px-6 !py-3.5 text-base">
              Criar minha loja <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-charcoal/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted">
          <span className="flex items-center gap-2">
            <PavSymbol size={24} /> Pede aí, vá
          </span>
          <span className="flex flex-wrap gap-4">
            <Link href="/sobre/termos" className="hover:underline">
              Termos de uso
            </Link>
            <Link href="/sobre/privacidade" className="hover:underline">
              Privacidade
            </Link>
            <Link href="/entrar" className="hover:underline">
              Acessar o painel
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Ilustração do produto feita com a própria interface (sem capturas de tela). */
function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
      <div className="absolute -top-8 -right-6 h-40 w-40 rounded-full bg-dende/40 blur-2xl" />
      <div className="relative rotate-[-2deg] rounded-[2rem] bg-charcoal p-3 shadow-2xl">
        <div className="rounded-[1.5rem] bg-background p-4">
          <p className="font-brand text-lg font-extrabold">Sabor do Bairro</p>
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-paper">
            <span className="h-1.5 w-1.5 rounded-full bg-paper" /> Aberta
          </span>
          {[
            ["X-Burguer artesanal", "R$ 28,90"],
            ["Pizza calabresa", "R$ 42,90"],
            ["Açaí 500 ml", "R$ 19,90"],
          ].map(([n, p]) => (
            <div key={n} className="mt-3 flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-[var(--shadow-soft)]">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-cream">
                <PavSymbol size={26} tone="dark" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold">{n}</p>
                <p className="text-xs font-extrabold text-tomato">a partir de {p}</p>
              </div>
            </div>
          ))}
          <div className="btn mt-4 w-full !py-2.5 text-sm">Ver sacola · R$ 92,80</div>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-6 rotate-[3deg] rounded-2xl bg-surface p-4 shadow-xl">
        <p className="text-[10px] font-bold text-muted uppercase">Novo pedido</p>
        <p className="font-brand text-2xl font-extrabold">#128</p>
        <p className="flex items-center gap-1 text-xs text-muted">
          <Bike className="h-3 w-3" /> Entrega · Pix
        </p>
      </div>
    </div>
  );
}
