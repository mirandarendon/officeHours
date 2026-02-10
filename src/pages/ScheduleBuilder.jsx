import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";

function pad2(n) {
  return String(n).padStart(2, "0");
}
function minutesToTimeStr(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(h)}:${pad2(mm)}`;
}
function timeStrToMinutes(str) {
  const [hh, mm] = (str || "").split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}
function dayLabel(d) {
  return ["", "Mon", "Tue", "Wed", "Thu", "Fri"][d] || `Day ${d}`;
}

export default function ScheduleBuilder() {
  // auth
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState("");

  // data
  const [leaders, setLeaders] = useState([]);
  const [officeHours, setOfficeHours] = useState([]);

  // builder inputs
  const [useManualLeaderId, setUseManualLeaderId] = useState(true);
  const [manualLeaderId, setManualLeaderId] = useState("pres");
  const [pickedLeaderId, setPickedLeaderId] = useState("");

  const [day, setDay] = useState(1);
  const [start, setStart] = useState("13:00");
  const [end, setEnd] = useState("15:00");
  const [err, setErr] = useState("");

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
    } catch (e2) {
      setAuthErr(e2?.message || "login failed");
    }
  }

  useEffect(() => {
    if (!user) return;

    const unsubLeaders = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.role || "").localeCompare(b.role || ""));
      setLeaders(rows);

      // default dropdown selection
      if (!pickedLeaderId && rows.length > 0) setPickedLeaderId(rows[0].id);
    });

    const unsubHours = onSnapshot(collection(db, "officeHours"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setOfficeHours(rows);
    });

    return () => {
      unsubLeaders();
      unsubHours();
    };
  }, [user, pickedLeaderId]);

  const leaderIdToUse = useMemo(() => {
    return useManualLeaderId ? (manualLeaderId || "").trim() : pickedLeaderId;
  }, [useManualLeaderId, manualLeaderId, pickedLeaderId]);

  async function addBlock() {
    setErr("");

    const lid = leaderIdToUse;
    if (!lid) return setErr("Leader id is required.");

    const startMin = timeStrToMinutes(start);
    const endMin = timeStrToMinutes(end);
    if (startMin == null || endMin == null) return setErr("Invalid time. Use HH:MM.");
    if (endMin <= startMin) return setErr("End time must be after start time.");

    // your grid window
    const minAllowed = 8 * 60;
    const maxAllowed = 20 * 60;
    if (startMin < minAllowed || endMin > maxAllowed) {
      return setErr("Keep blocks between 08:00 and 20:00.");
    }

    const dup = officeHours.some(
      (b) =>
        b.leaderId === lid &&
        Number(b.dayOfWeek) === Number(day) &&
        Number(b.startMinute) === startMin &&
        Number(b.endMinute) === endMin
    );
    if (dup) return setErr("That exact block already exists.");

    await addDoc(collection(db, "officeHours"), {
      leaderId: lid,
      dayOfWeek: Number(day),
      startMinute: startMin,
      endMinute: endMin,
      createdAt: serverTimestamp(),
    });
  }

  async function removeBlock(blockId) {
    await deleteDoc(doc(db, "officeHours", blockId));
  }

  async function quickAddExample() {
    setErr("");
    const preset = [
      // pres: Mon 2-4, Wed 12-2:30
      { leaderId: "pres", dayOfWeek: 1, startMinute: 14 * 60, endMinute: 16 * 60 },
      { leaderId: "pres", dayOfWeek: 3, startMinute: 12 * 60, endMinute: 14 * 60 + 30 },

      // vp: Tue 10-12, Thu 1-3:45
      { leaderId: "vp", dayOfWeek: 2, startMinute: 10 * 60, endMinute: 12 * 60 },
      { leaderId: "vp", dayOfWeek: 4, startMinute: 13 * 60, endMinute: 15 * 60 + 45 },

      // spt: Mon 1-3, Thu 1-3
      { leaderId: "spt", dayOfWeek: 1, startMinute: 13 * 60, endMinute: 15 * 60 },
      { leaderId: "spt", dayOfWeek: 4, startMinute: 13 * 60, endMinute: 15 * 60 },
    ];

    for (const b of preset) {
      const dup = officeHours.some(
        (x) =>
          x.leaderId === b.leaderId &&
          Number(x.dayOfWeek) === b.dayOfWeek &&
          Number(x.startMinute) === b.startMinute &&
          Number(x.endMinute) === b.endMinute
      );
      if (!dup) {
        await addDoc(collection(db, "officeHours"), { ...b, createdAt: serverTimestamp() });
      }
    }
  }

  if (!authReady) return null;

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 380, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
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

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1>Schedule Builder</h1>
      <p style={{ marginTop: 0, opacity: 0.85 }}>
        This creates docs in <code>officeHours</code>. One block = one day + start/end.
      </p>

      <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Leader input</div>
            <select
              value={useManualLeaderId ? "manual" : "dropdown"}
              onChange={(e) => setUseManualLeaderId(e.target.value === "manual")}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            >
              <option value="manual">Manual (type leaderId)</option>
              <option value="dropdown">Dropdown (from leaders)</option>
            </select>
          </div>

          {useManualLeaderId ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>leaderId</div>
              <input
                value={manualLeaderId}
                onChange={(e) => setManualLeaderId(e.target.value)}
                placeholder="pres"
                style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 160 }}
              />
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Leader</div>
              <select
                value={pickedLeaderId}
                onChange={(e) => setPickedLeaderId(e.target.value)}
                style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 220 }}
              >
                {leaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.role || l.id} ({l.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Day</div>
            <select
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            >
              <option value={1}>Monday</option>
              <option value={2}>Tuesday</option>
              <option value={3}>Wednesday</option>
              <option value={4}>Thursday</option>
              <option value={5}>Friday</option>
            </select>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Start</div>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>End</div>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            />
          </div>

          <button
            onClick={addBlock}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            add block
          </button>

          <button
            onClick={quickAddExample}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "transparent",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            quick add example
          </button>
        </div>

        {!!err && <div style={{ marginTop: 10, opacity: 0.9 }}>{err}</div>}
      </div>

      <div style={{ marginTop: 20, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Existing blocks</h2>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>leaderId</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Day</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Time</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}></th>
              </tr>
            </thead>
            <tbody>
              {officeHours
                .slice()
                .sort(
                  (a, b) =>
                    (a.leaderId || "").localeCompare(b.leaderId || "") ||
                    (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) ||
                    (a.startMinute ?? 0) - (b.startMinute ?? 0)
                )
                .map((b) => (
                  <tr key={b.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{b.leaderId}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>{dayLabel(b.dayOfWeek)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      {minutesToTimeStr(b.startMinute)} to {minutesToTimeStr(b.endMinute)}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f0f0f0" }}>
                      <button
                        onClick={() => removeBlock(b.id)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {officeHours.length === 0 && <div style={{ marginTop: 10, opacity: 0.8 }}>No blocks yet.</div>}
        </div>
      </div>
    </div>
  );
}
