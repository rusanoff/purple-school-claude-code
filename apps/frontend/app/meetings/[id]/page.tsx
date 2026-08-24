'use client';

import { Alert, Button, Card, Chip, EmptyState, Spinner } from '@heroui/react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  ArrowLeftIcon,
  CalendarIcon,
  LockIcon,
  SearchOffIcon,
  UsersIcon,
  VideoIcon,
} from '@/components/icons';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import { getMeeting, type Meeting } from '@/lib/meetings';

function formatMeetingDate(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Distinguishes "the meeting isn't accessible to this caller" (403/404, from
 * `assertMeetingAccess` on the backend — see the root `CLAUDE.md`) from a
 * transient failure (network, 5xx): the former gets a dedicated empty state
 * instead of the retry-able error banner used for everything else.
 */
type AccessState = 'forbidden' | 'not-found' | null;

export default function MeetingPage() {
  const router = useRouter();
  const { id: meetingId } = useParams<{ id: string }>();

  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [accessState, setAccessState] = useState<AccessState>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared by the initial load and the "Retry" button after a failed fetch.
  // No `setState` call happens before the `await` — an effect must not set
  // state synchronously in its own body, and this is called straight from one.
  const loadMeeting = useCallback(
    async (token: string) => {
      try {
        const data = await getMeeting(token, meetingId);
        setMeeting(data);
        setAccessState(null);
        setError(null);
      } catch (cause) {
        // An expired/invalid token means the session is over — send the
        // user back to sign in rather than showing an error they can't act
        // on, same as the dashboard.
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          router.replace('/login');
          return;
        }

        if (cause instanceof ApiError && cause.status === 403) {
          setAccessState('forbidden');
        } else if (cause instanceof ApiError && cause.status === 404) {
          setAccessState('not-found');
        } else {
          setError(
            cause instanceof ApiError ? cause.message : 'Something went wrong.',
          );
        }
      } finally {
        setStatus('ready');
      }
    },
    [meetingId, router],
  );

  useEffect(() => {
    const token = getAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    // The auth token only exists in `localStorage`, so this fetch can only
    // start once mounted in the browser — see the same comment on the
    // dashboard's mount effect for why `loadMeeting` sets state async here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMeeting(token);
  }, [loadMeeting, router]);

  const handleRetry = () => {
    const token = getAccessToken();

    if (token) {
      setStatus('checking');
      void loadMeeting(token);
    }
  };

  // Auth is verified client-side (the token lives in localStorage), so the
  // page renders nothing meaningful until that check has actually run —
  // avoids a flash of content before a missing token redirects away.
  if (status === 'checking') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner aria-label="Loading" size="lg" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        className="text-muted hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
        href="/"
      >
        <ArrowLeftIcon />
        Back to meetings
      </Link>

      {accessState && (
        <Card className="p-0">
          <EmptyState className="flex flex-col items-center gap-4 p-12 text-center">
            <span className="bg-danger/15 text-danger flex size-14 items-center justify-center rounded-full">
              {accessState === 'forbidden' ? <LockIcon /> : <SearchOffIcon />}
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-base font-medium">
                {accessState === 'forbidden'
                  ? "You don't have access to this meeting"
                  : 'Meeting not found'}
              </p>
              <p className="text-muted text-sm">
                {accessState === 'forbidden'
                  ? 'Only its owner and participants can view this meeting.'
                  : 'It may have been deleted, or the link is incorrect.'}
              </p>
            </div>
          </EmptyState>
        </Card>
      )}

      {error && (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn&apos;t load this meeting</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="ghost" onPress={handleRetry}>
            Retry
          </Button>
        </Alert>
      )}

      {meeting && (
        <Card className="min-w-0 gap-6 p-6 sm:p-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl shadow-sm">
              <VideoIcon />
            </span>
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">
              {meeting.title}
            </h1>
          </div>

          <div className="text-muted flex items-center gap-1.5 text-sm">
            <span className="shrink-0">
              <CalendarIcon />
            </span>
            <span>{formatMeetingDate(meeting.date)}</span>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-muted flex items-center gap-1.5 text-sm">
              <span className="shrink-0">
                <UsersIcon />
              </span>
              <span>Participants</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {meeting.participants.map((participant) => (
                <Chip key={participant} variant="secondary">
                  {participant}
                </Chip>
              ))}
            </div>
          </div>
        </Card>
      )}
    </main>
  );
}
