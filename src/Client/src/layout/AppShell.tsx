import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell as MantineAppShell, Burger, Group, NavLink, Text, Button, Avatar, Box,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconList, IconUserPlus, IconLogout, IconUsers, IconSettings, IconHistory,
  IconShieldLock, IconMessageReport, IconClock, IconLayoutDashboard, IconChartHistogram, IconWifiOff,
  IconBug,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { hasAnyRole, rolesLabel } from '../constants/roles';
import { startHub, stopHub, getConnectionOnline, onConnectionChange } from '../realtime/hub';
import { workstationApi } from '../api/workstation';
import { getOrCreateDeviceId } from '../utils/deviceId';
import Logo from '../components/Logo';
import FeedbackWidget from '../components/FeedbackWidget';
import WorkstationSetupModal from '../components/WorkstationSetupModal';
import type { UserRole } from '../types';

const NAV: { href: string; label: string; icon: ReactNode; roles?: UserRole[] }[] = [
  { href: '/reception', label: 'קבלה ושחרור', icon: <IconUserPlus size={18} />, roles: ['Reception', 'ShiftManager', 'Admin'] },
  { href: '/queue', label: 'תור', icon: <IconList size={18} /> },
  { href: '/history', label: 'היסטוריית מטופלים', icon: <IconHistory size={18} /> },
  { href: '/shift-status', label: 'סטטוס משמרת', icon: <IconLayoutDashboard size={18} />, roles: ['Admin', 'ShiftManager'] },
  { href: '/analytics', label: 'ניתוח נתונים', icon: <IconChartHistogram size={18} />, roles: ['Admin', 'ShiftManager'] },
  { href: '/admin/users', label: 'ניהול משתמשים', icon: <IconUsers size={18} />, roles: ['Admin', 'ShiftManager'] },
  { href: '/admin/settings', label: 'הגדרות מערכת', icon: <IconSettings size={18} />, roles: ['Admin'] },
  { href: '/admin/feedback', label: 'דיווחי משתמשים', icon: <IconMessageReport size={18} />, roles: ['Admin'] },
  { href: '/admin/errors', label: 'שגיאות מערכת', icon: <IconBug size={18} />, roles: ['Admin'] },
  { href: '/admin/audit', label: 'יומן ביקורת', icon: <IconShieldLock size={18} />, roles: ['Admin'] },
];

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

// A persistent banner shown while the system is offline — the browser reports no network OR the realtime
// link to the server is down (so the board / forms are no longer receiving live updates). A short grace
// delay avoids flashing it during a brief auto-reconnect; it clears the moment the link is back.
function ConnectionBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => {
      const down = !navigator.onLine || !getConnectionOnline();
      clearTimeout(grace);
      if (down) grace = setTimeout(() => setOffline(true), 2500); // confirm it's really down first
      else setOffline(false);                                     // back online → clear immediately
    };
    const offHub = onConnectionChange(evaluate);
    window.addEventListener('online', evaluate);
    window.addEventListener('offline', evaluate);
    evaluate();
    return () => {
      clearTimeout(grace);
      offHub();
      window.removeEventListener('online', evaluate);
      window.removeEventListener('offline', evaluate);
    };
  }, []);

  if (!offline) return null;
  return (
    <Group
      gap={8}
      justify="center"
      wrap="nowrap"
      mb="sm"
      py={6}
      px="md"
      style={{
        background: 'var(--mantine-color-ochre-2)',
        color: 'var(--ink)',
        border: '1px solid var(--mantine-color-ochre-4)',
        borderRadius: 4,
        fontWeight: 600,
      }}
    >
      <IconWifiOff size={16} />
      <Text size="sm">אין חיבור לשרת — ייתכן שהמידע אינו מעודכן. מנסה להתחבר מחדש…</Text>
    </Group>
  );
}

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, expiresAt, clearAuth } = useAuthStore();

  // Whether this computer has been pinned to a room yet. If not (new device), prompt
  // the first user to set it — authoritative across both login and page-refresh.
  const { data: ws } = useQuery({
    queryKey: ['workstation-me'],
    queryFn: () => workstationApi.getMyRoom(getOrCreateDeviceId()),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  // A user may skip pinning this computer to a room (e.g. a personal / off-site machine).
  // The choice is remembered on this device so it won't prompt again.
  const [roomSkipped, setRoomSkipped] = useState(() => localStorage.getItem('ys_ws_room_skipped') === '1');
  const needsRoom = !!user && ws !== undefined && !ws.room && !roomSkipped;

  // Ensure the SignalR connection is live whenever an authenticated user is in the
  // app — not only right after login. On a page refresh the auth token persists
  // (so the user stays logged in) but the hub would otherwise never start, killing
  // presence + live form sync. startHub() is idempotent (no-op if already connected).
  useEffect(() => {
    if (user) startHub().catch(() => {});
  }, [user]);

  // Unified logout: stop the hub, clear auth, and CLEAR THE QUERY CACHE so the previous user's
  // cached patient PHI can't leak to the next user on a shared workstation (the query cache is a
  // module-level singleton that otherwise survives logout). Used by the header button and by the
  // idle/expiry watchdog below.
  const doLogout = useCallback(async () => {
    await stopHub();
    clearAuth();
    queryClient.clear();
    navigate('/login');
  }, [clearAuth, queryClient, navigate]);

  // Proactively end an idle or expired session on a shared workstation, instead of leaving the UI
  // authenticated until the next API call happens to 401. Resets on real user activity; also
  // honors the access token's own expiry.
  useEffect(() => {
    if (!user) return;
    // Reopened browser with an already-expired persisted token → log out immediately on mount.
    if (expiresAt && Date.now() > new Date(expiresAt).getTime()) { void doLogout(); return; }

    const IDLE_MS = 15 * 60_000;
    let idleTimer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { void doLogout(); }, IDLE_MS);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    const expiryTimer = setInterval(() => {
      if (expiresAt && Date.now() > new Date(expiresAt).getTime()) void doLogout();
    }, 30_000);

    return () => {
      clearTimeout(idleTimer);
      clearInterval(expiryTimer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, expiresAt, doLogout]);

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
                  <Text size="sm" fw={600} lh={1.1} c="#fff">{user.displayName || user.fullName}</Text>
                  <Text size="xs" lh={1.1} c="var(--mantine-color-slate-3)">
                    {rolesLabel(user.roles)}{user.department ? ` · ${user.department}` : ''}
                  </Text>
                </Box>
              </Group>
            )}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconLogout size={14} />}
              onClick={doLogout}
              style={{ color: '#fff' }}
            >
              יציאה
            </Button>
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="sm" style={{ background: 'var(--surface)' }}>
        {NAV.filter((item) => !item.roles || hasAnyRole(user?.roles, ...item.roles)).map((item) => {
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
        <ConnectionBanner />
        {children}
        <FeedbackWidget />
        {needsRoom && (
          <WorkstationSetupModal
            onDone={() => queryClient.invalidateQueries({ queryKey: ['workstation-me'] })}
            onSkip={() => { localStorage.setItem('ys_ws_room_skipped', '1'); setRoomSkipped(true); }}
          />
        )}
      </MantineAppShell.Main>
    </MantineAppShell>
  );
}
