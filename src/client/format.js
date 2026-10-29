/** @typedef {import("../protocol.ts").SensorOption} SensorOption */
/** @typedef {import("../protocol.ts").TemperatureReading} TemperatureReading */

/** @param {TemperatureReading | null} reading */
export const temperatureText = (reading) =>
  reading?.temperature == null ? "--.- °C" : `${reading.temperature} °C`;

/**
 * The overlay's caption, which flags readings to be wary of.
 *
 * @param {TemperatureReading | null} reading
 */
export const temperatureLabel = (reading) =>
  [
    "Chamber",
    reading && !reading.online && "offline",
    reading?.lowBattery && "low battery",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * An offline sensor's reading is the last one its hub got, so it may be old.
 *
 * @param {TemperatureReading | null} reading
 */
export const isStale = (reading) => reading !== null && !reading.online;

/** @param {SensorOption} sensor */
export const sensorLabel = (sensor) =>
  [
    sensor.online ? "🟢" : "🔴",
    sensor.name,
    sensor.lowBattery ? "(low battery)" : "",
  ]
    .filter(Boolean)
    .join(" ");
