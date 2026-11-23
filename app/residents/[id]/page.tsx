import Link from "next/link";
import { notFound } from "next/navigation";
import { getResident, listCalls } from "@/lib/store";
import { savePhone } from "../../actions";
import { japanTime, RiskBadge } from "../../ui";

export default async function ResidentPage({ params }: PageProps<"/residents/[id]">) {
  const { id } = await params;
  const resident = await getResident(id);
  if (!resident) notFound();
  const calls = await listCalls(id);

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">← 見守りリスト</Link>
      <h1 className="mt-2 text-2xl font-semibold">{resident.name}さん</h1>
      <p className="mt-1 text-sm text-zinc-600">{resident.facts.join("、")}</p>

      <form action={savePhone} className="mt-4 flex items-center gap-2 text-sm">
        <input type="hidden" name="resident_id" value={resident.id} />
        <label htmlFor="phone" className="text-zinc-500">電話番号</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={resident.phone}
          placeholder="+819012345678"
          pattern="\+[0-9]{8,15}"
          className="w-48 rounded border border-zinc-300 px-2 py-1"
        />
        <button className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50">保存</button>
        <span className="text-zinc-500">国番号から（例：+81…）</span>
      </form>

      <h2 className="mt-8 font-medium">通話の記録</h2>
      {calls.length === 0 && <p className="mt-2 text-sm text-zinc-500">まだ通話がありません</p>}
      {calls.map((call) => (
        <section key={call.id} className="mt-3 rounded-lg border border-zinc-200 p-4">
          <div className="flex items-center gap-3">
            <RiskBadge call={call} />
            <span className="text-sm text-zinc-500">{japanTime(call.at)}</span>
          </div>
          {call.reasons.length > 0 && <p className="mt-2 text-sm font-medium">{call.reasons.join("、")}</p>}
          {call.extraction && (
            <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-zinc-500">まとめ</dt><dd>{call.extraction.summary}</dd>
              <dt className="text-zinc-500">気分</dt><dd>{call.extraction.notes.mood}</dd>
              <dt className="text-zinc-500">体調</dt><dd>{call.extraction.notes.health}</dd>
              <dt className="text-zinc-500">冬の状況</dt><dd>{call.extraction.notes.winter}</dd>
              <dt className="text-zinc-500">困りごと</dt><dd>{call.extraction.notes.needs.join("、") || "なし"}</dd>
            </dl>
          )}
          {call.transcript && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-zinc-500">会話を見る</summary>
              {call.transcript.map((t, i) => (
                <p key={i} className="mt-1">
                  <span className="text-zinc-500">{t.role === "user" ? resident.name : "AI"}：</span>
                  {t.message}
                </p>
              ))}
            </details>
          )}
        </section>
      ))}

      <h2 className="mt-8 font-medium">これまでのまとめ</h2>
      <ul className="mt-2 space-y-1 text-sm text-zinc-600">
        {resident.recent_calls.map((c) => (
          <li key={c.date + c.summary}>{c.date}：{c.summary}</li>
        ))}
      </ul>
    </main>
  );
}
