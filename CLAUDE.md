# Extrusion Peeper

## Tests are required

Every change comes with tests: new behavior gets new tests, changed behavior gets its tests updated, and a fixed bug gets a test that fails without the fix. This holds for the page's JavaScript too, not just the server. Checking a change by hand in the browser is not a substitute.

Before calling a change done, run both and make sure they pass:

- `npm test`
- `npm run typecheck`

Use the Node version from `.node-version` (26.13, through fnm). The shell's default Node may be older, and npm 12 refuses to install with it.

## Where tests go

- Server code: `src/*.test.ts` next to the module, with `node:test`.
- Page code: `src/client/*.test.js`. Keep DOM logic in modules that take elements as arguments (like `sensor-list.js`, `tabs.js`, `readouts.js`), so `page.js` only wires them to sockets and can stay untested.
- DOM tests call `loadPage()` from `src/client/fakes.js`, which loads the real `src/index.html` into happy-dom, so they test the real templates. `fire()` there dispatches events with properties such as `clientY` or `key`. happy-dom lacks some browser APIs (`Option`, `draggable`), so fill gaps in `fakes.js` rather than in the code under test.

## Style

Format with `npx prettier --trailing-comma es5 --write <files>`.
