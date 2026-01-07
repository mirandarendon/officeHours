import { useState } from "react";
import { db } from "../firebase";
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";

const LEADERS = [
  { id: "OA", label: "Office Assistant" },
  // add more later:
  // { id: "PRES", label: "President" },
  // { id: "VP", label: "Vice President" },
];

export default function Kiosk() {
  const [msg, setMsg] = useState("");

  async function clockIn(id) {
    setMsg("");
    const leaderRef = doc(db, "leaders", id);
    const leaderSnap = await getDoc(leaderRef);

    if (!leaderSnap.exists()) return setMsg(`${id} not found in leaders.`);
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

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h1>Kiosk</h1>
      <p>Tap your position to clock in.</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {LEADERS.map((l) => (
          <button
            key={l.id}
            onClick={() => clockIn(l.id)}
            style={{ padding: 16, fontSize: 18, cursor: "pointer" }}
          >
            {l.label}
          </button>
        ))}
      </div>

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}
    </div>
  );
}
