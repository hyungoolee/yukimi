import Link from "next/link";
import type { Row } from "@/lib/dashboard";
import { reasonText, type Lang, type Strings } from "@/lib/i18n";
import { callNow, markHandled } from "./actions";
import { japanTime, RiskBadge } from "./ui";

/** One resident's status and buttons. The list rows and the map's panel both use it. */
export function ResidentCard({
  resident,
  call,
  lang,
  t,
  children,
}: Row & { lang: Lang; t: Strings; children?: React.ReactNode }) {
  return (
    <div className={call?.handled ? "opacity-60" : ""}>
      <div className="flex items-center gap-3">
        <RiskBadge call={call} t={t} />
        <Link href={`/residents/${resident.id}`} className="text-lg font-medium hover:underline">
          {t.name(resident)}
        </Link>
        <span className="ml-auto text-sm text-zinc-500">
          {call ? t.last(japanTime(call.at, lang)) : t.daily(resident.call_time)}
        </span>
      </div>
      {call && call.reasons.length > 0 && (
        <p className="mt-2 text-sm">{call.reasons.map((r) => reasonText(lang, r)).join(t.separator)}</p>
      )}
      {call?.actions.some((a) => a.type === "snow_request") && (
        <p className="mt-1 text-sm text-zinc-600">
          {t.snowRequest}
          {call.snow_accepted ? t.snowAccepted(resident) : t.snowWaiting}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={callNow}>
          <input type="hidden" name="resident_id" value={resident.id} />
          <button
            disabled={!resident.phone}
            className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
          >
            {t.callNow}
          </button>
        </form>
        {!resident.phone && (
          <Link href={`/residents/${resident.id}`} className="self-center text-sm text-zinc-500 hover:underline">
            {t.addPhone}
          </Link>
        )}
        {call && call.risk !== "green" && !call.handled && (
          <form action={markHandled}>
            <input type="hidden" name="call_id" value={call.id} />
            <button className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50">{t.markHandled}</button>
          </form>
        )}
        {children}
      </div>
    </div>
  );
}
