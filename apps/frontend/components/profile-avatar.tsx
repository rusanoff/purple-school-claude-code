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

  // Removal keeps its own three pieces of state rather than sharing the
  // upload's: the two never run at once (the Remove button only exists while
  // there is no selection to save), but they report in different places — the
  // upload under the preview, the removal inside its confirmation dialog —
  // and one shared `error` would surface whichever failed last in both.
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [isRemoved, setIsRemoved] = useState(false);

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
    // whatever was already selected rather than silently discarding it.
    //
    // A pick landing mid-upload is refused for a sharper reason: the request
    // already carries the previous file, so swapping the preview under it
    // would leave the card showing one image and the server storing another
    // the moment that request comes back. The Save button is already
    // `isPending` while this is true, so the only ways in are the drop zone
    // and a picker opened before the save started.
    if (!picked || isPending) {
      return;
    }

    setError(null);
    setIsRemoved(false);
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
      setIsRemoved(true);
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
        A removal is otherwise announced by nothing at all: the picture is
        replaced by the initial and "Remove photo" disappears, both of which
        are silent to a screen reader, and focus lands on a button whose label
        merely changed from "Change" to "Upload". Same live region as
        `ProfileName`'s "Name updated" — rendered unconditionally and at a
        fixed position so React keeps the node mounted, since a region that
        appears together with its content is announced unreliably — and
        `polite` for the same reason, the change is already on screen.

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
        className={isRemoved ? 'text-center text-xs font-medium' : 'sr-only'}
        role="status"
      >
        {isRemoved ? 'Photo removed.' : ''}
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

          {/*
            `role="alert"` rather than a plain paragraph: the button that
            failed keeps focus and its label goes straight back from
            "Saving…" to "Save photo", so without an announcement a screen
            reader user is told nothing at all about why the picture is
            still not saved.
          */}
          {error && (
            <p className="text-danger text-center text-xs" role="alert">
              {error}
            </p>
          )}

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
                  setRemoveError(null);
                  setIsRemoved(false);
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
