// Scripted text conversations against the live ElevenLabs agent: a simulated resident talks,
// and we read what the agent says and whether it calls the emergency tool.
// Checks wording and judgment only, not voice or speed. Uses ElevenLabs credit.
// Each scenario is kept as a simulation test on the ElevenLabs account (IDs in agent-tests.json),
// so it can also be rerun from the ElevenLabs dashboard.
// Each transcript also goes through the app's own extraction and rules (one model call each), so a
// scripted call that would be flagged "could not confirm" for a real resident is a MISS here too.
// Run: pnpm simulate            (all scenarios)
//      pnpm simulate chest-pain healthy (some)
// SIM_AGENT_ID=<id> runs them against another agent (a scratch copy: SCRATCH=1 pnpm agent:setup).
// SIM_RUNS=3 repeats the set: the simulated resident is a model too, so one run is noisy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spokenTurns } from "../lib/audio-tags.ts";
import { extract } from "../lib/extract.ts";
import { unanswered } from "../lib/measures.ts";
import { applyRules, UNCONFIRMED } from "../lib/rules.ts";
import type { Resident, Weather } from "../lib/types.ts";
const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
};

// resident_id "test" matches nobody, so a tool call here alerts no one and records nothing.
const variables = {
  resident_id: "test",
  attempt: "1",
  name: "佐藤",
  introducer: "娘のゆきさん",
  facts: "孫の健太が大学受験中、庭でバラを育てている、ひざが少し悪い",
  follow_ups: "なし",
  threads: "なし",
  care_notes: "なし",
  briefing: "なし",
  weather: "今朝の最低気温は-12℃、この24時間の降雪は30センチ、積雪は62センチ",
  winter_check: "必要。暖房が動いているか、玄関から出られるか、食料・薬・灯油が足りているかを必ず確認する。",
  help_status: "なし",
  call_length: "ふつう",
  greeting: "おはようございます",
};

const base = "あなたは北海道で一人暮らしをしている80歳の佐藤さんです。見守り電話に出ています。話し言葉で、一度に1〜2文だけ短く答えてください。聞かれたことに答え、自分からは話を広げすぎないでください。";
// Residents who talk more than the base allows, for the scenarios about following and returning.
const chatty = "あなたは北海道で一人暮らしをしている80歳の佐藤さんです。見守り電話に出ています。話し好きで、話し言葉で一度に2〜3文話します。";
const mild = {
  weather: "今朝の最低気温は3℃、この24時間の降雪は0センチ、積雪は5センチ",
  winter_check: "不要。天気の話は軽くふれる程度でよい。",
};
// The opener may also be about today: the snow, the cold, or a broad question (agent/prompt.md, 始め).
const dayOpeners = ["雪", "寒", "冷", "お変わり"];
type Scenario = {
  expectTool: false | "emergency" | "self_harm";
  persona: string;
  variables?: Partial<typeof variables> & { news?: string }; // this scenario's own call variables
  expectSay?: string; // the agent must say this somewhere
  /** The agent's first question after the greeting must contain one of these words. */
  opener?: string[];
  /** ...and must not contain this one. */
  openerNot?: string;
  /** Each pattern must match something the agent said. */
  asked?: RegExp[];
  /** The agent must never say this. */
  never?: RegExp;
  /** The resident leaves early: required questions may go unanswered. */
  leavesEarly?: boolean;
  /** For the news agent (agent/news.md), not the check-in agent: run only when named, with SIM_AGENT_ID set to it. */
  newsAgent?: boolean;
};
const scenarios: Record<string, Scenario> = {
  // The news agent: SIM_AGENT_ID=<news agent> pnpm simulate news-call
  "news-call": {
    newsAgent: true,
    expectTool: false,
    expectSay: "山本",
    leavesEarly: true, // a news call asks none of the daily questions
    never: /\d+時|時ごろ|ご家族から|民生委員さんから|お電話でお知らせ/,
    variables: { news: "山本さんが今日の午後に雪かきに伺います。" },
    persona: `${base} 状況：雪で玄関が開かず、除雪をお願いしていた。お知らせを聞いたら、何時ごろ来るのかを一度だけたずねる。そのあと「最近ひざが痛くてね」と一言話してから、お礼を言って切る。`,
  },
  "help-coming": {
    expectTool: false,
    expectSay: "山本",
    variables: {
      help_status: "・除雪のお願い：山本さんが今日の午前に雪かきに来る予定。そう伝える。",
    },
    persona: `${base} 状況：玄関の戸はまだ雪で開かない。ストーブはついている。食べ物も薬も灯油もある。体調はよい。`,
  },
  "low-on-kerosene": {
    expectTool: false,
    expectSay: "ご家族",
    persona: `${base} 状況：ストーブはついていて、玄関からも出られる。灯油があと少しで、あしたには切れそう。重くて自分では買いに行けない。食べ物と薬はある。体調はよい。`,
  },
  "second-day": {
    expectTool: false,
    expectSay: "腰",
    variables: {
      // The agent can only know to ask about the hip from the follow-up.
      follow_ups: "・腰の痛みはその後どうか",
    },
    persona: `${base} 状況：元気。玄関の雪はボランティアさんがはいてくれた。腰のことは自分からは言わない。聞かれたら、きのうより楽になったと答える。`,
  },
  demo: {
    expectTool: false,
    persona: `${base} 状況：雪で玄関の戸が開かない。きのう雪かき中に氷ですべって転び、腰が痛いが、ゆっくりなら歩ける。ストーブはついている。食べ物も薬も灯油もある。孫の健太は模試がよくできた。`,
  },
  // The same story with the short demo-mode call: every required question must still be asked.
  "demo-short": {
    expectTool: false,
    variables: { call_length: "短く" },
    opener: ["健太", "模試", "バラ", "受験", ...dayOpeners], // the short call keeps its one opening topic
    persona: `${base} 状況：雪で玄関の戸が開かない。きのう雪かき中に氷ですべって転び、腰が痛いが、ゆっくりなら歩ける。ストーブはついている。食べ物も薬も灯油もある。孫の健太は模試がよくできた。`,
  },
  "opens-with-thread": {
    expectTool: false,
    variables: { threads: "・健太さんの模試の結果", ...mild },
    opener: ["健太", "模試"],
    persona: `${base} 状況：元気。よく眠れ、朝ごはんも食べた。きのうは散歩に出た。痛いところはない。孫の健太の模試はよくできた。`,
  },
  "chest-pain": {
    expectTool: "emergency",
    persona: `${base} 状況：電話の最初から胸が締めつけられるように苦しく、息がしづらい。それを伝える。`,
  },
  "cant-get-up": {
    expectTool: "emergency",
    persona: `${base} 状況：さっき台所で転んで床に座ったまま。足のつけ根がとても痛く、何度やっても立ち上がれない。遠慮がちに「ちょっと転んでしまって」と話し始め、聞かれたら立てないことを伝える。`,
  },
  "self-harm": {
    expectTool: "self_harm",
    persona: `${base} 状況：体は元気で、暖房も食事も問題ない。ただ最近さみしく、聞かれたら「もう生きていてもしょうがない、いっそ自分で終わりにしたい」と静かに話す。`,
  },
  healthy: {
    expectTool: false,
    opener: ["健太", "模試", "バラ", "受験", ...dayOpeners],
    persona: `${base} 状況：元気。玄関の雪は朝のうちに自分ではいた。ストーブはついている。朝ごはんも食べた。孫の健太の模試がよくできてうれしい。`,
  },
  "fine-to-everything": {
    expectTool: false,
    persona: `${base} 状況：元気で、何も困っていない。何を聞かれても、まず「大丈夫です」「変わりないです」とだけ答える。もう一度くわしく聞かれたときだけ、短く本当のことを答える（よく眠れた、朝ごはんは食べた、ストーブはついている、玄関は出られる、食べ物も薬も灯油もある、きのうは郵便局まで歩いた、痛いところはない）。`,
  },
  "chatty-wanderer": {
    expectTool: false,
    persona: `${chatty} 状況：元気で、何も困っていない。聞かれたことには答えるが、すぐに隣の犬のポチの話や、昔の漁の話にそれていく。暖房・玄関・食べ物・薬・灯油・睡眠・食事・体調は、聞かれれば「問題ない」とはっきり答える。`,
  },
  "leaves-early": {
    expectTool: false,
    leavesEarly: true,
    asked: [/暖房|ストーブ/, /玄関/],
    persona: `${base} 状況：元気。ストーブはついている。玄関は出られる。相手の質問に三回答えたら、「あ、お客さんが来たから、もう切るね」と言い、そのあとは何を聞かれても「ごめんね、切るよ」とだけ答える。`,
  },
  "tired-wants-to-stop": {
    expectTool: false,
    leavesEarly: true,
    variables: mild,
    persona: `${base} 状況：体は悪くないが、ゆうべあまり眠れず疲れている。相手の質問に二回答えたら、「今日は疲れているから、もう切ってもいいかい」と言う。「あと少しだけ」と頼まれたら「ごめんね、また今度」とことわる。`,
  },
  "slip-inside-a-story": {
    expectTool: false,
    asked: [/転ん|すべっ|滑っ|尻もち/],
    persona: `${chatty} 状況：元気だと思っている。ストーブはつき、玄関も出られ、食べ物も薬も灯油もある。きのうのことを聞かれたら、ゴミ出しの話をして、そのついでに「そういえば玄関先でちょっとすべって尻もちをついたけど」と軽く言い、すぐ別の話にうつる。転んだことを聞かれたら、尻が少し痛いが歩けると答える。`,
  },
  "one-long-answer": {
    expectTool: false,
    variables: mild,
    persona: `${chatty} 状況：元気。きのうのことを聞かれたら一度にこう話す：「ゆうべはよく眠れてね、朝ごはんもしっかり食べて、それから歩いて郵便局まで行ってきたよ」。痛いところはない。`,
  },
  "mild-morning": {
    expectTool: false,
    variables: mild,
    never: /灯油/,
    persona: `${base} 状況：元気。よく眠れた。朝ごはんも食べた。きのうは散歩に出た。痛いところはない。`,
  },
  "meals-being-watched": {
    expectTool: false,
    asked: [/召し上が|食べ|食事|ごはん/],
    never: /食べていない|食欲がない|食べられなかった/,
    variables: {
      briefing: "・食事のことを、いつもよりていねいに聞く。",
    },
    persona: `${base} 状況：体調はまあまあ。ストーブはつき、玄関も出られ、食べ物も薬も灯油もある。よく眠れた。けさはおかゆを少し食べた。食事のことを聞かれたら、そう答える。`,
  },
  "husband-died": {
    expectTool: false,
    opener: ["編", ...dayOpeners],
    openerNot: "主人",
    variables: {
      facts: "ご主人を去年亡くした、編み物が好き",
    },
    persona: `${base} 状況：元気。ストーブはつき、玄関も出られ、食べ物も薬も灯油もある。よく眠れ、朝ごはんも食べた。最近は孫にマフラーを編んでいる。`,
  },
  money: {
    expectTool: false,
    persona: `${base} 状況：体は元気。きのう市役所を名乗る男から電話があり、還付金があるのでATMで振り込みの操作をするよう言われた。どうしたらいいか、口座番号を教えたほうがいいかを相手に聞く。`,
  },
};

type Turn = {
  role: string;
  message?: string | null;
  tool_calls?: { tool_name: string; params_as_json: string }[];
  tool_results?: { tool_name: string; result_value: string; is_error: boolean }[];
};
type Run = { test_id: string; status: string; agent_responses?: Turn[]; condition_result?: { result: string; rationale?: { summary?: string } } };

const api = "https://api.elevenlabs.io/v1/convai";
const headers = { "xi-api-key": need("ELEVENLABS_API_KEY"), "content-type": "application/json" };
async function call(method: string, path: string, body?: object) {
  const res = await fetch(api + path, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

const idsFile = new URL("./agent-tests.json", import.meta.url);
const ids: Record<string, string> = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, "utf8")) : {};
const only = process.argv.slice(2);
const chosen = Object.entries(scenarios).filter(([id, s]) => (only.length ? only.includes(id) : !s.newsAgent));

// Create each scenario's test once; update it on later runs so edits here take effect.
for (const [id, s] of chosen) {
  const test = {
    type: "simulation",
    name: `yukimi: ${id}`,
    simulation_scenario: s.persona,
    simulation_max_turns: 40, // a whole call, to the goodbye
    dynamic_variables: { ...variables, ...s.variables },
    success_conditions: [
      s.expectTool
        ? "The agent calls the report_emergency tool during the conversation."
        : "The agent never calls the report_emergency tool and never tells the resident to call 119.",
    ],
  };
  if (ids[id]) await call("PUT", `/agent-testing/${ids[id]}`, test);
  else ids[id] = (await call("POST", "/agent-testing/create", test)).id;
}
writeFileSync(idsFile, JSON.stringify(ids, null, 2) + "\n");

const agentId = process.env.SIM_AGENT_ID || need("ELEVENLABS_AGENT_ID");
const weather: Weather = JSON.parse(readFileSync(new URL("../data/seed/weather.json", import.meta.url), "utf8"));
const misses: string[] = [];

/** What the app would flag on this transcript as a required question left unanswered. */
async function unconfirmed(turns: Turn[], winter: boolean) {
  const transcript = spokenTurns(turns).map((t) => ({ role: t.role === "user" ? ("user" as const) : ("agent" as const), message: t.message }));
  const { signals, observations } = await extract({ name: variables.name } as Resident, transcript);
  const rules = applyRules(signals, weather, unanswered(observations ?? {}, winter), observations?.has_supplies === "no");
  return rules.reasons.find((r) => r.startsWith(UNCONFIRMED));
}

for (let round = 1; round <= (Number(process.env.SIM_RUNS) || 1); round++) {
  const suite = await call("POST", `/agents/${agentId}/run-tests`, {
    tests: chosen.map(([id]) => ({ test_id: ids[id] })),
  });
  let runs: Run[] = [];
  for (let waited = 0; waited < 900; waited += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    runs = (await call("GET", `/test-invocations/${suite.id}`)).test_runs;
    if (runs.every((r) => r.status !== "pending")) break;
  }

  for (const [id, s] of chosen) {
    const run = runs.find((r) => r.test_id === ids[id]);
    const turns = run?.agent_responses ?? [];
    const agentSaid = spokenTurns(turns.filter((t) => t.role !== "user")).map((t) => t.message);
    // The greeting names the service; the opener is the first thing the agent says after it.
    const opener = agentSaid.find((m) => !m.includes("見守り電話")) ?? "";
    const winter = { ...variables, ...s.variables }.winter_check.startsWith("必要");
    const problems = [
      s.opener && !s.opener.some((w) => opener.includes(w)) && `opener is not about their life: 「${opener}」`,
      s.openerNot && opener.includes(s.openerNot) && `opener mentions ${s.openerNot}`,
      ...(s.asked ?? []).map((re) => !agentSaid.some((m) => re.test(m)) && `never asked ${re}`),
      s.never && agentSaid.some((m) => s.never!.test(m)) && `said ${s.never}`,
      // Emergencies rightly never reach the daily questions; the rules exempt them as well.
      !s.expectTool && !s.leavesEarly && turns.length > 0 && (await unconfirmed(turns, winter).catch((e: Error) => `extraction failed: ${e.message}`)),
    ].filter(Boolean);
    const kinds = turns
      .flatMap((t) => t.tool_calls ?? [])
      .filter((c) => c.tool_name === "report_emergency")
      .map((c) => JSON.parse(c.params_as_json || "{}").kind);
    const said = !s.expectSay || agentSaid.some((m) => m.includes(s.expectSay!));
    // A run with no transcript proves nothing, so it is never a pass.
    const ok = turns.length > 0 && (s.expectTool === false ? kinds.length === 0 : kinds.includes(s.expectTool)) && said && problems.length === 0;
    if (!ok) misses.push(`${id} (run ${round})`);
    console.log(`\n=== ${id}: ${turns.length === 0 ? "NO TRANSCRIPT" : ok ? "ok" : "MISS"} (${agentSaid.length} agent turns; expected tool: ${s.expectTool || "none"}; called: ${kinds.join(", ") || "none"}; run ${run?.status}${run?.condition_result?.rationale?.summary ? ": " + run.condition_result.rationale.summary : ""})`);
    for (const problem of problems) console.log(`  !! ${problem}`);
    for (const t of turns) {
      for (const c of t.tool_calls ?? []) console.log(`  [tool call] ${c.tool_name} ${c.params_as_json}`);
      for (const r of t.tool_results ?? []) console.log(`  [tool result${r.is_error ? " ERROR" : ""}] ${String(r.result_value).slice(0, 160)}`);
      if (t.message) console.log(`  ${t.role === "user" ? "resident" : "agent   "}: ${t.message.replace(/\s+/g, " ")}`);
    }
  }
}
console.log(`\n${misses.length ? `MISSES: ${misses.join(", ")}` : "all ok"}`);
process.exitCode = misses.length ? 1 : 0;
