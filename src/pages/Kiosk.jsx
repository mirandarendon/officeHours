import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, getDoc, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";

export default function Kiosk() {
  const [leaders, setLeaders] = useState([]);
  const [msg, setMsg] = useState("");

  // Live load leaders from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id, // doc id like "OA"
        ...d.data(),
      }));
      // Optional: sort by role/name so the kiosk looks consistent
      rows.sort((a, b) => (a.role || "").localeCompare(b.role || ""));
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

    // Mark the session as checked out
    await updateDoc(doc(db, "sessions", leader.currentSessionId), {
      checkOutTime: serverTimestamp(),
    });

    // Mark the leader inactive
    await updateDoc(leaderRef, {
      isActive: false,
      currentSessionId: null,
    });

    setMsg(`${id} clocked out ✅`);
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
