import { createTheme } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

// ─── Yad Sarah brand palette: blue (primary) · red (accent) · white ──────────

const medicalBlue: MantineColorsTuple = [
  '#e7f1fb',
  '#cfe1f5',
  '#9fc2eb',
  '#6ba1e0',
  '#4286d7',
  '#2576d2',
  '#0f6fc4', // primary
  '#0a5da8',
  '#06528f',
  '#013f72',
];

const yadRed: MantineColorsTuple = [
  '#fff0f0',
  '#ffdede',
  '#f7baba',
  '#f09393',
  '#ea7070',
  '#e75a5a',
  '#e64a4a', // accent
  '#cd3a3a',
  '#b62f2f',
  '#9e2121',
];

export const theme = createTheme({
  primaryColor: 'medicalBlue',
  colors: { medicalBlue, yadRed },
  defaultRadius: 'md',
  fontFamily: 'Segoe UI, Arial, sans-serif',
  headings: {
    fontFamily: 'Segoe UI, Arial, sans-serif',
  },
  components: {
    Button: {
      defaultProps: { size: 'sm' },
    },
    TextInput: {
      defaultProps: { size: 'sm' },
    },
    Select: {
      defaultProps: { size: 'sm' },
    },
    DateInput: {
      defaultProps: { size: 'sm' },
    },
    Table: {
      defaultProps: { striped: true, highlightOnHover: true, withTableBorder: true, withColumnBorders: true },
    },
  },
});
