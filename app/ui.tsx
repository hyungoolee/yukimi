import type { CallRecord, Risk } from "@/lib/types";

const BADGE: Record<Risk, { label: string; className: string }> = {
  red: { label: "すぐ確認", className: "bg-red-600 text-white" },
  yellow: { label: "訪問リスト", className: "bg-amber-400 text-black" },
  green: { label: "問題なし", className: "bg-emerald-600 text-white" },
};

export function RiskBadge({ call }: { call?: CallRecord }) {
  if (!call) return <span className="rounded px-2 py-0.5 text-xs bg-zinc-200 text-zinc-700">通話なし</span>;
  const badge = BADGE[call.risk];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>;
}

export const japanTime = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
