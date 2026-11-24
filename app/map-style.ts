import type { StyleSpecification } from "maplibre-gl";
import type { LatLng } from "@/lib/types";

// 国土地理院 pale base map. The credit must stay visible while the map is shown.
export const GSI_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    gsi: {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
    },
  },
  layers: [{ id: "gsi", type: "raster", source: "gsi" }],
};

/** Where the map opens when there is nothing to show yet: Iwamizawa. */
export const DEFAULT_CENTER: LatLng = { lat: 43.196, lng: 141.776 };

export const RISK_COLOR = { red: "#dc2626", yellow: "#f59e0b", green: "#059669", none: "#a1a1aa" };
export const VOLUNTEER_COLOR = "#2563eb";
