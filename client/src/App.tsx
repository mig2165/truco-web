import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';
import { StorePage } from './components/StorePage';
import { WalletPage } from './components/WalletPage';
import teacherModeDoc from './assets/teacher-mode-doc.svg';
import './App.css';

function App() {
  const [teacherModeEnabled, setTeacherModeEnabled] = useState(false);

  return (
    <SocketProvider>
      <div className="app-shell">
        <Router>
          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/room/:roomId" element={<Room />} />
            <Route path="/store" element={<StorePage />} />
            <Route path="/wallet" element={<WalletPage />} />
          </Routes>
        </Router>

        {teacherModeEnabled && (
          <div className="teacher-mode-overlay" aria-live="polite">
            <div className="teacher-mode-overlay__frame">
              {/* Static screenshot keeps the fake classroom-safe view instant and consistent. */}
              <img
                className="teacher-mode-overlay__image"
                src={teacherModeDoc}
                alt="Screenshot of a Google Docs document"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          className="teacher-mode-toggle"
          onClick={() => setTeacherModeEnabled((currentValue) => !currentValue)}
          aria-pressed={teacherModeEnabled}
        >
          <span className="teacher-mode-toggle__text">
            <span className="teacher-mode-toggle__label">
              {teacherModeEnabled ? 'Click to go back to Truco' : '🧑‍🏫 TEACHER MODE'}
            </span>
            <span className="teacher-mode-toggle__hint">
              {teacherModeEnabled ? '' : 'Click if a pesky teacher lurking behind you'}
            </span>
          </span>
        </button>
      </div>
    </SocketProvider>
  );
}

export default App;
