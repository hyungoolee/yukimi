# Yukimi demo video: shot list and subtitles

Target length: about 100 s. One resident, Sato-san (佐藤さん), on one snowy morning in Hokkaido.

## Before you shoot

- `.env`: `DEMO_MODE=1`, `WEATHER_SOURCE=saved`. The saved weather is 30 cm of new snow, 62 cm on the ground, and a low of -12 °C, so the call includes the winter checks (heating, front door, food, medicine, kerosene).
- Press **デモをリセット** on the dashboard before each take. It puts residents, calls, ladders and tasks back to the seed state.
- Set `DEMO_JAPAN_HOUR=9` and start the server just before you record. The app's Japan clock then reads 9 o'clock, so the agent greets with おはようございます and the snow helper gets both 今日の午前 and 今日の午後 buttons. You have until the clock reaches 11:00, when the greeting turns to こんにちは; restart the server to set it back to 9.
- The agent itself still knows the real Japan time (`timezone` in `agent/setup.ts` puts it in its prompt). If it says something that doesn't fit a morning, retake.
- Record the dashboard in English (the **English** toggle) for a non-Japanese audience. LINE messages and the call stay in Japanese, so subtitle those.
- No phone line needed: use **ブラウザで通話** for the call, **除雪のお願いを…で引き受ける（デモ）** for the helper's accept, and **除雪のお願いのお知らせをブラウザで（デモ）** for the news call. If LINE is set up, also film the real phones; if not, the dashboard's 送ったメッセージ list shows every message.
- Leave Sato's phone number empty for the ladder beat. With no number, the ladder skips the second call and goes from 電話に出ない to 家族に確認 after 10 s.
- Register everyone's LINE first. Until then, the list shows a red 「…一部の通知がだれにも届きません」 banner in every dashboard shot.

## Recording the dashboard shots

`demo/record.mts` drives the dashboard in Chrome (`pnpm dev` must be running) and saves 1920×1080 .mp4 takes in `demo/takes/`, with an animated cursor.

| Command | Shots | Notes |
|---|---|---|
| `pnpm demo:record save` | | Run once, right after the live call in beat 2. Every later `after-call` take starts from this state, so retakes need no new call. |
| `pnpm demo:record after-call` | 3a, 3b, and the accept | About 25 s: list → Sato's page → summary → messages sent → the デモ accept button. |
| `pnpm demo:record no-answer` | 4b, 4c, 4f | About 50 s, running until the strip ends. It ends red unless Yuki taps 無事です on LINE during the take. |
| `pnpm demo:record map` | 5a | About 12 s. Press デモをリセット first, or the map has no pins. |

Add `--en` for the English dashboard. The news call (3f) and the phones are live, not scripted. The map tiles are drawn at 2× zoom, so they look a little soft.

## Cast

| Role | In the app | Who plays them |
|---|---|---|
| Sato-san, lives alone | `sato` | An older Japanese speaker, with their consent. Voice and hands on camera; the face is optional. |
| Yuki, her daughter in Sapporo | `p_yuki` (family) | Anyone. Their phone and hands are on camera. |
| Yamamoto, snow helper | `p_yamamoto` | Anyone. Their phone, a shovel and boots are on camera. |
| Yukimi | ElevenLabs voice "Hiyori" | The app |

## Shots

The agent's lines are generated live, so the Yukimi lines below are what the prompt steers it toward, not fixed text. Sato's lines are her script. Subtitle the take you actually use; only lines marked **fixed** come out word for word.

### 1. Cold open (0:00–0:10)

| Shot | Picture | Sound / text |
|---|---|---|
| 1a | Snow-covered houses, a buried front door (stock footage or a real street) | Wind. Text: **Hokkaido. -12 °C. 30 cm of snow overnight.** |
| 1b | A kitchen: a kotatsu, a radio, a clock reading 8:59 | Text: **Sato-san, 82, lives alone.** |
| 1c | The phone on the table lights up | Ring, then cut to 2a |

Add one sourced statistic about older people living alone in Japan here if you have it. Don't use an unsourced number.

### 2. The call (0:10–0:45)

Split screen: Sato at the table on the left, the ブラウザで通話 live captions on the right.

| Shot | Speaker | Japanese | English subtitle |
|---|---|---|---|
| 2a | Yukimi (**fixed** first line) | もしもし、佐藤さんですか。おはようございます。娘のゆきさんからご紹介いただいた、見守り電話です。 | Hello, is this Sato-san? Good morning. This is your check-in call. Your daughter Yuki set it up. |
| 2b | Sato | はい、おはようございます。 | Yes, good morning. |
| 2c | Yukimi | 健太さんの模試の結果は、出ましたか？ | Did Kenta get his mock exam results back? |
| 2d | Sato (smiling) | それがね、A判定だったのよ。 | He did. He got an A! |
| 2e | Yukimi | まあ、よかったですね。 | Oh, that's wonderful. |
| 2f | Yukimi | 先にいくつかだけ、確認させてくださいね。暖房は動いていて、今朝は玄関から出られそうですか？食料やお薬、灯油は足りていますか？ | First, a few quick checks. Is the heating working, and can you get out the front door this morning? Do you have enough food, medicine and kerosene? |
| 2g | Sato | 暖房も食べ物も大丈夫。でもね、夜のうちにずいぶん積もって、玄関が開かないの。 | The heating and food are fine. But it piled up overnight, and I can't open the front door. |
| 2h | Yukimi (**fixed** by the prompt) | 除雪をお願いしておきますね。来る時間が決まったら、お電話でお知らせしますね。 | I'll ask someone to clear the snow. I'll call you once we know when they're coming. |
| 2i | | *(cut: health, sleep and meals)* | |
| 2j | Yukimi | ありがとうございました。 | Thank you, Sato-san. |

Shot 2c is the moment to land: the agent remembers the grandson's exam from an earlier call. Add a 1-second insert of the dashboard's 次の電話で確認すること list showing 健太さんの模試の結果 just before it.

### 3. The call turns into help (0:45–1:15)

| Shot | Picture | Sound / text |
|---|---|---|
| 3a | Dashboard list: Sato's card updates with the snowed-in reason and its badge | Text: **Within a minute of hanging up** |
| 3b | Sato's page: the call summary, 冬の状況, and the week grid with today filled in | Light UI sounds |
| 3c | Yamamoto's phone, LINE: **【除雪のお願い】佐藤さん宅の玄関前。雪で外に出られません。行ける時間を押してください。** with time buttons and 行けません | Subtitle: *Snow clearing request: Sato-san's front door. She's snowed in. Tap when you can come.* |
| 3d | Yamamoto's thumb taps **今日の午前** (or 今日の午後) | Tap sound |
| 3e | Yuki's phone, LINE: **山本さんが今日の午前、佐藤さん宅の雪かきに伺います。** | Subtitle: *Yamamoto-san is coming to clear Sato-san's snow this morning.* |
| 3f | Sato's phone rings again. The news call, **fixed** text: 山本さんが今日の午前に雪かきに伺います。 then お知らせは以上です。ありがとうございました。 | Subtitle: *Yamamoto-san is coming to clear your snow this morning. That's all for now. Thank you.* |
| 3g | Yamamoto shoveling the front step, then the door opening | Scrape of the shovel |

Without a LINE setup, shoot 3c–3e as the dashboard's 送ったメッセージ entries and press the デモ accept button instead.

### 4. The morning she doesn't answer (1:15–1:35)

Text card: **The next morning.** Press **電話に出ない（デモ）** off camera and record the strip at the top of Sato's page.

| Shot | Picture | Sound / text |
|---|---|---|
| 4a | The phone rings on an empty kitchen table | Ringing that isn't picked up |
| 4b | Ladder strip: **✓ 電話に出ない ─ ● もう一度かける (10秒)** counting down | Clock ticks. Text: **No answer. Trying again.** |
| 4c | Strip moves to **● ゆきさんに確認 (20秒)** | |
| 4d | Yuki at work. LINE: **佐藤さんが見守りの電話に2回出ませんでした。今日、ご様子を確認できていますか？** with **無事です** / **確認できません** | Subtitle: *Sato-san missed her check-in call twice. Have you been able to check on her today?* |
| 4e | Yuki calls her mother; a short shot of Sato answering from the neighbor's house | Muffled 「ごめんね、お隣にいたのよ」 / *Sorry, I was next door.* |
| 4f | Yuki taps **無事です**, and the strip ends in green: **✓ 無事を確認** | A soft chime |

If nobody taps in 20 seconds (or Yuki taps 確認できません), the strip ends red on **緊急連絡** and the helper and family get a LINE alert. Use that as an alternative take if you want the safety net to fire on screen.

### 5. Close (1:35–1:45)

| Shot | Picture | Sound / text |
|---|---|---|
| 5a | The 地図 view: resident pins and snow helpers over the town | Text: **Every morning, every resident.** |
| 5b | Logo | **Yukimi: a winter check-in call for those who live alone.** |

Keep the 国土地理院 map credit visible in 5a.

## Post-production

- Burn in English subtitles. Show Japanese LINE text on screen as it is, with the English below.
- Speed-ramp 4b–4c: the 30-second ladder plays in about 6 seconds.
- Music: quiet piano. Drop it out completely at 4a so the unanswered ring stands alone, and bring it back at 4f.
- Caption the AI voice once, in 2a: *Yukimi is an AI voice. It says so if asked.*
