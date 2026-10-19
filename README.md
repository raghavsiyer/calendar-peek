![Calendar Peek](cover.png)

# Calendar Peek

See what's on today without leaving whatever you were doing.

Hover a pinned Google Calendar, iCloud, Outlook, or Proton Calendar tab in
Zen and a small popup slides in with your schedule — time, title, where it
is, and a **Join** button that lights up when a video call is about to start.
Click an event to jump to that day in your calendar, or hit `+` to create one.

It's the calendar half of Arc's sidebar peeks, rebuilt as a
[Sine](https://github.com/CosmoCreeper/Sine) mod, and a sibling of
[Email Peek](https://github.com/malachyfernandez/email-peek).

## What you get

- **Today at a glance.** All-day events first, then the rest in order, with
  finished events tucked away (toggle `show_past` to keep them, dimmed).
- **Now / in 5 min.** The event you're in gets a `Now` chip and a glowing bar;
  anything starting within the hour counts down.
- **Join.** Meet, Zoom, Teams, Webex, Whereby… links are picked out of the
  event automatically. Within ten minutes of the start the button turns solid.
- **Tomorrow, too.** Shows today + tomorrow by default; set `days` to 1 for a
  pure today view or up to 14 for a week-and-change.
- **A badge on the tab** with the number of timed events still ahead of you.
- **Several calendars.** Add as many feeds as you like; each gets its own
  colour and the name shows under the event.
- **Compact-mode friendly.** In Zen's compact mode the sidebar holds still
  while the popup is open.

## Install

1. Install [Sine](https://github.com/CosmoCreeper/Sine) — the mod loader for
   Zen. No browser recompile needed.
2. In Zen: `Settings → Sine` → paste this repo's URL into the install field.
3. Fully quit Zen and relaunch (Sine loads scripts at startup).
4. Pin your calendar tab (or drag it to Essentials) and hover it. The first
   time, the popup walks you through step 5.
5. Paste your calendar's **iCal address** into `Settings → Sine → Calendar
   Peek → feeds`. Where to find it:

   | Service | Where the address lives |
   | --- | --- |
   | **Google Calendar** | Settings → *Settings for my calendars* → pick a calendar → **Secret address in iCal format** |
   | **iCloud** | Calendar → the share icon next to a calendar → *Public Calendar* → copy the `webcal://` link |
   | **Outlook.com** | Settings → Calendar → *Shared calendars* → *Publish a calendar* → copy the **ICS** link |
   | **Proton Calendar** | Calendar → ⋯ → *Share* → *Share with anyone* → copy the link |
   | **Fastmail** | Settings → Calendars → a calendar → *Subscribe* link |
   | **Canvas (school)** | Calendar → *Calendar Feed* (bottom right) |

   Separate multiple feeds with spaces. `webcal://` links are fine. To name
   one, prefix it: `School=https://…`.

That's it. There's no API key and no OAuth — the feed is a private URL your
calendar already serves, and the mod fetches it straight from the browser.

> **Why a feed and not "just read the tab"?** Google Calendar's web app is a
> wall of generated class names with no stable structure to scrape, and it
> unloads when the pinned tab sleeps. The iCal feed is a documented, stable
> format that every calendar service offers, so this works the same for all of
> them and keeps working through UI redesigns.

## Settings

In `Settings → Sine → Calendar Peek` (or `about:config`):

| Pref | Default | What |
| --- | --- | --- |
| `mod.calendarpeek.feeds` | — | One or more `.ics` addresses, space-separated. `Name=URL` to label one. |
| `mod.calendarpeek.days` | `2` | Days to show, starting today (1–14). |
| `mod.calendarpeek.max_items` | `8` | Events shown before a `+N more` line. |
| `mod.calendarpeek.show_past` | `false` | Keep today's finished events, dimmed. |
| `mod.calendarpeek.show_badge` | `true` | Events-left-today badge on the tab icon. |
| `mod.calendarpeek.join_window` | `10` | Minutes before a call that Join turns solid. |
| `mod.calendarpeek.hover_delay` | `400` | ms before the preview opens. |
| `mod.calendarpeek.hide_delay` | `150` | ms before it closes on mouse-out. |
| `mod.calendarpeek.refresh_seconds` | `60` | Minimum gap between feed refreshes on hover. |
| `mod.calendarpeek.colors` | — | Colours per feed, in order (`#4285f4 #0b8043`). First feed uses Zen's accent otherwise. |
| `mod.calendarpeek.match` | — | Extra URL fragments that count as a calendar tab, e.g. `instructure.com/calendar`. |
| `mod.calendarpeek.require_pinned` | `false` | Only react to pinned / Essentials tabs. |
| `mod.calendarpeek.debug` | `false` | Log fetches and navigation to the Browser Console. |

## Under the hood

For the curious; nothing below is required reading.

- The mod `fetch()`es each feed from the chrome context (no cookies sent),
  parses the iCalendar text itself, and expands recurring events for the
  window you've asked for. Recurrence handles `FREQ=DAILY/WEEKLY/MONTHLY/
  YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` (with ordinals like `-1FR`),
  `BYMONTHDAY`, `BYMONTH`, `BYSETPOS`, `WKST`, `EXDATE`, `RDATE` and
  `RECURRENCE-ID` overrides — enough for anything Google, Apple, or Outlook
  will export. Long-running series are fast-forwarded to the window, so a
  daily standup from 2015 costs nothing.
- Times are converted with `Intl` per event time zone, so a weekly 9 AM in
  Berlin stays 9 AM across a DST change. Outlook's Windows zone names
  (`Pacific Standard Time`) are mapped to IANA; unknown `TZID`s fall back to
  the feed's own `VTIMEZONE` offset.
- Join links come from `X-GOOGLE-CONFERENCE`, `X-MICROSOFT-
  SKYPETEAMSMEETINGURL`, `URL`, `LOCATION`, then the description, in that
  order.
- Clicking an event opens that day in Google Calendar (`/r/day/YYYY/MM/DD`)
  or the event's own `URL` if the feed has one; `+` goes to Google's
  `eventedit` or Outlook's compose deeplink. Other providers just focus the
  tab.
- Feeds are cached in memory, refreshed on hover when older than
  `refresh_seconds`, and every five minutes in the background for the badge.
  A feed that fails keeps its last good copy; the popup says which one broke.
- Zen's native tab tooltip is suppressed while the popup is open, the same
  way Email Peek does it.

### Developing

The parsing/recurrence core is pure and unit-tested; the popup can be
rendered in an ordinary browser without Zen.

```sh
npm test                      # recurrence, time zones, overrides…
python3 preview/shot.py       # regenerates preview PNGs and cover.png (needs playwright)
```

`preview/preview.html` loads the real `calendar-peek.uc.js` with a few
stubbed chrome globals, so what you see there is what Zen renders.

## Known limitations

- Google's secret iCal feed can lag the web UI by a few minutes after an edit
  (Google caches it on their side).
- Shared calendars appear in your feed only if they're in *your* list of
  calendars with their own secret address — add each one as a separate feed.
- Zen updates can wipe the Sine bootloader; reinstall Sine if mods vanish.

## License

MIT
