'use client';

import { Button, Spinner } from '@heroui/react';
import { useCallback, useRef, useState } from 'react';

import {
  CheckIcon,
  UploadCloudIcon,
  XCircleIcon,
  XIcon,
} from '@/components/icons';
import { ApiError, getAccessToken } from '@/lib/auth';
import {
  FILE_INPUT_ACCEPT,
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
