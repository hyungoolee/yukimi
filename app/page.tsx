import Link from "next/link";
import { connection } from "next/server";
import { mapData, rankedRows, snowRequest, type Row } from "@/lib/dashboard";
import { DEMO_MODE } from "@/lib/env";
import type { Lang, Strings } from "@/lib/i18n";
import { listCalls, listResidents } from "@/lib/store";
import type { CallRecord } from "@/lib/types";
import { getWeather } from "@/lib/weather";
import { resetDemo } from "./actions";
import { getStrings } from "./lang";
import { MapView } from "./map-view";
import { Refresh } from "./refresh";
import { ResidentCard } from "./resident-card";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const linkClass = "self-center text-sm text-zinc-500 hover:underline";

export default async function Home({ searchParams }: PageProps<"/">) {
  await connection(); // read the files on every request
  const { lang, t } = await getStrings();
  // The view and the selected resident live in the address, so switching views keeps the selection.
  const params = await searchParams;
  const view = one(params.view) === "map" ? "map" : "list";
  const selected = one(params.selected);

  const [residents, calls] = await Promise.all([listResidents(), listCalls()]);
  const rows = rankedRows(residents, calls);
  const weather = residents[0] && (await getWeather(residents[0].amedas_station));
  const href = (v: "list" | "map", id = selected) => `/?view=${v}${id ? `&selected=${encodeURIComponent(id)}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Refresh />
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      {weather && <p className="mt-1 text-sm text-zinc-600">{t.weather(weather)}</p>}
      <nav className="mt-4 inline-flex overflow-hidden rounded border border-zinc-300 text-sm">
        {(["list", "map"] as const).map((v) => (
          <Link
            key={v}
            href={href(v)}
            aria-current={view === v ? "page" : undefined}
            className={`px-3 py-1 ${view === v ? "bg-zinc-900 text-white" : "hover:bg-zinc-50"}`}
          >
            {t[v]}
          </Link>
        ))}
      </nav>

      {view === "list" ? (
        <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          {rows.map((row) => (
            <li key={row.resident.id} className={`p-4 ${row.resident.id === selected ? "bg-blue-50" : ""}`}>
              <ResidentCard {...row} lang={lang} t={t}>
                <Link href={href("map", row.resident.id)} className={linkClass}>
                  {t.viewOnMap}
                </Link>
              </ResidentCard>
            </li>
          ))}
        </ul>
      ) : (
        <MapPanel rows={rows} calls={calls} selected={selected} listHref={href("list")} lang={lang} t={t} />
      )}
      {DEMO_MODE && (
        <form action={resetDemo} className="mt-6 text-right">
          <button className="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-50">
            {t.resetDemo}
          </button>
        </form>
      )}
    </main>
  );
}

function MapPanel({
  rows,
  calls,
  selected,
  listHref,
  lang,
  t,
}: {
  rows: Row[];
  calls: CallRecord[];
  selected?: string;
  listHref: string;
  lang: Lang;
  t: Strings;
}) {
  const data = mapData(rows, calls);
  const row = rows.find((r) => r.resident.id === selected);
  const request = row && snowRequest(row.resident, calls);
  const home = row?.resident.location;

  return (
    <div className="mt-4">
      <MapView data={data} selected={selected} volunteerLabel={t.volunteer("")} />
      {data.unplaced > 0 && <p className="mt-2 text-sm text-zinc-500">{t.unplaced(data.unplaced)}</p>}
      <div className="mt-4 rounded-lg border border-zinc-200 p-4">
        {row ? (
          <>
            <ResidentCard {...row} lang={lang} t={t}>
              <Link href={listHref} className={linkClass}>
                {t.viewInList}
              </Link>
              {home && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${home.lat},${home.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClass}
                >
                  {t.openInMaps}
                </a>
              )}
            </ResidentCard>
            {request && (
              <p className="mt-2 text-sm text-zinc-600">
                {t.requestStatus(request.volunteer, request.status)}
                {request.km !== undefined && t.straightLine(request.km)}
              </p>
            )}
            {!home && <p className="mt-2 text-sm text-zinc-500">{t.noLocation}</p>}
          </>
        ) : (
          <p className="text-sm text-zinc-500">{t.pickPin}</p>
        )}
      </div>
    </div>
  );
}
