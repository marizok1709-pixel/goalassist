import { redirect } from "next/navigation";

// Registration now lives inside the conversational onboarding flow, which is
// the only path that also collects weekly availability (the scheduler needs
// it). The old standalone register form skipped that, so this route redirects.
export default function RegisterRedirect() {
  redirect("/onboarding");
}
