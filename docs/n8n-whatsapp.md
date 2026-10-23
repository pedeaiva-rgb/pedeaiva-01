# Avisos de pedido no WhatsApp com o n8n

O sistema avisa o n8n a cada pedido novo e a cada mudança de status. O n8n monta a mensagem e envia pelo seu provedor de WhatsApp.

```
Pedido criado / status mudou  →  Supabase (pg_net)  →  Webhook do n8n  →  provedor de WhatsApp  →  cliente
```

## 1. Ligar no sistema

1. Rode no Supabase a migração `supabase/migrations/20261023110000_avisos_n8n.sql` (ela ativa o `pg_net`).
2. No painel, abra **WhatsApp e automações**, cole a URL do webhook do n8n, ligue **Avisos ligados** e clique em **Salvar**.
3. Clique em **Enviar teste**. Um aviso de exemplo (`"evento": "teste"`) chega no n8n.

## 2. O que chega no n8n

Método `POST`, corpo JSON e o cabeçalho `X-Pede-Ai-Segredo` com o segredo mostrado no painel.

```json
{
  "evento": "pedido.status",
  "enviado_em": "2026-10-23T20:15:00Z",
  "pizzaria": { "slug": "reserva-pizzas", "nome": "Reserva Pizzas", "telefone": "(71) 3456-7890" },
  "pedido": {
    "numero": 128,
    "status": "saiu",
    "status_anterior": "pronto",
    "canal": "site",
    "tipo": "entrega",
    "total_centavos": 6290,
    "forma_pagamento": "pix",
    "previsao_min": 30,
    "previsao_max": 50,
    "link_acompanhamento": "https://pede-ai-e-va.vercel.app/pedido/…"
  },
  "cliente": { "nome": "Ana", "telefone": "71999990001", "whatsapp": "5571999990001" }
}
```

- `evento`: `pedido.criado`, `pedido.status` ou `teste`.
- `pedido.status`: `novo`, `confirmado`, `preparo`, `pronto`, `saiu`, `entregue`, `cancelado`.
- `cliente.whatsapp` vem `null` em pedido de balcão sem telefone: pule o envio nesse caso.
- O endereço de entrega **não** vai no aviso.

## 3. Montar o fluxo

1. **Webhook** — HTTP Method `POST`, Path `pede-ai`. Use a **Production URL** no painel (a Test URL só funciona com o fluxo aberto em modo de teste).
2. **IF (segredo)** — `{{ $json.headers["x-pede-ai-segredo"] }}` é igual ao segredo do painel. Se não for, pare.
3. **IF (tem WhatsApp)** — `{{ $json.body.cliente.whatsapp }}` não está vazio.
4. **Switch (mensagem)** — regra por `{{ $json.body.evento }}` e `{{ $json.body.pedido.status }}`:
   - `pedido.criado` → "Olá, {{ $json.body.cliente.nome }}! Recebemos seu pedido #{{ $json.body.pedido.numero }} 🍕 Acompanhe: {{ $json.body.pedido.link_acompanhamento }}"
   - `confirmado` → "Seu pedido #… foi confirmado e já vai para a cozinha."
   - `preparo` → "Seu pedido #… está no forno! 🔥"
   - `saiu` → "Seu pedido #… saiu para entrega 🛵"
   - `pronto` e `tipo = retirada` → "Seu pedido #… está pronto para retirada."
   - `entregue` → "Pedido entregue! Obrigado por pedir na {{ $json.body.pizzaria.nome }} ❤️"
   - `cancelado` → "Seu pedido #… foi cancelado. Qualquer dúvida, fale com a gente."
5. **Envio** — nó do seu provedor, com o número `{{ $json.body.cliente.whatsapp }}`.

## 4. Provedor de WhatsApp

| Opção | Como é | Atenção |
| --- | --- | --- |
| API oficial (WhatsApp Cloud API, da Meta) | Nó **WhatsApp Business Cloud** do n8n | Exige empresa verificada e número próprio. Mensagem que a loja inicia precisa de modelo aprovado pela Meta. |
| Evolution API, Z-API e similares | Nó **HTTP Request** para a API do serviço | Mais simples de começar, mas não é oficial: há risco de o número ser bloqueado pelo WhatsApp. |

Comece com poucos status (por exemplo: recebido, saiu para entrega, pronto para retirada) para não encher o cliente de mensagens.
