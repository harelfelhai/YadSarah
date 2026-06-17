import { useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';

/**
 * Yad Sarah logo.
 *
 * Uses the OFFICIAL logo served from `public/yadsarah-logo.png` when present.
 * To install it: save the official logo image as
 *     src/Client/public/yadsarah-logo.png
 * (PNG or SVG; if SVG, set OFFICIAL_LOGO_SRC to '/yadsarah-logo.svg').
 *
 * Until that file exists, an original placeholder emblem (a care heart + medical
 * cross in the brand colors — NOT the official trademark) is shown as a fallback.
 */

const OFFICIAL_LOGO_SRC = '/yadsarah-logo.png';

interface LogoProps {
  size?: number;          // base height in px (emblem height; official logo ≈ size×1.4)
  withText?: boolean;     // show the "יד שרה" wordmark (placeholder only)
  subtitle?: string;      // small line under the wordmark (placeholder only)
  color?: string;         // wordmark color (Mantine color key, placeholder only)
}

function Emblem({ size = 36 }: { size?: number }) {
  const w = size * (32 / 29.6);
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 32 29.6"
      role="img"
      aria-label="יד שרה"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="ys-heart" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2e5a7d" />
          <stop offset="1" stopColor="#b23a3a" />
        </linearGradient>
      </defs>
      <path
        d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4
           c0,9.4,9.5,11.9,16,21.2c6.1-9.3,16-12.1,16-21.2C32,3.8,28.2,0,23.6,0z"
        fill="url(#ys-heart)"
      />
      <rect x="14.7" y="6" width="2.6" height="10" rx="1.3" fill="#fff" />
      <rect x="11" y="9.7" width="10" height="2.6" rx="1.3" fill="#fff" />
    </svg>
  );
}

export default function Logo({ size = 36, withText = true, subtitle, color = 'var(--ink)' }: LogoProps) {
  const [officialFailed, setOfficialFailed] = useState(false);
  const onDark = color === 'white' || color === '#fff' || color === '#ffffff';

  // Official logo (already includes the wordmark + subtitle)
  if (!officialFailed) {
    return (
      <img
        src={OFFICIAL_LOGO_SRC}
        alt="יד שרה"
        onError={() => setOfficialFailed(true)}
        style={{ height: size * 1.4, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
      />
    );
  }

  // Fallback placeholder: emblem + wordmark
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Emblem size={size} />
      {withText && (
        <Stack gap={0}>
          <Text
            fw={800}
            lh={1.05}
            style={{
              fontSize: size * 0.62,
              letterSpacing: '-0.5px',
              fontFamily: '"Frank Ruhl Libre", Georgia, serif',
              color: onDark ? '#fff' : color,
            }}
          >
            יד שרה
          </Text>
          {subtitle && (
            <Text fw={600} lh={1.1} style={{ fontSize: size * 0.32, color: onDark ? 'var(--mantine-color-slate-3)' : 'var(--accent)' }}>
              {subtitle}
            </Text>
          )}
        </Stack>
      )}
    </Group>
  );
}
