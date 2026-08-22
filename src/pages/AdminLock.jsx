import { useState } from "react";

export default function AdminLock({ onUnlock }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (pass === import.meta.env.VITE_DASHBOARD_PASSCODE) {
      localStorage.setItem("adminUnlocked", "1");
      onUnlock();
      return;
    }

    setErr("wrong password");
    setPass("");
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: 360, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 10 }}>admin locked</div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="enter password"
            autoFocus
            style={{ width: "94%", padding: 10, fontSize: 16, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button
            type="submit"
            style={{ width: "100%", marginTop: 10, padding: 10, fontSize: 16, borderRadius: 10, border: "none", cursor: "pointer" }}
          >
            unlock
          </button>
        </form>

        {!!err && <div style={{ marginTop: 10, opacity: 0.8 }}>{err}</div>}
      </div>
    </div>
  );
}
