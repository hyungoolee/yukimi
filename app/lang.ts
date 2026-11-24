import { cookies } from "next/headers";
import { strings, type Lang } from "@/lib/i18n";

/** The dashboard language chosen with the toggle; Japanese unless switched. */
export async function getLang(): Promise<Lang> {
  return (await cookies()).get("lang")?.value === "en" ? "en" : "ja";
}

export async function getStrings() {
  const lang = await getLang();
  return { lang, t: strings[lang] };
}
