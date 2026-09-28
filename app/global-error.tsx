"use client";

import { reportError } from "@/lib/error-reporting";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
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
