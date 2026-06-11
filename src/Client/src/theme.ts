import { createTheme, MantineColorsTuple } from '@mantine/core';

const medicalBlue: MantineColorsTuple = [
  '#e8f4ff',
  '#d0e6ff',
  '#9fcbff',
  '#6aaefd',
  '#3f95fc',
  '#2586fb',
  '#147ef4',  // primary
  '#0a6ddb',
  '#0061c4',
  '#0054ae',
];

export const theme = createTheme({
  primaryColor: 'medicalBlue',
  colors: { medicalBlue },
  defaultRadius: 'sm',
  fontFamily: 'Segoe UI, Arial, sans-serif',
  dir: 'rtl',
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
