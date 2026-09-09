'use client';

import {
  Button,
  Card,
  Description,
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
import {
  ApiError,
  clearAccessToken,
  getAccessToken,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from '@/lib/auth';
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
 * Two rules are checked before anything is sent: the new password clears the
 * backend's `PASSWORD_MIN_LENGTH` (`validatePassword` in `lib/auth.ts`), and
 * the confirmation repeats it exactly. Both are rejections the server would
 * otherwise have to make — the length one as a 400, the match one not at all,
 * since `POST /auth/change-password` never sees the confirmation — so they are
 * reported in the offending field's own `FieldError` and block the submit, and
 * `handleSubmit` only ever runs on a body the backend has a chance of taking.
 * Neither is the source of truth: the backend re-validates the length
 * regardless, and the confirmation is purely a typo guard for a value the user
 * cannot see while typing it.
 *
 * Storing the freshly signed `accessToken` the call returns, and the
 * success/`danger`-`Alert` treatment of its outcome, is the next issue. Until
 * then a failure surfaces the server's own message inline, announced via
 * `role="alert"`, and a success just closes the form. Not storing the new
 * token is survivable in the meantime and not a silent logout: the backend's
 * JWTs are stateless, so the one in `localStorage` stays valid until it
 * expires (see `changePassword` in `lib/users.ts`).
 */
export function ChangePassword() {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The new password, mirrored into state purely so the confirmation field can
   * be validated against it — it is the one value on this form another field's
   * `validate` has to read, and `validate` only re-runs when something the
   * component renders with has changed. The other two fields stay uncontrolled
   * and are read from `FormData` at submit, like every other form in the app.
   *
   * Cleared by `closeForm`, so a plaintext password doesn't outlive the form
   * that collected it — and so reopening the form doesn't find the field
   * pre-filled with the password from the previous visit.
   */
  const [newPassword, setNewPassword] = useState('');

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

  const closeForm = () => {
    setIsEditing(false);
    setNewPassword('');
  };

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

    // Only the current password is read back out of the form; the new one is
    // already in state (the confirmation field validates against it) and the
    // confirmation itself is never sent — the backend has no field for it.
    const { currentPassword } = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<'currentPassword', string>;

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
      closeForm();
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
              // Stated up front rather than only after a rejection, like the
              // register form's password hint and the name editor's limit.
              description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              label="New password"
              name="newPassword"
              revealLabel="new password"
              validate={validatePassword}
              value={newPassword}
              onChange={(value) => {
                setNewPassword(value);
                handleChange();
              }}
            />
            <PasswordField
              autoComplete="new-password"
              label="Confirm new password"
              name="confirmPassword"
              revealLabel="new password confirmation"
              // The one check that spans two fields, which is why the new
              // password is held in state at all. `isRequired` covers the
              // empty case; this only has to answer "is it the same value".
              // Compared exactly, with no trimming or case folding, because
              // that is how the two will be compared by bcrypt later.
              //
              // "New passwords", not "Passwords": this form also holds the
              // *current* password, and the bare phrase would read as that one
              // having been rejected — which is a different failure, arriving
              // from the server, and not one the user can see by looking at
              // the two fields above.
              validate={(value) =>
                value === newPassword ? null : 'New passwords do not match.'
              }
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
                onPress={closeForm}
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
 * `validate` is optional because the three fields are held to different rules:
 * the new password to `validatePassword`, the confirmation to matching it, and
 * the current password to nothing beyond `isRequired` — the backend exempts an
 * already-accepted password from the length rule (see `validatePassword`), and
 * the only verdict on it that means anything is `bcrypt`'s. `description` is
 * optional for the same reason: only the field that has a rule to state up
 * front has something to say before the user types.
 *
 * `value` is optional too, so a field is uncontrolled unless a caller needs to
 * read it during render — only the new password does, so that the confirmation
 * field's `validate` can compare against it. The rest are read from `FormData`
 * on submit.
 */
function PasswordField({
  autoComplete,
  autoFocus,
  description,
  label,
  name,
  revealLabel,
  validate,
  value,
  onChange,
}: {
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  description?: string;
  label: string;
  name: string;
  revealLabel: string;
  validate?: (value: string) => string | null;
  value?: string;
  onChange: (value: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TextField
      fullWidth
      isRequired
      name={name}
      type={isVisible ? 'text' : 'password'}
      validate={validate}
      value={value}
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
      {description && <Description>{description}</Description>}
      <FieldError />
    </TextField>
  );
}
