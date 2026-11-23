import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yukimi",
  description: "Winter check-in calls for older residents of Hokkaido",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">{children}</body>
    </html>
  );
}
