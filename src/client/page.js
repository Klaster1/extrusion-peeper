import { connectJsonSocket, socketUrl } from "./socket.js";
import { playStream } from "./video-player.js";
import { find } from "./dom.js";
import { OBJECT_FITS } from "./format.js";
import { showReadouts } from "./readouts.js";
import { createSensorList } from "./sensor-list.js";
import { makeTabs } from "./tabs.js";

/** @typedef {import("../protocol.ts").SettingsMessage} SettingsMessage */

// Video
const video = find("#video", HTMLVideoElement);
video.addEventListener("playing", () => {
  document.body.classList.add("playing");
});
video.addEventListener("waiting", () => {
  document.body.classList.remove("playing");
});
playStream(video, socketUrl("/api/stream"));

// Readouts
const readouts = find(".readouts", HTMLElement);
const readoutTemplate = find("#template-readout", HTMLTemplateElement);
connectJsonSocket("/api/readings", (readings) =>
  showReadouts(readouts, readoutTemplate, readings)
);

// Settings
const dialog = find("#dialog-settings", HTMLDialogElement);
const form = find("form", HTMLFormElement, dialog);
makeTabs(find("[role='tablist']", HTMLElement, dialog), form);
const sensorList = createSensorList(
  find("#sensor-list", HTMLElement),
  find("#template-sensor", HTMLTemplateElement)
);
/** @type {SettingsMessage | undefined} */
let saved;

/** Fills the form with the saved settings, discarding unsaved changes. */
const showSaved = () => {
  if (!saved) {
    return;
  }
  find("input[name='cameraHost']", HTMLInputElement, form).value =
    saved.cameraHost ?? "";
  find("input[name='cameraLogin']", HTMLInputElement, form).value =
    saved.cameraLogin ?? "";
  find("select[name='cameraFit']", HTMLSelectElement, form).value =
    saved.cameraFit;
  sensorList.show(saved.sensors);
};

connectJsonSocket("/api/settings", (settings) => {
  saved = settings;
  video.style.objectFit = OBJECT_FITS[settings.cameraFit];
  if (!dialog.open) {
    showSaved();
  }
});
connectJsonSocket("/api/sensors", (sensors) => sensorList.setOptions(sensors));

find("#button-add-sensor", HTMLButtonElement).addEventListener("click", () =>
  sensorList.add()
);
find("#button-settings", HTMLButtonElement).addEventListener("click", () => {
  showSaved();
  dialog.showModal();
});
for (const button of dialog.querySelectorAll("[data-close]")) {
  button.addEventListener("click", () => dialog.close());
}
