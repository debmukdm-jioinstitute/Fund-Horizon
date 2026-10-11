import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0B2545 0%, #06172C 100%)",
          borderRadius: "8px",
          border: "1px solid rgba(19, 168, 158, 0.4)",
          color: "#13A89E",
          fontFamily: "system-ui, sans-serif",
          fontWeight: 900,
          fontSize: "14px",
          letterSpacing: "-0.05em",
        }}
      >
        <span>FH</span>
        <div
          style={{
            position: "absolute",
            top: "2px",
            right: "2px",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "#2DD4BF",
            boxShadow: "0 0 6px #13A89E",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
