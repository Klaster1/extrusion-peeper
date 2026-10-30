/**
 * Shows the panel of the clicked tab, or of the tab picked with the arrow
 * keys. A form control that fails validation shows its tab first, so the
 * browser can point at it.
 *
 * @param {HTMLElement} tablist
 * @param {HTMLFormElement} [form]
 */
export const makeTabs = (tablist, form) => {
  const tabs = [...tablist.querySelectorAll("[role='tab']")].filter(
    (tab) => tab instanceof HTMLElement
  );
  /** @param {HTMLElement} tab */
  const panelOf = (tab) => {
    const panel = tablist.ownerDocument.getElementById(
      tab.getAttribute("aria-controls") ?? ""
    );
    if (!panel) {
      throw new Error(`Missing panel of tab #${tab.id}`);
    }
    return panel;
  };

  /** @param {HTMLElement} selected */
  const select = (selected) => {
    for (const tab of tabs) {
      const isSelected = tab === selected;
      tab.setAttribute("aria-selected", String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      panelOf(tab).hidden = !isSelected;
    }
  };

  /** @param {EventTarget | null} target */
  const tabOf = (target) =>
    tabs.find((tab) => target instanceof Node && tab.contains(target));

  tablist.addEventListener("click", (event) => {
    const tab = tabOf(event.target);
    if (tab) {
      select(tab);
    }
  });
  tablist.addEventListener("keydown", (event) => {
    const tab = tabOf(event.target);
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!tab || !step) {
      return;
    }
    event.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    select(next);
    next.focus();
  });
  form?.addEventListener(
    "invalid",
    (event) => {
      const tab = tabs.find(
        (tab) =>
          event.target instanceof Node && panelOf(tab).contains(event.target)
      );
      if (tab) {
        select(tab);
      }
    },
    // Invalid events don't bubble
    true
  );

  return { select };
};
