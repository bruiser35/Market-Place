// Copied verbatim from PTP production source 51b2cf0301fc1d52f0ae1bb8f74ee508c79a8246.
// Keep repairArtwork body identical; browser worker interfaces are supplied by the adapter.
import {borderBlemishes} from "./border-blemishes";
// Rollback point: change SMALL_ARTWORK_CLEANUP_MAX_MM back to 40 if the
// outline-preserving small-artwork profile needs to be narrowed again.
const SMALL_ARTWORK_CLEANUP_MAX_MM = 60;
const SMALL_ARTWORK_BLEMISH_MAX_MM = 1.25;
const SMALL_ARTWORK_HALO_ALPHA_MAX = 96;
const STANDARD_ARTWORK_HALO_ALPHA_MAX = 160;

export async function repairArtwork(source: string, printedWidthMm: number, printedHeightMm: number) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("The uploaded image could not be analysed."));
    next.src = source;
  });
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  const original = new Uint8ClampedArray(pixels.data);
  const { alpha, haze, specks, edges } = cleanupArtworkPixels(pixels.data, width, height, printedWidthMm, printedHeightMm);
  context.putImageData(pixels, 0, 0);
  const repaired = canvas.toDataURL("image/png");
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const overlayContext = overlayCanvas.getContext("2d");
  if (!overlayContext) throw new Error("Repair highlighting is unavailable in this browser.");
  const overlay = overlayContext.createImageData(width, height);
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    if (alpha[pixel] !== pixels.data[pixel * 4 + 3]) {
      const offset = pixel * 4;
      overlay.data[offset] = 255;
      overlay.data[offset + 1] = 28;
      overlay.data[offset + 2] = 28;
      overlay.data[offset + 3] = 220;
    }
  }
  overlayContext.putImageData(overlay, 0, 0);
  const highlightedCanvas = document.createElement("canvas");
  highlightedCanvas.width = width;
  highlightedCanvas.height = height;
  const highlightedContext = highlightedCanvas.getContext("2d");
  if (!highlightedContext) throw new Error("Repair highlighting is unavailable in this browser.");
  const originalImageData = new ImageData(original, width, height);
  highlightedContext.putImageData(originalImageData, 0, 0);
  highlightedContext.drawImage(overlayCanvas, 0, 0);
  return { repaired, highlighted: highlightedCanvas.toDataURL("image/png"), haze, specks, edges };
}

export function cleanupArtworkPixels(data: Uint8ClampedArray, width: number, height: number, printedWidthMm: number, printedHeightMm: number) {
  const alpha = new Uint8ClampedArray(width * height);
  for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = data[pixel * 4 + 3];
  let haze = 0;
  let specks = 0;
  let edges = 0;
  const smallArtwork = printedWidthMm <= SMALL_ARTWORK_CLEANUP_MAX_MM && printedHeightMm <= SMALL_ARTWORK_CLEANUP_MAX_MM;
  const removableSmallSpecks = new Set<number>();
  {
    type Component = { pixels: number[]; left: number; right: number; top: number; bottom: number };
    const visited = new Uint8Array(width * height);
    const components: Component[] = [];
    const queue: number[] = [];
    for (let start = 0; start < alpha.length; start++) {
      if (visited[start] || alpha[start] < 36) continue;
      const component: Component = { pixels: [], left: width, right: 0, top: height, bottom: 0 };
      queue.length = 0;
      queue.push(start);
      visited[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const pixel = queue[head], x = pixel % width, y = Math.floor(pixel / width);
        component.pixels.push(pixel);
        component.left = Math.min(component.left, x); component.right = Math.max(component.right, x);
        component.top = Math.min(component.top, y); component.bottom = Math.max(component.bottom, y);
        for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
            const next = ny * width + nx;
            if (!visited[next] && alpha[next] >= 36) { visited[next] = 1; queue.push(next); }
          }
        }
      }
      components.push(component);
    }
    const main = components.reduce<Component | null>((largest, component) => !largest || component.pixels.length > largest.pixels.length ? component : largest, null);
    const xMm = printedWidthMm / width, yMm = printedHeightMm / height;
    const gapMm = (a: Component, b: Component) => {
      const gapX = Math.max(0, Math.max(a.left - b.right - 1, b.left - a.right - 1)) * xMm;
      const gapY = Math.max(0, Math.max(a.top - b.bottom - 1, b.top - a.bottom - 1)) * yMm;
      return Math.hypot(gapX, gapY);
    };
    for (const component of components) {
      if (component === main) continue;
      const componentWidthMm = (component.right - component.left + 1) * xMm;
      const componentHeightMm = (component.bottom - component.top + 1) * yMm;
      // Use physical size and separation, not colour, to find isolated marks.
      // Nearby letter dots, punctuation and enclosed highlights are retained.
      const blemishLimitMm = smallArtwork ? SMALL_ARTWORK_BLEMISH_MAX_MM : 0.8;
      const isSubTolerance = componentWidthMm < blemishLimitMm && componentHeightMm < blemishLimitMm;
      if (!isSubTolerance) continue;
      const nearestMeaningfulDetail = components.reduce((nearest, other) => {
        if (other === component || other.pixels.length <= component.pixels.length) return nearest;
        return Math.min(nearest, gapMm(component, other));
      }, Number.POSITIVE_INFINITY);
      // Only detached sub-tolerance marks are removed. Connected outlines and
      // nearby details such as punctuation, eye highlights and letter dots stay.
      if (isSubTolerance && nearestMeaningfulDetail > blemishLimitMm) {
        component.pixels.forEach((pixel) => removableSmallSpecks.add(pixel));
      }
    }
  }
  const borderMarks = borderBlemishes(alpha, width, height, printedWidthMm, printedHeightMm);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const before = alpha[pixel];
      if (!before) {
        data[offset] = data[offset + 1] = data[offset + 2] = 0;
        continue;
      }
      let after = before;
      if (removableSmallSpecks.has(pixel)) {
        after = 0;
        specks++;
      } else if (borderMarks[pixel]) {
        after = 0;
        edges++;
      } else if (before < (smallArtwork ? SMALL_ARTWORK_HALO_ALPHA_MAX : STANDARD_ARTWORK_HALO_ALPHA_MAX)) {
        // One-way cleanup: discard faint halo pixels but never increase alpha.
        // This sharpens fuzzy outer edges without filling narrow transparent
        // letter gaps, outline channels, counters or garment cut-throughs.
        after = 0;
        haze++;
      } else {
        // Preserve the source alpha exactly for every retained component.
        // Quantising anti-aliased edges can expand colour into narrow clear
        // channels, joining letters, outlines and intentional cut-throughs.
        after = before;
      }
      data[offset + 3] = after;
      if (!after) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }
  return { alpha, haze, specks, edges };
}

