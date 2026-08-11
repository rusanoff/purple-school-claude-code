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
import { useState } from 'react';

import { Brand } from '@/components/brand';
import { ApiError, register, saveAccessToken } from '@/lib/auth';

/** Matches the backend's `@MinLength(6)` on `AuthCredentialsDto.password`. */
const MIN_PASSWORD_LENGTH = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const { email, password } = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<'email' | 'password', string>;

    setIsPending(true);
    setError(null);

    try {
      const { accessToken } = await register(email, password);
      saveAccessToken(accessToken);
      setIsRegistered(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong.',
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
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
            <>
              <div className="bg-success/15 text-success flex size-14 items-center justify-center rounded-full">
                <CheckIcon />
              </div>
              <Card.Header>
                <Card.Title className="text-2xl">
                  You&apos;re all set
                </Card.Title>
                <Card.Description>
                  Your account has been created and you are signed in.
                </Card.Description>
              </Card.Header>
            </>
          ) : (
            <>
              <Card.Header>
                <Card.Title className="text-2xl">
                  Create your account
                </Card.Title>
                <Card.Description>
                  Sign up with your email to get started.
                </Card.Description>
              </Card.Header>

              <Card.Content>
                <Form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                  {error && (
                    <Alert status="danger">
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
                    isDisabled={isPending}
                    name="email"
                    type="email"
                    validate={(value) =>
                      EMAIL_PATTERN.test(value)
                        ? null
                        : 'Enter a valid email address.'
                    }
                  >
                    <Label>Email</Label>
                    <InputGroup>
                      <InputGroup.Prefix>
                        <EnvelopeIcon />
                      </InputGroup.Prefix>
                      <InputGroup.Input
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </InputGroup>
                    <FieldError />
                  </TextField>

                  <TextField
                    fullWidth
                    isRequired
                    isDisabled={isPending}
                    name="password"
                    type={isPasswordVisible ? 'text' : 'password'}
                    validate={(value) =>
                      value.length >= MIN_PASSWORD_LENGTH
                        ? null
                        : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                    }
                  >
                    <Label>Password</Label>
                    <InputGroup>
                      <InputGroup.Prefix>
                        <LockIcon />
                      </InputGroup.Prefix>
                      <InputGroup.Input
                        autoComplete="new-password"
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
