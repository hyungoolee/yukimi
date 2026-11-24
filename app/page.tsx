import Link from "next/link";
import { connection } from "next/server";
import { mapData, rankedRows, snowRequest } from "@/lib/dashboard";
import { listCalls, listResidents } from "@/lib/store";
import { describeWeather, getWeather } from "@/lib/weather";
import { MapView } from "./map-view";
import { Refresh } from "./refresh";
import { ResidentCard } from "./resident-card";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const linkClass = "self-center text-sm text-zinc-500 hover:underline";

export default async function Home({ searchParams }: PageProps<"/">) {
  await connection(); // read the files on every request
  // The view and the selected resident live in the address, so switching views keeps the selection.
  const params = await searchParams;
  const view = one(params.view) === "map" ? "map" : "list";
  const selected = one(params.selected);

  const [residents, calls] = await Promise.all([listResidents(), listCalls()]);
  const rows = rankedRows(residents, calls);
  const weather = residents[0] && describeWeather(await getWeather(residents[0].amedas_station));
  const href = (v: "list" | "map", id = selected) => `/?view=${v}${id ? `&selected=${id}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Refresh />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">見守りリスト</h1>
        <nav className="flex overflow-hidden rounded border border-zinc-300 text-sm">
          {(["list", "map"] as const).map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={view === v ? "page" : undefined}
              className={`px-3 py-1 ${view === v ? "bg-zinc-900 text-white" : "hover:bg-zinc-50"}`}
            >
              {v === "list" ? "リスト" : "地図"}
            </Link>
          ))}
        </nav>
      </div>
      {weather && <p className="mt-1 text-sm text-zinc-600">{weather.weather}</p>}

      {view === "list" ? (
        <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          {rows.map((row) => (
            <li key={row.resident.id} className={`p-4 ${row.resident.id === selected ? "bg-blue-50" : ""}`}>
              <ResidentCard {...row}>
                <Link href={href("map", row.resident.id)} className={linkClass}>
                  地図で見る
                </Link>
              </ResidentCard>
            </li>
          ))}
        </ul>
      ) : (
        <MapPanel rows={rows} calls={calls} selected={selected} listHref={href("list")} />
      )}
    </main>
  );
}

function MapPanel({
  rows,
  calls,
  selected,
  listHref,
}: {
  rows: ReturnType<typeof rankedRows>;
  calls: Awaited<ReturnType<typeof listCalls>>;
  selected?: string;
  listHref: string;
}) {
  const data = mapData(rows, calls);
  const row = rows.find((r) => r.resident.id === selected);
  const request = row && snowRequest(row.resident, calls);
  const home = row?.resident.location;

  return (
    <div className="mt-6">
      <MapView data={data} selected={selected} />
      {data.unplaced > 0 && (
        <p className="mt-2 text-sm text-zinc-500">位置未登録：{data.unplaced}名（利用者のページで登録できます）</p>
      )}
      <div className="mt-4 rounded-lg border border-zinc-200 p-4">
        {row ? (
          <>
            <ResidentCard {...row}>
              <Link href={listHref} className={linkClass}>
                リストで見る
              </Link>
              {home && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${home.lat},${home.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClass}
                >
                  地図アプリで開く
                </a>
              )}
            </ResidentCard>
            {request && (
              <p className="mt-2 text-sm text-zinc-600">
                {request.volunteer}さんへ：
                {{ not_sent: "送信できていません", sent: "送信済み・返事待ち", accepted: "引き受け済み" }[request.status]}
                {request.km !== undefined && `（直線で約${request.km.toFixed(1)} km）`}
              </p>
            )}
            {!home && <p className="mt-2 text-sm text-zinc-500">この方の位置はまだ登録されていません。</p>}
          </>
        ) : (
          <p className="text-sm text-zinc-500">ピンを選ぶと、その方の状況が表示されます。</p>
        )}
      </div>
    </div>
  );
}
