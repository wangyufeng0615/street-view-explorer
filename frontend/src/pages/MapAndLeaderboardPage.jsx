import React, { useState, useEffect } from 'react';
import MapView from '../components/MapView';
import LeaderboardList from '../components/LeaderboardList';
import { getMapLikes, getLeaderboard } from '../services/api';

export default function MapAndLeaderboardPage() {
    const [mapData, setMapData] = useState([]);
    const [leaderboardData, setLeaderboardData] = useState([]);

    useEffect(() => {
        // 获取地图数据
        (async () => {
            const mapResp = await getMapLikes();
            if (mapResp.success) {
                setMapData(mapResp.data);
            }
        })();

        // 获取排行榜数据
        (async () => {
            const leaderResp = await getLeaderboard();
            if (leaderResp.success) {
                setLeaderboardData(leaderResp.data);
            }
        })();
    }, []);

    return (
        <div>
            <h2>全球热门街景</h2>
            <div style={{ display: 'flex', gap: '20px' }}>
                <div style={{ flex: 1 }}>
                    <h3>地图分布</h3>
                    <MapView locations={mapData} />
                </div>
                <div style={{ flex: 1 }}>
                    <h3>点赞排行榜</h3>
                    <LeaderboardList data={leaderboardData} />
                </div>
            </div>
        </div>
    );
} 