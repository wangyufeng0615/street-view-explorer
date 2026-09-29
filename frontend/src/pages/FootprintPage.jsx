import React, { lazy, Suspense, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { preloadGoogleMaps } from "../utils/googleMaps";
import "../styles/animations.css";

const FootprintMap = lazy(() => import("../components/FootprintMap"));

// 足迹地图组件加载前先垫一层同样的全屏黑底，避免闪出白底
const blankOverlayStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 2000,
  backgroundColor: "#000",
};

// 从首页打开时作为浮层叠在首页上，关闭即后退回首页；
// 直接访问时只渲染足迹地图，关闭时进入首页并保留地址参数
export default function FootprintPage({ isOverlay = false }) {
  const navigate = useNavigate();
  const { search, hash } = useLocation();

  // 地图脚本和足迹接口并行加载；只加载脚本，不创建地图
  useEffect(() => {
    preloadGoogleMaps();
  }, []);

  const handleClose = useCallback(() => {
    if (isOverlay) {
      navigate(-1);
      return;
    }
    navigate({ pathname: "/", search, hash });
  }, [isOverlay, navigate, search, hash]);

  return (
    <Suspense fallback={<div style={blankOverlayStyle} />}>
      <FootprintMap onClose={handleClose} />
    </Suspense>
  );
}
