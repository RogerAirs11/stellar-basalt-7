import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Horse } from '../data/horses';
import { isOneOf, useStoredState } from './hooks';
import { Toast, type ToastAction } from '../components/ui';
import { useViewport } from './viewport';
import type { Density } from '../preferences/config';
import { useHorseDbAdapter } from '../HorseDbAdapter';

type WorkspaceModal = { type: 'help' | 'settings' | 'command' | 'preview'; horseId?: string; text?: string } | null;

interface WorkspaceValue {
  horses: Horse[];
  setHorses: Dispatch<SetStateAction<Horse[]>>;
  /** Stable featured pool (registry-order opening page) — immune to page
   * browses replacing the shared `horses` list. R62. */
  featuredHorses: Horse[];
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  density: Density;
  setDensity: Dispatch<SetStateAction<Density>>;
  effectiveDensity: 'comfortable' | 'compact';
  viewport: ReturnType<typeof useViewport>;
  focusMode: boolean;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  readingSize: boolean;
  setReadingSize: Dispatch<SetStateAction<boolean>>;
  modal: WorkspaceModal;
  openModal: (modal: NonNullable<WorkspaceModal>) => void;
  closeModal: () => void;
  notify: (message: string, action?: ToastAction) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const adapter = useHorseDbAdapter();
  const viewport = useViewport();
  const [horses, setHorses] = useState<Horse[]>(adapter.horses);
  useEffect(() => setHorses(adapter.horses), [adapter.horses]);
  const [name, setNameLocal] = useState(adapter.runtime.user?.display_name || 'Guest');
  useEffect(() => setNameLocal(adapter.runtime.user?.display_name || 'Guest'), [adapter.runtime.user]);
  const setName = setNameLocal as Dispatch<SetStateAction<string>>;
  const [density, setDensity] = useStoredState<Density>('retroastra.presentation.density.v1', 'adaptive', isOneOf(['adaptive', 'compact', 'comfortable']));
  const effectiveDensity = density === 'adaptive' ? viewport.height < 920 || viewport.width < 1150 ? 'compact' : 'comfortable' : density;
  const [focusMode, setFocusMode] = useStoredState('retroastra.presentation.focus.v1', false);
  const [readingSize, setReadingSize] = useStoredState('retroastra.presentation.reading.v1', false);
  const [modal, openModal] = useState<WorkspaceModal>(null);
  const [toast, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string, action?: ToastAction) => {
    setToast({ message, action });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), action ? 6500 : 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return <WorkspaceContext.Provider value={{
    horses, setHorses, featuredHorses: adapter.featuredHorses, name, setName, density, setDensity, effectiveDensity, viewport,
    focusMode, setFocusMode, readingSize, setReadingSize, modal,
    openModal, closeModal: () => openModal(null), notify,
  }}>
    <div data-edition="desk" data-density={effectiveDensity} data-adaptive={density === 'adaptive'} data-height={viewport.veryShort ? 'tiny' : viewport.short ? 'short' : 'normal'} data-reading={readingSize ? 'large' : 'standard'} data-focus={focusMode} style={{ '--viewport-height': `${viewport.height}px` } as React.CSSProperties}>
      {children}
      <AnimatePresence>{toast && <Toast message={toast.message} action={toast.action ? { label: toast.action.label, onClick: () => { clearTimeout(timer.current); setToast(null); toast.action?.onClick(); } } : undefined} />}</AnimatePresence>
    </div>
  </WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('Workspace components must be wrapped in WorkspaceProvider.');
  return workspace;
}
