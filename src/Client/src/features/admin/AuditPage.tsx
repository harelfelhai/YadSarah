import { useState } from 'react';
import {
  Box, Card, Group, Loader, Select, Stack, Table, Text, Title, Badge, Alert, Button,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconLock, IconRefresh } from '@tabler/icons-react';
import { auditApi } from '../../api/audit';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole } from '../../constants/roles';

const ENTITY_OPTIONS = [
  { value: '', label: 'הכול' },
  { value: 'Auth', label: 'התחברות' },
  { value: 'Patient', label: 'מטופלים' },
  { value: 'Visit', label: 'ביקורים' },
  { value: 'MedicalForm', label: 'טפסים רפואיים' },
  { value: 'User', label: 'משתמשים' },
  { value: 'Setting', label: 'הגדרות' },
];

const ACTION_COLOR: Record<string, string> = {
  Login: 'green', LoginFailed: 'orange', LockedOut: 'red',
  Viewed: 'gray', Searched: 'gray', Created: 'blue',
  Updated: 'yellow', StatusChanged: 'cyan', Signed: 'teal',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function AuditPage() {
  const roles = useAuthStore((s) => s.user?.roles);
  const isAdmin = hasAnyRole(roles, 'Admin');
  const [entityType, setEntityType] = useState('');

  const { data: entries = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit', entityType],
    queryFn: () => auditApi.get({ entityType: entityType || undefined, take: 300 }),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <Box p="md">
        <Alert icon={<IconLock size={16} />} color="red" title="אין הרשאה">
          יומן הביקורת נגיש למנהל מערכת (Admin) בלבד.
        </Alert>
      </Box>
    );
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>יומן ביקורת (Audit Log)</Title>
        <Button variant="light" leftSection={<IconRefresh size={16} />} loading={isFetching} onClick={() => refetch()}>
          רענון
        </Button>
      </Group>

      <Card withBorder p="md" radius="md">
        <Group mb="sm">
          <Select
            label="סוג ישות"
            data={ENTITY_OPTIONS}
            value={entityType}
            onChange={(v) => setEntityType(v ?? '')}
            w={220}
          />
          <Text size="xs" c="dimmed" mt={24}>
            מוצגות {entries.length} הרשומות האחרונות. היומן הוא append-only (לא ניתן לעריכה/מחיקה).
          </Text>
        </Group>

        {isLoading ? (
          <Box ta="center" py="xl"><Loader /></Box>
        ) : entries.length === 0 ? (
          <Text c="dimmed" size="sm">אין רשומות.</Text>
        ) : (
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover withTableBorder fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>זמן</Table.Th>
                  <Table.Th>משתמש</Table.Th>
                  <Table.Th>פעולה</Table.Th>
                  <Table.Th>ישות</Table.Th>
                  <Table.Th>מזהה</Table.Th>
                  <Table.Th>שדה / פרט</Table.Th>
                  <Table.Th>כתובת IP</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entries.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{fmt(e.timestamp)}</Table.Td>
                    <Table.Td>{e.userName}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={ACTION_COLOR[e.action] ?? 'gray'}>
                        {e.action}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{e.entityType}</Table.Td>
                    <Table.Td style={{ fontFamily: 'monospace' }}>
                      {e.entityId && e.entityId !== '00000000-0000-0000-0000-000000000000'
                        ? e.entityId.slice(0, 8) : '—'}
                    </Table.Td>
                    <Table.Td>{e.fieldName ?? e.newValue ?? '—'}</Table.Td>
                    <Table.Td style={{ fontFamily: 'monospace' }}>{e.ipAddress ?? '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Card>
    </Stack>
  );
}
