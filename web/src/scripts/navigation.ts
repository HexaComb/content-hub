const root = document.querySelector<HTMLElement>('[data-workspace]');
const navigation = document.querySelector<HTMLDialogElement>('#workspace-navigation');
const toggle = document.querySelector<HTMLButtonElement>('#toggle-navigation');
const closeButton = document.querySelector<HTMLButtonElement>('#close-navigation');
if (root && navigation && toggle && closeButton) {
  const mobile = matchMedia('(max-width: 900px)');
  let collapsed = false;
  try { collapsed = localStorage.getItem('unreel.sidebar.collapsed') === 'true'; } catch { /* Storage can be unavailable in private contexts. */ }
  const updateToggle = () => {
    const expanded = mobile.matches ? navigation.matches(':modal') : !collapsed;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', mobile.matches ? (expanded ? 'Close navigation' : 'Open navigation') : (expanded ? 'Collapse sidebar' : 'Expand sidebar'));
    toggle.title = toggle.getAttribute('aria-label')!;
    root.dataset.sidebarCollapsed = String(collapsed);
    document.documentElement.classList.toggle('navigation-open', navigation.matches(':modal'));
  };
  const syncLayout = () => {
    const wasModal = navigation.matches(':modal');
    const focused = document.activeElement;
    if (mobile.matches) navigation.close();
    else if (wasModal || !navigation.open) {
      if (wasModal) navigation.close();
      navigation.show();
      (focused instanceof HTMLElement && !navigation.contains(focused) && focused !== document.body ? focused : toggle).focus({preventScroll:true});
    }
    navigation.setAttribute('role', mobile.matches ? 'dialog' : 'complementary');
    updateToggle();
  };
  const dismiss = () => {
    if (!mobile.matches) return;
    navigation.close();
    updateToggle();
    toggle.focus();
  };
  toggle.addEventListener('click', () => {
    if (mobile.matches) {
      if (navigation.open) dismiss();
      else { navigation.showModal(); updateToggle(); closeButton.focus(); }
    } else {
      collapsed = !collapsed;
      try { localStorage.setItem('unreel.sidebar.collapsed', String(collapsed)); } catch { /* The control still works without persistence. */ }
      updateToggle();
    }
  });
  closeButton.addEventListener('click', dismiss);
  navigation.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !navigation.matches(':modal')) return;
    const items = [...navigation.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')].filter(item => item.getClientRects().length > 0);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
  });
  navigation.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  navigation.addEventListener('close', updateToggle);
  navigation.addEventListener('click', event => {
    if (!mobile.matches || event.target !== navigation) return;
    const bounds = navigation.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  });
  navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', dismiss));
  mobile.addEventListener('change', syncLayout);
  syncLayout();
}

export {};
