"use client";

import { browserClient } from "./supabase/client";

const MAX_SIDE = 900;

/** Reduz a foto no próprio navegador (WebP, até 900 px) antes de enviar: a loja carrega rápido no celular. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter a imagem"))), "image/webp", 0.85));
}

export async function uploadProductImage(pizzeriaId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Envie uma imagem (JPG, PNG ou WebP).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Imagem maior que 15 MB.");
  const blob = await shrink(file);
  const path = `${pizzeriaId}/${crypto.randomUUID()}.webp`;
  const sb = browserClient();
  const { error } = await sb.storage.from("product-images").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
  if (error) throw new Error("Não foi possível enviar a foto.");
  return sb.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}
