import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, Center, PasswordInput, Stack, Text, TextInput, Alert,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/auth';
import { startHub } from '../../realtime/hub';
import Logo from '../../components/Logo';

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (v) => (v.trim() ? null : 'שדה חובה'),
      password: (v) => (v ? null : 'שדה חובה'),
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await authApi.login(values.username, values.password);
      setAuth(token, user);
      await startHub();
      navigate('/queue');
    } catch {
      setError('שם משתמש או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center
      h="100vh"
      style={{
        background:
          'linear-gradient(135deg, var(--mantine-color-medicalBlue-8) 0%, var(--mantine-color-medicalBlue-6) 55%, var(--mantine-color-yadRed-6) 100%)',
      }}
    >
      <Card w={380} shadow="xl" p="xl" radius="md" style={{ borderTop: '4px solid var(--mantine-color-yadRed-6)' }}>
        <Stack gap="lg">
          <Center>
            <Logo size={56} subtitle="מערכת רפואה דחופה" />
          </Center>
          <Box ta="center">
            <Text size="sm" c="dimmed">התחברות למערכת</Text>
          </Box>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
              {error}
            </Alert>
          )}

          <form onSubmit={form.onSubmit(handleSubmit)}>
            <Stack gap="sm">
              <TextInput
                label="שם משתמש"
                placeholder="הכנס שם משתמש"
                {...form.getInputProps('username')}
              />
              <PasswordInput
                label="סיסמה"
                placeholder="הכנס סיסמה"
                {...form.getInputProps('password')}
              />
              <Button type="submit" fullWidth loading={loading} mt="sm">
                כניסה למערכת
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  );
}
