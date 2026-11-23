import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { retroHashForHostRoute } from './routeBridge';

export function isOneOf<const T extends string>(values: readonly T[]) {
  return (value: unknown): value is T => typeof value === 'string' && values.includes(value as T);
}

export function useStoredState<T>(key: string, initial: T, validate?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return initial;
      const parsed: unknown = JSON.parse(stored);
      if (validate && !validate(parsed)) return initial;
      if (Array.isArray(initial) ? !Array.isArray(parsed) : typeof parsed !== typeof initial || parsed === null) return initial;
      return parsed as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The workspace remains usable when browser storage is unavailable.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export type Page = 'home' | 'horses' | 'profile' | 'pedigree' | 'collections' | 'newsroom' | 'insights' | 'assistant' | 'directory-profile' | 'organization-profile' | 'workspaces' | 'directory' | 'services';
export interface Route {
  page: Page;
  id?: string;
  query: string;
  filter: string;
  /** R37 parity: deep-linked person profile (``#/collections/people?person=<id>``). */
  person?: string;
}

function readRoute(hash = window.location.hash): Route {
  const [path, queryString] = hash.replace(/^#\/?/, '').split('?');
  const [section, id] = path.split('/');
  const params = new URLSearchParams(queryString);
  const valid = ['horses', 'pedigree', 'collections', 'newsroom', 'insights', 'assistant', 'directory-profile', 'organization-profile', 'workspaces', 'directory', 'services'];
  const page = section === 'horses' && id ? 'profile' : valid.includes(section) ? section as Page : 'home';
  let decodedId = id;
  try { decodedId = id ? decodeURIComponent(id) : id; } catch { /* Keep malformed links on the not-found record view. */ }
  return { page, id: decodedId || undefined, query: params.get('q') ?? '', filter: params.get('filter') ?? '', person: params.get('person') ?? undefined };
}

export function useRoute(hostRoute = window.location.pathname) {
  const [route, setRoute] = useState(() => readRoute(window.location.hash || retroHashForHostRoute(hostRoute, window.location.search)));
  const previousHost = useRef(hostRoute);
  useLayoutEffect(() => {
    if (previousHost.current === hostRoute && window.location.hash) return;
    previousHost.current = hostRoute;
    const hash = retroHashForHostRoute(hostRoute, window.location.search);
    // Replace avoids a phantom Back entry merely from mounting this frontend.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
    setRoute(readRoute(hash));
  }, [hostRoute]);
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
