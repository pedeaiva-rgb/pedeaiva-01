"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: "store" | "courier" | "stop";
  /** Texto do balão ao tocar no ponto. */
  label: string;
  /** Número da parada na ordem sugerida. */
  seq?: number;
  /** Parada achada só pelo bairro. */
  approx?: boolean;
};
export type MapLine = { id: string; points: [number, number][] };

const ICON: Record<MapPoint["kind"], (p: MapPoint) => string> = {
  store: () => `<div style="width:34px;height:34px;border-radius:999px;background:#1f1b18;border:3px solid #f0a830;display:grid;place-items:center;font-size:17px">🍕</div>`,
  courier: () => `<div style="width:38px;height:38px;border-radius:999px;background:#e4472d;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:grid;place-items:center;font-size:19px">🛵</div>`,
  stop: (p) =>
    `<div style="width:30px;height:30px;border-radius:999px;background:${p.approx ? "#fff" : "#f0a830"};border:3px solid #1f1b18;${p.approx ? "border-style:dashed;" : ""}display:grid;place-items:center;font:800 13px system-ui;color:#1f1b18">${p.seq ?? "•"}</div>`,
};
const SIZE = { store: 34, courier: 38, stop: 30 };
const NO_LINES: MapLine[] = [];

/**
 * Mapa do OpenStreetMap (gratuito) com a loja, os entregadores e as paradas.
 * Atualiza os pontos sem perder o zoom; só reenquadra quando entram ou saem pontos.
 */
export function LiveMap({
  points,
  lines = NO_LINES,
  height = 320,
  onPick,
}: {
  points: MapPoint[];
  lines?: MapLine[];
  height?: number;
  /** Tocar no mapa escolhe um ponto (usado para marcar a loja). */
  onPick?: (pos: { lat: number; lng: number }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const framed = useRef("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    import("leaflet").then((mod) => {
      if (!alive || !box.current || map.current) return;
      const L = mod.default ?? mod;
      lib.current = L;
      // Começa mostrando o Brasil; os pontos reenquadram depois.
      map.current = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([-14.2, -51.9], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      map.current.on("click", (e) => pick.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      setReady(true);
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const L = lib.current;
    if (!ready || !L || !map.current || !layer.current) return;
    layer.current.clearLayers();
    for (const l of lines) if (l.points.length > 1) L.polyline(l.points, { color: "#e4472d", weight: 4, opacity: 0.75, dashArray: "8 8" }).addTo(layer.current);
    for (const p of points) {
      const s = SIZE[p.kind];
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ html: ICON[p.kind](p), className: "", iconSize: [s, s], iconAnchor: [s / 2, s / 2] }),
        zIndexOffset: p.kind === "courier" ? 1000 : 0,
      })
        .bindPopup(p.label)
        .addTo(layer.current);
    }
    const key = points.map((p) => p.id).sort().join("|");
    if (key !== framed.current && points.length) {
      framed.current = key;
      if (points.length === 1) map.current.setView([points[0]!.lat, points[0]!.lng], 15);
      else map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [36, 36], maxZoom: 16 });
    }
  }, [ready, points, lines]);

  return <div ref={box} style={{ height }} className="relative z-0 w-full overflow-hidden rounded-2xl bg-sand" aria-label="Mapa das entregas" />;
}
