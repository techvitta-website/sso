"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Returns a browser Supabase client bound to the current cookie session.
// (Previously this injected a Clerk JWT per request; Supabase Auth carries
// the session in the client itself, so no token juggling is needed.)
export function useSupabaseClient() {
  const [client] = useState(() => createClient());
  return client;
}
