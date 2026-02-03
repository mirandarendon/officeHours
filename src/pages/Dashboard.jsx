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

  const activeLeadersSnap = await getDocs(query(collection(db, "leaders"), where("isActive", "==", true)));

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
  const [sessionsThisWeek, setSessionsThisWeek] = useState([]); // list of sessions since week start
  const [now, setNow] = useState(Date.now());
  const [unlocked, setUnlocked] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState("");

  const activeSessionUnsubsRef = useRef({});

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
      rows.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.role || "").localeCompare(b.role || ""));
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

  // 3) Listen to all sessions since start of week (for totals)
  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;

    const weekStart = Timestamp.fromDate(startOfWeek(new Date()));
    const q = query(collection(db, "sessions"), where("checkInTime", ">=", weekStart));

    const unsub = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSessionsThisWeek(rows);
    });

    return () => unsub();
  }, [user, unlocked]);

  // 4) Compute totals per leader (today + week)
  const totalsByLeader = useMemo(() => {
    const todayStartMs = startOfDay(new Date()).getTime();
    const map = {};

    for (const s of sessionsThisWeek) {
      const leaderId = s.leaderId;
      if (!leaderId) continue;

      if (s.excludeFromTotals) continue;
      if (!s.checkOutTime) continue;

      const ci = s.checkInTime?.toDate?.();
      if (!ci) continue;

      let durMin;
      if (typeof s.durationMinutes === "number") {
        durMin = s.durationMinutes;
      } else {
        const co = s.checkOutTime.toDate();
        const durMs = Math.max(0, co.getTime() - ci.getTime());
        durMin = durMs / 60000;
      }

      if (!map[leaderId]) map[leaderId] = { todayMinutes: 0, weekMinutes: 0 };
      map[leaderId].weekMinutes += durMin;

      if (ci.getTime() >= todayStartMs) {
        map[leaderId].todayMinutes += durMin;
      }
    }

    return map;
  }, [sessionsThisWeek]);

  const activeLeaders = leaders.filter((l) => l.isActive);

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
              style={{ width: "94%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ddd", marginTop: 10 }}
            />
            <button
              type="submit"
              style={{ width: "100%", marginTop: 10, padding: 10, fontSize: 16, borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700 }}
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
    <div style={{ padding: 24, maxWidth: 1000 }}>
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
                    <span>
                      · {msToNice(durMs)}
                    </span>
                  ) : (
                    <span>· (loading check-in time…)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* section 2 totals for all leaders */}
      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Totals</h2>
        <p style={{ marginTop: 0, opacity: 0.85 }}>
          Shows total time for today and this week.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>
                  Leader
                </th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>
                  Today
                </th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>
                  This Week
                </th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((l) => {
                const totals = totalsByLeader[l.id] || { todayMinutes: 0, weekMinutes: 0 };
                return (
                  <tr key={l.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      {l.role || l.id}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      {minutesToNice(totals.todayMinutes)}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      {minutesToNice(totals.weekMinutes)}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      {l.isActive ? "In office" : "Out"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
