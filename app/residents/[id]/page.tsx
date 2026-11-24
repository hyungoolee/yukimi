import Link from "next/link";
import { notFound } from "next/navigation";
import { getResident, listCalls } from "@/lib/store";
import { DEMO_SCRIPT } from "@/lib/demo-script";
import { DEMO_MODE } from "@/lib/env";
import { reasonText, type Lang, type Strings } from "@/lib/i18n";
import type { Extraction } from "@/lib/types";
import { simulateNoAnswer } from "../../actions";
import { getStrings } from "../../lang";
import { BrowserCall } from "./browser-call";
import { CallNowButton, CallStatus, MarkHandledButton } from "../../resident-card";
import { SubmitButton } from "../../submit-button";
import { japanTime, RiskBadge, riskEdge } from "../../ui";
import { LocationPicker } from "./location-picker";
import { PhoneForm } from "./phone-form";
import { rankedRows } from "@/lib/dashboard";
import { WeekGrid } from "./week-grid";
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
  const current = rankedRows([resident], calls)[0].call; // the same call the list shows

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">{t.back}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{t.name(resident)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{resident.facts.join("、")}</p>

      <section className={`mt-4 rounded-lg border border-zinc-200 p-4 ${riskEdge(current)}`}>
        <div className="flex items-center gap-3">
          <RiskBadge call={current} t={t} />
          <span className="text-sm text-zinc-500">
            {current ? t.last(japanTime(current.at, lang)) : t.daily(resident.call_time)}
          </span>
        </div>
        <CallStatus resident={resident} call={current} lang={lang} t={t} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <CallNowButton resident={resident} t={t} />
          {!resident.phone && (
            <a href="#settings" className="text-zinc-500 hover:underline">
              {t.addPhone}
            </a>
          )}
          <BrowserCall
            residentId={resident.id}
            translate={lang === "en"}
            labels={{
              start: t.browserCall,
              connecting: t.connecting,
              end: t.endCall,
              micError: t.micError,
              agent: t.captionAgent,
              you: t.captionYou,
              waiting: t.captionWaiting,
            }}
          />
          {DEMO_MODE && (
            <form action={simulateNoAnswer}>
              <input type="hidden" name="resident_id" value={resident.id} />
              <SubmitButton pending={t.calling}>{t.noAnswerDemo}</SubmitButton>
            </form>
          )}
          <MarkHandledButton call={current} t={t} />
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
                {DEMO_SCRIPT.filter((line) => !line.needsFact || resident.facts.some((f) => f.includes(line.needsFact!))).map(
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
      </section>

      <h2 className="mt-8 font-medium">{t.week}</h2>
      <WeekGrid
        week={lastWeek(dailyObservations(calls.filter((c) => c.kind === "call").map((c) => ({ at: c.at, observations: c.extraction?.observations }))), japanDate())}
        t={t}
        lang={lang}
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

      <h2 id="settings" className="mt-8 scroll-mt-6 font-medium">{t.settings}</h2>
      <PhoneForm
        residentId={resident.id}
        phone={resident.phone}
        labels={{ phone: t.phone, save: t.save, saving: t.saving, saved: t.saved, invalid: t.phoneInvalid, hint: t.phoneHint }}
      />
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
    </main>
  );
}
