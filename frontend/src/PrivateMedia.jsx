import { usePrivateMediaSource } from "./use-private-media";

export function AuthenticatedImage({
  src,
  alt = "",
  className,
  buttonClassName,
  loading = "lazy",
  onPreview,
}) {
  const media = usePrivateMediaSource(src);

  if (media.loading) {
    return (
      <span
        className="private-media-placeholder is-loading"
        aria-label="图片加载中"
      />
    );
  }
  if (!media.url) {
    return (
      <span
        className="private-media-placeholder is-error"
        role="status"
        title={media.error}
      >
        图片暂时无法显示
      </span>
    );
  }

  const image = (
    <img
      className={className}
      src={media.url}
      alt={alt}
      loading={loading}
    />
  );
  if (!onPreview) return image;
  return (
    <button
      type="button"
      className={buttonClassName}
      aria-label={alt ? `查看${alt}` : "查看图片"}
      onClick={() => onPreview(media.url, alt)}
    >
      {image}
    </button>
  );
}
