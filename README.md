# Darkjoyless Steam Bot

Local Node.js Steam bot for **game idling**, **group comments**, and **friend comments**. Configure once, then control everything from a colored terminal menu.

Repository: [ZaidAlsaqabi/My-steam-idler-and-commentor](https://github.com/ZaidAlsaqabi/My-steam-idler-and-commentor)

## Features

### Group commenter (main)
- Posts to groups **this Steam account is in**, using group IDs from the Steam client after login
- Does **not** look up groups on steamcommunity.com (that path is rate-limited)
- Configure **Ignore any Groups?** to skip groups you do not want
  - `config.groups` = include list (groups you kept)
  - `config.groups_excluded` = never posted to
- When a full round finishes: **Posted on all N groups.**
- Sequential posts with a delay between groups (at least 30 seconds)

### Idling
- Idle a single game or several games at once
- Saved games for quick start (single + multiple AppIDs)
- Live idle timer in the terminal
- Idle keeps running when you open the menu or stop comments
- Steam stays connected after you stop idling, so other menu tools still work

### Other comments
- Friend commenter (optional; not started by idle)
- Group + friend commenters together
- On HTTP 429 when **posting**: pause and retry. **M** stops comments without stopping idle

### Login and security
- Steam Guard is asked **once**; a refresh token is saved so later starts skip the authenticator
- Username and password are encrypted automatically when you configure or start the bot
- Steam session token is encrypted with the same system
- Menu saves write encrypted credentials back to disk (plaintext is only in memory)

### Terminal
- Colored menu, status, success, warnings, and errors
- Purple startup title
- **M** — main menu (stops comments/groups, idle keeps running)
- **S** — stop idling only
- **Esc** — exit

### Other
- Auto-accept friend requests (optional)
- Online / Invisible status
- Optional Telegram alerts if you set a bot token

## Requirements

- Node.js
- A Steam account (Steam Guard / authenticator for the first login)

## Setup

```bash
git clone https://github.com/ZaidAlsaqabi/My-steam-idler-and-commentor.git
cd My-steam-idler-and-commentor
npm install
```

Configure (encrypts username and password at the end by itself):

```bash
npm run configure-bot
```

Start:

```bash
npm run start-bot
```

First start may ask for a Steam Guard code **once**. After that, the encrypted session is reused until it expires.

## Menu

| Key | Action |
| --- | --- |
| 1 | Group commenter (groups on this Steam account) |
| 2 | Idle single game (idle only) |
| 3 | Idle multiple games (idle only) |
| 4 | Group commenter + friend commenter |
| 5 | Stop idling |
| 6 | Configure saved games |
| 7 | Friend request settings |
| 8 | Online status |
| 9 | Friend commenter only |
| 10 | Check idle status |
| 11 | Stop comments/groups (keep idling) |
| 12 | Exit |

Shortcuts while the bot is running (not while typing a Steam Guard code):

| Key | Action |
| --- | --- |
| **M** | Main menu; stops comments/groups; idle continues |
| **S** | Stop idling |
| **Esc** | Exit |

## Config

Copy from the template; do not commit a filled `config.json`.

- `config/config.template.json` — structure and defaults
- `config/message.txt` — group comment text (used if `message` is null)
- `config/friendcomment.txt` — friend comment text
- In `config.json`: `groups` / `group_names` (include), `groups_excluded` / `group_names_excluded` (skip)
- `config/steam-refresh.token` — encrypted Steam session (created after first login)

Optional environment variable: `CONFIG_MASTER_KEY` (encryption key). If unset, the default key in `util/encrypt.js` is used. Change that default if you share the machine.

## What not to commit

These are gitignored on purpose:

- `config/config.json` (encrypted username/password still count as secrets)
- `config/steam-refresh.token`
- `config/group-cache.json`
- `log.txt`
- `node_modules/`

## Rate limits

The group commenter does not load group pages on steamcommunity.com. If a **comment post** returns 429, the bot pauses and retries. Leave the window open. **M** still stops commenters. If login is rate-limited (`RateLimitExceeded`), wait 20–30 minutes and try once.

## License

Apache License 2.0. See `LICENSE`.
