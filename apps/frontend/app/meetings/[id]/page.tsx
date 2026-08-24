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
import { MeetingFilesSection } from '@/components/meeting-files';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import { formatMeetingDate } from '@/lib/format';
import { getMeeting, type Meeting } from '@/lib/meetings';

/**
 * The outcome of fetching one meeting, as a single discriminated union
 * rather than separate `meeting`/`accessState`/`error` booleans — an earlier
 * version tracked those independently and a catch branch that set one could
 * forget to clear another, letting two mutually-exclusive states (e.g. the
 * 403 empty state and the retry-able error banner) render at once after a
 * retry that failed a *different* way than the first attempt. `forbidden`
 * and `not-found` map to 403/404 from `assertMeetingAccess` on the backend
 * (see the root `CLAUDE.md`) and get a dedicated empty state; `error` is
 * everything else (network, 5xx) and gets the retry-able banner.
 */
type LoadResult =
  | { kind: 'success'; meeting: Meeting }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export default function MeetingPage() {
  const router = useRouter();
  const { id: meetingId } = useParams<{ id: string }>();

  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  // Tagged with the id it was fetched for, so a client-side navigation from
  // one meeting to another (the route component isn't remounted, since it's
  // the same page for a different `[id]`) shows the loading state instead of
  // the previous meeting's stale content until the new fetch resolves — see
  // the `isLoading` check below.
  const [loaded, setLoaded] = useState<{
    id: string;
    result: LoadResult;
  } | null>(null);

  // Shared by the initial load and the "Retry" button after a failed fetch.
  // No `setState` call happens before the `await` — an effect must not set
  // state synchronously in its own body, and this is called straight from one.
  const loadMeeting = useCallback(
    async (token: string) => {
      try {
        const data = await getMeeting(token, meetingId);
        setLoaded({
          id: meetingId,
          result: { kind: 'success', meeting: data },
        });
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
          setLoaded({ id: meetingId, result: { kind: 'forbidden' } });
        } else if (cause instanceof ApiError && cause.status === 404) {
          setLoaded({ id: meetingId, result: { kind: 'not-found' } });
        } else {
          setLoaded({
            id: meetingId,
            result: {
              kind: 'error',
              message:
                cause instanceof ApiError
                  ? cause.message
                  : 'Something went wrong.',
            },
          });
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

    // Same as the mount effect: no token means the session ended (e.g. a
    // logout in another tab) since the last render, so send the user back
    // to sign in instead of leaving a Retry button that does nothing.
    if (!token) {
      router.replace('/login');
      return;
    }

    setStatus('checking');
    void loadMeeting(token);
  };

  const isLoading = status === 'checking' || !loaded || loaded.id !== meetingId;

  // Auth is verified client-side (the token lives in localStorage), so the
  // page renders nothing meaningful until that check — and the fetch for
  // the current `meetingId` — has actually completed.
  if (isLoading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner aria-label="Loading" size="lg" />
      </main>
    );
  }

  const { result } = loaded;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        className="text-muted hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
        href="/"
      >
        <ArrowLeftIcon />
        Back to meetings
      </Link>

      {(result.kind === 'forbidden' || result.kind === 'not-found') && (
        <Card className="p-0">
          <EmptyState className="flex flex-col items-center gap-4 p-12 text-center">
            <span className="bg-danger/15 text-danger flex size-14 items-center justify-center rounded-full">
              {result.kind === 'forbidden' ? <LockIcon /> : <SearchOffIcon />}
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-base font-medium">
                {result.kind === 'forbidden'
                  ? "You don't have access to this meeting"
                  : 'Meeting not found'}
              </p>
              <p className="text-muted text-sm">
                {result.kind === 'forbidden'
                  ? 'Only its owner and participants can view this meeting.'
                  : 'It may have been deleted, or the link is incorrect.'}
              </p>
            </div>
          </EmptyState>
        </Card>
      )}

      {result.kind === 'error' && (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn&apos;t load this meeting</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="ghost" onPress={handleRetry}>
            Retry
          </Button>
        </Alert>
      )}

      {result.kind === 'success' && (
        <Card className="min-w-0 gap-6 p-6 sm:p-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-2xl shadow-sm">
              <VideoIcon />
            </span>
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">
              {result.meeting.title}
            </h1>
          </div>

          <div className="text-muted flex items-center gap-1.5 text-sm">
            <span className="shrink-0">
              <CalendarIcon />
            </span>
            <span>{formatMeetingDate(result.meeting.date)}</span>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-muted flex items-center gap-1.5 text-sm">
              <span className="shrink-0">
                <UsersIcon />
              </span>
              <span>Participants</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {result.meeting.participants.map((participant, index) => (
                <Chip key={`${index}-${participant}`} variant="secondary">
                  {participant}
                </Chip>
              ))}
            </div>
          </div>
        </Card>
      )}

      {result.kind === 'success' && (
        // `key` forces a full remount on a client-side navigation between
        // two different meetings — this page component isn't remounted for
        // that (see the `isLoading`/`meetingId` tagging comment above), so
        // without it MeetingFilesSection's own state (file list, in-flight
        // upload queue) would otherwise leak from the old meeting into the
        // new one instead of resetting.
        <MeetingFilesSection
          key={result.meeting.id}
          meetingId={result.meeting.id}
        />
      )}
    </main>
  );
}
