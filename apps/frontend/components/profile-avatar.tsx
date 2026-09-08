'use client';

import { Alert, AlertDialog, Button, Spinner } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { UserAvatar } from '@/components/avatar';
import { TrashIcon, UploadCloudIcon } from '@/components/icons';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import {
  AVATAR_INPUT_ACCEPT,
  deleteAvatar,
  MAX_AVATAR_SIZE_MB,
  uploadAvatar,
  validateAvatar,
  type UserProfile,
} from '@/lib/users';

/**
 * The picture half of the profile card header: the current avatar, a zone to
 * drop or pick a new one, and — once a file is chosen — a preview of it with
 * Save/Cancel, so nothing is uploaded until the user has seen what they
 * picked. A user who already has a picture also gets "Remove photo", which
 * puts them back on the initial placeholder.
 *
 * The preview reuses `UserAvatar` with a local `blob:` URL rather than a
 * separate `<img>`, so what the user is shown before saving is rendered by
 * the exact component that will show it afterwards — same circle, same size,
 * same cropping — instead of an approximation that can differ from the
 * result.
 *
 * A picked file is checked by `validateAvatar` before anything is uploaded,
 * so an unsupported type or an over-sized image is refused without a request
 * — and without a preview, since previewing a file that can never be saved
 * would be showing the user a result they aren't going to get. That rejection
 * and a failure from the server share one `danger` `Alert`: to the user they
 * say the same thing (the picture isn't stored, here's why), and only one of
 * them ever has the preview on screen to sit under.
 *
 * `onSaved` hands the updated profile back to the page for the same reason
 * `ProfileName` does: `POST /users/me/avatar` — and `DELETE`, which answers
 * with the same profile carrying `avatarUrl: null` — returns the same shape
 * as `GET /users/me`, so the page's `LoadResult` stays the single source of
 * what this page shows and no refetch is needed. That is also what puts the
 * placeholder back in the dashboard header: it reads the avatar from its own
 * `GET /users/me` on mount, so navigating back to it after a removal shows
 * the initial, with nothing to keep in sync between the two screens.
 */
export function ProfileAvatar({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
}) {
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement>(null);
  const pickButtonRef = useRef<HTMLButtonElement>(null);
  const hadSelectionRef = useRef(false);
  const justRemovedRef = useRef(false);

  // The chosen file and its preview URL are one piece of state, not two, so
  // there is never a render where the avatar shows a `blob:` URL belonging to
  // a different file than the name printed under it.
  const [selection, setSelection] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which action last succeeded, as one value rather than a flag per outcome:
  // a save and a removal can't both be the most recent thing that happened,
  // and two booleans could claim they were.
  const [notice, setNotice] = useState<'saved' | 'removed' | null>(null);

  // Removal keeps its own three pieces of state rather than sharing the
  // upload's: the two never run at once (the Remove button only exists while
  // there is no selection to save), but they report in different places — the
  // upload under the preview, the removal inside its confirmation dialog —
  // and one shared `error` would surface whichever failed last in both.
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // `URL.createObjectURL` pins the file's bytes in memory until the URL is
  // revoked, so every preview has to be released — when the selection is
  // replaced (picking a second file before saving the first), when it is
  // cancelled or saved, and when this component unmounts with one still open.
  // A cleanup keyed on the selection covers all four; revoking at each of the
  // call sites that clear it would not cover the unmount.
  useEffect(() => {
    const url = selection?.previewUrl;

    return url ? () => URL.revokeObjectURL(url) : undefined;
  }, [selection]);

  // Clearing the selection — by saving or by cancelling — unmounts the button
  // the user is standing on, which would drop focus back to `<body>`. Put it
  // on the control that reopens the picker, the same way `ProfileName` hands
  // focus back to "Edit name" when its editor closes. Tracked with a ref
  // rather than keyed on `selection` alone so the first render doesn't steal
  // focus from wherever the page put it.
  useEffect(() => {
    if (!selection && hadSelectionRef.current) {
      pickButtonRef.current?.focus();
    }

    hadSelectionRef.current = selection !== null;
  }, [selection]);

  // A successful removal unmounts "Remove photo" — the button the dialog
  // would hand focus back to — so focus has to be placed deliberately, on the
  // control that is still there and now reads "Upload photo". Doing it in an
  // effect rather than in `handleRemove` waits for the parent to re-render
  // with the cleared profile, so the button being focused is the relabelled
  // one. This races nothing: the dialog's own restore runs in a
  // `requestAnimationFrame` and only acts when focus has landed on `<body>`,
  // so whichever of the two goes first, focus ends up here.
  useEffect(() => {
    if (justRemovedRef.current && !profile.avatarUrl) {
      justRemovedRef.current = false;
      pickButtonRef.current?.focus();
    }
  }, [profile.avatarUrl]);

  const selectFile = (files: FileList | null) => {
    const [picked] = Array.from(files ?? []);

    // A cancelled OS file picker fires `change` with an empty list — keep
    // whatever was already selected rather than silently discarding it. This
    // one is the only silent return here: nothing was picked, so there is
    // nothing to report.
    if (!picked) {
      return;
    }

    // A pick landing mid-upload is refused for a sharper reason: the request
    // already carries the previous file, so swapping the preview under it
    // would leave the card showing one image and the server storing another
    // the moment that request comes back. The Save button is already
    // `isPending` while this is true, so the only ways in are the drop zone
    // and a picker opened before the save started.
    //
    // Said out loud, and deliberately left on screen after a *successful*
    // save: dropping a file on the circle and getting no preview, then "Photo
    // updated." a moment later, reads as that file having been the one saved.
    // It wasn't, so the message names it and asks for it again. A save that
    // fails overwrites this with the server's reason instead — there is one
    // Alert, it can only hold one message, and the failure the user is
    // looking at beats a refusal they can act on afterwards.
    if (isPending) {
      setError(
        `${picked.name} — another photo was still saving. Pick it again.`,
      );
      return;
    }

    // Rejected before a byte is sent, per the same reasoning as the
    // meeting-file dropzone's `validateFile` call: the type and size
    // `validateAvatar` checks mirror the ones the backend enforces (see
    // `lib/users.ts`), so a file that fails here would come back a 400 anyway
    // — after the user waited for it to upload. Never the source of truth,
    // though: the server re-checks regardless, which is what `handleSave`'s
    // own error path is still there for.
    const rejection = validateAvatar(picked);

    if (rejection) {
      // A previous selection, if there is one, is deliberately kept — a bad
      // second pick is no reason to throw away a good first one the user
      // hasn't saved yet. That can leave this message next to a preview of a
      // *different* file, which is why it names the file it is about.
      setError(`${picked.name} — ${rejection}`);
      setNotice(null);
      return;
    }

    setError(null);
    setNotice(null);
    setSelection({ file: picked, previewUrl: URL.createObjectURL(picked) });
  };

  const handleSave = async () => {
    if (!selection || isPending) {
      return;
    }

    const token = getAccessToken();

    // Same reasoning as the page's Retry handler and `ProfileName`'s submit:
    // the session may have ended (a logout in another tab) while this
    // selection sat unsaved.
    if (!token) {
      router.replace('/login');
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      onSaved(await uploadAvatar(token, selection.file));
      // Dropping the selection swaps the `blob:` preview for the saved
      // `/api/avatars/...` URL — the same picture, but a different `src`, and
      // Radix's `Avatar` resets to its fallback whenever `src` changes, so the
      // initial placeholder shows for however long that (already warm, and
      // same-origin) fetch takes. Left as is rather than papering over it by
      // holding the preview: keeping a revoked-any-moment blob on screen to
      // hide a load would misreport which URL the page is actually showing.
      setSelection(null);
      setNotice('saved');
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

  const handleRemove = async () => {
    if (isRemoving) {
      return;
    }

    const token = getAccessToken();

    // Same reasoning as `handleSave`: the session may have ended in another
    // tab while this dialog sat open.
    if (!token) {
      router.replace('/login');
      return;
    }

    setIsRemoving(true);
    setRemoveError(null);

    try {
      const updated = await deleteAvatar(token);

      // Set before handing the cleared profile up, so the effect that runs on
      // the resulting render knows this removal is the one that moved focus.
      justRemovedRef.current = true;
      onSaved(updated);
      setNotice('removed');
      setIsRemoveOpen(false);
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

      // Anything else is shown inside the dialog, which stays open — the
      // avatar behind it is untouched, so closing on a failure would leave the
      // picture on screen with no word of why it is still there. Same handling
      // as `DeleteFileButton`'s.
      setRemoveError(
        cause instanceof ApiError ? cause.message : 'Something went wrong.',
      );
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-3">
      <div
        className={
          isDragging
            ? 'border-accent bg-accent/5 rounded-full border-2 border-dashed p-1 transition-colors'
            : 'rounded-full border-2 border-dashed border-transparent p-1 transition-colors'
        }
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          selectFile(event.dataTransfer.files);
        }}
      >
        <UserAvatar
          avatarUrl={selection?.previewUrl ?? profile.avatarUrl}
          email={profile.email}
          name={profile.name}
          size="xl"
        />
      </div>

      {/*
        Kept out of the drop zone above so dropping a file on the avatar
        doesn't have to compete with the input's own drop handling, and
        hidden rather than styled because a native file input can't be
        restyled to match the Button next to it. The zone and the Button
        below both route through `selectFile`.
      */}
      <input
        accept={AVATAR_INPUT_ACCEPT}
        aria-label="Choose a profile picture"
        className="hidden"
        onChange={(event) => {
          selectFile(event.target.files);
          // Reset so picking the exact same file again still fires `change`
          // — e.g. after cancelling a selection and changing one's mind.
          event.target.value = '';
        }}
        ref={inputRef}
        type="file"
      />

      {/*
        Neither outcome is otherwise announced at all. A removal replaces the
        picture with the initial and takes "Remove photo" away, both silent to
        a screen reader, and leaves focus on a button whose label merely
        changed from "Change" to "Upload"; a save swaps one image for another
        and puts the same two controls back, which is if anything quieter. So
        both report here, through one region — they are alternatives, never
        simultaneous, and a second region would only add a place for a stale
        one of the two to linger. Same live region as `ProfileName`'s "Name
        updated" — rendered unconditionally and at a fixed position so React
        keeps the node mounted, since a region that appears together with its
        content is announced unreliably — and `polite` for the same reason,
        the change is already on screen.

        Empty, it is `sr-only` rather than a bare empty element: this is a
        child of a `gap-3` flex column, where a zero-height item is still an
        item and would space the avatar 12px further from the buttons on
        every visit. `sr-only` is absolutely positioned, so it leaves the
        flow entirely while staying in the DOM and in the accessibility tree
        — which is what the region needs to be announced when it fills.

        Deliberately not `text-success` when it does fill: HeroUI's success
        green measures 2.2:1 on this card's background, fine for the check
        *icon* it tints in `components/meeting-files.tsx` but not for 12px
        text. The message carries its meaning in words rather than a colour.
      */}
      <p
        aria-live="polite"
        className={notice ? 'text-center text-xs font-medium' : 'sr-only'}
        role="status"
      >
        {notice === 'saved' && 'Photo updated.'}
        {notice === 'removed' && 'Photo removed.'}
      </p>

      {selection ? (
        <div className="flex max-w-56 flex-col items-center gap-2">
          {/*
            Says outright that what is on screen is not yet stored — the
            preview is rendered by the same component as a saved avatar, so
            without this line there is nothing to tell the two apart.
          */}
          <p className="max-w-full truncate text-center text-xs font-medium">
            {selection.file.name}
          </p>
          <p className="text-muted text-center text-xs">
            Preview — not saved yet
          </p>

          <div className="flex flex-wrap justify-center gap-2">
            <Button
              isPending={isPending}
              size="sm"
              onPress={() => void handleSave()}
            >
              {({ isPending: pending }) => (
                <>
                  {pending && <Spinner color="current" size="sm" />}
                  {pending ? 'Saving…' : 'Save photo'}
                </>
              )}
            </Button>
            <Button
              isDisabled={isPending}
              size="sm"
              variant="ghost"
              onPress={() => {
                setSelection(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex max-w-56 flex-col items-center gap-1.5">
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              ref={pickButtonRef}
              size="sm"
              variant="ghost"
              onPress={() => inputRef.current?.click()}
            >
              <UploadCloudIcon />
              {profile.avatarUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {/*
              Only offered when there is a picture to remove — a user on the
              initial placeholder has nothing to undo, and `DELETE
              /users/me/avatar` on an already-empty avatar succeeding (see
              `deleteAvatar`) makes a permanently-shown button a control that
              reports doing something while changing nothing.
            */}
            {profile.avatarUrl && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  // `error` is cleared alongside the dialog's own, because it
                  // belongs to the upload half of this component: leaving a
                  // rejected-file message up would put it in the same column
                  // as "Photo removed." and read as the removal having failed.
                  setError(null);
                  setRemoveError(null);
                  setNotice(null);
                  setIsRemoveOpen(true);
                }}
              >
                <TrashIcon />
                Remove photo
              </Button>
            )}
          </div>
          {/*
            The accepted formats and the size cap are stated up front rather
            than only after a rejection, same as the meeting-file dropzone's
            hint and the name field's character limit. `MAX_AVATAR_SIZE_MB`
            is the single source for the number, shared with the rejection
            message in `validateAvatar`.

            The drop target is named here too, because nothing about a
            circular avatar suggests one — and WCAG 2.2's "Dragging
            Movements" is satisfied by the button above regardless, so the
            drop is a shortcut that has to be discoverable to be worth
            having, never the only way in.
          */}
          <p className="text-muted text-center text-xs text-balance">
            Or drop an image on the circle. JPEG, PNG or WebP up to{' '}
            {MAX_AVATAR_SIZE_MB}MB.
          </p>
        </div>
      )}

      {/*
        One Alert for both ways an avatar fails to get stored — a file this
        component refused to send, and a request the backend refused — because
        the two say the same thing to the user (the picture isn't saved, here
        is why) and only one of them has a preview to sit under: a rejected
        file produces no selection, so a message living inside the preview
        branch above would have nowhere to render at exactly the moment it is
        needed. Hence here, outside the branch, rather than in it.

        Below that branch rather than above it, which is what it costs to keep
        the controls still: this Alert is purely additive — nothing else on
        the card changes when a picked file is refused — and above the branch
        it pushed the button the user has to press next 136px down the page,
        measured on a two-sentence rejection. The reason to try to put it
        higher would be proximity to the avatar it is about, but the control
        that produced it is nearer still, and after a failed save that control
        also has focus.

        A `danger` `Alert` rather than the small red paragraph this replaces,
        matching the failed name save one component over: with no preview
        around it, a line of red text is not obviously about the photo at all.

        `role="alert"`, because after a failed save the button that failed
        keeps focus and its label goes straight back from "Saving…" to "Save
        photo" — without an announcement a screen reader user is told nothing
        about why the picture still isn't saved. Focus is not moved to it the
        way `ProfileName` moves focus to its own: that one sits above a field
        the user may have scrolled past, this one is directly under the
        control that was just pressed.

        `wrap-anywhere` on the description because a rejection names the file
        it rejected, and a file name has no spaces to break at.

        `max-w-56`, the same cap as everything else in this column, even
        though the Alert spends ~60px of that on its indicator and padding
        and a two-sentence rejection ends up several lines tall. Tried 64
        (256px) for a more comfortable measure and reverted it: this column
        is `shrink-0`, so its widest child sets its width, and the extra 32px
        came straight out of the heading next to it — the `<h1>` started
        wrapping mid-email on a 1280px viewport for as long as the error was
        up. A slightly narrower error beats a card that reflows around it.
      */}
      {error && (
        <Alert className="max-w-56" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="wrap-anywhere">
              {error}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {/*
        Rendered outside the branch that owns the "Remove photo" button, not
        beside it: a successful removal clears `profile.avatarUrl` and closes
        the dialog in the same commit, and a dialog whose own subtree is torn
        out from under it in that commit never gets to run its exit or its
        focus handling.

        The confirmation itself follows `DeleteFileButton`'s (see
        `components/meeting-files.tsx`) — same reason to have one: `DELETE
        /users/me/avatar` erases the stored file, so an accidental press costs
        the user the original. Controlled by local `isOpen` state rather than
        the component's implicit trigger wiring, because the confirm button has
        to run a request and keep the dialog open on failure instead of closing
        the moment it is pressed.
      */}
      <AlertDialog.Backdrop
        isOpen={isRemoveOpen}
        onOpenChange={setIsRemoveOpen}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            {/*
              Disabled mid-request for the same reason Cancel below is: the
              request is already in flight and cannot be called off, so
              closing here would drop its outcome — a failure would set
              `removeError` into a dialog nobody can see, leaving the avatar
              in place with no word of why.
            */}
            <AlertDialog.CloseTrigger isDisabled={isRemoving} />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Remove your photo?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>
                This permanently deletes the image file. Your profile and the
                app header go back to showing your initial, and you can upload a
                new photo at any time.
              </p>
              {removeError && (
                <Alert role="alert" status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{removeError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isRemoving}
                variant="tertiary"
                onPress={() => setIsRemoveOpen(false)}
              >
                Cancel
              </Button>
              <Button
                isPending={isRemoving}
                variant="danger"
                onPress={() => void handleRemove()}
              >
                {({ isPending: pending }) => (
                  <>
                    {pending && <Spinner color="current" size="sm" />}
                    {pending ? 'Removing…' : 'Remove'}
                  </>
                )}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
