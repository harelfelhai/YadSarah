import { Button, TextInput, type TextInputProps } from '@mantine/core';
import { useRef } from 'react';

/**
 * Native HTML date input (`<TextInput type="date" />`) with a small "היום" (Today)
 * quick-set button rendered in the field's `rightSection`.
 *
 * Drop-in replacement for `<TextInput type="date" .../>`: every prop is forwarded
 * unchanged, so both usage shapes work:
 *   (a) {...form.getInputProps('x')}            — Mantine form
 *   (b) explicit value / onChange (HistoryPage) — controlled by the caller
 *
 * Clicking "היום" writes today's date straight onto the real <input> through the
 * native value setter and dispatches a genuine `input` event, so the caller's
 * onChange fires with a REAL DOM event (a true `currentTarget`).
 *
 * IMPORTANT — do NOT hand-roll a fake `{ currentTarget, target }` object and pass it
 * to onChange: Mantine's `getInputOnChange` stores any object that lacks `nativeEvent`
 * VERBATIM as the field value. That object is then persisted and later rendered as a
 * React child → "Objects are not valid as a React child" (React error #31), crashing
 * the whole form. Dispatching a native event avoids that class of bug entirely.
 */
export default function DateField({ rightSection, rightSectionWidth, ...props }: TextInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  const setToday = () => {
    const input = ref.current;
    if (!input) return;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // Set via the native setter (bypasses React's value tracker) then fire a real
    // `input` event so React + Mantine both pick up the change like a normal user edit.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, today);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  return (
    <TextInput
      ref={ref}
      type="date"
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
