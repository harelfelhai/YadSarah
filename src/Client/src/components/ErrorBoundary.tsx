import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { reportClientError } from '../api/errors';

interface Props {
  children: ReactNode;
  /** Shown above the reset button. */
  title?: string;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time exceptions in its subtree so a single broken section (e.g. an unexpected
 * data shape while saving) can never white-screen the whole app — critical for a clinical form
 * mid-treatment. Shows a contained, recoverable panel and logs the error to the console. Reset
 * clears the error so the subtree re-renders with the latest (server-reconciled) state.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
    // Ship the crash to the server log so an operator can SEE it (Render) instead of it dying in the
    // user's console. Best-effort — reportClientError never throws and never blocks.
    reportClientError({
      message: error.message,
      stack: error.stack ?? undefined,
      componentStack: info.componentStack ?? undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <Alert
          color="brick"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
          title={this.props.title ?? 'אירעה שגיאה בלתי צפויה'}
          m="md"
        >
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              משהו השתבש בהצגת רכיב זה. הנתונים שלך נשמרים בשרת — אפשר לנסות שוב, ואם הבעיה חוזרת לרענן את הדף.
            </Text>
            <Text size="xs" c="dimmed" style={{ direction: 'ltr', whiteSpace: 'pre-wrap' }}>
              {this.state.error.message}
            </Text>
            <Button size="xs" variant="light" color="slate" onClick={this.reset}>
              נסה שוב
            </Button>
          </Stack>
        </Alert>
      );
    }
    return this.props.children;
  }
}
