'use client';

import {
  Button,
  Card,
  FieldError,
  Form,
  InputGroup,
  Label,
  Spinner,
  TextField,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { EyeIcon, LockIcon } from '@/components/icons';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import { changePassword } from '@/lib/users';

/**
 * The `/profile` section that changes the signed-in user's password: a
 * "Change password" button that opens a `Form` of three password fields —
 * the current one, the new one, and a confirmation of the new one.
 *
 * It is a `Card` of its own below the profile card rather than a row inside
 * it, because it edits the account's credentials rather than the profile that
 * card shows: nothing here reads or writes `UserProfile`, so it takes no
 * `profile` prop and has no `onSaved` counterpart to `ProfileName`'s and
 * `ProfileAvatar`'s — the page's `LoadResult` is untouched by a password
 * change, and there is nothing on screen for it to refresh.
 *
 * The form sits behind a button, like the name editor, rather than open on the
 * page: three empty password fields would be the largest thing on this screen
 * and they are irrelevant to the visit that only came to look at the profile.
 *
 * Checking that the confirmation matches and that the new password clears the
 * backend's minimum length is the next issue; so is storing the freshly signed
 * `accessToken` the call returns, and the success/`danger`-`Alert` treatment of
 * its outcome. Until then a failure surfaces the server's own message inline,
 * announced via `role="alert"`, and a success just closes the form. Not storing
 * the new token is survivable in the meantime and not a silent logout: the
 * backend's JWTs are stateless, so the one in `localStorage` stays valid until
 * it expires (see `changePassword` in `lib/users.ts`).
 */
export function ChangePassword() {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorRef = useRef<HTMLParagraphElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  // Closing the form unmounts the button the user was standing on (Cancel, or
  // Save), which would drop focus back to `<body>`. Hand it to the control
  // that reopens the form, exactly as `ProfileName` does when its editor
  // closes. Tracked with a ref rather than keyed on `isEditing` alone, so the
  // first render doesn't steal focus from wherever the page put it.
  useEffect(() => {
    if (!isEditing && wasEditingRef.current) {
      openButtonRef.current?.focus();
    }

    wasEditingRef.current = isEditing;
  }, [isEditing]);

  // A failed save leaves the user on the Save button with the reason rendered
  // above three fields, off the top of a phone screen. Move focus to it, the
  // same way the register page and `ProfileName` handle a failed submit.
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // `isPending` disables the Save button, but the browser still submits on
    // Enter from a field, so a second Enter would fire an overlapping
    // `POST /auth/change-password` — and that one would come back "Current
    // password is incorrect", because the first request already changed it.
    // Same guard as on `ProfileName`'s form, sharper consequence.
    if (isPending) {
      return;
    }

    const { currentPassword, newPassword } = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<'currentPassword' | 'newPassword', string>;

    const token = getAccessToken();

    // Same reasoning as everywhere else on this page: the session may have
    // ended (a logout in another tab) while this form sat open.
    if (!token) {
      router.replace('/login');
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      await changePassword(token, { currentPassword, newPassword });
      setIsEditing(false);
    } catch (cause) {
      // 401/404 mean the session is over, exactly as on the page's own fetch.
      // A wrong current password is deliberately **not** one of them — the
      // backend answers that with a 400 precisely so that a typo cannot log
      // anyone out (see `changePassword` in `lib/users.ts`) — so it falls
      // through to the message below, written by the backend for the user.
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

  // Any edit makes a previous failure stale, exactly as on the register form
  // and the name editor — a red message still asserting the old reason while
  // the user is already retyping is worse than no message.
  const handleChange = () => {
    setError((previous) => (previous ? null : previous));
  };

  return (
    <Card className="min-w-0 gap-6 p-6 sm:p-8">
      <Card.Header>
        <Card.Title render={(props) => <h2 {...props} />}>Password</Card.Title>
        <Card.Description>
          {isEditing
            ? 'Enter your current password, then choose a new one.'
            : 'Change the password you use to sign in.'}
        </Card.Description>
      </Card.Header>

      <Card.Content>
        {!isEditing ? (
          <Button
            ref={openButtonRef}
            size="sm"
            variant="ghost"
            onPress={() => {
              setError(null);
              setIsEditing(true);
            }}
          >
            <LockIcon />
            Change password
          </Button>
        ) : (
          <Form className="flex min-w-0 flex-col gap-5" onSubmit={handleSubmit}>
            {error && (
              <p
                className="text-danger text-sm outline-none"
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
                {error}
              </p>
            )}

            <PasswordField
              autoFocus
              autoComplete="current-password"
              label="Current password"
              name="currentPassword"
              revealLabel="current password"
              onChange={handleChange}
            />
            <PasswordField
              autoComplete="new-password"
              label="New password"
              name="newPassword"
              revealLabel="new password"
              onChange={handleChange}
            />
            <PasswordField
              autoComplete="new-password"
              label="Confirm new password"
              name="confirmPassword"
              revealLabel="new password confirmation"
              onChange={handleChange}
            />

            <div className="flex flex-wrap gap-2">
              <Button isPending={isPending} size="sm" type="submit">
                {({ isPending: pending }) => (
                  <>
                    {pending && <Spinner color="current" size="sm" />}
                    {pending ? 'Saving…' : 'Save password'}
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
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * One password input of the form above — the register page's password field,
 * lock prefix and reveal toggle included, factored out because this form has
 * three of them and they differ only in their label, `name` and
 * `autoComplete`.
 *
 * Visibility is per field rather than one switch for the whole form: the three
 * hold different secrets, and revealing the current password because the user
 * wanted to check what they typed into the confirmation would put a password
 * on screen they never asked to show.
 *
 * `revealLabel` is what that toggle is named after ("Show current password"),
 * so the three buttons don't all announce as "Show password". It is a separate
 * prop rather than the lowercased `label` because the confirmation field's
 * toggle shows the *new password* it repeats, and "Show confirm new password"
 * is not a phrase.
 *
 * `autoComplete` is spelled out per field (`current-password` vs
 * `new-password`) so a password manager offers the stored password on the
 * first and a generated one on the other two, rather than filling all three
 * with the password being replaced.
 *
 * `isRequired` is the only check here for now — rejecting a too-short new
 * password and a confirmation that doesn't match is the next issue.
 */
function PasswordField({
  autoComplete,
  autoFocus,
  label,
  name,
  revealLabel,
  onChange,
}: {
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  label: string;
  name: string;
  revealLabel: string;
  onChange: () => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextField
      fullWidth
      isRequired
      name={name}
      type={isVisible ? 'text' : 'password'}
      onChange={onChange}
    >
      <Label>{label}</Label>
      <InputGroup>
        <InputGroup.Prefix>
          <LockIcon />
        </InputGroup.Prefix>
        <InputGroup.Input
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="min-w-0"
          placeholder="••••••••"
        />
        <InputGroup.Suffix>
          <Button
            aria-label={
              isVisible ? `Hide ${revealLabel}` : `Show ${revealLabel}`
            }
            size="sm"
            variant="ghost"
            onPress={() => setIsVisible((previous) => !previous)}
          >
            <EyeIcon isOpen={isVisible} />
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      <FieldError />
    </TextField>
  );
}
