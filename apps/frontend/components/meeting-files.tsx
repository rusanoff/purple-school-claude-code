'use client';

import { Alert, Button, Card, EmptyState, Spinner } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CheckIcon,
  DocumentIcon,
  FileIcon,
  FilmIcon,
  MusicNoteIcon,
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
  FILE_INPUT_ACCEPT,
  getFileCategory,
  listMeetingFiles,
  MAX_FILE_SIZE_BYTES,
  uploadMeetingFile,
  validateFile,
  type MeetingFile,
} from '@/lib/files';

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

const MAX_FILE_SIZE_MB = Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024));

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
    [meetingId, onUploaded],
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
          id: crypto.randomUUID(),
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
 * The file list itself: name, type icon, size, upload date, uploader.
 * `MeetingFileResponse` only carries `uploadedById` (a user id), not an
 * email — the backend doesn't expose one for a meeting's owner/participants
 * anywhere the frontend can currently read (see the root `CLAUDE.md`'s
 * access-check notes), so the only uploader this can identify by name is
 * the signed-in user themself; anyone else just reads as "Meeting
 * participant" rather than a fabricated or misleading identity.
 */
function MeetingFileList({ files }: { files: MeetingFile[] }) {
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
            <span className="text-muted truncate text-xs">
              {formatFileSize(file.size)} · {formatMeetingDate(file.createdAt)}{' '}
              ·{' '}
              {file.uploadedById === currentUserId
                ? 'You'
                : 'Meeting participant'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The files section of the meeting detail page (`app/meetings/[id]/page.tsx`)
 * — upload dropzone above the current file list. Fetches its own list on
 * mount rather than receiving one as a prop: it needs to refetch after a
 * retry, and owning that state here keeps the page component from having to
 * know about files at all.
 */
export function MeetingFilesSection({ meetingId }: { meetingId: string }) {
  const router = useRouter();

  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [files, setFiles] = useState<MeetingFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shared by the initial load and the "Retry" button, same pattern as the
  // meeting fetch above it on the page.
  const loadFiles = useCallback(
    async (token: string) => {
      try {
        const data = await listMeetingFiles(token, meetingId);
        setFiles(data);
        setError(null);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          clearAccessToken();
          router.replace('/login');
          return;
        }

        setError(
          cause instanceof ApiError ? cause.message : 'Something went wrong.',
        );
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

  const handleRetry = () => {
    const token = getAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    setStatus('loading');
    void loadFiles(token);
  };

  // New uploads are prepended rather than triggering a refetch — the list
  // is already newest-first (matches the backend's ordering), and the
  // upload response is itself the newest file.
  const handleUploaded = (file: MeetingFile) => {
    setFiles((prev) => (prev ? [file, ...prev] : [file]));
  };

  return (
    <Card className="min-w-0 gap-6 p-6 sm:p-8">
      <Card.Header>
        <Card.Title className="text-base" render={(props) => <h2 {...props} />}>
          Files
        </Card.Title>
      </Card.Header>
      <Card.Content className="flex min-w-0 flex-col gap-6">
        <MeetingFileUpload meetingId={meetingId} onUploaded={handleUploaded} />

        {status === 'loading' && (
          <div className="flex justify-center py-8">
            <Spinner aria-label="Loading files" />
          </div>
        )}

        {status === 'ready' && error && (
          <Alert role="alert" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Couldn&apos;t load files</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
            <Button onPress={handleRetry} size="sm" variant="ghost">
              Retry
            </Button>
          </Alert>
        )}

        {status === 'ready' && !error && files && (
          <MeetingFileList files={files} />
        )}
      </Card.Content>
    </Card>
  );
}
