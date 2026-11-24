import type { Resident, Weather } from "./types";

export type Lang = "ja" | "en";

const ja = {
  switchTo: "English",
  title: "見守りリスト",
  back: "← 見守りリスト",
  weather: (w: Weather) => `今朝の最低気温は${w.low_c}℃、この24時間の降雪は${w.snowfall_24h_cm}センチ、積雪は${w.snow_depth_cm}センチ`,
  name: (r: Resident) => `${r.name}さん`,
  last: (time: string) => `最終 ${time}`,
  daily: (time: string) => `毎日 ${time}`,
  badge: { red: "すぐ確認", yellow: "訪問リスト", green: "問題なし", none: "通話なし" },
  snowRequest: "除雪のお願い：",
  snowAccepted: (r: Resident) => `${r.snow_volunteer.name}さんが引き受けました`,
  snowWaiting: "返事待ち",
  callNow: "今すぐ電話",
  addPhone: "電話番号を登録",
  markHandled: "対応済みにする",
  phone: "電話番号",
  save: "保存",
  phoneHint: "090… または +81…（海外の番号は + から）",
  browserCall: "ブラウザで通話",
  connecting: "接続中…",
  endCall: "通話を終了",
  micError: "マイクの使用を許可してください",
  noAnswerDemo: "電話に出ない（デモ）",
  callLog: "通話の記録",
  noCalls: "まだ通話がありません",
  summary: "まとめ",
  mood: "気分",
  health: "体調",
  winter: "冬の状況",
  needs: "困りごと",
  none: "なし",
  showTranscript: "会話を見る",
  history: "これまでのまとめ",
  separator: "、",
};

const en: typeof ja = {
  switchTo: "日本語",
  title: "Check-in list",
  back: "← Check-in list",
  weather: (w) => `This morning: low ${w.low_c}°C, ${w.snowfall_24h_cm} cm of snow in 24 hours, ${w.snow_depth_cm} cm on the ground`,
  // Seed residents have no romanized name; their ID is the family name in romaji.
  name: (r) => `${r.id.charAt(0).toUpperCase()}${r.id.slice(1)}-san`,
  last: (time) => `Last call ${time}`,
  daily: (time) => `Daily at ${time}`,
  badge: { red: "Check now", yellow: "Visit list", green: "All fine", none: "No calls" },
  snowRequest: "Snow-clearing request: ",
  snowAccepted: () => "accepted by the volunteer",
  snowWaiting: "waiting for a reply",
  callNow: "Call now",
  addPhone: "Add a phone number",
  markHandled: "Mark as handled",
  phone: "Phone",
  save: "Save",
  phoneHint: "090… or +81… (other countries: start with +)",
  browserCall: "Call in browser",
  connecting: "Connecting…",
  endCall: "End call",
  micError: "Please allow microphone access",
  noAnswerDemo: "No answer (demo)",
  callLog: "Call log",
  noCalls: "No calls yet",
  summary: "Summary",
  mood: "Mood",
  health: "Health",
  winter: "Winter",
  needs: "Needs",
  none: "None",
  showTranscript: "Show conversation",
  history: "Earlier summaries",
  separator: "; ",
};

export const strings = { ja, en };
export type Strings = typeof ja;

// The fixed reasons written by the rules, the ladder and the emergency tool. Anything after the
// matched text (such as what the resident said) is kept as written.
const REASONS_EN: [string, string][] = [
  ["緊急の訴え（119番を案内）", "Emergency (told to call 119)"],
  ["死にたい気持ちの訴え", "Talked about wanting to die"],
  ["転倒・痛みあり", "Fell and is in pain"],
  ["転倒（痛みなし）", "Fell, no pain"],
  ["暖房が使えない（氷点下）", "No heating, below freezing"],
  ["暖房の不調", "Heating problem"],
  ["お金を求める電話・訪問があった（詐欺の疑い）", "Someone asked them for money (possible scam)"],
  ["雪で外に出られない・暖房も使えない", "Snowed in with no heating"],
  ["雪で玄関から出られない", "Snowed in"],
  ["食事をとれていない", "Not eating"],
  ["混乱した様子", "Seems confused"],
  ["気分の落ち込み", "Low mood"],
  ["電話に2回応答なし。第二連絡先からも返事なし", "No answer twice; no reply from the second contact"],
  ["電話に2回応答なし。第二連絡先も確認できず", "No answer twice; the second contact can't confirm"],
  ["電話に応答なし。", "No answer. Second contact confirmed they are fine: "],
  ["自動判定に失敗。通話メモを確認してください", "Automatic check failed; please read the call notes"],
  ["通話の処理に失敗。確認してください", "Processing the call failed; please check"],
];

export function reasonText(lang: Lang, reason: string) {
  if (lang === "ja") return reason;
  const match = REASONS_EN.find(([japanese]) => reason.startsWith(japanese));
  return match ? match[1] + reason.slice(match[0].length) : reason;
}
