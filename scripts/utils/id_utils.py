"""ID generation and utility functions for metadata.

Provides functions for generating normalized, URL-safe IDs and calculating
aggregate statistics for enterprise-grade metadata.

Leverages existing file_utils functions for sanitization to avoid duplication.
"""

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .file_utils import normalize_stem


def sanitize_id(text: str) -> str:
    """Convert text to URL-safe ID format.

    Uses existing normalize_stem() function for consistency.

    Rules:
    - Convert to lowercase
    - Replace spaces and underscores with hyphens
    - Remove special characters except hyphens
    - Remove leading numbers and dots (e.g., "02.Second-Wave" → "second-wave")
    - Collapse multiple hyphens into one
    - Strip leading/trailing hyphens

    Args:
        text: Input text to sanitize

    Returns:
        URL-safe ID string

    Examples:
        >>> sanitize_id("8Bit Seduction")
        '8bit-seduction'
        >>> sanitize_id("02.Second-Wave")
        'second-wave'
        >>> sanitize_id("Godom & Sodorrah")
        'godom-and-sodorrah'
    """
    # Leverage existing normalize_stem which does exactly what we need
    # It removes track numbers, lowercases, and normalizes to URL-safe format
    return normalize_stem(text)


def generate_album_id(album_name: str) -> str:
    """Generate album_id from album name.

    Args:
        album_name: Album name (e.g., "8Bit Seduction")

    Returns:
        Sanitized album ID (e.g., "8bit-seduction")

    Examples:
        >>> generate_album_id("8Bit Seduction")
        '8bit-seduction'
        >>> generate_album_id("Half of iT")
        'half-of-it'
    """
    return sanitize_id(album_name)


def generate_track_id(
    album_name: str,
    track_name: str,
    position: str | None = None,
    subdirectory: str | None = None,
) -> str:
    """Generate track_id from album, track name, optional position, and subdirectory.

    Format: {album_id}-{subdirectory}-{position}-{track_name_id}
    Or: {album_id}-{position}-{track_name_id} if no subdirectory
    Or: {album_id}-{track_name_id} if no position or subdirectory

    Args:
        album_name: Album name
        track_name: Track name (may include leading numbers like "02.Second-Wave")
        position: Track position (e.g., "02") - optional
        subdirectory: Subdirectory name (e.g., "extras") - optional

    Returns:
        Track ID string

    Examples:
        >>> generate_track_id("8Bit Seduction", "02.Second-Wave", "02")
        '8bit-seduction-02-second-wave'
        >>> generate_track_id("Half of iT", "Rising-Sun", "01", "extras")
        'half-of-it-extras-01-rising-sun'
        >>> generate_track_id("8Bit Seduction", "The Day They Landed")
        '8bit-seduction-the-day-they-landed'
    """
    album_id = sanitize_id(album_name)
    track_name_id = sanitize_id(track_name)

    # Build ID components
    parts = [album_id]

    # Add subdirectory if present
    if subdirectory:
        subdir_id = sanitize_id(subdirectory)
        parts.append(subdir_id)

    # Add position if present
    if position:
        # Keep leading zeros in position (e.g., "02" stays "02")
        parts.append(position)

    # Add track name
    parts.append(track_name_id)

    return "-".join(parts)


def generate_tracker_id(album_name: str | None, filename: str) -> str:
    """Generate tracker_id from album name and filename.

    Format matches track_id format: {album_id}-{position}-{track_name_id}
    Or: {track_name_id} if no album

    Args:
        album_name: Album name (None for standalone trackers)
        filename: Tracker filename (e.g., "01.The-Day-They-Landed.xm")

    Returns:
        Tracker ID string

    Examples:
        >>> generate_tracker_id("8Bit Seduction", "01.The-Day-They-Landed.xm")
        '8bit-seduction-01-the-day-they-landed'
        >>> generate_tracker_id("Dissociation", "05.Without-You.xm")
        'dissociation-05-without-you'
        >>> generate_tracker_id(None, "Dreamscape-Prototype.mod")
        'dreamscape-prototype'
    """
    if album_name:
        album_id = sanitize_id(album_name)

        # Extract position from filename (e.g., "01" from "01.The-Day-They-Landed.xm")
        import re

        name_without_ext = Path(filename).stem
        position_match = re.match(r"^(\d+)\.", name_without_ext)

        if position_match:
            # Has position number - format like track_id
            position = position_match.group(1)  # Keep leading zeros (e.g., "01" stays "01")
            # Pass full filename to sanitize_id so it properly extracts stem and removes position
            track_name_id = sanitize_id(filename)
            return f"{album_id}-{position}-{track_name_id}"
        else:
            # No position number - just album-name format
            name_id = sanitize_id(filename)
            return f"{album_id}-{name_id}"

    return sanitize_id(filename)


def extract_title_from_filename(filename: str) -> str:
    """Extract human-readable title from filename.

    Removes track numbers, file extensions, and converts to title case.

    Args:
        filename: Tracker or audio filename

    Returns:
        Human-readable title

    Examples:
        >>> extract_title_from_filename("01.The-Day-They-Landed.xm")
        'The Day They Landed'
        >>> extract_title_from_filename("dreamscape-prototype.mod")
        'Dreamscape Prototype'
    """
    # Remove extension
    name = Path(filename).stem

    # Remove leading track numbers (e.g., "01." or "02 - ")
    name = re.sub(r"^\d+[\.\-\s]+", "", name)

    # Replace hyphens and underscores with spaces
    name = name.replace("-", " ").replace("_", " ")

    # Title case
    return name.title()


def format_duration_short(seconds: float) -> str:
    """Format duration in short human-readable format.

    Args:
        seconds: Duration in seconds

    Returns:
        Formatted string like "28s", "2m 45s", "1h 14m"

    Examples:
        >>> format_duration_short(28)
        '28s'
        >>> format_duration_short(165)
        '2m 45s'
        >>> format_duration_short(4440)
        '1h 14m'
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)

    if hours > 0:
        if minutes > 0:
            return f"{hours}h {minutes}m"
        return f"{hours}h"
    elif minutes > 0:
        if secs > 0:
            return f"{minutes}m {secs}s"
        return f"{minutes}m"
    else:
        return f"{secs}s"


def parse_duration_to_seconds(duration_str: str) -> float:
    """Parse duration string to seconds.

    Supports formats: "2 min 45", "0 min 28", etc.

    Args:
        duration_str: Duration string like "2 min 45"

    Returns:
        Total seconds as float

    Examples:
        >>> parse_duration_to_seconds("2 min 45")
        165.0
        >>> parse_duration_to_seconds("0 min 28")
        28.0
    """
    # Match patterns like "2 min 45" or "1 min 30"
    match = re.search(r"(\d+)\s*min\s*(\d+)", duration_str)
    if match:
        minutes = int(match.group(1))
        seconds = int(match.group(2))
        return float(minutes * 60 + seconds)

    # Try to match just seconds
    match = re.search(r"(\d+)\s*s", duration_str)
    if match:
        return float(match.group(1))

    return 0.0


def calculate_total_duration(tracks: list[dict[str, Any]]) -> str:
    """Calculate total duration from track list.

    Args:
        tracks: List of track dictionaries with "duration" field

    Returns:
        Formatted total duration string

    Examples:
        >>> tracks = [{"duration": "2 min 45"}, {"duration": "1 min 30"}]
        >>> calculate_total_duration(tracks)
        '4m 15s'
    """
    total_seconds = 0.0
    for track in tracks:
        duration = track.get("duration", "")
        if duration:
            total_seconds += parse_duration_to_seconds(str(duration))

    return format_duration_short(total_seconds)


def calculate_bpm_range(tracks: list[dict[str, Any]]) -> list[float] | None:
    """Calculate BPM range from track list.

    Args:
        tracks: List of track dictionaries with optional "bpm" field

    Returns:
        [min_bpm, max_bpm] or None if no BPM data

    Examples:
        >>> tracks = [{"bpm": "120"}, {"bpm": "140"}, {"bpm": "95"}]
        >>> calculate_bpm_range(tracks)
        [95.0, 140.0]
    """
    bpms: list[float] = []

    for track in tracks:
        bpm_str = track.get("bpm", "")
        if bpm_str:
            try:
                # Handle various formats: "120", "120.5", "33.2594"
                bpm = float(str(bpm_str))
                if bpm > 0:
                    bpms.append(bpm)
            except (ValueError, TypeError):
                continue

    if not bpms:
        return None

    return [round(min(bpms), 1), round(max(bpms), 1)]


def get_file_created_iso8601(file_path: Path) -> str:
    """Get file creation/modification time in ISO 8601 format.

    Args:
        file_path: Path to file

    Returns:
        ISO 8601 timestamp string

    Examples:
        >>> get_file_created_iso8601(Path("test.xm"))  # doctest: +SKIP
        '2025-03-14T00:00:00Z'
    """
    try:
        mtime = file_path.stat().st_mtime
        dt = datetime.fromtimestamp(mtime)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        # Fallback to current time if file doesn't exist
        return datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")


def get_most_common_value(values: list[str]) -> str | None:
    """Get the most frequently occurring value from a list.

    Args:
        values: List of string values

    Returns:
        Most common value or None if list is empty

    Examples:
        >>> get_most_common_value(["rock", "pop", "rock", "rock"])
        'rock'
    """
    if not values:
        return None

    # Count occurrences
    counts: dict[str, int] = {}
    for value in values:
        if value:
            counts[value] = counts.get(value, 0) + 1

    if not counts:
        return None

    # Return most common
    return max(counts.items(), key=lambda x: x[1])[0]


def build_tracker_linkage(
    mp3_files: list[Path],
    tracker_files: list[Path],
) -> dict[str, list[Path]]:
    """Build mapping of normalized stems to tracker files.

    Enables linking MP3 tracks to their source tracker files by matching
    normalized filenames (e.g., "the-day-they-landed" matches both
    "01.The-Day-They-Landed.mp3" and "01.The-Day-They-Landed.xm").

    Args:
        mp3_files: List of MP3 file paths
        tracker_files: List of tracker file paths

    Returns:
        Dict mapping normalized stems to list of tracker file paths.
        Multiple formats per track are supported.

    Examples:
        >>> mp3s = [Path("01.The-Day-They-Landed.mp3")]
        >>> trackers = [Path("01.The-Day-They-Landed.xm"), Path("01.The-Day-They-Landed.it")]
        >>> result = build_tracker_linkage(mp3s, trackers)
        >>> len(result["the-day-they-landed"])
        2
    """
    # Build mapping of normalized stems to tracker files
    stem_to_trackers: dict[str, list[Path]] = {}

    for tracker_path in tracker_files:
        stem = normalize_stem(tracker_path.name)
        if stem not in stem_to_trackers:
            stem_to_trackers[stem] = []
        stem_to_trackers[stem].append(tracker_path)

    return stem_to_trackers


def find_linked_trackers(
    mp3_path: Path,
    stem_to_trackers: dict[str, list[Path]],
) -> list[Path]:
    """Find all tracker files linked to an MP3 file.

    Args:
        mp3_path: Path to MP3 file
        stem_to_trackers: Mapping from normalize_stem output to tracker files

    Returns:
        List of tracker file paths (may be empty, one, or multiple files)

    Examples:
        >>> mp3 = Path("01.The-Day-They-Landed.mp3")
        >>> mapping = {"the-day-they-landed": [Path("01.xm"), Path("01.it")]}
        >>> find_linked_trackers(mp3, mapping)
        [Path('01.xm'), Path('01.it')]
    """
    stem = normalize_stem(mp3_path.name)
    return stem_to_trackers.get(stem, [])
