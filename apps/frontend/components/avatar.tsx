'use client';

import { Avatar } from '@heroui/react';

/**
 * The reusable user avatar: the uploaded picture when there is one, an
 * initial placeholder when there isn't. Used anywhere the app shows "who
 * this is" — the dashboard header, `/profile`, and (later) the meeting
 * participant and file lists.
 *
 * **Why HeroUI's `Avatar` and not `next/image` or a hand-written `<img>`.**
 * `next/image` buys nothing here: the avatar URL only becomes known after a
 * client-side `GET /users/me` (the token lives in `localStorage`), so the
 * image can never be the LCP element or be preloaded, and it renders at
 * 32–96 CSS px from a same-origin `/api/...` path the frontend already
 * proxies to the backend — routing that through Next's optimizer would add a
 * Next→backend hop and an on-disk optimized copy of an already tiny file.
 * It also wants intrinsic dimensions, which a user-uploaded picture of an
 * arbitrary aspect ratio doesn't have.
 *
 * A hand-written `<img>` would instead need a targeted
 * `eslint-disable-next-line @next/next/no-img-element` (the `core-web-vitals`
 * rule set) plus its own `onError` handling. HeroUI's `Avatar` needs neither:
 * no `<img>` element is authored here, so the rule never fires and no
 * exception is needed, and its Radix primitive preloads the URL off-DOM and
 * only swaps a real `<img>` in once it has actually loaded. An avatar file
 * that is missing or was deleted therefore keeps showing the initial
 * placeholder rather than a broken-image icon, with nothing logged to the
 * console.
 */

/**
 * `sm`/`md`/`lg` are HeroUI's own 32/40/48px avatars; `xl` (96px) is this
 * app's profile-page size, which HeroUI has no variant for.
 *
 * Every size clears WCAG 2.2's 24 CSS px minimum target size on its own, so
 * an avatar-only link (none exists yet — today's call sites all pair it with
 * the user's name) doesn't need extra padding to stay tappable.
 */
export type UserAvatarSize = 'sm' | 'md' | 'lg' | 'xl';

const HEROUI_SIZE: Record<UserAvatarSize, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'lg',
};

/**
 * Class overrides for the sizes HeroUI doesn't have. Tailwind utilities sit
 * in a later cascade layer than HeroUI's component styles, so these win over
 * the `.avatar--lg` defaults without `!important`.
 */
const SIZE_OVERRIDES: Partial<
  Record<UserAvatarSize, { fallback: string; root: string }>
> = {
  // 30px of initial in a 96px circle keeps roughly the glyph-to-box ratio
  // HeroUI's own sizes use (14/40, 16/48), so `xl` doesn't read as a small
  // letter marooned in a large circle.
  xl: { fallback: 'text-3xl', root: 'size-24 rounded-full' },
};

interface UserAvatarProps {
  /**
   * The user's avatar URL, or `null` when they have none. Already carries the
   * `/api` prefix (see `lib/users.ts`) — don't add one.
   */
  avatarUrl: string | null;
  className?: string;
  /** Always known, and the fallback for the initial when `name` is `null`. */
  email: string;
  /**
   * Accessible name. Omit it — the default — when the avatar sits next to the
   * user's visible name, which is every current call site; the avatar is then
   * `aria-hidden` so a screen reader doesn't announce the same person twice.
   * Pass it only when the avatar stands alone (e.g. an icon-only link).
   */
  label?: string;
  /** `null` for a user who never set a name — see `UserProfile`. */
  name: string | null;
  size?: UserAvatarSize;
}

/**
 * The user's first initial, from their name when they have one and from
 * their email otherwise, so the placeholder is never blank. Split by code
 * point rather than by UTF-16 unit so a name starting with an emoji or an
 * astral-plane character renders as one whole character instead of half a
 * surrogate pair.
 */
function getInitial(name: string | null, email: string): string {
  const [initial] = Array.from(name?.trim() || email.trim());

  return initial ? initial.toLocaleUpperCase() : '?';
}

/**
 * The name to show for a user, falling back to their email — the same rule
 * `getInitial` uses, kept here so a screen can't label someone one way and
 * initial them another.
 */
export function getDisplayName(name: string | null, email: string): string {
  return name?.trim() || email;
}

export function UserAvatar({
  avatarUrl,
  className,
  email,
  label,
  name,
  size = 'md',
}: UserAvatarProps) {
  const overrides = SIZE_OVERRIDES[size];
  const rootClassName = [overrides?.root, className].filter(Boolean).join(' ');

  return (
    <Avatar
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={rootClassName || undefined}
      role={label === undefined ? undefined : 'img'}
      size={HEROUI_SIZE[size]}
    >
      {/* Labelled by the root, so the image itself is presentational. */}
      <Avatar.Image alt="" src={avatarUrl ?? undefined} />
      {/*
        Left on HeroUI's `default` fallback colour deliberately: it pairs
        `--default` with `--default-foreground`, which measures 14.9:1 in the
        light theme and 14.5:1 in the dark one — the accent/soft variants are
        the ones that trade contrast for colour.
      */}
      <Avatar.Fallback className={overrides?.fallback}>
        {getInitial(name, email)}
      </Avatar.Fallback>
    </Avatar>
  );
}
