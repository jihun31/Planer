export const isEditingTarget = target => Boolean(target?.closest?.(
  'input, textarea, select, [contenteditable], [role="textbox"]'));

export const hasVisibleModal = () => Boolean(document.querySelector('dialog[open]'))
  || [...document.querySelectorAll('.modal-overlay')].some(overlay => !overlay.closest('[hidden]'));
