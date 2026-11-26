import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DEMO_MODE } from "@/lib/env";
import { getResident } from "@/lib/store";
import { getWeather } from "@/lib/weather";
import { getStrings } from "../lang";
import { storyText } from "./text";

/** Demo only: the story the demo opens with, one winter day of the seeded resident Sato-san, living alone. */
export default async function Story() {
  await connection(); // the weather and call time are read on every request, like the dashboard's
  const resident = DEMO_MODE ? await getResident("sato") : null;
  if (!resident) notFound();
  const { lang, t } = await getStrings();
  const s = storyText[lang];
  const weather = await getWeather(resident.amedas_station);
  const who = t.name(resident);

  return (
    <main className="bg-slate-50 text-slate-900">
      <section>
        <div className="relative h-[40svh] min-h-64 overflow-hidden">
          <Scene />
        </div>
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-6">
          <p className="text-sm font-medium tracking-wide text-sky-700">{s.kicker}</p>
          <h1 className="mt-2 text-4xl font-semibold sm:text-5xl">{s.title(who)}</h1>
          <p className="mt-4 text-lg text-slate-700">{s.place}</p>
          <p className="text-lg text-slate-700">{s.neighbour}</p>
          <p className="mt-6 text-xl">{s.intro(who)}</p>
          <ul className="mt-4 flex flex-wrap gap-2 text-sm">
            {s.facts.map((fact) => (
              <li key={fact} className="rounded-full bg-white/80 px-3 py-1 text-slate-700 ring-1 ring-slate-200">
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto w-full max-w-3xl">
          <h2 className="text-2xl font-semibold">{s.dayTitle(weather.date)}</h2>
          <ol className="mt-8 border-l-2 border-sky-200">
            {s.day(weather).map(({ time, text }) => (
              <li key={time} className="relative pb-8 pl-8 last:pb-0">
                <span className="absolute -left-[7px] top-2 h-3 w-3 rounded-full bg-sky-500 ring-4 ring-slate-50" />
                <p className="text-sm font-semibold tabular-nums text-sky-700">{time}</p>
                <p className="mt-1 text-lg">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white px-6 py-16">
        <div className="mx-auto w-full max-w-3xl">
          <h2 className="text-2xl text-slate-600">{s.ifTitle}</h2>
          <p className="mt-1 text-4xl font-semibold">{s.ifQuestion}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {s.people.map(({ who, text }) => (
              <li key={who} className="rounded-lg border border-slate-200 p-4">
                <p className="font-medium">{who}</p>
                <p className="mt-2 text-sm text-slate-600">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 border-l-4 border-red-500 pl-4 text-xl font-medium">{s.problem}</p>
        </div>
      </section>

      <section className="bg-slate-900 px-6 py-16 text-white">
        <div className="mx-auto w-full max-w-3xl">
          <h2 className="text-3xl font-semibold">{s.yukimiTitle(resident.call_time)}</h2>
          <p className="mt-4 text-lg text-slate-300">{s.yukimi}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/residents/${resident.id}`} className="rounded bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100">
              {s.toResident(who)} →
            </Link>
            <Link href="/" className="rounded border border-slate-500 px-4 py-2 hover:bg-slate-800">
              {s.toList}
            </Link>
          </div>
          <p className="mt-10 text-xs text-slate-500">{s.fiction}</p>
        </div>
      </section>
    </main>
  );
}

// Flakes at fixed places, so the server and the browser draw the same picture.
const FLAKES = Array.from({ length: 48 }, (_, i) => ({
  x: (i * 37) % 100,
  r: 1 + (i % 3) * 0.6,
  delay: -((i * 1.7) % 12),
  duration: 9 + (i % 5) * 1.5,
}));

/** A lone house in deep snow above the story's title, with snow falling. Decoration only. */
function Scene() {
  return (
    <div aria-hidden className="absolute inset-0">
      <div className="absolute inset-0 bg-gradient-to-b from-slate-300 via-slate-200 to-slate-50" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 170 1200 240" preserveAspectRatio="xMidYMax slice">
        <path d="M0 260 Q 250 200 520 250 T 1200 230 V500 H0Z" fill="#e2e8f0" />
        <g fill="#94a3b8" opacity="0.55">
          {[80, 140, 190, 420, 790, 1010, 1060, 1120].map((x, i) => (
            <path key={x} d={`M${x} ${250 - (i % 2) * 12} l22 60 h-44z`} />
          ))}
        </g>
        <g transform="translate(525 250)">
          <rect x="0" y="40" width="150" height="90" fill="#cbd5e1" />
          <path d="M-18 46 L75 -10 L168 46 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="3" />
          <rect x="22" y="66" width="34" height="28" fill="#fcd34d" />
          <rect x="96" y="72" width="30" height="58" fill="#64748b" />
          <path d="M-30 130 Q 75 98 190 130 Z" fill="#f8fafc" />
        </g>
        <path d="M0 330 Q 300 300 640 340 T 1200 320 V500 H0Z" fill="#f8fafc" />
      </svg>
      <div className="absolute inset-0">
        {FLAKES.map((f, i) => (
          <span
            key={i}
            className="snowflake absolute -top-4 rounded-full bg-white"
            style={{ left: `${f.x}%`, width: f.r * 4, height: f.r * 4, animationDelay: `${f.delay}s`, animationDuration: `${f.duration}s` }}
          />
        ))}
      </div>
    </div>
  );
}
