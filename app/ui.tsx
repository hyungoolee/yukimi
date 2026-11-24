import type { Lang, Strings } from "@/lib/i18n";
import type { CallRecord, Risk } from "@/lib/types";

const BADGE: Record<Risk, string> = {
  red: "bg-red-600 text-white",
  yellow: "bg-amber-400 text-black",
  green: "bg-emerald-600 text-white",
};

export function RiskBadge({ call, t }: { call?: CallRecord; t: Strings }) {
  if (!call) return <span className="rounded px-2 py-0.5 text-xs bg-zinc-200 text-zinc-700">{t.badge.none}</span>;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[call.risk]}`}>{t.badge[call.risk]}</span>;
}

export const japanTime = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-GB", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
