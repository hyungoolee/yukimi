import Link from "next/link";
import { notFound } from "next/navigation";
import { getResident, listCalls } from "@/lib/store";
import { DEMO_SCRIPT } from "@/lib/demo-script";
import { DEMO_MODE } from "@/lib/env";
import { reasonText, type Lang, type Strings } from "@/lib/i18n";
import type { Extraction } from "@/lib/types";
import { deleteFollowUp, savePhone, simulateNoAnswer } from "../../actions";
import { getStrings } from "../../lang";
import { BrowserCall } from "./browser-call";
import { japanTime, RiskBadge } from "../../ui";
import { LocationPicker } from "./location-picker";
import { MemoryEditor } from "./memory-editor";
import { WeekGrid } from "./week-grid";
import { openFollowUps } from "@/lib/memory";
import { dailyObservations, japanDate, lastWeek } from "@/lib/trends";

// English view: the model's English copy when the record has one (older records don't).
function notesFor(e: Extraction, lang: Lang) {
  return lang === "en" && e.english ? e.english : { summary: e.summary, ...e.notes };
}

function Notes({ notes, t }: { notes: ReturnType<typeof notesFor>; t: Strings }) {
  return (
    <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-zinc-500">{t.summary}</dt><dd>{notes.summary}</dd>
      <dt className="text-zinc-500">{t.mood}</dt><dd>{notes.mood}</dd>
      <dt className="text-zinc-500">{t.health}</dt><dd>{notes.health}</dd>
      <dt className="text-zinc-500">{t.winter}</dt><dd>{notes.winter}</dd>
      <dt className="text-zinc-500">{t.needs}</dt><dd>{notes.needs.join(t.separator) || t.none}</dd>
    </dl>
  );
}

export default async function ResidentPage({ params }: PageProps<"/residents/[id]">) {
  const { id } = await params;
  const resident = await getResident(id);
  if (!resident) notFound();
  const calls = await listCalls(id);
  const { lang, t } = await getStrings();

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">{t.back}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{t.name(resident)}</h1>


      <form action={savePhone} className="mt-4 flex items-center gap-2 text-sm">
        <input type="hidden" name="resident_id" value={resident.id} />
        <label htmlFor="phone" className="text-zinc-500">{t.phone}</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={resident.phone}
          placeholder="+819012345678"
          className="w-48 rounded border border-zinc-300 px-2 py-1"
        />
        <button className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50">{t.save}</button>
        <span className="text-zinc-500">{t.phoneHint}</span>
      </form>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <BrowserCall
          residentId={resident.id}
          labels={{ start: t.browserCall, connecting: t.connecting, end: t.endCall, micError: t.micError }}
        />
        {DEMO_MODE && (
          <form action={simulateNoAnswer}>
            <input type="hidden" name="resident_id" value={resident.id} />
            <button className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-50">{t.noAnswerDemo}</button>
          </form>
        )}
      </div>

      {DEMO_MODE && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-zinc-500">{t.demoScript}</summary>
          <p className="mt-2 text-sm text-zinc-600">{t.demoScriptIntro}</p>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-3 font-normal">{t.demoScriptWhen}</th>
                <th className="py-1 font-normal">{t.demoScriptSay}</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_SCRIPT.filter((line) => !line.needsFact || resident.facts.some((f) => f.text.includes(line.needsFact!))).map(
                (line) => (
                  <tr key={line.say} className="border-t border-zinc-200 align-top">
                    <td className="py-2 pr-3 text-zinc-600">{line.when[lang]}</td>
                    <td className="py-2">
                      <div className="text-base">{line.say}</div>
                      <div className="text-zinc-600">{line.romaji}</div>
                      <div className="text-zinc-500">{line.meaning}</div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-amber-700">{t.demoScriptAvoid}</p>
        </details>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-zinc-500">
          {t.mapLocations(!!resident.location, !!resident.snow_volunteer.location)}
        </summary>
        <LocationPicker residentId={resident.id} who="home" label={t.home} initial={resident.location} labels={t.picker} />
        <LocationPicker
          residentId={resident.id}
          who="snow_volunteer"
          label={t.volunteer(resident.snow_volunteer.name)}
          initial={resident.snow_volunteer.location}
          labels={t.picker}
        />
      </details>

      <MemoryEditor resident={resident} t={t} lang={lang} />

      {openFollowUps(resident, japanDate()).length > 0 && (
        <>
          <h2 className="mt-8 font-medium">{t.followUps}</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {openFollowUps(resident, japanDate()).map((f) => (
              <li key={f.id} className="flex items-center gap-3">
                <span>{f.text}</span>
                <span className="text-zinc-500">{t.followUpUntil(f.expires)}</span>
                <form action={deleteFollowUp}>
                  <input type="hidden" name="resident_id" value={resident.id} />
                  <input type="hidden" name="follow_up_id" value={f.id} />
                  <button className="text-zinc-500 underline hover:text-zinc-800">{t.remove}</button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 font-medium">{t.week}</h2>
      <WeekGrid
        week={lastWeek(dailyObservations(calls.filter((c) => c.kind === "call").map((c) => ({ at: c.at, observations: c.extraction?.observations }))), japanDate())}
        t={t}
      />

      <h2 className="mt-8 font-medium">{t.callLog}</h2>
      {calls.length === 0 && <p className="mt-2 text-sm text-zinc-500">{t.noCalls}</p>}
      {calls.map((call) => (
        <section key={call.id} className="mt-3 rounded-lg border border-zinc-200 p-4">
          <div className="flex items-center gap-3">
            <RiskBadge call={call} t={t} />
            <span className="text-sm text-zinc-500">{japanTime(call.at, lang)}</span>
          </div>
          {call.reasons.length > 0 && <p className="mt-2 text-sm font-medium">{call.reasons.map((r) => reasonText(lang, r)).join(t.separator)}</p>}
          {call.extraction && <Notes notes={notesFor(call.extraction, lang)} t={t} />}
          {call.transcript && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-zinc-500">{t.showTranscript}</summary>
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

      <h2 className="mt-8 font-medium">{t.history}</h2>
      <ul className="mt-2 space-y-1 text-sm text-zinc-600">
        {resident.recent_calls.map((c) => (
          <li key={c.date + c.summary}>{c.date}：{c.summary}</li>
        ))}
      </ul>
    </main>
  );
}
