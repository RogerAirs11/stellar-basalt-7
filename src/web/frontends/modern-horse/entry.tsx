import { useEffect } from "react";
import type { FrontendRuntimeProps } from "../../../frontend-kit";

/**
 * Modern Pedigree — hand-over entry.
 *
 * The donor app is a standalone static build (its own HTML document, Google
 * fonts and Tailwind pipeline) served by Workers static assets at
 * /f/modern-horse/. A direct visit to that path never reaches this module —
 * static assets win. This component only covers in-app navigation from the
 * Heritage switcher: it performs a full-page hand-over so the donor's own
 * document (not the Heritage shell) hosts the app, exactly as delivered.
 */
export default function ModernHorseHandover(_: FrontendRuntimeProps) {
  useEffect(() => {
    window.location.assign("/f/modern-horse/");
  }, []);
  return (
    <main className="frontend-load-state" dir="rtl">
      <strong>در حال باز کردن رابط Modern Pedigree…</strong>
      <span>Opening the Modern Pedigree interface…</span>
      <a href="/f/modern-horse/">/f/modern-horse/</a>
    </main>
  );
}
