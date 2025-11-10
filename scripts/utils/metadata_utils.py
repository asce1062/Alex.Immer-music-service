"""Metadata extraction utilities for MP3 and tracker files.

Handles comprehensive ID3 tag extraction and file metadata for v3 manifest generation.

v3 Schema Enhancements:
- Normalized numeric fields: duration_seconds (int), file_size_bytes (int),
  bit_rate_kbps (int) - machine-readable alongside human-readable formats
- SHA256 checksums: File integrity verification with algorithm, value, and verified_at
- HTTP range support: content_length, last_modified (ISO 8601), accept_ranges, etag
- Content rating: explicit boolean from ID3 tags (ITUNESADVISORY, genre)
- Tracker metadata: source_format_version, tracker_tools from binary file parsing

Functions:
- extract_mp3_metadata(): Extract ID3 tags with v3 fields from MP3 files
- extract_tracker_metadata(): Extract tracker format metadata with v3 fields
- normalize_duration(): Convert seconds to both numeric and human-readable
- normalize_file_size(): Convert bytes to both numeric and human-readable
- detect_explicit_content(): Content rating from ID3 tags
"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from mutagen.id3 import ID3
from mutagen.id3._frames import APIC
from mutagen.id3._util import ID3NoHeaderError
from mutagen.mp3 import MP3

from .cache_utils import calculate_etag, calculate_file_sha256
from .config import Config
from .id_utils import (
    extract_title_from_filename,
    generate_album_id,
    generate_track_id,
    generate_tracker_id,
    get_file_created_iso8601,
)
from .tracker_parser import extract_tracker_format_metadata


class APICLike(Protocol):
    """Protocol for APIC frame attributes (mutagen type stub workaround)."""

    data: bytes
    mime: str
    desc: str


# ============================================================================
# Normalization Utilities
# ============================================================================


def normalize_duration(seconds: float) -> dict[str, Any]:
    """Normalize duration to both numeric and human-readable formats.

    Args:
        seconds: Duration in seconds

    Returns:
        Dict with duration_seconds (int) and duration_human (str)

    Examples:
        >>> normalize_duration(145.5)
        {'duration_seconds': 145, 'duration_human': '2 min 25'}
    """
    duration_seconds = int(seconds)
    mins = duration_seconds // 60
    secs = duration_seconds % 60
    duration_human = f"{mins} min {secs:02d}"

    return {
        "duration_seconds": duration_seconds,
        "duration_human": duration_human,
    }


def normalize_file_size(num_bytes: int) -> dict[str, Any]:
    """Normalize file size to both bytes and human-readable formats.

    Args:
        num_bytes: File size in bytes

    Returns:
        Dict with file_size_bytes (int) and file_size_human (str)

    Examples:
        >>> normalize_file_size(6123520)
        {'file_size_bytes': 6123520, 'file_size_human': '5.84 MiB'}
    """
    mib = num_bytes / (1024 * 1024)
    return {
        "file_size_bytes": num_bytes,
        "file_size_human": f"{mib:.2f} MiB",
    }


def normalize_bpm(bpm_str: str) -> float | None:
    """Normalize BPM string to numeric value.

    Args:
        bpm_str: BPM as string (e.g., "120.5", "120")

    Returns:
        Float BPM value or None if invalid

    Examples:
        >>> normalize_bpm("120.5")
        120.5
        >>> normalize_bpm("invalid")
        None
    """
    try:
        return float(bpm_str)
    except (ValueError, TypeError):
        return None


def normalize_bit_rate(bit_rate_str: str) -> int | None:
    """Normalize bit rate string to kbps integer.

    Args:
        bit_rate_str: Bit rate string (e.g., "320 kb/s", "320")

    Returns:
        Integer kbps value or None if invalid

    Examples:
        >>> normalize_bit_rate("320 kb/s")
        320
        >>> normalize_bit_rate("192")
        192
    """
    try:
        # Remove common suffixes
        cleaned = bit_rate_str.replace("kb/s", "").replace("kbps", "").strip()
        return int(cleaned)
    except (ValueError, TypeError, AttributeError):
        return None


def get_file_last_modified_iso8601(file_path: Path) -> str:
    """Get file last modified timestamp in ISO 8601 format.

    Args:
        file_path: Path to file

    Returns:
        ISO 8601 timestamp string (e.g., "2025-11-10T12:00:00Z")
    """
    mtime = file_path.stat().st_mtime
    dt = datetime.fromtimestamp(mtime, tz=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def detect_explicit_content(metadata: dict[str, Any]) -> bool:
    """Detect explicit content from metadata.

    Currently returns False by default. Can be enhanced to:
    - Check ID3 COMM (comments) for explicit markers
    - Check genre for explicit indicators
    - Use external API for content rating

    Args:
        metadata: Existing metadata dict

    Returns:
        Boolean indicating explicit content
    """
    # Check for explicit markers in comments
    comment = metadata.get("comment", "").lower()
    if any(marker in comment for marker in ["explicit", "parental advisory", "18+"]):
        return True

    # Check genre
    genre = metadata.get("genre", "").lower()
    return "explicit" in genre


def format_duration(seconds: float) -> str:
    """Format duration in seconds to human-readable format.

    Args:
        seconds: Duration in seconds

    Returns:
        Formatted string like "2 min 25"

    Examples:
        >>> format_duration(145.5)
        '2 min 25'
        >>> format_duration(59)
        '0 min 59'
    """
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins} min {secs:02d}"


def human_filesize(num_bytes: int) -> str:
    """Convert bytes to human-readable file size in MiB.

    Args:
        num_bytes: File size in bytes

    Returns:
        Formatted string like "5.84 MiB"

    Examples:
        >>> human_filesize(6123520)
        '5.84 MiB'
    """
    mib = num_bytes / (1024 * 1024)
    return f"{mib:.2f} MiB"


def extract_mp3_metadata(
    mp3_path: Path,
    config: Config,
    album_name: str | None = None,
    relative_path: Path | None = None,
    linked_trackers: list[Path] | None = None,
) -> dict[str, Any]:
    """Extract comprehensive metadata from an MP3 file.

    Extracts all ID3 tags and file-level information according to the specification:
    - Complete name (CDN URL)
    - Format information
    - File size
    - Duration
    - Bitrate
    - Album, performer, composer, genre, etc.
    - Embedded cover art information
    - Comments and URLs

    Args:
        mp3_path: Path to MP3 file
        config: Configuration instance
        album_name: Album name (URL-safe) for CDN path construction
        relative_path: Relative path within album (e.g., Path("Extras/track.mp3"))
        linked_trackers: List of tracker file paths linked to this MP3

    Returns:
        Dict containing all available metadata fields

    Example output:
        {
            "track_id": "8bit-seduction-02-second-wave",
            "album_id": "8bit-seduction",
            "complete_name": "https://bucket.s3.../albums/Album/Extras/track.mp3",
            "cdn_url": "https://cdn.aleximmer.me/albums/Album/track.mp3",
            "s3_url": "https://bucket.s3.../albums/Album/track.mp3",
            "format": "MPEG Audio",
            "file_size": "5.84 MiB",
            "duration": "2 min 25",
            "overall_bit_rate": "320 kb/s",
            "album": "Half of iT",
            "track_name": "Que Sera, Sera.",
            "performer": "Alex.Immer",
            "linked_tracker": [
                {
                    "format": "xm",
                    "albums_cdn_url": "https://cdn.../albums/Album/tracker/file.xm",
                    "albums_s3_url": "https://s3.../albums/Album/tracker/file.xm",
                    "tracker_cdn_url": "https://cdn.../tracker/albums/Album/file.xm",
                    "tracker_s3_url": "https://s3.../tracker/albums/Album/file.xm"
                }
            ],
            ...
        }
    """
    metadata: dict[str, Any] = {}

    # File-level information
    try:
        mp3 = MP3(mp3_path)
        info = mp3.info
    except Exception as e:
        print(f"    Warning: Failed reading audio info for {mp3_path}: {e}")
        info = None

    # Generate IDs
    if album_name:
        metadata["album_id"] = generate_album_id(album_name)

    # Construct URL paths (with subdirectory support)
    if album_name:
        if relative_path:
            # Preserve subdirectory structure (e.g., Extras/)
            url_path = "/".join(quote(part) for part in relative_path.parts)
        else:
            # Just filename (backwards compatibility)
            url_path = quote(mp3_path.name)

        # CDN URLs
        metadata["cdn_url"] = f"{config.cdn_base_url}/albums/{quote(album_name)}/{url_path}"
        # S3 URLs
        metadata["s3_url"] = f"{config.s3_base_url}/albums/{quote(album_name)}/{url_path}"

        # Cover URLs (covers are directly in covers/ directory, not in subdirectories)
        from .file_utils import url_safe_name

        safe_album_name = url_safe_name(album_name)
        metadata["cdn_cover_url"] = f"{config.cdn_base_url}/covers/{quote(safe_album_name)}.png"
        metadata["s3_cover_url"] = f"{config.s3_base_url}/covers/{quote(safe_album_name)}.png"

    # === Legacy "complete_name" field for backwards compatibility ===
    # Construct CDN URL with subdirectory support
    if album_name:
        if relative_path:
            # Use relative path to preserve subdirectory structure (e.g., Extras/)
            url_path = "/".join(quote(part) for part in relative_path.parts)
            metadata["complete_name"] = f"{config.cdn_base}/albums/{quote(album_name)}/{url_path}"
        else:
            # Just album name and file name (backwards compatibility)
            metadata["complete_name"] = (
                f"{config.cdn_base}/albums/{quote(album_name)}/{quote(mp3_path.name)}"
            )
    else:
        metadata["complete_name"] = f"{config.cdn_base}/albums/{quote(mp3_path.name)}"

    metadata["format"] = "MPEG Audio"

    # File size: normalized (both bytes and human-readable)
    file_stat = mp3_path.stat()
    file_size_data = normalize_file_size(file_stat.st_size)
    metadata["file_size_bytes"] = file_size_data["file_size_bytes"]
    metadata["file_size"] = file_size_data["file_size_human"]  # Legacy field

    # Audio information
    if info:
        # Duration: normalized (both seconds and human-readable)
        duration_data = normalize_duration(info.length)
        metadata["duration_seconds"] = duration_data["duration_seconds"]
        metadata["duration"] = duration_data["duration_human"]  # Legacy field

        # Cast to Any to access mutagen internal _Info attributes
        info_any: Any = info

        # Bitrate: normalized (both kbps numeric and string)
        if hasattr(info_any, "bitrate") and info_any.bitrate:
            bit_rate_kbps = int(info_any.bitrate / 1000)
            metadata["bit_rate_kbps"] = bit_rate_kbps
            metadata["overall_bit_rate"] = f"{bit_rate_kbps} kb/s"  # Legacy field

        # Format version (MPEG version)
        if hasattr(info_any, "version") and info_any.version is not None:
            metadata["format_version"] = f"Version {info_any.version}"

        # Format profile (layer)
        if hasattr(info_any, "layer") and info_any.layer is not None:
            metadata["format_profile"] = f"Layer {info_any.layer}"

    # ID3 Tags
    try:
        tags = ID3(mp3_path)
    except ID3NoHeaderError:
        tags = None
    except Exception as e:
        print(f"    Warning: ID3 read error for {mp3_path}: {e}")
        tags = None

    if tags:
        # Helper to extract text from ID3 frames
        def get_text(frame_name: str) -> str | None:
            try:
                if frame_name in tags:
                    val = tags[frame_name].text
                    if isinstance(val, list) and len(val) > 0:
                        return str(val[0])
                    return str(val)
            except Exception:  # nosec B110 - intentionally suppress errors for optional metadata
                pass
            return None

        # Standard ID3 frame mappings
        frame_mappings = {
            "TALB": "album",
            "TPE2": "album_performer",
            "TPOS": "part_position",
            "TRCK": "track_name_position",
            "TIT2": "track_name",
            "TPE1": "performer",
            "TCOM": "composer",
            "TCON": "genre",
            "TDRC": "recorded_date",
            "TSSE": "writing_library",
            "TBPM": "bpm",
        }

        for frame, key in frame_mappings.items():
            val = get_text(frame)
            if val:
                metadata[key] = val

        # Normalize BPM to numeric value
        if "bpm" in metadata:
            bpm_numeric = normalize_bpm(metadata["bpm"])
            if bpm_numeric is not None:
                metadata["bpm_numeric"] = bpm_numeric
                # Keep original string for backwards compatibility

        # Parse part/position into separate fields if needed
        if "part_position" in metadata:
            try:
                # Format: "01" or "01/02"
                part_val = metadata["part_position"]
                if "/" in part_val:
                    part, total = part_val.split("/", 1)
                    metadata["part"] = part.strip()
                    metadata["part_total"] = total.strip()
                else:
                    metadata["part"] = part_val.strip()
            except Exception:  # nosec B110 - intentionally suppress errors for optional metadata
                pass

        # Parse track position
        if "track_name_position" in metadata:
            try:
                # Format: "25" or "25/30"
                track_val = metadata["track_name_position"]
                if "/" in track_val:
                    pos, total = track_val.split("/", 1)
                    metadata["track_position"] = pos.strip()
                    metadata["track_total"] = total.strip()
                else:
                    metadata["track_position"] = track_val.strip()
            except Exception:  # nosec B110 - intentionally suppress errors for optional metadata
                pass

        # Generate track_id using album name, track name, position, and subdirectory
        if album_name and "track_name" in metadata:
            track_position = metadata.get("track_position")

            # Detect if file is in a subdirectory (e.g., "Extras")
            subdirectory = None
            if relative_path and len(relative_path.parts) > 1:
                # Get the parent directory name (e.g., "Extras" from "Extras/track.mp3")
                subdirectory = relative_path.parts[0]

            metadata["track_id"] = generate_track_id(
                album_name, metadata["track_name"], track_position, subdirectory
            )

        # Comment fields (COMM frames)
        try:
            comm_frames = [v for k, v in tags.items() if k.startswith("COMM")]
            if comm_frames:
                first = comm_frames[0]
                if hasattr(first, "text"):
                    text = first.text
                    metadata["comment"] = text[0] if isinstance(text, list) else text
        except Exception:  # nosec B110 - intentionally suppress errors for optional metadata
            pass

        # URL fields (WXXX frames)
        try:
            wxxx_frames = [v for k, v in tags.items() if k.startswith("WXXX")]
            if wxxx_frames:
                url_val = getattr(wxxx_frames[0], "url", None)
                if url_val:
                    metadata["url"] = url_val
        except Exception:  # nosec B110 - intentionally suppress errors for optional metadata
            pass

        # Cover art detection (APIC frames)
        try:
            apic_frames = [v for _k, v in tags.items() if isinstance(v, APIC)]
            if apic_frames:
                metadata["cover"] = "Yes"
                # Type cast for better type checking (mutagen stubs incomplete)
                apic: APICLike = apic_frames[0]  # type: ignore[assignment]

                # Cover type/description
                if apic.desc:
                    metadata["cover_type"] = apic.desc

                # Cover MIME type
                if apic.mime:
                    metadata["cover_mime"] = apic.mime
            else:
                metadata["cover"] = "No"
        except Exception:
            metadata["cover"] = "No"

    # Mark track as released if in albums/ directory
    metadata["released"] = True  # All MP3s in albums/ are released

    # Integrity - SHA256 checksum for file verification
    sha256_checksum = calculate_file_sha256(mp3_path)
    metadata["checksum"] = {
        "algorithm": "sha256",
        "value": sha256_checksum.replace("sha256:", ""),  # Store without prefix
        "verified_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # HTTP Range Support - for media streaming
    metadata["content_length"] = file_stat.st_size
    metadata["last_modified"] = get_file_last_modified_iso8601(mp3_path)
    metadata["accept_ranges"] = "bytes"
    metadata["etag"] = calculate_etag(mp3_path)

    # Explicit content rating
    metadata["explicit"] = detect_explicit_content(metadata)

    # === Build linked_tracker array ===
    if linked_trackers and album_name:
        # Deduplicate trackers by filename (same file appears in two locations)
        seen_trackers: dict[str, Path] = {}
        for tracker_path in linked_trackers:
            filename = tracker_path.name
            if filename not in seen_trackers:
                seen_trackers[filename] = tracker_path

        tracker_list = []
        for tracker_path in seen_trackers.values():
            # Determine tracker format from extension
            ext = tracker_path.suffix.lower().lstrip(".")

            # Generate tracker_id and extract title
            tracker_id = generate_tracker_id(album_name, tracker_path.name)
            tracker_title = extract_title_from_filename(tracker_path.name)

            # Construct paths for this tracker
            # The tracker files exist in TWO locations:
            # 1. albums/{album}/[Extras/]tracker/{file}
            # 2. tracker/albums/{album}/[Extras/]{file}

            # Determine if in Extras subdirectory
            # This assumes linked_trackers contains full paths
            is_extra = "Extras" in tracker_path.parts

            if is_extra:
                # File is in Extras subdirectory
                albums_path = (
                    f"albums/{quote(album_name)}/Extras/tracker/{quote(tracker_path.name)}"
                )
                tracker_path_str = (
                    f"tracker/albums/{quote(album_name)}/Extras/{quote(tracker_path.name)}"
                )
            else:
                # File is in album root
                albums_path = f"albums/{quote(album_name)}/tracker/{quote(tracker_path.name)}"
                tracker_path_str = f"tracker/albums/{quote(album_name)}/{quote(tracker_path.name)}"

            # Add tracker file size and checksum
            tracker_stat = tracker_path.stat()
            tracker_file_size = normalize_file_size(tracker_stat.st_size)
            tracker_checksum = calculate_file_sha256(tracker_path)

            tracker_entry = {
                "tracker_id": tracker_id,
                "tracker_title": tracker_title,
                "format": ext,
                "file_size_bytes": tracker_file_size["file_size_bytes"],
                "checksum": tracker_checksum.replace("sha256:", ""),
                "albums_cdn_url": f"{config.cdn_base_url}/{albums_path}",
                "albums_s3_url": f"{config.s3_base_url}/{albums_path}",
                "tracker_cdn_url": f"{config.cdn_base_url}/{tracker_path_str}",
                "tracker_s3_url": f"{config.s3_base_url}/{tracker_path_str}",
            }
            tracker_list.append(tracker_entry)

        metadata["linked_tracker"] = tracker_list

    return metadata


def extract_tracker_metadata(
    tracker_path: Path,
    config: Config,
    album_name: str | None = None,
    linked: bool = False,
    relative_path: Path | None = None,
    linked_master: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Extract metadata from a tracker file.

    Args:
        tracker_path: Path to tracker file (.it, .xm, .mod, etc.)
        config: Configuration instance
        album_name: Album name (URL-safe) for CDN path construction
        linked: Whether this tracker has a corresponding MP3
        relative_path: Relative path within tracker dir (e.g., Path("Album/Extras/file.xm"))
        linked_master: Info about the linked MP3 (track_id, track_name)

    Returns:
        Dict containing tracker metadata
    """
    metadata: dict[str, Any] = {}

    # Generate tracker_id
    metadata["tracker_id"] = generate_tracker_id(album_name, tracker_path.name)

    # Extract human-readable title from filename
    metadata["title"] = extract_title_from_filename(tracker_path.name)

    # File info
    metadata["file_name"] = tracker_path.name

    # File size: normalized (both bytes and human-readable)
    file_stat = tracker_path.stat()
    file_size_data = normalize_file_size(file_stat.st_size)
    metadata["file_size_bytes"] = file_size_data["file_size_bytes"]
    metadata["file_size"] = file_size_data["file_size_human"]  # Legacy field

    # Format (extension only, e.g., "xm" not "Extended Module")
    ext = tracker_path.suffix.lower().lstrip(".")
    metadata["format"] = ext

    # Creation timestamp (ISO 8601)
    metadata["created"] = get_file_created_iso8601(tracker_path)

    # Composer (default from config)
    metadata["composer"] = config.default_composer

    # Parse tracker format for detailed metadata (channels, patterns, tools, etc.)
    format_metadata = extract_tracker_format_metadata(tracker_path)
    if format_metadata:
        # Add format-specific metadata
        metadata["source_format_version"] = format_metadata.get("source_format_version", "unknown")
        metadata["tracker_tools"] = format_metadata.get("tracker_tools", ["Unknown"])

        # Optional: Add additional format details if available
        if "channels" in format_metadata:
            metadata["channels"] = format_metadata["channels"]
        if "patterns" in format_metadata:
            metadata["patterns"] = format_metadata["patterns"]
        if "instruments" in format_metadata:
            metadata["instruments"] = format_metadata["instruments"]
        if "samples" in format_metadata:
            metadata["samples"] = format_metadata["samples"]
        if format_metadata.get("song_name"):
            metadata["song_name"] = format_metadata["song_name"]
    else:
        # Fallback if parsing fails
        metadata["source_format_version"] = "unknown"
        metadata["tracker_tools"] = ["Unknown"]

    # Integrity - SHA256 checksum
    sha256_checksum = calculate_file_sha256(tracker_path)
    metadata["checksum"] = {
        "algorithm": "sha256",
        "value": sha256_checksum.replace("sha256:", ""),
    }

    # HTTP Range Support
    metadata["content_length"] = file_stat.st_size
    metadata["last_modified"] = get_file_last_modified_iso8601(tracker_path)
    metadata["accept_ranges"] = "bytes"
    metadata["etag"] = calculate_etag(tracker_path)

    # Explicit content rating (default: False for tracker files)
    metadata["explicit"] = False

    # Legacy fields for backwards compatibility
    metadata["linked"] = linked
    format_names = {
        "it": "Impulse Tracker",
        "xm": "Extended Module",
        "mod": "ProTracker Module",
        "s3m": "ScreamTracker 3",
        "ftm": "FamiTracker Module",
        "nsf": "NES Sound Format",
        "mptm": "OpenMPT Module",
        "umx": "Unreal Music Package",
        "mt2": "MadTracker 2",
        "mdz": "Compressed MOD",
        "s3z": "Compressed S3M",
        "xmz": "Compressed XM",
        "itz": "Compressed IT",
    }
    metadata["format_long"] = format_names.get(ext, "Tracker Module")

    # Album association
    if album_name:
        metadata["album"] = album_name
    elif not linked:
        metadata["album"] = "unreleased"

    # === Dual URL Paths ===
    # Tracker files exist in TWO locations:
    # 1. albums/{album}/[Extras/]tracker/{file}  (albums_*_url)
    # 2. tracker/albums/{album}/[Extras/]{file}  (tracker_*_url)
    # OR for unreleased:
    # 2. tracker/unreleased/[{album}/]{file}

    # Determine if in Extras subdirectory based on relative_path or tracker_path
    is_extra = "Extras" in tracker_path.parts if tracker_path else False

    if album_name and album_name != "unreleased":
        # Released album tracker - dual paths
        if is_extra:
            albums_path = f"albums/{quote(album_name)}/Extras/tracker/{quote(tracker_path.name)}"
            tracker_path_str = (
                f"tracker/albums/{quote(album_name)}/Extras/{quote(tracker_path.name)}"
            )
        else:
            albums_path = f"albums/{quote(album_name)}/tracker/{quote(tracker_path.name)}"
            tracker_path_str = f"tracker/albums/{quote(album_name)}/{quote(tracker_path.name)}"

        metadata["albums_cdn_url"] = f"{config.cdn_base_url}/{albums_path}"
        metadata["albums_s3_url"] = f"{config.s3_base_url}/{albums_path}"
        metadata["tracker_cdn_url"] = f"{config.cdn_base_url}/{tracker_path_str}"
        metadata["tracker_s3_url"] = f"{config.s3_base_url}/{tracker_path_str}"

    elif album_name == "unreleased" or not linked:
        # Unreleased tracker - only tracker/* path
        if relative_path:
            # Preserve full directory structure for unreleased
            url_path = "/".join(quote(part) for part in relative_path.parts)
            tracker_path_str = f"tracker/{url_path}"
        else:
            tracker_path_str = f"tracker/unreleased/{quote(tracker_path.name)}"

        metadata["tracker_cdn_url"] = f"{config.cdn_base_url}/{tracker_path_str}"
        metadata["tracker_s3_url"] = f"{config.s3_base_url}/{tracker_path_str}"

    # linked_master info (if this tracker has a mastered MP3)
    if linked_master:
        metadata["linked_master"] = linked_master

    # === Legacy "complete_name" field (backwards compatibility) ===
    if relative_path:
        # Use relative path to preserve full directory structure
        url_path = "/".join(quote(part) for part in relative_path.parts)
        metadata["complete_name"] = f"{config.cdn_base}/tracker/{url_path}"
    elif linked and album_name:
        # Linked trackers go under tracker/{album}/ (backwards compatibility)
        metadata["complete_name"] = (
            f"{config.cdn_base}/tracker/{quote(album_name)}/{quote(tracker_path.name)}"
        )
    elif album_name and album_name != "unreleased":
        # Unreleased but album-associated (backwards compatibility)
        metadata["complete_name"] = (
            f"{config.cdn_base}/tracker/unreleased/{quote(album_name)}/{quote(tracker_path.name)}"
        )
    else:
        # Standalone unreleased (backwards compatibility)
        metadata["complete_name"] = (
            f"{config.cdn_base}/tracker/unreleased/{quote(tracker_path.name)}"
        )

    return metadata


def get_cover_info_from_mp3(mp3_path: Path) -> dict[str, Any] | None:
    """Extract embedded cover art information without saving the image.

    Args:
        mp3_path: Path to MP3 file

    Returns:
        Dict with cover info if found, None otherwise
        {
            "mime": "image/png",
            "desc": "Cover (front)",
            "size": 123456,
        }
    """
    try:
        tags = ID3(mp3_path)
        apic_frames = [v for _k, v in tags.items() if isinstance(v, APIC)]

        if apic_frames:
            # Type cast for better type checking (mutagen stubs incomplete)
            apic: APICLike = apic_frames[0]  # type: ignore[assignment]
            return {
                "mime": apic.mime,
                "desc": apic.desc,
                "size": len(apic.data),
            }
    except Exception:  # nosec B110 - intentionally suppress errors for optional cover art
        pass

    return None
