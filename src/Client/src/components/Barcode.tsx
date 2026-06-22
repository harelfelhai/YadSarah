import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import JsBarcode from 'jsbarcode';

interface Props {
  /** The value to encode (e.g. the visit id GUID). */
  value: string;
  /** Rendered CSS height of the barcode (the bars). Width always fills the container. */
  height?: string;
  style?: CSSProperties;
}

/**
 * A Code128 (1D) barcode rendered as inline SVG.
 *
 * SVG — not canvas — on purpose: StickerPrint copies `printRef.innerHTML` into a hidden
 * print iframe, and SVG content survives that serialization while canvas pixels would not.
 * `useLayoutEffect` (not useEffect) guarantees the bars are drawn before the browser paints,
 * so the SVG is already populated when StickerPrint's auto-print snapshot runs.
 *
 * After JsBarcode draws, we convert the fixed width/height it set into a `viewBox` and
 * `preserveAspectRatio="none"`, so the barcode fills the sticker width at a fixed height
 * (uniform horizontal stretch is fine for Code128) regardless of the sticker's size.
 */
export default function Barcode({ value, height = '12mm', style }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    svg.innerHTML = '';
    JsBarcode(svg, value, {
      format: 'CODE128',
      width: 2,        // intrinsic module width (resolution); final size is CSS-driven
      height: 100,
      displayValue: false,
      margin: 0,
    });
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    if (w && h) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'none');
    }
  }, [value]);

  return (
    <svg
      ref={ref}
      style={{ width: '100%', height, display: 'block', ...style }}
    />
  );
}
