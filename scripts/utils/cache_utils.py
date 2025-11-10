"""Metadata cache utilities for efficient v3 metadata generation.

Implements local cache with remote fallback strategy to minimize redundant
file processing and API calls. Similar architecture to upload_utils.py cache.

v3 Caching Features:
- SHA256 checksums: File integrity verification for cache validation
- ETag generation: MD5-based cache validation compatible with S3/CloudFront
- TTL-based expiry: 300s (5 minutes) stale-while-revalidate strategy
- Metadata storage: Cached MP3 ID3 tags and tracker format metadata
- Manifest cache info: Includes local_cache_path and strategy in manifest.json

Cache Structure (Music/.metadata_cache.json):
{
  "file_path": {
    "checksum": "sha256:abc123...",
    "mtime": 1234567890.0,
    "size": 12345,
    "metadata": { ... },  # Cached v3 metadata
    "cached_at": 1234567890.0,
    "ttl_seconds": 300
  }
}

Functions:
- get_metadata_cache(): Load or create cache singleton
- save_metadata_cache(): Persist cache to disk
- is_metadata_cached(): Check if file needs reprocessing
- cache_metadata(): Store extracted metadata
- calculate_file_sha256(): Generate SHA256 checksums
- calculate_etag(): Generate S3-compatible ETags (MD5)
- get_manifest_cache_info(): Export cache configuration for manifest.json
"""

import hashlib
import json
import time
from pathlib import Path
from typing import Any

# Global metadata cache singleton
_metadata_cache: dict[str, dict[str, Any]] | None = None
_cache_file: Path | None = None

# Cache TTL settings
DEFAULT_CACHE_TTL_SECONDS = 300  # 5 minutes
CACHE_STRATEGY = "stale-while-revalidate"


def get_metadata_cache(cache_dir: Path | None = None) -> dict[str, dict[str, Any]]:
    """Get or load the metadata cache from disk.

    Cache structure:
    {
        "file_path": {
            "checksum": "sha256:abc123...",
            "mtime": 1234567890.0,
            "size": 12345,
            "metadata": { ... },  # Cached metadata
            "cached_at": 1234567890.0,
            "ttl_seconds": 300
        }
    }

    Args:
        cache_dir: Directory to store cache file (default: ./Music/.metadata_cache.json)

    Returns:
        Cache dictionary
    """
    global _metadata_cache, _cache_file

    if _metadata_cache is not None:
        return _metadata_cache

    # Determine cache file location
    if cache_dir is None:
        cache_dir = Path("./Music")

    cache_dir.mkdir(parents=True, exist_ok=True)
    _cache_file = cache_dir / ".metadata_cache.json"

    # Load existing cache or create new
    if _cache_file.exists():
        try:
            with _cache_file.open() as f:
                loaded_cache: dict[str, dict[str, Any]] = json.load(f)
                _metadata_cache = loaded_cache
        except (OSError, json.JSONDecodeError):
            # Corrupted cache, start fresh
            _metadata_cache = {}
    else:
        _metadata_cache = {}

    assert _metadata_cache is not None
    return _metadata_cache


def save_metadata_cache() -> None:
    """Save the metadata cache to disk."""
    global _metadata_cache, _cache_file

    if _metadata_cache is None or _cache_file is None:
        return

    try:
        with _cache_file.open("w") as f:
            json.dump(_metadata_cache, f, indent=2)
    except OSError as e:
        # Non-fatal - just means cache won't persist
        print(f"Warning: Could not save metadata cache: {e}")


def calculate_file_sha256(file_path: Path) -> str:
    """Calculate SHA256 hash of a file for integrity verification.

    Args:
        file_path: Path to local file

    Returns:
        SHA256 hash in format "sha256:hexdigest"
    """
    sha256_hash = hashlib.sha256()
    with file_path.open("rb") as f:
        # Read in chunks to handle large files efficiently
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)
    return f"sha256:{sha256_hash.hexdigest()}"


def calculate_etag(file_path: Path) -> str:
    """Calculate ETag for cache validation (uses MD5 for S3 compatibility).

    Args:
        file_path: Path to local file

    Returns:
        ETag in format '"md5hexdigest"' (quoted)
    """
    md5_hash = hashlib.md5(usedforsecurity=False)
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5_hash.update(chunk)
    return f'"{md5_hash.hexdigest()}"'


def is_cache_valid(
    cache_entry: dict[str, Any],
    file_path: Path,
    ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
) -> tuple[bool, str]:
    """Check if cached metadata is still valid.

    Validation criteria:
    1. File modification time unchanged
    2. File size unchanged
    3. Cache TTL not expired (optional)

    Args:
        cache_entry: Cache entry dict
        file_path: Path to file
        ttl_seconds: Time-to-live in seconds (0 = no expiry)

    Returns:
        Tuple of (is_valid: bool, reason: str)
    """
    try:
        stat = file_path.stat()

        # Check file modification time and size
        if stat.st_mtime != cache_entry.get("mtime"):
            return (False, "file_modified")

        if stat.st_size != cache_entry.get("size"):
            return (False, "size_changed")

        # Check TTL if enabled
        if ttl_seconds > 0:
            cached_at = cache_entry.get("cached_at", 0)
            age = time.time() - cached_at
            if age > ttl_seconds:
                return (False, "ttl_expired")

        return (True, "valid")

    except Exception as e:
        return (False, f"error:{e}")


def get_cached_metadata(
    file_path: Path,
    ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
) -> tuple[dict[str, Any] | None, str]:
    """Get cached metadata for a file if valid.

    Args:
        file_path: Path to file
        ttl_seconds: Cache TTL in seconds

    Returns:
        Tuple of (cached_metadata | None, reason: str)
        - (metadata, "hit") - Valid cached metadata found
        - (None, "miss") - Not in cache
        - (None, "invalid:reason") - Cache invalid
    """
    cache = get_metadata_cache()
    file_key = str(file_path.resolve())

    if file_key not in cache:
        return (None, "miss")

    cache_entry = cache[file_key]
    is_valid, reason = is_cache_valid(cache_entry, file_path, ttl_seconds)

    if is_valid:
        return (cache_entry.get("metadata"), "hit")
    else:
        return (None, f"invalid:{reason}")


def update_cache_entry(
    file_path: Path,
    metadata: dict[str, Any],
    ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
) -> None:
    """Update cache entry for a file.

    Args:
        file_path: Path to file
        metadata: Metadata to cache
        ttl_seconds: Cache TTL in seconds
    """
    cache = get_metadata_cache()
    file_key = str(file_path.resolve())

    stat = file_path.stat()
    cache[file_key] = {
        "checksum": metadata.get("checksum", {}).get("value", "unknown"),
        "mtime": stat.st_mtime,
        "size": stat.st_size,
        "metadata": metadata,
        "cached_at": time.time(),
        "ttl_seconds": ttl_seconds,
    }


def invalidate_cache_entry(file_path: Path) -> None:
    """Invalidate (remove) a cache entry.

    Args:
        file_path: Path to file
    """
    cache = get_metadata_cache()
    file_key = str(file_path.resolve())

    if file_key in cache:
        del cache[file_key]


def clear_metadata_cache() -> int:
    """Clear all cached metadata entries.

    Returns:
        Number of entries cleared
    """
    cache = get_metadata_cache()
    count = len(cache)
    cache.clear()
    save_metadata_cache()
    return count


def get_cache_stats() -> dict[str, int]:
    """Get cache statistics.

    Returns:
        Dict with cache statistics:
        {
            "total_entries": int,
            "valid_entries": int,
            "expired_entries": int,
            "total_size_bytes": int
        }
    """
    cache = get_metadata_cache()

    stats = {
        "total_entries": len(cache),
        "valid_entries": 0,
        "expired_entries": 0,
        "total_size_bytes": 0,
    }

    for file_key, entry in cache.items():
        file_path = Path(file_key)
        if file_path.exists():
            is_valid, _ = is_cache_valid(entry, file_path)
            if is_valid:
                stats["valid_entries"] += 1
            else:
                stats["expired_entries"] += 1

            stats["total_size_bytes"] += entry.get("size", 0)

    return stats


def prune_cache(max_age_seconds: int | None = None) -> int:
    """Remove expired or invalid cache entries.

    Args:
        max_age_seconds: Remove entries older than this (None = remove all invalid)

    Returns:
        Number of entries removed
    """
    cache = get_metadata_cache()
    to_remove = []

    for file_key, entry in cache.items():
        file_path = Path(file_key)

        # Remove if file doesn't exist
        if not file_path.exists():
            to_remove.append(file_key)
            continue

        # Remove if max_age specified and exceeded
        if max_age_seconds is not None:
            cached_at = entry.get("cached_at", 0)
            age = time.time() - cached_at
            if age > max_age_seconds:
                to_remove.append(file_key)
                continue

        # Remove if cache is invalid
        is_valid, _ = is_cache_valid(entry, file_path)
        if not is_valid:
            to_remove.append(file_key)

    # Remove entries
    for file_key in to_remove:
        del cache[file_key]

    if to_remove:
        save_metadata_cache()

    return len(to_remove)


def get_manifest_cache_info() -> dict[str, Any]:
    """Get cache info for manifest.json.

    Returns:
        Dict with cache metadata for inclusion in manifest
    """
    # Get absolute path if cache file exists, otherwise show default location
    cache_path = "Music/.metadata_cache.json"
    if _cache_file:
        try:
            cache_path = str(_cache_file.resolve().relative_to(Path.cwd()))
        except ValueError:
            # If not relative to cwd, use absolute path
            cache_path = str(_cache_file.resolve())

    return {
        "strategy": CACHE_STRATEGY,
        "ttl_seconds": DEFAULT_CACHE_TTL_SECONDS,
        "local_cache_path": cache_path,
        "remote_fallback": True,
    }
