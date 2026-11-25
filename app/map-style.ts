import type { LatLng } from "@/lib/types";

// 国土地理院 pale base map. The credit must stay visible while the map is shown.
export const GSI_TILES = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
export const GSI_OPTIONS = {
  maxZoom: 18,
  attribution:
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
};

/** Where the map opens when there is nothing to show yet: Iwamizawa. */
export const DEFAULT_CENTER: LatLng = { lat: 43.196, lng: 141.776 };

// "none" (not called yet) is dark, so the pin still shows on the pale base map.
export const RISK_COLOR = { red: "#dc2626", yellow: "#f59e0b", green: "#059669", none: "#3f3f46" };
export const VOLUNTEER_COLOR = "#2563eb";
export const BUSINESS_COLOR = "#7c3aed";

/** A pin drawn in HTML, so no image files are needed. */
export function pinHtml(color: string, shape: "circle" | "diamond" | "square", selected = false, faded = false) {
  return (
    `<div style="width:20px;height:20px;background:${color};border:2px solid #fff;` +
    `border-radius:${shape === "circle" ? "50%" : "3px"};` +
    `${shape === "diamond" ? "transform:rotate(45deg);" : ""}` +
    `${faded ? "opacity:.55;" : ""}` +
    `box-shadow:0 0 0 ${selected ? "3px #2563eb" : "1px rgba(0,0,0,.35)"};"></div>`
  );
}
