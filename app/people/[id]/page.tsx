import Link from "next/link";
import { notFound } from "next/navigation";
import { served } from "@/lib/coverage";
import { LINE_READY } from "@/lib/env";
import { getPerson, listResidents } from "@/lib/store";
import { getStrings } from "../../lang";
import { Refresh } from "../../refresh";
import { SubmitButton } from "../../submit-button";
import { editPerson, newCode, removePerson, unregister } from "../actions";
import { TestMessage } from "../test-message";

/** One person: their details, their LINE registration, and the residents they serve. */
export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  const person = await getPerson(id).catch(() => null); // a made-up id in the address is just "not found"
  if (!person) notFound();
  const { t } = await getStrings();
  const { roles, residents } = served(person, await listResidents());
  const input = "rounded border border-zinc-300 px-2 py-1";
  const idField = <input type="hidden" name="person_id" value={person.id} />;

  return (
    <main className="mx-auto w-full max-w-3xl p-6 text-sm">
      <Refresh />
      <Link href="/people" className="text-zinc-500 hover:underline">{t.backToPeople}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{person.name}</h1>
      <p className="mt-1 text-zinc-600">{roles.map((role) => t.role[role]).join(t.separator)}</p>

      <form action={editPerson} className="mt-4 flex flex-wrap items-end gap-3">
        {idField}
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">{t.personName}</span>
          <input name="name" required maxLength={60} defaultValue={person.name} className={input} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-zinc-500">{t.personPhone}</span>
          <input name="phone" maxLength={60} defaultValue={person.phone ?? ""} className={input} />
        </label>
        <SubmitButton pending={t.saving}>{t.save}</SubmitButton>
      </form>

      <h2 className="mt-8 text-base font-medium">{t.lineRegistration}</h2>
      {person.line_id ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span><span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-600" />{t.reach.registered}</span>
          {LINE_READY && (
            <TestMessage
              personId={person.id}
              labels={{ send: t.testSend, sending: t.testSending, sent: t.testSent, failed: t.testFailed }}
            />
          )}
          <form action={unregister}>{idField}<SubmitButton pending={t.saving}>{t.unregister}</SubmitButton></form>
        </div>
      ) : (
        <div className="mt-2">
          <p><span className="mr-1.5 inline-block size-2 rounded-full bg-red-600" />{t.reach.unregistered}</p>
          {person.code ? (
            <>
              <p className="mt-2 font-mono text-2xl tracking-widest">{person.code}</p>
              <p className="mt-1 text-zinc-600">{t.codeHelp}</p>
            </>
          ) : (
            <p className="mt-2 text-zinc-600">{t.noCode}</p>
          )}
          <form action={newCode} className="mt-2">{idField}<SubmitButton pending={t.saving}>{t.newCode}</SubmitButton></form>
        </div>
      )}

      <h2 className="mt-8 text-base font-medium">{t.servesList}</h2>
      {residents.length > 0 ? (
        <ul className="mt-2 list-disc pl-5">
          {residents.map((r) => (
            <li key={r.id}><Link href={`/residents/${r.id}`} className="hover:underline">{t.name(r)}</Link></li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-zinc-600">{t.servesNobody}</p>
      )}

      <form action={removePerson} className="mt-8 flex flex-wrap items-center gap-3">
        {idField}
        <SubmitButton pending={t.saving} disabled={residents.length > 0}>{t.deletePerson}</SubmitButton>
        {residents.length > 0 && <span className="text-zinc-500">{t.deleteBlocked}</span>}
      </form>
    </main>
  );
}
