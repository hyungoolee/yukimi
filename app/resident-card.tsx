import Link from "next/link";
import { coverage } from "@/lib/coverage";
import type { Row } from "@/lib/dashboard";
import { reasonText, type Lang, type Strings } from "@/lib/i18n";
import type { CallRecord, Resident } from "@/lib/types";
import { callNow, markHandled } from "./actions";
import { SubmitButton } from "./submit-button";
import { japanTime, RiskBadge } from "./ui";

/** One resident's status and buttons. The list rows and the map's panel both use it. */
export function ResidentCard({
  resident,
  call,
  requests,
  lang,
  t,
  flagGaps,
  children,
}: Row & { lang: Lang; t: Strings; flagGaps: boolean; children?: React.ReactNode }) {
  return (
    <div className={call?.handled || resident.active === false ? "opacity-60" : ""}>
      <div className="flex items-center gap-3">
        <RiskBadge call={call} t={t} />
        <Link href={`/residents/${resident.id}`} className="text-lg font-medium hover:underline">
          {t.name(resident)}
        </Link>
        <span className="ml-auto text-sm text-zinc-500">
          {resident.active === false ? t.inactive : call ? t.last(japanTime(call.at, lang)) : t.daily(resident.call_time)}
        </span>
      </div>
      <CallStatus resident={resident} call={call} requests={requests} lang={lang} t={t} />
      {flagGaps && resident.active !== false && <CoverageLine resident={resident} t={t} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <CallNowButton resident={resident} t={t} />
        {!resident.phone && (
          <Link href={`/residents/${resident.id}#settings`} className="self-center text-sm text-zinc-500 hover:underline">
            {t.addPhone}
          </Link>
        )}
        <MarkHandledButton call={call} t={t} />
        {children}
      </div>
    </div>
  );
}

/** Why the call was flagged, whether the alert was seen, and the help requests still open. */
export function CallStatus({ call, requests = [], lang, t }: Row & { lang: Lang; t: Strings }) {
  if (!call) return null;
  return (
    <>
      {call.reasons.length > 0 && (
        <p className="mt-2 text-sm">{call.reasons.map((r) => reasonText(lang, r)).join(t.separator)}</p>
      )}
      {call.risk === "red" && !call.handled && call.actions.some((a) => a.type === "alert") && (
        <p className={`mt-1 text-sm ${call.acknowledged_by ? "text-zinc-600" : "font-medium text-red-700"}`}>
          {call.acknowledged_by ? t.alertSeen(call.acknowledged_by) : t.alertUnseen(call.alert_rounds ?? 0)}
          {!call.acknowledged_by && call.coordinators_told_at && ` · ${t.coordinatorsTold(japanTime(call.coordinators_told_at, lang))}`}
        </p>
      )}
      {requests.map((r) => (
        <p key={r.kind} className="mt-1 text-sm text-zinc-600">
          {t.request(r)}
        </p>
      ))}
    </>
  );
}

/** Shown when some alert for this resident would reach nobody. */
function CoverageLine({ resident, t }: { resident: Resident; t: Strings }) {
  if (coverage(resident).level !== "critical") return null;
  return (
    <p className="mt-1 text-sm font-medium text-red-700">
      <Link href="/people" className="hover:underline">
        {t.cardNoReach} →
      </Link>
    </p>
  );
}

export function CallNowButton({ resident, t }: { resident: Resident; t: Strings }) {
  return (
    <form action={callNow}>
      <input type="hidden" name="resident_id" value={resident.id} />
      <SubmitButton disabled={!resident.phone || resident.active === false} pending={t.calling}>
        {t.callNow}
      </SubmitButton>
    </form>
  );
}

/** Shown only for an alert nobody has handled yet. */
export function MarkHandledButton({ call, t }: { call?: CallRecord; t: Strings }) {
  if (!call || call.risk === "green" || call.handled) return null;
  return (
    <form action={markHandled}>
      <input type="hidden" name="call_id" value={call.id} />
      <SubmitButton pending={t.saving} primary>{t.markHandled}</SubmitButton>
    </form>
  );
}
