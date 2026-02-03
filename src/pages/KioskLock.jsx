import { useState } from "react";

export default function KioskLock({ onUnlock }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (pass === import.meta.env.VITE_KIOSK_PASSCODE) {
      localStorage.setItem("kioskUnlocked", "1");
      onUnlock();
      return;
    }

    setErr("wrong password");
    setPass("");
  }

  return (
    <div className="lockScreen">
      <div className="lockCard">
        <div className="lockTitle">kiosk locked</div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="enter password"
            autoFocus
          />
          <button type="submit">unlock</button>
        </form>

        {!!err && <div className="lockErr">{err}</div>}
      </div>
    </div>
  );
}
