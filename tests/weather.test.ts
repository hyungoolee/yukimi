import { afterEach, describe, expect, it, vi } from "vitest";
import { getWeather } from "@/lib/weather";

const latest = "2026-11-25T13:10:00+09:00";
// Snow comes only with the on-the-hour reading.
const point = {
  "20261125130000": { temp: [-3.5, 0], minTemp: [-4.7, 0], snow: [27, 0], snow24h: [27, 0] },
  "20261125131000": { temp: [-3.4, 0], minTemp: [-4.7, 0] },
};

function stubJma(ok = true) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!ok) throw new Error("offline");
    return url.endsWith("latest_time.txt") ? new Response(latest) : Response.json(point);
  }));
}

describe("getWeather says where the weather came from", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("labels the saved scenario as demo weather", async () => {
    expect(await getWeather("15356")).toMatchObject({ source: "demo", low_c: -12 });
  });

  it("reads the latest temperature, and snow from the hourly reading", async () => {
    vi.stubEnv("WEATHER_SOURCE", "");
    stubJma();
    expect(await getWeather("15356")).toEqual({
      station: "15356", date: "2026-11-25", snowfall_24h_cm: 27, snow_depth_cm: 27,
      low_c: -4.7, temp_c: -3.4, observed_at: latest, source: "live",
    });
  });

  it("flags saved data that stands in for a failed live fetch", async () => {
    vi.stubEnv("WEATHER_SOURCE", "");
    stubJma(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getWeather("15356")).toMatchObject({ source: "fallback", low_c: -12 });
  });
});
