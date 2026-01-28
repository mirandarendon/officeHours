import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import Kiosk from "./pages/Kiosk.jsx"
import Dashboard from "./pages/Dashboard.jsx"
import './App.css'
import Admin from "./pages/Admin";


function App() {
  return (
    <BrowserRouter>
      <div style={{ padding: 24 }}>
        <nav style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <Link to="/kiosk">Check in</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/admin">Admin</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/kiosk" replace />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App
