import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useContextNavigationHost } from '../../../../../frontend-kit';

/** Move one stable host; switching layout does not remount or reset controls. */
export function ContextNavigation({ children }: { children: ReactNode }) {
  const { homeRef, portalHost } = useContextNavigationHost('retro-astra', 'astra102-context', 920);
  return <><div ref={homeRef} className="astra-context-home" />{portalHost && createPortal(children, portalHost)}</>;
}
