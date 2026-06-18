import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell, Burger, Group, NavLink, Text, Button, Avatar, Box,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconList, IconUserPlus, IconLogout, IconUsers, IconSettings, IconHistory,
  IconShieldLock, IconMessageReport, IconClock, IconLayoutDashboard,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { startHub, stopHub } from '../realtime/hub';
import { workstationApi } from '../api/workstation';
import { getOrCreateDeviceId } from '../utils/deviceId';
import Logo from '../components/Logo';
import FeedbackWidget from '../components/FeedbackWidget';
import WorkstationSetupModal from '../components/WorkstationSetupModal';
import type { UserRole } from '../types';

const NAV: { href: string; label: string; icon: ReactNode; roles?: UserRole[] }[] = [
  { href: '/queue', label: 'תור', icon: <IconList size={18} /> },
  { href: '/reception/new', label: 'קבלת מטופל', icon: <IconUserPlus size={18} />, roles: ['Reception', 'ShiftManager', 'Admin'] },
  { href: '/history', label: 'היסטוריית מטופלים', icon: <IconHistory size={18} /> },
  { href: '/shift-status', label: 'סטטוס משמרת', icon: <IconLayoutDashboard size={18} />, roles: ['Admin', 'ShiftManager'] },
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
  const queryClient = useQueryClient();
  const { user, clearAuth } = useAuthStore();

  // Whether this computer has been pinned to a room yet. If not (new device), prompt
  // the first user to set it — authoritative across both login and page-refresh.
  const { data: ws } = useQuery({
    queryKey: ['workstation-me'],
    queryFn: () => workstationApi.getMyRoom(getOrCreateDeviceId()),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const needsRoom = !!user && ws !== undefined && !ws.room;

  // Ensure the SignalR connection is live whenever an authenticated user is in the
  // app — not only right after login. On a page refresh the auth token persists
  // (so the user stays logged in) but the hub would otherwise never start, killing
  // presence + live form sync. startHub() is idempotent (no-op if already connected).
  useEffect(() => {
    if (user) startHub().catch(() => {});
  }, [user]);

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
            <Box
              style={{
                background: '#fff',
                borderRadius: 4,
                padding: '4px 9px',
                display: 'flex',
                alignItems: 'center',
                lineHeight: 0,
                boxShadow: '0 1px 4px rgba(0,0,0,0.28)',
              }}
            >
              <Logo size={32} />
            </Box>
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
        {needsRoom && (
          <WorkstationSetupModal
            onDone={() => queryClient.invalidateQueries({ queryKey: ['workstation-me'] })}
          />
        )}
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
