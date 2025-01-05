import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StreetView from '../components/StreetView';
import PreviewMap from '../components/PreviewMap';
import GlobalMap from '../components/GlobalMap';
import ExplorationPreference from '../components/ExplorationPreference';
import { getRandomLocation, getLocationDescription } from '../services/api';

const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 2,
    pointerEvents: 'none'
};

const sidebarStyle = {
    position: 'absolute',
    right: '20px',
    top: '20px',
    width: '300px',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '20px',
    borderRadius: '15px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    pointerEvents: 'auto',
    maxHeight: 'calc(100vh - 40px)',
    overflowY: 'auto'
};

const buttonStyle = {
    padding: '10px 20px',
    fontSize: '16px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    width: '100%'
};

const disabledButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#cccccc',
    cursor: 'not-allowed'
};

const aiDescriptionStyle = {
    backgroundColor: 'rgba(240, 242, 245, 0.8)',
    padding: '15px',
    borderRadius: '10px',
    marginBottom: '20px',
    position: 'relative',
    border: '1px solid rgba(0, 0, 0, 0.05)'
};

const aiIconStyle = {
    position: 'absolute',
    top: '-10px',
    left: '10px',
    backgroundColor: '#007AFF',
    color: 'white',
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 'bold'
};

const addressStyle = {
    fontSize: '15px',
    color: '#333',
    marginBottom: '20px',
    lineHeight: '1.4'
};

const favoriteButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#FF9500',
    marginBottom: '10px'
};

export default function HomePage() {
    const navigate = useNavigate();
    const { search } = useLocation();
    const [location, setLocation] = useState(null);
    const [description, setDescription] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingDesc, setIsLoadingDesc] = useState(false);
    const [heading, setHeading] = useState(0);
    const isInitialLoad = useRef(true);
    const loadingRef = useRef(false);

    useEffect(() => {
        const params = new URLSearchParams(search);
        const lat = params.get('lat');
        const lng = params.get('lng');
        const panoId = params.get('pano');

        if (lat && lng && panoId && isInitialLoad.current) {
            isInitialLoad.current = false;
            setLocation({
                latitude: parseFloat(lat),
                longitude: parseFloat(lng),
                panoId: panoId
            });
            loadLocationDescription(panoId);
        }
    }, [search]);

    useEffect(() => {
        if (location && !isLoading) {
            const params = new URLSearchParams();
            params.set('lat', location.latitude.toString());
            params.set('lng', location.longitude.toString());
            if (location.panoId) {
                params.set('pano', location.panoId);
            }
            navigate(`?${params.toString()}`, { replace: true });
        }
    }, [location, isLoading, navigate]);

    const loadLocationDescription = async (panoId) => {
        if (!panoId || isLoadingDesc) return;
        
        try {
            setIsLoadingDesc(true);
            const resp = await getLocationDescription(panoId);
            if (resp.success) {
                setDescription(resp.data);
            }
        } catch (err) {
            console.error('获取位置描述出错:', err);
        } finally {
            setIsLoadingDesc(false);
        }
    };

    const handleFavorite = () => {
        if (!location) return;
        
        const currentUrl = window.location.href;
        
        if (window.sidebar && window.sidebar.addPanel) {
            window.sidebar.addPanel(location.formatted_address || '街景位置', currentUrl, '');
        } else if (window.external && window.external.AddFavorite) {
            window.external.AddFavorite(currentUrl, location.formatted_address || '街景位置');
        } else {
            alert('请按 ' + (navigator.userAgent.toLowerCase().indexOf('mac') != -1 ? 'Command/Cmd' : 'CTRL') + ' + D 将此页面添加到收藏夹。');
        }
    };

    const loadRandomLocation = async () => {
        if (loadingRef.current) return;
        
        try {
            loadingRef.current = true;
            setIsLoading(true);
            setDescription(null);

            const resp = await getRandomLocation();
            if (resp.success) {
                setLocation(resp.data);
                setDescription(resp.description);
                setError(null);
                if (!resp.description) {
                    loadLocationDescription(resp.data.panoId);
                }
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

    useEffect(() => {
        if (isInitialLoad.current) {
            isInitialLoad.current = false;
            loadRandomLocation();
        }
        return () => {
            loadingRef.current = false;
        };
    }, []);

    if (error) {
        return (
            <div style={{ 
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: 'white',
                padding: '20px',
                borderRadius: '10px',
                boxShadow: '0 0 20px rgba(0, 0, 0, 0.1)',
                zIndex: 3
            }}>
                <h2>出错了</h2>
                <p>{error}</p>
                <button onClick={loadRandomLocation} style={buttonStyle}>
                    重试
                </button>
            </div>
        );
    }

    if (!location) {
        return (
            <div style={{ 
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: 'white',
                textShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
                zIndex: 3
            }}>
                正在加载街景...
            </div>
        );
    }

    return (
        <>
            <StreetView 
                latitude={location.latitude} 
                longitude={location.longitude} 
                onPovChanged={setHeading}
            />
            
            <div style={overlayStyle}>
                <div style={sidebarStyle}>
                    <div style={{ marginBottom: '20px' }}>
                        <GlobalMap latitude={location.latitude} longitude={location.longitude} />
                        <PreviewMap 
                            latitude={location.latitude} 
                            longitude={location.longitude} 
                            heading={heading}
                        />
                    </div>

                    <div style={addressStyle}>
                        {location.formatted_address}
                    </div>

                    <div style={aiDescriptionStyle}>
                        <div style={aiIconStyle}>AI</div>
                        {isLoadingDesc ? (
                            <p style={{ margin: '10px 0 0 0' }}>正在生成位置描述...</p>
                        ) : description ? (
                            <p style={{ margin: '10px 0 0 0' }}>{description}</p>
                        ) : (
                            <p style={{ margin: '10px 0 0 0' }}>正在等待 AI 描述...</p>
                        )}
                    </div>

                    <ExplorationPreference />

                    <button 
                        onClick={handleFavorite}
                        style={favoriteButtonStyle}
                    >
                        收藏此位置
                    </button>

                    <button 
                        onClick={loadRandomLocation} 
                        disabled={isLoading}
                        style={isLoading ? disabledButtonStyle : buttonStyle}
                    >
                        {isLoading ? '加载中...' : '换一个'}
                    </button>
                </div>
            </div>
        </>
    );
}
