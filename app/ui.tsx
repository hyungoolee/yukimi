import type { Lang, Strings } from "@/lib/i18n";
import type { CallRecord, Risk } from "@/lib/types";

const BADGE: Record<Risk, string> = {
  red: "bg-red-600 text-white",
  yellow: "bg-amber-400 text-black",
  green: "bg-emerald-600 text-white",
};

export function RiskBadge({ call, t }: { call?: CallRecord; t: Strings }) {
  if (!call) return <span className="rounded px-2 py-0.5 text-xs bg-zinc-200 text-zinc-700">{t.badge.none}</span>;
  // The risk labels are instructions ("check now"), which no longer apply once someone has dealt with the call.
  if (call.handled) return <span className="text-sm text-emerald-700">✓ {t.handled}</span>;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[call.risk]}`}>{t.badge[call.risk]}</span>;
}

export const japanTime = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

/** A left edge in the risk's colour while an alert is open, so urgent rows stand out at a glance. */
export function riskEdge(call?: CallRecord) {
  if (!call || call.handled || call.risk === "green") return "";
  return `border-l-4 ${call.risk === "red" ? "border-l-red-600" : "border-l-amber-400"}`;
}
