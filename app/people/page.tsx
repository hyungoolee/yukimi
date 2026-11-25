import Link from "next/link";
import { connection } from "next/server";
import { coverage, criticalCount, reach, served, type Reach } from "@/lib/coverage";
import { LINE_READY } from "@/lib/env";
import { listPeople, listResidents } from "@/lib/store";
import type { Person } from "@/lib/types";
import { getStrings } from "../lang";
import { SubmitButton } from "../submit-button";
import { createPerson } from "./actions";
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
  const personRow = (person: Person) => {
    const state = reach(person);
    const { roles, residents: theirs } = served(person, residents);
    return (
      <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <span className={`inline-block size-2 rounded-full ${DOT[state]}`} />
        <Link href={`/people/${person.id}`} className="font-medium hover:underline">{person.name}</Link>
        <span className="text-zinc-500">
          {[...roles.map((role) => t.role[role]), ...(theirs.length || !person.coordinator ? [t.serves(theirs.length)] : []), t.reach[state]].join("・")}
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

      {/* Only who needs fixing, each with a link to where it's fixed: roles and family are set on the resident's page. */}
      {rows.some((row) => row.gaps.length > 0) && (
        <>
          <h2 className="mt-8 font-medium">{t.residentsWithGaps}</h2>
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-sm">
            {rows
              .filter((row) => row.gaps.length > 0)
              .map(({ resident, redAlertReaches, gaps, level }) => (
                <li key={resident.id} className="p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <Link href={`/residents/${resident.id}`} className="font-medium hover:underline">
                      {t.name(resident)}
                    </Link>
                    {/* "Reaches 2 people" is false while LINE can't send. */}
                    {LINE_READY && (
                      <span className={redAlertReaches === 0 ? "font-medium text-red-700" : "text-zinc-600"}>
                        {t.redReaches(redAlertReaches)}
                      </span>
                    )}
                    <Link href={`/residents/${resident.id}#settings`} className="ml-auto text-zinc-500 hover:underline">
                      {t.fixInSettings} →
                    </Link>
                  </div>
                  <ul className={`mt-1 list-disc pl-5 ${LINE_READY && level === "critical" ? "text-red-700" : "text-zinc-700"}`}>
                    {gaps.map((gap) => (
                      <li key={gap}>{t.gap[gap]}</li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </>
      )}

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
        <SubmitButton pending={t.saving}>{t.addPerson}</SubmitButton>
      </form>
    </main>
  );
}
