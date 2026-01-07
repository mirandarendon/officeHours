import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

export default function Dashboard() {
  const [activeLeaders, setActiveLeaders] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const active = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((l) => l.isActive);

      active.sort((a, b) => (a.role || "").localeCompare(b.role || ""));
      setActiveLeaders(active);
    });

    return () => unsub();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Who’s In Office</h1>

      {activeLeaders.length === 0 ? (
        <p>No one is currently in the office.</p>
      ) : (
        <ul>
          {activeLeaders.map((l) => (
            <li key={l.id} style={{ fontSize: 18, marginBottom: 8 }}>
              {l.role || l.id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
