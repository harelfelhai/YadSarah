import { useState } from 'react';
import { Button, Code, CopyButton, Group, Modal, Stack, Text } from '@mantine/core';
import { IconQrcode } from '@tabler/icons-react';
import { QRCodeSVG } from 'qrcode.react';

// Shows the QR a patient scans to open the public self-service intake page (/intake) on their
// own device. Reception can display it on screen or print this view.
export default function IntakeQrButton() {
  const [opened, setOpened] = useState(false);
  const url = `${window.location.origin}/intake`;

  return (
    <>
      <Button variant="light" color="steel" leftSection={<IconQrcode size={16} />} onClick={() => setOpened(true)}>
        QR לקבלה עצמית
      </Button>

      <Modal opened={opened} onClose={() => setOpened(false)} title="קבלה עצמית — סריקת QR" centered size="sm">
        <Stack align="center" gap="md">
          <Text size="sm" c="dimmed" ta="center">
            המטופל/ת סורק/ת את הקוד כדי לפתוח את טופס הקבלה העצמית במכשיר האישי.
          </Text>
          <div style={{ background: '#fff', padding: 16, border: '1px solid var(--mantine-color-gray-3)' }}>
            <QRCodeSVG value={url} size={220} />
          </div>
          <Group gap="xs" wrap="nowrap">
            <Code>{url}</Code>
            <CopyButton value={url}>
              {({ copied, copy }) => (
                <Button size="xs" variant="subtle" onClick={copy}>{copied ? 'הועתק' : 'העתק קישור'}</Button>
              )}
            </CopyButton>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
