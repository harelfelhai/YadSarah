import { useSearchParams } from 'react-router-dom';
import { Group, Stack, Tabs, Title } from '@mantine/core';
import { IconUserPlus, IconLogout, IconDeviceMobileMessage } from '@tabler/icons-react';
import ReceptionPage from './ReceptionPage';
import DischargeBoard from './DischargeBoard';
import IntakeReviewBoard from './IntakeReviewBoard';
import IntakeQrButton from './IntakeQrButton';

// The reception desk owns both ends of the patient flow: admission (intake) and
// discharge (release), plus review of patient-submitted self-service forms. Each is a
// tab; the active tab lives in the URL (?tab=) so a refresh — and the discharge
// sub-page's "back" — restore the right tab.
type DeskTab = 'admit' | 'discharge' | 'intake';

function parseTab(raw: string | null): DeskTab {
  return raw === 'discharge' || raw === 'intake' ? raw : 'admit';
}

export default function ReceptionDeskPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));

  const setTab = (value: string | null) => {
    const next = parseTab(value);
    const sp = new URLSearchParams(searchParams);
    if (next === 'admit') sp.delete('tab');
    else sp.set('tab', next);
    setSearchParams(sp, { replace: true });
  };

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={3}>קבלה ושחרור</Title>
        <IntakeQrButton />
      </Group>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="admit" leftSection={<IconUserPlus size={16} />}>
            קבלת מטופל
          </Tabs.Tab>
          <Tabs.Tab value="discharge" leftSection={<IconLogout size={16} />}>
            שחרור מטופל
          </Tabs.Tab>
          <Tabs.Tab value="intake" leftSection={<IconDeviceMobileMessage size={16} />}>
            טפסים מקוונים
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="admit">
          <ReceptionPage />
        </Tabs.Panel>
        <Tabs.Panel value="discharge">
          <DischargeBoard />
        </Tabs.Panel>
        <Tabs.Panel value="intake">
          <IntakeReviewBoard />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
