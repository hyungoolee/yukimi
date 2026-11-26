import type { Weather } from "@/lib/types";

// The demo's opening: one day of Sato-san's winter, before the dashboard shows what Yukimi does about it.
// Fiction, written to match her seed file (data/seed/residents/sato.json) and the people near her pin on the map.
// The weather and call time come from the app, so the story says what the dashboard will show next.

const md = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return { m, d };
};

const ja = {
  kicker: "デモ・はじめに",
  title: (who: string) => `${who}の冬`,
  place: "岩見沢のはずれ。札幌から車で1時間。",
  neighbour: "となりの家までは、雪の道を歩いて10分。",
  intro: (who: string) => `${who}、81歳。この家で、一人で暮らしています。`,
  facts: ["庭でバラを育てている", "孫の健太くんは高校3年生", "ひざが少し悪い", "娘のゆきさんは東京で働いている"],
  dayTitle: (date: string) => {
    const { m, d } = md(date);
    return `${m}月${d}日の一日`;
  },
  day: (w: Weather) => [
    {
      time: "6:00",
      text:
        w.snowfall_24h_cm > 0
          ? `目をさますと、窓の外は真っ白。一晩で${w.snowfall_24h_cm}センチ積もった。外は${w.low_c}℃。`
          : `目をさますと、外は${w.low_c}℃。窓ガラスが凍っている。`,
    },
    { time: "6:30", text: "灯油ストーブをつける。タンクは、あと2日分。配達の車は、この雪で来られるだろうか。" },
    {
      time: "8:00",
      text: `玄関の戸が、雪に押されて半分しか開かない。積雪${w.snow_depth_cm}センチ。ひざが痛くて、雪かきはできない。`,
    },
    { time: "12:00", text: "お昼は、きのうの煮物の残り。道があくまで、買い物には行けない。" },
    { time: "15:00", text: "今日はまだ、だれとも話していない。" },
    { time: "19:00", text: "ゆきさんに電話しようか迷って、やめる。「忙しいだろうから」。" },
  ],
  ifTitle: "もし今日、雪の中で転んだら。",
  ifQuestion: "だれが気づくでしょう。",
  people: [
    { who: "娘のゆきさん", text: "東京にいる。週末には電話をくれるが、平日に何かあっても、すぐには分からない。" },
    { who: "民生委員の田中さん", text: "地区の何十人もを受け持っている。佐藤さんを訪ねられるのは、月に一、二度。" },
    { who: "雪かきの山本さん", text: "近くに住んでいて、頼めば来てくれる。でも佐藤さんは「迷惑をかけたくない」と、頼まない。" },
  ],
  problem: "北海道の冬に危ないのは、寒さや雪だけではありません。困っていることに、だれも気づかないこと。そして本人が、助けを呼ばないことです。",
  yukimiTitle: (time: string) => `毎朝${time}、Yukimiが電話をかけます。`,
  yukimi:
    "顔なじみのように話を聞きながら、暖房・玄関・食料・薬・灯油を確かめます。困りごとがあれば、家族と地域の人に知らせて、来てくれる人を探します。",
  toResident: (who: string) => `${who}の今朝を見る`,
  toList: "見守りリストへ",
  fiction: "登場する人物はすべて架空です。",
};

const en: typeof ja = {
  kicker: "Demo · Before we start",
  title: (who) => `${who}'s winter`,
  place: "The edge of Iwamizawa, an hour's drive from Sapporo.",
  neighbour: "The nearest house is a ten-minute walk down a snowy road.",
  intro: (who) => `${who} is 81. She lives in this house on her own.`,
  facts: ["Grows roses in the garden", "Grandson Kenta is in his last year of high school", "Has a bad knee", "Daughter Yuki works in Tokyo"],
  dayTitle: (date) => {
    const { m, d } = md(date);
    return `One day: ${new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`;
  },
  day: (w) => [
    {
      time: "6:00",
      text:
        w.snowfall_24h_cm > 0
          ? `She wakes to white windows. ${w.snowfall_24h_cm} cm of snow fell overnight, and it is ${w.low_c}°C outside.`
          : `She wakes to frost on the windows. It is ${w.low_c}°C outside.`,
    },
    { time: "6:30", text: "She lights the kerosene heater. Two days of fuel left. Will the delivery truck get through this snow?" },
    { time: "8:00", text: `The front door opens only halfway against ${w.snow_depth_cm} cm of snow. With her knee, she can't shovel it.` },
    { time: "12:00", text: "Lunch is what's left of yesterday's stew. No shopping until the road is cleared." },
    { time: "15:00", text: "She hasn't spoken to anyone today." },
    { time: "19:00", text: "She thinks about calling Yuki, then doesn't. \"She's busy.\"" },
  ],
  ifTitle: "If she slipped in the snow today,",
  ifQuestion: "who would know?",
  people: [
    { who: "Yuki, her daughter", text: "Lives in Tokyo. She calls at weekends, but would not hear right away if something happened on a weekday." },
    { who: "Tanaka-san, welfare commissioner", text: "Looks after dozens of people in the district, and can visit Sato-san once or twice a month." },
    { who: "Yamamoto-san, snow helper", text: "Lives nearby and would come if asked. But Sato-san doesn't ask: she doesn't want to be a bother." },
  ],
  problem:
    "In a Hokkaido winter, the danger isn't only the cold and the snow. It's that nobody notices when something is wrong, and that she won't call for help herself.",
  yukimiTitle: (time) => `Every morning at ${time}, Yukimi calls her.`,
  yukimi:
    "It chats like someone she knows while checking heating, the front door, food, medicine and kerosene. When she needs help, it tells her family and neighbours and finds someone who can come.",
  toResident: (who) => `See ${who}'s morning`,
  toList: "Go to the check-in list",
  fiction: "Everyone in this story is fictional.",
};

export const storyText = { ja, en };
