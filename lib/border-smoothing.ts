// Light, inward-only anti-aliasing of convex staircase pixels. Never blur RGB,
// grow the silhouette, resample, or soften axis-aligned borders/square corners.
export function smoothBorderPixels(data: Uint8ClampedArray, width: number, height: number) {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[y * width + x];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (at(x, y) < 240) continue;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      if (at(x + sx, y) !== 0 || at(x, y + sy) !== 0) continue;
      if (at(x - sx, y) < 240 || at(x, y - sy) < 240 || at(x - sx, y - sy) < 240) continue;
      // A true square corner has no continuing diagonal on either side.
      if (at(x - sx, y + sy) < 240 && at(x + sx, y - sy) < 240) continue;
      data[(y * width + x) * 4 + 3] = Math.round(at(x, y) * 0.75);
    }
  }
}

