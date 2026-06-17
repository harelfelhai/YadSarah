import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Center, Group, PasswordInput, Stack, Text, TextInput, Alert, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconActivityHeartbeat } from '@tabler/icons-react';
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
    <Box
      className="login-grid"
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.05fr)',
        background: 'var(--paper)',
      }}
    >
      {/* Form side */}
      <Center className="login-form" p="xl" style={{ order: 2 }}>
        <Box
          w={360}
          maw="100%"
          p="xl"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderTop: '3px solid var(--accent)',
          }}
        >
          <Stack gap="lg">
            <Box>
              <Title order={2} style={{ fontSize: 24, color: 'var(--ink)' }}>כניסה למערכת</Title>
              <Text size="sm" c="dimmed" mt={4}>הזדהות עם שם משתמש וסיסמה</Text>
            </Box>

            {error && (
              <Alert icon={<IconAlertCircle size={16} />} color="brick" variant="light" p="xs">
                {error}
              </Alert>
            )}

            <form onSubmit={form.onSubmit(handleSubmit)}>
              <Stack gap="sm">
                <TextInput
                  label="שם משתמש"
                  placeholder="הכנס שם משתמש"
                  autoComplete="username"
                  {...form.getInputProps('username')}
                />
                <PasswordInput
                  label="סיסמה"
                  placeholder="הכנס סיסמה"
                  autoComplete="current-password"
                  {...form.getInputProps('password')}
                />
                <Button type="submit" fullWidth loading={loading} mt="sm">
                  כניסה למערכת
                </Button>
              </Stack>
            </form>
          </Stack>
        </Box>
      </Center>

      {/* Brand panel */}
      <Box
        className="login-panel"
        style={{
          order: 1,
          background: 'linear-gradient(180deg, var(--ink) 0%, #16222e 100%)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '40px 44px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* faint technical grid */}
        <Box
          aria-hidden
          style={{
            position: 'absolute', inset: 0, opacity: 0.06, pointerEvents: 'none',
            backgroundImage:
              'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <Box style={{ position: 'relative' }}>
          <Logo size={48} color="white" />
        </Box>

        <Stack gap="xs" style={{ position: 'relative' }}>
          <Group gap={8} c="var(--mantine-color-steel-3)">
            <IconActivityHeartbeat size={18} />
            <Text size="sm" fw={600} style={{ letterSpacing: '0.04em' }}>מערכת ניהול מוקד רפואה דחופה</Text>
          </Group>
          <Title
            order={1}
            style={{ color: '#fff', fontSize: 40, lineHeight: 1.1, fontWeight: 900 }}
          >
            מלר״ד יד שרה
          </Title>
          <Text size="sm" c="var(--mantine-color-slate-3)" maw={420}>
            קבלה, תור, טיפול ותיעוד רפואי — מערכת פנים-ארגונית מאובטחת לניהול המוקד.
          </Text>
        </Stack>

        <Text size="xs" c="var(--mantine-color-slate-4)" style={{ position: 'relative' }}>
          גרסת הדגמה · נתוני בדיקה בלבד
        </Text>
      </Box>
    </Box>
  );
}
