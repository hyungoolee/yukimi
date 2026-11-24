import Link from "next/link";
import { connection } from "next/server";
import { coverage, criticalCount, people, reach, ROLES, type Reach } from "@/lib/coverage";
import { LINE_READY } from "@/lib/env";
import { listResidents } from "@/lib/store";
import { getStrings } from "../lang";
import { Refresh } from "../refresh";
import { TestMessage } from "./test-message";

const DOT: Record<Reach, string> = { registered: "bg-emerald-600", unregistered: "bg-red-600", none: "bg-red-600" };

/** For the coordinator: who would be told for each resident, and where an alert would reach nobody. */
export default async function PeoplePage() {
  await connection(); // read the files on every request
  const { t } = await getStrings();
  const residents = await listResidents();
  const critical = criticalCount(residents);
  const rank = { critical: 0, warning: 1, ok: 2 };
  const rows = residents
    .map((resident) => ({ resident, ...coverage(resident) }))
    .sort((a, b) => rank[a.level] - rank[b.level]);

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <Refresh />
      <Link href="/" className="text-sm text-zinc-500 hover:underline">{t.back}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{t.people}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t.peopleIntro}</p>

      {!LINE_READY && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800">{t.lineNotReady}</p>
      )}
      <p className={`mt-3 rounded-lg border p-3 text-sm font-medium ${
        critical > 0 ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"
      }`}>
        {critical > 0 ? t.coverageBanner(critical) : t.coverageOk}
      </p>

      <ul className="mt-4 space-y-3">
        {rows.map(({ resident, redAlertReaches, gaps, level }) => (
          <li
            key={resident.id}
            className={`rounded-lg border p-4 ${level === "critical" ? "border-red-400 bg-red-50/50" : "border-zinc-200"}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <Link href={`/residents/${resident.id}`} className="text-lg font-medium hover:underline">
                {t.name(resident)}
              </Link>
              <span className={`text-sm ${redAlertReaches === 0 ? "font-medium text-red-700" : "text-zinc-600"}`}>
                {t.redReaches(redAlertReaches)}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-sm sm:grid-cols-[5rem_1fr_5rem_1fr_5rem_1fr]">
              {ROLES.map((role) => {
                const state = reach(resident[role]);
                return (
                  <div key={role} className="contents">
                    <dt className="text-zinc-500">{t.role[role]}</dt>
                    <dd>
                      <span className={`mr-1.5 inline-block size-2 rounded-full ${DOT[state]}`} />
                      {resident[role].name || "—"}
                      <span className="ml-1 text-zinc-500">（{t.reach[state]}）</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
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
        {people(residents).map((person) => (
          <li key={person.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <span className={`inline-block size-2 rounded-full ${DOT[person.reach]}`} />
            <span className="font-medium">{person.name}</span>
            <span className="text-zinc-500">
              {person.roles.map((role) => t.role[role]).join(t.separator)}・{t.serves(person.residents.length)}・
              {t.reach[person.reach]}
            </span>
            {person.reach === "registered" && LINE_READY && (
              <span className="ml-auto">
                <TestMessage
                  residentId={person.at.residentId}
                  role={person.at.role}
                  labels={{ send: t.testSend, sending: t.testSending, sent: t.testSent, failed: t.testFailed }}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
