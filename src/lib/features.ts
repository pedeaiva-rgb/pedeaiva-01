/**
 * Recursos prontos mas desligados.
 *
 * Rastreio ao vivo do entregador (turno, GPS, mapa da loja e do cliente): num site, a localização
 * para quando o entregador abre o Waze/Google Maps. Volta quando existir o app Android.
 * Para religar: NEXT_PUBLIC_RASTREIO_AO_VIVO=1 na Vercel (e no .env.local) e publicar de novo.
 */
export const LIVE_TRACKING = process.env.NEXT_PUBLIC_RASTREIO_AO_VIVO === "1";
