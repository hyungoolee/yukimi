import type { Lang, Strings } from "@/lib/i18n";
import type { WeatherReading } from "@/lib/types";
import { COLD_C, HEAVY_SNOW_CM, isWinter } from "@/lib/weather";
import { japanTime } from "./ui";

const SOURCE = {
  live: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  demo: "bg-sky-50 text-sky-800 ring-sky-200",
  fallback: "bg-amber-50 text-amber-900 ring-amber-300",
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** A bar that fills toward its threshold mark (at the middle) and turns red past it. */
function Gauge({ label, value, fill, mark, over }: { label: string; value: string; fill: number; mark?: string; over?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span className={`text-base font-semibold tabular-nums ${over ? "text-red-700" : "text-zinc-900"}`}>{value}</span>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-zinc-100">
        <div className={`h-full rounded-full ${over ? "bg-red-500" : "bg-sky-400"}`} style={{ width: `${clamp(fill) * 100}%` }} />
        {mark && <div className="absolute inset-y-[-3px] left-1/2 w-0.5 bg-zinc-700" />}
      </div>
      {mark && <div className="mt-0.5 text-center text-[11px] text-zinc-400">{mark}</div>}
    </div>
  );
}

/**
 * This morning's weather, where it came from, and whether it puts the winter check in today's calls.
 * `compact`: one line, so an open alert below it stays in view.
 */
export function WeatherCard({ weather: w, lang, t, compact }: { weather: WeatherReading; lang: Lang; t: Strings; compact?: boolean }) {
  const s = t.weather;
  const winter = isWinter(w);
  const snowy = w.snowfall_24h_cm > 0 || w.snow_depth_cm > 0;
  const source =
    w.source === "live"
      ? s.live(w.station, japanTime(w.observed_at!, lang))
      : w.source === "demo"
        ? s.demo(w.date)
        : s.fallback;
  if (compact)
    return (
      <p aria-label={s.title} className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm text-zinc-600">
        <span>{snowy ? "❄️" : "🌡️"} {w.temp_c === undefined ? s.low : s.now} {w.temp_c ?? w.low_c}℃</span>
        <span>{s.snowfall} {w.snowfall_24h_cm} cm</span>
        <span>{s.depth} {w.snow_depth_cm} cm</span>
        {winter && <span className="font-medium text-red-800">{s.winterOn}</span>}
        {w.source === "fallback" && <span className="text-amber-900">⚠ {s.fallback}</span>}
      </p>
    );
  return (
    <section aria-label={s.title} className="mt-3 rounded-lg border border-zinc-200 p-4">
      <p className={`inline-block rounded px-2 py-0.5 text-xs ring-1 ${SOURCE[w.source]}`}>
        {w.source === "fallback" && "⚠ "}
        {source}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <span className="text-4xl" aria-hidden>
            {snowy ? "❄️" : "🌡️"}
          </span>
          <div>
            <div className="text-4xl font-semibold tabular-nums">{w.temp_c ?? w.low_c}℃</div>
            <div className="text-xs text-zinc-500">{w.temp_c === undefined ? s.low : s.now}</div>
          </div>
        </div>
        <div className="grid min-w-56 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Both thresholds sit at the middle of their bar: snow 0–20 cm, cold +10 to −20 °C. */}
          <Gauge
            label={s.snowfall}
            value={`${w.snowfall_24h_cm} cm`}
            fill={w.snowfall_24h_cm / (HEAVY_SNOW_CM * 2)}
            mark={s.mark(`${HEAVY_SNOW_CM} cm`)}
            over={w.snowfall_24h_cm >= HEAVY_SNOW_CM}
          />
          <Gauge
            label={s.low}
            value={`${w.low_c}℃`}
            fill={(10 - w.low_c) / (2 * (10 - COLD_C))}
            mark={s.mark(`${COLD_C}℃`)}
            over={w.low_c <= COLD_C}
          />
          <Gauge label={s.depth} value={`${w.snow_depth_cm} cm`} fill={w.snow_depth_cm / 100} />
        </div>
      </div>
      <p
        className={`mt-3 rounded px-2 py-1 text-sm ${winter ? "bg-red-50 font-medium text-red-800" : "bg-zinc-50 text-zinc-600"}`}
      >
        {winter ? `❄ ${s.winterOn}` : s.winterOff}
      </p>
    </section>
  );
}
