import React, { memo } from "react";

const Toast = memo(({ message, visible }) => {
  if (!visible) return null;

  return (
    <div style={styles.toastContainer} role="status" aria-live="polite">
      <div style={styles.toast}>{message}</div>
    </div>
  );
});

const styles = {
  toastContainer: {
    position: "fixed",
    top: "70px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2000,
    // 手机上长句要能换行，不能撑出屏幕
    maxWidth: "calc(100vw - 32px)",
    pointerEvents: "none",
  },
  toast: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    color: "white",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "var(--font-sans)",
    fontWeight: "500",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
    animation: "fadeInOut 3s ease-in-out",
    textAlign: "center",
    backdropFilter: "blur(8px)",
  },
};

Toast.displayName = "Toast";

export default Toast;
