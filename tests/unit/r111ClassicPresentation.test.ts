// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
// The standalone browser app deliberately ships native JavaScript modules.
// @ts-expect-error Native JavaScript module has no separate declaration file.
import { captureFormState, restoreFormState, localizeDomainValue } from '../../standalone-frontends/classic-v1.4/public/ui/presentationState.js';

describe('R111 Classic presentation changes', () => {
  it('restores the in-memory draft and caret without replacing fresh hidden tokens', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    host.innerHTML = '<form id="edit"><input name="name" value="Original"><input name="version" type="hidden" value="1"><textarea name="note"></textarea></form>';
    const input = host.querySelector<HTMLInputElement>('input[name="name"]')!;
    input.value = 'Unsubmitted draft'; input.focus(); input.setSelectionRange(3, 6);
    host.querySelector('textarea')!.value = 'متن حفظ‌شده';
    const snapshot = captureFormState(host);
    host.innerHTML = '<form id="edit"><input name="name" value="Loaded"><input name="version" type="hidden" value="2"><textarea name="note"></textarea></form>';
    restoreFormState(host, snapshot);
    const restored = host.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(restored.value).toBe('Unsubmitted draft'); expect(restored.selectionStart).toBe(3); expect(document.activeElement).toBe(restored);
    expect(host.querySelector('textarea')!.value).toBe('متن حفظ‌شده');
    expect(host.querySelector<HTMLInputElement>('input[type="hidden"]')!.value).toBe('2');
    host.remove();
  });
  it('translates display vocabulary without altering unknown registry values', () => {
    expect(localizeDomainValue('Mare', 'fa')).toBe('مادیان');
    expect(localizeDomainValue('Bay', 'fa')).toBe('کهر');
    expect(localizeDomainValue('Arabian', 'fa')).toBe('عرب');
    expect(localizeDomainValue('Mare', 'en')).toBe('Mare');
    expect(localizeDomainValue('Unmapped historic name', 'fa')).toBe('Unmapped historic name');
  });
});
