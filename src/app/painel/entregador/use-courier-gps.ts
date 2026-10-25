"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export type Gps = { lat: number; lng: number; accuracy: number };
export type GpsStatus = "desligado" | "procurando" | "ligado" | "negado" | "indisponivel";

/**
 * Enquanto há entrega em rota, acompanha o GPS do celular e manda a posição para a loja
 * a cada ~12 s. Só funciona com a página aberta na tela (limite do navegador).
 */
export function useCourierGps(pizzeriaId: string, active: boolean) {
  const [gps, setGps] = useState<Gps | null>(null);
  const [status, setStatus] = useState<GpsStatus>("procurando");
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;

  useEffect(() => {
    if (!active || !supported) return;
    const sb = browserClient();
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const g = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        setGps(g);
        setStatus("ligado");
        if (Date.now() - last < 12_000) return;
        last = Date.now();
        void sb.rpc("update_courier_location", { _pz: pizzeriaId, _lat: g.lat, _lng: g.lng, _accuracy: g.accuracy });
      },
      (e) => setStatus(e.code === e.PERMISSION_DENIED ? "negado" : "indisponivel"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, supported, pizzeriaId]);

  return { gps: active ? gps : null, status: !active ? "desligado" : !supported ? "indisponivel" : status } as { gps: Gps | null; status: GpsStatus };
}

/** Mantém a tela acesa durante a entrega (para o GPS não parar). Devolve se conseguiu. */
export function useWakeLock(active: boolean) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let alive = true;
    let lock: WakeLockSentinel | null = null;
    const get = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (!alive) return void l.release();
          lock = l;
          setOn(true);
          l.addEventListener("release", () => setOn(false));
        })
        .catch(() => setOn(false));
    void get();
    // O navegador solta a trava quando a tela some; pega de novo ao voltar.
    const onVisible = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
  return active && on;
}

export type GeoPermission = "granted" | "prompt" | "denied" | "unknown";

/** Se o navegador já liberou a localização para o site (e avisa quando muda). */
export function useGeoPermission() {
  const [state, setState] = useState<GeoPermission>("unknown");
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setState(status.state as GeoPermission);
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => setState("unknown"));
    return () => status?.removeEventListener("change", update);
  }, []);
  return state;
}

/** Pede a localização na hora (abre a pergunta do navegador). */
export function askLocation(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  });
}
