import { useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, doc, writeBatch, setDoc } from "firebase/firestore";

const leaders = [
  { id: "pres", role: "President", order: 1 },
  { id: "vp", role: "Vice President", order: 2 },
  { id: "spt", role: "Senator Pro Tempore", order: 3 },
  { id: "atg", role: "Attorney General", order: 4 },
  { id: "treas", role: "Treasurer", order: 5 },

  { id: "ag", role: "Agriculture Senator", order: 6 },
  { id: "bus", role: "Business Senator", order: 7 },
  { id: "ceis", role: "CEIS Senator", order: 8 },
  { id: "class", role: "CLASS Senator", order: 9 },
  { id: "cchm", role: "CCHM Senator", order: 10 },
  { id: "eng", role: "Engineering Senator", order: 11 },
  { id: "env", role: "Environmental Design Senator", order: 12 },
  { id: "sci", role: "Science Senator", order: 13 },
  { id: "rsa", role: "RSA Senator", order: 14 },
  { id: "sic", role: "SIC Senator", order: 15 },
  { id: "mcc", role: "MCC Senator", order: 16 },
  { id: "greek", role: "Greek Senator", order: 17 },

  { id: "bn", role: "Secretary of Basic Needs", order: 18 },
  { id: "ext", role: "Secretary of External Affairs", order: 19 },

  { id: "adv", role: "Officer of Advocacy", order: 20 },
  { id: "ia", role: "Officer of Internal Affairs", order: 21 },
  { id: "pr", role: "Officer of Public Relations", order: 22 },
  { id: "sus", role: "Officer of Sustainability", order: 23 },
];

async function deleteCollection(collName) {
  const snap = await getDocs(collection(db, collName));
  const docs = snap.docs;

  // Firestore batches max 500 ops
  for (let i = 0; i < docs.length; i += 450) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + 450);
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  return docs.length;
}

export default function Admin() {
  const [msg, setMsg] = useState("");

  async function resetData() {
    setMsg("Resetting…");

    // delete sessions first, then leaders
    const sessionsDeleted = await deleteCollection("sessions");
    const leadersDeleted = await deleteCollection("leaders");

    setMsg(`Reset done ✅ Deleted ${leadersDeleted} leaders and ${sessionsDeleted} sessions.`);
  }

  async function seedLeaders() {
    setMsg("Seeding leaders…");

    for (const l of leaders) {
      await setDoc(doc(db, "leaders", l.id), {
        role: l.role,
        order: l.order,
        isActive: false,
        currentSessionId: null,
      });
    }

    setMsg(`Seed done ✅ Added ${leaders.length} leaders.`);
  }

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h1>Admin</h1>
      <p style={{ opacity: 0.85 }}>
        Dev tools only. Reset deletes ALL leaders + sessions.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <button
          onClick={resetData}
          style={{ padding: 12, fontSize: 16, cursor: "pointer" }}
        >
          Reset (delete leaders + sessions)
        </button>

        <button
          onClick={seedLeaders}
          style={{ padding: 12, fontSize: 16, cursor: "pointer" }}
        >
          Seed Leaders
        </button>
      </div>

      {msg && <p style={{ marginTop: 16 }}>{msg}</p>}
    </div>
  );
}
