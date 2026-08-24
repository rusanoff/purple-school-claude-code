'use client';

import { Alert, Button, Card, EmptyState, Spinner } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { APP_NAME } from '@/components/brand';
import {
  CalendarIcon,
  LogOutIcon,
  UsersIcon,
  VideoIcon,
} from '@/components/icons';
import {
  ApiError,
  clearAccessToken,
  getAccessToken,
  getCurrentUserEmail,
} from '@/lib/auth';
import { formatMeetingDate } from '@/lib/format';
import { getMeetings, type Meeting } from '@/lib/meetings';

/** How many of the newest meetings show up in the "Recent meetings" widget. */
const RECENT_MEETINGS_COUNT = 3;

function MeetingCard({ meeting }: { meeting: Meeting }) {
  return (
    <Link className="block min-w-0" href={`/meetings/${meeting.id}`}>
      <Card className="hover:border-accent min-w-0 gap-3 p-5 transition-colors">
        <h3 className="truncate font-medium">{meeting.title}</h3>
        <div className="text-muted flex min-w-0 items-center gap-1.5 text-sm">
          <span className="shrink-0">
            <CalendarIcon />
          </span>
          <span className="truncate">{formatMeetingDate(meeting.date)}</span>
        </div>
        <div className="text-muted flex min-w-0 items-center gap-1.5 text-sm">
          <span className="shrink-0">
            <UsersIcon />
          </span>
          <span className="min-w-0 truncate">
            {meeting.participants.join(', ')}
          </span>
        </div>
      </Card>
    </Link>
  );
}

export default function Home() {
  const router = useRouter();

  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared by the initial load and the "Retry" button after a failed fetch.
  // No `setState` call happens before the `await` — an effect must not set
  // state synchronously in its own body, and this is called straight from one.
  const loadMeetings = useCallback(
    async (token: string) => {
      try {
        const data = await getMeetings(token);
        setMeetings(data);
        setError(null);
      } catch (cause) {
        // An expired/invalid token means the session is over — send the user
        // back to sign in rather than showing an error they can't act on.
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          router.replace('/login');
          return;
        }

        setError(
          cause instanceof ApiError ? cause.message : 'Something went wrong.',
        );
      } finally {
        setStatus('ready');
      }
    },
    [router],
  );

  useEffect(() => {
    const token = getAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    // The auth token only exists in `localStorage`, so this fetch can only
    // start once mounted in the browser — there is no server-renderable data
    // for this route to defer to instead, so `loadMeetings` sets state async
    // from here rather than synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMeetings(token);
  }, [loadMeetings, router]);

  const handleLogout = () => {
    clearAccessToken();
    router.replace('/login');
  };

  const handleRetry = () => {
    const token = getAccessToken();

    // Same as the mount effect: no token means the session ended (e.g. a
    // logout in another tab) since the last render, so send the user back
    // to sign in instead of leaving a Retry button that does nothing.
    if (!token) {
      router.replace('/login');
      return;
    }

    setStatus('checking');
    void loadMeetings(token);
  };

  // Auth is verified client-side (the token lives in localStorage), so the
  // page renders nothing meaningful until that check has actually run —
  // avoids a flash of the dashboard before a missing token redirects away.
  if (status === 'checking') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner aria-label="Loading" size="lg" />
      </main>
    );
  }

  // Safe to read `localStorage` directly here (no state needed): this only
  // renders once `status` is 'ready', which happens after the mount effect
  // above has already confirmed we're running in the browser.
  const email = getCurrentUserEmail();
  const recentMeetings = meetings?.slice(0, RECENT_MEETINGS_COUNT) ?? [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-accent text-accent-foreground flex size-10 items-center justify-center rounded-2xl shadow-sm">
            <VideoIcon />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            {APP_NAME}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          {email && (
            <span className="text-muted hidden max-w-[16rem] truncate text-sm sm:inline">
              {email}
            </span>
          )}
          <Button className="shrink-0" variant="outline" onPress={handleLogout}>
            <LogOutIcon />
            Log out
          </Button>
        </div>
      </header>

      {error && (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn&apos;t load your meetings</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="ghost" onPress={handleRetry}>
            Retry
          </Button>
        </Alert>
      )}

      {meetings && meetings.length === 0 && (
        <Card className="p-0">
          <EmptyState className="flex flex-col items-center gap-4 p-12 text-center">
            <span className="bg-accent/15 text-accent flex size-14 items-center justify-center rounded-full">
              <CalendarIcon />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-base font-medium">
                No meetings yet
              </p>
              <p className="text-muted text-sm">
                Meetings you create will show up here.
              </p>
            </div>
          </EmptyState>
        </Card>
      )}

      {meetings && meetings.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-3">
          <section className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <h2 className="text-lg font-semibold">Your meetings</h2>
            <div className="flex min-w-0 flex-col gap-3">
              {meetings.map((meeting) => (
                <MeetingCard key={meeting.id} meeting={meeting} />
              ))}
            </div>
          </section>

          {recentMeetings.length > 0 && (
            <aside className="min-w-0">
              <Card className="min-w-0 gap-4 p-6">
                <Card.Header>
                  <Card.Title
                    className="text-base"
                    render={(props) => <h2 {...props} />}
                  >
                    Recent meetings
                  </Card.Title>
                </Card.Header>
                <Card.Content className="flex min-w-0 flex-col gap-4">
                  {recentMeetings.map((meeting, index) => (
                    <Link
                      className={
                        index < recentMeetings.length - 1
                          ? 'border-border hover:text-accent flex min-w-0 flex-col gap-1 border-b pb-4 transition-colors'
                          : 'hover:text-accent flex min-w-0 flex-col gap-1 transition-colors'
                      }
                      href={`/meetings/${meeting.id}`}
                      key={meeting.id}
                    >
                      <span className="truncate text-sm font-medium">
                        {meeting.title}
                      </span>
                      <span className="text-muted text-xs">
                        {formatMeetingDate(meeting.date)}
                      </span>
                    </Link>
                  ))}
                </Card.Content>
              </Card>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
