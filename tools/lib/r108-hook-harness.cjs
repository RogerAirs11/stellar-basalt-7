'use strict';
/** Deterministic hook lifecycle double, not React/DOM certification. */
function createHookHarness() {
  const slots = []; let cursor = 0; let effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, update => { slots[i].value = typeof update === 'function' ? update(slots[i].value) : update; }];
    },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { deps: [...deps], value: factory() };
      return slots[i].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(setup, deps) {
      const i = cursor++;
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps: [...deps], cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = setup(); });
      }
    },
  };
  return {
    react,
    render(fn) { cursor = 0; return fn(); },
    flush() { const pending = effects; effects = []; pending.forEach(fn => fn()); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); effects = []; },
  };
}
module.exports = { createHookHarness };
