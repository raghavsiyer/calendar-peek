// Unit tests for the ICS core inside calendar-peek.uc.js.
// Run with:  npm test   (or: TZ=America/Los_Angeles node --test test/)
// The tests assume a Pacific-time local zone; package.json sets TZ for you.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../calendar-peek.uc.js");

const localDate = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const NOW = localDate(2026, 10, 18, 9, 30); // Sunday Oct 18 2026, 9:30 AM local

assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "America/Los_Angeles",
  "tests expect TZ=America/Los_Angeles (run via `npm test`)");

const GOOGLE_ICS = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:raghav@example.com
X-WR-TIMEZONE:America/Los_Angeles
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
X-LIC-LOCATION:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261018T100000
DTEND;TZID=America/Los_Angeles:20261018T113000
DTSTAMP:20261017T000000Z
UID:lecture@google.com
SUMMARY:Stats 131A lecture
LOCATION:Phelps 1260\\, UCSB
DESCRIPTION:Bring the problem set.\\nSee you there\\; thanks.
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
STATUS:CONFIRMED
TRANSP:OPAQUE
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:This is an event reminder
TRIGGER:-P0DT0H10M0S
END:VALARM
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20260929T140000
DTEND;TZID=America/Los_Angeles:20260929T143000
RRULE:FREQ=WEEKLY;BYDAY=SU,TU
EXDATE;TZID=America/Los_Angeles:20261020T140000
UID:sync@google.com
SUMMARY:Team sync
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261018T150000
DTEND;TZID=America/Los_Angeles:20261018T160000
RECURRENCE-ID;TZID=America/Los_Angeles:20261018T140000
UID:sync@google.com
SUMMARY:Moved sync
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261018
DTEND;VALUE=DATE:20261019
UID:hackathon@google.com
SUMMARY:Hackathon
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20001019
DTEND;VALUE=DATE:20001020
RRULE:FREQ=YEARLY
UID:bday@google.com
SUMMARY:Dad's birthday
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261018T120000
DTEND;TZID=America/Los_Angeles:20261018T123000
UID:cancelled@google.com
SUMMARY:Cancelled thing
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261018T230000Z
DTEND:20261019T000000Z
UID:utc@google.com
SUMMARY:UTC event
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20260719T180000
DTEND;TZID=America/Los_Angeles:20260719T190000
RRULE:FREQ=MONTHLY;BYDAY=3SU
UID:monthly@google.com
SUMMARY:Third Sunday dinner
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261010T080000
DTEND;TZID=America/Los_Angeles:20261010T083000
RRULE:FREQ=DAILY;COUNT=5
UID:count@google.com
SUMMARY:Five mornings
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261015T073000
DTEND;TZID=America/Los_Angeles:20261015T080000
RRULE:FREQ=DAILY;UNTIL=20261018T235959Z
UID:until@google.com
SUMMARY:Morning run
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261017T200000
DTEND;TZID=America/Los_Angeles:20261018T020000
UID:overnight@google.com
SUMMARY:Overnight build
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261018T093500
DTEND;TZID=America/Los_Angeles:20261018T100000
UID:zoom@google.com
SUMMARY:Office hours
DESCRIPTION:Join Zoom Meeting\\nhttps://ucsb.zoom.us/j/99999999?pwd=abcDEF\\n\\nMeeting ID: 999
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20151001T083000
DTEND;TZID=America/Los_Angeles:20151001T090000
RRULE:FREQ=DAILY
UID:forever@google.com
SUMMARY:Standup since 2015
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261020T110000
DTEND;TZID=America/Los_Angeles:20261020T120000
UID:tuesday@google.com
SUMMARY:Tuesday dentist
LOCATION:Goleta
END:VEVENT
END:VCALENDAR
`.replace(/\n/g, "\r\n");

test("parses a Google feed: names, folding, escapes, timezone", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  assert.equal(cal.name, "raghav@example.com");
  const lecture = cal.events.find(e => e.uid === "lecture@google.com");
  assert.equal(lecture.summary, "Stats 131A lecture");
  assert.equal(lecture.location, "Phelps 1260, UCSB");
  assert.equal(lecture.description, "Bring the problem set.\nSee you there; thanks.");
  assert.equal(lecture.start.tz, "America/Los_Angeles");
  assert.equal(Core.toInstant(lecture.start), Date.UTC(2026, 9, 18, 17, 0));
  assert.equal(lecture.join, "https://meet.google.com/abc-defg-hij");
  // VALARM must not leak its DESCRIPTION into the event.
  assert.ok(!lecture.description.includes("reminder"));
});

test("today's agenda: ordering, overrides, exclusions, cancellations", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  const agenda = Core.buildAgenda([{ name: "Main", color: "#4285f4", events: cal.events }], NOW, { days: 3 });
  const today = agenda.days[0].items.map(i => i.summary);
  assert.deepEqual(today, [
    "Hackathon",            // all-day first
    "Office hours",         // 9:35
    "Stats 131A lecture",   // 10:00
    "Moved sync",           // 15:00 — override replaced the 14:00 master instance
    "UTC event",            // 16:00 local (23:00Z)
    "Third Sunday dinner",  // 18:00
  ]);
  assert.ok(!today.includes("Cancelled thing"));
  assert.ok(!today.includes("Team sync"), "master instance must be replaced by its override");
  assert.ok(!today.includes("Five mornings"), "COUNT=5 series ended Oct 14");
  // Past timed events hidden by default (Morning run 7:30, Overnight build, Standup 8:30).
  assert.ok(!today.includes("Morning run"));
  assert.ok(!today.includes("Standup since 2015"));
  assert.equal(agenda.remainingToday, 5);
  assert.equal(agenda.nextItem.summary, "Office hours");
  assert.equal(agenda.nowItem, null);
});

test("show_past keeps the morning, including an overnight event that ended at 2am", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  const agenda = Core.buildAgenda([{ name: "Main", events: cal.events }], NOW, { days: 1, showPast: true });
  const today = agenda.days[0].items.map(i => i.summary);
  assert.deepEqual(today.slice(0, 4), ["Hackathon", "Overnight build", "Morning run", "Standup since 2015"]);
  const overnight = agenda.days[0].items.find(i => i.summary === "Overnight build");
  assert.equal(overnight.continues, true);
  assert.equal(overnight.continuesAfter, false);
});

test("tomorrow and the day after: yearly birthday, UNTIL boundary, EXDATE", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  const agenda = Core.buildAgenda([{ name: "Main", events: cal.events }], NOW, { days: 3 });
  const tomorrow = agenda.days[1].items.map(i => i.summary);
  assert.deepEqual(tomorrow, ["Dad's birthday", "Standup since 2015"]);
  const bday = agenda.days[1].items[0];
  assert.equal(bday.allDay, true);
  assert.equal(bday.transparent, true);
  assert.ok(!tomorrow.includes("Morning run"), "UNTIL=Oct 18 23:59:59Z ends the series");
  const tuesday = agenda.days[2].items.map(i => i.summary);
  assert.deepEqual(tuesday, ["Standup since 2015", "Tuesday dentist"]);
  assert.ok(!tuesday.includes("Team sync"), "EXDATE removed the Tuesday instance");
});

test("a daily series from 2015 expands in bounded time", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  const ev = cal.events.find(e => e.uid === "forever@google.com");
  const t0 = Date.now();
  const occ = Core.expandEvent(ev, localDate(2026, 10, 18), localDate(2026, 10, 19));
  assert.equal(occ.length, 1);
  assert.equal(occ[0].start, localDate(2026, 10, 18, 8, 30));
  assert.ok(Date.now() - t0 < 200, "fast-forward should skip a decade of mornings");
});

test("Join links: Meet from X-GOOGLE-CONFERENCE, Zoom from the description", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  const zoom = cal.events.find(e => e.uid === "zoom@google.com");
  assert.equal(zoom.join, "https://ucsb.zoom.us/j/99999999?pwd=abcDEF");
  assert.equal(Core.findJoinLink({ location: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc@thread.v2/0?context=x" }),
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc@thread.v2/0?context=x");
  assert.equal(Core.findJoinLink({ description: "see https://example.com/notes" }), "");
});

test("weekly series keeps its wall-clock time across a DST change (Europe/Berlin)", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:berlin
DTSTART;TZID=Europe/Berlin:20261012T090000
DTEND;TZID=Europe/Berlin:20261012T093000
RRULE:FREQ=WEEKLY
SUMMARY:Berlin standup
END:VEVENT
END:VCALENDAR`;
  const ev = Core.parseICS(ics).events[0];
  const occ = Core.expandEvent(ev, Date.UTC(2026, 9, 19), Date.UTC(2026, 10, 3));
  assert.deepEqual(occ.map(o => o.start), [
    Date.UTC(2026, 9, 19, 7, 0),   // CEST (UTC+2)
    Date.UTC(2026, 9, 26, 8, 0),   // CET  (UTC+1) after Oct 25 change
    Date.UTC(2026, 10, 2, 8, 0),
  ]);
});

test("Outlook feeds: Windows time-zone names resolve", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Pacific Standard Time
BEGIN:STANDARD
DTSTART:16010101T020000
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:outlook-1
DTSTART;TZID="Pacific Standard Time":20261018T130000
DTEND;TZID="Pacific Standard Time":20261018T140000
SUMMARY:Outlook meeting
X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/xyz
END:VEVENT
END:VCALENDAR`;
  const cal = Core.parseICS(ics);
  const ev = cal.events[0];
  assert.equal(ev.start.tz, "America/Los_Angeles");
  assert.equal(Core.toInstant(ev.start), Date.UTC(2026, 9, 18, 20, 0));
  assert.equal(ev.join, "https://teams.microsoft.com/l/meetup-join/xyz");
});

test("unknown TZID falls back to the VTIMEZONE's fixed offset, even when it comes last", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:custom-1
DTSTART;TZID=Customized Time Zone:20261018T200000
DTEND;TZID=Customized Time Zone:20261018T210000
SUMMARY:Late call
END:VEVENT
BEGIN:VTIMEZONE
TZID:Customized Time Zone
BEGIN:STANDARD
DTSTART:16010101T000000
TZOFFSETFROM:+0530
TZOFFSETTO:+0530
END:STANDARD
END:VTIMEZONE
END:VCALENDAR`;
  const ev = Core.parseICS(ics).events[0];
  assert.equal(ev.start.tz, "fixed:19800000");
  assert.equal(Core.toInstant(ev.start), Date.UTC(2026, 9, 18, 14, 30));
});

test("floating times are local; prefixed TZIDs are unwrapped; X-APPLE color is read", () => {
  const ics = `BEGIN:VCALENDAR
X-WR-CALNAME:Home
X-APPLE-CALENDAR-COLOR:#FF2968
BEGIN:VEVENT
UID:float
DTSTART:20261018T140000
DURATION:PT45M
SUMMARY:Floating
END:VEVENT
BEGIN:VEVENT
UID:prefixed
DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20261018T120000
DTEND;TZID=/mozilla.org/20050126_1/America/New_York:20261018T130000
SUMMARY:Prefixed
END:VEVENT
END:VCALENDAR`;
  const cal = Core.parseICS(ics);
  assert.equal(cal.color, "#FF2968");
  const [float, prefixed] = cal.events;
  assert.equal(float.start.tz, null);
  assert.equal(Core.toInstant(float.start), localDate(2026, 10, 18, 14, 0));
  assert.equal(Core.durationOf(float).ms, 45 * 60000);
  assert.equal(prefixed.start.tz, "America/New_York");
  assert.equal(Core.toInstant(prefixed.start), Date.UTC(2026, 9, 18, 16, 0));
});

test("monthly rules: BYMONTHDAY, negative ordinals, BYSETPOS", () => {
  const mk = (dtstart, rrule) => Core.parseICS(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:m
DTSTART;TZID=America/Los_Angeles:${dtstart}
DTEND;TZID=America/Los_Angeles:${dtstart}
RRULE:${rrule}
SUMMARY:m
END:VEVENT
END:VCALENDAR`).events[0];
  const days = occ => occ.map(o => new Date(o.start).getDate());
  const win = [localDate(2026, 10, 1), localDate(2026, 11, 1)];
  assert.deepEqual(days(Core.expandEvent(mk("20260115T090000", "FREQ=MONTHLY;BYMONTHDAY=1,15,-1"), ...win)), [1, 15, 31]);
  assert.deepEqual(days(Core.expandEvent(mk("20260130T090000", "FREQ=MONTHLY;BYDAY=-1FR"), ...win)), [30]);
  assert.deepEqual(days(Core.expandEvent(mk("20260105T090000", "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"), ...win)), [30]);
  assert.deepEqual(days(Core.expandEvent(mk("20260107T090000", "FREQ=MONTHLY;INTERVAL=3;BYDAY=1WE"), ...win)), [7]);
  // Feb 31st-style skips: a monthly on the 31st doesn't fire in 30-day months.
  const sep = [localDate(2026, 9, 1), localDate(2026, 10, 1)];
  assert.deepEqual(days(Core.expandEvent(mk("20260131T090000", "FREQ=MONTHLY"), ...sep)), []);
});

test("multi-day all-day events appear on every day they cover", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:trip
DTSTART;VALUE=DATE:20261017
DTEND;VALUE=DATE:20261020
SUMMARY:Trip
END:VEVENT
END:VCALENDAR`;
  const cal = Core.parseICS(ics);
  const agenda = Core.buildAgenda([{ name: "x", events: cal.events }], NOW, { days: 4 });
  assert.deepEqual(agenda.days.map(d => d.items.length), [1, 1, 0, 0]);
  assert.equal(agenda.days[0].items[0].continues, true);
  assert.equal(agenda.days[1].items[0].continuesAfter, false);
});

test("duplicate feeds don't double-list events", () => {
  const cal = Core.parseICS(GOOGLE_ICS);
  const feed = { name: "Main", events: cal.events };
  const agenda = Core.buildAgenda([feed, { ...feed, name: "Copy" }], NOW, { days: 1 });
  const names = agenda.days[0].items.map(i => i.summary);
  assert.equal(names.length, new Set(names).size);
});
