'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSignUp } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AuthCard,
  AuthFooterLinks,
  AuthHeader,
  AuthPageShell,
  DividerWithLabel,
  GoogleIcon,
  InlineFeedbackArea,
} from '@/components/auth/AuthShell';
import { parseClerkError, type FieldErrors } from '@/components/auth/clerk-error';

const inputBaseClass =
  'h-11 border-border bg-background focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring-strong)] focus-visible:border-[var(--accent-primary)]';

export function SignUpForm() {
  const router = useRouter();
  const { isLoaded, signUp, setActive } = useSignUp();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const isBusy = isSubmitting || isGoogleSubmitting;
  const canSubmit = isLoaded && !isBusy;

  const emailErrorId = useMemo(() => (fieldErrors.email ? 'sign-up-email-error' : undefined), [fieldErrors.email]);
  const passwordErrorId = useMemo(
    () => (fieldErrors.password ? 'sign-up-password-error' : undefined),
    [fieldErrors.password]
  );

  const validate = () => {
    const nextErrors: FieldErrors = {};

    if (!email.trim()) {
      nextErrors.email = 'Enter your email address.';
    } else if (!/^\S+@\S+\.\S+$/.test(email)) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Create a password.';
    } else if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    }

    if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleGoogle = async () => {
    if (!signUp || !isLoaded || isBusy) return;

    setFormError('');
    setIsGoogleSubmitting(true);

    try {
      await signUp.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sign-up',
        redirectUrlComplete: '/',
      });
    } catch (error) {
      const parsed = parseClerkError(error, 'Could not continue with Google. Please try again.');
      setFormError(parsed.formError);
      setIsGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!signUp || !setActive || !isLoaded || isBusy) return;

    setFormError('');
    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const result = await signUp.create({
        emailAddress: email.trim(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/');
        return;
      }

      setFormError('Check your email to verify your account and continue.');
    } catch (error) {
      const parsed = parseClerkError(error, 'Could not create your account. Please try again.');
      setFormError(parsed.formError);
      setFieldErrors((prev) => ({ ...prev, ...parsed.fieldErrors }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPageShell>
      <AuthCard>
        <div className="space-y-4">
          <AuthHeader title="Create your account" subtitle="Start building with Koda in seconds." />

          <InlineFeedbackArea message={formError} />

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full border-border bg-card text-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring-strong)]"
            onClick={handleGoogle}
            disabled={!isLoaded || isBusy}
          >
            {isGoogleSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </Button>

          <DividerWithLabel label="or continue with email" />

          <form className="space-y-3" onSubmit={handleSubmit} noValidate>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="sign-up-first-name" className="text-sm font-medium text-foreground">
                  First name
                </label>
                <Input
                  id="sign-up-first-name"
                  autoComplete="given-name"
                  className={inputBaseClass}
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  onBlur={validate}
                  aria-invalid={Boolean(fieldErrors.firstName)}
                  disabled={!canSubmit}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sign-up-last-name" className="text-sm font-medium text-foreground">
                  Last name
                </label>
                <Input
                  id="sign-up-last-name"
                  autoComplete="family-name"
                  className={inputBaseClass}
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  onBlur={validate}
                  aria-invalid={Boolean(fieldErrors.lastName)}
                  disabled={!canSubmit}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sign-up-email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <Input
                id="sign-up-email"
                type="email"
                autoComplete="email"
                className={inputBaseClass}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
                onBlur={validate}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={emailErrorId}
                disabled={!canSubmit}
              />
              {fieldErrors.email ? (
                <p id={emailErrorId} className="text-sm text-[color:var(--danger)]">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sign-up-password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <Input
                id="sign-up-password"
                type="password"
                autoComplete="new-password"
                className={inputBaseClass}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
                onBlur={validate}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={passwordErrorId}
                disabled={!canSubmit}
              />
              {fieldErrors.password ? (
                <p id={passwordErrorId} className="text-sm text-[color:var(--danger)]">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sign-up-confirm-password" className="text-sm font-medium text-foreground">
                Confirm password
              </label>
              <Input
                id="sign-up-confirm-password"
                type="password"
                autoComplete="new-password"
                className={inputBaseClass}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  if (fieldErrors.confirmPassword) {
                    setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  }
                }}
                onBlur={validate}
                aria-invalid={Boolean(fieldErrors.confirmPassword)}
                aria-describedby={fieldErrors.confirmPassword ? 'sign-up-confirm-password-error' : undefined}
                disabled={!canSubmit}
              />
              {fieldErrors.confirmPassword ? (
                <p id="sign-up-confirm-password-error" className="text-sm text-[color:var(--danger)]">
                  {fieldErrors.confirmPassword}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              className="h-11 w-full bg-[var(--accent-primary)] text-[var(--accent-primary-fg)] hover:bg-[var(--accent-primary-hover)] active:bg-[var(--accent-primary-active)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring-strong)]"
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          <AuthFooterLinks prompt="Already have an account?" href="/sign-in" label="Sign in" />
        </div>
      </AuthCard>
    </AuthPageShell>
  );
}
