import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, doc, onSnapshot, query, where, Timestamp } from "firebase/firestore";

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

export default function Dashboard() {
  const [leaders, setLeaders] = useState([]); // all leaders
  const [activeSessions, setActiveSessions] = useState({}); // leaderId -> { checkInTime }
  const [sessionsThisWeek, setSessionsThisWeek] = useState([]); // list of sessions since week start
  const [now, setNow] = useState(Date.now());

  // Keep per-leader session listeners so we can unsubscribe cleanly
  const activeSessionUnsubsRef = useRef({});

  // Tick every second so "in office" durations update live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 1) Listen to ALL leaders (for both sections)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.role || "").localeCompare(b.role || ""));
      setLeaders(rows);
    });

    return () => unsub();
  }, []);

  // 2) For leaders who are active, listen to their current session doc (for checkInTime)
  useEffect(() => {
    const active = leaders.filter((l) => l.isActive && l.currentSessionId);

    // Unsubscribe sessions that are no longer active
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

    // Subscribe to currently active sessions
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

    // cleanup on unmount
    return () => {
      for (const leaderId of Object.keys(activeSessionUnsubsRef.current)) {
        activeSessionUnsubsRef.current[leaderId]?.();
      }
      activeSessionUnsubsRef.current = {};
    };
  }, [leaders]);

  // 3) Listen to all sessions since start of week (for totals)
  useEffect(() => {
    const weekStart = Timestamp.fromDate(startOfWeek(new Date()));
    const q = query(collection(db, "sessions"), where("checkInTime", ">=", weekStart));

    const unsub = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSessionsThisWeek(rows);
    });

    return () => unsub();
  }, []);

  // 4) Compute totals per leader (today + week)
  const totalsByLeader = useMemo(() => {
    const todayStartMs = startOfDay(new Date()).getTime();
    const map = {}; // leaderId -> { todayMinutes, weekMinutes }

    for (const s of sessionsThisWeek) {
      const leaderId = s.leaderId;
      if (!leaderId) continue;

      const ci = s.checkInTime?.toDate?.();
      if (!ci) continue;

      const co = s.checkOutTime?.toDate?.() || new Date(now);
      const durMs = Math.max(0, co.getTime() - ci.getTime());
      const durMin = durMs / 60000;

      if (!map[leaderId]) map[leaderId] = { todayMinutes: 0, weekMinutes: 0 };
      map[leaderId].weekMinutes += durMin;

      // Count toward "today" if the session started today
      if (ci.getTime() >= todayStartMs) {
        map[leaderId].todayMinutes += durMin;
      }
    }

    return map;
  }, [sessionsThisWeek, now]);

  const activeLeaders = leaders.filter((l) => l.isActive);

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1>Dashboard</h1>

      {/* Section 1: Who is in office right now */}
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

      {/* Section 2: Totals for all leaders */}
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
