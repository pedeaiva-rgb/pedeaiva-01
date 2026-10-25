"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type NotifyPermission = NotificationPermission | "unsupported";

const supported = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
const noop = () => () => {};

/**
 * Notificações do navegador (aparecem na barra do celular mesmo com outra aba ou o Waze na frente,
 * enquanto o site estiver aberto). O Android só mostra notificação por meio de um service worker.
 */
export function useNotifications(url: string) {
  const initial = useSyncExternalStore(noop, () => (supported() ? Notification.permission : "unsupported"), () => "unsupported" as NotifyPermission);
  const [asked, setAsked] = useState<NotifyPermission | null>(null);
  const permission = asked ?? initial;

  useEffect(() => {
    if (supported()) void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const request = useCallback(async () => {
    if (!supported()) return "unsupported" as const;
    const p = await Notification.requestPermission();
    setAsked(p);
    return p;
  }, []);

  const notify = useCallback(
    async (title: string, body: string, tag: string) => {
      if (!supported() || Notification.permission !== "granted") return;
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, { body, tag, icon: "/icon.svg", badge: "/icon.svg", data: { url } });
      } catch {
        // Sem notificação, ainda há o som e o aviso na tela.
      }
    },
    [url],
  );

  return { permission, request, notify };
}
