import type { Metadata } from "next";
import { setLanguage } from "./actions";
import { getStrings } from "./lang";
import { Refresh } from "./refresh";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yukimi",
  description: "Winter check-in calls for older residents of Hokkaido",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang, t } = await getStrings();
  return (
    <html lang={lang} className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">
        <form action={setLanguage} className="absolute right-4 top-4">
          <input type="hidden" name="lang" value={lang === "ja" ? "en" : "ja"} />
          <button className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50">
            {t.switchTo}
          </button>
        </form>
        {children}
        <Refresh />
      </body>
    </html>
  );
}
