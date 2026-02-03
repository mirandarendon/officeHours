import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";

export default function AuthGate({ title, children }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    try {
      const auth = getAuth();
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      setErr(e?.message || "login failed");
    }
  }

  if (loading) return null;

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 360, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>{title}</div>

          <form onSubmit={handleSubmit}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              autoComplete="username"
              style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ddd" }}
            />
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="password"
              autoComplete="current-password"
              style={{ width: "100%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ddd", marginTop: 10 }}
            />
            <button
              type="submit"
              style={{ width: "100%", marginTop: 10, padding: 10, fontSize: 16, borderRadius: 10, border: "none", cursor: "pointer" }}
            >
              sign in
            </button>
          </form>

          {!!err && <div style={{ marginTop: 10, opacity: 0.85 }}>{err}</div>}
        </div>
      </div>
    );
  }

  return children;
}
