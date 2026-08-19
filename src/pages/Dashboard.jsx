import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, doc, onSnapshot, query, where, Timestamp, getDocs, getDoc, updateDoc } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import DashboardLock from "./DashboardLock";

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// start week is Monday
function startOfWeek(date = new Date()) {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 Sun, 1 Mon, ...
  const diff = (day === 0 ? -6 : 1) - day; // move back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function endOfWeekExclusive(weekStartDate) {
  return addDays(weekStartDate, 7);
}

function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmtWeekRange(weekStartDate) {
  const end = addDays(weekStartDate, 4); // Mon..Fri display
  return `${weekStartDate.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function msToNice(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function minutesToNice(mins) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `${h}h ${rem}m`;
  return `${rem}m`;
}

// ---- export helpers ----
function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtTime(d) {
  // 00:00pm style
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${pad2(h)}:${pad2(m)}${ampm}`;
}

function hourLabelShort(minuteOfDay) {
  const h24 = Math.floor(minuteOfDay / 60);
  const ampm = h24 >= 12 ? "pm" : "am";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${ampm}`;
}

function minuteOfDayToDate(baseDate, minuteOfDay) {
  const d = new Date(baseDate);
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return d;
}

function minutesToNiceLong(mins) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${pad2(rem)}m`;
}
// ------------------------

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function autoCloseAtMidnight() {
  const midnight = startOfToday();
  const midnightTs = Timestamp.fromDate(midnight);

  const activeLeadersSnap = await getDocs(
    query(collection(db, "leaders"), where("isActive", "==", true))
  );

  for (const leaderDoc of activeLeadersSnap.docs) {
    const leaderId = leaderDoc.id;
    const leader = leaderDoc.data();
    if (!leader.currentSessionId) continue;

    const sessionRef = doc(db, "sessions", leader.currentSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) continue;

    const session = sessionSnap.data();
    const ci = session.checkInTime?.toDate?.();
    if (!ci) continue;

    if (session.checkOutTime) continue;
    if (ci >= midnight) continue;

    const mins = Math.max(0, Math.round((midnight.getTime() - ci.getTime()) / 60000));

    await updateDoc(sessionRef, {
      checkOutTime: midnightTs,
      durationMinutes: mins,
      autoClosed: true,
      excludeFromTotals: true,
    });

    await updateDoc(doc(db, "leaders", leaderId), {
      isActive: false,
      currentSessionId: null,
    });
  }
}

export default function Dashboard() {
  const [leaders, setLeaders] = useState([]); // all leaders
  const [activeSessions, setActiveSessions] = useState({}); // leaderId -> { checkInTime }
  const [sessionsThisWeek, setSessionsThisWeek] = useState([]); // list of sessions for displayed week
  const [now, setNow] = useState(Date.now());
  const [unlocked, setUnlocked] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState("");

  const [weekOffset, setWeekOffset] = useState(0);
  const [officeHours, setOfficeHours] = useState([]);

  const activeSessionUnsubsRef = useRef({});

  // horizontal scroll refs (top + main, synced)
  const topHScrollRef = useRef(null);
  const mainHScrollRef = useRef(null);
  const syncingHScrollRef = useRef(false);

  function syncHScroll(from, left) {
    if (syncingHScrollRef.current) return;
    syncingHScrollRef.current = true;

    if (from !== "top" && topHScrollRef.current) topHScrollRef.current.scrollLeft = left;
    if (from !== "main" && mainHScrollRef.current) mainHScrollRef.current.scrollLeft = left;

    requestAnimationFrame(() => {
      syncingHScrollRef.current = false;
    });
  }

  const displayedWeekStart = useMemo(() => {
    const base = startOfWeek(new Date());
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  async function handleSignIn(e) {
    e.preventDefault();
    setAuthErr("");

    try {
      const auth = getAuth();
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      setAuthErr(err?.message || "login failed");
    }
  }

  useEffect(() => {
    if (localStorage.getItem("dashboardUnlocked") === "1") setUnlocked(true);
  }, []);

  useEffect(() => {
  if (!user) return;
  if (!unlocked) return;

  let t = null;
  let interval = null;

  const schedule = () => {
    const nowD = new Date();
    const next = new Date(nowD);
    next.setHours(24, 0, 0, 0); // next midnight
    const ms = next.getTime() - nowD.getTime();

    t = setTimeout(async () => {
      await autoCloseAtMidnight().catch(console.error);
      schedule(); // schedule the following midnight
    }, ms);
  };

  // run once on load + schedule midnight
  autoCloseAtMidnight().catch(console.error);
  schedule();

  // optional safety: also run every 5 min in case the tab was asleep
  interval = setInterval(() => {
    autoCloseAtMidnight().catch(console.error);
  }, 5 * 60 * 1000);

  return () => {
    if (t) clearTimeout(t);
    if (interval) clearInterval(interval);
  };
}, [user, unlocked]);

  // Tick every second so "in office" durations update live
  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [user, unlocked]);

  // 1) Listen to ALL leaders (for both sections)
  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;

    const unsub = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort(
        (a, b) =>
          (a.order ?? 9999) - (b.order ?? 9999) ||
          (a.role || "").localeCompare(b.role || "")
      );
      setLeaders(rows);
    });

    return () => unsub();
  }, [user, unlocked]);

  // 2) For leaders who are active, listen to their current session doc (for checkInTime)
  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;

    const active = leaders.filter((l) => l.isActive && l.currentSessionId);

    const keep = new Set(active.map((l) => l.id));
    for (const leaderId of Object.keys(activeSessionUnsubsRef.current)) {
      if (!keep.has(leaderId)) {
        activeSessionUnsubsRef.current[leaderId]?.();
        delete activeSessionUnsubsRef.current[leaderId];
        setActiveSessions((prev) => {
          const copy = { ...prev };
          delete copy[leaderId];
          return copy;
        });
      }
    }

    for (const l of active) {
      if (activeSessionUnsubsRef.current[l.id]) continue;

      const sessionRef = doc(db, "sessions", l.currentSessionId);
      const unsub = onSnapshot(sessionRef, (snap) => {
        if (!snap.exists()) return;

        const data = snap.data();
        setActiveSessions((prev) => ({
          ...prev,
          [l.id]: {
            sessionId: snap.id,
            checkInTime: data.checkInTime || null,
          },
        }));
      });

      activeSessionUnsubsRef.current[l.id] = unsub;
    }

    return () => {
      for (const leaderId of Object.keys(activeSessionUnsubsRef.current)) {
        activeSessionUnsubsRef.current[leaderId]?.();
      }
      activeSessionUnsubsRef.current = {};
    };
  }, [leaders, user, unlocked]);

  // 2.5) Listen to officeHours (schedule blocks)
  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;

    const unsub = onSnapshot(collection(db, "officeHours"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setOfficeHours(rows);
    });

    return () => unsub();
  }, [user, unlocked]);

  // 3) Listen to sessions for the displayed week (for totals + grid)
  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;

    const weekStart = Timestamp.fromDate(displayedWeekStart);
    const weekEnd = Timestamp.fromDate(endOfWeekExclusive(displayedWeekStart));

    const q = query(
      collection(db, "sessions"),
      where("checkInTime", ">=", weekStart),
      where("checkInTime", "<", weekEnd)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSessionsThisWeek(rows);
    });

    return () => unsub();
  }, [user, unlocked, displayedWeekStart]);

  const activeLeaders = leaders.filter((l) => l.isActive);

  // Totals per leader (week + today). Week is the displayed week. Today is real today (counts only if session start is today).
  const rowTotals = useMemo(() => {
    const todayStartMs = startOfDay(new Date()).getTime();
    const map = {};

    for (const s of sessionsThisWeek) {
      if (s.excludeFromTotals) continue;
      if (!s.leaderId) continue;

      const ci = s.checkInTime?.toDate?.();
      if (!ci) continue;

      let durMin = 0;
      if (typeof s.durationMinutes === "number") durMin = s.durationMinutes;
      else if (s.checkOutTime) {
        const co = s.checkOutTime.toDate();
        durMin = Math.max(0, (co.getTime() - ci.getTime()) / 60000);
      } else {
  // no checkout: only count live time if it started today
  if (ci.getTime() >= todayStartMs) {
    durMin = Math.max(0, (now - ci.getTime()) / 60000);
  } else {
    durMin = 0;
  }
}

      if (!map[s.leaderId]) map[s.leaderId] = { weekMinutes: 0, todayMinutes: 0 };
      map[s.leaderId].weekMinutes += durMin;
      if (ci.getTime() >= todayStartMs) map[s.leaderId].todayMinutes += durMin;
    }

    return map;
  }, [sessionsThisWeek, now]);

  // Grid config (horizontal timeline)
  const GRID_START_MIN = 8 * 60;
  const GRID_END_MIN = 20 * 60;
  const DAY_SPAN_MIN = GRID_END_MIN - GRID_START_MIN; // 720
  const PX_PER_MIN = 1.2; // tweak zoom
  const ROW_H = 44;
  const HEADER_H = 60;
  const LEFT_W = 260;
  const WEEK_W = DAY_SPAN_MIN * PX_PER_MIN * 5;
  const TIME_MARKS_MIN = Array.from(
    { length: DAY_SPAN_MIN / 120 + 1 },
    (_, i) => GRID_START_MIN + i * 120
  ); // every 2 hours

  const officeHoursByLeader = useMemo(() => {
    const map = {};
    for (const b of officeHours) {
      const leaderId = b.leaderId;
      if (!leaderId) continue;
      if (!map[leaderId]) map[leaderId] = [];
      map[leaderId].push(b);
    }
    return map;
  }, [officeHours]);

  const sessionsByLeader = useMemo(() => {
    const map = {};
    for (const s of sessionsThisWeek) {
      const leaderId = s.leaderId;
      if (!leaderId) continue;

      const ci = s.checkInTime?.toDate?.();
      if (!ci) continue;

      const co = s.checkOutTime?.toDate?.() || null;

      if (!map[leaderId]) map[leaderId] = [];
      map[leaderId].push({ id: s.id, start: ci, end: co });
    }
    return map;
  }, [sessionsThisWeek]);

  function minuteToX(dayIdx0to4, minuteOfDay) {
    const within = clamp(minuteOfDay, GRID_START_MIN, GRID_END_MIN) - GRID_START_MIN;
    const offsetDay = dayIdx0to4 * DAY_SPAN_MIN;
    return (offsetDay + within) * PX_PER_MIN;
  }

  function blockForSchedule(dayOfWeek1to5, startMinute, endMinute) {
    const dayIdx = dayOfWeek1to5 - 1;
    const left = minuteToX(dayIdx, startMinute);
    const right = minuteToX(dayIdx, endMinute);
    return { left, width: Math.max(2, right - left) };
  }

  function sessionSegments(sessionStart, sessionEndOrNull) {
    const end = sessionEndOrNull || new Date(now);
    const segs = [];

    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const dayDate = addDays(displayedWeekStart, dayIdx);

      const dayStart = new Date(dayDate);
      dayStart.setHours(8, 0, 0, 0);

      const dayEnd = new Date(dayDate);
      dayEnd.setHours(20, 0, 0, 0);

      const segStart = new Date(Math.max(sessionStart.getTime(), dayStart.getTime()));
      const segEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
      if (segEnd.getTime() <= segStart.getTime()) continue;

      const left = minuteToX(dayIdx, minutesSinceMidnight(segStart));
      const right = minuteToX(dayIdx, minutesSinceMidnight(segEnd));

      segs.push({
        left,
        width: Math.max(2, right - left),
        key: `${sessionStart.getTime()}-${segStart.getTime()}-${segEnd.getTime()}-${dayIdx}`,
      });
    }

    return segs;
  }

  function scheduledNiceForLeader(leaderId) {
    const blocks = (officeHoursByLeader[leaderId] || [])
      .filter((b) => Number(b.dayOfWeek) >= 1 && Number(b.dayOfWeek) <= 5)
      .slice()
      .sort(
        (a, b) =>
          Number(a.dayOfWeek) - Number(b.dayOfWeek) ||
          Number(a.startMinute) - Number(b.startMinute)
      );

    if (blocks.length === 0) return "None";

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const toHM = (mins) => {
      const h24 = Math.floor(mins / 60);
      const m = mins % 60;
      const d = new Date();
      d.setHours(h24, m, 0, 0);
      return fmtTime(d);
    };

    return blocks
      .map((b) => {
        const dayIdx = Number(b.dayOfWeek) - 1;
        return `${dayNames[dayIdx]} ${toHM(Number(b.startMinute))}-${toHM(
          Number(b.endMinute)
        )}`;
      })
      .join(", ");
  }

  function actualTimesByDayForLeader(leaderId) {
    const leaderSessions = sessionsByLeader[leaderId] || [];

    const days = [];
    for (let dayIdx = 0; dayIdx < 5; dayIdx++) {
      const dayDate = addDays(displayedWeekStart, dayIdx);
      const dayStart = new Date(dayDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayDate);
      dayEnd.setHours(23, 59, 59, 999);

      const entries = [];

      for (const s of leaderSessions) {
        const start = s.start;
        const end = s.end || new Date(now);

        if (end.getTime() < dayStart.getTime() || start.getTime() > dayEnd.getTime()) continue;

        const segStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
        const segEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
        if (segEnd.getTime() <= segStart.getTime()) continue;

        entries.push(`${fmtTime(segStart)}-${fmtTime(segEnd)}`);
      }

      const uniq = Array.from(new Set(entries)).sort();
      days.push({ dayDate, entries: uniq });
    }

    return days;
  }

  function scheduledBlocksForLeader(leaderId) {
    return (officeHoursByLeader[leaderId] || []).filter(
      (b) => Number(b.dayOfWeek) >= 1 && Number(b.dayOfWeek) <= 5
    );
  }

  function expectedMinutesForLeader(leaderId) {
    return scheduledBlocksForLeader(leaderId).reduce(
      (sum, b) => sum + Math.max(0, Number(b.endMinute) - Number(b.startMinute)),
      0
    );
  }

  // null = no schedule set (N/A). Otherwise: total logged minutes >= total expected minutes.
  function isHoursMetForLeader(leaderId) {
    const blocks = scheduledBlocksForLeader(leaderId);
    if (blocks.length === 0) return null;

    const totals = rowTotals[leaderId] || { weekMinutes: 0 };
    return totals.weekMinutes >= expectedMinutesForLeader(leaderId);
  }

  // null = no schedule set (N/A). Otherwise: false only if a scheduled block has
  // zero overlapping sessions — extra time outside a block doesn't count against it.
  function isOnScheduleForLeader(leaderId) {
    const blocks = scheduledBlocksForLeader(leaderId);
    if (blocks.length === 0) return null;

    const leaderSessions = sessionsByLeader[leaderId] || [];

    return blocks.every((b) => {
      const dayIdx = Number(b.dayOfWeek) - 1;
      const dayDate = addDays(displayedWeekStart, dayIdx);
      const blockStart = minuteOfDayToDate(dayDate, Number(b.startMinute));
      const blockEnd = minuteOfDayToDate(dayDate, Number(b.endMinute));

      return leaderSessions.some((s) => {
        const sStart = s.start;
        const sEnd = s.end || new Date(now);
        return sStart.getTime() < blockEnd.getTime() && sEnd.getTime() > blockStart.getTime();
      });
    });
  }

  async function exportWeeklyOfficeHoursPdf() {
    const { buildWeeklyReportPdf } = await import("../lib/weeklyReportPdf");

    const weekLabel = fmtWeekRange(displayedWeekStart);
    const filename = `office-hours-${weekLabel.replaceAll("/", "-").replaceAll(" ", "")}.pdf`;
    const generatedAt = `Generated ${new Date().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];

    const pdfLeaders = leaders.map((l) => {
      const blocks = scheduledBlocksForLeader(l.id);
      const totals = rowTotals[l.id] || { weekMinutes: 0 };
      const days = actualTimesByDayForLeader(l.id);

      return {
        role: l.role || l.id,
        subtitle:
          blocks.length === 0
            ? "No office hours scheduled"
            : `Expected ${scheduledNiceForLeader(l.id)} · ${minutesToNiceLong(
                expectedMinutesForLeader(l.id)
              )}/week`,
        hoursMet: isHoursMetForLeader(l.id),
        onSchedule: isOnScheduleForLeader(l.id),
        totalLabel: minutesToNiceLong(totals.weekMinutes),
        sessions: days.flatMap((d, dayIdx) =>
          d.entries.map((time) => ({ day: dayNames[dayIdx], time }))
        ),
      };
    });

    const doc = buildWeeklyReportPdf({
      weekLabel,
      generatedAt,
      leaders: pdfLeaders,
      filename,
    });

    doc.save(filename);
  }

  if (!authReady) return null;

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 360, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>admin sign in</div>

          <form onSubmit={handleSignIn}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              autoComplete="username"
              style={{
                width: "94%",
                padding: 10,
                fontSize: 16,
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="password"
              autoComplete="current-password"
              style={{
                width: "94%",
                padding: 10,
                fontSize: 16,
                borderRadius: 10,
                border: "1px solid #ddd",
                marginTop: 10,
              }}
            />
            <button
              type="submit"
              style={{
                width: "100%",
                marginTop: 10,
                padding: 10,
                fontSize: 16,
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              sign in
            </button>
          </form>

          {!!authErr && <div style={{ marginTop: 10, opacity: 0.85 }}>{authErr}</div>}
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return <DashboardLock onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>

      <button
        onClick={() => {
          localStorage.removeItem("dashboardUnlocked");
          setUnlocked(false);
        }}
        style={{
          marginBottom: 16,
          padding: "6px 12px",
          fontSize: 14,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        lock dashboard
      </button>

      {/* section 1 who is currently in the office */}
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>In Office Right Now</h2>

        {activeLeaders.length === 0 ? (
          <p>No one is currently in the office.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {activeLeaders.map((l) => {
              const checkInTs = activeSessions[l.id]?.checkInTime;
              const checkInDate = checkInTs?.toDate?.() || null;
              const durMs = checkInDate ? now - checkInDate.getTime() : 0;

              return (
                <li key={l.id} style={{ marginBottom: 10, fontSize: 16 }}>
                  <b>{l.role || l.id}</b>{" "}
                  {checkInDate ? (
                    <span>· {msToNice(durMs)}</span>
                  ) : (
                    <span>· (loading check-in time…)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* section 2 schedule vs actual (horizontal time) */}
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Schedule vs Actual</h2>
            <div style={{ opacity: 0.8, marginTop: 4 }}>Week: {fmtWeekRange(displayedWeekStart)}</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              ← prev
            </button>
            <button
              onClick={() => setWeekOffset(0)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              today
            </button>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              next →
            </button>

            <button
              onClick={exportWeeklyOfficeHoursPdf}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              export week (.pdf)
            </button>
          </div>
        </div>

        {/* outer wrapper must NOT be overflow hidden or sticky breaks */}
        <div
          style={{
            marginTop: 14,
            border: "1px solid #eee",
            borderRadius: 12,
            overflow: "visible",
            background: "transparent",
          }}
        >
          {/* inner wrapper keeps rounded corners */}
          <div
            style={{
              borderRadius: 12,
              overflow: "hidden",
              background: "white",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: `${LEFT_W}px minmax(0, 1fr)` }}>
              {/* LEFT PANE (frozen) */}
              <div style={{ borderRight: "1px solid #eee", boxSizing: "border-box" }}>
                <div style={{ height: 14, borderBottom: "1px solid #eee", background: "white" }} />
                <div
                  style={{
                    height: HEADER_H,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 10px",
                    fontWeight: 800,
                    borderBottom: "1px solid #eee",
                    boxSizing: "border-box",
                    position: "sticky",
                    top: 14,
                    zIndex: 20,
                    background: "white",
                  }}
                >
                  Leader
                </div>

                {leaders.map((l) => {
                  const totals = rowTotals[l.id] || { todayMinutes: 0, weekMinutes: 0 };

                  return (
                    <div
                      key={l.id}
                      style={{
                        height: ROW_H,
                        borderBottom: "1px solid #f3f3f3",
                        padding: "0 10px",
                        display: "flex",
                        alignItems: "center",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {l.role || l.id}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: "nowrap" }}>
                          Today: {minutesToNice(totals.todayMinutes)} · Week:{" "}
                          {minutesToNice(totals.weekMinutes)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RIGHT PANE (top+main+bottom horizontal scroll, synced) */}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                {/* TOP horizontal scrollbar */}
                <div
                  ref={topHScrollRef}
                  onScroll={(e) => syncHScroll("top", e.currentTarget.scrollLeft)}
                  style={{
                    overflowX: "auto",
                    overflowY: "hidden",
                    height: 14,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <div style={{ width: WEEK_W, height: 1 }} />
                </div>

                {/* MAIN timeline scroller */}
                <div
                  ref={mainHScrollRef}
                  onScroll={(e) => syncHScroll("main", e.currentTarget.scrollLeft)}
                  style={{ overflowX: "auto" }}
                >
                  <div style={{ minWidth: WEEK_W }}>
                    {/* timeline header */}
                    <div
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 15,
                        background: "white",
                        height: HEADER_H,
                        borderBottom: "1px solid #eee",
                        boxSizing: "border-box",
                      }}
                    >
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d, i) => {
                        const left = i * DAY_SPAN_MIN * PX_PER_MIN;
                        return (
                          <div
                            key={d}
                            style={{
                              position: "absolute",
                              left,
                              top: 6,
                              width: DAY_SPAN_MIN * PX_PER_MIN,
                              textAlign: "center",
                              fontWeight: 800,
                              fontSize: 13,
                              opacity: 0.85,
                            }}
                          >
                            {d}
                          </div>
                        );
                      })}

                      {Array.from({ length: 5 }).flatMap((_, dayIdx) =>
                        TIME_MARKS_MIN.map((mins) => (
                          <div
                            key={`time-${dayIdx}-${mins}`}
                            style={{
                              position: "absolute",
                              left: minuteToX(dayIdx, mins),
                              top: 32,
                              transform: "translateX(-50%)",
                              fontSize: 10,
                              opacity: 0.6,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {hourLabelShort(mins)}
                          </div>
                        ))
                      )}

                      {Array.from({ length: 6 }).map((_, i) => {
                        const x = i * DAY_SPAN_MIN * PX_PER_MIN;
                        return (
                          <div
                            key={`sep-${i}`}
                            style={{
                              position: "absolute",
                              left: x,
                              top: 0,
                              bottom: 0,
                              width: 1,
                              background: "rgba(0,0,0,0.06)",
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* timeline rows */}
                    {leaders.map((l) => {
                      const sched = (officeHoursByLeader[l.id] || []).filter(
                        (b) => Number(b.dayOfWeek) >= 1 && Number(b.dayOfWeek) <= 5
                      );

                      const leaderSessions = sessionsByLeader[l.id] || [];
                      const activeSessionTs = activeSessions[l.id]?.checkInTime;
                      const activeStart = activeSessionTs?.toDate?.() || null;

                      const combined = [...leaderSessions];
                      if (l.isActive && activeStart) {
                        const hasSame = combined.some(
                          (s) => s.start.getTime() === activeStart.getTime()
                        );
                        if (!hasSame) combined.push({ id: "__active__", start: activeStart, end: null });
                      }

                      return (
                        <div
                          key={l.id}
                          style={{
                            position: "relative",
                            height: ROW_H,
                            borderBottom: "1px solid #f3f3f3",
                            boxSizing: "border-box",
                          }}
                        >
                          {/* hour ticks */}
                          {Array.from({ length: 5 * 13 }).map((_, idx) => {
                            const dayIdx = Math.floor(idx / 13);
                            const hourIdx = idx % 13;
                            const x = (dayIdx * DAY_SPAN_MIN + hourIdx * 60) * PX_PER_MIN;
                            return (
                              <div
                                key={`tick-${l.id}-${idx}`}
                                style={{
                                  position: "absolute",
                                  left: x,
                                  top: 0,
                                  bottom: 0,
                                  width: 1,
                                  background:
                                    hourIdx === 0 ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.04)",
                                }}
                              />
                            );
                          })}

                          {/* scheduled outline boxes */}
                          {sched.map((b) => {
                            const { left, width } = blockForSchedule(
                              Number(b.dayOfWeek),
                              Number(b.startMinute),
                              Number(b.endMinute)
                            );
                            return (
                              <div
                                key={b.id}
                                title="scheduled"
                                style={{
                                  position: "absolute",
                                  left,
                                  top: 6,
                                  height: ROW_H - 12,
                                  width,
                                  border: "2px solid rgba(25,118,210,0.75)",
                                  borderRadius: 10,
                                  boxSizing: "border-box",
                                  pointerEvents: "none",
                                }}
                              />
                            );
                          })}

                          {/* actual session fill blocks */}
                          {combined
                            .flatMap((s) => sessionSegments(s.start, s.end))
                            .map((seg) => (
                              <div
                                key={`${l.id}-${seg.key}`}
                                title="in office"
                                style={{
                                  position: "absolute",
                                  left: seg.left,
                                  top: 8,
                                  height: ROW_H - 16,
                                  width: seg.width,
                                  background: "rgba(46, 125, 50, 0.25)",
                                  border: "1px solid rgba(46, 125, 50, 0.35)",
                                  borderRadius: 10,
                                  pointerEvents: "none",
                                }}
                              />
                            ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
          Outline = scheduled office hours. Green = actual time in office. Scroll horizontally to view the week.
        </div>
      </div>
    </div>
  );
}