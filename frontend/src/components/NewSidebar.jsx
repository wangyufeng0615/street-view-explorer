import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import GlobalMap from './GlobalMap';
import PreviewMap from './PreviewMap';
import AiDescription from './AiDescription';
import '../styles/NewSidebar.css';

const NewSidebar = memo(function NewSidebar({
    location,
    heading,
    description,
    isLoadingDesc,
    descError,
    descRetries,
    onRetryDescription
}) {
    const { t } = useTranslation();

    return (
        <div style={styles.sidebar} className="new-sidebar">
            <div style={styles.scrollContainer} className="sidebar-scroll">
                {/* 世界地图区域 */}
                <div style={styles.section}>
                    <div style={styles.mapContainer}>
                        {location ? (
                            <GlobalMap
                                latitude={location.latitude}
                                longitude={location.longitude}
                            />
                        ) : (
                            <div style={styles.mapPlaceholder}>
                                {t('loading_location')}
                            </div>
                        )}
                    </div>
                </div>

                {/* 局部地图区域 */}
                <div style={styles.section}>
                    <div style={styles.mapContainer}>
                        {location && (
                            <PreviewMap
                                latitude={location.latitude}
                                longitude={location.longitude}
                                heading={heading}
                            />
                        )}
                    </div>
                </div>

                {/* AI解读区域 */}
                <div style={styles.section}>
                    <div style={styles.aiContainer}>
                        <AiDescription
                            isLoading={isLoadingDesc}
                            error={descError}
                            description={description}
                            retries={descRetries}
                            panoId={location?.pano_id}
                            onRetry={onRetryDescription}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});

const styles = {
    sidebar: {
        position: 'fixed',
        top: '50px', // 顶栏高度
        right: 0,
        bottom: 0,
        width: '320px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderLeft: '1px solid rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 900,
        boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.1)',
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
    },
    scrollContainer: {
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '16px'
    },
    section: {
        marginBottom: '16px'
    },
    mapContainer: {
        height: '200px',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        backgroundColor: '#f8f9fa'
    },
    aiContainer: {
        minHeight: '120px'
    },
    mapPlaceholder: {
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
        fontSize: '14px',
        backgroundColor: '#f8f9fa'
    }
};

export default NewSidebar; 