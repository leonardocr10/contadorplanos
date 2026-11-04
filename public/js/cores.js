// Contas de cor usadas pela página da proposta.
export function hex2rgb(h) {
  h = String(h || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
export const toHex = (a) => "#" + a.map((v) => v.toString(16).padStart(2, "0")).join("");
export const lumRGB = (a) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]);
};
