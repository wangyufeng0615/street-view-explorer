import { useEffect } from 'react';

export default function useKeyboardNavigation(loadRandomLocation, isLoading, loadingRef) {
    // 监听空格键
    useEffect(() => {
        const handleKeyPress = (event) => {
            // 如果当前焦点在输入框或文本框上，不触发空格键探索
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }
            
            if (event.code === 'Space' && !isLoading && !loadingRef.current) {
                event.preventDefault();
                loadRandomLocation();
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [isLoading, loadRandomLocation, loadingRef]);
} 