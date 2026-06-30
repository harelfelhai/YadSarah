import { createTheme } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

// ─── Yad Sarah · clinical-instrument identity ────────────────────────────────
// Muted, technical, low-chroma. Brand blue/red survive but desaturated into a
// steel/graphite system; red is reserved for urgency + the mark, never decoration.
// Squared corners (near-zero radius) for a precise, console-like feel.

// Steel — primary/interactive (muted brand blue)
const steel: MantineColorsTuple = [
  '#eef3f7', '#d8e3ec', '#b0c4d6', '#86a3bf', '#6589ac',
  '#4f78a0', '#2e5a7d', '#28506f', '#21425c', '#18344a',
];

// Brick — urgency + brand mark only (muted brand red)
const brick: MantineColorsTuple = [
  '#fbeded', '#f2d4d4', '#e3a9a9', '#d57c7c', '#c95757',
  '#c24242', '#b23a3a', '#9a3030', '#832828', '#6c1f1f',
];

// Slate — cool neutral (text, borders, "discharged")
const slate: MantineColorsTuple = [
  '#f3f5f7', '#e7ebee', '#d2d9df', '#b3bec7', '#91a0ac',
  '#76858f', '#5b6b7a', '#4a5660', '#3b444d', '#2b3138',
];

// Ochre — "called" (muted amber, attention)
const ochre: MantineColorsTuple = [
  '#faf2e3', '#efdcbb', '#e0c084', '#d2a44f', '#c69130',
  '#b9842a', '#a9761f', '#874e1a', '#5f4114', '#422c0d',
];

// Moss — "in treatment" (muted green)
const moss: MantineColorsTuple = [
  '#eaf4ee', '#cfe6d8', '#a3cdb4', '#74b18d', '#4f9a6f',
  '#38895c', '#2f6b4f', '#285c44', '#214b38', '#18392a',
];

// Pine — "finished treatment" (muted slate-teal)
const pine: MantineColorsTuple = [
  '#e9f3f1', '#cce5e0', '#9ccabf', '#69ad9f', '#449384',
  '#308376', '#37706b', '#2c5a56', '#214744', '#173432',
];

export const theme = createTheme({
  primaryColor: 'steel',
  primaryShade: { light: 6, dark: 5 },
  colors: { steel, brick, slate, ochre, moss, pine },
  white: '#ffffff',
  black: '#1c2a39', // charcoal-navy ink (not pure black)

  // Squarer than Mantine defaults — a precise, technical chassis.
  radius: { xs: '2px', sm: '3px', md: '4px', lg: '6px', xl: '10px' },
  defaultRadius: 'xs',

  fontFamily: 'Assistant, "Segoe UI", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  // Nudge the SMALL steps up a touch for legibility (xs 12→13, sm 14→15) without growing
  // md/lg/xl — so dense layouts (tables/badges) shift only ~1px. md+ stay at Mantine defaults.
  fontSizes: {
    xs: '0.8125rem', // 13px (was 12)
    sm: '0.9375rem', // 15px (was 14)
    md: '1rem',      // 16px
    lg: '1.125rem',  // 18px
    xl: '1.25rem',   // 20px
  },
  headings: {
    fontFamily: '"Frank Ruhl Libre", Georgia, serif',
    fontWeight: '700',
  },

  components: {
    Button: { defaultProps: { size: 'sm', radius: 'xs' } },
    ActionIcon: { defaultProps: { radius: 'xs' } },
    TextInput: { defaultProps: { size: 'sm', radius: 'xs' } },
    PasswordInput: { defaultProps: { size: 'sm', radius: 'xs' } },
    NumberInput: { defaultProps: { size: 'sm', radius: 'xs' } },
    Select: { defaultProps: { size: 'sm', radius: 'xs' } },
    Autocomplete: { defaultProps: { size: 'sm', radius: 'xs' } },
    DateInput: { defaultProps: { size: 'sm', radius: 'xs' } },
    Textarea: { defaultProps: { radius: 'xs' } },
    Card: { defaultProps: { radius: 'xs' } },
    Paper: { defaultProps: { radius: 'xs' } },
    Modal: { defaultProps: { radius: 'xs' } },
    Badge: { defaultProps: { radius: 'xs' } },
    Table: {
      defaultProps: {
        striped: true,
        highlightOnHover: true,
        withTableBorder: true,
        withColumnBorders: true,
        verticalSpacing: 'sm',
        horizontalSpacing: 'md',
      },
    },
  },
});
