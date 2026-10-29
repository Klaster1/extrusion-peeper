import { promises as fs, watch } from "fs";
import path from "path";
import { isDeepStrictEqual } from "util";
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  from,
  Observable,
  shareReplay,
  startWith,
  switchMap,
} from "rxjs";
import * as z from "zod/v4";

const SettingsSchema = z.object({
  $schema: z.string().default("./settings.schema.json"),
  login: z.string().nullable(),
  password: z.string().nullable(),
  cameraHost: z.string().nullable(),
  cameraLogin: z.string().nullable(),
  cameraPassword: z.string().nullable(),
  temperatureSensorDeviceId: z.string().nullable(),
  port: z.number().nullable(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  $schema: "./settings.schema.json",
  login: null,
  password: null,
  cameraHost: null,
  cameraLogin: null,
  cameraPassword: null,
  temperatureSensorDeviceId: null,
  port: 2024,
};

const SETTINGS_FILE = path.join(import.meta.dirname, "..", "settings.json");

/** Reads the settings, creating the file with defaults if it's missing. Throws if the file is invalid. */
export async function loadSettings(file = SETTINGS_FILE): Promise<Settings> {
  try {
    await fs.writeFile(file, JSON.stringify(DEFAULT_SETTINGS, null, 2), {
      encoding: "utf-8",
      flag: "wx", // Only if the file doesn't exist
    });
    console.log("Settings file created with default values.");
  } catch (error: any) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
  return SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...parsed });
}

export async function updateSettings(
  updates: Partial<Settings>,
  file = SETTINGS_FILE
): Promise<Settings> {
  const newSettings = SettingsSchema.parse({
    ...(await loadSettings(file)),
    ...updates,
  });
  await fs.writeFile(file, JSON.stringify(newSettings, null, 2), "utf-8");
  return newSettings;
}

/**
 * Emits the settings now and whenever the file changes. Skips invalid or
 * half-written files and saves that don't change anything.
 */
export const watchSettings = (file: string): Observable<Settings> =>
  new Observable<void>((subscriber) => {
    // Watch the folder, as editors often replace the file instead of writing to it
    const watcher = watch(path.dirname(file), (_event, filename) => {
      if (filename === path.basename(file)) {
        subscriber.next();
      }
    });
    watcher.on("error", (error) => subscriber.error(error));
    return () => watcher.close();
  }).pipe(
    // A single save fires several events
    debounceTime(100),
    startWith(undefined),
    switchMap(() =>
      from(loadSettings(file)).pipe(
        catchError((error) => {
          console.error(`Ignoring invalid settings in ${file}:`, error);
          return EMPTY;
        })
      )
    ),
    distinctUntilChanged<Settings>(isDeepStrictEqual)
  );

export const settings$: Observable<Settings> = watchSettings(
  SETTINGS_FILE
).pipe(
  shareReplay({
    refCount: true,
    bufferSize: 1,
  })
);
