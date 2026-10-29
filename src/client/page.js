import { connectJsonSocket, socketUrl } from "./socket.js";
import { playStream } from "./video-player.js";
import {
  isStale,
  sensorLabel,
  temperatureLabel,
  temperatureText,
} from "./format.js";

/**
 * @template {Element} T
 * @param {string} selector
 * @param {new () => T} type
 * @param {ParentNode} [parent]
 * @returns {T}
 */
const find = (selector, type, parent = document) => {
  const element = parent.querySelector(selector);
  if (!(element instanceof type)) {
    throw new Error(`Missing ${type.name} ${selector}`);
  }
  return element;
};

// Video
const video = find("#video", HTMLVideoElement);
video.addEventListener("playing", () => {
  document.body.classList.add("playing");
});
video.addEventListener("waiting", () => {
  document.body.classList.remove("playing");
});
playStream(video, socketUrl("/api/stream"));

// Temperature
const temperature = find(".temperature", HTMLElement);
connectJsonSocket("/api/temperature", (reading) => {
  find(".value", HTMLElement, temperature).textContent =
    temperatureText(reading);
  find(".label", HTMLElement, temperature).textContent =
    temperatureLabel(reading);
  temperature.classList.toggle("stale", isStale(reading));
});

// Settings
const dialog = find("#dialog-settings", HTMLDialogElement);
connectJsonSocket("/api/settings", (settings) => {
  find("input[name='cameraHost']", HTMLInputElement, dialog).value =
    settings.cameraHost ?? "";
  find("input[name='cameraLogin']", HTMLInputElement, dialog).value =
    settings.cameraLogin ?? "";
});

// Sensors
const sensorSelect = find("#select-temperature-sensor", HTMLSelectElement);
/**
 * @param {string} value
 * @param {string} label
 * @param {boolean} [selected]
 */
const makeOption = (value, label, selected = false) =>
  new Option(label, value, selected, selected);
connectJsonSocket("/api/sensors", (sensors) => {
  sensorSelect.replaceChildren(
    makeOption("", "Select sensor"),
    ...sensors.map((sensor) =>
      makeOption(sensor.id, sensorLabel(sensor), sensor.selected)
    )
  );
});

find("#button-settings", HTMLButtonElement).addEventListener("click", () => {
  dialog.showModal();
});
for (const button of dialog.querySelectorAll("[data-close]")) {
  button.addEventListener("click", () => dialog.close());
}
