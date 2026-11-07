/** A short confirmation for actions that leave no visible trace, like copying a link. */
let timer = 0;

export function toast(message: string) {
  const el = document.querySelector<HTMLElement>('[data-toast]');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-on');
  void el.offsetWidth; // restart the entrance when toasts arrive back to back
  el.classList.add('is-on');
  clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('is-on'), 1900);
}
