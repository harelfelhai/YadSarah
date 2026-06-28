import { useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Group, Loader } from '@mantine/core';
import { IconArrowRight, IconList, IconPrinter, IconWriting } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { visitsApi } from '../../api/visits';
import { formsApi } from '../../api/forms';
import { useAuthStore } from '../../store/auth';
import { hasAnyRole, isClinicalStaff } from '../../constants/roles';
import { buildFormDocument } from './formDocument';
import type { MedicalForm } from '../../types';

/**
 * Standalone, print-ready PDF-style view of a visit's medical form (filled fields only).
 * The document is rendered on the fly inside an isolated iframe — nothing is stored as a PDF.
 * `?print=1` opens the print dialog automatically (used after signing).
 */
export default function VisitSummaryPage() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const autoPrint = params.get('print') === '1';
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roles = useAuthStore((s) => s.user?.roles);
  const isDoctor = hasAnyRole(roles, 'Doctor');

  const { data: visit, isLoading: visitLoading } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => visitsApi.getById(visitId!),
    enabled: !!visitId,
  });

  const { data: forms = [], isLoading: formsLoading, isError: formsError } = useQuery({
    queryKey: ['visit-forms', visitId],
    queryFn: () => formsApi.getByVisit(visitId!),
    enabled: !!visitId,
    retry: false,
  });

  // Prefer the signed form; otherwise the first form on the visit.
  const form: MedicalForm | undefined =
    (forms as MedicalForm[]).find((f) => f.isSigned) ?? (forms as MedicalForm[])[0];

  const html = visit && form ? buildFormDocument(form, visit) : '';

  const print = () => iframeRef.current?.contentWindow?.print();

  // Auto-open the print dialog EXACTLY ONCE, when the document iframe has rendered. The iframe uses
  // `srcDoc`, so onLoad fires once the html is ready (covering "html arrives after mount" too) — the
  // printedRef guard then prevents a second dialog from any extra onLoad / re-render. The manual
  // "הדפסה" button below calls print() directly and is intentionally NOT gated by this guard.
  const printedRef = useRef(false);
  const onFrameLoad = () => {
    if (autoPrint && html && !printedRef.current) {
      printedRef.current = true;
      setTimeout(print, 250);
    }
  };

  const loading = visitLoading || formsLoading;

  return (
    <Box p="md" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Group justify="space-between" mb="md" className="no-print">
        <Button variant="subtle" leftSection={<IconArrowRight size={16} />} onClick={() => navigate(-1)}>
          חזרה
        </Button>
        <Group gap="sm">
          {/* Back to the live queue board (distinct from "חזרה" which steps back to the form). */}
          <Button
            variant="light"
            color="steel"
            leftSection={<IconList size={16} />}
            onClick={() => navigate('/queue')}
          >
            חזור לתור
          </Button>
          {/* Unsigned form → edit it directly, exactly like a patient in the queue. */}
          {form && !form.isSigned && isClinicalStaff(roles) && (
            <Button
              variant="light"
              leftSection={<IconWriting size={16} />}
              onClick={() => navigate(`/visits/${visitId}`)}
            >
              עריכת הטופס
            </Button>
          )}
          {/* Signed form → append a separately-signed addendum (doctors only). */}
          {isDoctor && form?.isSigned && (
            <Button
              variant="light"
              color="orange"
              leftSection={<IconWriting size={16} />}
              onClick={() => navigate(`/visits/${visitId}`)}
            >
              הוסף תוספת לאחר חתימה
            </Button>
          )}
          {html && (
            <Button leftSection={<IconPrinter size={16} />} onClick={print}>
              הדפסה
            </Button>
          )}
        </Group>
      </Group>

      {loading ? (
        <Box ta="center" py="xl"><Loader /></Box>
      ) : !visit ? (
        <Alert color="red">הביקור לא נמצא.</Alert>
      ) : !form ? (
        <Alert color={formsError ? 'orange' : 'gray'}>
          {formsError
            ? 'אין הרשאה לצפות בטופס הקליני של ביקור זה.'
            : 'לא קיים טופס רפואי לביקור זה.'}
        </Alert>
      ) : (
        <iframe
          ref={iframeRef}
          title="סיכום ביקור"
          srcDoc={html}
          onLoad={onFrameLoad}
          style={{ width: '100%', height: 'calc(100vh - 120px)', border: '1px solid #dee2e6', borderRadius: 8, background: '#fff' }}
        />
      )}
    </Box>
  );
}
