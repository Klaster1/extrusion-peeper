import { clone, fillSelect, find, findSvg } from "./dom.js";
import {
  deviceChoices,
  DISPLAYS,
  iconAfterDisplayChange,
  sensorTitle,
} from "./format.js";
import { drawIcon, ICONS } from "./icons.js";
import { makeReorderable } from "./reorder.js";

/** @typedef {import("../protocol.ts").SensorDisplay} SensorDisplay */
/** @typedef {import("../protocol.ts").SensorIcon} SensorIcon */
/** @typedef {import("../protocol.ts").SensorOption} SensorOption */
/** @typedef {import("../protocol.ts").SensorSetting} SensorSetting */

/** @param {HTMLElement} row */
export const sensorFields = (row) => ({
  device: find("select[name='sensorDeviceId']", HTMLSelectElement, row),
  display: find("select[name='sensorDisplay']", HTMLSelectElement, row),
  label: find("input[name='sensorLabel']", HTMLInputElement, row),
  icon: find("select[name='sensorIcon']", HTMLSelectElement, row),
});

/**
 * An icon dropdown's choice, which shows the icon next to its name.
 *
 * @param {string} icon
 */
const iconOption = (icon) => {
  const option = new Option(ICONS[/** @type {SensorIcon} */ (icon)].name, icon);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  drawIcon(svg, /** @type {SensorIcon} */ (icon));
  option.prepend(svg);
  return option;
};

/**
 * The settings dialog's sensors: a card per readout, with the fields the form
 * posts, in the order the cards are dragged into.
 *
 * @param {HTMLElement} list
 * @param {HTMLTemplateElement} template
 */
export const createSensorList = (list, template) => {
  /** @type {SensorOption[]} */
  let options = [];
  makeReorderable(list, ".drag-handle");

  /** Shows the readout's icon and caption in its heading. */
  const updateHeader = (/** @type {HTMLElement} */ row) => {
    const fields = sensorFields(row);
    drawIcon(
      findSvg(".icon", row),
      /** @type {SensorIcon} */ (fields.icon.value)
    );
    find(".title", HTMLElement, row).textContent = sensorTitle(
      fields.label.value,
      fields.device.value,
      options
    );
  };

  /** @param {SensorSetting} sensor */
  const sensorRow = (sensor) => {
    const row = clone(template);
    const fields = sensorFields(row);
    fillSelect(
      fields.device,
      deviceChoices(options, sensor.deviceId),
      sensor.deviceId
    );
    fillSelect(
      fields.display,
      Object.entries(DISPLAYS).map(([value, { name }]) => ({
        value,
        label: name,
      })),
      sensor.display
    );
    fields.label.value = sensor.label;
    fields.icon.append(...Object.keys(ICONS).map(iconOption));
    fields.icon.value = sensor.icon;

    let display = sensor.display;
    fields.display.addEventListener("change", () => {
      const next = /** @type {SensorDisplay} */ (fields.display.value);
      fields.icon.value = iconAfterDisplayChange(
        /** @type {SensorIcon} */ (fields.icon.value),
        display,
        next
      );
      display = next;
      updateHeader(row);
    });
    row.addEventListener("input", () => updateHeader(row));
    find("[data-remove]", HTMLButtonElement, row).addEventListener(
      "click",
      () => row.remove()
    );
    updateHeader(row);
    return row;
  };

  const rows = () =>
    [...list.children].filter((row) => row instanceof HTMLElement);

  return {
    /**
     * Replaces the cards, discarding unsaved changes.
     *
     * @param {SensorSetting[]} sensors
     */
    show(sensors) {
      list.replaceChildren(...sensors.map(sensorRow));
    },

    /** Adds an empty card and focuses its device dropdown. */
    add() {
      const row = sensorRow({
        deviceId: "",
        display: "temperature",
        label: "",
        icon: DISPLAYS.temperature.icon,
      });
      list.append(row);
      sensorFields(row).device.focus();
    },

    /**
     * Updates the device dropdowns, keeping what each card has picked.
     *
     * @param {SensorOption[]} sensors
     */
    setOptions(sensors) {
      options = sensors;
      for (const row of rows()) {
        const { device } = sensorFields(row);
        fillSelect(device, deviceChoices(sensors, device.value), device.value);
        updateHeader(row);
      }
    },
  };
};
