import { useState } from 'react';
import { useAuthStore } from '../../store/auth';
import {
  Title, Button, Table, Badge, Group, Modal, TextInput, Select, Textarea,
  Checkbox, Text, ActionIcon, Tooltip, SimpleGrid, Divider, Stack,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus, IconEdit, IconRefresh } from '@tabler/icons-react';
import { usersApi, type CreateUserPayload, type UpdateUserPayload } from '../../api/users';
import { DEPARTMENTS } from '../../constants/departments';
import type { User, UserRole } from '../../types';
import DateField from '../../components/DateField';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'Reception', label: 'קבלה' },
  { value: 'Nurse', label: 'אחות' },
  { value: 'Doctor', label: 'רופא' },
  { value: 'ShiftManager', label: 'מנהל משמרת' },
  { value: 'Admin', label: 'מנהל מערכת' },
];

const GENDERS = [
  { value: 'זכר', label: 'זכר' },
  { value: 'נקבה', label: 'נקבה' },
  { value: 'אחר', label: 'אחר' },
];

interface FormValues {
  firstName: string;
  lastName: string;
  username: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  identityNumber: string;
  gender: string;
  dateOfBirth: string;
  phone: string;
  mobile: string;
  primaryJobTitle: string;
  secondaryJobTitle: string;
  department: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
  notes: string;
  accountExpiresAt: string;
}

const EMPTY_FORM: FormValues = {
  firstName: '',
  lastName: '',
  username: '',
  password: '',
  role: 'Nurse',
  isActive: true,
  identityNumber: '',
  gender: '',
  dateOfBirth: '',
  phone: '',
  mobile: '',
  primaryJobTitle: '',
  secondaryJobTitle: '',
  department: '',
  address: '',
  city: '',
  zipCode: '',
  country: 'ישראל',
  notes: '',
  accountExpiresAt: '',
};

function roleBadge(role: UserRole) {
  const colors: Record<UserRole, string> = {
    Admin: 'red', Doctor: 'blue', Nurse: 'teal', Reception: 'orange', ShiftManager: 'grape',
  };
  const labels: Record<UserRole, string> = {
    Admin: 'מנהל', Doctor: 'רופא', Nurse: 'אחות', Reception: 'קבלה', ShiftManager: 'מנהל משמרת',
  };
  return <Badge color={colors[role]} size="sm">{labels[role]}</Badge>;
}

export default function AdminPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'Admin';
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
  });

  const form = useForm<FormValues>({
    initialValues: EMPTY_FORM,
    validate: {
      firstName: (v) => v.trim() ? null : 'שם פרטי חובה',
      lastName: (v) => v.trim() ? null : 'שם משפחה חובה',
      username: (v) => v.trim() ? null : 'שם משתמש חובה',
      password: (v) => {
        if (!editingId && !v.trim()) return 'סיסמה חובה';
        if (v && v.length < 8) return 'סיסמה חייבת להיות לפחות 8 תווים';
        return null;
      },
    },
  });

  const createMut = useMutation({
    mutationFn: (p: CreateUserPayload) => usersApi.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ message: 'המשתמש נוצר בהצלחה', color: 'green' });
      closeModal();
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: UpdateUserPayload }) => usersApi.update(id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ message: 'המשתמש עודכן בהצלחה', color: 'green' });
      closeModal();
    },
    onError: (e: Error) => notifications.show({ message: e.message, color: 'red' }),
  });

  const resetMut = useMutation({
    mutationFn: (id: string) => usersApi.resetFailures(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ message: 'שגיאות הכניסה אופסו', color: 'teal' });
    },
  });

  const openCreate = () => {
    setEditingId(null);
    form.setValues(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditingId(u.id);
    form.setValues({
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      username: u.username,
      password: '',
      role: u.role,
      isActive: u.isActive,
      identityNumber: u.identityNumber ?? '',
      gender: u.gender ?? '',
      dateOfBirth: u.dateOfBirth ? u.dateOfBirth.slice(0, 10) : '',
      phone: u.phone ?? '',
      mobile: u.mobile ?? '',
      primaryJobTitle: u.primaryJobTitle ?? '',
      secondaryJobTitle: u.secondaryJobTitle ?? '',
      department: u.department ?? '',
      address: u.address ?? '',
      city: u.city ?? '',
      zipCode: u.zipCode ?? '',
      country: u.country ?? 'ישראל',
      notes: u.notes ?? '',
      accountExpiresAt: u.accountExpiresAt ? u.accountExpiresAt.slice(0, 10) : '',
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    form.reset();
  };

  const handleSubmit = (vals: FormValues) => {
    const optional = (s: string) => s.trim() || undefined;
    const base = {
      firstName: vals.firstName.trim(),
      lastName: vals.lastName.trim(),
      username: vals.username.trim(),
      role: vals.role,
      identityNumber: optional(vals.identityNumber),
      gender: optional(vals.gender),
      dateOfBirth: optional(vals.dateOfBirth),
      phone: optional(vals.phone),
      mobile: optional(vals.mobile),
      primaryJobTitle: optional(vals.primaryJobTitle),
      secondaryJobTitle: optional(vals.secondaryJobTitle),
      department: optional(vals.department),
      address: optional(vals.address),
      city: optional(vals.city),
      zipCode: optional(vals.zipCode),
      country: optional(vals.country) ?? 'ישראל',
      notes: optional(vals.notes),
      accountExpiresAt: optional(vals.accountExpiresAt),
    };

    if (editingId) {
      updateMut.mutate({
        id: editingId,
        p: { ...base, isActive: vals.isActive, newPassword: optional(vals.password) },
      });
    } else {
      createMut.mutate({ ...base, password: vals.password });
    }
  };

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>ניהול משתמשים</Title>
        {isAdmin && (
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            משתמש חדש
          </Button>
        )}
      </Group>

      {isLoading ? (
        <Text c="dimmed">טוען...</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>שם מלא</Table.Th>
              <Table.Th>שם משתמש</Table.Th>
              <Table.Th>תפקיד</Table.Th>
              <Table.Th>מחלקה</Table.Th>
              <Table.Th>טלפון</Table.Th>
              <Table.Th>כניסה אחרונה</Table.Th>
              <Table.Th>שגיאות</Table.Th>
              <Table.Th>סטטוס</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((u) => (
              <Table.Tr key={u.id} opacity={u.isActive ? 1 : 0.5}>
                <Table.Td>{u.fullName}</Table.Td>
                <Table.Td>{u.username}</Table.Td>
                <Table.Td>{roleBadge(u.role)}</Table.Td>
                <Table.Td>{u.department ?? '—'}</Table.Td>
                <Table.Td>{u.mobile || u.phone || '—'}</Table.Td>
                <Table.Td>
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString('he-IL')
                    : '—'}
                </Table.Td>
                <Table.Td>
                  {u.loginFailureCount > 0 ? (
                    <Badge color="red" size="sm">{u.loginFailureCount}</Badge>
                  ) : '0'}
                </Table.Td>
                <Table.Td>
                  <Badge color={u.isActive ? 'green' : 'gray'} size="sm">
                    {u.isActive ? 'פעיל' : 'לא פעיל'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="עריכה">
                      <ActionIcon variant="subtle" onClick={() => openEdit(u)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {u.loginFailureCount > 0 && (
                      <Tooltip label="אפס שגיאות כניסה">
                        <ActionIcon
                          variant="subtle"
                          color="orange"
                          onClick={() => resetMut.mutate(u.id)}
                        >
                          <IconRefresh size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={editingId ? 'עריכת משתמש' : 'משתמש חדש'}
        size="xl"
        dir="rtl"
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            {/* Row 1: Name + login */}
            <SimpleGrid cols={5} spacing="xs">
              <TextInput label="שם פרטי" required {...form.getInputProps('firstName')} />
              <TextInput label="שם משפחה" required {...form.getInputProps('lastName')} />
              <TextInput label="שם משתמש" required {...form.getInputProps('username')} />
              <TextInput
                label={editingId ? 'סיסמה חדשה (ריק = ללא שינוי)' : 'סיסמה'}
                type="password"
                required={!editingId}
                {...form.getInputProps('password')}
              />
              <Select
                label="תפקיד מערכת"
                data={ROLES}
                required
                {...form.getInputProps('role')}
              />
            </SimpleGrid>

            {/* Row 2: Personal details */}
            <SimpleGrid cols={5} spacing="xs">
              <TextInput label="ת.ז" {...form.getInputProps('identityNumber')} />
              <Select
                label="מין"
                data={GENDERS}
                clearable
                {...form.getInputProps('gender')}
              />
              <DateField
                label="ת. לידה"
                {...form.getInputProps('dateOfBirth')}
              />
              <TextInput label="טלפון" {...form.getInputProps('phone')} />
              <TextInput label="נייד" {...form.getInputProps('mobile')} />
            </SimpleGrid>

            {/* Row 3: Job */}
            <SimpleGrid cols={5} spacing="xs">
              <TextInput label="תפקיד עיקרי" {...form.getInputProps('primaryJobTitle')} />
              <TextInput label="תפקיד משני" {...form.getInputProps('secondaryJobTitle')} />
              <Select label="מחלקה עיקרית" data={[...DEPARTMENTS]} clearable {...form.getInputProps('department')} />
              <Checkbox
                label="אפשר כניסה"
                mt="xl"
                {...form.getInputProps('isActive', { type: 'checkbox' })}
              />
              <DateField
                label="תוקף חשבון"
                {...form.getInputProps('accountExpiresAt')}
              />
            </SimpleGrid>

            {/* Row 4: Address */}
            <SimpleGrid cols={4} spacing="xs">
              <TextInput label="כתובת" {...form.getInputProps('address')} />
              <TextInput label="עיר" {...form.getInputProps('city')} />
              <TextInput label="מיקוד" {...form.getInputProps('zipCode')} />
              <TextInput label="ארץ" {...form.getInputProps('country')} />
            </SimpleGrid>

            {/* Read-only info when editing */}
            {editingId && (() => {
              const u = users.find((x) => x.id === editingId);
              if (!u) return null;
              return (
                <SimpleGrid cols={2} spacing="xs">
                  <TextInput
                    label="כניסה אחרונה"
                    readOnly
                    value={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('he-IL') : '—'}
                  />
                  <TextInput
                    label="שגיאות כניסה"
                    readOnly
                    value={String(u.loginFailureCount)}
                  />
                </SimpleGrid>
              );
            })()}

            <Divider />
            <Textarea
              label="הערות"
              autosize
              minRows={2}
              {...form.getInputProps('notes')}
            />

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={closeModal}>ביטול</Button>
              <Button
                type="submit"
                loading={createMut.isPending || updateMut.isPending}
              >
                {editingId ? 'שמור' : 'צור משתמש'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
