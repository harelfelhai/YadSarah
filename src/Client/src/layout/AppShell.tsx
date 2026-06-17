import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell, Burger, Group, NavLink, Text, Button, Avatar, Box,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconList, IconUserPlus, IconLogout, IconUsers, IconSettings, IconHistory,
  IconShieldLock, IconMessageReport, IconClock,
} from '@tabler/icons-react';
import { useAuthStore } from '../store/auth';
import { stopHub } from '../realtime/hub';
import Logo from '../components/Logo';
import FeedbackWidget from '../components/FeedbackWidget';
import type { UserRole } from '../types';

const NAV: { href: string; label: string; icon: ReactNode; roles?: UserRole[] }[] = [
  { href: '/queue', label: 'תור', icon: <IconList size={18} /> },
  { href: '/reception/new', label: 'קבלת מטופל', icon: <IconUserPlus size={18} /> },
  { href: '/history', label: 'היסטוריית מטופלים', icon: <IconHistory size={18} /> },
  { href: '/admin/users', label: 'ניהול משתמשים', icon: <IconUsers size={18} />, roles: ['Admin', 'ShiftManager'] },
  { href: '/admin/settings', label: 'הגדרות מערכת', icon: <IconSettings size={18} />, roles: ['Admin'] },
  { href: '/admin/feedback', label: 'דיווחי משתמשים', icon: <IconMessageReport size={18} />, roles: ['Admin'] },
  { href: '/admin/audit', label: 'יומן ביקורת', icon: <IconShieldLock size={18} />, roles: ['Admin'] },
];

const ROLE_LABEL: Record<string, string> = {
  Admin: 'מנהל מערכת', ShiftManager: 'מנהל משמרת', Doctor: 'רופא/ה', Nurse: 'אח/ות', Reception: 'קבלה',
};

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Group gap={6} c="var(--mantine-color-slate-2)" wrap="nowrap" visibleFrom="xs">
      <IconClock size={15} />
      <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {now.toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' })}
        {'  ·  '}
        {now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </Group>
  );
}

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth } = useAuthStore();

  const handleLogout = async () => {
    await stopHub();
    clearAuth();
    navigate('/login');
  };

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{ width: 232, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header
        style={{ background: 'var(--ink)', borderBottom: '2px solid var(--accent)', color: '#fff' }}
      >
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="#fff" />
            <Logo size={32} color="white" subtitle="רפואה דחופה" />
          </Group>

          <Group gap="lg" wrap="nowrap">
            <HeaderClock />
            {user && (
              <Group gap="xs" wrap="nowrap">
                <Avatar size={32} radius="xl" color="steel" variant="filled">
                  {user.fullName.charAt(0)}
                </Avatar>
                <Box visibleFrom="sm">
                  <Text size="sm" fw={600} lh={1.1} c="#fff">{user.fullName}</Text>
                  <Text size="xs" lh={1.1} c="var(--mantine-color-slate-3)">
                    {ROLE_LABEL[user.role] ?? user.role}{user.department ? ` · ${user.department}` : ''}
                  </Text>
                </Box>
              </Group>
            )}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconLogout size={14} />}
              onClick={handleLogout}
              style={{ color: '#fff' }}
            >
              יציאה
            </Button>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="sm" style={{ background: 'var(--surface)' }}>
        {NAV.filter((item) => !item.roles || (!!user && item.roles.includes(user.role))).map((item) => {
          const active = location.pathname === item.href;
          return (
            <NavLink
              key={item.href}
              label={item.label}
              leftSection={item.icon}
              active={active}
              variant="light"
              onClick={() => navigate(item.href)}
              mb={2}
              styles={{
                root: {
                  borderInlineStart: active ? '3px solid var(--accent)' : '3px solid transparent',
                  fontWeight: active ? 700 : 500,
                },
              }}
            />
          );
        })}
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {children}
        <FeedbackWidget />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
