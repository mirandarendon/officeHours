import { useState } from "react";
import { db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function Dashboard() {
  const [msg, setMsg] = useState("");

  async function testWrite() {
    setMsg("");

    // This writes a simple doc at: test/ping
    await setDoc(doc(db, "test", "ping"), {
      message: "hello firestore",
      createdAt: serverTimestamp(),
    });

    setMsg("Wrote to Firestore ✅");
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Dashboard</h1>
      <button onClick={testWrite}>Test Firestore Write</button>
      {msg && <p>{msg}</p>}
    </div>
  );
}
