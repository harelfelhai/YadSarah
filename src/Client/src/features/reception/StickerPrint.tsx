import { useEffect, useRef } from 'react';
import { Button, Group, Stack, Title, Text, Paper, Divider, Box } from '@mantine/core';
import { IconPrinter, IconArrowLeft, IconUserPlus } from '@tabler/icons-react';
import type { Patient, Visit } from '../../types';

interface Props {
  patient: Patient;
  visit: Visit;
  onContinue: () => void;
  onAdmitAnother: () => void;
}

const NUM_SMALL_STICKERS = 10;

function formatDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatTime(t?: string): string {
  if (!t) return '';
  return t.slice(0, 5);
}

export default function StickerPrint({ patient, visit, onContinue, onAdmitAnother }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const autoPrinted = useRef(false);

  // Print via a hidden iframe (not window.open) so it can also be triggered
  // automatically on mount without being blocked as a pop-up.
  const handlePrint = () => {
    const content = printRef.current;
    const doc = frameRef.current?.contentWindow?.document;
    if (!content || !doc) return;
    doc.open();
    doc.write(`
      <html dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <style>
            * { box-sizing: border-box; font-family: Arial, sans-serif; }
            body { margin: 0; padding: 0; background: white; }
            .sticker-page { padding: 10mm; }
            .large-sticker {
              border: 1.5px solid #000; padding: 8mm; margin-bottom: 8mm;
              width: 100mm; text-align: center; page-break-inside: avoid;
            }
            .large-sticker .name { font-size: 18pt; font-weight: bold; }
            .large-sticker .queue { font-size: 72pt; font-weight: 900; line-height: 1; }
            .small-stickers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
            .small-sticker {
              border: 1px solid #555; padding: 2mm 3mm; font-size: 7pt;
              page-break-inside: avoid; line-height: 1.4;
            }
            .small-sticker .dept { font-weight: bold; font-size: 8pt; }
            .small-sticker .barcode-text { font-family: monospace; font-size: 8pt; letter-spacing: 2px; }
          </style>
        </head>
        <body><div class="sticker-page">${content.innerHTML}</div></body>
      </html>`);
    doc.close();
    frameRef.current?.contentWindow?.focus();
    frameRef.current?.contentWindow?.print();
  };

  // Auto-open the print dialog once, when the sticker screen appears.
  useEffect(() => {
    if (autoPrinted.current) return;
    autoPrinted.current = true;
    const t = setTimeout(handlePrint, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const admissionTime = formatTime(visit.admissionTime);
  const admissionDate = formatDate(visit.admissionDate);
  const birthDate = formatDate(patient.birthDate);
  const patientName = `${patient.lastName} ${patient.firstName}`;
  const genderInitial = patient.gender ?? '';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>הדפסת מדבקות</Title>
        <Group>
          <Button
            leftSection={<IconPrinter size={16} />}
            onClick={handlePrint}
          >
            הדפס
          </Button>
          <Button
            variant="light"
            leftSection={<IconUserPlus size={16} />}
            onClick={onAdmitAnother}
          >
            קבלת מטופל נוסף
          </Button>
          <Button
            variant="outline"
            rightSection={<IconArrowLeft size={16} />}
            onClick={onContinue}
          >
            המשך לתור
          </Button>
        </Group>
      </Group>

      <Text c="dimmed" size="sm">
        תצוגה מקדימה — לחץ "הדפס" להפעלת מדפסת המדבקות
      </Text>

      <div ref={printRef}>
        {/* Large sticker */}
        <Paper withBorder p="md" mb="md" style={{ width: 320, textAlign: 'center' }}>
          <Text fw={700} size="xl">{patientName}</Text>
          <Text style={{ fontSize: 96, fontWeight: 900, lineHeight: 1 }}>
            {visit.queueNumber}
          </Text>
        </Paper>

        <Divider mb="md" label="מדבקות קטנות" />

        {/* Small stickers grid */}
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            maxWidth: 720,
          }}
        >
          {Array.from({ length: NUM_SMALL_STICKERS }).map((_, i) => (
            <Paper
              key={i}
              withBorder
              p="xs"
              style={{ fontSize: 11 }}
            >
              <Text size="xs" fw={700}>מלר"ד יד שרה&nbsp;&nbsp;{admissionTime}</Text>
              <Text size="xs">{admissionDate}</Text>
              <Text size="xs">
                מ.אשפוז: {visit.queueNumber}&nbsp;&nbsp;{patientName} {genderInitial}
              </Text>
              {patient.fatherName && (
                <Text size="xs">שם האב: {patient.fatherName}</Text>
              )}
              {patient.birthDate && (
                <Text size="xs">ת.לידה: {birthDate}</Text>
              )}
              <Text
                size="xs"
                style={{ fontFamily: 'monospace', letterSpacing: 2, marginTop: 2 }}
              >
                {patient.identityNumber ?? ''}
              </Text>
            </Paper>
          ))}
        </Box>
      </div>

      <iframe ref={frameRef} title="הדפסת מדבקות" style={{ display: 'none' }} />
    </Stack>
  );
}
