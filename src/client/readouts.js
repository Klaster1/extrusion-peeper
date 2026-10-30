import { clone, find, findSvg } from "./dom.js";
import { drawIcon } from "./icons.js";
import {
  isStale,
  readingBackground,
  readingLabel,
  readingText,
} from "./format.js";

/** @typedef {import("../protocol.ts").SensorReading} SensorReading */

/**
 * Replaces the overlay's readouts, one per reading.
 *
 * @param {HTMLElement} container
 * @param {HTMLTemplateElement} template
 * @param {SensorReading[]} readings
 */
export const showReadouts = (container, template, readings) =>
  container.replaceChildren(
    ...readings.map((reading) => {
      const readout = clone(template);
      drawIcon(findSvg(".icon", readout), reading.icon);
      find(".label", HTMLElement, readout).textContent = readingLabel(reading);
      find(".background", HTMLElement, readout).textContent = readingBackground(
        reading.display
      );
      find(".value", HTMLElement, readout).textContent = readingText(reading);
      readout.classList.toggle("stale", isStale(reading));
      return readout;
    })
  );
