import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, doc, getDoc, getDocs, query, where, addDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import KioskLock from "./KioskLock";

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
  const [unlocked, setUnlocked] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState("");

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
    if (localStorage.getItem("kioskUnlocked") === "1") setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;
    autoCloseAtMidnight().catch(console.error);
  }, [user, unlocked]);

  useEffect(() => {
    if (!user) return;
    if (!unlocked) return;

    const unsub = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      rows.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.role || "").localeCompare(b.role || ""));
      setLeaders(rows);
    });

    return () => unsub();
  }, [user, unlocked]);

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

  }

  if (!authReady) return null;

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 360, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--panel)", color: "var(--text)" }}>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>kiosk sign in</div>

          <form onSubmit={handleSignIn}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              autoComplete="username"
              style={{ width: "94%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)" }}
            />
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="password"
              autoComplete="current-password"
              style={{ width: "94%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid var(--border)", marginTop: 10, background: "var(--bg)", color: "var(--text)" }}
            />
            <button
              type="submit"
              style={{ width: "100%", marginTop: 10, padding: 10, fontSize: 16, borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, background: "var(--primary)", color: "white" }}
            >
              sign in
            </button>
          </form>

          {!!authErr && <div style={{ marginTop: 10, color: "var(--muted)" }}>{authErr}</div>}
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return <KioskLock onUnlock={() => setUnlocked(true)} />;
  }

  const activeLeaders = leaders.filter((l) => l.isActive);

  return (
    <div style={{ padding: 24, textAlign: "center", background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
      
      <h1 style={{ marginTop: 0 }}>Office Hours Check In</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, marginTop: 12, alignItems: "start" }}>
        {/* left: buttons */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
          }}
        >
          {leaders.map((l) => (
            <div
              key={l.id}
              style={{
                border: "1px solid var(--border)",
                background: "var(--panel)",
                borderRadius: 12,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: 100,
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, minHeight: 30 }}>
                  {l.role || l.id}
                </div>
                
              </div>

              {l.isActive ? (
                <button
                  onClick={() => clockOut(l.id)}
                  style={{
                    marginTop: 12,
                    padding: 12,
                    fontSize: 16,
                    cursor: "pointer",
                    width: "100%",
                    background: "transparent",
                    color: "var(--primary)",
                    border: "2px solid var(--primary)",
                    borderRadius: 10,
                    fontWeight: 700,
                  }}
                >
                  Clock Out
                </button>
              ) : (
                <button
                  onClick={() => clockIn(l.id)}
                  style={{
                    marginTop: 12,
                    padding: 12,
                    fontSize: 16,
                    cursor: "pointer",
                    width: "100%",
                    background: "var(--primary)",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    fontWeight: 700,
                  }}
                >
                  Clock In
                </button>
              )}
            </div>
          ))}
        </div>

        {/* right: currently in office */}
        <div style={{ border: "1px solid var(--border)", background: "var(--panel)", borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: 20 }}>Currently In Office</div>

          {activeLeaders.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>No one is currently in the office.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeLeaders.map((l) => (
                <div
                  key={l.id}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    borderRadius: 10,
                    padding: "10px 10px",
                    fontWeight: 700,
                    color: "var(--primary)",
                  }}
                >
                  {l.role || l.id}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {msg && <p style={{ marginTop: 16, color: "var(--muted)" }}>{msg}</p>}
      </div>
    </div>
  );
}
