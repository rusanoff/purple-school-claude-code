'use client';

import {
  Alert,
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  Spinner,
  TextField,
} from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getDisplayName, UserAvatar } from '@/components/avatar';
import {
  ArrowLeftIcon,
  CalendarIcon,
  EnvelopeIcon,
  PencilIcon,
} from '@/components/icons';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import { formatDay } from '@/lib/format';
import { getUserProfile, updateProfile, type UserProfile } from '@/lib/users';

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
          <div className="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <UserAvatar
              avatarUrl={result.profile.avatarUrl}
              className="shrink-0"
              email={result.profile.email}
              name={result.profile.name}
              size="xl"
            />
            <ProfileName
              profile={result.profile}
              onSaved={(profile) => setResult({ kind: 'success', profile })}
            />
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

/**
 * The name half of the profile card header: the `<h1>` in view mode, an
 * editing form prefilled with the current name once "Edit name" is pressed.
 *
 * The two modes deliberately occupy the same slot next to the avatar rather
 * than the form living in its own section below — the thing being edited is
 * the heading itself, and showing the old value above an input holding the
 * same value reads as two different names on one card.
 *
 * `onSaved` hands the updated profile back to the page instead of this
 * component keeping its own copy: `PATCH /users/me` returns the same shape as
 * `GET /users/me`, so the page's `LoadResult` stays the single source of what
 * this page is showing (the avatar next to this heading reads from it too)
 * and no refetch is needed.
 */
function ProfileName({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
}) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alertRef = useRef<HTMLDivElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  // Leaving edit mode unmounts the button the user was on (Cancel, or Save),
  // which would drop focus back to `<body>`. Put it on the control that
  // reopens the form instead. Tracked with a ref rather than keying the
  // effect on `isEditing` alone, so the first render doesn't steal focus.
  useEffect(() => {
    if (!isEditing && wasEditingRef.current) {
      editButtonRef.current?.focus();
    }

    wasEditingRef.current = isEditing;
  }, [isEditing]);

  // A failed save leaves the user on the Save button with the reason rendered
  // above the field they can't see the top of on a phone. Move focus to the
  // alert, the same way the register page handles a failed submit.
  useEffect(() => {
    if (error) {
      alertRef.current?.focus();
    }
  }, [error]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const { name } = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<'name', string>;

    const token = getAccessToken();

    // Same reasoning as the page's Retry handler: the session may have ended
    // (a logout in another tab) while this form sat open.
    if (!token) {
      router.replace('/login');
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      onSaved(await updateProfile(token, { name }));
      setIsEditing(false);
    } catch (cause) {
      // 401/404 mean the session is over, exactly as on the page's own fetch.
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.status === 404)
      ) {
        clearAccessToken();
        router.replace('/login');
        return;
      }

      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong.',
      );
    } finally {
      setIsPending(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        {/*
          `getDisplayName` falls back to the email when the user never set a
          name, so this heading is never blank — the labelled Email row below
          stays regardless, so the page reads the same for a user with a name
          and one without.

          `wrap-anywhere` rather than `truncate`: this is the one page whose
          whole job is showing the user their own name and address, so an
          over-long one (or the email standing in for a missing name, which
          has no spaces to break at) has to wrap and stay readable instead of
          being clipped to an ellipsis. Elsewhere — the meeting title, the
          dashboard's header email — truncating is right, because the full
          value is one click away.
        */}
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight wrap-anywhere">
          {getDisplayName(profile.name, profile.email)}
        </h1>
        <Button
          className="shrink-0"
          ref={editButtonRef}
          size="sm"
          variant="ghost"
          onPress={() => {
            setError(null);
            setIsEditing(true);
          }}
        >
          <PencilIcon />
          {profile.name ? 'Edit name' : 'Add name'}
        </Button>
      </div>
    );
  }

  return (
    <Form
      className="flex w-full min-w-0 flex-1 flex-col gap-4"
      onSubmit={handleSubmit}
    >
      {/*
        Edit mode takes over the slot the `<h1>` occupies, so it has to carry
        a heading of its own — this is the page's only one, and dropping it
        while the form is open would leave heading navigation with nothing to
        land on. It names the mode rather than repeating the name being
        edited, which is already in the field below.
      */}
      <h1 className="text-lg font-semibold tracking-tight">Edit your name</h1>

      {error && (
        <Alert
          className="outline-none"
          ref={alertRef}
          role="alert"
          status="danger"
          tabIndex={-1}
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn&apos;t save your name</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <TextField
        fullWidth
        // Prefilled with the name currently on the profile — `defaultValue`
        // rather than a controlled value, so the field is seeded once when
        // edit mode opens and the user's keystrokes own it from then on. A
        // user who never set one starts from an empty field, not the email
        // the heading falls back to: that email is not their name, and
        // offering it as the value to edit would invite saving it as one.
        defaultValue={profile.name ?? ''}
        name="name"
        // Any edit makes a previous failure stale, exactly as on the register
        // form — a red banner still asserting the old reason while the user is
        // already fixing it is worse than no banner.
        onChange={() => setError((previous) => (previous ? null : previous))}
      >
        <Label>Display name</Label>
        <Input autoFocus className="min-w-0" placeholder="Your name" />
        <FieldError />
      </TextField>

      <div className="flex flex-wrap gap-2">
        <Button isPending={isPending} size="sm" type="submit">
          {({ isPending: pending }) => (
            <>
              {pending && <Spinner color="current" size="sm" />}
              {pending ? 'Saving…' : 'Save'}
            </>
          )}
        </Button>
        <Button
          isDisabled={isPending}
          size="sm"
          variant="ghost"
          onPress={() => setIsEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </Form>
  );
}
