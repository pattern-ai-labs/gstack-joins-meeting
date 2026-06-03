import { NextResponse, type NextRequest } from "next/server";

const HAS_CLERK = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")
);

// Dev mode: pass everything through unauthenticated.
function devMiddleware(_req: NextRequest) {
  return NextResponse.next();
}

// Prod mode: wrap with Clerk middleware. Imported lazily so a missing
// CLERK_SECRET_KEY in dev doesn't crash the import-time module init.
let prodMiddleware: ((req: NextRequest) => Promise<Response> | Response) | null = null;
async function getProdMiddleware() {
  if (prodMiddleware) return prodMiddleware;
  const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");
  const isProtected = createRouteMatcher(["/workers(.*)", "/admin(.*)"]);
  prodMiddleware = clerkMiddleware(async (auth, req) => {
    if (isProtected(req)) await auth.protect();
  });
  return prodMiddleware;
}

export default async function middleware(req: NextRequest) {
  if (!HAS_CLERK) return devMiddleware(req);
  const handler = await getProdMiddleware();
  return handler(req);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
