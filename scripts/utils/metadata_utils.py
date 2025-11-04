"""Metadata extraction utilities for MP3 and tracker files.

Handles comprehensive ID3 tag extraction and file metadata.
"""

from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from mutagen.id3 import ID3
from mutagen.id3._frames import APIC
from mutagen.id3._util import ID3NoHeaderError
from mutagen.mp3 import MP3

from .config import Config
from .id_utils import (
    extract_title_from_filename,
    generate_album_id,
    generate_track_id,
    generate_tracker_id,
    get_file_created_iso8601,
)


class APICLike(Protocol):
    """Protocol for APIC frame attributes (mutagen type stub workaround)."""

    data: bytes
    mime: str
    desc: str


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
    - V2 fields: track_id, album_id, cdn_url, s3_url, linked_tracker array

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

    # === V2 FIELDS ===
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
    metadata["file_size"] = human_filesize(mp3_path.stat().st_size)

    # Audio information
    if info:
        metadata["duration"] = format_duration(info.length)

        # Cast to Any to access mutagen internal _Info attributes
        info_any: Any = info

        # Bitrate
        if hasattr(info_any, "bitrate") and info_any.bitrate:
            metadata["overall_bit_rate"] = f"{int(info_any.bitrate / 1000)} kb/s"

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

    # === Build linked_tracker array (v2) ===
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

            tracker_entry = {
                "tracker_id": tracker_id,
                "tracker_title": tracker_title,
                "format": ext,
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
        Dict containing tracker metadata with v2 fields

    Example output:
        {
            "tracker_id": "8bit-seduction-01-the-day-they-landed",
            "title": "The Day They Landed",
            "file_name": "01.The-Day-They-Landed.xm",
            "format": "xm",
            "file_size": "0.15 MiB",
            "created": "2025-03-14T00:00:00Z",
            "composer": "Alex.Immer",
            "albums_cdn_url": "https://cdn.../albums/Album/tracker/file.xm",
            "albums_s3_url": "https://s3.../albums/Album/tracker/file.xm",
            "tracker_cdn_url": "https://cdn.../tracker/albums/Album/file.xm",
            "tracker_s3_url": "https://s3.../tracker/albums/Album/file.xm",
            "linked_master": {
                "track_id": "8bit-seduction-01-the-day-they-landed",
                "track_name": "The Day They Landed"
            }
        }
    """
    metadata: dict[str, Any] = {}

    # === V2 FIELDS ===
    # Generate tracker_id
    metadata["tracker_id"] = generate_tracker_id(album_name, tracker_path.name)

    # Extract human-readable title from filename
    metadata["title"] = extract_title_from_filename(tracker_path.name)

    # File info
    metadata["file_name"] = tracker_path.name
    metadata["file_size"] = human_filesize(tracker_path.stat().st_size)

    # Format (extension only, e.g., "xm" not "Extended Module")
    ext = tracker_path.suffix.lower().lstrip(".")
    metadata["format"] = ext

    # Creation timestamp (ISO 8601)
    metadata["created"] = get_file_created_iso8601(tracker_path)

    # Composer (default from config)
    metadata["composer"] = config.default_composer

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

    # === Dual URL Paths (V2) ===
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
