import { Marketing } from "@/components/Marketing";

// Always-on landing page (regardless of auth state). Useful for sharing
// the public URL even when the visitor is already signed in.
export default function LandingPage() {
  return <Marketing />;
}
