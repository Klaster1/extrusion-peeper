import { Observable, shareReplay, switchMap } from "rxjs";
import { settings$, updateSettings } from "./settings.ts";
import { getTapoCloudToken } from "./tapo-api.ts";

export type TapoCredentials = {
  login: string;
  password: string;
  token: string;
};

export const tapoFullCredentials$: Observable<TapoCredentials | undefined> =
  settings$.pipe(
    switchMap(async (settings) => {
      if (!settings.login || !settings.password) {
        console.error("Tapo login and password must be set in settings.");
        return;
      }

      if (!settings.token) {
        const token = await getTapoCloudToken(
          settings.login,
          settings.password
        );
        await updateSettings({
          token,
        });
        return;
      }

      const { token } = settings;

      if (!token) {
        console.error("Failed to retrieve Tapo Cloud token.");
        return;
      }

      return { token, login: settings.login, password: settings.password };
    }),
    shareReplay({
      bufferSize: 1,
      refCount: true,
    })
  );
