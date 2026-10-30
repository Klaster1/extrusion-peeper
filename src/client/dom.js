/**
 * @template {Element} T
 * @param {string} selector
 * @param {new () => T} type
 * @param {ParentNode} [parent]
 * @returns {T}
 */
export const find = (selector, type, parent = document) => {
  const element = parent.querySelector(selector);
  if (!(element instanceof type)) {
    throw new Error(`Missing ${type.name} ${selector}`);
  }
  return element;
};

/**
 * @param {string} selector
 * @param {ParentNode} [parent]
 */
export const findSvg = (selector, parent) =>
  /** @type {SVGSVGElement} */ (find(selector, SVGSVGElement, parent));

/** @param {HTMLTemplateElement} template */
export const clone = (template) => {
  const element = template.content.firstElementChild?.cloneNode(true);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Empty template #${template.id}`);
  }
  return element;
};

/**
 * @param {HTMLSelectElement} select
 * @param {{ value: string; label: string }[]} choices
 * @param {string} value
 */
export const fillSelect = (select, choices, value) => {
  select.replaceChildren(
    ...choices.map((choice) => new Option(choice.label, choice.value))
  );
  select.value = value;
};
