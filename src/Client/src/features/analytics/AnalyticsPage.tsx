import { useMemo, useState } from 'react';
import {
  Alert, Box, Card, Center, Group, Loader, SegmentedControl, Stack, Text, Title,
} from '@mantine/core';
import { BarChart, AreaChart } from '@mantine/charts';
import { IconLock, IconCalendarWeek, IconClockHour4, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../api/analytics';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole } from '../../constants/roles';

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// Local calendar date (browser ≈ Israel for these users) as YYYY-MM-DD.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rangeDates(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: ymd(from), to: ymd(to) };
}

// recharts is LTR-native; rendering the chart LTR keeps the time/weekday axis reading
// naturally (morning → night, ראשון → שבת) inside the RTL page.
function ChartFrame({ children }: { children: React.ReactNode }) {
  return <Box dir="ltr">{children}</Box>;
}

function ChartCard({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card withBorder radius="md" padding="lg">
      <Group gap="xs" mb={4}>
        {icon}
        <Title order={4}>{title}</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">{hint}</Text>
      <ChartFrame>{children}</ChartFrame>
    </Card>
  );
}

export default function AnalyticsPage() {
  const roles = useAuthStore((s) => s.user?.roles);
  const canAccess = hasAnyRole(roles, 'Admin', 'ShiftManager');
  const [days, setDays] = useState('30');
  const { from, to } = useMemo(() => rangeDates(Number(days)), [days]);

  const { data, isLoading } = useQuery({
    queryKey: ['analytics-overview', from, to],
    queryFn: () => analyticsApi.overview(from, to),
    enabled: canAccess,
    staleTime: 60_000,
  });

  if (!canAccess) {
    return (
      <Box p="md">
        <Alert icon={<IconLock size={16} />} color="red" title="אין הרשאה">
          מסך ניתוח הנתונים נגיש למנהל משמרת ולמנהל מערכת בלבד.
        </Alert>
      </Box>
    );
  }

  const weekdayData = (data?.patientsByWeekday ?? []).map((p) => ({
    day: WEEKDAYS[p.weekday] ?? String(p.weekday),
    'מטופלים בממוצע': p.avgPerDay,
  }));
  const arrivalsData = (data?.arrivalsByHalfHour ?? []).map((p) => ({
    time: p.label,
    'הגעות בממוצע': p.avgPerDay,
  }));
  const censusData = (data?.censusByHalfHour ?? []).map((p) => ({
    time: p.label,
    'נוכחים בממוצע': p.avg,
  }));

  return (
    <Box p="md">
      <Group justify="space-between" align="center" mb="lg" wrap="wrap">
        <Title order={2}>ניתוח נתונים</Title>
        <Group gap="sm">
          <Text size="sm" c="dimmed">טווח:</Text>
          <SegmentedControl
            value={days}
            onChange={setDays}
            data={[
              { label: '7 ימים', value: '7' },
              { label: '30 יום', value: '30' },
              { label: '90 יום', value: '90' },
            ]}
          />
        </Group>
      </Group>

      {isLoading ? (
        <Center mih={300}><Loader /></Center>
      ) : (
        <Stack gap="lg">
          <ChartCard
            icon={<IconCalendarWeek size={20} />}
            title="מטופלים לפי יום בשבוע"
            hint="ממוצע מספר המטופלים שהגיעו, מקובץ לפי יום בשבוע — חושף עומס שבועי קבוע."
          >
            <BarChart
              h={300}
              data={weekdayData}
              dataKey="day"
              series={[{ name: 'מטופלים בממוצע', color: 'steel.6' }]}
              tickLine="y"
              gridAxis="y"
            />
          </ChartCard>

          <ChartCard
            icon={<IconClockHour4 size={20} />}
            title="הגעות לפי שעה (חצי-שעה)"
            hint="ממוצע ליום של מספר ההגעות בכל חצי-שעה — שעות השיא של הקבלה."
          >
            <AreaChart
              h={300}
              data={arrivalsData}
              dataKey="time"
              series={[{ name: 'הגעות בממוצע', color: 'moss.6' }]}
              curveType="monotone"
              withDots={false}
              gridAxis="y"
              xAxisProps={{ interval: 3 }}
            />
          </ChartCard>

          <ChartCard
            icon={<IconUsersGroup size={20} />}
            title="נוכחות בו-זמנית לפי שעה (חצי-שעה)"
            hint="ממוצע מספר המטופלים ששהו במערכת בו-זמנית בכל חצי-שעה (מהגעה ועד שחרור) — הבסיס להתאמת כוח האדם."
          >
            <AreaChart
              h={300}
              data={censusData}
              dataKey="time"
              series={[{ name: 'נוכחים בממוצע', color: 'brick.6' }]}
              curveType="monotone"
              withDots={false}
              gridAxis="y"
              xAxisProps={{ interval: 3 }}
            />
          </ChartCard>
        </Stack>
      )}
    </Box>
  );
}
