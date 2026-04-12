# Matrix Extension — One-Time Setup (matrix.org + E2EE)

This document is the Matrix-side setup playbook for the pi Matrix extension that bridges your phone to the Chief of Staff agent (registered as `coas`) running in the `coas` workspace.

- **Target:** bidirectional, end-to-end encrypted messaging between Element X on your phone and the Chief of Staff via a Matrix room
- **Homeserver:** matrix.org free tier
- **Encryption:** E2EE enabled from day one via [`matrix-js-sdk`](https://github.com/matrix-org/matrix-js-sdk) + olm
- **Self-hosting:** deferred to Phase 3 (future migration, not required for launch)
- **Who does this:** you, manually, one time, before the extension can run
- **Time:** ~45 minutes (Phase 1 ~20 min, Phase 2 ~25 min)

## Phase overview

| Phase | What | When |
|---|---|---|
| **Phase 1** | Create accounts, install Element X, create an encrypted room, retrieve the bot's access token, collect config strings | Now, before the extension runs |
| **Phase 2** | Verify the bot's device from your phone, set up Secure Backup for key recovery, confirm encrypted messages round-trip | Immediately after Phase 1, first time the extension runs |
| **Phase 3** | Migrate to a self-hosted homeserver (Continuwuity on your Mac + Tailscale) to close the metadata-privacy hole | Later, only if you decide the matrix.org metadata exposure matters for your use case |

---

## Security overview — read this first

matrix.org free tier **with E2EE enabled** is the target for Phase 1+2. The threat model is substantially better than plain matrix.org but is not perfect. You should understand both what E2EE gives you and what it doesn't.

### What E2EE protects

- ✅ **Message content is cryptographically unreadable by matrix.org operators.** Their servers store ciphertext. Even if they wanted to read your DMs (they don't, per TOS), they cryptographically cannot. This is the #1 thing E2EE fixes.
- ✅ **Compromise resistance.** If matrix.org is breached, subpoenaed, or an insider goes rogue, message content stays protected. Only devices holding the room's Megolm session keys (your phone and the bot) can decrypt.
- ✅ **Media is encrypted too.** Images, files, and attachments are opaque blobs to matrix.org.
- ✅ **TLS in transit, Olm/Megolm at rest.** Two layers of encryption; no plaintext ever touches matrix.org's disks for content.

### What E2EE does NOT protect

- ❌ **Metadata is still fully visible.** matrix.org sees who's in the room (your MXID and the bot's MXID), when each message arrives, message frequency, approximate sizes, device fingerprints, and when your phone comes online. The *shape* of "jim has a private bot room and they chat during work hours" is exposed even though the content isn't.
- ❌ **Room state is plaintext.** Room name, topic, avatar, and membership list are visible to matrix.org. If you call the room "Chief of Staff" or "Deal Pipeline", they see the name.
- ❌ **The access token is still a bearer credential.** Anyone who captures `MATRIX_ACCESS_TOKEN` can impersonate the bot — send new messages, read room history, delete events. E2EE assumes your devices' secrets are secure. Token leaks bypass that assumption.
- ❌ **Inbound messages are still a command channel.** Anyone who can post in the room issues commands to your Chief of Staff. The mitigation is the room ACL (private, invite-only, just you and the bot) — not crypto.
- ❌ **matrix.org's TOS, uptime, and rate limits are unchanged.** E2EE is orthogonal to operational trust. matrix.org can still throttle you, go down, or change policy.
- ❌ **Key loss = history loss.** If the bot's crypto store is wiped and you don't have key backup enabled, the bot cannot decrypt older encrypted messages ever again. Phase 2 sets up Secure Backup to mitigate this.

### Practical rules

- ✅ Store `MATRIX_ACCESS_TOKEN` in your shell rc file (`chmod 600`), never in a git-tracked file
- ✅ Keep the room private, invite-only, non-federated, just you and the bot
- ✅ Back up the bot's crypto store directory alongside your normal `~/.pi/` backups (it's a small directory with olm and Megolm session state)
- ✅ Rotate the access token every few weeks via the login script
- ✅ Verify the bot device once during Phase 2 — don't just dismiss the "unverified session" banner
- ❌ Do not send production credentials, customer data, or anything you'd be uncomfortable with matrix.org's *metadata* seeing (they see the shape even if not the content)
- ❌ Do not invite anyone else to the room
- ❌ Do not commit the access token or crypto store contents to any git-tracked file

### When to escalate to Phase 3 (self-hosted)

matrix.org + E2EE closes the **content-privacy** concern. If your threat model also requires **metadata privacy** — i.e. matrix.org shouldn't even know you have this bot channel, or shouldn't be able to correlate your login patterns with message timing — then migrate to a self-hosted homeserver behind Tailscale. See Phase 3 at the bottom of this document.

For most personal chief-of-staff use cases, matrix.org + E2EE is adequate long-term.

---

# PHASE 1 — matrix.org account and room setup

## Step 1 — Create two Matrix accounts

You need **two separate accounts**, not one.

| Account | Purpose | How |
|---|---|---|
| `@jim:matrix.org` (personal) | Your identity on the phone; what Element X signs in as | Register at [app.element.io/#/register](https://app.element.io/#/register) — email, password, CAPTCHA |
| `@coas-bot:matrix.org` (bot) | What the extension logs in as; sends and receives on behalf of the Chief of Staff | Same registration flow, in a **separate browser profile or incognito window** so the personal session is not clobbered |

The bot username can be anything matrix.org will give you (e.g. `jim-coas-bot`, `chief-of-staff-bot`). This document uses `@coas-bot:matrix.org` as the example.

**Why two accounts and not one:** the extension's inbound sync loop needs to distinguish "messages from the human" (which become `[from matrix:jim]: ...` for the Chief of Staff) from "messages from the bot itself" (which must be filtered as echoes). A single shared account would create infinite send/receive loops. Also, for E2EE: each device gets separate Megolm keys, and mixing bot-and-human on one account breaks the verification model.

**Record both MXIDs somewhere.** You'll need them in later steps and in the extension config.

**Also record the bot's password.** You'll need it for Step 4 Option B (the login script) and whenever you rotate the access token.

---

## Step 2 — Install Element X on your phone

Install the Element X client (not legacy Element). It has better push notifications, cleaner UI, and better E2EE UX.

- **iOS:** [apps.apple.com/app/element-x/id1631335820](https://apps.apple.com/app/element-x/id1631335820)
- **Android:** [play.google.com/store/apps/details?id=io.element.android.x](https://play.google.com/store/apps/details?id=io.element.android.x)

Sign in as your **personal** account (`@jim:matrix.org`). **Do not sign in to the bot account on your phone.** The bot is headless — it should only ever be logged in via the extension. Additional bot logins create extra Matrix devices and complicate the E2EE verification story.

---

## Step 3 — Create the private **encrypted** room

In Element X on your phone:

1. Tap the `+` button → **Create room** (not "Direct message" — direct messages have slightly different semantics and some versions auto-manage them)
2. **Name:** `Chief of Staff` (or anything recognisable)
3. **Privacy:** **Private** — critical
4. **Encryption:** **ON** — this is the whole point of Phase 2. Element X enables E2EE by default for new private rooms; verify it's on before creating.
5. **Invite:** add the bot by its full MXID (`@coas-bot:matrix.org`). You may need to type the MXID manually if Element's search hasn't indexed the new account yet.

Tap create. You should land in an empty room with exactly two members: you and the bot. Element X may show a small padlock icon or similar indicator confirming the room is encrypted.

⚠️ **Once a Matrix room has E2EE enabled, it cannot be disabled.** If you accidentally create the room with encryption off, leave it and create a fresh one. Matrix deliberately makes this one-way to prevent downgrade attacks.

### Get the internal room ID

The room ID is the machine-readable identifier the extension needs. In Element X:

- Tap the room name at the top → scroll to the room's settings
- Look for **Advanced** or **Internal room ID**
- It looks like `!abcdefghijklmnop:matrix.org`
- **The leading `!` is part of the ID, not a typo.** Copy the whole thing.

Record this — it's the `roomId` in the extension config.

### Disable federation (belt-and-braces)

In the room's Advanced settings, if there's a **Federation** toggle, turn it off. matrix.org rooms default to federation-on, which means events can replicate to other homeservers. For a two-person bot room this is pointless and adds a metadata leakage surface.

If you can't find the toggle in Element X (mobile clients sometimes omit it), it's OK — the room only has two members both on matrix.org, so there's nothing to federate in practice.

---

## Step 4 — Get the bot's access token

This is the most sensitive step. Element X deliberately hides access tokens because leaking them is dangerous. Two ways to get the token.

### Option A — Element Web (recommended)

1. Open [app.element.io](https://app.element.io) in a browser (any browser, any device you control)
2. Sign in as **the bot account** (`@coas-bot:matrix.org`) — *not* your personal account
3. Click your avatar (top left) → **All settings** → **Help & About**
4. Scroll to the very bottom. There's an **Advanced** section with an `Access Token` entry. Click to reveal.
5. **Copy the token.** It's a long string beginning with `syt_...`, e.g.:
   ```
   syt_amltLWNvYXMtYm90_hSdKnMpqRsTuvWxYz_1234567
   ```
6. **Sign the bot out of Element Web immediately** (regular sign-out — *not* "sign out of all devices", that would invalidate the token you just copied). The token persists across regular sign-out; you only need the web session to retrieve it once.

⚠️ **Important E2EE note on Option A:** when you sign in to Element Web as the bot, Element Web creates a *Matrix device* for the bot with its own device keys. You're about to delete that device when the extension starts (because the extension creates its *own* bot device with fresh keys). That's fine — just be aware that the Element Web session is ephemeral and should not be used for anything but token retrieval.

### Option B — Login script (shipped with the extension)

Once the extension is installed, run the shipped provisioning script instead:

```bash
npx tsx scripts/matrix-login.ts \
  --homeserver https://matrix.org \
  --user @coas-bot:matrix.org
# Prompts for the bot's password, performs /login, prints the token.
```

No browser required. This is cleaner than Option A because it doesn't create an Element Web device that immediately becomes stale. Useful for both first-time setup and token rotation.

### Store the token in your shell rc

Add the token to your shell's rc file (`~/.zshrc`, `~/.bashrc`, or whichever you use):

```bash
export MATRIX_ACCESS_TOKEN="syt_amltLWNvYXMtYm90_hSdKnMpqRsTuvWxYz_1234567"
```

Then:

```bash
chmod 600 ~/.zshrc   # or whichever rc file you edited
source ~/.zshrc      # pick up the new env var in current shell
```

**Do NOT:**
- Commit the token to git
- Put it in `settings.json` (the extension reads `accessTokenEnv: "MATRIX_ACCESS_TOKEN"`, not the literal value)
- Paste it into chat, docs, or PRs
- Store it in a plain `.env` file inside a git repo

---

## Step 5 — Accept the room invite on the bot side

The bot account needs to actually *be* in the room, not just invited. Two options:

- **Manually via Element Web:** sign in as the bot briefly, accept the invite, sign out. (Same caveat as Step 4 Option A — this creates a stale device.)
- **Let the extension auto-accept:** the extension auto-accepts room invites for its own user on startup. If you'd rather wait, the bot will join the room the first time the extension runs.

Auto-accept is cleaner because it doesn't create stale devices. Either works.

---

## Step 6 — Send a test message (sanity check)

Before wiring up the extension, verify the human side works end-to-end:

1. In Element X on your phone, open the room
2. Type `test from phone`
3. Send it
4. Confirm the message appears in the room as delivered (it'll show as encrypted — that's correct)

If this works, Phase 1 on the Matrix side is ready. If it doesn't, troubleshoot before continuing:
- Bot hasn't accepted the invite yet (go do Step 5)
- Room isn't actually created (check Element X's room list)
- Wrong account on your phone (make sure you're signed in as the personal account, not the bot)
- Room encryption indicator missing (you may have accidentally created a non-encrypted room — leave and recreate)

---

## Step 7 — Config strings for the extension

Once Steps 1–6 are done, the extension needs the values below. These go into `~/git/coas/.pi/settings.json`:

```jsonc
{
  "extensions": [
    "/Users/jim/git/pi-tools-and-skills/project-extensions/kanban",
    "/Users/jim/git/pi-tools-and-skills/project-extensions/matrix"
  ],
  "matrix": {
    "homeserver":        "https://matrix.org",
    "userId":            "@coas-bot:matrix.org",            // from Step 1
    "roomId":            "!abc123:matrix.org",               // from Step 3
    "targetAgent":       "coas",                             // Chief of Staff's registered name
    "accessTokenEnv":    "MATRIX_ACCESS_TOKEN",              // env var name, NOT the literal token
    "encryption":        true,                               // E2EE enabled — Phase 2 requirement
    "deviceDisplayName": "CoAS Chief of Staff (extension)",  // what the device is called in Element X
    "cryptoStorePath":   "~/.pi/agent/matrix-crypto"         // persistent crypto state dir
  }
}
```

The five strings you actually collect from your setup:
1. **Homeserver URL** — always `https://matrix.org` for Phase 1+2
2. **Bot user ID** — full MXID from Step 1, e.g. `@coas-bot:matrix.org`
3. **Room ID** — the `!abc...:matrix.org` string from Step 3
4. **Target agent name** — `coas` (the Chief of Staff's panopticon registry name)
5. **Token env var name** — just the name (`MATRIX_ACCESS_TOKEN`), not the value

**Never put the literal access token in this file.** The extension reads it from the environment at runtime.

The other fields (`encryption`, `deviceDisplayName`, `cryptoStorePath`) have sensible defaults baked into the extension — you only need to override them if you want something non-default.

---

## Phase 1 verification checklist

Before declaring Phase 1 complete, tick through:

- [ ] Personal matrix.org account created and signed in on Element X (phone)
- [ ] Bot matrix.org account created and signed out everywhere except the extension (which hasn't run yet)
- [ ] Bot's password recorded (needed for token rotation later)
- [ ] Private, **encrypted**, non-federated room created with exactly two members (you + bot)
- [ ] Room's internal ID (`!...:matrix.org`) recorded
- [ ] Bot's access token retrieved and stored in shell rc as `MATRIX_ACCESS_TOKEN`
- [ ] Shell rc is `chmod 600`
- [ ] Bot has accepted the room invite (or auto-accept will handle it)
- [ ] Test message from phone to room delivers successfully
- [ ] Config values collected for `coas/.pi/settings.json`
- [ ] `MATRIX_ACCESS_TOKEN` is NOT in any git-tracked file

---

# PHASE 2 — Enable E2EE for the bot

Phase 2 runs **after** the extension is installed and has started up at least once. The first run creates the bot's Matrix device and initialises its crypto store. You then verify that device from your phone and set up Secure Backup for key recovery.

This phase is where the E2EE actually becomes usable. Until Phase 2 is complete, messages from your phone will show up as "unable to decrypt" on the bot side (and vice versa) because the bot device is unverified.

## Step 2A — Understand the crypto store

The extension uses `matrix-js-sdk` with olm enabled. On first connection to the homeserver, matrix-js-sdk:

1. Creates a new Matrix **device** (not a new account — devices are per-session credentials under an account)
2. Generates fresh **device keys** (Curve25519 + Ed25519 identity keys)
3. Exchanges Olm sessions with other devices in any encrypted room it joins
4. Stores all of this in a **crypto store** directory on disk

The crypto store path is configurable via `cryptoStorePath` (default: `~/.pi/agent/matrix-crypto`). **This directory must survive extension restarts.** If it's wiped, the bot appears as a brand-new device on the next start — you'll need to re-verify and may lose access to historical encrypted messages.

**What's in there:** a few small files with olm account state, Megolm session keys for each encrypted room the bot is in, and tracked device info for your phone. Total size: typically under 10 MB.

**Back it up alongside your normal `~/.pi/` backups.** Or at minimum, after Phase 2 completion, make one copy of the directory somewhere safe.

## Step 2B — Start the extension for the first time

In the coas workspace:

```bash
cd ~/git/coas
pi
```

On startup, the Matrix extension:

1. Reads `matrix` config from `.pi/settings.json`
2. Reads `MATRIX_ACCESS_TOKEN` from your environment
3. Initialises matrix-js-sdk with crypto enabled
4. Creates the crypto store directory if it doesn't exist
5. Creates a new Matrix device for the bot (e.g. `MCNTNPIFGE`)
6. Accepts any pending room invites
7. Starts the sync loop
8. Registers the `matrix_send` tool and `/matrix` command

You should see a startup log line like:

```
matrix: connected as @coas-bot:matrix.org, device=MCNTNPIFGE, 1 room (encrypted)
```

Check `pi`'s matrix widget / status bar to verify the sync loop is running.

**At this point, on your phone, Element X will start showing "unverified session" warnings** for the new bot device. That's expected — Step 2C fixes it.

## Step 2C — Verify the bot device from your phone

This is a one-time verification dance that proves the bot's device keys weren't tampered with in transit. It's the reason E2EE is trustworthy — without verification, E2EE just encrypts but doesn't authenticate.

On your phone, in Element X:

1. Open the Chief of Staff room
2. Tap the room settings / members list
3. You should see a list of two devices for `@coas-bot:matrix.org` — the old Element Web one (if you used Option A in Step 4) and the new extension device
4. Tap the **new** device (the one with the name matching your `deviceDisplayName` config, e.g. "CoAS Chief of Staff (extension)")
5. Choose **Verify device**
6. Element X shows an emoji-matching challenge or a short security code

**Bot-side verification:** the extension's first run will surface the same emoji/code in the pi UI (as a `/matrix` command output or a startup notification). Compare the two. If they match, confirm on both sides.

After verification:
- Element X shows the bot device with a green check mark
- The "unverified session" warning disappears
- Encrypted messages from the phone will now decrypt successfully on the bot side, and vice versa

**If the extension's first run doesn't surface the verification codes:** run `/matrix verify` (a slash command the extension provides) to re-start the verification flow on demand.

## Step 2D — Remove the stale Element Web device

If you used Step 4 Option A (Element Web) to get the access token, there's a stale device lingering on the bot account. Delete it to keep the device list clean.

From your phone's Element X:

1. Room settings → members → `@coas-bot` → devices
2. Tap the old Element Web device (typically labelled something like "Element Web on macOS")
3. Tap **Sign out this session** or **Delete device**
4. Confirm

This doesn't affect the extension's device, just removes the cruft.

If you used Step 4 Option B (login script), there's nothing to clean up.

## Step 2E — Set up Secure Backup (key recovery)

Secure Backup is matrix.org's key recovery mechanism. It uploads your Megolm session keys to the server encrypted with a passphrase you control. If the bot's crypto store is lost, it can recover by restoring from the backup.

**You set up Secure Backup on your phone**, not on the bot side. The bot imports the backup via the API on startup.

On your phone, in Element X:

1. Settings → Encryption → Secure Backup (or similar — UI varies by version)
2. Tap **Set up** or **Enable**
3. Element X prompts you to set a **recovery passphrase** (different from your login password — treat it as a second secret)
4. Write the passphrase down somewhere safe (password manager is fine)
5. Element X generates a **recovery key** (long alphanumeric string) as a fallback — also save this
6. Confirm

From this point, any new Megolm keys Element X creates will be uploaded to the encrypted backup on matrix.org. If your phone ever loses its keys (reinstall, device reset), you enter the passphrase and it recovers.

### Importing the backup on the bot side

The extension supports importing the backup on startup when configured. In `~/git/coas/.pi/settings.json`, add:

```jsonc
{
  "matrix": {
    // ... other fields ...
    "secureBackupEnv": "MATRIX_RECOVERY_PASSPHRASE"
  }
}
```

And in your shell rc:

```bash
export MATRIX_RECOVERY_PASSPHRASE="your-recovery-passphrase-here"
```

On startup, if the bot's crypto store is empty OR if the bot is missing Megolm keys for historical messages, it uses the passphrase to pull the backup from matrix.org and decrypt.

**Security note:** the recovery passphrase is now a second bearer credential alongside the access token. Protect it the same way — shell rc, `chmod 600`, never in git.

**Alternative:** skip Secure Backup and live with the "if crypto store is wiped, lose history" risk. Acceptable for a chief-of-staff channel where history isn't critical — just re-verify and continue. Less setup, one less secret to manage.

## Step 2F — Verify encrypted round-trip

Final sanity check:

1. On your phone, send `encrypted test from phone` into the Chief of Staff room
2. In the pi terminal, the Chief of Staff should see `[from matrix:jim]: encrypted test from phone` in its inbox within a few seconds
3. From the Chief of Staff, call `matrix_send message="encrypted reply from bot"`
4. On your phone, the message appears in the room — decrypted successfully

If this works, E2EE is fully operational. You can talk to the Chief of Staff from your phone with content-privacy guarantees.

If step 2 fails with "unable to decrypt" on the bot side: the bot's device isn't verified, or the Megolm session hasn't propagated yet. Wait 30 seconds and retry. If it still fails, re-do Step 2C.

If step 4 shows "unable to decrypt" on the phone: the phone's device isn't trusted by the bot. Re-do Step 2C from the bot side (the verification is bidirectional).

---

## Phase 2 verification checklist

- [ ] Extension started at least once and connected to matrix.org as the bot
- [ ] Bot's crypto store exists at `~/.pi/agent/matrix-crypto/` and contains files
- [ ] New bot device visible in the phone's device list for `@coas-bot`
- [ ] Bot device verified from the phone — shows green check mark
- [ ] Stale Element Web device (if any) removed
- [ ] Secure Backup set up on the phone with a recovery passphrase (or consciously skipped)
- [ ] Encrypted message round-trip test passes both directions
- [ ] Crypto store backed up somewhere outside `~/.pi/agent/`
- [ ] Recovery passphrase (if using Secure Backup) stored in password manager

---

# PHASE 3 — Self-hosted (future, optional)

Phase 3 is **not required**. It's an optional future migration for users who need to close the metadata-privacy hole that matrix.org + E2EE leaves open.

## When to consider Phase 3

Migrate to a self-hosted homeserver if:

- You need matrix.org not to know you have this bot channel at all (not just the content)
- Your threat model includes matrix.org correlating your login patterns with message timing
- You want guaranteed uptime independent of matrix.org's free-tier TOS
- You're already running infrastructure you could fold this into

For most personal Chief of Staff use cases, matrix.org + E2EE is adequate long-term and you never need Phase 3.

## What Phase 3 looks like

The target setup:

```
Phone (Element X)
    │
    │ Tailscale WireGuard mesh (no public IP, no DNS)
    │
    ▼
Mac (or small VPS)
    ├── Tailscale Serve → HTTPS on *.ts.net with auto TLS
    └── Continuwuity container (Rust, ~100 MB RAM, RocksDB state)
```

Key properties:

- **Continuwuity** (lightweight Matrix homeserver, single binary, Docker) runs on your Mac
- **Tailscale** exposes it only to your devices — no public IP, no DNS registration, no firewall rules
- **Tailscale Serve** provisions HTTPS automatically using a cert for your `*.ts.net` hostname
- **Element X on your phone** points at the Tailscale hostname instead of matrix.org
- **The extension config** changes three fields: `homeserver`, `userId`, `roomId`. Everything else (token, crypto store, E2EE) carries over — E2EE works the same way against any Matrix homeserver

## Rough effort

| Task | Time |
|---|---|
| Install Tailscale on Mac and phone | 15 min |
| Install Docker Desktop (if not already) | 10 min |
| Configure Continuwuity via docker-compose | 30 min |
| Expose via Tailscale Serve + verify from phone | 15 min |
| Create bot and personal accounts on the new homeserver | 15 min |
| Create encrypted room, verify device, re-enable Secure Backup | 20 min |
| Update extension config, rotate token | 10 min |
| **Total first-time Phase 3 setup** | **~2 hours** |

Plus ongoing ops: monthly container upgrades (~5 min), crypto store + RocksDB backups (automate it), Mac-sleep-means-channel-down trade-off.

## Phase 3 documentation

The detailed Continuwuity + Tailscale walkthrough is deliberately **not** included in this document. When you want to migrate, write it then based on the state of those tools at that time — the config keys, Docker image names, and Tailscale Serve CLI all shift fast enough that documentation staleness is a real concern.

When you're ready to do Phase 3:

1. [Tailscale docs](https://tailscale.com/kb/) — install, MagicDNS, Tailscale Serve
2. [Continuwuity repository](https://github.com/continuwuity/continuwuity) — current docker-compose setup, config reference
3. [Matrix spec — Client-Server API](https://spec.matrix.org/latest/client-server-api/) — the `/register` endpoint for creating accounts
4. Return here to update the extension config fields

The extension itself **does not change** between Phase 2 and Phase 3. Same matrix-js-sdk, same E2EE, same crypto store. Only the server URL and credentials change.

---

## Troubleshooting

### "Element doesn't find the bot account when I try to invite it"
The account is too new to be indexed. Type the full MXID by hand (`@coas-bot:matrix.org`) instead of searching by display name.

### "The bot joined the room but messages from the phone show as 'unable to decrypt' on the bot side"
The bot's device isn't verified yet. Complete Phase 2 Step 2C from your phone. Verification is required — E2EE messages sent *before* the bot device was trusted aren't retroactively decryptable unless you have Secure Backup enabled.

### "I verified the device but now it's showing as unverified again"
The bot's crypto store was probably wiped (container rebuild, accidental deletion, filesystem corruption). Each crypto store wipe creates a new device with new keys. Re-verify from your phone. If you have Secure Backup enabled, the bot will also recover historical Megolm keys on next start.

### "I can't find the access token in Element Web's settings"
It's under Settings → Help & About → scroll to bottom → Advanced → Access Token. Element sometimes renames menu items between versions — if you can't find it, use Step 4 Option B (the `matrix-login.ts` script).

### "I signed out of Element Web and now the token doesn't work"
Regular sign-out does not invalidate the access token. "Sign out of all devices" does. If you clicked the latter, re-run the login flow to get a new token.

### "The phone can see my message but Element X warns about an unverified session"
This happens if the bot crypto store changed (new device) since last verification. Re-verify. If it happens repeatedly, something in your setup is wiping the crypto store on every restart — check `cryptoStorePath` config and the directory's persistence.

### "My phone lost its Matrix keys — can I still read history?"
If you enabled Secure Backup (Phase 2 Step 2E), enter your recovery passphrase on reinstall and the phone recovers its keys. If you didn't, old encrypted messages are unreadable by the new session but visible as "unable to decrypt" placeholders. New messages from that point forward are fine.

### "The bot sends messages but nothing arrives on my phone"
Check the matrix widget in pi's status bar for connection state. If it says "disconnected" or "error", the access token is probably invalid — rotate via the login script. If it says "connected" but messages don't arrive, check your phone's Element X network connection and confirm the sync stream is active (pull to refresh the room).

### "Push notifications don't arrive on my phone"
Element X uses Google FCM (Android) or APNs (iOS) via matrix.org's Sygnal gateway by default. Check your phone's OS-level notification permissions for Element X. On Android, also check battery optimisation — aggressive battery saving silently kills push delivery.

### "I want to start over — how do I reset everything?"
1. On your phone: leave the room, delete the room from your room list
2. On your phone: Element X → settings → delete account is heavy-handed; simpler: just create a new room
3. On the bot side: `rm -rf ~/.pi/agent/matrix-crypto/` — this forces a fresh device on next start
4. Re-run the bot login script to rotate the access token
5. Re-do Phase 1 from Step 3 and Phase 2 fresh

---

## References

- [Matrix Specification v1.18](https://spec.matrix.org/latest/)
- [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) — the TypeScript SDK the extension uses (with E2EE enabled)
- [matrix-js-sdk crypto docs](https://matrix-org.github.io/matrix-js-sdk/) — device verification, Secure Backup, crypto store APIs
- [@matrix-org/olm](https://gitlab.matrix.org/matrix-org/olm) — the underlying Olm/Megolm cryptographic library
- [Element X — iOS](https://github.com/element-hq/element-x-ios)
- [Element X — Android](https://github.com/element-hq/element-x-android)
- [Matrix Secure Backup spec](https://spec.matrix.org/latest/client-server-api/#server-side-key-backups)
- [Continuwuity](https://github.com/continuwuity/continuwuity) — future Phase 3 homeserver option
- [Tailscale](https://tailscale.com) — future Phase 3 private mesh VPN

---

*This document is the one-time setup guide. Ongoing operation of the Matrix extension — tools, routing, troubleshooting the bridge, rotating credentials — is documented in `README.md` (alongside this file) once the extension lands.*
