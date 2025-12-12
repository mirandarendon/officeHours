import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import Kiosk from "./pages/Kiosk.jsx"
import Dashboard from "./pages/Dashboard.jsx"
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div style={{ padding: 24 }}>
        <nav style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <Link to="/kiosk">Kiosk</Link>
          <Link to="/dashboard">Dashboard</Link>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/kiosk" replace />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App
