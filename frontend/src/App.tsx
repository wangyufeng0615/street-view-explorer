import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import HomePage from './pages/HomePage';
import MapAndLeaderboardPage from './pages/MapAndLeaderboardPage';

const App: React.FC = () => {
    return (
        <Router>
            <div style={{ padding: '10px' }}>
                <h1>街景浏览器</h1>
                <nav style={{ marginBottom: '10px' }}>
                    <Link to="/">首页</Link> | <Link to="/map">地图与排行榜</Link>
                </nav>
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/map" element={<MapAndLeaderboardPage />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App; 