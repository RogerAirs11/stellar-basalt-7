import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

function viewportSize() {
  return { width: Math.round(window.visualViewport?.width ?? window.innerWidth), height: Math.round(window.visualViewport?.height ?? window.innerHeight) };
}

export function useViewport() {
  const [size, setSize] = useState(viewportSize);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = viewportSize();
        setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
      });
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.visualViewport?.removeEventListener('resize', update); };
  }, []);
  return { ...size, phone: size.width < 640, narrow: size.width < 920, short: size.height < 760, veryShort: size.height < 580 };
}

export function useElementSize<T extends HTMLElement>() {
  // R115: callback ref, not a mount-time ref read — the Pedigree page renders
  // its stage only AFTER ancestry data arrives, so a useLayoutEffect([]) that
  // read ref.current at mount found null and never attached the observer,
  // freezing the measured size at 0x0 (the fit scale then fell to its floor
  // and the tree rendered microscopic). Attaching on element identity means
  // late-mounting elements are measured too.
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}

/** Measure the actual row and remaining scrollport, not an assumed screen breakpoint. */
export function useFittedRows(ref: RefObject<HTMLElement | null>, signature: string, grid: boolean) {
  const [count, setCount] = useState(8);
  useLayoutEffect(() => {
    const host = ref.current;
    const main = document.getElementById('main-content');
    if (!host || !main) return;
    let frame = 0;
    let active = true;
    const measure = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const items = Array.from(host.querySelectorAll<HTMLElement>(grid ? '.horse-grid-item' : 'tbody tr'));
        const item = items[0];
        const itemHeight = Math.max(0, ...items.map(row => row.getBoundingClientRect().height)) || (grid ? 260 : 52);
        const top = host.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
        const footer = host.closest('.directory-register')?.querySelector<HTMLElement>('.pagination');
        const note = main.querySelector<HTMLElement>('.page-bottom-note');
        const headerHeight = grid ? 0 : host.querySelector('thead')?.getBoundingClientRect().height ?? 0;
        const reserve = (footer?.offsetHeight ?? 45) + (note?.offsetHeight ?? 18) + headerHeight + parseFloat(getComputedStyle(main).paddingBottom) + 22;
        const available = main.clientHeight - top - reserve;
        const columns = grid ? Math.max(1, Math.round(host.clientWidth / Math.max(1, item?.getBoundingClientRect().width ?? 250))) : 1;
        const next = Math.max(grid ? columns : 3, Math.min(40, Math.floor(available / (itemHeight + (grid ? 16 : 0))) * columns));
        setCount(previous => previous === next ? previous : next);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    observer.observe(host);
    measure();
    document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ref, signature, grid]);
  return count;
}