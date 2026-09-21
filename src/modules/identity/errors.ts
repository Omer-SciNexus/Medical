/** Only these deliberately public messages may cross the authentication boundary. */
export class AuthenticationError extends Error {
  constructor(message: string) { super(message); this.name = "AuthenticationError"; }
}
