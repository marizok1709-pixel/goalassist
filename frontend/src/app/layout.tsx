import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-full bg-[#050506] text-white">{children}</body>
    </html>
  );
}
