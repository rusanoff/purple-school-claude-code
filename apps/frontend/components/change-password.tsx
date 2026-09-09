'use client';

import {
  Alert,
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
  saveAccessToken,
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
 * A success **stores the freshly signed `accessToken`** the call hands back
 * (`saveAccessToken`) before anything else. That store is the whole reason the
 * user stays signed in: the backend's JWTs are stateless and it re-signs one on
 * every password change, so keeping the old token would leave the app holding
 * credentials for a password that no longer exists — fine until it expires,
 * then a logout the user would blame on having changed their password.
 *
 * The three outcomes are reported the way the name editor reports its own:
 * saving is the submit button's `isPending` spinner, a success closes the form
 * and leaves a `success` `Alert` behind it, and a failure keeps the form open
 * under a `danger` `Alert` carrying the server's own message. A wrong current
 * password is that last case and nothing more — the backend deliberately makes
 * it a 400 rather than a 401 so it cannot be mistaken for an expired session
 * (see `changePassword` in `lib/users.ts`), which is what keeps a typo from
 * logging the user out.
 */
export function ChangePassword() {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
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

  const errorRef = useRef<HTMLDivElement>(null);
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

    let accessToken: string;

    // Only the request is guarded. Everything after the `catch` runs on a
    // password the server has **already** changed, and must not be able to
    // report a failure: a `localStorage` write that threw (Safari private
    // browsing, a full quota) would otherwise surface as "Couldn't change your
    // password" for a change that did happen, and the retry it invites can only
    // come back "Current password is incorrect".
    try {
      ({ accessToken } = await changePassword(token, {
        currentPassword,
        newPassword,
      }));
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
      return;
    } finally {
      setIsPending(false);
    }

    // Before the form closes: the token in `localStorage` was signed against
    // the password that no longer exists. Nothing invalidates it server-side —
    // the backend's JWTs are stateless — so the app would keep working on it
    // until it expired and then log the user out for a reason they'd pin on
    // this form. Storing the new one is what makes "changed my password and
    // stayed signed in" true.
    //
    // Guarded, and the failure deliberately swallowed: `localStorage` can
    // throw (Safari's private mode, a full quota), and by this point the
    // password has already been changed. Letting that throw escape would
    // reject `handleSubmit` before the two lines below run, leaving the form
    // open with neither a success nor an error on a change that did happen —
    // and the retry it invites can only come back "Current password is
    // incorrect". The user keeps the old token, which still works until it
    // expires; that is a far smaller problem than the silence.
    try {
      saveAccessToken(accessToken);
    } catch {
      // Nothing useful to say here: the change succeeded either way.
    }

    closeForm();
    setIsSaved(true);
  };

  // Any edit makes a previous failure stale, exactly as on the register form
  // and the name editor — a red message still asserting the old reason while
  // the user is already retyping is worse than no message.
  const handleChange = () => {
    setError((previous) => (previous ? null : previous));
  };

  /*
    Rendered in both modes and at the same position in what this component
    returns, so React keeps the node mounted across the switch between them —
    `ProfileName`'s `savedNotice` for the same reason: a live region has to
    already be in the DOM when its content appears for the announcement to be
    reliable, and a successful save is exactly the moment it would otherwise
    mount. It stays empty in edit mode, since `isSaved` is cleared when the
    form reopens and there is nothing to re-assert.

    This one carries a `Description` where the name editor's carries only a
    title: unlike a renamed heading, a changed password leaves nothing on
    screen to look at, so "you are still signed in" is the only confirmation
    the user gets that the thing they'd worry about didn't happen.

    `polite` rather than `assertive` — the outcome is visible, and focus is
    landing on the "Change password" button at the same moment; interrupting
    that announcement would be worse than following it.

    `sr-only` while empty rather than a bare empty node, for the reason
    `components/profile-avatar.tsx`'s status region carries the same class:
    this sits in a gapped flex column (`Card.Content` is `gap-1`), where a
    zero-height item is still an item and would push 4px of dead space under
    the button on every visit that saved nothing. `sr-only` is absolutely
    positioned, so it leaves the flow without leaving the DOM.
  */
  const savedNotice = (
    <div
      aria-live="polite"
      className={isSaved ? undefined : 'sr-only'}
      role="status"
    >
      {isSaved && (
        <Alert className="mt-4" status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Password updated</Alert.Title>
            <Alert.Description>
              Use your new password next time you sign in. You&apos;re still
              signed in here.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );

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

      <Card.Content className="flex min-w-0 flex-col">
        {!isEditing ? (
          // `self-start` because this column stretches its children, and a
          // full-width "Change password" button would read as the primary
          // action of the whole page rather than the way into a form.
          <Button
            className="self-start"
            ref={openButtonRef}
            size="sm"
            variant="ghost"
            onPress={() => {
              setError(null);
              setIsSaved(false);
              setIsEditing(true);
            }}
          >
            <LockIcon />
            Change password
          </Button>
        ) : (
          <Form className="flex min-w-0 flex-col gap-5" onSubmit={handleSubmit}>
            {/*
              The one place a wrong current password surfaces: the backend
              answers it with a 400 carrying its own message, which falls
              through `handleSubmit`'s 401/404 branch to here. Same `danger`
              `Alert` the register page and the name editor use for a rejected
              submit — the message is the server's, the title says which
              action failed, since this card holds only one.
            */}
            {error && (
              <Alert
                className="outline-none"
                ref={errorRef}
                role="alert"
                status="danger"
                tabIndex={-1}
              >
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Couldn&apos;t change your password</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <PasswordField
              autoFocus
              autoComplete="current-password"
              description="The password you sign in with today."
              label="Current password"
              name="currentPassword"
              revealLabel="current password"
              // Nothing to check beyond "there is one" — the only verdict on
              // this value that means anything is `bcrypt`'s. It is written out
              // anyway, rather than left to `isRequired` alone, because the
              // message a bare `isRequired` produces is the *browser's* ("Please
              // fill out this field", translated into the browser's UI language,
              // not the app's), which is how the login page words its own
              // empty-password rule too.
              validate={(value) =>
                value ? null : 'Enter your current password.'
              }
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
              description="Type the new password again."
              label="Confirm new password"
              name="confirmPassword"
              revealLabel="new password confirmation"
              // The one check that spans two fields, which is why the new
              // password is held in state at all. Compared exactly, with no
              // trimming or case folding, because that is how the two will be
              // compared by bcrypt later.
              //
              // The empty case is spelled out ahead of that comparison rather
              // than left to `isRequired`: two empty fields *do* match, so the
              // comparison would call an untouched form valid and hand the
              // "fill this in" wording to the browser, in the browser's
              // language rather than the app's.
              //
              // "New passwords", not "Passwords": this form also holds the
              // *current* password, and the bare phrase would read as that one
              // having been rejected — which is a different failure, arriving
              // from the server, and not one the user can see by looking at
              // the two fields above.
              validate={(value) => {
                if (!value) {
                  return 'Confirm your new password.';
                }

                return value === newPassword
                  ? null
                  : 'New passwords do not match.';
              }}
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
        {savedNotice}
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
 * `validate` is required, though the three fields are held to very different
 * rules: the new password to `validatePassword`, the confirmation to matching
 * it, and the current password to nothing beyond being filled in — the backend
 * exempts an already-accepted password from the length rule (see
 * `validatePassword`), and the only verdict on it that means anything is
 * `bcrypt`'s. Even that last field spells its rule out rather than leaning on
 * `isRequired` alone, because the message `isRequired` produces on its own is
 * the browser's, in the browser's UI language — "Заполните это поле." under an
 * otherwise English form. Both auth pages word their own empty-field rules for
 * the same reason.
 *
 * `description` is likewise **required**, even where the field has no rule
 * worth stating: a `FieldError` replaces the `Description` rather than stacking
 * under it, so a field that has one keeps the same height whether or not it is
 * showing an error, and a field that doesn't grows a line the moment one
 * appears. That matters here because the errors are committed on blur (React
 * Aria's native validation behaviour), and the blur that clears them is
 * usually the press on "Save password" — a field without a description would
 * drop its error line and pull the button ~20px out from under the pointer
 * between `mousedown` and `mouseup`, so the press lands on nothing and the
 * user's first click after fixing a mistake does nothing at all. Keeping a
 * description on every field is what makes that click land. Verified in the
 * browser, and the reason the register form doesn't have the bug: its one
 * validated field carries a hint too.
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
  description: string;
  label: string;
  name: string;
  revealLabel: string;
  validate: (value: string) => string | null;
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
      <Description>{description}</Description>
      <FieldError />
    </TextField>
  );
}
