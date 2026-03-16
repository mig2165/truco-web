
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';
import { AdminDashboard } from './components/AdminDashboard';

function App() {
  return (
    <SocketProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </Router>
    </SocketProvider>
  );
}

export default App;
