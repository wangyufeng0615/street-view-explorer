import React from "react";

function Glyph({ children, size = 18, strokeWidth = 1.8 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const RouteGlyph = (props) => (
  <Glyph {...props}>
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
  </Glyph>
);

export const CompassGlyph = (props) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path
      d="M15.8 8.2l-2.4 5.2-5.2 2.4 2.4-5.2z"
      fill="currentColor"
      stroke="none"
    />
  </Glyph>
);

export const ExpandGlyph = (props) => (
  <Glyph {...props}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Glyph>
);

export const CloseGlyph = (props) => (
  <Glyph {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Glyph>
);

export const MenuGlyph = (props) => (
  <Glyph {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Glyph>
);

export const InfoGlyph = (props) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Glyph>
);

export const CheckGlyph = (props) => (
  <Glyph {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Glyph>
);
