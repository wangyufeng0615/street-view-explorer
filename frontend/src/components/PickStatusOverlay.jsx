import React from "react";

// 地图选点时浮在底部的状态提示（选中、失败、进行中）
export default function PickStatusOverlay({ status, message }) {
  if (!message || status === "idle") {
    return null;
  }

  const isError = status === "error";
  const isSuccess = status === "success";

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: "10px",
        transform: "translateX(-50%)",
        maxWidth: "calc(100% - 24px)",
        padding: "6px 10px",
        borderRadius: "999px",
        background: isError
          ? "rgba(127, 29, 29, 0.9)"
          : isSuccess
            ? "rgba(20, 83, 45, 0.9)"
            : "rgba(15, 23, 42, 0.88)",
        color: "#fff",
        fontSize: "12px",
        lineHeight: 1.3,
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none",
        zIndex: 2,
        boxShadow: "0 8px 20px rgba(15, 23, 42, 0.25)",
      }}
    >
      {message}
    </div>
  );
}
