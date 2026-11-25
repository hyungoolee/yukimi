import Link from "next/link";
import { connection } from "next/server";
import { coverage, criticalCount, eligible, reach, ROLES, served, SNOW_NEXT_SLOTS, type Reach } from "@/lib/coverage";
import { LINE_READY } from "@/lib/env";
import { listPeople, listResidents } from "@/lib/store";
import type { Person } from "@/lib/types";
import { getStrings } from "../lang";
import { SubmitButton } from "../submit-button";
import { SaveOnChange } from "../save-on-change";
import { assignRoles, createPerson } from "./actions";
import { AddFamily } from "./add-family";
import { TestMessage } from "./test-message";

const DOT: Record<Reach, string> = { registered: "bg-emerald-600", unregistered: "bg-red-600", none: "bg-red-600" };

/** For the coordinator: who would be told for each resident, and where an alert would reach nobody. */
export default async function PeoplePage() {
  await connection(); // read the files on every request
  const { t } = await getStrings();
  const [residents, everyone] = await Promise.all([listResidents(), listPeople()]);
  const critical = criticalCount(residents);
  const rank = { critical: 0, warning: 1, ok: 2 };
  const rows = residents
    .filter((resident) => resident.active !== false)
    .map((resident) => ({ resident, ...coverage(resident) }))
    .sort((a, b) => rank[a.level] - rank[b.level]);

  const coordinators = everyone.filter((person) => person.coordinator);
  const option = (person: Person) => (
    <option key={person.id} value={person.id}>{person.name}{person.kind === "business" ? t.businessMark : ""}</option>
  );
  const personRow = (person: Person) => {
    const state = reach(person);
    const { roles, residents: theirs } = served(person, residents);
    return (
      <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <span className={`inline-block size-2 rounded-full ${DOT[state]}`} />
        <Link href={`/people/${person.id}`} className="font-medium hover:underline">{person.name}</Link>
        <span className="text-zinc-500">
          {[...(person.kind === "business" ? [t.business] : []), ...roles.map((role) => t.role[role]), ...(theirs.length || !person.coordinator ? [t.serves(theirs.length)] : []), t.reach[state]].join("・")}
        </span>
        {state === "registered" && LINE_READY && (
          <span className="ml-auto">
            <TestMessage
              personId={person.id}
              labels={{ send: t.testSend, sending: t.testSending, sent: t.testSent, failed: t.testFailed }}
            />
          </span>
        )}
      </li>
    );
  };

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">{t.back}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{t.people}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t.peopleIntro}</p>

      {/* Without LINE no alert reaches anyone, so the totals below don't matter yet. Each resident's gaps still show who needs to register. */}
      {!LINE_READY ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800">{t.lineNotReady}</p>
      ) : (
        <p className={`mt-3 rounded-lg border p-3 text-sm font-medium ${
          critical > 0 ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"
        }`}>
          {critical > 0 ? t.coverageBanner(critical) : t.coverageOk}
        </p>
      )}

      {/* Told about the whole town, not about one resident, so they are listed apart from everyone else. */}
      <h2 className="mt-6 font-medium">{t.coordinatorShort}</h2>
      <p className="mt-1 text-sm text-zinc-600">{t.coordinatorsIntro}</p>
      {LINE_READY && !coordinators.some((person) => person.line_id) && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800">{t.noCoordinator}</p>
      )}
      {coordinators.length > 0 && (
        <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm">{coordinators.map(personRow)}</ul>
      )}

      <h2 className="mt-8 font-medium">{t.residentsHeading}</h2>
      <p className="mt-1 text-sm text-zinc-600">{t.snowLineHelp}</p>
      <ul className="mt-2 space-y-3">
        {rows.map(({ resident, redAlertReaches, gaps, level }) => (
          <li
            key={resident.id}
            className={`rounded-lg border p-4 ${LINE_READY && level === "critical" ? "border-red-400 bg-red-50/50" : "border-zinc-200"}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <Link href={`/residents/${resident.id}`} className="text-lg font-medium hover:underline">
                {t.name(resident)}
              </Link>
              {/* "Reaches 2 people" is false while LINE can't send. */}
              {LINE_READY && (
                <span className={`text-sm ${redAlertReaches === 0 ? "font-medium text-red-700" : "text-zinc-600"}`}>
                  {t.redReaches(redAlertReaches)}
                </span>
              )}
            </div>
            {/* Each menu is keyed on who holds the role, so a change made elsewhere (adding family) shows. */}
            <SaveOnChange
              action={assignRoles}
              labels={{ saving: t.saving, saved: t.saved, failed: t.saveFailed }}
              className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm"
              footer={{ className: "py-1" }}
            >
              <input type="hidden" name="resident_id" value={resident.id} />
              {ROLES.map((role) => {
                const state = reach(resident[role]);
                return (
                  <label key={role} className="flex flex-col gap-0.5">
                    <span className="text-zinc-500">
                      <span className={`mr-1.5 inline-block size-2 rounded-full ${DOT[state]}`} />
                      {t.role[role]}（{t.reach[state]}）
                    </span>
                    <select key={resident[role].id ?? ""} name={role} defaultValue={resident[role].id ?? ""} className="rounded border border-zinc-300 bg-white px-2 py-1">
                      <option value="">{t.vacant}</option>
                      {everyone.filter((person) => eligible(person, role, resident)).map(option)}
                    </select>
                  </label>
                );
              })}
              {/* Who is asked to clear snow when the first person doesn't take it, in order. Each place saves on its own. */}
              {Array.from({ length: SNOW_NEXT_SLOTS }, (_, i) => {
                const current = resident.snow_next?.[i];
                return (
                  <label key={i} className="flex flex-col gap-0.5">
                    <span className="text-zinc-500">
                      {current && <span className={`mr-1.5 inline-block size-2 rounded-full ${DOT[reach(current)]}`} />}
                      {t.snowNext(i + 2)}{current ? `（${t.reach[reach(current)]}）` : ""}
                    </span>
                    <select key={current?.id ?? ""} name={`snow_next_${i}`} defaultValue={current?.id ?? ""} className="rounded border border-zinc-300 bg-white px-2 py-1">
                      <option value="">{t.vacant}</option>
                      {/* Not whoever is first in line already: they would be asked twice. */}
                      {everyone.filter((person) => person.id !== resident.snow_volunteer.id && eligible(person, "snow_volunteer", resident)).map(option)}
                    </select>
                  </label>
                );
              })}
            </SaveOnChange>
            <AddFamily residentId={resident.id} t={t} />
            {gaps.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-zinc-700">
                {gaps.map((gap) => (
                  <li key={gap}>{t.gap[gap]}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-medium">{t.peopleList}</h2>
      <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm">
        {everyone.filter((person) => !person.coordinator).map(personRow)}
      </ul>

      <form action={createPerson} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">{t.personName}</span>
          <input name="name" required maxLength={60} className="rounded border border-zinc-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">{t.personPhone}</span>
          <input name="phone" maxLength={60} className="rounded border border-zinc-300 px-2 py-1" />
        </label>
        <label className="flex items-center gap-1.5 py-1">
          <input type="checkbox" name="business" />
          {t.business}
        </label>
        <SubmitButton pending={t.saving}>{t.addPerson}</SubmitButton>
      </form>
    </main>
  );
}
