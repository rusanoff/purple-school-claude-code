'use client';

import { Alert, Button, Card, Spinner } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getDisplayName, UserAvatar } from '@/components/avatar';
import { ArrowLeftIcon, CalendarIcon, EnvelopeIcon } from '@/components/icons';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import { formatDay } from '@/lib/format';
import { getUserProfile, type UserProfile } from '@/lib/users';

/**
 * The outcome of fetching the signed-in user's own profile, as one
 * discriminated union rather than separate `profile`/`error` state — same
 * reasoning as the meeting detail page's `LoadResult`: independent pieces of
 * state let a failed retry leave the previous success on screen underneath a
 * fresh error banner. There is no `forbidden`/`not-found` member here because
 * `GET /users/me` has no id to get wrong: 401 (expired token) and 404 (the
 * user row is gone) both mean the session is over and redirect to `/login`
 * instead of rendering, see `lib/users.ts`.
 */
type LoadResult =
  | { kind: 'success'; profile: UserProfile }
  | { kind: 'error'; message: string };

export default function ProfilePage() {
  const router = useRouter();

  const [status, setStatus] = useState<'checking' | 'ready'>('checking');
  const [result, setResult] = useState<LoadResult | null>(null);

  // Shared by the initial load and the "Retry" button after a failed fetch.
  // No `setState` call happens before the `await` — an effect must not set
  // state synchronously in its own body, and this is called straight from one.
  const loadProfile = useCallback(
    async (token: string) => {
      try {
        const profile = await getUserProfile(token);
        setResult({ kind: 'success', profile });
      } catch (cause) {
        // 401: the token is expired or invalid. 404: it verified, but the
        // user row it points at no longer exists. Neither is retryable and
        // neither leaves anything to show, so both end the session the same
        // way the rest of the app ends it on a 401.
        if (
          cause instanceof ApiError &&
          (cause.status === 401 || cause.status === 404)
        ) {
          clearAccessToken();
          router.replace('/login');
          return;
        }

        setResult({
          kind: 'error',
          message:
            cause instanceof ApiError ? cause.message : 'Something went wrong.',
        });
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
    // start once mounted in the browser — see the same comment on the
    // dashboard's mount effect for why `loadProfile` sets state async here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile(token);
  }, [loadProfile, router]);

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
    void loadProfile(token);
  };

  // Auth is verified client-side (the token lives in localStorage), so the
  // page renders nothing meaningful until that check — and the fetch — has
  // actually completed, avoiding a flash of empty profile fields.
  if (status === 'checking' || !result) {
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

      {result.kind === 'error' && (
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn&apos;t load your profile</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="ghost" onPress={handleRetry}>
            Retry
          </Button>
        </Alert>
      )}

      {result.kind === 'success' && (
        <Card className="min-w-0 gap-6 p-6 sm:p-8">
          <div className="flex min-w-0 flex-col items-center gap-4 text-center sm:flex-row sm:gap-6 sm:text-left">
            <UserAvatar
              avatarUrl={result.profile.avatarUrl}
              className="shrink-0"
              email={result.profile.email}
              name={result.profile.name}
              size="xl"
            />
            {/*
              `getDisplayName` falls back to the email when the user never set
              a name, so this heading is never blank — the labelled Email row
              below stays regardless, so the page reads the same for a user
              with a name and one without.

              `wrap-anywhere` rather than `truncate`: this is the one page
              whose whole job is showing the user their own name and address,
              so an over-long one (or the email standing in for a missing
              name, which has no spaces to break at) has to wrap and stay
              readable instead of being clipped to an ellipsis. Elsewhere —
              the meeting title, the dashboard's header email — truncating is
              right, because the full value is one click away.
            */}
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight wrap-anywhere">
              {getDisplayName(result.profile.name, result.profile.email)}
            </h1>
          </div>

          <dl className="border-border flex min-w-0 flex-col gap-5 border-t pt-6">
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-muted flex items-center gap-1.5 text-sm">
                <EnvelopeIcon />
                Email
              </dt>
              <dd className="min-w-0 wrap-anywhere">{result.profile.email}</dd>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-muted flex items-center gap-1.5 text-sm">
                <CalendarIcon />
                Member since
              </dt>
              <dd className="min-w-0">
                <time dateTime={result.profile.createdAt}>
                  {formatDay(result.profile.createdAt)}
                </time>
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </main>
  );
}
