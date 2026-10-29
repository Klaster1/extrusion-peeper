// What the server and the page send each other. The page's JavaScript checks
// against these types through JSDoc imports.
import * as z from "zod/v4";

export type SensorOption = {
  id: string;
  name: string;
  online: boolean;
  lowBattery: boolean;
  selected: boolean;
};

/** The selected sensor's last reading. An offline sensor's reading is the last one its hub got. */
export type TemperatureReading = {
  temperature: number | null;
  online: boolean;
  lowBattery: boolean;
};

export type CameraSettingsMessage = {
  cameraHost: string | null;
  cameraLogin: string | null;
};

/** The JSON messages of each WebSocket route. `null` means there's nothing to show. */
export type SocketMessages = {
  "/api/temperature": TemperatureReading | null;
  "/api/sensors": SensorOption[];
  "/api/settings": CameraSettingsMessage;
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

/** The settings dialog's form, posted to `/api/settings`. */
export const SettingsFormSchema = z.object({
  sensorDeviceId: z
    .string({ error: "Sensor ID is required." })
    .min(1, "Sensor ID is required."),
  cameraHost: optionalText,
  cameraLogin: optionalText,
  cameraPassword: optionalText,
});

export type SettingsForm = z.infer<typeof SettingsFormSchema>;
