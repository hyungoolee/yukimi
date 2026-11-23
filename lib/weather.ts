import { getSavedWeather } from "./store";
import type { Weather } from "./types";

const JMA = "https://www.jma.go.jp/bosai/amedas/data";

// JMA's AMeDAS JSON is unofficial. Snow fields are absent when there is no snow.
async function fetchLive(station: string): Promise<Weather> {
  const opts = { signal: AbortSignal.timeout(5000) };
  const latest = (await (await fetch(`${JMA}/latest_time.txt`, opts)).text()).trim();
  const stamp = latest.slice(0, 19).replace(/[-T:]/g, "");
  const obs = (await (await fetch(`${JMA}/map/${stamp}.json`, opts)).json())[station];
  return {
    station,
    date: latest.slice(0, 10),
    snowfall_24h_cm: obs.snow24h?.[0] ?? 0,
    snow_depth_cm: obs.snow?.[0] ?? 0,
    low_c: obs.temp[0],
  };
}

/** Live JMA data; the saved demo data if WEATHER_SOURCE=saved or the fetch fails. */
export async function getWeather(station: string): Promise<Weather> {
  if (process.env.WEATHER_SOURCE === "saved") return getSavedWeather();
  try {
    return await fetchLive(station);
  } catch (e) {
    console.warn("JMA fetch failed, using saved weather", e);
    return getSavedWeather();
  }
}

export const HEAVY_SNOW_CM = 10;
export const COLD_C = -5;

/** What the agent is told about this morning, and whether to run the winter check. */
export function describeWeather(w: Weather) {
  const text = `今朝の気温は${w.low_c}℃、この24時間の降雪は${w.snowfall_24h_cm}センチ、積雪は${w.snow_depth_cm}センチ`;
  const winter = w.snowfall_24h_cm >= HEAVY_SNOW_CM || w.low_c <= COLD_C;
  return {
    weather: text,
    winter_check: winter
      ? "必要。暖房が動いているか、玄関から出られるか、食料と薬が足りているかを必ず確認する。"
      : "不要。天気の話は軽くふれる程度でよい。",
  };
}
