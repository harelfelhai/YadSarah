import { useSearchParams } from 'react-router-dom';
import { Stack, Tabs, Title } from '@mantine/core';
import { IconUserPlus, IconLogout } from '@tabler/icons-react';
import ReceptionPage from './ReceptionPage';
import DischargeBoard from './DischargeBoard';

// The reception desk owns both ends of the patient flow: admission (intake) and
// discharge (release). Each is a tab; the active tab lives in the URL (?tab=)
// so a refresh — and the discharge sub-page's "back" — restore the right tab.
type DeskTab = 'admit' | 'discharge';

export default function ReceptionDeskPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: DeskTab = searchParams.get('tab') === 'discharge' ? 'discharge' : 'admit';

  const setTab = (value: string | null) => {
    const next = value === 'discharge' ? 'discharge' : 'admit';
    const sp = new URLSearchParams(searchParams);
    if (next === 'admit') sp.delete('tab');
    else sp.set('tab', next);
    setSearchParams(sp, { replace: true });
  };

  return (
    <Stack gap="md" p="md">
      <Title order={3}>קבלה ושחרור</Title>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List mb="md">
          <Tabs.Tab value="admit" leftSection={<IconUserPlus size={16} />}>
            קבלת מטופל
          </Tabs.Tab>
          <Tabs.Tab value="discharge" leftSection={<IconLogout size={16} />}>
            שחרור מטופל
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="admit">
          <ReceptionPage />
        </Tabs.Panel>
        <Tabs.Panel value="discharge">
          <DischargeBoard />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
