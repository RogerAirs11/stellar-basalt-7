import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface Breeding {
  sId: string;
  mId: string;
  setS: (id: string) => void;
  setM: (id: string) => void;
}
const Ctx = createContext<Breeding | null>(null);

/** Keeps the chosen stallion/mare while moving between breeding tabs and horse pages. */
export function BreedingProvider({ children }: { children: ReactNode }) {
  const [sId, setS] = useState('ramin');
  const [mId, setM] = useState('nika');
  const v = useMemo(() => ({ sId, mId, setS, setM }), [sId, mId]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useBreeding() {
  const c = useContext(Ctx);
  if (!c) throw new Error('BreedingProvider missing');
  return c;
}
