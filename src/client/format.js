/** @typedef {import("../protocol.ts").CameraFit} CameraFit */
/** @typedef {import("../protocol.ts").SensorDisplay} SensorDisplay */
/** @typedef {import("../protocol.ts").SensorIcon} SensorIcon */
/** @typedef {import("../protocol.ts").SensorOption} SensorOption */
/** @typedef {import("../protocol.ts").SensorReading} SensorReading */

/**
 * What a readout can show, with the icon a new readout of it gets. The
 * background lights every segment: "8" in the 7-segment font, and "~" in the
 * 14-segment one, which draws the "%".
 *
 * @type {Record<SensorDisplay, { name: string; unit: string; empty: string; background: string; icon: SensorIcon }>}
 */
export const DISPLAYS = {
  temperature: {
    name: "Temperature",
    unit: "°C",
    empty: "--.-",
    background: "88.8 88",
    icon: "thermometer",
  },
  humidity: {
    name: "Humidity",
    unit: "%",
    empty: "--",
    background: "88 ~",
    icon: "droplet",
  },
};

/**
 * The video's CSS `object-fit` for each camera fit setting.
 *
 * @type {Record<CameraFit, string>}
 */
export const OBJECT_FITS = { fit: "contain", fill: "cover", stretch: "fill" };

/** @param {SensorReading} reading */
export const readingText = (reading) => {
  const { unit, empty } = DISPLAYS[reading.display];
  return `${reading.value ?? empty} ${unit}`;
};

/**
 * The unlit segments behind the reading, as wide as the reading itself.
 *
 * @param {SensorDisplay} display
 */
export const readingBackground = (display) => DISPLAYS[display].background;

/**
 * The readout's caption, which flags readings to be wary of.
 *
 * @param {SensorReading} reading
 */
export const readingLabel = (reading) =>
  [
    reading.label,
    !reading.online && "offline",
    reading.lowBattery && "low battery",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * An offline sensor's reading is the last one its hub got, so it may be old.
 *
 * @param {SensorReading} reading
 */
export const isStale = (reading) => !reading.online;

/**
 * The icon after switching what a readout shows. An icon picked by hand stays.
 *
 * @param {SensorIcon} icon
 * @param {SensorDisplay} from
 * @param {SensorDisplay} to
 */
export const iconAfterDisplayChange = (icon, from, to) =>
  icon === DISPLAYS[from].icon ? DISPLAYS[to].icon : icon;

/**
 * A sensor's heading in the settings, which matches its overlay caption.
 *
 * @param {string} label
 * @param {string} deviceId
 * @param {SensorOption[]} sensors
 */
export const sensorTitle = (label, deviceId, sensors) =>
  label.trim() ||
  sensors.find((sensor) => sensor.id === deviceId)?.name ||
  "New sensor";

/** @param {SensorOption} sensor */
export const sensorLabel = (sensor) =>
  [
    sensor.online ? "🟢" : "🔴",
    sensor.name,
    sensor.lowBattery ? "(low battery)" : "",
  ]
    .filter(Boolean)
    .join(" ");

/**
 * The device dropdown's choices. A saved device the hubs no longer list stays
 * a choice, so saving the form doesn't drop it.
 *
 * @param {SensorOption[]} sensors
 * @param {string} selectedId
 * @returns {{ value: string; label: string }[]}
 */
export const deviceChoices = (sensors, selectedId) => [
  { value: "", label: "Select sensor" },
  ...sensors.map((sensor) => ({
    value: sensor.id,
    label: sensorLabel(sensor),
  })),
  ...(selectedId && !sensors.some((sensor) => sensor.id === selectedId)
    ? [{ value: selectedId, label: `🔴 Unknown sensor ${selectedId}` }]
    : []),
];
