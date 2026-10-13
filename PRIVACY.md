# Privacy

## Your own Harness Hollow server

If you run Harness Hollow yourself (the default single-farm mode: `npm start` on your own computer, a Raspberry Pi or
any box on your home network), **your server keeps your farm, and nothing goes anywhere else unless you use the in-game
helper** (below):

- The farm (the names you type, your farmers' looks, notes, the game itself) lives in the server's data folder
  (`HH_DATA_DIR`, `./data` by default), with its journal and backups. Device keys are stored there only as hashes.
- Each browser keeps its key to the farm, its settings and the Memory Book's pictures in its own storage.
- The game makes no calls to other sites: no analytics, no ads, no tracking cookies, and the fonts, music and
  pictures come from your server. Links to GitHub (the source code, "Suggest an idea") open GitHub only when you
  choose them.
- The server's log lines (for example "slot claimed") may include the farmer's name and the address of the device on
  your network. They stay on your machine.

You are the one who decides what happens to that data. To delete a farm, stop the server and remove the data folder.

## The in-game helper

The helper changes your farm when you ask it to (typing or speaking). It is optional, and nothing below happens until a
farmer uses it.

- **Your request goes to the AI provider you choose, under your own account.** The server sends your request, the
  farm's level and game language, the game's modding guide, lists of what exists in the game and the farm's current
  helper changes (small data files under `mod/`) to OpenAI (ChatGPT) or Anthropic (Claude). Never the farm's save, a
  farm key or anyone's sign-in. You sign in with your own ChatGPT or Claude plan on the provider's own sign-in page; the
  work counts against your plan, and the provider handles the request under its own privacy rules.
- **Sign-ins stay on your server**, per farmer, in the farm's `harness/users/` folder: the ChatGPT sign-in as a file
  only the server's user can read (mode 0600), never logged and never sent anywhere else. For Claude the server runs
  the Claude Code program, which keeps its own login in a private folder the game's code never opens. Signing out in
  Settings › Helper removes it.
- **The helper's work** (its files, the checks, the request and its summary) is kept with the farm under `harness/`, so
  both farmers can see the history and undo a change: the record of a request for 30 days, its work files for 7 days,
  the applied changes as long as the farm.
- **Speaking to the helper** uses the browser's own speech recognition, which may send the sound to the browser maker's
  service (Chrome to Google, Safari to Apple). The server never receives sound, only the typed-out words.
- **Sharing your requests with the Harness Hollow team is off unless a farmer turns it on** (each farmer decides for
  themselves; the helper asks once, and Settings › Helper changes it at any time; turning it off deletes what was still
  waiting to be sent). When it is on, after each helper job the server sends one event to `HH_TELEMETRY_URL` (by
  default the public host's `/api/telemetry`), at most 20 an hour, holding exactly: the request in the farmer's words,
  the helper's mod files, what they added, changed or removed, whether the checks passed (error codes only), whether the
  change was applied, discarded or undone, the provider and model, the game language and version, and a random install
  id (`harness-host/install.json`). Never a sign-in, account, e-mail, farm id or key, farmer or farm names (unless typed
  into the request), IP address or file path; anything in a request that looks like a key, a password, an e-mail, a
  farm's address or a file path is blanked out before it leaves. An event that cannot be delivered waits in
  `harness-host/telemetry-outbox.jsonl` for up to 7 days, then is dropped. The public host keeps shared events for 12
  months at most; to have yours deleted sooner, send the install id shown in Settings › Helper through the privacy
  request form on the public site.
- **The operator's switch:** `HH_TELEMETRY=off` (or `HH_TELEMETRY_URL=off`) means nothing is ever shared, whatever a
  farmer chose.

## The public site

The hosted multi-farm site has its own privacy page, in English and Bulgarian, at
[harvest-hollow.up.railway.app/privacy](https://harvest-hollow.up.railway.app/privacy) (the page itself is
`public/privacy.html` in this repository). It explains what that site keeps, why, for how long, who hosts it, what the
in-game helper sends and shares, and how to ask for a copy or a deletion.
