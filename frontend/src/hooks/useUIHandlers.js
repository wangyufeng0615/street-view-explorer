import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export default function useUIHandlers() {
    const { t } = useTranslation();
    const [heading, setHeading] = useState(0);
    const [scale, setScale] = useState(1);
    const [toastMessage, setToastMessage] = useState('');
    const [showToast, setShowToast] = useState(false);
    
    // Refs
    const sidebarRef = useRef(null);
    const contentRef = useRef(null);
    
    // 显示Toast消息
    const showToastMessage = useCallback((message) => {
        setToastMessage(message);
        setShowToast(true);
        setTimeout(() => {
            setShowToast(false);
        }, 3000);
    }, []);
    
    // 处理复制邮箱
    const handleCopyEmail = useCallback(() => {
        const email = 'alanwang424@gmail.com';
        
        // 尝试使用现代API复制
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(email).then(() => {
                showToastMessage(`📧 ${t('message.emailCopied')}: ${email}`);
            }).catch(() => {
                // 降级到传统方法
                fallbackCopyTextToClipboard(email);
            });
        } else {
            // 降级到传统方法
            fallbackCopyTextToClipboard(email);
        }
    }, [showToastMessage, t]);
    
    // 降级复制方法
    const fallbackCopyTextToClipboard = (text) => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        // 避免在iOS上出现缩放
        textArea.style.position = "fixed";
        textArea.style.top = "-9999px";
        textArea.style.left = "-9999px";
        textArea.style.width = "2em";
        textArea.style.height = "2em";
        textArea.style.padding = "0";
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showToastMessage(`📧 ${t('message.emailCopied')}: ${text}`);
            } else {
                showToastMessage(`📧 ${t('message.pleaseManualCopyEmail')}: ${text}`);
            }
        } catch (err) {
            showToastMessage(`📧 ${t('message.pleaseManualCopyEmail')}: ${text}`);
        }
        
        document.body.removeChild(textArea);
    };
    
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
        contentRef,
        toastMessage,
        showToast
    };
} 