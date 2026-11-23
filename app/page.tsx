import { connection } from "next/server";
import { listResidents } from "@/lib/store";

export default async function Home() {
  await connection(); // read the files on every request
  const residents = await listResidents();

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">見守りリスト</h1>
      <ul className="mt-6 divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {residents.map((r) => (
          <li key={r.id} className="p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-medium">{r.name}さん</span>
              <span className="text-sm text-zinc-500">毎日 {r.call_time}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">
              {r.recent_calls[0]
                ? `${r.recent_calls[0].date}：${r.recent_calls[0].summary}`
                : "まだ通話がありません"}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
