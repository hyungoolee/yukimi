import Link from "next/link";
import { connection } from "next/server";
import { listCalls, listResidents } from "@/lib/store";
import { reasonText } from "@/lib/i18n";
import { getWeather } from "@/lib/weather";
import { callNow, markHandled } from "./actions";
import { getStrings } from "./lang";
import { Refresh } from "./refresh";
import { japanTime, RiskBadge } from "./ui";

const RANK = { red: 0, yellow: 1, green: 2 };

export default async function Home() {
  await connection(); // read the files on every request
  const { lang, t } = await getStrings();
  const [residents, calls] = await Promise.all([listResidents(), listCalls()]);
  const rows = residents
    .map((resident) => {
      const own = calls.filter((c) => c.resident_id === resident.id);
      // A later green call must not hide an alert nobody has handled yet.
      return { resident, call: own.find((c) => c.risk !== "green" && !c.handled) ?? own[0] };
    })
    // Unhandled red first, then yellow, then green and not-yet-called.
    .sort((a, b) => rank(a.call) - rank(b.call));
  const weather = residents[0] && (await getWeather(residents[0].amedas_station));

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Refresh />
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      {weather && <p className="mt-1 text-sm text-zinc-600">{t.weather(weather)}</p>}
      <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {rows.map(({ resident, call }) => (
          <li key={resident.id} className={`p-4 ${call?.handled ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-3">
              <RiskBadge call={call} t={t} />
              <Link href={`/residents/${resident.id}`} className="text-lg font-medium hover:underline">
                {t.name(resident)}
              </Link>
              <span className="ml-auto text-sm text-zinc-500">
                {call ? t.last(japanTime(call.at, lang)) : t.daily(resident.call_time)}
              </span>
            </div>
            {call && call.reasons.length > 0 && <p className="mt-2 text-sm">{call.reasons.map((r) => reasonText(lang, r)).join(t.separator)}</p>}
            {call?.actions.some((a) => a.type === "snow_request") && (
              <p className="mt-1 text-sm text-zinc-600">
                {t.snowRequest}
                {call.snow_accepted ? t.snowAccepted(resident) : t.snowWaiting}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <form action={callNow}>
                <input type="hidden" name="resident_id" value={resident.id} />
                <button
                  disabled={!resident.phone}
                  className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
                >
                  {t.callNow}
                </button>
              </form>
              {!resident.phone && (
                <Link href={`/residents/${resident.id}`} className="self-center text-sm text-zinc-500 hover:underline">
                  {t.addPhone}
                </Link>
              )}
              {call && call.risk !== "green" && !call.handled && (
                <form action={markHandled}>
                  <input type="hidden" name="call_id" value={call.id} />
                  <button className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">{t.markHandled}</button>
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
