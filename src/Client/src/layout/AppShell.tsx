import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell, Burger, Group, NavLink, Text, Button, Avatar,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconList, IconUserPlus, IconLogout } from '@tabler/icons-react';
import { useAuthStore } from '../store/auth';
import { stopHub } from '../realtime/hub';

const NAV = [
  { href: '/queue', label: 'תור', icon: <IconList size={18} /> },
  { href: '/reception/new', label: 'קבלת מטופל', icon: <IconUserPlus size={18} /> },
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
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} c="medicalBlue.7" size="lg">יד שרה — רפואה דחופה</Text>
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
        {NAV.map((item) => (
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
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
