import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Badge, Box, Button, Card, Grid, Group, Loader, Modal,
  NumberInput, Stack, Text, TextInput, Textarea, Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle, IconArrowRight, IconLogout, IconPencil,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { useAuthStore } from '../../store/auth';
import { isReceptionStaff } from '../../constants/roles';
import { STATUS_COLOR, STATUS_LABEL } from '../../constants/visitStatus';
import DateField from '../../components/DateField';

export default function DischargePage() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roles = useAuthStore((s) => s.user?.roles);

  const { data: visit, isLoading, isError } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => visitsApi.getById(visitId!),
    enabled: !!visitId,
  });

  // Payment fields settled at discharge. Everything else on the visit is sent back
  // unchanged (PUT /visits is a full replace — see handleSavePayment).
  const form = useForm({
    initialValues: { commitmentNumber: '', commitmentExpiryDate: '', exemptionReason: '' },
  });

  useEffect(() => {
    if (visit) {
      form.setValues({
        commitmentNumber: visit.commitmentNumber ?? '',
        commitmentExpiryDate: visit.commitmentExpiryDate ?? '',
        exemptionReason: visit.exemptionReason ?? '',
      });
    }
  }, [visit]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discharging, setDischarging] = useState(false);

  // Clinical staff don't discharge — keep them out of the administrative surface
  // (the server enforces this too on the status PATCH / visit PUT).
  if (roles && !isReceptionStaff(roles)) return <Navigate to="/queue" replace />;

  if (isLoading) return <Box ta="center" py="xl"><Loader /></Box>;
  if (isError || !visit) {
    return (
      <Box p="md">
        <Alert icon={<IconAlertCircle size={16} />} color="red">לא נמצא ביקור</Alert>
      </Box>
    );
  }

  const p = visit.patient;
  const fullName = p ? `${p.firstName} ${p.lastName}` : '—';
  const alreadyDischarged = visit.status === 'Discharged';

  const handleSavePayment = async () => {
    setSaving(true);
    try {
      // PUT /visits/{id} replaces ALL reception fields, so resend the whole visit
      // (spread preserves every current value) and override only the payment fields.
      await visitsApi.update(visit.id, {
        ...visit,
        commitmentNumber: form.values.commitmentNumber || undefined,
        commitmentExpiryDate: form.values.commitmentExpiryDate || undefined,
        exemptionReason: form.values.exemptionReason || undefined,
      });
      notifications.show({ message: 'פרטי התשלום נשמרו', color: 'green' });
    } catch (e) {
      notifications.show({
        message: `שגיאה בשמירה: ${e instanceof Error ? e.message : 'שגיאה לא ידועה'}`,
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDischarge = async () => {
    setDischarging(true);
    try {
      await visitsApi.updateStatus(visit.id, 'Discharged');
      // Refresh the board's source query so the discharged patient is gone on
      // arrival — don't rely on the 30s poll / a SignalR race to drop the row.
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
      notifications.show({ color: 'pine', message: 'המטופל שוחרר' });
      navigate('/reception?tab=discharge');
    } catch {
      notifications.show({ color: 'brick', message: 'שחרור המטופל נכשל' });
      setDischarging(false);
    }
  };

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between">
        <Title order={3}>שחרור מטופל</Title>
        <Button
          variant="subtle"
          leftSection={<IconArrowRight size={16} />}
          onClick={() => navigate('/reception?tab=discharge')}
        >
          חזרה ללוח השחרור
        </Button>
      </Group>

      {/* Identity header */}
      <Card withBorder p="md">
        <Group justify="space-between" wrap="wrap">
          <Group gap="lg" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed">מטופל</Text>
              <Text fw={700} size="lg">{fullName}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">ת.ז / מזהה</Text>
              <Text fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{p?.identityNumber ?? '—'}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">גיל</Text>
              <Text fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{calcAge(p?.birthDate)}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">מס׳ תור</Text>
              <Text fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>{visit.queueNumber}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">מחלקה</Text>
              {visit.receptionDepartment
                ? <Badge variant="light" color="steel">{visit.receptionDepartment}</Badge>
                : <Text>—</Text>}
            </Box>
            <Box>
              <Text size="xs" c="dimmed">סטטוס</Text>
              <Badge color={STATUS_COLOR[visit.status]} variant="light">{STATUS_LABEL[visit.status]}</Badge>
            </Box>
          </Group>
        </Group>
      </Card>

      {/* Patient details — full edit lives on the dedicated patient page */}
      <Card withBorder p="md">
        <Group justify="space-between">
          <Box>
            <Text fw={600}>פרטי מטופל</Text>
            <Text size="sm" c="dimmed">עדכון טלפון, כתובת, קופ״ח ושאר פרטי הכרטיס</Text>
          </Box>
          <Button
            variant="light"
            leftSection={<IconPencil size={16} />}
            onClick={() => navigate(`/patients/${visit.patientId}/edit`)}
          >
            ערוך פרטי מטופל
          </Button>
        </Group>
      </Card>

      {/* Payment */}
      <Card withBorder p="md">
        <Text fw={600} mb="sm">תשלום וגבייה</Text>
        <Grid>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <NumberInput
              label="סה״כ לגבייה מהמטופל (₪)"
              value={visit.totalToCollect ?? 0}
              readOnly
              styles={{ input: { backgroundColor: '#f8f9fa', cursor: 'not-allowed' } }}
              description="מחושב לפי סיבת קבלה וקופ״ח"
              // Keep the input aligned with the sibling fields: the help text goes
              // below the input rather than between label and input.
              inputWrapperOrder={['label', 'input', 'description', 'error']}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <TextInput label="מספר התחייבות" {...form.getInputProps('commitmentNumber')} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <DateField label="תוקף התחייבות" {...form.getInputProps('commitmentExpiryDate')} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea label="סיבת הפטור" rows={2} {...form.getInputProps('exemptionReason')} />
          </Grid.Col>
        </Grid>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" loading={saving} onClick={handleSavePayment}>
            שמור פרטי תשלום
          </Button>
        </Group>
      </Card>

      {/* Discharge action */}
      <Card withBorder p="md">
        <Group justify="space-between" wrap="wrap">
          <Box>
            <Text fw={600}>שחרור</Text>
            <Text size="sm" c="dimmed">
              {alreadyDischarged ? 'המטופל כבר שוחרר.' : 'סיום הביקור והסרת המטופל מהתור הפעיל.'}
            </Text>
          </Box>
          <Button
            color="pine"
            leftSection={<IconLogout size={16} />}
            disabled={alreadyDischarged}
            onClick={() => setConfirmOpen(true)}
          >
            שחרר מטופל
          </Button>
        </Group>
      </Card>

      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="שחרור מטופל" centered>
        <Stack gap="sm">
          <Text size="sm">
            לשחרר את {fullName} (מס׳ תור {visit.queueNumber})? המטופל יוסר מהתור הפעיל.
          </Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="slate" onClick={() => setConfirmOpen(false)}>ביטול</Button>
            <Button color="pine" loading={discharging} leftSection={<IconLogout size={16} />} onClick={handleDischarge}>
              שחרר מטופל
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function calcAge(birthDate?: string): string {
  if (!birthDate) return '—';
  const diff = Date.now() - new Date(birthDate).getTime();
  return `${Math.floor(diff / (1000 * 60 * 60 * 24 * 365))}`;
}
