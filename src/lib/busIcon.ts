export function createBusCanvas(
  lineNumber: string,
  bearing: number,
  isToward?: boolean,
  speed?: number
): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;

  // Direction arrow (rotated by bearing)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((bearing * Math.PI) / 180);

  const arrowColor =
    isToward === true
      ? "#16a34a"
      : isToward === false
        ? "#dc2626"
        : "#475569";

  ctx.fillStyle = arrowColor;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.lineTo(7, -17);
  ctx.lineTo(-7, -17);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Measure text to size the body
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  const textWidth = ctx.measureText(lineNumber).width;
  const bodyWidth = Math.max(28, textWidth + 14);
  const bodyHeight = 22;
  const bx = cx - bodyWidth / 2;
  const by = cy - bodyHeight / 2;

  // Bus body shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 2, bodyWidth, bodyHeight, 5);
  ctx.fill();

  // Bus body
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(bx, by, bodyWidth, bodyHeight, 5);
  ctx.fill();

  // Border
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Line number
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(lineNumber, cx, cy + 1);

  // Status indicator dot (top-right of bus body) based on speed
  if (speed !== undefined) {
    const dotX = bx + bodyWidth - 2;
    const dotY = by + 2;
    ctx.fillStyle = speed > 0.5 ? "#16a34a" : "#dc2626"; // green=moving, red=stopped
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return canvas;
}

export function bearingTowardStop(
  vLat: number,
  vLon: number,
  vBearing: number,
  sLat: number,
  sLon: number
): boolean {
  const dLon = ((sLon - vLon) * Math.PI) / 180;
  const lat1 = (vLat * Math.PI) / 180;
  const lat2 = (sLat * Math.PI) / 180;

  const x = Math.sin(dLon) * Math.cos(lat2);
  const y =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingToStop = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;

  const diff = Math.abs(bearingToStop - vBearing);
  const normalizedDiff = diff > 180 ? 360 - diff : diff;

  return normalizedDiff < 90;
}
