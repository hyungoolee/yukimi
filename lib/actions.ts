import { buttons, push, text } from "./line";
import type { Action, Resident, Role } from "./types";

const link = (resident: Resident) =>
  process.env.APP_URL ? `\n${process.env.APP_URL}/residents/${resident.id}` : "";

export async function sendAlert(resident: Resident, to: Role[], reasons: string[]) {
  const message = text(`【要確認】${resident.name}さん — ${reasons.join("、")}${link(resident)}`);
  const sent = await Promise.all(to.map((role) => push(resident[role].line_id, [message])));
  return sent.some(Boolean);
}

async function sendSnowRequest(resident: Resident, callId: string) {
  const message = buttons(`【除雪のお願い】${resident.name}さん宅の玄関前。雪で外に出られません。`, [
    { label: "引き受けます", data: `snow_accept:${callId}` },
  ]);
  return push(resident.snow_volunteer.line_id, [message]);
}

/** Carries out the rules' actions and reports which ones reached someone. */
export async function runActions(resident: Resident, callId: string, reasons: string[], actions: Action[]) {
  return Promise.all(
    actions.map(async (a) => ({
      ...a,
      sent: a.type === "alert" ? await sendAlert(resident, a.to, reasons) : await sendSnowRequest(resident, callId),
    })),
  );
}
