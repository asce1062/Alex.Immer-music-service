"""S3 upload utilities for music assets.

Handles uploading MP3s, covers, thumbnails, tracker files, and metadata to S3.
Supports S3 Transfer Acceleration and Multipart uploads for improved performance.
Implements incremental uploads by comparing file hashes with S3 ETags.
Features local cache to minimize S3 API calls and speed up subsequent uploads.
"""

import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import TYPE_CHECKING

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config as BotocoreConfig
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

from .config import Config
from .file_utils import get_file_list
from .secrets_manager import get_aws_credentials

# Global S3 client singleton
_s3_client: "S3Client | None" = None

# Global upload cache singleton
_upload_cache: dict[str, dict[str, str | float]] | None = None
_cache_file: Path | None = None

# Multipart upload thresholds (optimized for international uploads)
# Files larger than 50MB use multipart upload with 10MB chunks
MULTIPART_THRESHOLD = 50 * 1024 * 1024  # 50 MB
MULTIPART_CHUNKSIZE = 10 * 1024 * 1024  # 10 MB per part
MAX_CONCURRENCY = 10  # Concurrent upload threads


def get_s3_client(region: str | None = None, use_accelerate: bool = True) -> "S3Client":
    """Get or create S3 client singleton with optional Transfer Acceleration.

    Fetches AWS credentials from Secrets Manager for secure credential management.

    Args:
        region: AWS region (optional, uses default or config)
        use_accelerate: Enable S3 Transfer Acceleration (default: True)

    Returns:
        boto3 S3 client instance

    Note:
        Transfer Acceleration must be enabled on the S3 bucket first.
        When enabled, boto3 automatically uses the accelerated endpoint:
        - Standard: {bucket}.s3.{region}.amazonaws.com
        - Accelerated: {bucket}.s3-accelerate.amazonaws.com

        Example: alexmbugua-music.s3-accelerate.amazonaws.com

        Performance: 2-5x faster for international uploads (e.g., Kenya → us-east-1)
        Cost: $0.04/GB additional (negligible for most use cases)

        See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/transfer-acceleration.html

    Security:
        Credentials are fetched from AWS Secrets Manager at runtime.
        Falls back to boto3's default credential chain if Secrets Manager unavailable.
    """
    global _s3_client

    if _s3_client is None:
        # Try to fetch credentials from Secrets Manager
        try:
            creds = get_aws_credentials()
            aws_access_key_id = creds["access_key_id"]
            aws_secret_access_key = creds["secret_access_key"]
        except (ValueError, PermissionError, KeyError) as e:
            # Fallback to boto3's default credential chain
            # (environment variables, ~/.aws/credentials, IAM role)
            print(
                f"Warning: Could not fetch credentials from Secrets Manager: {e}\n"
                "Falling back to boto3's default credential chain..."
            )
            aws_access_key_id = None
            aws_secret_access_key = None

        # Check environment variable for acceleration preference
        enable_acceleration = os.getenv("S3_USE_ACCELERATION", "true").lower() == "true"
        use_accelerate = use_accelerate and enable_acceleration

        if use_accelerate:
            # Use Transfer Acceleration endpoint
            boto_config = BotocoreConfig(s3={"use_accelerate_endpoint": True})
            _s3_client = boto3.client(
                "s3",
                region_name=region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key,
                config=boto_config,
            )
        else:
            _s3_client = boto3.client(
                "s3",
                region_name=region,
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key,
            )

    return _s3_client


def get_upload_cache(cache_dir: Path | None = None) -> dict[str, dict[str, str | float]]:
    """Get or load the upload cache from disk.

    Cache structure:
    {
        "s3_key": {
            "md5": "abc123...",
            "mtime": 1234567890.0,
            "size": 12345
        }
    }

    Args:
        cache_dir: Directory to store cache file (default: ./Music/.upload_cache.json)

    Returns:
        Cache dictionary
    """
    global _upload_cache, _cache_file

    if _upload_cache is not None:
        return _upload_cache

    # Determine cache file location
    if cache_dir is None:
        cache_dir = Path("./Music")

    cache_dir.mkdir(parents=True, exist_ok=True)
    _cache_file = cache_dir / ".upload_cache.json"

    # Load existing cache or create new
    if _cache_file.exists():
        try:
            with _cache_file.open() as f:
                loaded_cache: dict[str, dict[str, str | float]] = json.load(f)
                _upload_cache = loaded_cache
        except (OSError, json.JSONDecodeError):
            # Corrupted cache, start fresh
            _upload_cache = {}
    else:
        _upload_cache = {}

    # At this point, _upload_cache is guaranteed to be a dict
    assert _upload_cache is not None
    return _upload_cache


def save_upload_cache() -> None:
    """Save the upload cache to disk."""
    global _upload_cache, _cache_file

    if _upload_cache is None or _cache_file is None:
        return

    try:
        with _cache_file.open("w") as f:
            json.dump(_upload_cache, f, indent=2)
    except OSError as e:
        # Non-fatal - just means cache won't persist
        print(f"Warning: Could not save upload cache: {e}")


def update_cache_entry(
    s3_key: str,
    local_path: Path,
    md5: str,
) -> None:
    """Update cache entry for a file.

    Args:
        s3_key: S3 object key
        local_path: Local file path
        md5: MD5 hash of file
    """
    cache = get_upload_cache()

    stat = local_path.stat()
    cache[s3_key] = {
        "md5": md5,
        "mtime": stat.st_mtime,
        "size": stat.st_size,
    }


def check_local_cache(
    local_path: Path,
    s3_key: str,
) -> tuple[bool, str]:
    """Check if file needs upload using local cache first.

    Fast path: Check modification time and size from cache.
    If unchanged locally, assume S3 is also unchanged.

    Args:
        local_path: Local file path
        s3_key: S3 object key

    Returns:
        Tuple of (needs_upload: bool, reason: str)
        - (False, "cached") - File unchanged since last upload
        - (True, "cache_miss") - Not in cache, need to check S3
        - (True, "modified") - File modified locally
    """
    cache = get_upload_cache()

    # Check if file is in cache
    if s3_key not in cache:
        return (True, "cache_miss")

    cached = cache[s3_key]
    stat = local_path.stat()

    # Check if file modified since last upload
    # Compare modification time and size (fast)
    if stat.st_mtime != cached["mtime"] or stat.st_size != cached["size"]:
        return (True, "modified")

    # File unchanged locally - assume S3 unchanged too
    return (False, "cached")


def get_transfer_config() -> TransferConfig:
    """Get optimized TransferConfig for multipart uploads.

    Returns:
        TransferConfig with settings optimized for large file uploads

    Settings:
        - multipart_threshold: 50 MB (use multipart for files > 50MB)
        - multipart_chunksize: 10 MB (upload in 10MB chunks)
        - max_concurrency: 10 (use up to 10 threads)
        - use_threads: True (enable concurrent uploads)
    """
    return TransferConfig(
        multipart_threshold=MULTIPART_THRESHOLD,
        multipart_chunksize=MULTIPART_CHUNKSIZE,
        max_concurrency=MAX_CONCURRENCY,
        use_threads=True,
    )


def calculate_file_md5(file_path: Path) -> str:
    """Calculate MD5 hash of a file.

    S3 uses MD5 hashes for ETags (for single-part uploads).
    We can compare local file MD5 with S3 ETag to detect changes.

    Args:
        file_path: Path to local file

    Returns:
        Hex string of MD5 hash
    """
    md5_hash = hashlib.md5(usedforsecurity=False)  # Used for checksums, not security
    with file_path.open("rb") as f:
        # Read in chunks to handle large files efficiently
        for chunk in iter(lambda: f.read(8192), b""):
            md5_hash.update(chunk)
    return md5_hash.hexdigest()


def file_needs_upload(
    local_path: Path,
    s3_key: str,
    s3_client: "S3Client",
    bucket: str,
) -> tuple[bool, str]:
    """Check if a local file needs to be uploaded to S3.

    Compares local file MD5 hash with S3 ETag to determine if file has changed.

    Args:
        local_path: Path to local file
        s3_key: S3 object key
        s3_client: boto3 S3 client
        bucket: S3 bucket name

    Returns:
        Tuple of (needs_upload: bool, reason: str)
        - (True, "new") - File doesn't exist in S3
        - (True, "modified") - File exists but content changed
        - (False, "unchanged") - File unchanged, skip upload
    """
    try:
        # Get S3 object metadata
        response = s3_client.head_object(Bucket=bucket, Key=s3_key)
        s3_etag = response["ETag"].strip('"')  # ETags are quoted

        # Calculate local file MD5
        local_md5 = calculate_file_md5(local_path)

        # Compare hashes
        if local_md5 == s3_etag:
            return (False, "unchanged")
        else:
            return (True, "modified")

    except ClientError as e:
        # File doesn't exist in S3 (404 error)
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        if error_code == "404":
            return (True, "new")
        # Other errors (permissions, etc.)
        else:
            # Assume needs upload if we can't check
            return (True, f"error: {error_code}")
    except Exception as e:
        # Any other errors - assume needs upload
        return (True, f"error: {e!s}")


def upload_file(
    local_path: Path,
    s3_key: str,
    config: Config,
    s3_client: "S3Client | None" = None,
    dry_run: bool = False,
    verbose: bool = True,
    skip_unchanged: bool = True,
) -> tuple[bool, bool]:
    """Upload a single file to S3 with incremental upload support.

    Automatically sets Content-Type and Cache-Control headers based on file type.
    Compares file hashes to skip unchanged files (incremental uploads).

    Args:
        local_path: Path to local file
        s3_key: S3 key (path within bucket)
        config: Configuration instance
        s3_client: boto3 S3 client (optional, will be created if needed)
        dry_run: If True, only simulate upload
        verbose: If True, print progress
        skip_unchanged: If True, skip files that haven't changed (default: True)

    Returns:
        Tuple of (success: bool, skipped: bool)
        - (True, False): Upload successful
        - (True, True): Upload skipped (file unchanged)
        - (False, False): Upload failed
    """
    if not local_path.exists():
        if verbose:
            print(f"    Error: File {local_path} does not exist")
        return (False, False)  # Failed, not skipped

    # Get S3 client
    if s3_client is None:
        s3_client = get_s3_client(config.s3_region)

    # Check if file needs upload (unless dry run or skip_unchanged disabled)
    if skip_unchanged and not dry_run:
        # Fast path: Check local cache first
        needs_upload_cache, cache_reason = check_local_cache(local_path, s3_key)

        if not needs_upload_cache and cache_reason == "cached":
            # File unchanged locally since last upload - skip
            if verbose:
                print(f"  Skip: {local_path.name} (unchanged)")
            return (True, True)  # Success, skipped

        # Cache miss or file modified - verify with S3
        needs_upload, reason = file_needs_upload(local_path, s3_key, s3_client, config.s3_bucket)

        if not needs_upload:
            # File unchanged in S3 - update cache
            local_md5 = calculate_file_md5(local_path)
            update_cache_entry(s3_key, local_path, local_md5)
            if verbose:
                print(f"  Skip: {local_path.name} (unchanged)")
            return (True, True)  # Success, skipped

        # Show reason for upload if modified
        if verbose and reason == "modified":
            size_mb = local_path.stat().st_size / (1024 * 1024)
            s3_url = f"s3://{config.s3_bucket}/{s3_key}"
            print(f"  Upload: {local_path.name} -> {s3_url} ({size_mb:.2f} MB) [modified]")
        elif verbose and reason == "new":
            size_mb = local_path.stat().st_size / (1024 * 1024)
            s3_url = f"s3://{config.s3_bucket}/{s3_key}"
            print(f"  Upload: {local_path.name} -> {s3_url} ({size_mb:.2f} MB) [new]")
        else:
            # For other reasons (errors, etc.)
            if verbose:
                size_mb = local_path.stat().st_size / (1024 * 1024)
                s3_url = f"s3://{config.s3_bucket}/{s3_key}"
                print(f"  Upload: {local_path.name} -> {s3_url} ({size_mb:.2f} MB)")
    else:
        # Dry run or skip_unchanged disabled - always show upload message
        if verbose:
            size_mb = local_path.stat().st_size / (1024 * 1024)
            s3_url = f"s3://{config.s3_bucket}/{s3_key}"
            print(f"  Upload: {local_path.name} -> {s3_url} ({size_mb:.2f} MB)")

    if dry_run:
        return (True, False)  # Success, not skipped (simulated upload)

    # Determine content type and cache control
    extra_args: dict[str, str] = {}
    suffix = local_path.suffix.lower()

    # Image types
    if suffix in {".jpg", ".jpeg"}:
        extra_args["ContentType"] = "image/jpeg"
        extra_args["CacheControl"] = "public, max-age=31536000, immutable"
    elif suffix == ".png":
        extra_args["ContentType"] = "image/png"
        extra_args["CacheControl"] = "public, max-age=31536000, immutable"

    # Audio types
    elif suffix == ".mp3":
        extra_args["ContentType"] = "audio/mpeg"
        extra_args["CacheControl"] = "public, max-age=31536000, immutable"

    # Tracker formats
    elif suffix in {".it", ".xm", ".mod", ".s3m", ".ftm", ".nsf"}:
        extra_args["ContentType"] = "application/octet-stream"
        extra_args["CacheControl"] = "public, max-age=31536000, immutable"

    # JSON metadata
    elif suffix == ".json":
        extra_args["ContentType"] = "application/json"
        extra_args["CacheControl"] = "public, max-age=300"  # 5 minutes for metadata

    else:
        extra_args["CacheControl"] = "public, max-age=31536000, immutable"

    # Upload with optimized transfer config
    try:
        transfer_config = get_transfer_config()
        s3_client.upload_file(
            str(local_path),
            config.s3_bucket,
            s3_key,
            ExtraArgs=extra_args,
            Config=transfer_config,
        )

        # Update cache after successful upload
        if not dry_run:
            local_md5 = calculate_file_md5(local_path)
            update_cache_entry(s3_key, local_path, local_md5)

        return (True, False)  # Success, not skipped (uploaded)

    except Exception as e:
        if verbose:
            print(f"    Error uploading {local_path.name}: {e}")
        return (False, False)  # Failed, not skipped


def upload_album(
    album_dir: Path,
    album_name: str,
    config: Config,
    s3_client: "S3Client | None" = None,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    """Upload all MP3 files and tracker files for an album.

    Uploads:
    - MP3s to: albums/{album}/
    - Album trackers to: albums/{album}/tracker/ AND tracker/{album}/
    - Extras MP3s to: albums/{album}/Extras/
    - Extras trackers to: albums/{album}/Extras/tracker/ AND tracker/{album}/Extras/

    Args:
        album_dir: Path to album directory
        album_name: URL-safe album name
        config: Configuration instance
        s3_client: boto3 S3 client (optional)
        dry_run: If True, only simulate uploads
        verbose: If True, print progress

    Returns:
        Dict with upload statistics:
        {"mp3s": count, "trackers": count, "errors": count, "skipped": count}
    """
    stats = {"mp3s": 0, "trackers": 0, "errors": 0, "skipped": 0}

    if not album_dir.exists():
        if verbose:
            print(f"  Warning: Album directory {album_dir} does not exist")
        return stats

    if s3_client is None:
        s3_client = get_s3_client(config.s3_region)

    # Upload MP3 files (recursively to handle Extras)
    mp3_files = get_file_list(album_dir, extensions={".mp3"}, recursive=True)

    for mp3_file in mp3_files:
        # Determine S3 path based on whether it's in Extras
        rel_path = mp3_file.relative_to(album_dir)

        if "Extras" in rel_path.parts:
            # Extras MP3
            s3_key = f"albums/{album_name}/Extras/{mp3_file.name}"
        else:
            # Regular MP3
            s3_key = f"albums/{album_name}/{mp3_file.name}"

        success, skipped = upload_file(mp3_file, s3_key, config, s3_client, dry_run, verbose)
        if success:
            if skipped:
                stats["skipped"] += 1
            else:
                stats["mp3s"] += 1
        else:
            stats["errors"] += 1

    # Upload tracker files from album/tracker/ directory
    tracker_dir = album_dir / "tracker"
    if tracker_dir.exists():
        tracker_files = get_file_list(tracker_dir, extensions=config.TRACKER_EXTS, recursive=False)

        for tracker_file in tracker_files:
            # Upload to both locations
            s3_keys = [
                f"albums/{album_name}/tracker/{tracker_file.name}",
                f"tracker/{album_name}/{tracker_file.name}",
            ]

            for s3_key in s3_keys:
                success, skipped = upload_file(
                    tracker_file, s3_key, config, s3_client, dry_run, verbose
                )
                if success:
                    if skipped:
                        stats["skipped"] += 1
                    else:
                        stats["trackers"] += 1
                else:
                    stats["errors"] += 1

    # Upload Extras trackers if they exist
    extras_tracker_dir = album_dir / "Extras" / "tracker"
    if extras_tracker_dir.exists():
        tracker_files = get_file_list(
            extras_tracker_dir, extensions=config.TRACKER_EXTS, recursive=False
        )

        for tracker_file in tracker_files:
            # Upload to both locations
            s3_keys = [
                f"albums/{album_name}/Extras/tracker/{tracker_file.name}",
                f"tracker/{album_name}/Extras/{tracker_file.name}",
            ]

            for s3_key in s3_keys:
                success, skipped = upload_file(
                    tracker_file, s3_key, config, s3_client, dry_run, verbose
                )
                if success:
                    if skipped:
                        stats["skipped"] += 1
                    else:
                        stats["trackers"] += 1
                else:
                    stats["errors"] += 1

    return stats


def upload_covers(
    config: Config,
    s3_client: "S3Client | None" = None,
    with_thumbs: bool = False,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    """Upload all cover images and thumbnails.

    Args:
        config: Configuration instance
        s3_client: boto3 S3 client (optional)
        with_thumbs: If True, also upload thumbnails
        dry_run: If True, only simulate uploads
        verbose: If True, print progress

    Returns:
        Dict with upload statistics:
        {"covers": count, "thumbs": count, "errors": count, "skipped": count}
    """
    stats = {"covers": 0, "thumbs": 0, "errors": 0, "skipped": 0}

    if not config.covers_dir.exists():
        if verbose:
            print("  Warning: Covers directory does not exist")
        return stats

    if s3_client is None:
        s3_client = get_s3_client(config.s3_region)

    # Upload cover images
    cover_files = get_file_list(
        config.covers_dir,
        extensions=config.IMAGE_EXTS,
        recursive=False,
    )

    for cover_file in cover_files:
        s3_key = f"covers/{cover_file.name}"

        success, skipped = upload_file(cover_file, s3_key, config, s3_client, dry_run, verbose)
        if success:
            if skipped:
                stats["skipped"] += 1
            else:
                stats["covers"] += 1
        else:
            stats["errors"] += 1

    # Upload thumbnails if requested
    if with_thumbs and config.thumbs_dir.exists():
        thumb_files = get_file_list(
            config.thumbs_dir,
            extensions=config.IMAGE_EXTS,
            recursive=False,
        )

        for thumb_file in thumb_files:
            s3_key = f"covers/{config.DIR_STRUCTURE['thumbs']}/{thumb_file.name}"

            success, skipped = upload_file(thumb_file, s3_key, config, s3_client, dry_run, verbose)
            if success:
                if skipped:
                    stats["skipped"] += 1
                else:
                    stats["thumbs"] += 1
            else:
                stats["errors"] += 1

    return stats


def upload_trackers(
    config: Config,
    s3_client: "S3Client | None" = None,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    """Upload tracker files from trackers directory.

    Handles:
    - tracker/{album}/*.{it,xm,mod,...} (linked trackers)
    - tracker/unreleased/{album}/*.{it,xm,...} (unreleased album trackers)
    - tracker/unreleased/*.{it,xm,...} (standalone unreleased)

    Args:
        config: Configuration instance
        s3_client: boto3 S3 client (optional)
        dry_run: If True, only simulate uploads
        verbose: If True, print progress

    Returns:
        Dict with upload statistics: {"trackers": count, "errors": count, "skipped": count}
    """
    stats = {"trackers": 0, "errors": 0, "skipped": 0}

    if not config.trackers_dir.exists():
        if verbose:
            print("  Warning: Trackers directory does not exist")
        return stats

    if s3_client is None:
        s3_client = get_s3_client(config.s3_region)

    # Get all tracker files
    tracker_files = get_file_list(
        config.trackers_dir,
        extensions=config.TRACKER_EXTS,
        recursive=True,
    )

    # Group files by their parent directory for organized output
    files_by_dir: dict[str, list[Path]] = defaultdict(list)

    for tracker_file in tracker_files:
        rel_path = tracker_file.relative_to(config.trackers_dir)
        parent_dir = str(rel_path.parent) if rel_path.parent != Path() else ""
        files_by_dir[parent_dir].append(tracker_file)

    # Upload files grouped by directory
    for parent_dir in sorted(files_by_dir.keys()):
        files = files_by_dir[parent_dir]

        # Print directory header
        if verbose:
            if parent_dir == "":
                # Files in tracker/ root (shouldn't happen but handle it)
                print("\n  Tracker: Root")
            elif parent_dir.startswith("unreleased/"):
                # Files in tracker/unreleased/{album}/
                album_name = parent_dir.replace("unreleased/", "")
                print(f"\n  Tracker: Unreleased/{album_name}")
            elif parent_dir == "unreleased":
                # Files directly in tracker/unreleased/
                print("\n  Tracker: Unreleased")
            else:
                # Files in tracker/{album}/
                print(f"\n  Tracker Albums: {parent_dir}")

        for tracker_file in files:
            # Preserve directory structure in S3
            rel_path = tracker_file.relative_to(config.trackers_dir)
            s3_key = f"tracker/{rel_path.as_posix()}"

            success, skipped = upload_file(
                tracker_file, s3_key, config, s3_client, dry_run, verbose
            )
            if success:
                if skipped:
                    stats["skipped"] += 1
                else:
                    stats["trackers"] += 1
            else:
                stats["errors"] += 1

    return stats


def upload_metadata(
    config: Config,
    s3_client: "S3Client | None" = None,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    """Upload all metadata JSON files.

    Args:
        config: Configuration instance
        s3_client: boto3 S3 client (optional)
        dry_run: If True, only simulate uploads
        verbose: If True, print progress

    Returns:
        Dict with upload statistics: {"files": count, "errors": count, "skipped": count}
    """
    stats = {"files": 0, "errors": 0, "skipped": 0}

    if not config.metadata_dir.exists():
        if verbose:
            print("  Warning: Metadata directory does not exist")
        return stats

    if s3_client is None:
        s3_client = get_s3_client(config.s3_region)

    # Upload all JSON files
    json_files = get_file_list(
        config.metadata_dir,
        extensions={".json"},
        recursive=False,
    )

    for json_file in json_files:
        s3_key = f"metadata/{json_file.name}"

        success, skipped = upload_file(json_file, s3_key, config, s3_client, dry_run, verbose)
        if success:
            if skipped:
                stats["skipped"] += 1
            else:
                stats["files"] += 1
        else:
            stats["errors"] += 1

    return stats


def upload_all(
    config: Config,
    with_thumbs: bool = False,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, dict[str, int]]:
    """Upload all assets to S3: albums, covers, trackers, and metadata.

    Args:
        config: Configuration instance
        with_thumbs: If True, upload thumbnails
        dry_run: If True, only simulate uploads
        verbose: If True, print progress

    Returns:
        Dict with all upload statistics by category
    """
    if verbose:
        print("\n" + "=" * 60)
        print("UPLOADING ALL ASSETS TO S3")
        print("=" * 60)

    s3_client = get_s3_client(config.s3_region)
    results: dict[str, dict[str, int]] = {}

    # Upload albums
    if verbose:
        print("\nUploading albums...")

    album_dirs = sorted([d for d in config.albums_dir.iterdir() if d.is_dir()])
    total_album_stats = {"mp3s": 0, "trackers": 0, "errors": 0, "skipped": 0}

    for album_dir in album_dirs:
        album_name = album_dir.name
        if verbose:
            print(f"\n  Album: {album_name}")

        stats = upload_album(album_dir, album_name, config, s3_client, dry_run, verbose)
        for key in stats:
            total_album_stats[key] = total_album_stats.get(key, 0) + stats[key]

    results["albums"] = total_album_stats

    # Upload covers
    if verbose:
        print("\nUploading covers...")

    results["covers"] = upload_covers(config, s3_client, with_thumbs, dry_run, verbose)

    # Upload trackers
    if verbose:
        print("\nUploading trackers...")

    results["trackers"] = upload_trackers(config, s3_client, dry_run, verbose)

    # Upload metadata
    if verbose:
        print("\nUploading metadata...")

    results["metadata"] = upload_metadata(config, s3_client, dry_run, verbose)

    # Summary
    if verbose:
        print("\n" + "=" * 60)
        print("UPLOAD SUMMARY")
        print("=" * 60)
        print(
            f"  Albums: {total_album_stats['mp3s']} MP3s, {total_album_stats['trackers']} trackers"
        )
        covers_count = results["covers"]["covers"]
        thumbs_count = results["covers"]["thumbs"]
        print(f"  Covers: {covers_count} images, {thumbs_count} thumbnails")
        print(f"  Trackers: {results['trackers']['trackers']} files")
        print(f"  Metadata: {results['metadata']['files']} files")

        total_skipped = (
            total_album_stats["skipped"]
            + results["covers"]["skipped"]
            + results["trackers"]["skipped"]
            + results["metadata"]["skipped"]
        )
        if total_skipped > 0:
            print(f"  Skipped: {total_skipped} files (unchanged)")

        total_errors = (
            total_album_stats["errors"]
            + results["covers"]["errors"]
            + results["trackers"]["errors"]
            + results["metadata"]["errors"]
        )
        if total_errors > 0:
            print(f"  Errors: {total_errors}")

    # Save cache to disk after all uploads
    if not dry_run:
        save_upload_cache()

    return results
