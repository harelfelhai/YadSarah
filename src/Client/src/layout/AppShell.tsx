import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell, Burger, Group, NavLink, Text, Button, Avatar,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconList, IconUserPlus, IconLogout, IconUsers, IconSettings, IconHistory, IconShieldLock, IconMessageReport } from '@tabler/icons-react';
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
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header style={{ borderBottom: '3px solid var(--mantine-color-yadRed-6)' }}>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Logo size={34} subtitle="רפואה דחופה" />
          </Group>
          <Group gap="sm">
            {user && (
              <Group gap="xs">
                <Avatar size="sm" radius="xl" color="blue">{user.fullName.charAt(0)}</Avatar>
                <Text size="sm">{user.fullName}</Text>
              </Group>
            )}
            <Button size="xs" variant="subtle" color="red" leftSection={<IconLogout size={14} />} onClick={handleLogout}>
              יציאה
            </Button>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="sm">
        {NAV.filter((item) => !item.roles || (!!user && item.roles.includes(user.role))).map((item) => (
          <NavLink
            key={item.href}
            label={item.label}
            leftSection={item.icon}
            active={location.pathname === item.href}
            onClick={() => navigate(item.href)}
          />
        ))}
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {children}
        <FeedbackWidget />
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
