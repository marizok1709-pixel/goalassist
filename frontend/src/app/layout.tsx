import type { Metadata } from "next";
import "./globals.css";
import { CursorTexture } from "@/components/cursor-texture";
import { ConsentGate } from "@/components/consent";

export const metadata: Metadata = {
  title: "GoalAssist — daily certainty for academic deadlines",
  description:
    "GoalAssist turns academic deadlines into daily certainty: never wonder what to do today, or whether you'll still make it.",
};

/* Runs before first paint so the stored theme is on <html> by the time any
   pixel is drawn — otherwise the light default renders for a frame and the app
   flashes. Kept deliberately tiny and dependency-free. Dark stays the default
   for users with no stored preference, matching the product today. */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("goalassist_theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-full bg-bg text-ink">
        <CursorTexture />
        {children}
        <ConsentGate />
      </body>
    </html>
  );
}
