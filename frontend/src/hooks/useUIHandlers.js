import { useState, useRef, useCallback, useEffect } from 'react';

export default function useUIHandlers() {
    const [heading, setHeading] = useState(0);
    const [scale, setScale] = useState(1);
    
    // Refs
    const sidebarRef = useRef(null);
    const contentRef = useRef(null);
    
    // 处理复制邮箱
    const handleCopyEmail = useCallback(() => {
        const email = 'alanwang424@gmail.com';
        navigator.clipboard.writeText(email).then(() => {
            // 可以添加一个复制成功的提示，但为了保持简洁，这里省略
        }).catch(console.error);
    }, []);
    
    // 处理调整大小
    const handleResize = useCallback(() => {
        if (sidebarRef.current && contentRef.current) {
            // 给一个小延时确保DOM已经完全更新
            setTimeout(() => {
                const wrapperHeight = window.innerHeight - 40; // 上下各20px的可用空间
                const contentHeight = contentRef.current.offsetHeight;
                const padding = 24; // 上下padding各12px
                
                if (contentHeight + padding > wrapperHeight) {
                    const scale = Math.min(0.85, (wrapperHeight - padding) / contentHeight);
                    setScale(Math.max(0.6, scale)); // 设置最小缩放比例为0.6
                } else {
                    setScale(1);
                }
            }, 0);
        }
    }, []);
    
    // 添加窗口大小变化监听
    useEffect(() => {
        const handleWindowResize = () => {
            requestAnimationFrame(handleResize);
        };

        window.addEventListener('resize', handleWindowResize);

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(handleResize);
        });

        if (contentRef.current) {
            resizeObserver.observe(contentRef.current);
        }

        // 初始化时执行一次
        handleResize();

        return () => {
            window.removeEventListener('resize', handleWindowResize);
            resizeObserver.disconnect();
        };
    }, [handleResize]);
    
    return {
        heading,
        setHeading,
        scale,
        setScale,
        handleResize,
        handleCopyEmail,
        sidebarRef,
        contentRef
    };
} 