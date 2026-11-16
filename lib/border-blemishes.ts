// Conservative, local pixel cleanup. Never changes colour, fills holes, or
// straightens intentional curves. Only trim tiny nubs off an otherwise flat edge.
export function borderBlemishes(alpha: Uint8ClampedArray, width: number, height: number,
  widthMm: number, heightMm: number) {
  const marks = new Uint8Array(alpha.length);
  const at = (x: number, y: number) => alpha[y * width + x];
  if (widthMm / width > 0.8 || heightMm / height > 0.8) return marks;
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      if (at(x, y) < 36) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const tx = dy, ty = -dx;
        let flat = true;
        for (let t = -3; t <= 3; t++) {
          // Seven-pixel flat edge backed by another solid row, empty outside.
          if (at(x + dx + tx * t, y + dy + ty * t) < 220 ||
              at(x + dx * 2 + tx * t, y + dy * 2 + ty * t) < 220 ||
              at(x - dx + tx * t, y - dy + ty * t) > 12 ||
              (t !== 0 && at(x + tx * t, y + ty * t) > 12)) { flat = false; break; }
        }
        // A curved tip also has a short solid row beneath it. Preserve it when
        // the two supporting rows widen at different rates on either side.
        if (flat) for (const sign of [-1, 1]) {
          for (let t = 4; t <= 32; t++) {
            const ax = x + dx + tx * t * sign, ay = y + dy + ty * t * sign;
            const bx = x + 2 * dx + tx * t * sign, by = y + 2 * dy + ty * t * sign;
            if (Math.min(ax, bx) < 0 || Math.max(ax, bx) >= width || Math.min(ay, by) < 0 || Math.max(ay, by) >= height) break;
            const a = at(ax, ay) >= 220, b = at(bx, by) >= 220;
            if (a !== b) { flat = false; break; }
            if (!a && !b) break;
          }
        }
        if (flat) { marks[y * width + x] = 1; break; }
      }
    }
  }
  return marks;
}
