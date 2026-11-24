// What the person playing the resident says on a demo call, shown (collapsed) on the resident page
// in demo mode. The agent leads, so each line is keyed to what the agent has just done.
export type DemoLine = {
  when: { ja: string; en: string };
  say: string;
  romaji: string;
  meaning: string;
  /** Only fits a resident whose seeded memory mentions this person. */
  needsFact?: string;
};

export const DEMO_SCRIPT: DemoLine[] = [
  {
    when: { ja: "あいさつされたら", en: "Greets you" },
    say: "はい、おはようございます。",
    romaji: "Hai, ohayō gozaimasu.",
    meaning: "Yes, good morning.",
  },
  {
    when: { ja: "暖房を聞かれたら", en: "Asks if the heating is on" },
    say: "ストーブはついています。でも、雪で玄関の戸が開かないんです。",
    romaji: "Sutōbu wa tsuite imasu. Demo, yuki de genkan no to ga akanai n desu.",
    meaning: "The stove is on. But the snow has blocked my front door.",
  },
  {
    when: { ja: "食料・薬・灯油を聞かれたら", en: "Asks about food, medicine and kerosene" },
    say: "食べ物も薬も灯油もあります。",
    romaji: "Tabemono mo kusuri mo tōyu mo arimasu.",
    meaning: "I have food, medicine and kerosene.",
  },
  {
    when: { ja: "除雪をお願いすると言われたら", en: "Says it will ask a snow volunteer" },
    say: "きのう雪かきをしていて、氷ですべって転びました。",
    romaji: "Kinō yukikaki o shite ite, kōri de subette korobimashita.",
    meaning: "Yesterday I slipped on the ice while clearing snow, and fell.",
  },
  {
    when: { ja: "痛みや歩けるかを聞かれたら", en: "Asks if it hurts, or if you can walk" },
    say: "腰が痛いです。ゆっくりなら歩けます。",
    romaji: "Koshi ga itai desu. Yukkuri nara arukemasu.",
    meaning: "My hip hurts. I can walk slowly.",
  },
  {
    when: { ja: "孫の模試を聞かれたら", en: "Asks about your grandson's exam" },
    say: "健太は、よくできたそうです。",
    romaji: "Kenta wa, yoku dekita sō desu.",
    meaning: "Kenta says it went well.",
    needsFact: "健太",
  },
  {
    when: { ja: "ほかに困りごとを聞かれたら", en: "Asks if anything else is wrong" },
    say: "いいえ、大丈夫です。ありがとうございました。",
    romaji: "Iie, daijōbu desu. Arigatō gozaimashita.",
    meaning: "No, I'm fine. Thank you.",
  },
  {
    when: { ja: "2回目の電話：だれがいつ来るか言われたら", en: "Second call: says who is coming, and when" },
    say: "まあ、助かります。ありがとうございます。",
    romaji: "Mā, tasukarimasu. Arigatō gozaimasu.",
    meaning: "Oh, that's a great help. Thank you.",
  },
];
