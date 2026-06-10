import { useState } from "react";
import "./FilesPane.css";

interface Props {
  src: string;
  alt: string;
  size: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  const units = ["KiB", "MiB", "GiB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return v.toFixed(1) + " " + units[i];
}

// View-only image pane: checkerboard backdrop, fit-to-pane by default,
// click toggles 1:1 (scrollable when larger than the pane).
export function ImageView({ src, alt, size }: Props) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [actualSize, setActualSize] = useState(false);

  return (
    <div className="files-image">
      <div
        className="files-image-stage"
        style={{ cursor: actualSize ? "zoom-out" : "zoom-in" }}
        onClick={() => setActualSize((v) => !v)}
      >
        <img
          src={src}
          alt={alt}
          className={actualSize ? "files-image-img--natural" : "files-image-img--fit"}
          onLoad={(e) =>
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        />
      </div>
      <div className="files-image-footer">
        {natural
          ? `${natural.w} × ${natural.h} px · ${formatBytes(size)}`
          : formatBytes(size)}
      </div>
    </div>
  );
}
