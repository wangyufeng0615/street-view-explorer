import React, { useState, useEffect, useRef } from 'react';
import StreetView from '../components/StreetView';
import { getRandomLocation, likeLocation, getLocationDescription } from '../services/api';

// 测试用的坐标点
/*
const TEST_LOCATIONS = [
    {
        location_id: 'test_001',
        latitude: 35.6762,  // 东京涩谷十字路口
        longitude: 139.6503,
        likes: 0,
        description: "测试位置：东京涩谷十字路口"
    },
    {
        location_id: 'test_002',
        latitude: 48.8584,  // 巴黎埃菲尔铁塔
        longitude: 2.2945,
        likes: 0,
        description: "测试位置：巴黎埃菲尔铁塔"
    },
    {
        location_id: 'test_003',
        latitude: 40.7580,  // 纽约时代广场
        longitude: -73.9855,
        likes: 0,
        description: "测试位置：纽约时代广场"
    }
];
*/

export default function HomePage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [locationDesc, setLocationDesc] = useState('');
    const [isLoadingDesc, setIsLoadingDesc] = useState(false);
    const loadingRef = useRef(false);

    const loadRandomLocation = async () => {
        if (loadingRef.current) return;
        
        try {
            loadingRef.current = true;
            setIsLoading(true);
            const resp = await getRandomLocation();
            if (resp.success) {
                setData(resp.data);
                setError(null);
            } else {
                setError(resp.error || '加载失败');
            }
        } catch (err) {
            setError('网络请求失败');
            console.error(err);
        } finally {
            setIsLoading(false);
            loadingRef.current = false;
        }
    };

    const loadLocationDescription = async () => {
        if (!data || isLoadingDesc) return;
        try {
            setIsLoadingDesc(true);
            const resp = await getLocationDescription(data.location_id);
            if (resp.success) {
                setLocationDesc(resp.data.description);
            } else {
                console.error('获取位置描述失败:', resp.error);
            }
        } catch (err) {
            console.error('获取位置描述出错:', err);
        } finally {
            setIsLoadingDesc(false);
        }
    };

    useEffect(() => {
        loadRandomLocation();
        return () => {
            loadingRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (data?.location_id && !isLoadingDesc) {
            setLocationDesc(''); // 清空旧的位置描述
            loadLocationDescription();
        }
    }, [data?.location_id]);

    const handleLike = async () => {
        if (!data) return;
        try {
            const resp = await likeLocation(data.location_id);
            if (resp.success) {
                setData({ ...data, likes: resp.data.likes });
            } else {
                alert('点赞失败: ' + (resp.error || '未知错误'));
            }
        } catch (err) {
            alert('网络请求失败');
            console.error(err);
        }
    };

    const handleShare = () => {
        if (!data) return;
        const url = window.location.origin + `/?loc=${encodeURIComponent(data.location_id)}`;
        navigator.clipboard.writeText(url).then(() => {
            alert("链接已复制到剪贴板!");
        }).catch(() => {
            alert("复制失败,请手动复制: " + url);
        });
    };

    const handleRefresh = () => {
        if (!loadingRef.current) {
            loadRandomLocation();
        }
    };

    if (error) {
        return <div>
            <h2>出错了</h2>
            <p>{error}</p>
            <button onClick={handleRefresh}>重试</button>
        </div>;
    }

    if (isLoading || !data) {
        return <div>加载中...</div>;
    }

    return (
        <div>
            <h2>随机街景</h2>
            <StreetView latitude={data.latitude} longitude={data.longitude} />
            <div>
                <h3>位置描述：</h3>
                {isLoadingDesc ? (
                    <p>正在获取位置描述...</p>
                ) : locationDesc ? (
                    <p>{locationDesc}</p>
                ) : (
                    <button onClick={loadLocationDescription}>获取位置描述</button>
                )}
            </div>
            <p>点赞数: {data.likes}</p>
            <button onClick={handleLike}>点赞</button>
            <button onClick={handleShare}>分享</button>
            <button onClick={handleRefresh}>换一个</button>
        </div>
    );
}
