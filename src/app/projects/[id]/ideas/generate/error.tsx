"use client";

export default function IdeasError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8 space-y-4">
      <h2 className="text-xl font-bold text-red-600">研究想法页面加载失败</h2>
      <p className="text-sm text-muted-foreground">
        {error.message || "未知错误"}
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">Digest: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 text-sm bg-teal text-white rounded-lg hover:bg-teal/90"
      >
        重试
      </button>
    </div>
  );
}
