# Pede aí, vá

Cardápio online, pedidos e PDV para pizzarias. Next.js + Supabase.

## Rodar no computador

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Sem o banco conectado, só a página inicial funciona; as outras mostram um aviso.

## Conectar o banco (Supabase)

1. Crie um projeto em https://supabase.com (o plano gratuito serve).
2. No projeto, abra **SQL Editor**, cole todo o conteúdo de `supabase/migrations/20261022000000_inicial.sql` e clique em **Run**.
3. Em **Project Settings → API Keys**, copie a URL do projeto, a chave _publishable_ e a chave _secret_.
4. Copie `.env.example` para `.env.local` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (só no servidor; nunca coloque no Git)
5. Em **Authentication → URL Configuration**, coloque `http://localhost:3000` em _Site URL_ e adicione `http://localhost:3000/auth/confirmar` em _Redirect URLs_.
6. Reinicie o `npm run dev`, crie sua conta em **Criar minha loja** e confirme o e-mail.

## Endereços

| Página | Endereço |
| --- | --- |
| Página inicial | `/` |
| Loja de uma pizzaria | `/<endereço-da-loja>` |
| Acompanhamento do pedido | `/pedido/<código>` |
| Painel (pedidos, PDV, cardápio) | `/painel` |

## Testes

```bash
npm test
```

Os testes do banco aplicam a migração num Postgres embutido (sem Docker) e conferem isolamento entre pizzarias, criação de pedido, cupons, pagamentos e permissões.
