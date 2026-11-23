/** Native forms own validation and keyboard submission, including footer buttons. */
const horseActions = new Set(['submit-claim', 'submit-change', 'save-horse']);
const adminActions = new Set(['submit-review', 'create-horse', 'create-content', 'save-content', 'submit-ai-generate']);

export function prepareModalForms(slot) {
  for (const [index, label] of [...slot.querySelectorAll('label')].entries()) {
    if (label.htmlFor || label.querySelector('input, select, textarea')) continue;
    const control = label.closest('.field')?.querySelector('input, select, textarea');
    if (!control) continue;
    if (!control.id) control.id = `classic-modal-field-${index}`;
    label.htmlFor = control.id;
  }
  const form = slot.querySelector('form');
  if (!form) return;
  for (const button of slot.querySelectorAll('.modal-foot button[data-action]')) {
    const action = button.dataset.action;
    if (!horseActions.has(action) && !adminActions.has(action)) continue;
    form.dataset.submitAction = action;
    for (const [key, value] of Object.entries(button.dataset)) if (key !== 'action') form.dataset[key] = value;
    button.removeAttribute('data-action');
    button.type = 'submit';
    button.setAttribute('form', form.id);
  }
}

export async function dispatchModalForm(form, handlers) {
  const action = form.dataset.submitAction;
  const handler = horseActions.has(action) ? handlers.horse : adminActions.has(action) ? handlers.admin : null;
  if (!handler) return false;
  if (!form.reportValidity()) return true;
  await handler(action, form);
  return true;
}
