import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const emblemPath = path.join(process.cwd(), "public/images/logo-emblem.png");
  const base64 = fs.readFileSync(emblemPath).toString("base64");
  const dataUri = `data:image/png;base64,${base64}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FFFFFF",
          borderRadius: "6px",
          padding: "2px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUri} alt="" style={{ width: "28px", height: "auto" }} />
      </div>
    ),
    { ...size }
  );
}
