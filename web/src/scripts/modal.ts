/** A native modal owns focus containment and makes the rest of the page inert. */
export type ModalOptions = {
  title: string;
  trigger?: HTMLElement;
  onClose?: () => void;
};
let nextModalId = 0;
const activeModals = new Set<{close: () => boolean}>();

export function createModal({title, trigger, onClose}: ModalOptions) {
  const dialog = document.createElement('dialog');
  dialog.className = 'admin-modal';
  dialog.setAttribute('aria-modal', 'true');
  const heading = document.createElement('h2');
  heading.id = `admin-modal-title-${++nextModalId}`;
  heading.textContent = title;
  heading.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = document.createElement('header');
  header.className = 'admin-modal-header';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'admin-button admin-modal-close';
  closeButton.textContent = 'Close';
  header.append(heading, closeButton);
  const content = document.createElement('div');
  content.className = 'admin-modal-content';
  dialog.append(header, content);
  document.body.append(dialog);
  let disposed = false, dismissible = true, shown = false;
  let returnFocus: HTMLElement | undefined;
  let pointerStartedOutside = false;
  const entry = {close};
  function finishClose() {
    if (!shown) return;
    shown = false;
    activeModals.delete(entry);
    onClose?.();
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  function close() {
    if (disposed || !dismissible) return false;
    if (dialog.open) dialog.close();
    finishClose();
    return true;
  }
  const outside = (event: PointerEvent | MouseEvent) => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  closeButton.onclick = () => { close(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) finishClose(); });
  dialog.addEventListener('pointerdown', event => { pointerStartedOutside = outside(event); });
  dialog.addEventListener('click', event => {
    if (pointerStartedOutside && outside(event)) close();
    pointerStartedOutside = false;
  });
  return {
    dialog,
    content,
    open() {
      if (disposed || dialog.open) return;
      // A pending mutation may deliberately prevent switching to another modal.
      for (const active of activeModals) if (!active.close()) return;
      returnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
      dialog.showModal();
      shown = true;
      activeModals.add(entry);
      heading.focus();
    },
    close,
    setDismissible(value: boolean) {
      dismissible = value;
      closeButton.disabled = !value;
    },
    dispose() {
      if (disposed) return;
      dismissible = true;
      close();
      disposed = true;
      activeModals.delete(entry);
      dialog.remove();
    },
  };
}
