import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, getDoc, getDocs, query, where, addDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";

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

export default function Kiosk() {
  const [leaders, setLeaders] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    autoCloseAtMidnight().catch(console.error);
  }, []);

  // Live load leaders from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id, // doc id like "OA"
        ...d.data(),
      }));
      rows.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.role || "").localeCompare(b.role || ""));
      setLeaders(rows);
    });

    return () => unsub(); // cleanup listener when you leave the page
  }, []);

  async function clockIn(id) {
    setMsg("");

    const leaderRef = doc(db, "leaders", id);
    const leaderSnap = await getDoc(leaderRef);
    if (!leaderSnap.exists()) return setMsg(`${id} not found.`);

    const leader = leaderSnap.data();
    if (leader.isActive) return setMsg(`${id} is already clocked in.`);

    const sessionRef = await addDoc(collection(db, "sessions"), {
      leaderId: id,
      checkInTime: serverTimestamp(),
      checkOutTime: null,
      durationMinutes: null,
      autoClosed: false,
      excludeFromTotals: false,
    });

    await updateDoc(leaderRef, {
      isActive: true,
      currentSessionId: sessionRef.id,
    });

    setMsg(`${id} clocked in ✅`);
  }

  async function clockOut(id) {
    setMsg("");

    const leaderRef = doc(db, "leaders", id);
    const leaderSnap = await getDoc(leaderRef);
    if (!leaderSnap.exists()) return setMsg(`${id} not found.`);

    const leader = leaderSnap.data();
    if (!leader.isActive || !leader.currentSessionId) {
      return setMsg(`${id} is not currently clocked in.`);
    }

    const sessionRef = doc(db, "sessions", leader.currentSessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) return setMsg("Session not found.");

    const session = sessionSnap.data();
    const checkInDate = session.checkInTime?.toDate?.();
    if (!checkInDate) return setMsg("Session missing checkInTime.");

    const checkOutDate = new Date();
    const durationMinutes = Math.max(0, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 60000));

    await updateDoc(sessionRef, {
      checkOutTime: Timestamp.fromDate(checkOutDate),
      durationMinutes,
      autoClosed: false,
      excludeFromTotals: false,
    });

    await updateDoc(leaderRef, {
      isActive: false,
      currentSessionId: null,
    });

    setMsg(`${id} clocked out ✅ (${durationMinutes} min)`);
  }

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1>Office Hours Check In</h1>
      <p>Tap your position.</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {leaders.map((l) => (
          <div
            key={l.id}
            style={{
              border: "1px solid #ccc",
              borderRadius: 12,
              padding: 16,
              minWidth: 220,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {l.role || l.id}
            </div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              Status: {l.isActive ? "In office" : "Out"}
            </div>

            {l.isActive ? (
              <button
                onClick={() => clockOut(l.id)}
                style={{ marginTop: 12, padding: 12, fontSize: 16, cursor: "pointer" }}
              >
                Clock Out
              </button>
            ) : (
              <button
                onClick={() => clockIn(l.id)}
                style={{ marginTop: 12, padding: 12, fontSize: 16, cursor: "pointer" }}
              >
                Clock In
              </button>
            )}
          </div>
        ))}
      </div>

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}
    </div>
  );
}
