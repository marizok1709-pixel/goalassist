import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "GoalAssist — daily certainty for academic deadlines",
  description:
    "GoalAssist turns academic deadlines into daily certainty: never wonder what to do today, or whether you'll still make it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-page text-ink min-h-full flex flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-8">{children}</main>
      </body>
    </html>
  );
}
