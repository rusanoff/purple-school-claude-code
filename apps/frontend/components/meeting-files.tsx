'use client';

import {
  Alert,
  AlertDialog,
  Button,
  Card,
  EmptyState,
  Spinner,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CheckIcon,
  DocumentIcon,
  DownloadIcon,
  FileIcon,
  FilmIcon,
  LockIcon,
  MusicNoteIcon,
  SearchOffIcon,
  TrashIcon,
  UploadCloudIcon,
  XCircleIcon,
  XIcon,
} from '@/components/icons';
import {
  ApiError,
  clearAccessToken,
  getAccessToken,
  getCurrentUserId,
} from '@/lib/auth';
import { formatFileSize, formatMeetingDate } from '@/lib/format';
import {
  deleteMeetingFile,
  downloadMeetingFile,
  FILE_INPUT_ACCEPT,
  getFileCategory,
  listMeetingFiles,
  MAX_FILE_SIZE_MB,
  uploadMeetingFile,
  validateFile,
  type MeetingFile,
} from '@/lib/files';

/**
 * `crypto.randomUUID()` requires a secure context (HTTPS, or localhost) and
 * throws outside one — this is only ever used for a local, non-security-
 * sensitive React key/queue-item id, so a fallback keeps the dropzone
 * working instead of throwing on a plain-HTTP deployment.
 */
function generateLocalId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to the non-crypto fallback below.
    }
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One entry in the upload queue below the dropzone. `id` is local-only (not
 * the backend's file id, which doesn't exist yet for an in-flight or
 * rejected upload) — used purely as the React key and to update this one
 * entry's status without touching the others.
 */
interface UploadItem {
  id: string;
  file: File;
  status: 'uploading' | 'success' | 'error';
  error?: string;
}

/**
 * File-upload dropzone for a meeting's file list. Owns its own upload queue
 * (task "Отображение состояния загрузки: в процессе / успешно / ошибка") —
 * every dropped/picked file gets its own row with a status, so one slow or
 * failed upload doesn't block or hide the others. `onUploaded` is called
 * once per file that finishes successfully, so the parent (`MeetingFiles`)
 * can add it to the file list without a full refetch.
 */
export function MeetingFileUpload({
  meetingId,
  onUploaded,
}: {
  meetingId: string;
  onUploaded: (file: MeetingFile) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);

  const runUpload = useCallback(
    async (id: string, token: string, file: File) => {
      try {
        const uploaded = await uploadMeetingFile(token, meetingId, file);
        setQueue((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: 'success' } : item,
          ),
        );
        onUploaded(uploaded);
      } catch (cause) {
        // Same as every other 401 on this page (the meeting fetch, the file
        // list fetch): an expired/invalid token ends the session, so this
        // redirects rather than just showing "Unauthorized" as if retrying
        // the same upload could ever succeed.
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          router.replace('/login');
          return;
        }

        setQueue((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'error',
                  error:
                    cause instanceof ApiError
                      ? cause.message
                      : 'Upload failed.',
                }
              : item,
          ),
        );
      }
    },
    [meetingId, onUploaded, router],
  );

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      // The page this lives on already redirects to /login when there's no
      // token; a token missing by the time a file is dropped means it was
      // cleared since the last render (e.g. logout in another tab) — there's
      // nothing useful this widget can do about that on its own, so it just
      // no-ops rather than queuing uploads doomed to 401.
      const token = getAccessToken();
      if (!token) return;

      const files = Array.from(fileList);
      if (files.length === 0) return;

      const items: UploadItem[] = files.map((file) => {
        const validationError = validateFile(file);
        return {
          id: generateLocalId(),
          file,
          status: validationError ? 'error' : 'uploading',
          error: validationError ?? undefined,
        };
      });

      setQueue((prev) => [...prev, ...items]);

      // Invalid files were rejected client-side above — they never reach
      // the network, per the "rejected before it's ever sent" requirement.
      for (const item of items) {
        if (item.status === 'uploading') {
          void runUpload(item.id, token, item.file);
        }
      }
    },
    [runUpload],
  );

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) handleFiles(event.target.files);
    // Reset so selecting the exact same file again still fires onChange.
    event.target.value = '';
  };

  const dismissItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const hasFinishedItems = queue.some((item) => item.status !== 'uploading');

  return (
    <div className="flex flex-col gap-3">
      <div
        className={
          isDragging
            ? 'border-accent bg-accent/5 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors'
            : 'border-border hover:border-accent/60 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors'
        }
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <span className="bg-accent/15 text-accent flex size-12 items-center justify-center rounded-full">
          <UploadCloudIcon />
        </span>
        <p className="text-foreground text-sm font-medium">
          Drag and drop a file here, or click to browse
        </p>
        <p className="text-muted text-xs">
          Audio, video, or documents (PDF, Word, Excel, PowerPoint, text/CSV) up
          to {MAX_FILE_SIZE_MB}MB
        </p>
        <input
          accept={FILE_INPUT_ACCEPT}
          aria-label="Upload file"
          className="hidden"
          multiple
          onChange={handleInputChange}
          ref={inputRef}
          type="file"
        />
      </div>

      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          {queue.map((item) => (
            <UploadQueueRow
              item={item}
              key={item.id}
              onDismiss={() => dismissItem(item.id)}
            />
          ))}
          {hasFinishedItems && (
            <Button
              className="w-fit"
              onPress={() =>
                setQueue((prev) =>
                  prev.filter((item) => item.status === 'uploading'),
                )
              }
              size="sm"
              variant="ghost"
            >
              Clear finished
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function UploadQueueRow({
  item,
  onDismiss,
}: {
  item: UploadItem;
  onDismiss: () => void;
}) {
  return (
    <div className="border-border bg-surface flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3">
      <span className="shrink-0">
        {item.status === 'uploading' && (
          <Spinner aria-label="Uploading" size="sm" />
        )}
        {item.status === 'success' && (
          <span className="text-success flex size-5 items-center justify-center">
            <CheckIcon />
          </span>
        )}
        {item.status === 'error' && (
          <span className="text-danger flex size-5 items-center justify-center">
            <XCircleIcon />
          </span>
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{item.file.name}</span>
        <span className="text-muted text-xs">
          {item.status === 'uploading' && 'Uploading…'}
          {item.status === 'success' && 'Uploaded'}
          {item.status === 'error' && (
            <span className="text-danger">{item.error}</span>
          )}
        </span>
      </div>

      {item.status !== 'uploading' && (
        <Button
          aria-label="Dismiss"
          className="shrink-0"
          isIconOnly
          onPress={onDismiss}
          size="sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

function getFileTypeIcon(mimeType: string) {
  switch (getFileCategory(mimeType)) {
    case 'audio':
      return <MusicNoteIcon />;
    case 'video':
      return <FilmIcon />;
    case 'document':
      return <DocumentIcon />;
    case 'other':
      return <FileIcon />;
  }
}

/**
 * Icon-only download action for one file row. Fetches the file as a blob
 * (`downloadMeetingFile` — a plain `<a href>` can't carry the bearer token
 * the route requires) rather than navigating directly, so it needs its own
 * pending/error state rather than being a plain link. A failure renders an
 * inline message next to the button instead of throwing — same
 * don't-break-the-list rationale as `DeleteFileButton`'s error handling
 * below, just without a dialog to show it in.
 */
function DownloadFileButton({
  file,
  meetingId,
}: {
  file: MeetingFile;
  meetingId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'downloading' | 'error'>(
    'idle',
  );

  const handleDownload = async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setStatus('downloading');
    try {
      await downloadMeetingFile(token, meetingId, file.id, file.filename);
      setStatus('idle');
    } catch (cause) {
      // Same 401-ends-the-session handling as everywhere else on this page.
      if (cause instanceof ApiError && cause.status === 401) {
        clearAccessToken();
        router.replace('/login');
        return;
      }
      setStatus('error');
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {status === 'error' && (
        <span className="text-danger text-xs">Couldn&apos;t download</span>
      )}
      <Button
        aria-label={`Download ${file.filename}`}
        isIconOnly
        isPending={status === 'downloading'}
        onPress={() => void handleDownload()}
        size="sm"
        variant="ghost"
      >
        <DownloadIcon />
      </Button>
    </div>
  );
}

/**
 * Delete action for one file row — the caller (`MeetingFileList`) only
 * renders this at all when `isOwner || file.uploadedById === currentUserId`
 * holds, so there's no separate `canDelete` prop here to gate on. Requires
 * an explicit confirmation before the irreversible `DELETE` — an
 * `AlertDialog` fully controlled by local `isOpen` state rather than the
 * component's implicit trigger wiring, since the confirm button needs to
 * run an async request and stay open on failure instead of closing
 * immediately the way `slot="close"` would.
 */
function DeleteFileButton({
  file,
  meetingId,
  onDeleted,
}: {
  file: MeetingFile;
  meetingId: string;
  onDeleted: (fileId: string) => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // `null` doubles as "no error" — kept as the single source of truth
  // rather than a separate `status === 'error'` flag, so the two can't
  // drift out of sync (e.g. one set without the other).
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setError(null);
    setIsOpen(true);
  };

  const handleConfirm = async () => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      await deleteMeetingFile(token, meetingId, file.id);
      setIsOpen(false);
      onDeleted(file.id);
    } catch (cause) {
      // Same 401-ends-the-session handling as everywhere else on this page.
      if (cause instanceof ApiError && cause.status === 401) {
        clearAccessToken();
        router.replace('/login');
        return;
      }

      // Anything else (most notably a 403 — the delete right this button
      // was rendered for turned out to be stale, e.g. ownership changed in
      // another tab) is shown inline in the dialog rather than thrown: the
      // dialog stays open, and the file list behind it is untouched.
      setError(
        cause instanceof ApiError ? cause.message : 'Failed to delete file.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button
        aria-label={`Delete ${file.filename}`}
        isIconOnly
        onPress={openDialog}
        size="sm"
        variant="ghost"
      >
        <TrashIcon />
      </Button>

      <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>Delete this file?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="flex flex-col gap-3">
              <p>
                This permanently deletes{' '}
                <strong className="text-foreground">{file.filename}</strong> —
                both its record and the file on disk. This action cannot be
                undone.
              </p>
              {error && (
                <Alert role="alert" status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                isDisabled={isDeleting}
                onPress={() => setIsOpen(false)}
                variant="tertiary"
              >
                Cancel
              </Button>
              <Button
                isPending={isDeleting}
                onPress={() => void handleConfirm()}
                variant="danger"
              >
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}

/**
 * The file list itself: name, type icon, size, upload date, uploader, plus
 * per-row download/delete actions. `MeetingFileResponse` only carries
 * `uploadedById` (a user id), not an email — the backend doesn't expose one
 * for a meeting's owner/participants anywhere the frontend can currently
 * read (see the root `CLAUDE.md`'s access-check notes), so the only
 * uploader this can identify by name is the signed-in user themself; anyone
 * else just reads as "Meeting participant" rather than a fabricated or
 * misleading identity.
 */
function MeetingFileList({
  files,
  isOwner,
  meetingId,
  onDeleted,
}: {
  files: MeetingFile[];
  isOwner: boolean;
  meetingId: string;
  onDeleted: (fileId: string) => void;
}) {
  const currentUserId = getCurrentUserId();

  if (files.length === 0) {
    return (
      <EmptyState className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="bg-accent/15 text-accent flex size-12 items-center justify-center rounded-full">
          <UploadCloudIcon />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-foreground text-sm font-medium">No files yet</p>
          <p className="text-muted text-xs">
            Files uploaded to this meeting will show up here.
          </p>
        </div>
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {files.map((file) => (
        <li
          className="border-border flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3"
          key={file.id}
        >
          <span className="text-muted flex size-9 shrink-0 items-center justify-center">
            {getFileTypeIcon(file.mimeType)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              {file.filename}
            </span>
            {/* Not `truncate` — unlike the filename above, this is a short,
                fixed set of values (size, date, uploader), not an
                unbounded one. Truncating it clips the uploader label
                mid-word on a narrow viewport instead; wrapping to a second
                line keeps all three readable. */}
            <span className="text-muted text-xs">
              {formatFileSize(file.size)} · {formatMeetingDate(file.createdAt)}{' '}
              ·{' '}
              {file.uploadedById === currentUserId
                ? 'You'
                : 'Meeting participant'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <DownloadFileButton file={file} meetingId={meetingId} />
            {(isOwner || file.uploadedById === currentUserId) && (
              <DeleteFileButton
                file={file}
                meetingId={meetingId}
                onDeleted={onDeleted}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The outcome of fetching this meeting's files — one discriminated union
 * rather than separate `files`/`error` state, same rationale as the page's
 * own `LoadResult` one file over: independent booleans let a retry that
 * fails a *different* way than the first attempt leave stale data behind
 * instead of cleanly replacing it. `forbidden`/`not-found` mirror
 * `assertMeetingAccess`'s 403/404 (see the root `CLAUDE.md`) — reachable
 * here if access was revoked or the meeting was deleted after the page's
 * own meeting fetch already succeeded.
 */
type FilesLoadResult =
  | { kind: 'success'; files: MeetingFile[] }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

/**
 * The files section of the meeting detail page (`app/meetings/[id]/page.tsx`)
 * — upload dropzone above the current file list. Fetches its own list on
 * mount rather than receiving one as a prop: it needs to refetch after a
 * retry, and owning that state here keeps the page component from having to
 * know about files at all. The page renders this with `key={meetingId}` so
 * navigating client-side between two different meetings remounts it instead
 * of leaking one meeting's upload queue/file list into another's. `isOwner`
 * comes from the page (`isMeetingOwner` in `lib/meetings.ts`, derived from
 * the meeting it already fetched) — decides who sees the delete button for
 * which files in the list below.
 */
export function MeetingFilesSection({
  isOwner,
  meetingId,
}: {
  isOwner: boolean;
  meetingId: string;
}) {
  const router = useRouter();

  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [result, setResult] = useState<FilesLoadResult | null>(null);

  // Shared by the initial load and the "Retry" button, same pattern as the
  // meeting fetch above it on the page.
  const loadFiles = useCallback(
    async (token: string) => {
      try {
        const data = await listMeetingFiles(token, meetingId);
        setResult({ kind: 'success', files: data });
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          router.replace('/login');
          return;
        }

        if (cause instanceof ApiError && cause.status === 403) {
          setResult({ kind: 'forbidden' });
        } else if (cause instanceof ApiError && cause.status === 404) {
          setResult({ kind: 'not-found' });
        } else {
          setResult({
            kind: 'error',
            message:
              cause instanceof ApiError
                ? cause.message
                : 'Something went wrong.',
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

    // This section only mounts once the meeting itself has already loaded
    // successfully on a token that was valid moments ago — still async per
    // the same set-state-in-effect rule the page's own fetch follows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFiles(token);
  }, [loadFiles, router]);

  const handleRetry = useCallback(() => {
    const token = getAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    setStatus('loading');
    void loadFiles(token);
  }, [loadFiles, router]);

  // New uploads are prepended rather than triggering a refetch — the list
  // is already newest-first (matches the backend's ordering), and the
  // upload response is itself the newest file. useCallback here isn't just
  // hygiene — MeetingFileUpload's own runUpload/handleFiles are memoized on
  // this prop's identity, so an unstable one here would silently defeat
  // that memoization on every render.
  const handleUploaded = useCallback((file: MeetingFile) => {
    setResult((prev) =>
      prev?.kind === 'success'
        ? { kind: 'success', files: [file, ...prev.files] }
        : prev,
    );
  }, []);

  // Mirrors `handleUploaded` for the opposite direction — a successful
  // delete removes the row from local state instead of triggering a
  // refetch. Passed to `MeetingFileList`, which is why it's memoized.
  const handleDeleted = useCallback((fileId: string) => {
    setResult((prev) =>
      prev?.kind === 'success'
        ? { kind: 'success', files: prev.files.filter((f) => f.id !== fileId) }
        : prev,
    );
  }, []);

  // Forbidden/not-found are permanent for this meeting — pointless to offer
  // an upload dropzone for files that couldn't be listed for the same
  // access reason, so it only renders while that's not the known state.
  const showUpload =
    result?.kind !== 'forbidden' && result?.kind !== 'not-found';

  return (
    <Card className="min-w-0 gap-6 p-6 sm:p-8">
      <Card.Header>
        <Card.Title className="text-base" render={(props) => <h2 {...props} />}>
          Files
        </Card.Title>
      </Card.Header>
      <Card.Content className="flex min-w-0 flex-col gap-6">
        {showUpload && (
          <MeetingFileUpload
            meetingId={meetingId}
            onUploaded={handleUploaded}
          />
        )}

        {status === 'loading' && (
          <div className="flex justify-center py-8">
            <Spinner aria-label="Loading files" />
          </div>
        )}

        {status === 'ready' &&
          (result?.kind === 'forbidden' || result?.kind === 'not-found') && (
            <EmptyState className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="bg-danger/15 text-danger flex size-12 items-center justify-center rounded-full">
                {result.kind === 'forbidden' ? <LockIcon /> : <SearchOffIcon />}
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-foreground text-sm font-medium">
                  {result.kind === 'forbidden'
                    ? "You don't have access to these files"
                    : 'Meeting not found'}
                </p>
                <p className="text-muted text-xs">
                  {result.kind === 'forbidden'
                    ? "Only this meeting's owner and participants can view its files."
                    : 'It may have been deleted since this page loaded.'}
                </p>
              </div>
            </EmptyState>
          )}

        {status === 'ready' && result?.kind === 'error' && (
          <Alert role="alert" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Couldn&apos;t load files</Alert.Title>
              <Alert.Description>{result.message}</Alert.Description>
            </Alert.Content>
            <Button onPress={handleRetry} size="sm" variant="ghost">
              Retry
            </Button>
          </Alert>
        )}

        {status === 'ready' && result?.kind === 'success' && (
          <MeetingFileList
            files={result.files}
            isOwner={isOwner}
            meetingId={meetingId}
            onDeleted={handleDeleted}
          />
        )}
      </Card.Content>
    </Card>
  );
}
