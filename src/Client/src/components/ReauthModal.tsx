import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { IconLock, IconWriting } from '@tabler/icons-react';
import { apiErrorMessage } from '../constants/formPolicy';

interface ReauthModalProps {
  opened: boolean;
  onClose: () => void;
  /** Verifies the credentials and performs the action. Throw to keep the modal open with an error. */
  onConfirm: (username: string, password: string) => Promise<void>;
  title?: string;
  description?: string;
  confirmLabel?: string;
  confirmColor?: string;
}

/**
 * Step-up re-authentication dialog. Used at the moment of signing a medical form
 * (or an addendum): the clinician must re-enter their own username + password to
 * confirm the signature is theirs. The credentials are verified server-side against
 * the logged-in user; a wrong/mismatched password keeps the dialog open with an error.
 */
export default function ReauthModal({
  opened,
  onClose,
  onConfirm,
  title = 'אימות חתימה',
  description = 'לאישור החתימה הזן מחדש את שם המשתמש והסיסמה שלך.',
  confirmLabel = 'חתום',
  confirmColor = 'teal',
}: ReauthModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never retain typed credentials between openings.
  useEffect(() => {
    if (!opened) {
      setUsername('');
      setPassword('');
      setError(null);
      setBusy(false);
    }
  }, [opened]);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(username.trim(), password);
      // success → parent closes the modal (which clears the fields via the effect)
    } catch (err) {
      setError(apiErrorMessage(err, 'האימות נכשל'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">{description}</Text>
          {error && <Alert color="red" icon={<IconLock size={16} />}>{error}</Alert>}
          <TextInput
            label="שם משתמש"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            autoComplete="username"
            data-autofocus
            required
          />
          <PasswordInput
            label="סיסמה"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            required
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={onClose} disabled={busy}>ביטול</Button>
            <Button
              type="submit"
              color={confirmColor}
              loading={busy}
              disabled={!canSubmit}
              leftSection={<IconWriting size={16} />}
            >
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
