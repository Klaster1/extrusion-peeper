/**
 * Where a dragged item goes in a vertical list: before the first other item
 * whose middle is below the pointer, or last.
 *
 * @param {{ top: number; height: number }[]} boxes The other items, in order
 * @param {number} y
 */
export const dropIndex = (boxes, y) => {
  const index = boxes.findIndex((box) => y < box.top + box.height / 2);
  return index === -1 ? boxes.length : index;
};

/**
 * Lets the list's items be dragged into a new order by their handles. Only the
 * handle starts a drag, so text in the inputs can still be selected.
 *
 * @param {HTMLElement} list
 * @param {string} handleSelector
 */
export const makeReorderable = (list, handleSelector) => {
  /** @type {HTMLElement | undefined} */
  let dragged;

  list.addEventListener("pointerdown", (event) => {
    const item = itemOf(list, event.target);
    if (
      item &&
      event.target instanceof Element &&
      event.target.closest(handleSelector)
    ) {
      item.draggable = true;
    }
  });
  // A click on the handle that didn't become a drag
  list.addEventListener("pointerup", () => {
    for (const child of list.children) {
      if (child instanceof HTMLElement) {
        child.draggable = false;
      }
    }
  });
  list.addEventListener("dragstart", (event) => {
    dragged = itemOf(list, event.target);
    if (!dragged || !event.dataTransfer) {
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    // Firefox only drags with data set
    event.dataTransfer.setData("text/plain", "");
    dragged.classList.add("dragging");
  });
  list.addEventListener("dragover", (event) => {
    if (!dragged) {
      return;
    }
    event.preventDefault();
    const others = [...list.children].filter(
      (child) => child !== dragged && child instanceof HTMLElement
    );
    const index = dropIndex(
      others.map((other) => other.getBoundingClientRect()),
      event.clientY
    );
    const next = others[index] ?? null;
    if (dragged.nextElementSibling !== next) {
      list.insertBefore(dragged, next);
    }
  });
  list.addEventListener("drop", (event) => event.preventDefault());
  list.addEventListener("dragend", () => {
    dragged?.classList.remove("dragging");
    if (dragged) {
      dragged.draggable = false;
    }
    dragged = undefined;
  });

  // The handles move their item with the arrow keys too
  list.addEventListener("keydown", (event) => {
    const item = itemOf(list, event.target);
    if (
      !item ||
      !(event.target instanceof Element) ||
      !event.target.closest(handleSelector)
    ) {
      return;
    }
    if (event.key === "ArrowUp" && item.previousElementSibling) {
      item.previousElementSibling.before(item);
    } else if (event.key === "ArrowDown" && item.nextElementSibling) {
      item.nextElementSibling.after(item);
    } else {
      return;
    }
    event.preventDefault();
    if (event.target instanceof HTMLElement) {
      event.target.focus();
    }
  });
};

/**
 * @param {HTMLElement} list
 * @param {EventTarget | null} target
 */
const itemOf = (list, target) => {
  let element = target instanceof Element ? target : null;
  while (element && element.parentElement !== list) {
    element = element.parentElement;
  }
  return element instanceof HTMLElement ? element : undefined;
};
