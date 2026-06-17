import { Button, TextInput, type TextInputProps } from '@mantine/core';

/**
 * Native HTML date input (`<TextInput type="date" />`) with a small "היום" (Today)
 * quick-set button rendered in the field's `rightSection`.
 *
 * Drop-in replacement for `<TextInput type="date" .../>`: every prop is forwarded
 * unchanged, so both usage shapes work:
 *   (a) {...form.getInputProps('x')}            — Mantine form
 *   (b) explicit value / onChange (HistoryPage) — controlled by the caller
 *
 * Clicking "היום" sets the field to today's date in `YYYY-MM-DD` by calling the
 * field's own `onChange` with a synthetic change event, so whichever handler the
 * caller passed reads the new value the same way it reads a real user edit
 * (both `currentTarget.value` and `target.value` are provided).
 */
export default function DateField({ rightSection, rightSectionWidth, onChange, ...props }: TextInputProps) {
  const setToday = () => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    onChange?.({
      currentTarget: { value: today },
      target: { value: today },
    } as React.ChangeEvent<HTMLInputElement>);
  };

  return (
    <TextInput
      type="date"
      onChange={onChange}
      rightSectionWidth={rightSectionWidth ?? 52}
      rightSectionPointerEvents="auto"
      rightSection={
        rightSection ?? (
          <Button
            size="compact-xs"
            variant="subtle"
            px={6}
            onClick={setToday}
            tabIndex={-1}
          >
            היום
          </Button>
        )
      }
      {...props}
    />
  );
}
