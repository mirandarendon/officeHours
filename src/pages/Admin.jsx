import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import AdminLock from "./AdminLock";

function pad2(n) {
  return String(n).padStart(2, "0");
}
function timeStrToMinutes(str) {
  const [hh, mm] = (str || "").split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}
function minutesToTimeLabel(mins) {
  const m = Math.max(0, Math.round(mins));
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 >= 12 ? "pm" : "am";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(mm)}${ampm}`;
}
function dayLabel(d) {
  return ["", "Mon", "Tue", "Wed", "Thu", "Fri"][d] || `Day ${d}`;
}
function slugify(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const btn = {
  fontSize: 14,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
};
const btnSm = { ...btn, padding: "6px 10px", fontSize: 13 };
const btnPrimary = { fontWeight: 700, background: "var(--primary)", borderColor: "var(--primary)", color: "white" };
const btnDanger = { fontWeight: 700, background: "var(--primary-hover)", borderColor: "var(--primary-hover)", color: "white" };
const input = {
  padding: "8px 9px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "white",
  color: "var(--text)",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};
const label = { fontSize: 12, opacity: 0.8, marginBottom: 4, display: "block" };

export default function Admin() {
  // auth
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  // data
  const [leaders, setLeaders] = useState([]);
  const [officeHours, setOfficeHours] = useState([]);

  // ui state
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editOrder, setEditOrder] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editErr, setEditErr] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErr, setDeleteErr] = useState("");
  const [addingHoursFor, setAddingHoursFor] = useState(null);
  const [blockDay, setBlockDay] = useState(1);
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("11:00");
  const [blockErr, setBlockErr] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newOrder, setNewOrder] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newId, setNewId] = useState("");
  const [newIdTouched, setNewIdTouched] = useState(false);
  const [newErr, setNewErr] = useState("");

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (localStorage.getItem("adminUnlocked") === "1") setUnlocked(true);
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
    if (!user || !unlocked) return;

    const unsubLeaders = onSnapshot(collection(db, "leaders"), (snapshot) => {
      const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort(
        (a, b) => (a.order ?? 9999) - (b.order ?? 9999) || (a.role || "").localeCompare(b.role || "")
      );
      setLeaders(rows);
    });

    const unsubHours = onSnapshot(collection(db, "officeHours"), (snapshot) => {
      setOfficeHours(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubLeaders();
      unsubHours();
    };
  }, [user, unlocked]);

  const blocksByLeader = useMemo(() => {
    const map = {};
    for (const b of officeHours) {
      if (!b.leaderId) continue;
      if (!map[b.leaderId]) map[b.leaderId] = [];
      map[b.leaderId].push(b);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => Number(a.dayOfWeek) - Number(b.dayOfWeek) || Number(a.startMinute) - Number(b.startMinute));
    }
    return map;
  }, [officeHours]);

  const filteredLeaders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leaders;
    return leaders.filter(
      (l) => (l.role || "").toLowerCase().includes(term) || l.id.toLowerCase().includes(term)
    );
  }, [leaders, search]);

  function startEdit(l) {
    setEditingId(l.id);
    setEditOrder(String(l.order ?? ""));
    setEditRole(l.role || "");
    setEditErr("");
    setDeletingId(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditErr("");
  }
  async function saveEdit(leaderId) {
    setEditErr("");
    const role = editRole.trim();
    const order = Number(editOrder);
    if (!role) return setEditErr("Title is required.");
    if (!Number.isFinite(order)) return setEditErr("Order must be a number.");

    try {
      await updateDoc(doc(db, "leaders", leaderId), { role, order });
      setEditingId(null);
    } catch (err) {
      setEditErr(err?.message || "Failed to save.");
    }
  }

  function startDelete(l) {
    setDeletingId(l.id);
    setDeleteErr("");
    setEditingId(null);
  }
  function cancelDelete() {
    setDeletingId(null);
    setDeleteErr("");
  }
  async function confirmDelete(l) {
    if (l.isActive) {
      setDeleteErr("Clock them out before deleting this position.");
      return;
    }
    try {
      const blocks = blocksByLeader[l.id] || [];
      for (const b of blocks) {
        await deleteDoc(doc(db, "officeHours", b.id));
      }
      await deleteDoc(doc(db, "leaders", l.id));
      setDeletingId(null);
    } catch (err) {
      setDeleteErr(err?.message || "Failed to delete.");
    }
  }

  function startAddHours(leaderId) {
    setAddingHoursFor(leaderId);
    setBlockDay(1);
    setBlockStart("09:00");
    setBlockEnd("11:00");
    setBlockErr("");
  }
  function cancelAddHours() {
    setAddingHoursFor(null);
    setBlockErr("");
  }
  async function saveBlock(leaderId) {
    setBlockErr("");
    const startMin = timeStrToMinutes(blockStart);
    const endMin = timeStrToMinutes(blockEnd);
    if (startMin == null || endMin == null) return setBlockErr("Invalid time.");
    if (endMin <= startMin) return setBlockErr("End must be after start.");
    if (startMin < 8 * 60 || endMin > 20 * 60) return setBlockErr("Keep blocks between 08:00 and 20:00.");

    const dup = officeHours.some(
      (b) =>
        b.leaderId === leaderId &&
        Number(b.dayOfWeek) === Number(blockDay) &&
        Number(b.startMinute) === startMin &&
        Number(b.endMinute) === endMin
    );
    if (dup) return setBlockErr("That exact block already exists.");

    try {
      await addDoc(collection(db, "officeHours"), {
        leaderId,
        dayOfWeek: Number(blockDay),
        startMinute: startMin,
        endMinute: endMin,
        createdAt: serverTimestamp(),
      });
      setAddingHoursFor(null);
    } catch (err) {
      setBlockErr(err?.message || "Failed to save.");
    }
  }
  async function removeBlock(blockId) {
    try {
      await deleteDoc(doc(db, "officeHours", blockId));
    } catch (err) {
      console.error(err);
    }
  }

  function startNew() {
    setCreatingNew(true);
    setNewOrder(String(leaders.length + 1));
    setNewRole("");
    setNewId("");
    setNewIdTouched(false);
    setNewErr("");
  }
  function cancelNew() {
    setCreatingNew(false);
    setNewErr("");
  }
  function onNewRoleChange(value) {
    setNewRole(value);
    if (!newIdTouched) setNewId(slugify(value));
  }
  async function saveNew() {
    setNewErr("");
    const role = newRole.trim();
    const order = Number(newOrder);
    const id = (newId || slugify(role)).trim();

    if (!role) return setNewErr("Title is required.");
    if (!id) return setNewErr("Position id is required.");
    if (!Number.isFinite(order)) return setNewErr("Order must be a number.");
    if (leaders.some((l) => l.id === id)) return setNewErr(`Id "${id}" is already used by another position.`);

    try {
      await setDoc(doc(db, "leaders", id), {
        role,
        order,
        isActive: false,
        currentSessionId: null,
      });
      setCreatingNew(false);
    } catch (err) {
      setNewErr(err?.message || "Failed to create.");
    }
  }

  if (!authReady) return null;

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: 360, border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
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

  if (!unlocked) {
    return <AdminLock onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1180 }}>
      <h1>Admin</h1>

      <button
        onClick={() => {
          localStorage.removeItem("adminUnlocked");
          setUnlocked(false);
        }}
        style={{ ...btnSm, marginBottom: 16 }}
      >
        lock admin
      </button>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by title or id…"
          style={{ ...input, flex: 1, minWidth: 180 }}
        />
        <span style={{ fontSize: 12, opacity: 0.7, whiteSpace: "nowrap" }}>Sorted by order number</span>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        {filteredLeaders.map((l) => (
          <LeaderCard
            key={l.id}
            leader={l}
            blocks={blocksByLeader[l.id] || []}
            editing={editingId === l.id}
            editOrder={editOrder}
            editRole={editRole}
            editErr={editingId === l.id ? editErr : ""}
            setEditOrder={setEditOrder}
            setEditRole={setEditRole}
            onStartEdit={() => startEdit(l)}
            onCancelEdit={cancelEdit}
            onSaveEdit={() => saveEdit(l.id)}
            deleting={deletingId === l.id}
            deleteErr={deletingId === l.id ? deleteErr : ""}
            onStartDelete={() => startDelete(l)}
            onCancelDelete={cancelDelete}
            onConfirmDelete={() => confirmDelete(l)}
            addingHours={addingHoursFor === l.id}
            blockDay={blockDay}
            blockStart={blockStart}
            blockEnd={blockEnd}
            blockErr={addingHoursFor === l.id ? blockErr : ""}
            setBlockDay={setBlockDay}
            setBlockStart={setBlockStart}
            setBlockEnd={setBlockEnd}
            onStartAddHours={() => startAddHours(l.id)}
            onCancelAddHours={cancelAddHours}
            onSaveBlock={() => saveBlock(l.id)}
            onRemoveBlock={removeBlock}
          />
        ))}

        {creatingNew ? (
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>New position</div>

            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: "0 0 80px" }}>
                <label style={label}>Order</label>
                <input
                  type="number"
                  min="1"
                  value={newOrder}
                  onChange={(e) => setNewOrder(e.target.value)}
                  style={input}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Title</label>
                <input
                  value={newRole}
                  onChange={(e) => onNewRoleChange(e.target.value)}
                  placeholder="e.g. Secretary of Records"
                  autoFocus
                  style={input}
                />
              </div>
            </div>

            <div>
              <label style={label}>Position id</label>
              <input
                value={newId}
                onChange={(e) => {
                  setNewId(e.target.value);
                  setNewIdTouched(true);
                }}
                placeholder="auto-generated from title"
                style={input}
              />
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                Used as the internal id — fixed once created.
              </div>
            </div>

            {!!newErr && <div style={{ fontSize: 13, color: "var(--primary-hover)" }}>{newErr}</div>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={cancelNew} style={btnSm}>
                Cancel
              </button>
              <button onClick={saveNew} style={{ ...btnSm, ...btnPrimary }}>
                Create
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={startNew}
            style={{
              border: "2px dashed var(--border)",
              borderRadius: 12,
              background: "transparent",
              color: "var(--text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 120,
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 20, marginRight: 8, lineHeight: 1 }}>+</span> New Position
          </button>
        )}
      </div>
    </div>
  );
}

const cardStyle = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  position: "relative",
};

function LeaderCard({
  leader,
  blocks,
  editing,
  editOrder,
  editRole,
  editErr,
  setEditOrder,
  setEditRole,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  deleting,
  deleteErr,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  addingHours,
  blockDay,
  blockStart,
  blockEnd,
  blockErr,
  setBlockDay,
  setBlockStart,
  setBlockEnd,
  onStartAddHours,
  onCancelAddHours,
  onSaveBlock,
  onRemoveBlock,
}) {
  if (deleting) {
    return (
      <div style={cardStyle}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "white",
            border: "1px solid var(--primary-hover)",
            borderRadius: 12,
            padding: 18,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 10,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 14 }}>
            <b style={{ display: "block", fontSize: 15, marginBottom: 4 }}>
              Delete &ldquo;{leader.role || leader.id}&rdquo;?
            </b>
            <span style={{ opacity: 0.75, fontSize: 12.5 }}>
              This also removes {blocks.length} scheduled hour{blocks.length === 1 ? "" : "s"} block
              {blocks.length === 1 ? "" : "s"}. This can't be undone.
            </span>
          </div>
          {!!deleteErr && <div style={{ fontSize: 12.5, color: "var(--primary-hover)" }}>{deleteErr}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={onCancelDelete} style={btnSm}>
              Cancel
            </button>
            <button onClick={onConfirmDelete} style={{ ...btnSm, ...btnDanger }}>
              Yes, delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Editing position</div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: "0 0 80px" }}>
            <label style={label}>Order</label>
            <input
              type="number"
              min="1"
              value={editOrder}
              onChange={(e) => setEditOrder(e.target.value)}
              style={input}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Title</label>
            <input value={editRole} onChange={(e) => setEditRole(e.target.value)} style={input} />
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7 }}>id: {leader.id} (fixed)</div>

        {!!editErr && <div style={{ fontSize: 12.5, color: "var(--primary-hover)" }}>{editErr}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancelEdit} style={btnSm}>
            Cancel
          </button>
          <button onClick={onSaveEdit} style={{ ...btnSm, ...btnPrimary }}>
            Save
          </button>
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Scheduled hours</div>
        <BlockList blocks={blocks} onRemoveBlock={onRemoveBlock} />
        <AddHoursForm
          open={addingHours}
          day={blockDay}
          start={blockStart}
          end={blockEnd}
          err={blockErr}
          setDay={setBlockDay}
          setStart={setBlockStart}
          setEnd={setBlockEnd}
          onOpen={onStartAddHours}
          onCancel={onCancelAddHours}
          onSave={onSaveBlock}
        />
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 24,
              height: 20,
              padding: "0 6px",
              borderRadius: 6,
              background: "white",
              border: "1px solid #ddd",
              color: "var(--primary)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            #{leader.order ?? "—"}
          </span>
          <div style={{ fontWeight: 800, fontSize: 16, margin: "6px 0 2px", overflowWrap: "anywhere" }}>
            {leader.role || leader.id}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{leader.id}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={onStartEdit} style={{ ...btnSm, background: "white" }}>
            Edit
          </button>
          <button
            onClick={onStartDelete}
            style={{ ...btnSm, background: "white", color: "var(--primary-hover)", borderColor: "var(--primary-hover)" }}
          >
            Delete
          </button>
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.75 }}>Scheduled hours</div>
      <BlockList blocks={blocks} onRemoveBlock={onRemoveBlock} />
      <AddHoursForm
        open={addingHours}
        day={blockDay}
        start={blockStart}
        end={blockEnd}
        err={blockErr}
        setDay={setBlockDay}
        setStart={setBlockStart}
        setEnd={setBlockEnd}
        onOpen={onStartAddHours}
        onCancel={onCancelAddHours}
        onSave={onSaveBlock}
      />
    </div>
  );
}

function BlockList({ blocks, onRemoveBlock }) {
  if (blocks.length === 0) {
    return <div style={{ fontSize: 13, fontStyle: "italic", opacity: 0.7 }}>No scheduled hours yet.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {blocks.map((b) => (
        <div
          key={b.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "6px 8px",
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 700, minWidth: 30 }}>{dayLabel(b.dayOfWeek)}</span>
          <span style={{ opacity: 0.8, flex: 1 }}>
            {minutesToTimeLabel(b.startMinute)} – {minutesToTimeLabel(b.endMinute)}
          </span>
          <button
            onClick={() => onRemoveBlock(b.id)}
            title="Remove"
            style={{ border: "none", background: "transparent", color: "var(--primary-hover)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function AddHoursForm({ open, day, start, end, err, setDay, setStart, setEnd, onOpen, onCancel, onSave }) {
  if (!open) {
    return (
      <button
        onClick={onOpen}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: "1px dashed #ddd",
          color: "var(--text)",
          fontSize: 13,
          fontWeight: 700,
          padding: "6px 10px",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        + Add hours
      </button>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
        padding: 10,
        background: "white",
        border: "1px solid #ddd",
        borderRadius: 10,
      }}
    >
      <select
        value={day}
        onChange={(e) => setDay(Number(e.target.value))}
        style={{ padding: "6px 7px", borderRadius: 8, border: "1px solid #ddd", background: "white", fontSize: 13 }}
      >
        <option value={1}>Mon</option>
        <option value={2}>Tue</option>
        <option value={3}>Wed</option>
        <option value={4}>Thu</option>
        <option value={5}>Fri</option>
      </select>
      <input
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        style={{ padding: "6px 7px", borderRadius: 8, border: "1px solid #ddd", background: "white", fontSize: 13 }}
      />
      <span style={{ opacity: 0.7, fontSize: 12 }}>to</span>
      <input
        type="time"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        style={{ padding: "6px 7px", borderRadius: 8, border: "1px solid #ddd", background: "white", fontSize: 13 }}
      />
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        <button onClick={onCancel} style={btnSm}>
          Cancel
        </button>
        <button onClick={onSave} style={{ ...btnSm, ...btnPrimary }}>
          Add
        </button>
      </div>
      {!!err && <div style={{ width: "100%", fontSize: 12, color: "var(--primary-hover)" }}>{err}</div>}
    </div>
  );
}
