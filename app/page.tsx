import Link from "next/link";
import { connection } from "next/server";
import { listCalls, listResidents } from "@/lib/store";
import { describeWeather, getWeather } from "@/lib/weather";
import { callNow, markHandled } from "./actions";
import { Refresh } from "./refresh";
import { japanTime, RiskBadge } from "./ui";

const RANK = { red: 0, yellow: 1, green: 2 };

export default async function Home() {
  await connection(); // read the files on every request
  const [residents, calls] = await Promise.all([listResidents(), listCalls()]);
  const rows = residents
    .map((resident) => ({ resident, call: calls.find((c) => c.resident_id === resident.id) }))
    // Unhandled red first, then yellow, then green and not-yet-called.
    .sort((a, b) => rank(a.call) - rank(b.call));
  const weather = residents[0] && describeWeather(await getWeather(residents[0].amedas_station));

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Refresh />
      <h1 className="text-2xl font-semibold">見守りリスト</h1>
      {weather && <p className="mt-1 text-sm text-zinc-600">{weather.weather}</p>}
      <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {rows.map(({ resident, call }) => (
          <li key={resident.id} className={`p-4 ${call?.handled ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-3">
              <RiskBadge call={call} />
              <Link href={`/residents/${resident.id}`} className="text-lg font-medium hover:underline">
                {resident.name}さん
              </Link>
              <span className="ml-auto text-sm text-zinc-500">
                {call ? `最終 ${japanTime(call.at)}` : `毎日 ${resident.call_time}`}
              </span>
            </div>
            {call && call.reasons.length > 0 && <p className="mt-2 text-sm">{call.reasons.join("、")}</p>}
            {call?.actions.some((a) => a.type === "snow_request") && (
              <p className="mt-1 text-sm text-zinc-600">
                除雪のお願い：{call.snow_accepted ? `${resident.snow_volunteer.name}さんが引き受けました` : "返事待ち"}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <form action={callNow}>
                <input type="hidden" name="resident_id" value={resident.id} />
                <button className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">今すぐ電話</button>
              </form>
              {call && call.risk !== "green" && !call.handled && (
                <form action={markHandled}>
                  <input type="hidden" name="call_id" value={call.id} />
                  <button className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">対応済みにする</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function rank(call?: { risk: keyof typeof RANK; handled?: boolean }) {
  if (!call) return 3;
  return RANK[call.risk] + (call.handled ? 3 : 0);
}
