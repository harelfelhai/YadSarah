import { useEffect, useRef, useState } from 'react';
import { Button, Text, TextInput } from '@mantine/core';
import { parseFlexibleDate, isoToDisplay } from '../utils/hebrewDate';

interface BirthDateFieldProps {
  label?: string;
  value?: string;                      // ISO YYYY-MM-DD (the stored form value)
  onChange?: (iso: string) => void;    // called with ISO, or '' while unresolved
  error?: React.ReactNode;
  withAsterisk?: boolean;
}

/**
 * Typed birth-date field. The clerk types either a Gregorian date (dd/mm/yyyy,
 * dd.mm.yyyy, dd-mm-yyyy) or a Hebrew date ("כ״ח בסיון תשפ״ו" / "28 בסיון 5786");
 * we resolve it to an ISO `YYYY-MM-DD` value and show a live confirmation preview
 * (the resolved Gregorian + its Hebrew equivalent). Conversion is fully offline
 * (@hebcal/hdate). "היום" fills today.
 */
export default function BirthDateField({ label, value, onChange, error, withAsterisk }: BirthDateFieldProps) {
  const [text, setText] = useState(() => isoToDisplay(value));
  // Track the ISO we last emitted, so an external value change (e.g. loading an
  // existing patient) re-seeds the display, but our own typing doesn't fight it.
  const lastIso = useRef(value ?? '');

  useEffect(() => {
    if ((value ?? '') !== lastIso.current) {
      lastIso.current = value ?? '';
      setText(isoToDisplay(value));
    }
  }, [value]);

  const parsed = parseFlexibleDate(text);

  const emit = (iso: string) => {
    lastIso.current = iso;
    onChange?.(iso);
  };

  const handleText = (raw: string) => {
    setText(raw);
    const p = parseFlexibleDate(raw);
    emit(p ? p.iso : '');
  };

  const setToday = () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setText(isoToDisplay(iso));
    emit(iso);
  };

  return (
    <TextInput
      label={label}
      withAsterisk={withAsterisk}
      placeholder="dd/mm/yyyy או תאריך עברי"
      value={text}
      onChange={(e) => handleText(e.currentTarget.value)}
      error={error}
      rightSectionWidth={52}
      rightSectionPointerEvents="auto"
      rightSection={
        <Button size="compact-xs" variant="subtle" px={6} onClick={setToday} tabIndex={-1}>
          היום
        </Button>
      }
      description={
        text.trim()
          ? parsed
            ? <Text component="span" size="xs" c="teal">{isoToDisplay(parsed.iso)} · {parsed.hebrew}</Text>
            : <Text component="span" size="xs" c="orange">לא זוהה תאריך</Text>
          : undefined
      }
      inputWrapperOrder={['label', 'input', 'description', 'error']}
    />
  );
}
