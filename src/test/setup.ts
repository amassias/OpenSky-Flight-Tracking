import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Full-suite runs compete for CPU; the default 1 s lets slow-but-correct renders fail.
configure({ asyncUtilTimeout: 4000 });

// The first-visit tour would cover every screen under test.
beforeEach(() => window.localStorage.setItem("skytrace-onboarded", "true"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});
