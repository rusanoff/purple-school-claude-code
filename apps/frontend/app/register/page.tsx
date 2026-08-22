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
import { useEffect, useRef, useState } from 'react';

import { Brand } from '@/components/brand';
import { ApiError, register, saveAccessToken } from '@/lib/auth';

/** Matches the backend's `@MinLength(6)` on `AuthCredentialsDto.password`. */
const MIN_PASSWORD_LENGTH = 6;
/**
 * Loosely mirrors the backend's `@IsEmail()`: a local part, then one or more
 * dot-separated domain labels, none of them empty. Deliberately permissive —
 * the backend is the authority, this only catches obvious typos before a round
 * trip, so it must never reject an address the backend would accept.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function EnvelopeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path
        d="m3.5 7 8.5 6 8.5-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <rect height="10" rx="2" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!isOpen && <path d="m4 4 16 16" />}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function RegisterPage() {
  const [isPending, setIsPending] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Server errors that belong to one field — currently just the 409 on a
   * duplicate email. React Aria renders these in that field's `FieldError` and
   * clears them by itself as soon as the user edits the value, which is why
   * they are kept apart from the form-level `error`.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const alertRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  /**
   * Submitting replaces or adds content the user is not looking at, and the
   * submit button they pressed may be unmounted. Move focus to whatever the
   * outcome was so keyboard and screen reader users land on it instead of
   * being dropped back on `<body>`.
   */
  useEffect(() => {
    if (isRegistered) {
      successRef.current?.focus();
    } else if (fieldErrors.email) {
      emailRef.current?.focus();
    } else if (error) {
      alertRef.current?.focus();
    }
  }, [error, fieldErrors, isRegistered]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const { email, password } = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<'email' | 'password', string>;

    setIsPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const { accessToken } = await register(email, password);
      saveAccessToken(accessToken);
      setIsRegistered(true);
    } catch (cause) {
      // A 409 is about the email specifically, so it belongs on that field
      // rather than in the form-level alert.
      if (cause instanceof ApiError && cause.status === 409) {
        setFieldErrors({ email: cause.message });
      } else {
        setError(
          cause instanceof ApiError ? cause.message : 'Something went wrong.',
        );
      }
    } finally {
      setIsPending(false);
    }
  };

  // Any edit makes the form-level error stale. Field-level server errors need
  // no such handling — React Aria clears those itself.
  const handleChange = () => {
    if (error) {
      setError(null);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="bg-accent/25 absolute -top-48 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-3xl" />
        <div className="bg-success/15 absolute -bottom-40 -right-32 size-[26rem] rounded-full blur-3xl" />
      </div>

      <div className="flex w-full max-w-md flex-col gap-8">
        <Brand />

        <Card className="gap-6 p-8 shadow-xl">
          {isRegistered ? (
            <div
              className="flex flex-col gap-6 outline-none"
              ref={successRef}
              tabIndex={-1}
            >
              <div className="bg-success/15 text-success flex size-14 items-center justify-center rounded-full">
                <CheckIcon />
              </div>
              <Card.Header>
                <Card.Title
                  className="text-2xl"
                  render={(props) => <h1 {...props} />}
                >
                  You&apos;re all set
                </Card.Title>
                <Card.Description>
                  Your account has been created and you are signed in.
                </Card.Description>
              </Card.Header>
            </div>
          ) : (
            <>
              <Card.Header>
                <Card.Title
                  className="text-2xl"
                  render={(props) => <h1 {...props} />}
                >
                  Create your account
                </Card.Title>
                <Card.Description>
                  Sign up with your email to get started.
                </Card.Description>
              </Card.Header>

              <Card.Content>
                <Form
                  className="flex flex-col gap-5"
                  validationErrors={fieldErrors}
                  onSubmit={handleSubmit}
                >
                  {error && (
                    <Alert
                      className="outline-none"
                      ref={alertRef}
                      role="alert"
                      status="danger"
                      tabIndex={-1}
                    >
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>Registration failed</Alert.Title>
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}

                  <TextField
                    fullWidth
                    isRequired
                    name="email"
                    type="email"
                    onChange={handleChange}
                    validate={(value) => {
                      if (!value) {
                        return 'Enter your email address.';
                      }

                      return EMAIL_PATTERN.test(value)
                        ? null
                        : 'Enter a valid email address.';
                    }}
                  >
                    <Label>Email</Label>
                    <InputGroup>
                      <InputGroup.Prefix>
                        <EnvelopeIcon />
                      </InputGroup.Prefix>
                      <InputGroup.Input
                        autoFocus
                        autoComplete="email"
                        className="min-w-0"
                        placeholder="you@example.com"
                        ref={emailRef}
                      />
                    </InputGroup>
                    <FieldError />
                  </TextField>

                  <TextField
                    fullWidth
                    isRequired
                    name="password"
                    type={isPasswordVisible ? 'text' : 'password'}
                    onChange={handleChange}
                    validate={(value) => {
                      if (!value) {
                        return 'Enter a password.';
                      }

                      return value.length >= MIN_PASSWORD_LENGTH
                        ? null
                        : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
                    }}
                  >
                    <Label>Password</Label>
                    <InputGroup>
                      <InputGroup.Prefix>
                        <LockIcon />
                      </InputGroup.Prefix>
                      <InputGroup.Input
                        autoComplete="new-password"
                        className="min-w-0"
                        placeholder="••••••••"
                      />
                      <InputGroup.Suffix>
                        <Button
                          aria-label={
                            isPasswordVisible
                              ? 'Hide password'
                              : 'Show password'
                          }
                          size="sm"
                          variant="ghost"
                          onPress={() => setIsPasswordVisible((prev) => !prev)}
                        >
                          <EyeIcon isOpen={isPasswordVisible} />
                        </Button>
                      </InputGroup.Suffix>
                    </InputGroup>
                    <Description>
                      At least {MIN_PASSWORD_LENGTH} characters.
                    </Description>
                    <FieldError />
                  </TextField>

                  <Button fullWidth isPending={isPending} type="submit">
                    {({ isPending: pending }) => (
                      <>
                        {pending && <Spinner color="current" size="sm" />}
                        {pending ? 'Creating account…' : 'Create account'}
                      </>
                    )}
                  </Button>
                </Form>
              </Card.Content>

              <Card.Footer>
                <p className="text-muted text-sm">
                  By signing up you agree to our terms of service.
                </p>
              </Card.Footer>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
