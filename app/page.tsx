import Link from "next/link";
import { connection } from "next/server";
import { criticalCount, snowLine } from "@/lib/coverage";
import { mapData, rankedRows, snowRequest, volunteerKey, type MapData, type Row } from "@/lib/dashboard";
import { DEMO_MODE, LINE_READY } from "@/lib/env";
import type { Lang, Strings } from "@/lib/i18n";
import { listCalls, listResidents } from "@/lib/store";
import type { CallRecord } from "@/lib/types";
import { getWeather } from "@/lib/weather";
import { resetDemo } from "./actions";
import { getStrings } from "./lang";
import { riskEdge } from "./ui";
import { MapView } from "./map-view";
import { ResidentCard } from "./resident-card";
import { WeatherCard } from "./weather-card";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const linkClass = "self-center text-sm text-zinc-500 hover:underline";

export default async function Home({ searchParams }: PageProps<"/">) {
  await connection(); // read the files on every request
  const { lang, t } = await getStrings();
  // The view and the selected resident live in the address, so switching views keeps the selection.
  const params = await searchParams;
  const view = one(params.view) === "map" ? "map" : "list";
  const selected = one(params.selected);
  const volunteer = one(params.volunteer); // a volunteer pin chosen on the map instead of a resident

  const [residents, calls] = await Promise.all([listResidents(), listCalls()]);
  const rows = rankedRows(residents, calls);
  const weather = residents[0] && (await getWeather(residents[0].amedas_station));
  const open = (risk: "red" | "yellow") => rows.filter((r) => r.call?.risk === risk && !r.call.handled).length;
  const counts = [
    { label: t.badge.red, n: open("red"), className: "bg-red-600 text-white" },
    { label: t.badge.yellow, n: open("yellow"), className: "bg-amber-400 text-black" },
    { label: t.badge.none, n: rows.filter((r) => !r.call).length, className: "bg-zinc-200 text-zinc-700" },
  ];
  const unreached = criticalCount(residents);
  // The card line singles a resident out. Skip it when the banner already says the same of everyone:
  // all are critical, or LINE isn't set up.
  const flagGaps = LINE_READY && unreached < residents.filter((r) => r.active !== false).length;
  const href = (v: "list" | "map", id = selected) => `/?view=${v}${id ? `&selected=${encodeURIComponent(id)}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      {/* With a red alert open, the weather shrinks to a line so the alert is on the first screen. */}
      {weather && <WeatherCard weather={weather} lang={lang} t={t} compact={open("red") > 0} />}
      <p className="mt-3 flex flex-wrap gap-2 text-sm">
        {counts.map(({ label, n, className }) => (
          <span key={label} className={`rounded px-2 py-0.5 ${n > 0 ? `font-medium ${className}` : "bg-zinc-100 text-zinc-400"}`}>
            {label} {n}
          </span>
        ))}
      </p>
      {/* An alert that would reach nobody is the failure this product exists to prevent: say so up front. */}
      {!LINE_READY ? (
        // Fixed in the server's settings, not on any page here: no link.
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800">{t.lineNotReady}</p>
      ) : (
        unreached > 0 && (
          <Link href="/people" className="mt-3 block rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 hover:bg-red-100">
            {t.coverageBanner(unreached)} →
          </Link>
        )
      )}
      <div className="mt-4 flex items-center gap-4">
        <nav className="inline-flex overflow-hidden rounded border border-zinc-300 text-sm">
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
        <Link href="/people" className={linkClass}>
          {t.people}
        </Link>
        {DEMO_MODE && (
          <Link href="/story" className={linkClass}>
            {t.storyDemo}
          </Link>
        )}
      </div>

      {view === "list" ? (
        <ul className="mt-4 divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200">
          {rows.map((row) => (
            <li key={row.resident.id} className={`p-4 ${riskEdge(row.call) || "border-l-4 border-l-transparent"} ${row.resident.id === selected ? "bg-blue-50" : ""}`}>
              <ResidentCard {...row} lang={lang} t={t} flagGaps={flagGaps}>
                <Link href={href("map", row.resident.id)} className={linkClass}>
                  {t.viewOnMap}
                </Link>
              </ResidentCard>
            </li>
          ))}
        </ul>
      ) : (
        <MapPanel rows={rows} calls={calls} selected={selected} volunteer={volunteer} listHref={href("list")} lang={lang} t={t} flagGaps={flagGaps} />
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
  volunteer,
  listHref,
  lang,
  t,
  flagGaps,
}: {
  rows: Row[];
  calls: CallRecord[];
  selected?: string;
  volunteer?: string;
  listHref: string;
  lang: Lang;
  t: Strings;
  flagGaps: boolean;
}) {
  const data = mapData(rows, calls);
  const row = rows.find((r) => r.resident.id === selected);
  const request = row && snowRequest(row.resident, calls);
  const home = row?.resident.location;
  const helper = !row ? data.volunteers.find((v) => v.key === volunteer) : undefined;

  return (
    <div className="mt-4">
      {data.pins.length === 0 && rows.length > 0 && (
        // An empty map with no explanation looks broken: say why, and where to fix it.
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">{t.mapEmpty}</p>
          <p className="mt-1">
            {t.mapEmptyHelp}{" "}
            {rows.map(({ resident }, i) => (
              <span key={resident.id}>
                {i > 0 && t.separator}
                <Link href={`/residents/${resident.id}#location-home`} className="underline">
                  {t.name(resident)}
                </Link>
              </span>
            ))}
          </p>
          {DEMO_MODE && <p className="mt-1 text-zinc-600">{t.mapEmptyDemo}</p>}
        </div>
      )}
      <MapView data={data} selected={selected} volunteer={helper?.key} volunteerLabel={t.volunteer("{name}")} businessMark={t.businessMark} />
      {data.unplaced > 0 && data.pins.length > 0 && (
        <p className="mt-2 text-sm text-zinc-500">{t.unplaced(data.unplaced)}</p>
      )}
      <div className={`mt-4 rounded-lg border border-zinc-200 p-4 ${riskEdge(row?.call)}`}>
        {row ? (
          <>
            <ResidentCard {...row} lang={lang} t={t} flagGaps={flagGaps}>
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
                {t.requestStatus(request)}
                {request.km !== undefined && t.straightLine(request.km)}
              </p>
            )}
            {!home && (
              <p className="mt-2 text-sm text-zinc-500">
                {t.noLocation}{" "}
                <Link href={`/residents/${row.resident.id}#location-home`} className="underline">
                  {t.placeHome}
                </Link>
              </p>
            )}
          </>
        ) : helper ? (
          <VolunteerCard volunteer={helper} rows={rows} calls={calls} t={t} />
        ) : (
          <p className="text-sm text-zinc-500">{t.pickPin}</p>
        )}
      </div>
    </div>
  );
}

/** A volunteer chosen on the map: who they clear snow for, with any open request, and their own page. */
function VolunteerCard({
  volunteer,
  rows,
  calls,
  t,
}: {
  volunteer: MapData["volunteers"][number];
  rows: Row[];
  calls: CallRecord[];
  t: Strings;
}) {
  const served = rows.filter(({ resident }) => snowLine(resident).some((c) => volunteerKey(c) === volunteer.key));
  return (
    <div className="text-sm">
      <div className="flex items-center gap-3">
        <span className="text-lg font-medium">{volunteer.name}</span>
        <span className="text-zinc-500">{volunteer.business ? t.business : t.role.snow_volunteer}</span>
        {volunteer.id && (
          <Link href={`/people/${encodeURIComponent(volunteer.id)}`} className="ml-auto text-zinc-500 hover:underline">
            {t.openPerson}
          </Link>
        )}
      </div>
      <p className="mt-2 text-zinc-500">{t.servesList}</p>
      <ul className="mt-1 space-y-1">
        {served.map(({ resident }) => {
          const request = snowRequest(resident, calls);
          return (
            <li key={resident.id}>
              <Link href={`/?view=map&selected=${encodeURIComponent(resident.id)}`} scroll={false} className="hover:underline">
                {t.name(resident)}
              </Link>
              {request && <span className="ml-2 text-zinc-600">{t.requestStatus(request)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
