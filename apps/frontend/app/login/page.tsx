'use client';

import {
  Alert,
  Button,
  Card,
  FieldError,
  Form,
  InputGroup,
  Label,
  Link,
  Spinner,
  TextField,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Brand } from '@/components/brand';
import { EnvelopeIcon, EyeIcon, LockIcon } from '@/components/icons';
import { ApiError, login, saveAccessToken } from '@/lib/auth';

/**
 * Loosely mirrors the backend's `@IsEmail()`: a local part, then one or more
 * dot-separated domain labels, none of them empty. Deliberately permissive —
 * the backend is the authority, this only catches obvious typos before a round
 * trip, so it must never reject an address the backend would accept.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export default function LoginPage() {
  const router = useRouter();

  const [isPending, setIsPending] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alertRef = useRef<HTMLDivElement>(null);

  // The backend's 401 doesn't say which of email/password is wrong (by
  // design — it never confirms an email exists), so failures are always
  // form-level. Move focus there so keyboard and screen reader users notice.
  useEffect(() => {
    if (error) {
      alertRef.current?.focus();
    }
  }, [error]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const { email, password } = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<'email' | 'password', string>;

    setIsPending(true);
    setError(null);

    try {
      const { accessToken } = await login(email, password);
      saveAccessToken(accessToken);
      router.push('/');
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong.',
      );
      setIsPending(false);
    }
  };

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
          <Card.Header>
            <Card.Title
              className="text-2xl"
              render={(props) => <h1 {...props} />}
            >
              Welcome back
            </Card.Title>
            <Card.Description>
              Sign in with your email to continue.
            </Card.Description>
          </Card.Header>

          <Card.Content>
            <Form className="flex flex-col gap-5" onSubmit={handleSubmit}>
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
                    <Alert.Title>Sign in failed</Alert.Title>
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
                validate={(value) => (value ? null : 'Enter your password.')}
              >
                <Label>Password</Label>
                <InputGroup>
                  <InputGroup.Prefix>
                    <LockIcon />
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    autoComplete="current-password"
                    className="min-w-0"
                    placeholder="••••••••"
                  />
                  <InputGroup.Suffix>
                    <Button
                      aria-label={
                        isPasswordVisible ? 'Hide password' : 'Show password'
                      }
                      size="sm"
                      variant="ghost"
                      onPress={() => setIsPasswordVisible((prev) => !prev)}
                    >
                      <EyeIcon isOpen={isPasswordVisible} />
                    </Button>
                  </InputGroup.Suffix>
                </InputGroup>
                <FieldError />
              </TextField>

              <Button fullWidth isPending={isPending} type="submit">
                {({ isPending: pending }) => (
                  <>
                    {pending && <Spinner color="current" size="sm" />}
                    {pending ? 'Signing in…' : 'Sign in'}
                  </>
                )}
              </Button>
            </Form>
          </Card.Content>

          <Card.Footer>
            <p className="text-muted text-sm">
              Don&apos;t have an account? <Link href="/register">Sign up</Link>
            </p>
          </Card.Footer>
        </Card>
      </div>
    </main>
  );
}
