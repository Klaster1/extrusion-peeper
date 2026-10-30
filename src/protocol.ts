// What the server and the page send each other. The page's JavaScript checks
// against these types through JSDoc imports.
import * as z from "zod/v4";

export const SENSOR_DISPLAYS = ["temperature", "humidity"] as const;
export const SENSOR_ICONS = [
  "thermometer",
  "droplet",
  "chamber",
  "ams",
  "printer",
  "spool",
  "none",
] as const;

/** How the video fits the page: whole, cropped to fill it, or stretched. */
export const CAMERA_FITS = ["fit", "fill", "stretch"] as const;

export type CameraFit = (typeof CAMERA_FITS)[number];
export type SensorDisplay = (typeof SENSOR_DISPLAYS)[number];
export type SensorIcon = (typeof SENSOR_ICONS)[number];

/** One readout on the overlay, saved in the settings. */
export const SensorSettingSchema = z.object({
  deviceId: z.string().min(1),
  display: z.enum(SENSOR_DISPLAYS),
  label: z.string(),
  icon: z.enum(SENSOR_ICONS),
});

export type SensorSetting = z.infer<typeof SensorSettingSchema>;

/** A sensor the hubs know about, offered in the settings dropdowns. */
export type SensorOption = {
  id: string;
  name: string;
  online: boolean;
  lowBattery: boolean;
};

/**
 * A readout's last value, in its settings order. An offline sensor's value is
 * the last one its hub got. A sensor the hubs don't list reads `null`.
 */
export type SensorReading = {
  display: SensorDisplay;
  label: string;
  icon: SensorIcon;
  value: number | null;
  online: boolean;
  lowBattery: boolean;
};

export type SettingsMessage = {
  cameraHost: string | null;
  cameraLogin: string | null;
  cameraFit: CameraFit;
  sensors: SensorSetting[];
};

/** The JSON messages of each WebSocket route. */
export type SocketMessages = {
  "/api/readings": SensorReading[];
  "/api/sensors": SensorOption[];
  "/api/settings": SettingsMessage;
};

/**
 * `/api/stream` sends this as JSON, then the binary init segment and media
 * segments.
 */
export type StreamInitMessage = { type: "init"; mime: string };

const optionalText = z
  .string()
  .optional()
  .transform((value) => value || undefined);

/** A field the form repeats once per sensor, which arrives as a string when there's one. */
const repeated = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (value) => (value === undefined ? [] : [value].flat()),
    z.array(item)
  );

/** The settings dialog's form, posted to `/api/settings`. */
export const SettingsFormSchema = z
  .object({
    sensorDeviceId: repeated(
      z.string().min(1, "Choose a device for every sensor.")
    ),
    sensorDisplay: repeated(z.enum(SENSOR_DISPLAYS)),
    sensorLabel: repeated(z.string().trim()),
    sensorIcon: repeated(z.enum(SENSOR_ICONS)),
    cameraHost: optionalText,
    cameraLogin: optionalText,
    cameraPassword: optionalText,
    cameraFit: z.enum(CAMERA_FITS),
  })
  .refine(
    (form) =>
      [form.sensorDisplay, form.sensorLabel, form.sensorIcon].every(
        (field) => field.length === form.sensorDeviceId.length
      ),
    "Every sensor needs a device, a display, a label and an icon."
  )
  .transform(
    ({
      sensorDeviceId,
      sensorDisplay,
      sensorLabel,
      sensorIcon,
      ...camera
    }) => ({
      ...camera,
      sensors: sensorDeviceId.map(
        (deviceId, index): SensorSetting => ({
          deviceId,
          display: sensorDisplay[index],
          label: sensorLabel[index],
          icon: sensorIcon[index],
        })
      ),
    })
  );

export type SettingsForm = z.infer<typeof SettingsFormSchema>;
