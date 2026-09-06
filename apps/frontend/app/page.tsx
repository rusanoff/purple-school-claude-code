'use client';

import { Alert, Button, Card, EmptyState, Spinner } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getDisplayName, UserAvatar } from '@/components/avatar';
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
import { getUserProfile, type UserProfile } from '@/lib/users';

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
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
      }
    },
    [router],
  );

  // The header shows who is signed in, and the token only carries their
  // email — the name and avatar come from `GET /users/me`. A failure here is
  // deliberately *not* folded into `error`: the header then falls back to the
  // token's email and the initial placeholder, which is exactly what a user
  // who never set a name sees anyway, and that beats an error banner over a
  // dashboard whose own data loaded fine. Only a 401 is acted on, and the
  // same way `loadMeetings` acts on it — the session is over. (A 404, the
  // user row being gone, is left to `/profile`, the page that is actually
  // about that profile; here it just degrades to the email.)
  const loadProfile = useCallback(
    async (token: string) => {
      try {
        setProfile(await getUserProfile(token));
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          router.replace('/login');
        }
      }
    },
    [router],
  );

  // Both requests go out together, and neither rejects — each keeps its own
  // failure in its own state. The page waits for both before it paints so the
  // header's name doesn't visibly replace the email a moment after the rest
  // of the dashboard has already rendered.
  const loadDashboard = useCallback(
    async (token: string) => {
      await Promise.all([loadMeetings(token), loadProfile(token)]);
      setStatus('ready');
    },
    [loadMeetings, loadProfile],
  );

  useEffect(() => {
    const token = getAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    // The auth token only exists in `localStorage`, so these fetches can only
    // start once mounted in the browser — there is no server-renderable data
    // for this route to defer to instead, so `loadDashboard` sets state async
    // from here rather than synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard(token);
  }, [loadDashboard, router]);

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
    void loadDashboard(token);
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
  // above has already confirmed we're running in the browser. The profile's
  // own email wins when it loaded — it comes from the database rather than
  // from an unverified JWT claim — and the token's is the fallback for when
  // it didn't.
  const email = profile?.email ?? getCurrentUserEmail();
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
            /*
              The whole identity block is one link to `/profile` — avatar and
              name together, so the target is comfortably larger than either
              on its own.

              `aria-label` rather than relying on the link's own content: the
              name is `hidden` below `sm` (there is no room for it next to the
              wordmark and the log-out button on a phone) and the avatar is
              `aria-hidden`, so without it the link would have no accessible
              name at all on a narrow viewport. The label leads with the same
              text that is visible at wider ones, so speech input still
              matches what a user can read (WCAG 2.5.3).

              The hover background is what carries the affordance below `sm`:
              with the name hidden there, `hover:text-foreground` has nothing
              visible left to recolour, so the link would otherwise be the one
              control in the header that never reacts to a pointer. The
              padding that background needs also grows the target from the
              avatar's 32px to 40px — and `-m-1` cancels that padding out of
              the *layout* box so the pill only paints into the surrounding
              `gap-3`, leaving the header a single row on a 375px screen the
              way it was before the pill existed.
            */
            <Link
              aria-label={`${getDisplayName(profile?.name ?? null, email)}, your profile`}
              className="text-muted hover:bg-default hover:text-foreground -m-1 flex min-w-0 items-center gap-2 rounded-full p-1 transition-colors sm:pr-3"
              href="/profile"
            >
              <UserAvatar
                avatarUrl={profile?.avatarUrl ?? null}
                className="shrink-0"
                email={email}
                name={profile?.name ?? null}
                size="sm"
              />
              {/*
                Truncated, unlike `/profile`'s `wrap-anywhere` heading: here
                the full value is one click away on the page this links to.
              */}
              <span className="hidden max-w-[16rem] truncate text-sm sm:inline">
                {getDisplayName(profile?.name ?? null, email)}
              </span>
            </Link>
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
