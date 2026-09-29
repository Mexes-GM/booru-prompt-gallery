"use client";

import { reportError } from "@/lib/error-reporting";
import { isChunkLoadError, reloadForChunkError } from "@/lib/chunk-reload";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Stale build after a deploy: reload once instead of showing the error page.
    if (isChunkLoadError(error) && reloadForChunkError()) return;
    reportError(error, {
      level: "fatal",
      tags: { context: "global_error" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
