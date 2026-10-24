import {
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  shareReplay,
  startWith,
  Subject,
  switchMap,
} from "rxjs";
import { settings$ } from "./settings.ts";
import { getTapoCloudToken } from "./tapo-api.ts";

export type TapoCredentials = {
  login: string;
  password: string;
};

export const tapoFullCredentials$: Observable<TapoCredentials | undefined> =
  settings$.pipe(
    map((settings) => {
      if (!settings.login || !settings.password) {
        console.error("Tapo login and password must be set in settings.");
        return;
      }
      return { login: settings.login, password: settings.password };
    }),
    distinctUntilChanged(
      (a, b) => a?.login === b?.login && a?.password === b?.password
    ),
    shareReplay({
      bufferSize: 1,
      refCount: true,
    })
  );

const tokenRefresh$ = new Subject<void>();

// Tapo cloud tokens expire, so they are kept in memory only. The latest token is
// replayed to every subscriber, so polling doesn't refetch it.
export const tapoToken$: Observable<string> = tapoFullCredentials$.pipe(
  switchMap((credentials) =>
    credentials
      ? tokenRefresh$.pipe(
          startWith(undefined),
          switchMap(() =>
            getTapoCloudToken(credentials.login, credentials.password)
          )
        )
      : EMPTY
  ),
  shareReplay({
    bufferSize: 1,
    refCount: false,
  })
);

export const refreshTapoToken = () => tokenRefresh$.next();
