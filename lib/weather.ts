import { getSavedWeather } from "./store";
import type { Weather, WeatherReading } from "./types";

const JMA = "https://www.jma.go.jp/bosai/amedas/data";

// JMA's AMeDAS JSON is unofficial. Snow is measured hourly: only the on-the-hour reading carries it.
async function fetchLive(station: string): Promise<Weather> {
  const opts = { signal: AbortSignal.timeout(5000) };
  const latest = (await (await fetch(`${JMA}/latest_time.txt`, opts)).text()).trim();
  const stamp = latest.slice(0, 19).replace(/[-T:]/g, "");
  // Point files cover three hours each and carry the day's minimum so far.
  const block = String(Math.floor(Number(stamp.slice(8, 10)) / 3) * 3).padStart(2, "0");
  const point = await (await fetch(`${JMA}/point/${station}/${stamp.slice(0, 8)}_${block}.json`, opts)).json();
  const obs = point[stamp];
  const hourly = point[`${stamp.slice(0, 10)}0000`]; // in the same file: blocks start on the hour
  const low = obs?.minTemp?.[0];
  // A missing reading must not look like a mild day: fall back to the saved data instead.
  if (typeof low !== "number") throw new Error(`No minimum temperature for station ${station}`);
  return {
    station,
    date: latest.slice(0, 10),
    snowfall_24h_cm: hourly?.snow24h?.[0] ?? 0,
    snow_depth_cm: hourly?.snow?.[0] ?? 0,
    low_c: low,
    temp_c: obs.temp?.[0] ?? undefined,
    observed_at: latest,
  };
}

/** Live JMA data; the saved demo data if WEATHER_SOURCE=saved or the fetch fails. */
export async function getWeather(station: string): Promise<WeatherReading> {
  if (process.env.WEATHER_SOURCE === "saved") return { ...(await getSavedWeather()), source: "demo" };
  try {
    return { ...(await fetchLive(station)), source: "live" };
  } catch (e) {
    console.warn("JMA fetch failed, using saved weather", e);
    return { ...(await getSavedWeather()), source: "fallback" };
  }
}

export const HEAVY_SNOW_CM = 10;
export const COLD_C = -5;

/** Heavy snow or a hard frost: the agent runs the winter check. */
export const isWinter = (w: Weather) => w.snowfall_24h_cm >= HEAVY_SNOW_CM || w.low_c <= COLD_C;

/** What the agent is told about this morning, and whether to run the winter check. */
export function describeWeather(w: Weather) {
  const text = `今朝の最低気温は${w.low_c}℃、この24時間の降雪は${w.snowfall_24h_cm}センチ、積雪は${w.snow_depth_cm}センチ`;
  const winter = isWinter(w);
  return {
    weather: text,
    winter_check: winter
      ? "必要。暖房が動いているか、玄関から出られるか、食料・薬・灯油が足りているかを必ず確認する。"
      : "不要。天気の話は軽くふれる程度でよい。",
  };
}
