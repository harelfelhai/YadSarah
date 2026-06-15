import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Card, Grid, Group, Loader, Stack, Table, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { IconSearch, IconEye, IconUser } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { patientsApi } from '../../api/patients';
import { visitsApi } from '../../api/visits';
import type { Patient, Visit, VisitStatus } from '../../types';

const STATUS_LABEL: Record<VisitStatus, string> = {
  Waiting: 'ממתין',
  Called: 'נקרא',
  InTreatment: 'בטיפול',
  FinishedTreatment: 'סיים טיפול',
  Discharged: 'שוחרר',
};

const STATUS_COLOR: Record<VisitStatus, string> = {
  Waiting: 'blue',
  Called: 'yellow',
  InTreatment: 'green',
  FinishedTreatment: 'teal',
  Discharged: 'gray',
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Patient | null>(null);

  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ['patient-search', query],
    queryFn: () => patientsApi.search(query),
    enabled: query.length > 0,
  });

  const { data: visits = [], isLoading: visitsLoading } = useQuery({
    queryKey: ['patient-visits', selected?.id],
    queryFn: () => visitsApi.getByPatient(selected!.id),
    enabled: !!selected,
  });

  const runSearch = () => {
    setSelected(null);
    setQuery(term.trim());
  };

  return (
    <Stack gap="md" p="md">
      <Title order={3}>היסטוריית מטופלים</Title>

      {/* Search */}
      <Card withBorder p="md" radius="md">
        <Group align="flex-end" gap="sm">
          <TextInput
            label="חיפוש מטופל"
            placeholder="ת״ז או שם"
            value={term}
            onChange={(e) => setTerm(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            flex={1}
          />
          <Button leftSection={<IconSearch size={16} />} loading={searching} onClick={runSearch}>
            חפש
          </Button>
        </Group>

        {query.length > 0 && !searching && results.length === 0 && (
          <Text size="sm" c="dimmed" mt="sm">לא נמצאו מטופלים תואמים.</Text>
        )}

        {results.length > 0 && (
          <Stack gap={4} mt="sm">
            {results.map((p) => (
              <Group
                key={p.id}
                justify="space-between"
                p="xs"
                style={{
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: selected?.id === p.id ? 'var(--mantine-color-medicalBlue-0)' : undefined,
                }}
                onClick={() => setSelected(p)}
              >
                <Group gap="sm">
                  <IconUser size={16} />
                  <Text fw={600}>{p.firstName} {p.lastName}</Text>
                  <Text c="dimmed" size="sm">{p.identityType}: {p.identityNumber ?? '—'}</Text>
                </Group>
                <Text size="sm" c="dimmed">{fmtDate(p.birthDate)}</Text>
              </Group>
            ))}
          </Stack>
        )}
      </Card>

      {/* Selected patient + visits */}
      {selected && (
        <Card withBorder p="md" radius="md">
          <Grid mb="sm">
            <Grid.Col span={3}>
              <Text size="xs" c="dimmed">שם</Text>
              <Text fw={700}>{selected.firstName} {selected.lastName}</Text>
            </Grid.Col>
            <Grid.Col span={3}>
              <Text size="xs" c="dimmed">ת.ז / מזהה</Text>
              <Text>{selected.identityNumber ?? '—'}</Text>
            </Grid.Col>
            <Grid.Col span={2}>
              <Text size="xs" c="dimmed">תאריך לידה</Text>
              <Text>{fmtDate(selected.birthDate)}</Text>
            </Grid.Col>
            <Grid.Col span={2}>
              <Text size="xs" c="dimmed">טלפון</Text>
              <Text>{selected.phoneMobile ?? '—'}</Text>
            </Grid.Col>
            <Grid.Col span={2}>
              <Button size="xs" variant="light" onClick={() => navigate(`/patients/${selected.id}/edit`)}>
                עריכת פרטים
              </Button>
            </Grid.Col>
          </Grid>

          <Text fw={600} mb="xs">ביקורים ({visits.length})</Text>

          {visitsLoading ? (
            <Box ta="center" py="md"><Loader size="sm" /></Box>
          ) : visits.length === 0 ? (
            <Text size="sm" c="dimmed">אין ביקורים רשומים.</Text>
          ) : (
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>תאריך</Table.Th>
                  <Table.Th>שעה</Table.Th>
                  <Table.Th>מס׳ תור</Table.Th>
                  <Table.Th>מחלקה</Table.Th>
                  <Table.Th>סיבת קבלה</Table.Th>
                  <Table.Th>סטטוס</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visits.map((v: Visit) => (
                  <Table.Tr key={v.id}>
                    <Table.Td>{fmtDate(v.admissionDate)}</Table.Td>
                    <Table.Td>{v.admissionTime?.slice(0, 5) ?? '—'}</Table.Td>
                    <Table.Td fw={600}>{v.queueNumber}</Table.Td>
                    <Table.Td>{v.receptionDepartment ?? '—'}</Table.Td>
                    <Table.Td>{v.admissionReason ?? v.admissionReasonFree ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[v.status]} variant="light">
                        {STATUS_LABEL[v.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="צפייה בטופס הביקור">
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconEye size={14} />}
                          onClick={() => navigate(`/visits/${v.id}`)}
                        >
                          צפה
                        </Button>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Card>
      )}
    </Stack>
  );
}
