import React from "react";

/**
 * R37 — shared hover-tooltip chip.
 *
 * Reuses the Appearance Studio `.theme-help` visual language so the whole
 * product explains its specialist terms the same way: a small "?" chip that
 * reveals a plain-language explanation on hover or keyboard focus. Keep the
 * copy ELI12: one or two short sentences, no jargon inside the explanation.
 */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  return <span className="theme-help hdb-info-tip" tabIndex={0} role="img" aria-label={label ? `${label}: ${text}` : text} data-tip={text}>?</span>;
}
