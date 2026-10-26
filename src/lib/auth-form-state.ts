export type AuthFormState = {
  step: "credentials" | "enroll_mfa" | "verify_mfa" | "recovery_codes";
  error?: string;
  errors?: Record<string, string[] | undefined>;
  secret?: string;
  /** The server's otpauth URI, so the QR code matches the account label and TOTP parameters exactly. */
  provisioningUri?: string;
  recoveryCodes?: string[];
};
export const initialAuthState: AuthFormState = { step: "credentials" };
