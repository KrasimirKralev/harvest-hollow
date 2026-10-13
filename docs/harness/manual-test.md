# In-game helper: the owner's real sign-in test (one page)

The automated tests use a fake Claude Code binary and a stand-in for OpenAI. Only you can check the real sign-ins,
with your own accounts. Allow about 20 minutes. Run everything on your PC, never against the live game on :3300 or
its `data/` folder.

## 0. Start a scratch game
1. Claude Code must be installed unmodified and on PATH (Anthropic's installer, or `npm i -g @anthropic-ai/claude-code`).
   Check with `claude --version`. The game never installs or changes it.
2. In `~/harvest-hollow`:
   `PORT=3702 HH_DATA_DIR=$PWD/.scratch/manual-helper node server/index.js`
3. Open `http://127.0.0.1:3702` on the PC (it must be `127.0.0.1`, not `localhost`), claim a slot, open the helper.
   Both providers should be listed. If Claude says "unavailable", note the reason it shows: NO_BINARY (not on PATH)
   or UNSAFE_VERSION (the binary lacks a restriction flag).

## 1. Claude (your Claude plan, through Claude Code's own sign-in)
1. Pick Claude, then Sign in. A sign-in link appears. Open it and sign in with your Claude account.
2. If the browser finishes on its own, the game shows you as signed in within a few seconds. If the page shows a
   code instead, paste it into the game's box.
3. Expected: "signed in" with your e-mail masked (`k***@…`).
4. Ask: "Add a pale blue melon that grows in summer, and a pie from it". The working pill should step through
   reading, building and testing while you keep playing. Then the "changes ready" pop-up appears. Apply it.
5. Check the folder exists, without opening anything inside it:
   `ls -d .scratch/manual-helper/harness/users/p1/claude/config`
6. Sign out in the game. Expected: that `claude` folder is gone.

Report back: whether the link appeared, whether the browser finished it or you pasted a code, and any error code
the game showed. If the link never appears, the binary's login screen has changed (the open risk in the contract).

## 2. ChatGPT (your ChatGPT plan, Sign in with ChatGPT)
1. Pick ChatGPT, then Sign in, then open the link. On auth.openai.com, sign in and allow access.
2. On the PC, the page lands on `127.0.0.1:3702/auth/callback` and says "You are signed in".
3. Repeat from your phone, connected to the PC over the LAN. The final page will say it cannot connect: that is
   expected. Copy the whole address from the address bar and paste it into the game's box.
4. The model list should show your account's models. Run the same request as in step 1.4 and apply it.
5. The token file must be private: `stat -c %a .scratch/manual-helper/harness/users/p1/openai/oaiapp_*/*.json`
   should print `600`.
6. Sign out. Expected: the `openai` folder is gone and the token is revoked. ChatGPT's settings no longer list the app,
   or the game says revocation was not confirmed.

Report back: whether the ChatGPT consent screen named "Harness Hollow", which models appeared, and any error
code. A usage-limit message names the limit; it does not mean the sign-in failed.

## 3. Things only you can decide (hosted site)
- **Claude on the hosted site:** Claude Code may be hosted for players only after you accept Anthropic's Commercial
  Terms. Then set `HH_CLAUDE_HOSTING=accepted` on the host. Until then it shows as unavailable there.
- **ChatGPT on the hosted site:** OpenAI's open-source token sharing covers open-source and locally hosted apps.
  For a remotely hosted app, OpenAI asks you to fill in its interest form first. After they approve, set
  `HH_CHATGPT_HOSTING=approved`. Until then it shows as unavailable there.

## 4. Clean up
Stop the server with Ctrl+C. Delete only the scratch folder: `rm -rf .scratch/manual-helper`.
