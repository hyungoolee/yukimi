"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MapData } from "@/lib/dashboard";
import { DEFAULT_CENTER, GSI_STYLE, RISK_COLOR, VOLUNTEER_COLOR } from "./map-style";

const requestLines = (data: MapData) => ({
  type: "FeatureCollection" as const,
  features: data.requests.flatMap((r) =>
    r.from && r.to
      ? [
          {
            type: "Feature" as const,
            properties: { status: r.status },
            geometry: { type: "LineString" as const, coordinates: [[r.from.lng, r.from.lat], [r.to.lng, r.to.lat]] },
          },
        ]
      : [],
  ),
});

function pinElement(color: string, selected: boolean, shape: "circle" | "diamond") {
  const el = document.createElement("div");
  el.style.cssText =
    `width:20px;height:20px;background:${color};border:2px solid #fff;cursor:pointer;` +
    `border-radius:${shape === "circle" ? "50%" : "3px"};` +
    `${shape === "diamond" ? "transform:rotate(45deg);" : ""}` +
    `box-shadow:0 0 0 ${selected ? "3px #2563eb" : "1px rgba(0,0,0,.35)"};`;
  return el;
}

/** The coordinator's map: residents by risk, volunteers, and a line for each open snow request. */
export function MapView({ data, selected }: { data: MapData; selected?: string }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  // Create the map once. The library needs a browser, so it is loaded here, not on the server.
  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then((ml) => {
      if (cancelled || !container.current) return;
      const m = new ml.Map({
        container: container.current,
        style: GSI_STYLE,
        center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: 12,
      });
      m.addControl(new ml.NavigationControl({ showCompass: false }));
      m.on("load", () => {
        m.addSource("requests", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({
          id: "requests-waiting",
          type: "line",
          source: "requests",
          filter: ["!=", ["get", "status"], "accepted"],
          paint: { "line-color": VOLUNTEER_COLOR, "line-width": 3, "line-dasharray": [2, 2] },
        });
        m.addLayer({
          id: "requests-accepted",
          type: "line",
          source: "requests",
          filter: ["==", ["get", "status"], "accepted"],
          paint: { "line-color": VOLUNTEER_COLOR, "line-width": 4 },
        });
        map.current = m;
        setReady(true);
      });
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
    if (!ready || !m) return;
    let stale = false;
    import("maplibre-gl").then((ml) => {
      if (stale) return;
      markers.current.forEach((marker) => marker.remove());
      markers.current = [
        ...data.volunteers.map((v) => {
          const el = pinElement(VOLUNTEER_COLOR, false, "diamond");
          el.title = `除雪ボランティア ${v.name}さん`;
          return new ml.Marker({ element: el }).setLngLat([v.location.lng, v.location.lat]).addTo(m);
        }),
        ...data.pins.map((p) => {
          const el = pinElement(RISK_COLOR[p.risk ?? "none"], p.id === selected, "circle");
          if (p.handled) el.style.opacity = "0.55";
          el.addEventListener("click", () => router.replace(`/?view=map&selected=${p.id}`, { scroll: false }));
          return new ml.Marker({ element: el }).setLngLat([p.location.lng, p.location.lat]).addTo(m);
        }),
      ];
      (m.getSource("requests") as GeoJSONSource).setData(requestLines(data));

      // Frame everything once; later refreshes must not move a map someone is reading.
      const points = [...data.pins, ...data.volunteers].map((p) => p.location);
      if (!fitted.current && points.length > 0) {
        fitted.current = true;
        const bounds = new ml.LngLatBounds();
        points.forEach((p) => bounds.extend([p.lng, p.lat]));
        m.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
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
    if (ready && lat !== undefined && lng !== undefined) map.current?.easeTo({ center: [lng, lat] });
  }, [ready, lat, lng]);

  return <div ref={container} className="h-[60vh] min-h-80 w-full rounded-lg border border-zinc-200" />;
}
