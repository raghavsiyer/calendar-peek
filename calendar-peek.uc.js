// ==UserScript==
// @name           Calendar Peek
// @namespace      calendar-peek
// @description    Arc-style "what's on today" preview when hovering a pinned calendar tab
// @version        1.1.0
// @author         Raghav
// @include        main
// @ignorecache
// ==/UserScript==

// Runs in chrome://browser/content/browser.xhtml (privileged chrome context).
// Requires Sine (or fx-autoconfig). No Zen source modifications needed.
//
// Data comes from iCalendar (.ics) subscription feeds — the "secret address"
// every calendar app hands out — so it works for Google Calendar, iCloud,
// Outlook, Proton, Fastmail, Canvas, Nextcloud… anything that speaks ICS.
// No API keys, no OAuth, nothing leaves the browser.

(() => {
  "use strict";

  const IS_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";
  if (IS_BROWSER && window.calendarPeek) return;

  // =========================================================================
  //  ICS core — pure functions, no browser APIs. Exported for the Node tests.
  // =========================================================================
  const CalendarCore = (() => {
    const DAY = 86400000;
    const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    // ---------- text ----------

    // RFC 5545 line folding: CRLF followed by a space/tab continues the line.
    const unfold = text => text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");

    const unescapeText = v =>
      String(v).replace(/\\\\|\\[nN]|\\,|\\;/g, m =>
        m === "\\\\" ? "\\" : m[1] === "n" || m[1] === "N" ? "\n" : m[1]
      );

    // Split on `sep` outside double quotes.
    function splitUnquoted(s, sep) {
      const out = [];
      let cur = "", q = false;
      for (const c of s) {
        if (c === '"') { q = !q; cur += c; }
        else if (c === sep && !q) { out.push(cur); cur = ""; }
        else cur += c;
      }
      out.push(cur);
      return out;
    }

    // "NAME;P1=V1;P2="a:b":VALUE" → { name, params, value }
    function parseLine(line) {
      let i = 0, q = false;
      for (; i < line.length; i++) {
        const c = line[i];
        if (c === '"') q = !q;
        else if (c === ":" && !q) break;
      }
      if (i >= line.length) return null;
      const parts = splitUnquoted(line.slice(0, i), ";");
      const name = parts[0].trim().toUpperCase();
      if (!name) return null;
      const params = {};
      for (const p of parts.slice(1)) {
        const eq = p.indexOf("=");
        if (eq < 0) continue;
        params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, "$1");
      }
      return { name, params, value: line.slice(i + 1) };
    }

    // ---------- civil-date arithmetic (Howard Hinnant's algorithms) ----------

    function daysFromCivil(y, m, d) {
      y -= m <= 2 ? 1 : 0;
      const era = Math.floor(y / 400);
      const yoe = y - era * 400;
      const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
      const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
      return era * 146097 + doe - 719468;
    }
    function civilFromDays(z) {
      z += 719468;
      const era = Math.floor(z / 146097);
      const doe = z - era * 146097;
      const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
      const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
      const mp = Math.floor((5 * doy + 2) / 153);
      const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
      const m = mp + (mp < 10 ? 3 : -9);
      return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
    }
    const weekday = days => (((days + 4) % 7) + 7) % 7; // 0 = Sunday
    const daysInMonth = (y, m) =>
      daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);

    // ---------- time zones ----------

    const WINDOWS_TZ = {
      "Dateline Standard Time": "Etc/GMT+12", "UTC-11": "Etc/GMT+11",
      "Hawaiian Standard Time": "Pacific/Honolulu", "Aleutian Standard Time": "America/Adak",
      "Alaskan Standard Time": "America/Anchorage", "Pacific Standard Time": "America/Los_Angeles",
      "Pacific Standard Time (Mexico)": "America/Tijuana", "Mountain Standard Time": "America/Denver",
      "US Mountain Standard Time": "America/Phoenix", "Mountain Standard Time (Mexico)": "America/Mazatlan",
      "Central Standard Time": "America/Chicago", "Central Standard Time (Mexico)": "America/Mexico_City",
      "Canada Central Standard Time": "America/Regina", "Central America Standard Time": "America/Guatemala",
      "Eastern Standard Time": "America/New_York", "US Eastern Standard Time": "America/Indiana/Indianapolis",
      "SA Pacific Standard Time": "America/Bogota", "Atlantic Standard Time": "America/Halifax",
      "Venezuela Standard Time": "America/Caracas", "SA Western Standard Time": "America/La_Paz",
      "Pacific SA Standard Time": "America/Santiago", "Newfoundland Standard Time": "America/St_Johns",
      "E. South America Standard Time": "America/Sao_Paulo", "Argentina Standard Time": "America/Buenos_Aires",
      "SA Eastern Standard Time": "America/Cayenne", "Greenland Standard Time": "America/Godthab",
      "Montevideo Standard Time": "America/Montevideo", "UTC-02": "Etc/GMT+2",
      "Azores Standard Time": "Atlantic/Azores", "Cape Verde Standard Time": "Atlantic/Cape_Verde",
      "UTC": "Etc/UTC", "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik",
      "W. Europe Standard Time": "Europe/Berlin", "Central Europe Standard Time": "Europe/Budapest",
      "Romance Standard Time": "Europe/Paris", "Central European Standard Time": "Europe/Warsaw",
      "W. Central Africa Standard Time": "Africa/Lagos", "Namibia Standard Time": "Africa/Windhoek",
      "GTB Standard Time": "Europe/Bucharest", "Middle East Standard Time": "Asia/Beirut",
      "Egypt Standard Time": "Africa/Cairo", "Syria Standard Time": "Asia/Damascus",
      "E. Europe Standard Time": "Europe/Chisinau", "South Africa Standard Time": "Africa/Johannesburg",
      "FLE Standard Time": "Europe/Kiev", "Turkey Standard Time": "Europe/Istanbul",
      "Israel Standard Time": "Asia/Jerusalem", "Kaliningrad Standard Time": "Europe/Kaliningrad",
      "Arabic Standard Time": "Asia/Baghdad", "Arab Standard Time": "Asia/Riyadh",
      "Belarus Standard Time": "Europe/Minsk", "Russian Standard Time": "Europe/Moscow",
      "E. Africa Standard Time": "Africa/Nairobi", "Iran Standard Time": "Asia/Tehran",
      "Arabian Standard Time": "Asia/Dubai", "Azerbaijan Standard Time": "Asia/Baku",
      "Mauritius Standard Time": "Indian/Mauritius", "Georgian Standard Time": "Asia/Tbilisi",
      "Caucasus Standard Time": "Asia/Yerevan", "Afghanistan Standard Time": "Asia/Kabul",
      "West Asia Standard Time": "Asia/Tashkent", "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
      "Pakistan Standard Time": "Asia/Karachi", "India Standard Time": "Asia/Kolkata",
      "Sri Lanka Standard Time": "Asia/Colombo", "Nepal Standard Time": "Asia/Kathmandu",
      "Central Asia Standard Time": "Asia/Almaty", "Bangladesh Standard Time": "Asia/Dhaka",
      "Myanmar Standard Time": "Asia/Yangon", "SE Asia Standard Time": "Asia/Bangkok",
      "N. Central Asia Standard Time": "Asia/Novosibirsk", "China Standard Time": "Asia/Shanghai",
      "North Asia Standard Time": "Asia/Krasnoyarsk", "Singapore Standard Time": "Asia/Singapore",
      "W. Australia Standard Time": "Australia/Perth", "Taipei Standard Time": "Asia/Taipei",
      "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar", "North Asia East Standard Time": "Asia/Irkutsk",
      "Tokyo Standard Time": "Asia/Tokyo", "Korea Standard Time": "Asia/Seoul",
      "Cen. Australia Standard Time": "Australia/Adelaide", "AUS Central Standard Time": "Australia/Darwin",
      "E. Australia Standard Time": "Australia/Brisbane", "AUS Eastern Standard Time": "Australia/Sydney",
      "West Pacific Standard Time": "Pacific/Port_Moresby", "Tasmania Standard Time": "Australia/Hobart",
      "Yakutsk Standard Time": "Asia/Yakutsk", "Central Pacific Standard Time": "Pacific/Guadalcanal",
      "Vladivostok Standard Time": "Asia/Vladivostok", "New Zealand Standard Time": "Pacific/Auckland",
      "UTC+12": "Etc/GMT-12", "Fiji Standard Time": "Pacific/Fiji",
      "Tonga Standard Time": "Pacific/Tongatapu", "Samoa Standard Time": "Pacific/Apia",
    };

    const dtfCache = new Map();
    function dtf(tz) {
      let f = dtfCache.get(tz);
      if (f === undefined) {
        try {
          f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
          });
        } catch { f = null; }
        dtfCache.set(tz, f);
      }
      return f;
    }
    const isValidTz = tz => !!dtf(tz);

    // Offset (ms) of `tz` from UTC at the given instant.
    function tzOffsetMs(epoch, tz) {
      const parts = dtf(tz).formatToParts(new Date(epoch));
      const g = t => +parts.find(p => p.type === t).value;
      let h = g("hour"); if (h === 24) h = 0;
      const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), h, g("minute"), g("second"));
      return asUTC - (epoch - (((epoch % 1000) + 1000) % 1000));
    }
    // Wall-clock time in an IANA zone → epoch ms (DST-correct).
    function zonedToInstant(y, mo, d, h, mi, s, tz) {
      const guess = Date.UTC(y, mo - 1, d, h, mi, s);
      const off1 = tzOffsetMs(guess, tz);
      let inst = guess - off1;
      const off2 = tzOffsetMs(inst, tz);
      if (off2 !== off1) inst = guess - off2;
      return inst;
    }

    // TZID → IANA name, "UTC", "fixed:<ms>" or null (floating / local time).
    function resolveTz(tzid, timezones) {
      if (!tzid) return null;
      const t = String(tzid).trim();
      if (/^(Z|UTC|GMT|Etc\/UTC|Etc\/GMT|Zulu)$/i.test(t)) return "UTC";
      if (isValidTz(t)) return t;
      if (WINDOWS_TZ[t]) return WINDOWS_TZ[t];
      // "/mozilla.org/20050126_1/America/Los_Angeles", "(UTC-08:00) America/Los_Angeles"
      const segs = t.split("/").filter(Boolean);
      for (let n = 3; n >= 2; n--) {
        if (segs.length >= n) {
          const cand = segs.slice(-n).join("/");
          if (isValidTz(cand)) return cand;
        }
      }
      const vt = timezones && timezones[t];
      if (vt) {
        if (vt.location && isValidTz(vt.location)) return vt.location;
        if (vt.offset != null) return `fixed:${vt.offset}`;
      }
      return null;
    }

    // ---------- date values ----------

    // {y,mo,d,h,mi,s,tz,allDay}. All-day values carry no time zone.
    function parseDT(value, params, timezones, fallbackTz) {
      const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i);
      if (!m) return null;
      const allDay = (params && params.VALUE === "DATE") || !m[4];
      const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), tz: null, allDay };
      if (allDay) return w;
      if (m[7]) w.tz = "UTC";
      else if (params && params.TZID) { w._tzid = params.TZID; w.tz = resolveTz(params.TZID, timezones); }
      else w.tz = fallbackTz || null;
      return w;
    }

    function toInstant(w) {
      if (w.allDay) return new Date(w.y, w.mo - 1, w.d).getTime();
      if (!w.tz) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime();
      if (w.tz === "UTC") return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
      if (w.tz.startsWith("fixed:")) return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - parseInt(w.tz.slice(6), 10);
      return zonedToInstant(w.y, w.mo, w.d, w.h, w.mi, w.s, w.tz);
    }

    // Same wall-clock time as `w`, on a different civil day.
    function instantOnDay(w, dayNum) {
      const c = civilFromDays(dayNum);
      return toInstant({ ...w, y: c.y, mo: c.m, d: c.d });
    }

    function parseDuration(v) {
      const m = String(v).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
      if (!m) return null;
      const ms = (+(m[2] || 0) * 7 + +(m[3] || 0)) * DAY + +(m[4] || 0) * 3600000 + +(m[5] || 0) * 60000 + +(m[6] || 0) * 1000;
      return m[1] === "-" ? -ms : ms;
    }

    // ---------- recurrence rules ----------

    function parseRRule(str) {
      const r = { freq: null, interval: 1, count: null, until: null, byday: null, bymonthday: null, bymonth: null, bysetpos: null, wkst: 1 };
      for (const part of String(str).split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const k = part.slice(0, eq).toUpperCase(), v = part.slice(eq + 1);
        switch (k) {
          case "FREQ": r.freq = v.toUpperCase(); break;
          case "INTERVAL": r.interval = Math.max(1, parseInt(v, 10) || 1); break;
          case "COUNT": r.count = Math.max(0, parseInt(v, 10) || 0); break;
          case "UNTIL": r.until = v; break;
          case "WKST": r.wkst = Math.max(0, WD.indexOf(v.toUpperCase())); break;
          case "BYDAY":
            r.byday = v.split(",").map(s => {
              const m = s.trim().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i);
              return m ? { ord: m[1] ? parseInt(m[1], 10) : 0, wd: WD.indexOf(m[2].toUpperCase()) } : null;
            }).filter(Boolean);
            break;
          case "BYMONTHDAY": r.bymonthday = v.split(",").map(Number).filter(n => n && Math.abs(n) <= 31); break;
          case "BYMONTH": r.bymonth = v.split(",").map(Number).filter(n => n >= 1 && n <= 12); break;
          case "BYSETPOS": r.bysetpos = v.split(",").map(Number).filter(n => n && Math.abs(n) <= 366); break;
        }
      }
      return r.freq ? r : null;
    }

    function* applySetPos(cands, bysetpos) {
      const list = [...new Set(cands)].sort((a, b) => a - b);
      if (!bysetpos) { yield* list; return; }
      const picked = [];
      for (const p of bysetpos) {
        const x = p > 0 ? list[p - 1] : list[list.length + p];
        if (x != null) picked.push(x);
      }
      yield* [...new Set(picked)].sort((a, b) => a - b);
    }

    // Candidate occurrence days (civil day numbers) for an RRULE, ascending.
    // `lowDay` lets rules without COUNT skip straight to the window.
    function* generateDays(ev, lowDay, highDay) {
      const rr = ev.rrule, s = ev.start;
      const sDay = daysFromCivil(s.y, s.mo, s.d);
      const interval = rr.interval || 1;
      const { byday, bymonthday: bymd, bymonth: bym, bysetpos } = rr;
      const noCount = rr.count == null;
      const MAX = 200000;

      const monthDays = (y, m, first, dim) => {
        const out = [];
        if (bymd) {
          for (const x of bymd) {
            const d = x > 0 ? x : dim + x + 1;
            if (d >= 1 && d <= dim) out.push(first + d - 1);
          }
        } else if (byday) {
          for (const b of byday) {
            const matches = [];
            for (let d = 0; d < dim; d++) if (weekday(first + d) === b.wd) matches.push(first + d);
            if (b.ord > 0) { if (matches[b.ord - 1] != null) out.push(matches[b.ord - 1]); }
            else if (b.ord < 0) { const x = matches[matches.length + b.ord]; if (x != null) out.push(x); }
            else out.push(...matches);
          }
        } else if (s.d <= dim) out.push(first + s.d - 1);
        return out;
      };

      switch (rr.freq) {
        case "DAILY": {
          let dn = sDay;
          if (noCount && lowDay > dn) dn += Math.floor((lowDay - dn) / interval) * interval;
          for (let it = 0; it < MAX && dn <= highDay; it++, dn += interval) {
            const c = civilFromDays(dn), wd = weekday(dn);
            if (bym && !bym.includes(c.m)) continue;
            if (bymd && !bymd.some(x => (x > 0 ? x : daysInMonth(c.y, c.m) + x + 1) === c.d)) continue;
            if (byday && !byday.some(b => b.wd === wd)) continue;
            yield dn;
          }
          return;
        }
        case "WEEKLY": {
          const wkst = rr.wkst ?? 1;
          const days = byday ? [...new Set(byday.map(b => b.wd))] : [weekday(sDay)];
          let ws = sDay - ((((weekday(sDay) - wkst) % 7) + 7) % 7);
          if (noCount && lowDay > ws + 7) ws += Math.floor((lowDay - 7 - ws) / (7 * interval)) * 7 * interval;
          for (let it = 0; it < MAX && ws <= highDay; it++, ws += 7 * interval) {
            const cands = [];
            for (let i = 0; i < 7; i++) {
              const dn = ws + i;
              if (dn < sDay || !days.includes(weekday(dn))) continue;
              if (bym && !bym.includes(civilFromDays(dn).m)) continue;
              cands.push(dn);
            }
            yield* applySetPos(cands, bysetpos);
          }
          return;
        }
        case "MONTHLY": {
          let mi = s.y * 12 + (s.mo - 1);
          if (noCount) {
            const lc = civilFromDays(lowDay), lmi = lc.y * 12 + lc.m - 1;
            if (lmi - 1 > mi) mi += Math.floor((lmi - 1 - mi) / interval) * interval;
          }
          for (let it = 0; it < MAX; it++, mi += interval) {
            const y = Math.floor(mi / 12), m = (mi % 12) + 1;
            const first = daysFromCivil(y, m, 1);
            if (first > highDay) return;
            if (bym && !bym.includes(m)) continue;
            const cands = monthDays(y, m, first, daysInMonth(y, m)).filter(dn => dn >= sDay);
            yield* applySetPos(cands, bysetpos);
          }
          return;
        }
        case "YEARLY": {
          let y = s.y;
          if (noCount) {
            const ly = civilFromDays(lowDay).y;
            if (ly - 1 > y) y += Math.floor((ly - 1 - y) / interval) * interval;
          }
          for (let it = 0; it < MAX; it++, y += interval) {
            const jan1 = daysFromCivil(y, 1, 1);
            if (jan1 > highDay) return;
            let cands = [];
            if (byday && !bym && !bymd) {
              // Nth weekday of the year.
              const n = daysFromCivil(y + 1, 1, 1) - jan1;
              for (const b of byday) {
                const matches = [];
                for (let d = 0; d < n; d++) if (weekday(jan1 + d) === b.wd) matches.push(jan1 + d);
                if (b.ord > 0) { if (matches[b.ord - 1] != null) cands.push(matches[b.ord - 1]); }
                else if (b.ord < 0) { const x = matches[matches.length + b.ord]; if (x != null) cands.push(x); }
                else cands.push(...matches);
              }
            } else {
              for (const m of bym || [s.mo]) {
                cands.push(...monthDays(y, m, daysFromCivil(y, m, 1), daysInMonth(y, m)));
              }
            }
            yield* applySetPos(cands.filter(dn => dn >= sDay), bysetpos);
          }
          return;
        }
        default:
          // SECONDLY/MINUTELY/HOURLY are vanishingly rare in real calendars.
          yield sDay;
      }
    }

    function durationOf(ev) {
      if (ev.allDay) {
        const sd = daysFromCivil(ev.start.y, ev.start.mo, ev.start.d);
        let days = 1;
        if (ev.end) days = daysFromCivil(ev.end.y, ev.end.mo, ev.end.d) - sd;
        else if (ev.durationMs != null) days = Math.round(ev.durationMs / DAY);
        return { days: Math.max(1, days) };
      }
      let ms = 0;
      if (ev.end) ms = toInstant(ev.end) - toInstant(ev.start);
      else if (ev.durationMs != null) ms = ev.durationMs;
      return { ms: Math.max(0, ms) };
    }

    function parseUntil(ev) {
      const u = parseDT(ev.rrule.until, null, null, ev.start.tz);
      if (!u) return null;
      if (u.allDay) {
        // A DATE-form UNTIL is inclusive: the instance on that day still counts.
        return instantOnDay(ev.start, daysFromCivil(u.y, u.mo, u.d));
      }
      return toInstant(u);
    }

    // Occurrences of one VEVENT overlapping [winStart, winEnd), as epoch ms.
    // `skip` is a Set of start instants to drop (EXDATEs and overridden instances).
    function expandEvent(ev, winStart, winEnd, skip) {
      const out = [];
      const sDay = daysFromCivil(ev.start.y, ev.start.mo, ev.start.d);
      const dur = durationOf(ev);
      const spanDays = ev.allDay ? dur.days : Math.ceil(dur.ms / DAY);
      const lowDay = Math.floor(winStart / DAY) - 2 - spanDays;
      const highDay = Math.floor(winEnd / DAY) + 2;
      const rr = ev.rrule;
      const until = rr && rr.until ? parseUntil(ev) : null;
      const count = rr ? rr.count : null;
      const seen = new Set();
      let n = 0;

      const consider = (dn, counted) => {
        const start = instantOnDay(ev.start, dn);
        if (counted) {
          if (until != null && start > until) return "stop";
          n++;
          if (count != null && n > count) return "stop";
        }
        if (seen.has(start)) return undefined;
        seen.add(start);
        if (start >= winEnd) return counted ? "stop" : undefined;
        if (skip && skip.has(start)) return undefined;
        const end = ev.allDay ? instantOnDay(ev.start, dn + dur.days) : start + dur.ms;
        if (end > winStart || (end === start && start >= winStart)) out.push({ start, end });
        return undefined;
      };

      if (!rr) {
        consider(sDay, false);
      } else {
        let first = true;
        for (const dn of generateDays(ev, lowDay, highDay)) {
          if (first) {
            first = false;
            // DTSTART is always the first instance, even when the rule itself
            // wouldn't produce it.
            if (dn !== sDay && consider(sDay, true) === "stop") break;
          }
          if (consider(dn, true) === "stop") break;
        }
        if (first && consider(sDay, true) === "stop") { /* nothing generated */ }
      }
      for (const rd of ev.rdates || []) {
        if (rd.allDay !== ev.allDay) continue;
        consider(daysFromCivil(rd.y, rd.mo, rd.d), false);
      }
      return out;
    }

    // ---------- VCALENDAR → normalized events ----------

    const VIDEO_RE = /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|gotomeet\.me|bluejeans\.com|around\.co|meet\.jit\.si|discord\.gg|discord\.com\/invite|facetime\.apple\.com)\/[^\s"'<>\\]*/i;

    function findJoinLink(ev) {
      for (const field of [ev.conference, ev.url, ev.location, ev.description]) {
        if (!field) continue;
        const m = String(field).match(VIDEO_RE);
        if (m) return m[0].replace(/[.,;)]+$/, "");
      }
      return "";
    }

    function normalizeEvent(comp, cal) {
      const get = n => comp.props.find(p => p.name === n);
      const all = n => comp.props.filter(p => p.name === n);
      const text = n => { const p = get(n); return p ? unescapeText(p.value).trim() : ""; };

      const ds = get("DTSTART");
      if (!ds) return null;
      const start = parseDT(ds.value, ds.params, cal.timezones);
      if (!start) return null;

      let end = null, durationMs = null;
      const de = get("DTEND");
      if (de) end = parseDT(de.value, de.params, cal.timezones, start.tz);
      if (end && end.allDay !== start.allDay) end = null; // mismatched forms — treat as missing
      if (!end) { const du = get("DURATION"); if (du) durationMs = parseDuration(du.value); }

      const rrProp = get("RRULE");
      const rrule = rrProp ? parseRRule(rrProp.value) : null;

      const wallsOf = props => {
        const out = [];
        for (const p of props) {
          for (const v of p.value.split(",")) {
            const w = parseDT(v, p.params, cal.timezones, start.tz);
            if (!w) continue;
            // A DATE exclusion on a timed series means "that day's instance".
            if (w.allDay && !start.allDay) Object.assign(w, { h: start.h, mi: start.mi, s: start.s, tz: start.tz, allDay: false });
            out.push(w);
          }
        }
        return out;
      };
      const rid = get("RECURRENCE-ID");
      let recurrenceId = rid ? parseDT(rid.value, rid.params, cal.timezones, start.tz) : null;
      if (recurrenceId && recurrenceId.allDay && !start.allDay) {
        Object.assign(recurrenceId, { h: start.h, mi: start.mi, s: start.s, tz: start.tz, allDay: false });
      }

      const status = text("STATUS").toUpperCase();
      const ev = {
        uid: text("UID") || `${start.y}${start.mo}${start.d}-${text("SUMMARY")}`,
        summary: text("SUMMARY") || "(untitled)",
        location: text("LOCATION"),
        description: text("DESCRIPTION"),
        url: text("URL"),
        conference: text("X-GOOGLE-CONFERENCE") || text("X-MICROSOFT-SKYPETEAMSMEETINGURL"),
        status,
        cancelled: status === "CANCELLED",
        transparent: text("TRANSP").toUpperCase() === "TRANSPARENT",
        start, end, durationMs,
        allDay: start.allDay,
        rrule,
        exdates: wallsOf(all("EXDATE")),
        rdates: wallsOf(all("RDATE")).filter(w => w.allDay === start.allDay),
        recurrenceId,
        sequence: parseInt(text("SEQUENCE"), 10) || 0,
      };
      ev.join = findJoinLink(ev);
      return ev;
    }

    function parseICS(textIn) {
      const cal = { name: "", color: "", events: [], timezones: {} };
      const lines = unfold(String(textIn)).split("\n");
      let cur = null;
      for (const raw of lines) {
        if (!raw) continue;
        const p = parseLine(raw);
        if (!p) continue;
        if (p.name === "BEGIN") {
          cur = { type: p.value.trim().toUpperCase(), props: [], parent: cur, children: [] };
          continue;
        }
        if (p.name === "END") {
          const done = cur;
          if (!done) continue;
          cur = done.parent;
          if (cur) cur.children.push(done);
          if (done.type === "VEVENT") {
            const ev = normalizeEvent(done, cal);
            if (ev) cal.events.push(ev);
          } else if (done.type === "VTIMEZONE") {
            const tzid = (done.props.find(x => x.name === "TZID") || {}).value;
            if (!tzid) continue;
            const loc = (done.props.find(x => x.name === "X-LIC-LOCATION") || {}).value;
            const std = done.children.find(c => c.type === "STANDARD") || done.children[0];
            let offset = null;
            const to = std && std.props.find(x => x.name === "TZOFFSETTO");
            if (to) {
              const m = to.value.match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
              if (m) offset = (m[1] === "-" ? -1 : 1) * ((+m[2]) * 3600000 + (+m[3]) * 60000 + (+(m[4] || 0)) * 1000);
            }
            cal.timezones[tzid.trim()] = { location: loc ? loc.trim() : "", offset };
          }
          continue;
        }
        if (!cur) continue;
        if (cur.type === "VCALENDAR") {
          if (p.name === "X-WR-CALNAME" || p.name === "NAME") cal.name = cal.name || unescapeText(p.value).trim();
          else if (p.name === "X-APPLE-CALENDAR-COLOR" || p.name === "COLOR") cal.color = cal.color || p.value.trim();
          continue;
        }
        cur.props.push(p);
      }
      // Normalization ran before later VTIMEZONEs were seen (Google puts them
      // first; Outlook usually does too). If any TZID failed to resolve and a
      // VTIMEZONE arrived afterwards, resolve again now.
      const fix = w => { if (w && !w.allDay && w.tz == null && w._tzid) w.tz = resolveTz(w._tzid, cal.timezones); };
      for (const ev of cal.events) {
        fix(ev.start); fix(ev.end); fix(ev.recurrenceId);
        ev.exdates.forEach(fix); ev.rdates.forEach(fix);
      }
      return cal;
    }

    // ---------- agenda ----------

    const localDayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };

    // feeds: [{ name, color, events }]. Returns per-day lists for `days` days
    // starting today, plus a few summary numbers for the badge.
    function buildAgenda(feeds, now, opts) {
      const days = Math.max(1, Math.min(14, (opts && opts.days) || 1));
      const showPast = !!(opts && opts.showPast);
      const winStart = localDayStart(now);
      const winEnd = addDays(winStart, days);
      const items = [];
      const seen = new Set();

      feeds.forEach((feed, fi) => {
        const skip = new Map(); // uid → Set<start instant> replaced by overrides
        for (const ev of feed.events) {
          if (!ev.recurrenceId) continue;
          let set = skip.get(ev.uid);
          if (!set) { set = new Set(); skip.set(ev.uid, set); }
          set.add(toInstant(ev.recurrenceId));
        }
        for (const ev of feed.events) {
          if (ev.cancelled) continue;
          const skipSet = new Set(ev.recurrenceId ? [] : skip.get(ev.uid) || []);
          for (const x of ev.exdates) skipSet.add(toInstant(x));
          for (const occ of expandEvent(ev, winStart, winEnd, skipSet)) {
            const key = `${ev.uid}|${occ.start}|${ev.recurrenceId ? "o" : "m"}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({
              uid: ev.uid, summary: ev.summary, location: ev.location, url: ev.url, join: ev.join,
              allDay: ev.allDay, transparent: ev.transparent,
              start: occ.start, end: occ.end,
              calendar: feed.name || "", color: feed.color || "", feedIndex: fi,
            });
          }
        }
      });

      const out = [];
      let remainingToday = 0, nowItem = null, nextItem = null;
      for (let i = 0; i < days; i++) {
        const dayStart = addDays(winStart, i), dayEnd = addDays(winStart, i + 1);
        let list = items.filter(it =>
          (it.start < dayEnd && it.end > dayStart) ||
          (it.start === it.end && it.start >= dayStart && it.start < dayEnd)
        );
        if (i === 0 && !showPast) list = list.filter(it => it.allDay || it.end > now);
        list.sort((a, b) =>
          (b.allDay - a.allDay) || (a.start - b.start) || (a.end - b.end) || a.summary.localeCompare(b.summary)
        );
        for (const it of list) {
          it.continues = it.start < dayStart;
          it.continuesAfter = it.end > dayEnd;
          if (i === 0 && !it.allDay) {
            if (it.end > now) remainingToday++;
            if (it.start <= now && it.end > now && !nowItem) nowItem = it;
            if (it.start > now && !nextItem) nextItem = it;
          }
        }
        out.push({ offset: i, dayStart, dayEnd, items: list });
      }
      return { days: out, winStart, winEnd, remainingToday, nowItem, nextItem };
    }

    return {
      DAY, unfold, unescapeText, parseLine, parseDT, toInstant, parseDuration, parseRRule,
      resolveTz, zonedToInstant, tzOffsetMs, daysFromCivil, civilFromDays, weekday,
      expandEvent, parseICS, buildAgenda, findJoinLink, normalizeEvent, durationOf,
    };
  })();

  if (!IS_BROWSER) {
    // Node (tests): expose the pure core and stop here.
    if (typeof module !== "undefined") module.exports = CalendarCore;
    return;
  }

  // =========================================================================
  //  Browser side
  // =========================================================================
  const XHTML = "http://www.w3.org/1999/xhtml";
  const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const SVGNS = "http://www.w3.org/2000/svg";
  const TAG = "[calendar-peek]";
  const PREF = "mod.calendarpeek.";
  const VERSION = "1.1.0";

  const pref = (name, fallback) => {
    try {
      switch (Services.prefs.getPrefType(name)) {
        case Services.prefs.PREF_STRING: return Services.prefs.getStringPref(name);
        case Services.prefs.PREF_INT: return Services.prefs.getIntPref(name);
        case Services.prefs.PREF_BOOL: return Services.prefs.getBoolPref(name);
      }
    } catch {}
    return fallback;
  };
  const sPref = (n, f) => String(pref(PREF + n, f) ?? f);
  const iPref = (n, f) => { const v = parseInt(pref(PREF + n, f), 10); return Number.isFinite(v) ? v : f; };
  const bPref = (n, f) => { const v = pref(PREF + n, f); return typeof v === "boolean" ? v : String(v) === "true"; };

  const debug = (...a) => { if (bPref("debug", false)) { try { console.log(TAG, ...a); } catch {} } };

  // ---------- providers ----------
  // Which tabs count as "a calendar tab", and the handful of deep links we
  // know for each service. Everything else just focuses the tab.
  const PROVIDERS = [
    {
      id: "google",
      test: /^https?:\/\/calendar\.google\.com\//i,
      account: url => (url.match(/calendar\.google\.com\/calendar\/u\/(\d+)\//) || [])[1] || "0",
      newEvent: ({ account }) => `https://calendar.google.com/calendar/u/${account}/r/eventedit`,
      openDay: ({ account }, y, m, d) => `https://calendar.google.com/calendar/u/${account}/r/day/${y}/${m}/${d}`,
      settings: ({ account }) => `https://calendar.google.com/calendar/u/${account}/r/settings`,
    },
    {
      id: "outlook",
      test: /^https?:\/\/outlook\.(live|office|office365)\.com\/calendar/i,
      newEvent: ({ url }) => `${new URL(url).origin}/calendar/0/deeplink/compose`,
    },
    { id: "icloud", test: /^https?:\/\/(www\.)?icloud\.com\/calendar/i },
    { id: "proton", test: /^https?:\/\/calendar\.proton\.me\//i },
    { id: "fastmail", test: /^https?:\/\/app\.fastmail\.com\/calendar/i },
  ];

  const PALETTE = ["#4285f4", "#0b8043", "#8e24aa", "#f4511e", "#e67c73", "#f6bf26", "#33b679", "#039be5", "#7986cb", "#616161"];

  // "Label=https://…" entries, separated by whitespace or commas.
  function parseFeedList(str) {
    const out = [];
    for (const raw of String(str || "").split(/[\s,]+/)) {
      if (!raw) continue;
      let label = "", url = raw;
      const m = raw.match(/^([^=\s/:]+)=(\S+)$/);
      if (m && /^[a-z]+:\/\//i.test(m[2])) { label = m[1]; url = m[2]; }
      url = url.replace(/^webcals?:\/\//i, "https://");
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({ label: label.replace(/[_+]/g, " "), url });
    }
    return out;
  }

  const el = (tag, cls, text) => {
    const node = document.createElementNS(XHTML, tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  // innerHTML doesn't reliably namespace <svg> inside chrome docs, so icons
  // are built explicitly in the SVG namespace.
  const makeIcon = (paths, size, strokeWidth = 1.7, viewBox = 24) => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", `0 0 ${viewBox} ${viewBox}`);
    for (const d of paths) {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", strokeWidth);
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("fill", "none");
      svg.appendChild(p);
    }
    return svg;
  };

  // A tab element can be <tab class="tabbrowser-tab"> or a custom element —
  // accept either, plus shadow-retargeted descendants.
  const asTab = node => {
    for (let n = node; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentNode) {
      const name = n.localName;
      if (name === "tab" || name === "tabbrowser-tab" || n.classList?.contains("tabbrowser-tab")) return n;
      if (name === "tabs" || name === "tabbrowser-tabs" || name === "window") return null;
    }
    return null;
  };

  // ---------- formatting ----------

  const fmtParts = (ms, opts) => new Intl.DateTimeFormat(undefined, opts).formatToParts(new Date(ms));
  const fmtTime = ms => {
    const parts = fmtParts(ms, { hour: "numeric", minute: "2-digit" });
    return parts.map(p => p.value).join("").replace(/\s+/g, " ").trim();
  };
  // "10:00 AM" → "10am", "2:30 PM" → "2:30pm"; 24-hour locales are left alone.
  const fmtTimeShort = ms => fmtTime(ms)
    .replace(/:00(?=\s*[ap]\.?m\.?$)/i, "")
    .replace(/\s?([ap])\.?m\.?$/i, (m, x) => x.toLowerCase() + "m");
  const fmtDayLabel = ms => fmtParts(ms, { weekday: "short", month: "short", day: "numeric" }).map(p => p.value).join("");
  const fmtWeekdayLong = ms => fmtParts(ms, { weekday: "long" }).map(p => p.value).join("");
  const fmtMonthDay = ms => fmtParts(ms, { month: "short", day: "numeric" }).map(p => p.value).join("");

  // Only what's imminent gets a chip — Arc-style. Anything further out just
  // has its time.
  const relative = (it, now) => {
    if (it.start <= now && it.end > now) return { kind: "now", text: "Now" };
    const dm = Math.round((it.start - now) / 60000);
    if (dm <= 0) return null;
    if (dm < 60) return { kind: "soon", text: `in ${dm} min` };
    return null;
  };

  const CSS = `
    #calpeek-panel {
      --cp-bg: var(--panel-background, Field);
      --cp-fg: var(--panel-color, FieldText);
      --cp-dim: color-mix(in srgb, var(--cp-fg) 56%, transparent);
      --cp-faint: color-mix(in srgb, var(--cp-fg) 38%, transparent);
      --cp-hover: color-mix(in srgb, var(--cp-fg) 7%, transparent);
      --cp-border: color-mix(in srgb, var(--cp-fg) 13%, transparent);
      --cp-accent: var(--zen-primary-color, var(--toolbarbutton-icon-fill-attention, #3b82f6));
      --cp-on-accent: #fff;
    }
    #calpeek-panel {
      /* The native macOS menu shape can't be re-rounded, so draw the frame
         ourselves: inner radius = --panel-border-radius, outer = inner + the
         gap between the edges (shadow margin + border). */
      appearance: none;
      background-color: Menu;
      border-radius: calc(var(--panel-border-radius, 12px) + var(--panel-box-shadow-margin, 0px) + 1px);
    }
    #calpeek-panel::part(content) {
      border-radius: var(--panel-border-radius, 12px);
    }
    #calpeek-panel .cp-box {
      width: 324px;
      font: menu;
      color: var(--cp-fg);
      padding: 4px 0 44px;
      position: relative;
      -moz-user-select: none;
    }
    #calpeek-panel .cp-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px 6px;
    }
    #calpeek-panel .cp-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    #calpeek-panel .cp-title-date {
      font-weight: 500;
      color: var(--cp-dim);
      margin-left: 7px;
      font-size: 12px;
    }
    #calpeek-panel .cp-header-right {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--cp-dim);
      white-space: nowrap;
    }
    #calpeek-panel .cp-iconbtn {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--cp-dim);
      align-self: center;
    }
    #calpeek-panel .cp-iconbtn:hover {
      background: var(--cp-hover);
      color: var(--cp-fg);
    }
    #calpeek-panel .cp-iconbtn.cp-spin svg {
      animation: cp-rot 0.7s linear infinite;
    }
    @keyframes cp-rot { to { transform: rotate(360deg); } }
    /* Day timeline: the shape of today, with a marker for now. */
    #calpeek-panel .cp-timeline {
      position: relative;
      height: 34px;
      margin: 2px 14px 0;
    }
    #calpeek-panel .cp-track {
      position: absolute;
      left: 0; right: 0; top: 13px;
      height: 6px;
      border-radius: 3px;
      background: var(--cp-hover);
    }
    #calpeek-panel .cp-block {
      position: absolute;
      top: 13px;
      height: 6px;
      min-width: 3px;
      border-radius: 3px;
      background: var(--cp-color, var(--cp-accent));
      opacity: 0.75;
    }
    #calpeek-panel .cp-block.cp-past { opacity: 0.28; }
    #calpeek-panel .cp-block.cp-live {
      opacity: 1;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--cp-color, var(--cp-accent)) 28%, transparent);
    }
    #calpeek-panel .cp-nowmark {
      position: absolute;
      top: 8px;
      width: 2px;
      height: 16px;
      margin-left: -1px;
      border-radius: 1px;
      background: var(--cp-accent);
      box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--cp-bg) 85%, transparent);
    }
    #calpeek-panel .cp-nowmark::before {
      content: "";
      position: absolute;
      left: -2px; top: -3px;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--cp-accent);
    }
    #calpeek-panel .cp-nowlabel {
      position: absolute;
      top: -5px;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: var(--cp-accent);
      white-space: nowrap;
      transform: translateX(-50%);
    }
    #calpeek-panel .cp-nowlabel.cp-edge-l { transform: none; }
    #calpeek-panel .cp-nowlabel.cp-edge-r { transform: translateX(-100%); }
    #calpeek-panel .cp-hour {
      position: absolute;
      top: 22px;
      font-size: 9.5px;
      color: var(--cp-faint);
    }
    #calpeek-panel .cp-hour.cp-r { right: 0; }
    /* The "now" rule inside the list, Google-Calendar style. */
    #calpeek-panel .cp-nowline {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 1px 6px;
      padding: 0 8px;
      height: 14px;
    }
    #calpeek-panel .cp-nowtime {
      width: 56px;
      flex-shrink: 0;
      text-align: right;
      font-size: 10px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--cp-accent);
    }
    #calpeek-panel .cp-nowrule {
      position: relative;
      flex: 1;
      height: 2px;
      border-radius: 1px;
      background: var(--cp-accent);
    }
    #calpeek-panel .cp-nowrule::before {
      content: "";
      position: absolute;
      left: -2px; top: -2px;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--cp-accent);
    }
    #calpeek-panel .cp-more.cp-earlier {
      cursor: pointer;
      padding: 3px 14px 2px 79px;
      text-align: left;
    }
    #calpeek-panel .cp-more.cp-earlier:hover { color: var(--cp-dim); }
    #calpeek-panel .cp-done {
      padding: 10px 14px 6px 79px;
      font-size: 12px;
      color: var(--cp-dim);
    }
    #calpeek-panel .cp-dayhead {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 12px 14px 3px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--cp-dim);
    }
    #calpeek-panel .cp-dayhead span:last-child {
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      color: var(--cp-faint);
    }
    #calpeek-panel .cp-row {
      display: flex;
      align-items: stretch;
      gap: 9px;
      margin: 1px 6px;
      padding: 6px 8px 6px 8px;
      border-radius: 9px;
      cursor: pointer;
      line-height: 16px;
    }
    #calpeek-panel .cp-row:hover,
    #calpeek-panel .cp-row:focus-visible {
      background: var(--cp-hover);
    }
    #calpeek-panel .cp-row.cp-past { opacity: 0.5; }
    #calpeek-panel .cp-time {
      width: 56px;
      flex-shrink: 0;
      text-align: right;
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
      color: var(--cp-dim);
      display: flex;
      flex-direction: column;
    }
    #calpeek-panel .cp-time .cp-start {
      color: var(--cp-fg);
      font-weight: 600;
      font-size: 12px;
    }
    #calpeek-panel .cp-time .cp-allday {
      color: var(--cp-dim);
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.02em;
    }
    #calpeek-panel .cp-bar {
      width: 3px;
      border-radius: 3px;
      flex-shrink: 0;
      background: var(--cp-color, var(--cp-accent));
      opacity: 0.9;
      margin: 1px 0;
    }
    #calpeek-panel .cp-row.cp-live .cp-bar {
      box-shadow: 0 0 0 2.5px color-mix(in srgb, var(--cp-color, var(--cp-accent)) 28%, transparent);
    }
    #calpeek-panel .cp-row.cp-free .cp-bar {
      background: transparent;
      border: 1px solid var(--cp-color, var(--cp-accent));
      width: 1px;
    }
    #calpeek-panel .cp-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    #calpeek-panel .cp-summary {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #calpeek-panel .cp-meta {
      font-size: 11.5px;
      color: var(--cp-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #calpeek-panel .cp-side {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      justify-content: center;
      gap: 3px;
      flex-shrink: 0;
    }
    #calpeek-panel .cp-chip {
      font-size: 10.5px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
      line-height: 15px;
      background: color-mix(in srgb, var(--cp-accent) 16%, transparent);
      color: var(--cp-accent);
      white-space: nowrap;
    }
    #calpeek-panel .cp-chip.cp-now {
      background: var(--cp-accent);
      color: var(--cp-on-accent);
    }
    #calpeek-panel .cp-join {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 999px;
      line-height: 16px;
      cursor: pointer;
      white-space: nowrap;
      background: var(--cp-hover);
      color: var(--cp-fg);
      border: 1px solid var(--cp-border);
    }
    #calpeek-panel .cp-join.cp-hot {
      background: var(--cp-accent);
      color: var(--cp-on-accent);
      border-color: transparent;
      padding: 3px 12px;
      font-size: 12px;
    }
    #calpeek-panel .cp-join:hover { filter: brightness(1.1); }
    #calpeek-panel .cp-empty {
      padding: 16px 14px 14px;
      text-align: center;
      font-size: 12.5px;
      color: var(--cp-dim);
    }
    #calpeek-panel .cp-empty.cp-today {
      padding: 22px 14px 18px;
    }
    #calpeek-panel .cp-empty .cp-big {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--cp-fg);
      margin-bottom: 2px;
    }
    #calpeek-panel .cp-setup {
      padding: 14px 16px 8px;
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--cp-dim);
    }
    #calpeek-panel .cp-setup strong {
      display: block;
      font-size: 13px;
      color: var(--cp-fg);
      margin-bottom: 4px;
    }
    #calpeek-panel .cp-setup code {
      font: 11px ui-monospace, Menlo, Consolas, monospace;
      background: var(--cp-hover);
      padding: 1px 5px;
      border-radius: 4px;
      color: var(--cp-fg);
    }
    #calpeek-panel .cp-setup ol {
      margin: 6px 0 0;
      padding-left: 18px;
    }
    #calpeek-panel .cp-setup li { margin: 2px 0; }
    #calpeek-panel .cp-button {
      display: inline-block;
      margin: 10px 0 2px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      color: var(--cp-on-accent);
      background: var(--cp-accent);
      cursor: pointer;
    }
    #calpeek-panel .cp-more {
      padding: 2px 14px 6px;
      font-size: 11px;
      color: var(--cp-faint);
      text-align: center;
    }
    #calpeek-panel .cp-error {
      margin: 6px 14px 0;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 11px;
      color: var(--cp-dim);
      background: var(--cp-hover);
    }
    #calpeek-panel .cp-add {
      position: absolute;
      right: 10px;
      bottom: 9px;
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 50%;
      border: 1px solid var(--cp-border);
      background: var(--cp-bg);
      color: var(--cp-fg);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    #calpeek-panel .cp-add:hover { background: var(--cp-hover); }
    #calpeek-panel .cp-add svg { display: block; }
    #calpeek-panel .cp-status {
      position: absolute;
      left: 14px;
      bottom: 16px;
      font-size: 11px;
      color: var(--cp-faint);
    }
  `;

  // Tab internals live in the tab's shadow DOM, so the badge can't be styled
  // with document CSS — it gets inline styles instead.
  const BADGE_STYLE =
    "position:absolute;top:-3px;right:-4px;min-width:14px;height:14px;" +
    "padding:0 3px;border-radius:7px;background:var(--zen-primary-color,#3b82f6);color:#fff;" +
    "font-size:9.5px;font-weight:700;line-height:14px;text-align:center;" +
    "pointer-events:none;box-sizing:border-box;";

  class CalendarPeek {
    constructor() {
      this.hoverTab = null;
      this.currentTab = null;
      this.hoverTimer = null;
      this.hideTimer = null;
      this.tickTimer = null;
      this.suppressTooltip = false;
      this.panel = null;
      this.box = null;
      this.cache = { t: 0, refreshedAt: 0, feeds: null, errors: [], key: "" };
      this.inflight = null;
      this.calTabs = new Set();
      this.boundTabs = new WeakSet();
      this.refreshSequence = 0;
      this.refreshing = false;
      this.dotsTimer = null;
      this.refreshDots = 0;
      this._compactHold = null;
      this._weSetUserShow = false;

      this.onHoverIn = this.onHoverIn.bind(this);
      this.onHoverOut = this.onHoverOut.bind(this);
      this.onPopupShowing = this.onPopupShowing.bind(this);
      this.onClick = this.onClick.bind(this);
      this.prefObserver = { observe: () => this.onPrefChange() };
    }

    init() {
      const style = el("style");
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);

      // Delegated listeners — capture phase so shadow-DOM retargeting and
      // stopPropagation in Zen handlers can't eat them.
      for (const evt of ["mouseover", "pointerover"]) document.addEventListener(evt, this.onHoverIn, true);
      for (const evt of ["mouseout", "pointerout"]) document.addEventListener(evt, this.onHoverOut, true);
      document.addEventListener("popupshowing", this.onPopupShowing, true);

      this.observer = new MutationObserver(() => this.scanTabs());
      const root =
        gBrowser.tabContainer ||
        document.querySelector(".zen-essentials-container") ||
        document.documentElement;
      this.observer.observe(root, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ["zen-essential", "pinned", "data-zen-url", "data-zen-pinned-url", "label", "title"],
      });
      try {
        for (const e of ["TabAttrModified", "TabPinned", "TabUnpinned"]) {
          gBrowser.tabContainer?.addEventListener(e, () => this.scanTabs());
        }
      } catch {}
      try { Services.prefs.addObserver(PREF, this.prefObserver); } catch {}

      window.addEventListener("unload", () => this.destroy(), { once: true });

      // Keep the badge fresh and the first hover instant.
      this.badgeTimer = setInterval(() => this.refreshBadge(), 60000);
      this.scanTabs();
      this.refreshBadge(true);
      debug("init complete", { tabs: this.calTabs.size, v: VERSION });
    }

    destroy() {
      clearInterval(this.badgeTimer);
      clearInterval(this.dotsTimer);
      clearInterval(this.tickTimer);
      clearTimeout(this.hoverTimer);
      clearTimeout(this.hideTimer);
      this.observer?.disconnect();
      document.removeEventListener("mouseover", this.onHoverIn, true);
      document.removeEventListener("pointerover", this.onHoverIn, true);
      document.removeEventListener("mouseout", this.onHoverOut, true);
      document.removeEventListener("pointerout", this.onHoverOut, true);
      document.removeEventListener("popupshowing", this.onPopupShowing, true);
      try { Services.prefs.removeObserver(PREF, this.prefObserver); } catch {}
      this.releaseCompactSidebar();
      this.panel?.remove();
      for (const tab of this.calTabs) (tab.shadowRoot || tab).querySelector?.(".calpeek-badge")?.remove();
      window.calendarPeek = null;
    }

    onPrefChange() {
      // Feeds or lookahead changed in Sine → forget everything and refetch.
      // Debounced: the settings page fires once per keystroke.
      clearTimeout(this._prefTimer);
      this._prefTimer = setTimeout(() => {
        this.cache = { t: 0, refreshedAt: 0, feeds: null, errors: [], key: "" };
        if (this.panel?.state === "open" && this.currentTab) this.refresh(this.currentTab);
        else this.refreshBadge(true);
      }, 1200);
    }

    // ---------- tab detection ----------

    // Zen workspace tabs don't carry data-zen-url (only Essentials do) and
    // hibernated/lazy tabs have a blank linkedBrowser.currentURI, so check
    // several sources.
    tabUrl(tab) {
      if (!tab) return "";
      let url = "";
      try { if (typeof gBrowser?.getTabURL === "function") url = gBrowser.getTabURL(tab); } catch {}
      if (url && typeof url === "string" && url !== "about:blank") return url;
      const candidates = [
        tab.getAttribute?.("data-zen-url"),
        tab.getAttribute?.("data-zen-pinned-url"),
        tab.getAttribute?.("zen-tab-url"),
        tab.getAttribute?.("url"),
        tab._zenPinnedInitialState?.entry?.url,
        tab.linkedBrowser?.currentURI?.spec,
        tab.linkedBrowser?.registeredOpenURI?.spec,
        tab.linkedBrowser?.userTypedValue,
      ];
      for (const c of candidates) if (typeof c === "string" && c && c !== "about:blank") return c;
      return "";
    }

    providerFor(tab) {
      const url = this.tabUrl(tab);
      if (url) {
        for (const p of PROVIDERS) if (p.test.test(url)) return { ...p, url, account: p.account ? p.account(url) : "0" };
        for (const pat of sPref("match", "").split(/[\s,]+/).filter(Boolean)) {
          if (url.toLowerCase().includes(pat.toLowerCase())) return { id: "other", url, account: "0" };
        }
        return null;
      }
      // URL unresolvable (lazy/workspace tab): fall back to title/favicon.
      const label = tab.getAttribute?.("label") || tab.label || "";
      const tooltip = tab.getAttribute?.("tooltiptext") || tab.getAttribute?.("title") || "";
      const image = tab.getAttribute?.("image") || tab.image || "";
      if (/\bcalendar\b/i.test(label) || /\bcalendar\b/i.test(tooltip) || /calendar/i.test(image)) {
        return { id: "other", url: "", account: "0" };
      }
      return null;
    }

    isCalendarTab(tab) {
      if (!tab) return false;
      if (bPref("require_pinned", false) &&
          !(tab.pinned || tab.hasAttribute("zen-essential") || tab.hasAttribute("pinned"))) return false;
      return !!this.providerFor(tab);
    }

    scanTabs() {
      for (const tab of gBrowser.tabs) {
        if (!this.isCalendarTab(tab)) {
          if (this.calTabs.delete(tab)) {
            this.boundTabs.delete(tab);
            (tab.shadowRoot || tab).querySelector?.(".calpeek-badge")?.remove();
          }
          continue;
        }
        this.calTabs.add(tab);
        if (!this.boundTabs.has(tab)) {
          this.boundTabs.add(tab);
          tab.addEventListener("mouseenter", this.onHoverIn, false);
          tab.addEventListener("mouseleave", this.onHoverOut, false);
        }
      }
      for (const tab of this.calTabs) {
        if (!tab.isConnected) { this.calTabs.delete(tab); this.boundTabs.delete(tab); }
      }
    }

    // ---------- hover handling ----------

    onHoverIn(e) {
      const tab = asTab(e.target) || asTab(e.currentTarget);
      if (!tab || !this.isCalendarTab(tab)) return;
      if (this.hoverTab === tab) return;
      this.enterTab(tab);
    }

    onHoverOut(e) {
      const tab = asTab(e.target) || asTab(e.currentTarget);
      if (!tab || tab !== this.hoverTab) return;
      if (e.relatedTarget && tab.contains(e.relatedTarget)) return;
      this.leaveTab();
    }

    enterTab(tab) {
      this.hoverTab = tab;
      this.currentTab = tab;
      this.stripTooltip(tab);
      this.suppressTooltip = true;
      clearTimeout(this.hoverTimer);
      this.hoverTimer = setTimeout(() => {
        this.show(tab).catch(err => console.warn(TAG, "show failed:", err));
      }, iPref("hover_delay", 400));
    }

    leaveTab() {
      clearTimeout(this.hoverTimer);
      if (this.hoverTab) this.restoreTooltip(this.hoverTab);
      this.hoverTab = null;
      this.suppressTooltip = false;
      if (this.panel && this.panel.state !== "closed") this.scheduleHide();
    }

    stripTooltip(tab) {
      if (tab._cpTooltip === undefined) {
        tab._cpTooltip = {};
        for (const a of ["tooltip", "tooltiptext", "title", "data-tooltip"]) {
          if (tab.hasAttribute(a)) tab._cpTooltip[a] = tab.getAttribute(a);
        }
      }
      for (const a of Object.keys(tab._cpTooltip)) tab.removeAttribute(a);
    }

    restoreTooltip(tab) {
      if (!tab?._cpTooltip) return;
      for (const [a, v] of Object.entries(tab._cpTooltip)) tab.setAttribute(a, v);
      tab._cpTooltip = undefined;
    }

    onPopupShowing(e) {
      if (!this.suppressTooltip && !this.hoverTab) return;
      const t = e.target;
      if (t === this.panel || this.panel?.contains?.(t)) return;
      const id = `${t.localName || ""} ${t.id || ""} ${t.className || ""}`;
      const trigger = t.triggerNode || document.tooltipNode || null;
      const isOurs = trigger && (trigger === this.hoverTab || this.hoverTab?.contains(trigger));
      if (/tooltip/i.test(id) || isOurs) { e.preventDefault(); e.stopPropagation(); }
    }

    // ---------- feeds ----------

    feedConfig() {
      const feeds = parseFeedList(sPref("feeds", ""));
      const colors = sPref("colors", "").split(/[\s,]+/).filter(Boolean);
      feeds.forEach((f, i) => { f.color = colors[i] || ""; f.index = i; });
      return feeds;
    }

    async fetchOne(feed) {
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(feed.url, { credentials: "omit", cache: "no-cache", redirect: "follow" });
      } catch (e) {
        throw new Error("network");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const head = text.slice(0, 400);
      if (!/BEGIN:VCALENDAR/i.test(head)) {
        throw new Error(/<html|<!doctype/i.test(head) ? "not a calendar feed (got a web page)" : "not a calendar feed");
      }
      const cal = CalendarCore.parseICS(text);
      debug("feed parsed", { url: feed.url.slice(0, 60), events: cal.events.length, ms: Date.now() - t0 });
      let host = "";
      try { host = new URL(feed.url).hostname.replace(/^www\./, ""); } catch {}
      // The first feed takes Zen's accent colour; extra feeds get the palette.
      return {
        name: feed.label || cal.name || host,
        color: feed.color || cal.color || (feed.index ? PALETTE[feed.index % PALETTE.length] : ""),
        events: cal.events,
      };
    }

    // Fetch every configured feed (in parallel), keeping whatever succeeds.
    getFeeds(force = false) {
      const config = this.feedConfig();
      const key = JSON.stringify(config.map(f => f.url));
      const maxAge = Math.max(10, iPref("refresh_seconds", 60)) * 1000;
      if (this.cache.key === key && this.cache.feeds && !force && Date.now() - this.cache.t < maxAge) {
        return Promise.resolve(this.cache);
      }
      if (this.inflight) return this.inflight;
      this.inflight = (async () => {
        const results = await Promise.allSettled(config.map(f => this.fetchOne(f)));
        const feeds = [], errors = [];
        results.forEach((r, i) => {
          const url = config[i].url;
          if (r.status === "fulfilled") {
            r.value._url = url;
            feeds.push(r.value);
          } else {
            errors.push({ url, label: config[i].label, error: String(r.reason?.message || r.reason) });
            debug("feed failed", { url: url.slice(0, 60), error: String(r.reason?.message || r.reason) });
            // Keep the previous good copy of a feed that failed this time.
            const prev = this.cache.feeds?.find(f => f._url === url);
            if (prev) feeds.push(prev);
          }
        });
        const t = Date.now();
        this.cache = {
          t, key, feeds, errors,
          refreshedAt: feeds.length || !config.length ? t : this.cache.refreshedAt,
        };
        return this.cache;
      })().finally(() => { this.inflight = null; });
      return this.inflight;
    }

    // Always includes today's finished events; render() decides what to show.
    agenda(now = Date.now()) {
      const feeds = this.cache.feeds || [];
      return CalendarCore.buildAgenda(feeds, now, { days: iPref("days", 2), showPast: true });
    }

    // ---------- panel ----------

    ensurePanel() {
      if (this.panel) return;
      const panel = document.createXULElement
        ? document.createXULElement("panel")
        : document.createElementNS(XUL, "panel");
      panel.id = "calpeek-panel";
      panel.setAttribute("noautofocus", "true");
      panel.setAttribute("consumeoutsideclicks", "false");
      panel.setAttribute("level", "top");
      const box = el("div", "cp-box");
      panel.appendChild(box);
      (document.getElementById("mainPopupSet") || document.documentElement).appendChild(panel);
      panel.addEventListener("mouseenter", () => this.cancelHide());
      panel.addEventListener("mouseleave", () => this.scheduleHide());
      panel.addEventListener("popuphidden", () => this.onPanelHidden());
      box.addEventListener("click", this.onClick);
      this.panel = panel;
      this.box = box;
    }

    async show(tab) {
      this.ensurePanel();
      if (this.cache.feeds || !this.feedConfig().length) this.render(tab);
      else this.renderLoading();

      const r = tab.getBoundingClientRect();
      const sx = window.mozInnerScreenX ?? window.screenX;
      const sy = window.mozInnerScreenY ?? window.screenY;
      if (this.panel.state === "closed") this.openPanel(tab, sx + r.right + 6, sy + r.top);
      this.holdCompactSidebar();

      // Re-render once a minute while open so "in 4 min" stays honest.
      clearInterval(this.tickTimer);
      this.tickTimer = setInterval(() => {
        if (this.panel?.state === "open" && this.currentTab && !this.refreshing) this.render(this.currentTab);
      }, 30000);

      await this.refresh(tab);
    }

    // Wayland exposes no usable global screen coordinates, so on Linux the
    // panel anchors to the tab; other platforms keep the screen-positioned
    // open. Either way the other method is the fallback.
    openPanel(tab, x, y) {
      const anchorFirst = Services.appinfo?.OS === "Linux";
      const byAnchor = () => this.panel.openPopup(tab, "after_start", 4, 0, false, false);
      const byScreen = () => this.panel.openPopupAtScreen(x, y, false);
      try { (anchorFirst ? byAnchor : byScreen)(); }
      catch (err) {
        try { (anchorFirst ? byScreen : byAnchor)(); }
        catch (e2) { console.warn(TAG, "openPopup failed:", e2); }
      }
    }

    // ---------- compact-mode sidebar hold ----------
    // Compact mode auto-hides the sidebar the moment the pointer leaves it —
    // which would vanish this popup too. zen-user-show is the attribute Zen
    // toggles for "user pinned this open".
    compactSidebar() {
      try { if (document.documentElement.getAttribute("zen-compact-mode") !== "true") return null; }
      catch { return null; }
      return window.gZenCompactModeManager?.sidebar || document.getElementById("navigator-toolbox") || null;
    }
    holdCompactSidebar() {
      const sb = this.compactSidebar();
      if (!sb || this._compactHold === sb) return;
      this._compactHold = sb;
      this._weSetUserShow = !sb.hasAttribute("zen-user-show");
      if (this._weSetUserShow) sb.setAttribute("zen-user-show", "true");
    }
    releaseCompactSidebar() {
      const sb = this._compactHold;
      if (!sb) return;
      this._compactHold = null;
      if (!this._weSetUserShow) return;
      this._weSetUserShow = false;
      if (sb.matches(":hover")) {
        try { window.gZenCompactModeManager?._setElementExpandAttribute(sb, true); } catch {}
      }
      sb.removeAttribute("zen-user-show");
    }

    // ---------- rendering ----------

    setRefreshing(on) {
      this.refreshing = on;
      let status = this.box.querySelector(".cp-status");
      if (!status) {
        status = el("div", "cp-status");
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        this.box.appendChild(status);
      }
      clearInterval(this.dotsTimer);
      this.dotsTimer = null;
      const at = this.cache.refreshedAt;
      const stamp = at ? `Refreshed ${new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
      if (on) {
        this.refreshDots = 0;
        status.textContent = "Refreshing.";
        this.dotsTimer = setInterval(() => {
          const s = this.box?.querySelector(".cp-status");
          if (!s) return;
          this.refreshDots = (this.refreshDots % 3) + 1;
          s.textContent = "Refreshing" + ".".repeat(this.refreshDots);
        }, 300);
      } else {
        const failed = this.cache.errors?.length;
        status.textContent = failed && !this.cache.feeds?.length
          ? `Refresh failed${stamp ? " · " + stamp : ""}`
          : stamp;
      }
      this.box.querySelector(".cp-refresh")?.classList.toggle("cp-spin", on);
    }

    renderLoading() {
      this.box.replaceChildren(this.header(null), el("div", "cp-empty cp-today", "Loading your calendar…"));
      this.setRefreshing(this.refreshing);
    }

    header(agenda) {
      const now = Date.now();
      const header = el("div", "cp-header");
      const title = el("div", "cp-title", "Today");
      title.appendChild(el("span", "cp-title-date", fmtDayLabel(now)));
      header.appendChild(title);
      const right = el("div", "cp-header-right");
      if (agenda) {
        const n = agenda.remainingToday;
        const today = agenda.days[0]?.items.length || 0;
        right.appendChild(el("span", null,
          n > 1 ? `${n} left today` : n === 1 ? "1 left today" : today ? "all done" : "free day"));
      }
      const btn = el("div", "cp-iconbtn cp-refresh");
      btn.setAttribute("data-refresh", "1");
      btn.setAttribute("role", "button");
      btn.setAttribute("aria-label", "Refresh");
      btn.appendChild(makeIcon(["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"], 13, 2));
      right.appendChild(btn);
      header.appendChild(right);
      return header;
    }

    addButton() {
      const btn = el("div", "cp-add");
      btn.setAttribute("data-add", "1");
      btn.setAttribute("role", "button");
      btn.setAttribute("aria-label", "New event");
      btn.appendChild(makeIcon(["M12 5v14", "M5 12h14"], 13, 2));
      return btn;
    }

    row(it, now, isToday) {
      const row = el("div", "cp-row");
      row.setAttribute("data-row", "1");
      row._item = it;
      if (it.color) row.style.setProperty("--cp-color", it.color);
      const live = it.start <= now && it.end > now;
      if (live && !it.allDay) row.classList.add("cp-live");
      if (!it.allDay && it.end <= now) row.classList.add("cp-past");
      if (it.transparent) row.classList.add("cp-free");

      const time = el("div", "cp-time");
      if (it.allDay) {
        time.appendChild(el("span", "cp-allday", "All day"));
      } else if (it.continues) {
        time.appendChild(el("span", "cp-start", "…"));
        time.appendChild(el("span", "cp-end", it.continuesAfter ? "→" : fmtTimeShort(it.end)));
      } else {
        time.appendChild(el("span", "cp-start", fmtTimeShort(it.start)));
        if (it.end > it.start) time.appendChild(el("span", "cp-end", it.continuesAfter ? "→" : fmtTimeShort(it.end)));
      }
      row.appendChild(time);
      row.appendChild(el("div", "cp-bar"));

      const main = el("div", "cp-main");
      main.appendChild(el("div", "cp-summary", it.summary));
      const metaBits = [];
      if (it.location && !(it.join && it.location.includes(it.join))) metaBits.push(it.location.split("\n")[0]);
      else if (it.join) metaBits.push(/meet\.google/i.test(it.join) ? "Google Meet" : /zoom/i.test(it.join) ? "Zoom" : /teams/i.test(it.join) ? "Teams" : "Video call");
      if (it.calendar && this.multiFeed()) metaBits.push(it.calendar);
      if (metaBits.length) main.appendChild(el("div", "cp-meta", metaBits.join(" · ")));
      row.appendChild(main);

      const side = el("div", "cp-side");
      let sideUsed = false;
      if (isToday && !it.allDay) {
        const rel = relative(it, now);
        if (rel) {
          side.appendChild(el("span", `cp-chip cp-${rel.kind}`, rel.text));
          sideUsed = true;
        }
      }
      if (it.join && (!isToday || it.end > now)) {
        const startsSoon = isToday && !it.allDay && it.end > now &&
          it.start - now <= iPref("join_window", 10) * 60000;
        const join = el("span", "cp-join" + (startsSoon ? " cp-hot" : ""), "Join");
        join.setAttribute("data-join", it.join);
        join.setAttribute("title", it.join);
        side.appendChild(join);
        sideUsed = true;
      }
      if (sideUsed) row.appendChild(side);
      return row;
    }

    multiFeed() {
      return (this.cache.feeds?.length || 0) > 1;
    }

    // A slim strip showing the shape of the day — blocks for each timed
    // event, a marker for right now — so you can see where you are at a glance.
    timeline(timed, now) {
      if (!timed.length) return null;
      const H = 3600000;
      const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      const dayStart = d0.getTime();
      const hourOf = t => (t - dayStart) / H;
      let startH = Math.min(7, Math.floor(hourOf(Math.min(...timed.map(it => it.start)))), Math.floor(hourOf(now)));
      let endH = Math.max(21, Math.ceil(hourOf(Math.max(...timed.map(it => it.end)))), Math.ceil(hourOf(now) + 0.5));
      startH = Math.max(0, startH);
      endH = Math.min(24, Math.max(endH, startH + 2));
      const t0 = dayStart + startH * H, t1 = dayStart + endH * H, span = t1 - t0;
      const pct = t => Math.max(0, Math.min(100, ((t - t0) / span) * 100));

      const wrap = el("div", "cp-timeline");
      wrap.appendChild(el("div", "cp-track"));
      for (const it of timed) {
        const b = el("div", "cp-block");
        const a = pct(it.start), z = pct(it.end);
        b.style.left = `${a}%`;
        b.style.width = `${Math.max(z - a, 0.8)}%`;
        if (it.color) b.style.setProperty("--cp-color", it.color);
        if (it.end <= now) b.classList.add("cp-past");
        else if (it.start <= now) b.classList.add("cp-live");
        b.setAttribute("title", `${it.summary} · ${fmtTimeShort(it.start)}–${fmtTimeShort(it.end)}`);
        wrap.appendChild(b);
      }
      const p = pct(now);
      const mark = el("div", "cp-nowmark");
      mark.style.left = `${p}%`;
      wrap.appendChild(mark);
      const label = el("div", "cp-nowlabel", fmtTimeShort(now));
      label.style.left = `${p}%`;
      if (p < 9) label.classList.add("cp-edge-l");
      else if (p > 91) label.classList.add("cp-edge-r");
      wrap.appendChild(label);
      wrap.appendChild(el("div", "cp-hour cp-l", fmtTimeShort(t0)));
      wrap.appendChild(el("div", "cp-hour cp-r", endH === 24 ? "12am" : fmtTimeShort(t1)));
      return wrap;
    }

    nowLine(now) {
      const line = el("div", "cp-nowline");
      line.appendChild(el("span", "cp-nowtime", fmtTimeShort(now)));
      line.appendChild(el("span", "cp-nowrule"));
      return line;
    }

    render(tab) {
      const box = this.box;
      const now = Date.now();
      const config = this.feedConfig();
      box.replaceChildren();

      if (!config.length) {
        box.appendChild(this.header(null));
        const setup = el("div", "cp-setup");
        setup.appendChild(el("strong", null, "Connect a calendar"));
        setup.appendChild(document.createTextNode("Calendar Peek reads the private iCal feed your calendar already offers — no sign-in, no API key."));
        const ol = el("ol");
        const li1 = el("li");
        li1.appendChild(document.createTextNode("Google Calendar → Settings → your calendar → "));
        li1.appendChild(el("em", null, "Secret address in iCal format"));
        ol.appendChild(li1);
        const li2 = el("li");
        li2.appendChild(document.createTextNode("Paste it into Sine → Calendar Peek → "));
        li2.appendChild(el("code", null, "feeds"));
        ol.appendChild(li2);
        ol.appendChild(el("li", null, "Hover this tab again."));
        setup.appendChild(ol);
        const btn = el("span", "cp-button", "Open calendar settings");
        btn.setAttribute("data-settings", "1");
        setup.appendChild(btn);
        box.appendChild(setup);
        box.appendChild(this.addButton());
        this.setRefreshing(this.refreshing);
        return;
      }

      if (!this.cache.feeds) {
        box.appendChild(this.header(null));
        box.appendChild(el("div", "cp-empty cp-today", "Loading your calendar…"));
        box.appendChild(this.addButton());
        this.setRefreshing(this.refreshing);
        return;
      }
      if (!this.cache.feeds.length) {
        box.appendChild(this.header(null));
        const e = this.cache.errors?.[0];
        const empty = el("div", "cp-empty cp-today");
        empty.appendChild(el("span", "cp-big", "Couldn't load your calendar"));
        empty.appendChild(document.createTextNode(
          e?.error === "network" ? "Check your connection and try again."
          : e ? `${e.error} — double-check the feed URL in settings.` : "Try refreshing."));
        box.appendChild(empty);
        box.appendChild(this.addButton());
        this.setRefreshing(this.refreshing);
        return;
      }

      const agenda = this.agenda(now);
      box.appendChild(this.header(agenda));

      const max = Math.max(1, iPref("max_items", 8));
      const PAST_KEEP = 2;
      let shown = 0, hidden = 0;
      const add = (it, isToday) => {
        if (shown >= max) { hidden++; return; }
        box.appendChild(this.row(it, now, isToday));
        shown++;
      };

      // ---- today: all-day → timeline → recent past (dimmed) → now → upcoming
      const today = agenda.days[0];
      const allDay = today.items.filter(it => it.allDay);
      const timed = today.items.filter(it => !it.allDay);
      const past = timed.filter(it => it.end <= now);
      const ahead = timed.filter(it => it.end > now);

      if (!timed.length && !allDay.length) {
        const empty = el("div", "cp-empty cp-today");
        empty.appendChild(el("span", "cp-big", "Nothing on today"));
        empty.appendChild(document.createTextNode("Enjoy the open time."));
        box.appendChild(empty);
      } else {
        const strip = this.timeline(timed, now);
        if (strip) box.appendChild(strip);
        for (const it of allDay) add(it, true);
        if (bPref("show_past", true) && past.length) {
          let visible = past;
          if (!this.expandPast && past.length > PAST_KEEP) {
            visible = past.slice(-PAST_KEEP);
            const more = el("div", "cp-more cp-earlier", `${past.length - PAST_KEEP} earlier…`);
            more.setAttribute("data-earlier", "1");
            box.appendChild(more);
          }
          for (const it of visible) add(it, true);
        }
        if (timed.length) box.appendChild(this.nowLine(now));
        for (const it of ahead) add(it, true);
        if (timed.length && !ahead.length) box.appendChild(el("div", "cp-done", "That's it for today."));
      }

      // ---- later days
      agenda.days.slice(1).forEach((day, j) => {
        const i = j + 1;
        if (!day.items.length && i > 1) return; // only "Tomorrow" earns an empty row
        const head = el("div", "cp-dayhead");
        head.appendChild(el("span", null, i === 1 ? "Tomorrow" : fmtWeekdayLong(day.dayStart)));
        head.appendChild(el("span", null, fmtMonthDay(day.dayStart)));
        box.appendChild(head);
        if (!day.items.length) { box.appendChild(el("div", "cp-empty", "Nothing scheduled")); return; }
        for (const it of day.items) add(it, false);
      });
      if (hidden) box.appendChild(el("div", "cp-more", `+${hidden} more`));

      if (this.cache.errors?.length) {
        const e = this.cache.errors[0];
        const label = e.label || (() => { try { return new URL(e.url).hostname; } catch { return "feed"; } })();
        box.appendChild(el("div", "cp-error",
          this.cache.errors.length > 1
            ? `${this.cache.errors.length} feeds couldn't be loaded (${e.error})`
            : `${label}: ${e.error}`));
      }
      box.appendChild(this.addButton());
      this.setRefreshing(this.refreshing);
    }

    async refresh(tab) {
      if (!tab) return;
      const sequence = ++this.refreshSequence;
      this.setRefreshing(true);
      try {
        await this.getFeeds(false);
        if (sequence !== this.refreshSequence || this.currentTab !== tab || this.panel.state === "closed") return;
        this.paintBadges();
        this.render(tab);
      } finally {
        if (sequence === this.refreshSequence && this.currentTab === tab && this.panel.state !== "closed") {
          this.setRefreshing(false);
        }
      }
    }

    // ---------- interactions ----------

    onClick(e) {
      const tab = this.currentTab;
      if (!tab) return;
      const provider = this.providerFor(tab) || { id: "other", url: "", account: "0" };
      const t = e.target;
      if (t.closest("[data-refresh]")) {
        this.setRefreshing(true);
        this.getFeeds(true)
          .then(() => {
            if (this.panel?.state === "open" && this.currentTab === tab) { this.paintBadges(); this.render(tab); }
          })
          .finally(() => { if (this.panel?.state === "open") this.setRefreshing(false); });
        return;
      }
      if (t.closest("[data-earlier]")) { this.expandPast = true; this.render(tab); return; }
      const join = t.closest("[data-join]");
      if (join) { e.stopPropagation(); this.openNewTab(join.getAttribute("data-join")); this.hideNow(); return; }
      if (t.closest("[data-add]")) {
        if (provider.newEvent) this.navigate(tab, provider.newEvent(provider));
        else this.focusTab(tab);
        this.hideNow();
        return;
      }
      if (t.closest("[data-settings]")) {
        if (provider.settings) this.navigate(tab, provider.settings(provider));
        else this.focusTab(tab);
        this.hideNow();
        return;
      }
      const row = t.closest("[data-row]");
      if (row && row._item) {
        const it = row._item;
        if (it.url && /^https?:\/\//i.test(it.url) && it.url !== it.join) this.navigate(tab, it.url);
        else if (provider.openDay) {
          const d = new Date(it.start);
          this.navigate(tab, provider.openDay(provider, d.getFullYear(), d.getMonth() + 1, d.getDate()));
        } else this.focusTab(tab);
        this.hideNow();
      }
    }

    focusTab(tab) {
      try { gBrowser.selectedTab = tab; } catch {}
    }

    navigate(tab, url) {
      debug("navigate", url.slice(0, 120));
      try {
        gBrowser.selectedTab = tab;
        tab.linkedBrowser.loadURI(Services.io.newURI(url), {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
      } catch (ex) {
        try {
          tab.linkedBrowser.loadURI(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        } catch {
          try { openWebLinkIn(url, "tab"); } catch {}
        }
      }
    }

    openNewTab(url) {
      try { openWebLinkIn(url, "tab"); return; } catch {}
      try {
        const t = gBrowser.addTab(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
        gBrowser.selectedTab = t;
      } catch (e) { console.warn(TAG, "open failed", e); }
    }

    // ---------- badge ----------

    async refreshBadge(force = false) {
      this.scanTabs();
      if (!this.feedConfig().length) return;
      // Refetch at most every 5 minutes from the badge timer; otherwise just
      // repaint from cache so the count drops as events end.
      if (force || Date.now() - this.cache.t > 5 * 60000) {
        try { await this.getFeeds(true); } catch {}
      }
      this.paintBadges();
    }

    paintBadges() {
      const show = bPref("show_badge", true);
      let count = 0;
      if (show && this.cache.feeds) { try { count = this.agenda().remainingToday; } catch {} }
      for (const tab of this.calTabs) this.paintBadge(tab, show ? count : 0);
    }

    paintBadge(tab, count) {
      if (!this.isCalendarTab(tab)) {
        (tab.shadowRoot || tab).querySelector?.(".calpeek-badge")?.remove();
        this.calTabs.delete(tab);
        this.boundTabs.delete(tab);
        return;
      }
      const host =
        tab.shadowRoot?.querySelector(".tab-icon-stack") ||
        tab.shadowRoot?.querySelector(".tab-content") ||
        tab.querySelector(".tab-icon-stack") ||
        tab.querySelector(".tab-content");
      if (!host) return;
      let badge = host.querySelector(".calpeek-badge");
      if (count > 0) {
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        if (!badge) {
          badge = el("span", "calpeek-badge");
          badge.style.cssText = BADGE_STYLE;
          host.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
      } else {
        badge?.remove();
      }
    }

    // ---------- show/hide timers ----------

    scheduleHide() {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => this.hideNow(), iPref("hide_delay", 150));
    }
    cancelHide() { clearTimeout(this.hideTimer); }
    hideNow() {
      clearTimeout(this.hideTimer);
      if (this.panel && this.panel.state !== "closed") this.panel.hidePopup();
      else this.onPanelHidden();
    }
    onPanelHidden() {
      this.refreshSequence++;
      this.refreshing = false;
      clearInterval(this.dotsTimer);
      this.dotsTimer = null;
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      this.releaseCompactSidebar();
      this.expandPast = false;
      if (this.hoverTab) this.restoreTooltip(this.hoverTab);
      this.hoverTab = null;
      this.currentTab = null;
      this.suppressTooltip = false;
    }
  }

  const boot = () => {
    try {
      if (!window.gBrowser) { setTimeout(boot, 500); return; }
      window.calendarPeek = new CalendarPeek();
      window.calendarPeek.init();
    } catch (err) {
      console.error(TAG, "boot failed:", err);
    }
  };

  if (document.readyState === "complete") boot();
  else {
    window.addEventListener("load", boot, { once: true });
    setTimeout(() => { if (!window.calendarPeek) boot(); }, 1500);
  }
})();
