"use client";

import "leaflet/dist/leaflet.css";
import type { Marker } from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/types";
import { saveLocation } from "../../actions";
import { DEFAULT_CENTER, GSI_OPTIONS, GSI_TILES, pinHtml, VOLUNTEER_COLOR } from "../../map-style";

/** A small map: click to place the pin, then save. */
export function LocationPicker({
  residentId,
  who,
  label,
  initial,
}: {
  residentId: string;
  who: "home" | "snow_volunteer";
  label: string;
  initial?: LatLng;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<LatLng | undefined>();

  useEffect(() => {
    let remove = () => {};
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !container.current) return;
      const start = initial ?? DEFAULT_CENTER;
      const map = L.map(container.current, { center: [start.lat, start.lng], zoom: initial ? 15 : 12 });
      L.tileLayer(GSI_TILES, GSI_OPTIONS).addTo(map);
      const icon = L.divIcon({
        className: "",
        html: pinHtml(who === "home" ? "#18181b" : VOLUNTEER_COLOR, who === "home" ? "circle" : "diamond"),
        iconSize: [20, 20],
      });
      let marker: Marker | undefined = initial && L.marker([initial.lat, initial.lng], { icon }).addTo(map);
      map.on("click", (e) => {
        marker = (marker ?? L.marker(e.latlng, { icon }).addTo(map)).setLatLng(e.latlng);
        setPicked({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      remove = () => map.remove();
    });
    return () => {
      cancelled = true;
      remove();
    };
    // Depend on the numbers, not the object: a re-render with the same place must not rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.lat, initial?.lng, who]);

  return (
    <form action={saveLocation} className="mt-3 text-sm">
      <input type="hidden" name="resident_id" value={residentId} />
      <input type="hidden" name="who" value={who} />
      <input type="hidden" name="lat" value={picked?.lat ?? ""} />
      <input type="hidden" name="lng" value={picked?.lng ?? ""} />
      <div className="flex items-center gap-2">
        <span className="text-zinc-500">{label}</span>
        <button disabled={!picked} className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-40">
          この位置で保存
        </button>
        <span className="text-zinc-500">{initial ? "登録済み。地図をクリックで変更" : "地図をクリックして位置を決める"}</span>
      </div>
      <div ref={container} className="z-0 mt-2 h-56 w-full rounded-lg border border-zinc-200" />
    </form>
  );
}
