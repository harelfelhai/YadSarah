import { useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth';
import {
  Title, Button, Table, Badge, Group, Modal, TextInput, Select, MultiSelect,
  Checkbox, Text, SimpleGrid, Divider, Stack,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { usersApi, type CreateUserPayload, type UpdateUserPayload } from '../../api/users';
import { DEPARTMENTS } from '../../constants/departments';
import { STATIONS } from '../../constants/careSteps';
import { ROLE_OPTIONS, rolesLabel, isAdmin as isAdminRoles, canManageUsers } from '../../constants/roles';
import type { User, UserRole } from '../../types';

const GENDERS = [
  { value: 'זכר', label: 'זכר' },
  { value: 'נקבה', label: 'נקבה' },
  { value: 'אחר', label: 'אחר' },
];

const TITLES = ['ד"ר', 'פרופ׳', 'מר', 'גב׳'];

interface FormValues {
  firstName: string;
  lastName: string;
  displayName: string;
  username: string;
  password: string;
  roles: UserRole[];
  isActive: boolean;
  identityNumber: string;
  gender: string;
  title: string;
  licenseNumber: string;
  specialistLicenseNumber: string;
  employeeNumber: string;
  mobile: string;
  email: string;
  department: string;
  station: string;
}

const EMPTY_FORM: FormValues = {
  firstName: '', lastName: '', displayName: '', username: '', password: '',
  roles: [], isActive: true, identityNumber: '', gender: '', title: '',
  licenseNumber: '', specialistLicenseNumber: '', employeeNumber: '',
  mobile: '', email: '', department: '', station: '',
};

export default function AdminPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const canCreate = isAdminRoles(currentUser?.roles);
  const canEdit = canManageUsers(currentUser?.roles);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // #5 — search + filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && !u.roles?.includes(roleFilter as UserRole)) return false;
      if (deptFilter && u.department !== deptFilter) return false;
      if (!q) return true;
      const hay = [
        u.displayName, u.fullName, u.username, u.identityNumber,
        u.mobile, u.employeeNumber, u.email,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [users, search, roleFilter, deptFilter]);

  const form = useForm<FormValues>({
    initialValues: EMPTY_FORM,
    validate: {
      firstName: (v) => (v.trim() ? null : 'שם פרטי חובה'),
      lastName: (v) => (v.trim() ? null : 'שם משפחה חובה'),
      username: (v) => (v.trim() ? null : 'שם משתמש חובה'),
      roles: (v) => (v.length > 0 ? null : 'יש לבחור סיווג מקצועי אחד לפחות'),
      password: (v) => {
        if (!editingId && !v.trim()) return 'סיסמה חובה';
        if (v && v.length < 8) return 'סיסמה חייבת להיות לפחות 8 תווים';
        return null;
      },
      email: (v) => (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? 'דוא"ל אינו תקין' : null),
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

  const openCreate = () => {
    setEditingId(null);
    form.setValues(EMPTY_FORM);
    setModalOpen(true);
  };

  // #3 — clicking a row opens the user for view/edit.
  const openEdit = (u: User) => {
    if (!canEdit) return;
    setEditingId(u.id);
    form.setValues({
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      displayName: u.displayName ?? '',
      username: u.username,
      password: '',
      roles: u.roles ?? [],
      isActive: u.isActive,
      identityNumber: u.identityNumber ?? '',
      gender: u.gender ?? '',
      title: u.title ?? '',
      licenseNumber: u.licenseNumber ?? '',
      specialistLicenseNumber: u.specialistLicenseNumber ?? '',
      employeeNumber: u.employeeNumber ?? '',
      mobile: u.mobile ?? '',
      email: u.email ?? '',
      department: u.department ?? '',
      station: u.station ?? '',
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
      roles: vals.roles,
      displayName: optional(vals.displayName),
      identityNumber: optional(vals.identityNumber),
      gender: optional(vals.gender),
      title: optional(vals.title),
      licenseNumber: optional(vals.licenseNumber),
      specialistLicenseNumber: optional(vals.specialistLicenseNumber),
      employeeNumber: optional(vals.employeeNumber),
      mobile: optional(vals.mobile),
      email: optional(vals.email),
      department: optional(vals.department),
      station: optional(vals.station),
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
        {canCreate && (
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            משתמש חדש
          </Button>
        )}
      </Group>

      {/* #5 — search + filters */}
      <Group align="flex-end" gap="sm" mb="md" wrap="wrap">
        <TextInput
          placeholder="חיפוש לפי שם / ת״ז / טלפון / מס׳ עובד / שם משתמש"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          flex={1}
          miw={260}
        />
        <Select
          label="סיווג"
          placeholder="הכל"
          data={ROLE_OPTIONS}
          value={roleFilter}
          onChange={setRoleFilter}
          clearable
          w={170}
        />
        <Select
          label="מחלקה"
          placeholder="הכל"
          data={[...DEPARTMENTS]}
          value={deptFilter}
          onChange={setDeptFilter}
          clearable
          w={170}
        />
      </Group>

      {isLoading ? (
        <Text c="dimmed">טוען...</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>שם</Table.Th>
              <Table.Th>שם משתמש</Table.Th>
              <Table.Th>סיווג מקצועי</Table.Th>
              <Table.Th>מחלקה</Table.Th>
              <Table.Th>טלפון</Table.Th>
              <Table.Th>כניסה אחרונה</Table.Th>
              <Table.Th>סטטוס</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((u) => (
              <Table.Tr
                key={u.id}
                opacity={u.isActive ? 1 : 0.5}
                onClick={() => openEdit(u)}
                style={{ cursor: canEdit ? 'pointer' : 'default' }}
              >
                <Table.Td>{u.displayName || u.fullName}</Table.Td>
                <Table.Td>{u.username}</Table.Td>
                <Table.Td>{rolesLabel(u.roles)}</Table.Td>
                <Table.Td>{u.department ?? '—'}</Table.Td>
                <Table.Td>{u.mobile || '—'}</Table.Td>
                <Table.Td>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('he-IL') : '—'}
                </Table.Td>
                <Table.Td>
                  <Badge color={u.isActive ? 'green' : 'gray'} size="sm">
                    {u.isActive ? 'פעיל' : 'לא פעיל'}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
            {filtered.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text c="dimmed" ta="center" py="sm">לא נמצאו משתמשים תואמים</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}

      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={editingId ? 'פרטי משתמש' : 'משתמש חדש'}
        size="xl"
        dir="rtl"
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="xs">
            {/* Identity */}
            <SimpleGrid cols={3} spacing="xs">
              <TextInput label="שם פרטי" required {...form.getInputProps('firstName')} />
              <TextInput label="שם משפחה" required {...form.getInputProps('lastName')} />
              <TextInput
                label="שם בתצוגה"
                placeholder={`${form.values.firstName} ${form.values.lastName}`.trim() || 'ברירת מחדל: שם + משפחה'}
                {...form.getInputProps('displayName')}
              />
            </SimpleGrid>

            <SimpleGrid cols={3} spacing="xs">
              <TextInput label="ת.ז" {...form.getInputProps('identityNumber')} />
              <Select label="מין" data={GENDERS} clearable {...form.getInputProps('gender')} />
              <Select label="תואר" data={TITLES} clearable {...form.getInputProps('title')} />
            </SimpleGrid>

            <SimpleGrid cols={3} spacing="xs">
              <TextInput label="מספר רישיון" {...form.getInputProps('licenseNumber')} />
              <TextInput label="מספר רישיון מומחה (מרמ)" {...form.getInputProps('specialistLicenseNumber')} />
              <TextInput label="מספר עובד" {...form.getInputProps('employeeNumber')} />
            </SimpleGrid>

            <SimpleGrid cols={3} spacing="xs">
              <TextInput label="טלפון נייד" {...form.getInputProps('mobile')} />
              <TextInput label="דוא״ל" {...form.getInputProps('email')} />
              <Select label="מחלקה" data={[...DEPARTMENTS]} clearable {...form.getInputProps('department')} />
              <Select
                label="תחנה"
                description="לאיש-צוות תחנה (מעבדה/דימות) — קובע למי בתור מיועדים 'קרא'/'הכנס' של אותה תחנה"
                data={[...STATIONS]}
                clearable
                {...form.getInputProps('station')}
              />
            </SimpleGrid>

            <MultiSelect
              label="סיווג מקצועי"
              description="קובע את ההרשאות; ניתן לבחור כמה"
              data={ROLE_OPTIONS}
              required
              searchable
              {...form.getInputProps('roles')}
            />

            <Divider label="פרטי כניסה" labelPosition="center" />

            <SimpleGrid cols={3} spacing="xs">
              <TextInput label="שם משתמש" required {...form.getInputProps('username')} />
              <TextInput
                label={editingId ? 'סיסמה חדשה (ריק = ללא שינוי)' : 'סיסמה'}
                type="password"
                required={!editingId}
                {...form.getInputProps('password')}
              />
              <Checkbox
                label="אפשר כניסה"
                mt="xl"
                {...form.getInputProps('isActive', { type: 'checkbox' })}
              />
            </SimpleGrid>

            {editingId && (() => {
              const u = users.find((x) => x.id === editingId);
              if (!u) return null;
              return (
                <Text size="xs" c="dimmed">
                  כניסה אחרונה: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('he-IL') : '—'}
                </Text>
              );
            })()}

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={closeModal}>ביטול</Button>
              <Button type="submit" loading={createMut.isPending || updateMut.isPending}>
                {editingId ? 'שמור' : 'צור משתמש'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
