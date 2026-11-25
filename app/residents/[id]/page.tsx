import Link from "next/link";
import { notFound } from "next/navigation";
import { getResident, listCalls, listPeople } from "@/lib/store";
import { coverage, reach, ROLES } from "@/lib/coverage";
import { assignRoles } from "../../people/actions";
import { DEMO_MODE } from "@/lib/env";
import { reasonText, type Lang, type Strings } from "@/lib/i18n";
import type { Extraction } from "@/lib/types";
import { acceptDemo, deleteFollowUp, setActive, simulateNoAnswer } from "../../actions";
import { getStrings } from "../../lang";
import { BrowserCall } from "./browser-call";
import { CallNowButton, CallStatus, MarkHandledButton } from "../../resident-card";
import { SubmitButton } from "../../submit-button";
import { japanTime, RiskBadge, riskEdge } from "../../ui";
import { LocationPicker } from "./location-picker";
import { MemoryEditor } from "./memory-editor";
import { PhoneForm } from "./phone-form";
import { rankedRows } from "@/lib/dashboard";
import { REQUESTS, slotChoices, slotLabel } from "@/lib/requests";
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
  const [calls, everyone] = await Promise.all([listCalls(id), listPeople()]);
  const { lang, t } = await getStrings();
  const { call: current, requests = [] } = rankedRows([resident], calls)[0]; // the same call the list shows
  const [nextSlot] = slotChoices();
  const { gaps, level } = coverage(resident);

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">{t.back}</Link>
      <h1 className="mt-2 text-2xl font-semibold">
        {t.name(resident)}
        {resident.active === false && <span className="ml-3 rounded bg-zinc-200 px-2 py-0.5 align-middle text-sm font-normal">{t.inactive}</span>}
      </h1>


      <section className={`mt-4 rounded-lg border border-zinc-200 p-4 ${riskEdge(current)}`}>
        <div className="flex items-center gap-3">
          <RiskBadge call={current} t={t} />
          <span className="text-sm text-zinc-500">
            {current ? t.last(japanTime(current.at, lang)) : t.daily(resident.call_time)}
          </span>
        </div>
        <CallStatus resident={resident} call={current} requests={requests} lang={lang} t={t} />
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
          {DEMO_MODE &&
            requests
              .filter((r) => r.status !== "accepted")
              .map((r) => (
                <form key={r.kind} action={acceptDemo}>
                  <input type="hidden" name="call_id" value={r.callId} />
                  <input type="hidden" name="kind" value={r.kind} />
                  <SubmitButton pending={t.saving}>{t.acceptDemo(r, slotLabel(nextSlot, new Date(), lang))}</SubmitButton>
                </form>
              ))}
          <MarkHandledButton call={current} t={t} />
        </div>
      </section>

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
          {call.actions.length > 0 && (
            <div className="mt-3 text-sm">
              <div className="text-zinc-500">{t.messagesSent}</div>
              <ul className="mt-1 space-y-2">
                {call.actions.flatMap((a) =>
                  // Older records kept neither the wording nor each person's result: say so, don't guess.
                  !a.deliveries
                    ? [
                        <li key={a.type} className="rounded border border-zinc-200 p-2 text-zinc-500">
                          → {a.to.map((role) => resident[role].name).join("、")}
                          <div>{t.messageNotRecorded}</div>
                        </li>,
                      ]
                    : a.deliveries.map((d, i) => (
                        <li key={`${a.type}-${d.role}-${i}`} className="rounded border border-zinc-200 p-2">
                          <div className="text-zinc-500">
                            → {d.name ?? resident[d.role].name}
                            <span className={d.sent ? "ml-2 text-emerald-700" : "ml-2 text-amber-700"}>
                              {d.sent ? t.messageDelivered : d.registered ? t.messageFailed : t.messageUnregistered}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap break-words">{d.text}</div>
                          {d.button && <div className="text-zinc-500">{t.messageButton(d.button)}</div>}
                          {lang === "en" && (
                            <div className="text-zinc-600">
                              {d.reasons ? t.alertGloss(d.reasons.map((r) => reasonText(lang, r)).join(t.separator)) : a.type === "request" ? t.requestGloss[a.kind] : ""}
                            </div>
                          )}
                        </li>
                      )),
                )}
              </ul>
              {call.alert_rounds ? <p className="mt-1 text-zinc-500">{t.messageResent(call.alert_rounds)}</p> : null}
            </div>
          )}
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
          {call.actions.map((a) =>
            a.type === "request" && a.told?.transcript ? (
              <details key={a.kind} className="mt-3 text-sm">
                <summary className="cursor-pointer text-zinc-500">{t.showNewsTranscript(REQUESTS[a.kind].label[lang])}</summary>
                {a.told.transcript.map((line, i) => (
                  <p key={i} className="mt-1">
                    <span className="text-zinc-500">{line.role === "user" ? resident.name : "AI"}：</span>
                    {line.message}
                  </p>
                ))}
              </details>
            ) : null,
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
      <LocationPicker residentId={resident.id} who="home" label={t.home} initial={resident.location} labels={t.picker} />
      {/* The same save as on the People page. Keyed on who holds the roles, so the menus show a saved change. */}
      <form key={ROLES.map((role) => resident[role].id).join()} action={assignRoles} className="mt-2 space-y-2 text-sm">
        <input type="hidden" name="resident_id" value={resident.id} />
        {ROLES.map((role) => (
          <div key={role} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`role-${role}`} className="w-32 text-zinc-500">{t.role[role]}</label>
            <select
              id={`role-${role}`}
              name={role}
              defaultValue={resident[role].id ?? ""}
              className="w-48 rounded border border-zinc-300 bg-white px-2 py-1"
            >
              <option value="">{t.vacant}</option>
              {everyone.map((person) => (
                <option key={person.id} value={person.id}>{person.name}{person.kind === "business" ? t.businessMark : ""}</option>
              ))}
            </select>
            <span className={reach(resident[role]) === "registered" ? "text-zinc-500" : "text-red-700"}>
              {t.reach[reach(resident[role])]}
            </span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 sm:pl-34">
          <SubmitButton pending={t.saving}>{t.save}</SubmitButton>
          <Link href="/people" className="text-zinc-500 hover:underline">{t.people}</Link>
        </div>
        {gaps.length > 0 && (
          <ul className={`list-disc pl-5 ${level === "critical" ? "font-medium text-red-700" : "text-zinc-700"}`}>
            {gaps.map((gap) => (
              <li key={gap}>{t.gap[gap]}</li>
            ))}
          </ul>
        )}
      </form>
      <LocationPicker
        residentId={resident.id}
        who="snow_volunteer"
        label={t.volunteerLocation}
        initial={resident.snow_volunteer.location}
        labels={t.picker}
      />
      {(resident.snow_next ?? []).map((c, i) => (
        <LocationPicker
          key={c.id}
          residentId={resident.id}
          who={`snow_next_${i}`}
          label={c.kind === "business" ? `${c.name}${t.businessMark}` : t.volunteer(c.name)}
          initial={c.location}
          labels={t.picker}
        />
      ))}
      <form action={setActive} className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <input type="hidden" name="resident_id" value={resident.id} />
        <input type="hidden" name="active" value={resident.active === false ? "1" : "0"} />
        <SubmitButton pending={t.saving}>{resident.active === false ? t.resumeService : t.stopService}</SubmitButton>
        <span className="text-zinc-500">{resident.active === false ? t.inactiveHelp : t.stopServiceHelp}</span>
      </form>
    </main>
  );
}
