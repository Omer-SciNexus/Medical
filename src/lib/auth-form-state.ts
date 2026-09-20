export type AuthFormState = {
  step: "credentials" | "enroll_mfa" | "verify_mfa" | "recovery_codes";
  error?: string;
  errors?: Record<string, string[] | undefined>;
  secret?: string;
  recoveryCodes?: string[];
};
export const initialAuthState: AuthFormState = { step: "credentials" };
