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
    autoCloseAtMidnight().catch(console.error);
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
        // active (no checkout) count live
        durMin = Math.max(0, (now - ci.getTime()) / 60000);
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
  const HEADER_H = 44;
  const LEFT_W = 260;
  const WEEK_W = DAY_SPAN_MIN * PX_PER_MIN * 5;

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
              style={{ width: "94%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ddd" }}
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
    <div style={{ padding: 24, maxWidth: 1100 }}>
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
                  {checkInDate ? <span>· {msToNice(durMs)}</span> : <span>· (loading check-in time…)</span>}
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
          </div>
        </div>

        {/* Seamless grid: one vertical scroller, right side horizontal scroller */}
        <div
          style={{
            marginTop: 14,
            border: "1px solid #eee",
            borderRadius: 12,
            overflow: "hidden",
            background: "white",
          }}
        >
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `${LEFT_W}px 1fr` }}>
              {/* LEFT PANE (frozen) */}
              <div style={{ borderRight: "1px solid #eee", boxSizing: "border-box" }}>
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
                    top: 0,
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
                          Today: {minutesToNice(totals.todayMinutes)} · Week: {minutesToNice(totals.weekMinutes)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RIGHT PANE (horizontal scroll) */}
              <div style={{ overflowX: "auto" }}>
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
                            top: 10,
                            width: DAY_SPAN_MIN * PX_PER_MIN,
                            textAlign: "center",
                            fontWeight: 800,
                            opacity: 0.85,
                          }}
                        >
                          {d}
                        </div>
                      );
                    })}

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
                      const hasSame = combined.some((s) => s.start.getTime() === activeStart.getTime());
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
                                background: hourIdx === 0 ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.04)",
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
                        {combined.flatMap((s) => sessionSegments(s.start, s.end)).map((seg) => (
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

        <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
          Outline = scheduled office hours. Green = actual time in office. Scroll horizontally to view the week.
        </div>
      </div>
    </div>
  );
}
