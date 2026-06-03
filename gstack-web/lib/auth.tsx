/**
 * Unified auth surface — switches between real Clerk and the dev stub at
 * import time based on the publishable-key env var. Pages import from here
 * instead of @clerk/nextjs so a missing/placeholder key turns the whole
 * app into dev-mode without conditional logic in each component.
 */
import * as Stub from "./auth-stub";
import { isDevAuth as _isDevAuth } from "./auth-mode";
import {
  ClerkProvider as ClerkProviderReal,
  SignInButton as SignInButtonReal,
  SignedIn as SignedInReal,
  SignedOut as SignedOutReal,
  UserButton as UserButtonReal,
} from "@clerk/nextjs";
import { useAuth as useAuthReal } from "@clerk/nextjs";

const DEV = _isDevAuth();

export const Provider = DEV ? Stub.StubProvider : ClerkProviderReal;
export const SignedIn = DEV ? Stub.StubSignedIn : SignedInReal;
export const SignedOut = DEV ? Stub.StubSignedOut : SignedOutReal;
export const SignInButton = DEV ? Stub.StubSignInButton : SignInButtonReal;
export const UserButton = DEV ? Stub.StubUserButton : UserButtonReal;
export const useAuth: () => { getToken: () => Promise<string | null> } =
  DEV ? Stub.useStubAuth : (useAuthReal as unknown as () => { getToken: () => Promise<string | null> });
export const isDevAuth = DEV;
