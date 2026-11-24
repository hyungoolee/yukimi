"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MapData } from "@/lib/dashboard";
import { DEFAULT_CENTER, GSI_OPTIONS, GSI_TILES, pinHtml, RISK_COLOR, VOLUNTEER_COLOR } from "./map-style";

/** The coordinator's map: residents by risk, volunteers, and a line for each open snow request. */
export function MapView({ data, selected }: { data: MapData; selected?: string }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  // Create the map once. Leaflet needs a browser, so it is loaded here, not on the server.
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !container.current) return;
      const m = L.map(container.current, { center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], zoom: 12 });
      L.tileLayer(GSI_TILES, GSI_OPTIONS).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Redraw pins and lines whenever the data or the selection changes; the map itself stays put.
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!ready || !m || !group) return;
    let stale = false;
    import("leaflet").then(({ default: L }) => {
      if (stale) return;
      const icon = (html: string) => L.divIcon({ className: "", html, iconSize: [20, 20] });
      group.clearLayers();

      for (const r of data.requests) {
        if (!r.from || !r.to) continue;
        const accepted = r.status === "accepted";
        L.polyline([[r.from.lat, r.from.lng], [r.to.lat, r.to.lng]], {
          color: VOLUNTEER_COLOR,
          weight: accepted ? 4 : 3,
          dashArray: accepted ? undefined : "6 6", // dashed until the volunteer accepts
        }).addTo(group);
      }
      for (const v of data.volunteers) {
        L.marker([v.location.lat, v.location.lng], {
          icon: icon(pinHtml(VOLUNTEER_COLOR, "diamond")),
          title: `除雪ボランティア ${v.name}さん`,
        }).addTo(group);
      }
      for (const p of data.pins) {
        L.marker([p.location.lat, p.location.lng], {
          icon: icon(pinHtml(RISK_COLOR[p.risk ?? "none"], "circle", p.id === selected, p.handled)),
          zIndexOffset: 1000, // residents above volunteers
        })
          .on("click", () => router.replace(`/?view=map&selected=${p.id}`, { scroll: false }))
          .addTo(group);
      }

      // Frame everything once; later refreshes must not move a map someone is reading.
      const points = [...data.pins, ...data.volunteers].map((p) => [p.location.lat, p.location.lng] as [number, number]);
      if (!fitted.current && points.length > 0) {
        fitted.current = true;
        m.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 15, animate: false });
      }
    });
    return () => {
      stale = true;
    };
  }, [ready, data, selected, router]);

  // Bring the selected resident into view.
  const selectedPin = data.pins.find((p) => p.id === selected);
  const lat = selectedPin?.location.lat;
  const lng = selectedPin?.location.lng;
  useEffect(() => {
    if (ready && lat !== undefined && lng !== undefined) map.current?.panTo([lat, lng]);
  }, [ready, lat, lng]);

  return <div ref={container} className="z-0 h-[60vh] min-h-80 w-full rounded-lg border border-zinc-200" />;
}
