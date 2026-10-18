"""Load local configuration from .env without faking the deployment platform."""

import os

from dotenv import dotenv_values

# `vercel env pull` writes Vercel's system variables (VERCEL=1, VERCEL_ENV,
# VERCEL_URL, ...) next to the real secrets. Those describe the runtime the
# process is in, so they must come from the platform itself; read from a file
# they switch local servers and tests onto the serverless-only code paths.
PLATFORM_PREFIXES = ("VERCEL",)


def load_local_env(path: str | None = None) -> None:
    """Copy .env values into os.environ, never overriding real variables."""
    for key, value in dotenv_values(path).items():
        if value is None or key.startswith(PLATFORM_PREFIXES) or key in os.environ:
            continue
        os.environ[key] = value
