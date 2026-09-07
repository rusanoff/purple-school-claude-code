'use client';

import { Button, Spinner } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { UserAvatar } from '@/components/avatar';
import { UploadCloudIcon } from '@/components/icons';
import { ApiError, clearAccessToken, getAccessToken } from '@/lib/auth';
import {
  AVATAR_INPUT_ACCEPT,
  MAX_AVATAR_SIZE_MB,
  uploadAvatar,
  type UserProfile,
} from '@/lib/users';

/**
 * The picture half of the profile card header: the current avatar, a zone to
 * drop or pick a new one, and — once a file is chosen — a preview of it with
 * Save/Cancel, so nothing is uploaded until the user has seen what they
 * picked.
 *
 * The preview reuses `UserAvatar` with a local `blob:` URL rather than a
 * separate `<img>`, so what the user is shown before saving is rendered by
 * the exact component that will show it afterwards — same circle, same size,
 * same cropping — instead of an approximation that can differ from the
 * result.
 *
 * `onSaved` hands the updated profile back to the page for the same reason
 * `ProfileName` does: `POST /users/me/avatar` returns the same shape as
 * `GET /users/me`, so the page's `LoadResult` stays the single source of
 * what this page shows and no refetch is needed.
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
      // Dropping the selection swaps the preview for the saved avatar, which
      // is the same picture — so the only visible change is the Save/Cancel
      // pair going away, not a flash of the old one.
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
          <Button
            size="sm"
            variant="ghost"
            onPress={() => inputRef.current?.click()}
          >
            <UploadCloudIcon />
            {profile.avatarUrl ? 'Change photo' : 'Upload photo'}
          </Button>
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
    </div>
  );
}
