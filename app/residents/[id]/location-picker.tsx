"use client";

import "leaflet/dist/leaflet.css";
import type { Marker } from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/types";
import { saveLocation } from "../../actions";
import { SubmitButton } from "../../submit-button";
import { DEFAULT_CENTER, GSI_OPTIONS, GSI_TILES, pinHtml, VOLUNTEER_COLOR } from "../../map-style";

/** One Settings row: whether the spot is set, and a small map that opens to place or move the pin. */
export function LocationPicker({
  residentId,
  who,
  label,
  initial,
  labels,
}: {
  residentId: string;
  who: "home" | "snow_helper";
  label: string;
  initial?: LatLng;
  labels: { set: string; unset: string; place: string; change: string; save: string; saving: string; hint: string };
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
      // The picker starts inside a closed section, so its box is 0×0 until opened: re-measure on resize.
      const observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(container.current);
      remove = () => {
        observer.disconnect();
        map.remove();
      };
    });
    return () => {
      cancelled = true;
      remove();
    };
    // Depend on the numbers, not the object: a re-render with the same place must not rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.lat, initial?.lng, who]);

  return (
    <details id={`location-${who}`} className="mt-2 scroll-mt-6 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className="w-32 text-zinc-500">{label}</span>
        <span className={initial ? "" : "text-amber-700"}>{initial ? labels.set : labels.unset}</span>
        <span className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50">{initial ? labels.change : labels.place}</span>
      </summary>
      <form action={saveLocation} className="mt-2">
        <input type="hidden" name="resident_id" value={residentId} />
        <input type="hidden" name="who" value={who} />
        <input type="hidden" name="lat" value={picked?.lat ?? ""} />
        <input type="hidden" name="lng" value={picked?.lng ?? ""} />
        <div ref={container} className="z-0 h-56 w-full rounded-lg border border-zinc-200" />
        <div className="mt-2 flex items-center gap-2">
          <SubmitButton disabled={!picked} pending={labels.saving}>
            {labels.save}
          </SubmitButton>
          <span className="text-zinc-500">{labels.hint}</span>
        </div>
      </form>
    </details>
  );
}
