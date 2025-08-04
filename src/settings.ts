import { promises as fs } from "fs";
import path from "path";
import {
  from,
  merge,
  Observable,
  share,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs";
import * as z from "zod/v4";

const SettingsSchema = z.object({
  $schema: z.string().default("./settings.schema.json"),
  login: z.string().nullable(),
  password: z.string().nullable(),
  token: z.string().nullable(),
  cameraHost: z.string().nullable(),
  cameraLogin: z.string().nullable(),
  cameraPassword: z.string().nullable(),
  temperatureSensorDeviceId: z.string().nullable(),
  port: z.number().nullable(),
  ffmpegFlags: z.array(z.string()).nullable(),
});

export type Settings = z.infer<typeof SettingsSchema>;

const DEFAULT_SETTINGS: Settings = {
  $schema: "./settings.schema.json",
  login: null,
  password: null,
  token: null,
  cameraHost: null,
  cameraLogin: null,
  cameraPassword: null,
  temperatureSensorDeviceId: null,
  port: 2024,
  ffmpegFlags: [
    "-q",
    "1", // Maximum quality
    "-qmin",
    "1", // Minimum quantizer
    "-qmax",
    "1", // Maximum quantizer (lower = better quality)
    "-qdiff",
    "1", // Max difference between quantizers
    "-mbd",
    "2", // Macroblock decision algorithm (2 = best)
    "-b:v",
    "10000k",
  ],
};

const SETTINGS_FILE = path.join(import.meta.dirname, "..", "settings.json");

export async function getSettings(): Promise<Settings> {
  try {
    await fs.access(SETTINGS_FILE);
  } catch (error: any) {
    if (error.code === "EACCES") {
      console.error("Permission denied to access the settings file.");
      process.exit(1);
    }
    fs.writeFile(
      SETTINGS_FILE,
      JSON.stringify(DEFAULT_SETTINGS, null, 2),
      "utf-8"
    );
    console.log("Settings file created with default values.");
  }
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(data);

    // Validate and merge with defaults using Zod
    const validatedSettings = SettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...parsed,
    });

    return validatedSettings;
  } catch (error) {
    // If file doesn't exist or is invalid, return defaults
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updateSettings(
  updates: Partial<Settings>
): Promise<Settings> {
  const currentSettings = await getSettings();
  const newSettings = { ...currentSettings, ...updates };

  // Validate the merged settings
  const validatedSettings = SettingsSchema.parse(newSettings);

  // Save to file
  const data = JSON.stringify(validatedSettings, null, 2);
  await fs.writeFile(SETTINGS_FILE, data, "utf-8");

  return validatedSettings;
}

export const settings$: Observable<Settings> = from(
  fs.watch(SETTINGS_FILE, { persistent: true })
).pipe(
  startWith(null), // Emit initial value
  switchMap(getSettings),
  shareReplay({
    refCount: true,
    bufferSize: 1,
  })
);
