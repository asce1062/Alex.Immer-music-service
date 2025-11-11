"""Manifest generation utilities for v3 metadata schema.

Builds JSON metadata files for albums, tracks, trackers, and unreleased content
with comprehensive v3 schema enhancements.

v3 Schema Structure:
manifest.json:
  - schema_version: "3.0.0"
  - content_type: "metadata" (distinguish from media)
  - cache_info: Strategy, TTL, local/remote paths
  - catalog: Totals with normalized numerics (total_size_bytes, total_duration_seconds)
  - integrity: SHA256 checksums for all JSON files

albums.json (per album):
  - album_id, title, artist, release_date
  - duration_seconds, duration_human (normalized)
  - file_size_bytes, file_size (normalized)
  - bpm_range: {min, max, avg} (restructured from single value)
  - checksum: Album-level SHA256 from track checksums
  - tracks: Array of track metadata with v3 fields
  - cover_art: URLs for covers and thumbnails

tracks.json (per track):
  - track_id, title, artist, album
  - duration_seconds, bit_rate_kbps, file_size_bytes (normalized numerics)
  - checksum: {algorithm, value, verified_at}
  - content_length, last_modified, accept_ranges, etag (HTTP range support)
  - explicit: Content rating boolean
  - cdn_url, s3_url: Playback URLs

tracker.json (per tracker file):
  - tracker_id, title, file_name, format
  - source_format_version, tracker_tools (from binary parsing)
  - channels, patterns, instruments, samples
  - checksum, content_length, last_modified, accept_ranges, etag
  - linked: Boolean indicating MP3 master exists
  - linked_master: Reference to MP3 track if available

unreleased.json:
  - Tracker files without released MP3 masters
  - Same v3 fields as tracker.json entries

Functions:
- build_albums_manifest(): Generate albums.json with v3 schema
- build_tracks_manifest(): Generate tracks.json with v3 schema
- build_tracker_manifest(): Generate tracker.json with v3 schema and linkage
- build_unreleased_manifest(): Generate unreleased.json for unlinked trackers
- build_master_manifest(): Generate manifest.json with integrity checksums
"""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .cache_utils import get_manifest_cache_info
from .config import Config
from .file_utils import get_file_list, normalize_stem, url_safe_name
from .id_utils import (
    build_tracker_linkage,
    calculate_bpm_range,
    calculate_total_duration,
    find_linked_trackers,
    generate_album_id,
)
from .image_utils import find_cover_for_album, find_thumbnail_for_album
from .metadata_utils import extract_mp3_metadata, extract_tracker_metadata


def build_albums_manifest(
    albums_data: list[dict[str, Any]],
    config: Config,
) -> list[dict[str, Any]]:
    """Build albums.json manifest.

    Args:
        albums_data: List of album dictionaries with tracks and cover info
        config: Configuration instance

    Returns:
        List of album manifest entries
    """
    manifest: list[dict[str, Any]] = []

    # Load manual overrides from YAML
    album_metadata_overrides = config.load_album_metadata()

    for album in albums_data:
        album_name = album["name"]  # This is the directory name (URL-safe)
        album_id = generate_album_id(album_name)

        # Get override data if available
        overrides = album_metadata_overrides.get(album_id, {})

        # Extract track metadata for calculations
        track_list = album.get("track_metadata", [])

        # Get the real album name from the first track's ID3 TALB tag
        real_album_name = album_name  # Default to directory name
        if track_list and "album" in track_list[0]:
            real_album_name = track_list[0]["album"]

        entry: dict[str, Any] = {
            "album_id": album_id,
            "album": real_album_name,  # Use real name from ID3 tags
            "artist": config.default_artist,
            "total_tracks": len(track_list),
            "released": album_name.lower() != "unreleased",
        }

        # Calculate aggregate fields from tracks
        if track_list:
            # Total duration
            duration_human = calculate_total_duration(track_list)
            entry["duration"] = duration_human  # Legacy field

            # Calculate duration_seconds from tracks
            total_seconds = sum(track.get("duration_seconds", 0) for track in track_list)
            if total_seconds > 0:
                entry["duration_seconds"] = total_seconds

            # File size: sum of all track file sizes
            total_bytes = sum(track.get("file_size_bytes", 0) for track in track_list)
            if total_bytes > 0:
                entry["file_size_bytes"] = total_bytes
                entry["file_size_human"] = f"{total_bytes / (1024 * 1024):.2f} MiB"

            # BPM range: restructured with min/max/avg
            bpm_values = [
                track.get("bpm_numeric", track.get("bpm"))
                for track in track_list
                if track.get("bpm_numeric") or track.get("bpm")
            ]
            # Filter to numeric values only
            bpm_numeric_values = []
            for bpm in bpm_values:
                if isinstance(bpm, (int, float)):
                    bpm_numeric_values.append(float(bpm))
                elif isinstance(bpm, str):
                    # Try to convert string BPM to float
                    try:
                        bpm_numeric_values.append(float(bpm))
                    except (ValueError, TypeError):
                        continue  # Skip invalid BPM values

            if bpm_numeric_values:
                entry["bpm_range"] = {
                    "min": round(min(bpm_numeric_values), 1),
                    "max": round(max(bpm_numeric_values), 1),
                    "avg": round(sum(bpm_numeric_values) / len(bpm_numeric_values), 1),
                }
            else:
                # Legacy format if no numeric BPM values
                bpm_range = calculate_bpm_range(track_list)
                if bpm_range:
                    entry["bpm_range"] = bpm_range

            # Extract year from first track's recorded_date if available
            first_track = track_list[0]
            if "recorded_date" in first_track:
                year = str(first_track["recorded_date"])[:4]  # Extract year
                entry["year"] = year

        # Apply manual overrides from YAML (these take precedence)
        if "year" in overrides:
            entry["year"] = overrides["year"]
        if "genre" in overrides:
            entry["genre"] = overrides["genre"]
        if "description" in overrides:
            entry["description"] = overrides["description"]
        if "tags" in overrides:
            entry["tags"] = overrides["tags"]

        # Cover URLs - covers are directly in covers/ directory
        safe_album_name = url_safe_name(album_name)
        entry["cdn_cover_url"] = f"{config.cdn_base_url}/covers/{quote(safe_album_name)}.png"
        entry["s3_cover_url"] = f"{config.s3_base_url}/covers/{quote(safe_album_name)}.png"

        # Thumbnail URLs
        thumb_name = f"{album_id}.{config.thumbnail_format}"
        entry["cdn_thumbnail_url"] = (
            f"{config.cdn_base_url}/covers/{config.DIR_STRUCTURE['thumbs']}/{quote(thumb_name)}"
        )
        entry["s3_thumbnail_url"] = (
            f"{config.s3_base_url}/covers/{config.DIR_STRUCTURE['thumbs']}/{quote(thumb_name)}"
        )

        # Explicit content rating - check if any track is explicit
        if track_list:
            entry["explicit"] = any(track.get("explicit", False) for track in track_list)
        else:
            entry["explicit"] = False

        # Album-level checksum (hash of all track files concatenated)
        # This allows detecting changes to any track in the album
        if track_list:
            checksums = [
                track.get("checksum", {}).get("value", "")
                for track in track_list
                if track.get("checksum")
            ]
            if checksums:
                # Concatenate all track checksums and hash them
                combined = "".join(sorted(checksums))
                album_checksum = hashlib.sha256(combined.encode()).hexdigest()
                entry["checksum"] = {
                    "algorithm": "sha256",
                    "value": album_checksum,
                    "covers": [f"{safe_album_name}.png"],  # Files included
                }

        # HTTP Range Support - album last modified = newest track
        if track_list:
            last_modified_values = [
                track.get("last_modified", "") for track in track_list if track.get("last_modified")
            ]
            if last_modified_values:
                entry["last_modified"] = max(last_modified_values)

        # Legacy fields for backwards compatibility
        entry["tracks"] = album.get("tracks", [])
        # Use default cover as fallback if album doesn't have one
        default_cover_url = f"{config.cdn_base_url}/covers/default-cover.png"
        entry["cover"] = album.get("cover") or default_cover_url
        entry["thumbnail"] = album.get("thumbnail") or default_cover_url

        manifest.append(entry)

    return manifest


def build_tracks_manifest(
    tracks_data: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build tracks.json manifest.

    Format:
    [
        {
            "album": "8Bit-Seduction",
            "file_name": "01.The-Day-They-Landed.mp3",
            "complete_name": "url",
            "format": "MPEG Audio",
            "file_size": "5.84 MiB",
            "duration": "2 min 25",
            ... (all metadata fields)
        },
        ...
    ]

    Args:
        tracks_data: List of track metadata dictionaries

    Returns:
        List of track manifest entries
    """
    manifest: list[dict[str, Any]] = []

    for track in tracks_data:
        entry: dict[str, Any] = {
            "album": track.get("album", "Unknown"),
            "file_name": track.get("file_name", ""),
        }

        # Merge all metadata
        entry.update(track.get("metadata", {}))

        # Add artist field (alias for performer for API consistency)
        if "performer" in entry and "artist" not in entry:
            entry["artist"] = entry["performer"]
        elif "album_performer" in entry and "artist" not in entry:
            entry["artist"] = entry["album_performer"]

        manifest.append(entry)

    return manifest


def build_tracker_manifest(
    tracker_data: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build tracker.json manifest

    Args:
        tracker_data: List of tracker metadata dictionaries

    Returns:
        List of tracker manifest entries
    """
    # Pass through all metadata fields (fields are already in tracker_data)
    return tracker_data


def build_unreleased_manifest(
    unreleased_data: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build unreleased.json manifest (only unlinked tracker files)

    Args:
        unreleased_data: List of unreleased tracker metadata dictionaries

    Returns:
        List of unreleased manifest entries
    """
    # Filter only unlinked trackers (pass through all fields)
    manifest = [tracker for tracker in unreleased_data if not tracker.get("linked", False)]

    return manifest


def build_master_manifest(
    albums_count: int,
    tracks_count: int,
    tracker_count: int,
    unreleased_count: int,
    album_names: list[str],
    albums_list: list[dict[str, Any]] | None = None,
    config: Any | None = None,
) -> dict[str, Any]:
    """Build manifest.json (master manifest) - Production-grade format.

    Args:
        albums_count: Total number of albums
        tracks_count: Total number of tracks
        tracker_count: Total number of tracker files
        unreleased_count: Total number of unreleased trackers
        album_names: List of album names
        albums_list: Optional list of album metadata for enhanced manifest
        config: Optional Config instance for URLs

    Returns:
        Master manifest dictionary in production format
    """
    # Get config values or use defaults
    cdn_base = config.cdn_base_url if config else "https://cdn.aleximmer.me"
    default_artist = config.default_artist if config else "Alex.Immer"

    # Count released vs unreleased albums
    released_albums = albums_count
    if albums_list and any(
        str(album.get("name", "")).lower() == "unreleased" for album in albums_list
    ):
        # Subtract 1 if "Unreleased" collection exists
        released_albums = albums_count - 1

    # Calculate unlinked tracker files (total trackers - tracks with trackers)
    total_unlinked = max(0, tracker_count - tracks_count)

    # Calculate catalog totals from albums_list if provided
    total_size_bytes = 0
    total_duration_seconds = 0
    if albums_list:
        for album in albums_list:
            album_metadata = album.get("track_metadata", [])
            total_size_bytes += sum(track.get("file_size_bytes", 0) for track in album_metadata)
            total_duration_seconds += sum(
                track.get("duration_seconds", 0) for track in album_metadata
            )

    manifest: dict[str, Any] = {
        "schema_version": "3.0.0",
        "content_type": "metadata",  # distinguish from media content
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cache_info": get_manifest_cache_info(),  # cache strategy
        "artist": {
            "name": default_artist,
            "url": "https://music.alexmbugua.me",
            "contact": "tnkratos@gmail.com",
            "socials": {
                "soundcloud": "https://soundcloud.com/aleximmer",
                "github": "https://github.com/asce1062",
                "website": "https://alexmbugua.me",
                "x": "https://x.com/alex_immer",
                "discord": "https://discord.com/users/asce1062",
                "facebook": "https://www.facebook.com/kaizoku.asce",
                "youtube": "https://www.youtube.com/@asce1062",
                "steam": "https://steamcommunity.com/id/alexasce",
                "reddit": "https://www.reddit.com/user/asce1062/",
                "linkedin": "https://www.linkedin.com/in/alex-mbugua",
            },
        },
        "catalog": {
            "released_albums": released_albums,
            "unreleased_collections": 1 if unreleased_count > 0 else 0,
            "total_tracks": tracks_count,
            "total_tracker_sources": tracker_count,
            "total_unlinked_tracker_files": total_unlinked,
            "total_size_bytes": total_size_bytes,  # total catalog size
            "total_duration_seconds": total_duration_seconds,  # total duration
        },
        "resources": {
            "albums_index": f"{cdn_base}/metadata/albums.json",
            "tracks_index": f"{cdn_base}/metadata/tracks.json",
            "tracker_index": f"{cdn_base}/metadata/tracker.json",
            "unreleased_index": f"{cdn_base}/metadata/unreleased.json",
        },
        "covers": {
            "base_url": f"{cdn_base}/covers/",
            "thumbs_url": f"{cdn_base}/covers/thumbs/",
            "default_cover": f"{cdn_base}/covers/default-cover.png",
        },
        "cdn": {
            "base_url": f"{cdn_base}/",
            "albums_root": f"{cdn_base}/albums/",
            "trackers_root": f"{cdn_base}/tracker/",
        },
        "albums": [],
        "tracker_files": {
            "released": f"{cdn_base}/metadata/tracker.json",
            "unreleased": f"{cdn_base}/metadata/unreleased.json",
        },
        "service_worker": {
            "cache_strategy": "stale-while-revalidate",
            "cached_endpoints": [
                "albums.json",
                "tracks.json",
                "tracker.json",
                "unreleased.json",
            ],
        },
        "api": {
            "rest_entrypoint": "https://music-api.aleximmer.me/v1/music/",
            "graphql_entrypoint": "https://music-api.aleximmer.me/graphql",
            "examples": {
                "album_query": (
                    '{ album(id: "8bit-seduction") { title year tracks { title duration } } }'
                ),
                "track_query": (
                    '{ track(id: "8bit-seduction-01-the-day-they-landed") { title bpm url } }'
                ),
            },
        },
    }

    # Build enhanced albums list if data is available
    if albums_list and config:
        from .id_utils import sanitize_id

        # Load album metadata overrides
        album_metadata_overrides = config.load_album_metadata()

        enhanced_albums = []
        for album in albums_list:
            album_name = str(album.get("name", "Unknown"))  # Directory name (URL-safe)
            album_id = sanitize_id(album_name)
            is_unreleased = album_name.lower() == "unreleased"

            # Get the real album name from the first track's ID3 TALB tag
            # (preserves original formatting: "Chi Mai" not "Chi-Mai")
            real_album_name = album_name  # Default to directory name
            track_metadata = album.get("track_metadata", [])
            if track_metadata and "album" in track_metadata[0]:
                real_album_name = track_metadata[0]["album"]

            # Try to get year from overrides, then from track metadata, fallback to current year
            year = 2024
            overrides = album_metadata_overrides.get(album_id, {})
            if "year" in overrides:
                year = overrides["year"]
            else:
                # Try to extract from first track's recorded_date
                if track_metadata and "recorded_date" in track_metadata[0]:
                    year = int(str(track_metadata[0]["recorded_date"])[:4])

            # Use default cover if album doesn't have one
            default_cover = f"{cdn_base}/covers/default-cover.png"
            album_entry = {
                "id": album_id,
                "title": real_album_name,  # Use real name from ID3 tags
                "released": not is_unreleased,
                "year": year,
                "cover": album.get("cover") or default_cover,
                "thumbnail": album.get("thumbnail") or default_cover,
                "url": f"{cdn_base}/albums/{album_name}/",
                "metadata": f"{cdn_base}/metadata/tracks.json?album={album_id}",
            }
            enhanced_albums.append(album_entry)

        manifest["albums"] = enhanced_albums
    else:
        # Fallback: basic album list with names only
        from .id_utils import sanitize_id

        manifest["albums"] = [
            {
                "id": sanitize_id(name),
                "title": name,
                "released": name.lower() != "unreleased",
            }
            for name in sorted(album_names)
        ]

    return manifest


def compute_file_checksums(metadata_dir: Path) -> dict[str, dict[str, Any]]:
    """Compute SHA256 checksums and metadata for metadata files (enhanced).

    Args:
        metadata_dir: Path to metadata directory

    Returns:
        Dict mapping filename to metadata dict with:
        - value: SHA256 hex digest
        - size_bytes: File size in bytes
        - last_modified: ISO 8601 timestamp
    """
    from .metadata_utils import get_file_last_modified_iso8601

    checksums: dict[str, dict[str, Any]] = {}
    for filename in ["albums.json", "tracks.json", "tracker.json", "unreleased.json"]:
        filepath = metadata_dir / filename
        if filepath.exists():
            sha256 = hashlib.sha256()
            with filepath.open("rb") as f:
                # Read in chunks to handle large files
                for chunk in iter(lambda: f.read(8192), b""):
                    sha256.update(chunk)

            # Enhanced checksum metadata
            checksums[filename] = {
                "value": sha256.hexdigest(),
                "size_bytes": filepath.stat().st_size,
                "last_modified": get_file_last_modified_iso8601(filepath),
            }

    return checksums


def write_manifest_file(
    manifest_data: Any,
    output_path: Path,
    dry_run: bool = False,
    verbose: bool = True,
) -> bool:
    """Write manifest data to JSON file.

    Args:
        manifest_data: Data to write (dict or list)
        output_path: Path to output file
        dry_run: If True, don't actually write
        verbose: If True, print progress messages

    Returns:
        True if successful, False otherwise
    """
    if verbose:
        print(f"  Writing {output_path.name}")

    if not dry_run:
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)

            with output_path.open("w", encoding="utf-8") as f:
                json.dump(manifest_data, f, indent=2, ensure_ascii=False)

            if verbose:
                entries = len(manifest_data) if isinstance(manifest_data, list) else "1"
                print(f"    ({entries} entries)")

            return True

        except Exception as e:
            if verbose:
                print(f"    Error writing {output_path}: {e}")
            return False
    else:
        if verbose:
            entries = len(manifest_data) if isinstance(manifest_data, list) else "1"
            print(f"    Would write ({entries} entries)")
        return True


def scan_and_build_manifests(
    config: Config,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, list[Any]]:
    """Scan music directory and build all manifest data structures.

    This is the main orchestration function that:
    1. Scans albums directory
    2. Extracts metadata from all MP3s
    3. Scans trackers directory
    4. Links trackers to MP3s
    5. Builds all manifest structures

    Args:
        config: Configuration instance
        dry_run: If True, don't write files
        verbose: If True, print progress

    Returns:
        Dict containing all manifest data:
        {
            "albums": [...],
            "tracks": [...],
            "trackers": [...],
            "unreleased": [...],
            "manifest": {...}
        }
    """
    albums_list: list[dict[str, Any]] = []
    tracks_list: list[dict[str, Any]] = []
    trackers_list: list[dict[str, Any]] = []
    unreleased_list: list[dict[str, Any]] = []

    # Track all MP3 stems for linking
    mp3_stems_to_album: dict[str, str] = {}
    mp3_stem_to_track_info: dict[str, dict[str, str]] = {}  # stem -> {track_id, track_name}

    if verbose:
        print("\nScanning file structure...")

    # === PHASE 1: Collect all files and build linkage mapping ===
    all_mp3_files: list[Path] = []
    all_tracker_files: list[Path] = []

    # Collect MP3 files
    if config.albums_dir.exists():
        all_mp3_files = get_file_list(config.albums_dir, extensions={".mp3"}, recursive=True)

    # Collect tracker files from primary locations
    # albums/{album}/tracker/ and albums/{album}/Extras/tracker/
    # Note: tracker/albums/{album}/ contains symlinks/copies to these same files
    # We only scan the primary location to avoid duplicates in the linkage
    for album_dir in config.albums_dir.iterdir() if config.albums_dir.exists() else []:
        if not album_dir.is_dir():
            continue

        # Collect from main tracker directory
        tracker_subdir = album_dir / "tracker"
        if tracker_subdir.exists():
            trackers_in_album = get_file_list(
                tracker_subdir, extensions=config.TRACKER_EXTS, recursive=True
            )
            all_tracker_files.extend(trackers_in_album)

        # Also collect from Extras/tracker directory
        extras_tracker_subdir = album_dir / "Extras" / "tracker"
        if extras_tracker_subdir.exists():
            extras_trackers = get_file_list(
                extras_tracker_subdir, extensions=config.TRACKER_EXTS, recursive=True
            )
            all_tracker_files.extend(extras_trackers)

    # Build tracker linkage mapping
    if verbose:
        print(f"  Found {len(all_mp3_files)} MP3 files, {len(all_tracker_files)} tracker files")
        print("  Building tracker linkage...")

    stem_to_trackers = build_tracker_linkage(all_mp3_files, all_tracker_files)

    if verbose:
        print(f"  Linked {len(stem_to_trackers)} track stems to tracker files")

    # === PHASE 2: Extract metadata with linkage ===
    if verbose:
        print("\nExtracting album metadata...")

    # Scan albums
    if config.albums_dir.exists():
        for album_dir in sorted(config.albums_dir.iterdir()):
            if not album_dir.is_dir():
                continue

            album_name = album_dir.name

            if verbose:
                print(f"  Processing album: {album_name}")

            # Sanitize album name for file lookups
            safe_album_name = url_safe_name(album_name)

            album_entry: dict[str, Any] = {
                "name": album_name,
                "tracks": [],
                "cover": None,
                "thumbnail": None,
            }

            # Find cover (using sanitized name)
            cover_path = find_cover_for_album(safe_album_name, config)
            if cover_path:
                album_entry["cover"] = f"{config.cdn_base}/covers/{quote(cover_path.name)}"

                # Check for thumbnail (using case-insensitive search)
                thumb_path = find_thumbnail_for_album(safe_album_name, config)
                if thumb_path:
                    album_entry["thumbnail"] = (
                        f"{config.cdn_base}/covers/{config.DIR_STRUCTURE['thumbs']}/"
                        f"{quote(thumb_path.name)}"
                    )
            else:
                # Use default cover if no album-specific cover found
                album_entry["cover"] = f"{config.cdn_base}/covers/default-cover.png"
                album_entry["thumbnail"] = f"{config.cdn_base}/covers/default-cover.png"

            # Scan MP3 files (including in subdirectories like Extras)
            mp3_files = get_file_list(album_dir, extensions={".mp3"}, recursive=True)

            # Store track metadata for album calculations
            track_metadata_list: list[dict[str, Any]] = []

            for mp3_file in mp3_files:
                # Calculate relative path within album directory
                relative_path = mp3_file.relative_to(album_dir)

                # Find linked trackers for this MP3
                linked_trackers = find_linked_trackers(mp3_file, stem_to_trackers)

                # Extract metadata with linked trackers
                metadata = extract_mp3_metadata(
                    mp3_file,
                    config,
                    album_name,
                    relative_path=relative_path,
                    linked_trackers=linked_trackers,
                )

                # Store metadata for album aggregate calculations
                track_metadata_list.append(metadata)

                # Build track entry
                track_entry: dict[str, Any] = {
                    "album": album_name,
                    "file_name": mp3_file.name,
                    "metadata": metadata,
                }

                tracks_list.append(track_entry)
                tracks_field = album_entry["tracks"]
                assert isinstance(tracks_field, list)
                tracks_field.append(metadata["complete_name"])

                # Track stem for linking and for tracker.json linked_master
                stem = normalize_stem(mp3_file.name)
                mp3_stems_to_album[stem] = album_name
                if "track_id" in metadata and "track_name" in metadata:
                    # Include mastered file info for tracker.json linked_master
                    mp3_stem_to_track_info[stem] = {
                        "track_id": metadata["track_id"],
                        "track_title": metadata["track_name"],  # Use track_title for consistency
                        "format": "mp3",
                        "cdn_url": metadata.get("cdn_url", ""),
                        "s3_url": metadata.get("s3_url", ""),
                    }

            # Store track metadata for album manifest calculations
            album_entry["track_metadata"] = track_metadata_list

            albums_list.append(album_entry)

    # Scan trackers
    if verbose:
        print("\nScanning trackers directory...")

    if config.trackers_dir.exists():
        # Get all tracker files recursively
        tracker_files = get_file_list(
            config.trackers_dir,
            extensions=config.TRACKER_EXTS,
            recursive=True,
        )

        for tracker_file in tracker_files:
            rel_path = tracker_file.relative_to(config.trackers_dir)
            parts = rel_path.parts

            if len(parts) < 1:
                continue

            # Determine category and album
            # Structure: tracker/albums/{album}/ or tracker/unreleased/
            is_unreleased_dir = parts[0] == "unreleased"
            is_albums_dir = parts[0] == "albums"

            if is_unreleased_dir:
                # Unreleased tracker: tracker/unreleased/{album}/ or tracker/unreleased/file
                if len(parts) == 2:
                    # Direct in unreleased/ (standalone)
                    album_name = "unreleased"
                    linked = False
                else:
                    # In unreleased/{album}/
                    album_name = parts[1]
                    linked = False
            elif is_albums_dir and len(parts) >= 2:
                # Regular album tracker: tracker/albums/{album}/
                album_name = parts[1]

                # Check if linked to an MP3
                stem = normalize_stem(tracker_file.name)
                linked = stem in mp3_stems_to_album
            else:
                # Unknown structure, skip
                continue

            # Get linked_master info if this tracker is linked
            linked_master = None
            if linked:
                stem = normalize_stem(tracker_file.name)
                if stem in mp3_stem_to_track_info:
                    linked_master = mp3_stem_to_track_info[stem]

            # Extract tracker metadata with relative path and linked_master
            metadata = extract_tracker_metadata(
                tracker_file,
                config,
                album_name=album_name if album_name != "unreleased" else None,
                linked=linked,
                relative_path=rel_path,
                linked_master=linked_master,
            )

            trackers_list.append(metadata)

            if not linked:
                unreleased_list.append(metadata)

    # Build master manifest
    manifest_data = build_master_manifest(
        albums_count=len(albums_list),
        tracks_count=len(tracks_list),
        tracker_count=len(trackers_list),
        unreleased_count=len(unreleased_list),
        album_names=[str(album["name"]) for album in albums_list],
        albums_list=albums_list,
        config=config,
    )

    result: dict[str, Any] = {
        "albums": build_albums_manifest(albums_list, config),
        "tracks": build_tracks_manifest(tracks_list),
        "trackers": build_tracker_manifest(trackers_list),
        "unreleased": build_unreleased_manifest(unreleased_list),
        "manifest": manifest_data,
    }
    return result


def check_manifest_changes(
    manifests: dict[str, Any],
    config: Config,
    verbose: bool = True,
) -> tuple[bool, dict[str, str]]:
    """Check if manifest files have changed compared to existing files.

    Args:
        manifests: Dict containing new manifest data
        config: Configuration instance
        verbose: If True, print progress

    Returns:
        Tuple of (has_changes: bool, existing_files: dict[filename, content])
    """
    import hashlib

    metadata_dir = config.metadata_dir
    manifest_files = [
        "albums.json",
        "tracks.json",
        "tracker.json",
        "unreleased.json",
        "manifest.json",
    ]

    existing_files: dict[str, str] = {}
    has_existing = metadata_dir.exists()

    if has_existing:
        if verbose:
            print("\nChecking for changes...")
        for filename in manifest_files:
            filepath = metadata_dir / filename
            if filepath.exists():
                with filepath.open("r", encoding="utf-8") as f:
                    existing_files[filename] = f.read()

    # Generate new manifest content as strings
    new_files = {
        "albums.json": json.dumps(manifests["albums"], indent=2, ensure_ascii=False),
        "tracks.json": json.dumps(manifests["tracks"], indent=2, ensure_ascii=False),
        "tracker.json": json.dumps(manifests["trackers"], indent=2, ensure_ascii=False),
        "unreleased.json": json.dumps(manifests["unreleased"], indent=2, ensure_ascii=False),
        "manifest.json": json.dumps(manifests["manifest"], indent=2, ensure_ascii=False),
    }

    # Compare hashes to detect changes
    has_changes = False
    if existing_files:
        for filename, new_content in new_files.items():
            if filename in existing_files:
                old_hash = hashlib.sha256(existing_files[filename].encode()).hexdigest()
                new_hash = hashlib.sha256(new_content.encode()).hexdigest()
                if old_hash != new_hash:
                    has_changes = True
                    if verbose:
                        print(f"  Changed: {filename}")
            else:
                has_changes = True
                if verbose:
                    print(f"  New: {filename}")
    else:
        has_changes = True
        if verbose:
            print("  No existing metadata found, will create new files")

    return has_changes, existing_files


def backup_existing_manifests(
    existing_files: dict[str, str],
    config: Config,
    dry_run: bool = False,
    verbose: bool = True,
) -> bool:
    """Create a timestamped backup zip of existing manifest files.

    Args:
        existing_files: Dict of filename -> content for existing files
        config: Configuration instance
        dry_run: If True, don't actually create backup
        verbose: If True, print progress

    Returns:
        True if backup successful
    """
    import zipfile

    if not existing_files:
        return True

    metadata_dir = config.metadata_dir
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_zip = metadata_dir / f"backup_{timestamp}.zip"

    if verbose:
        print(f"\nCreating backup: {backup_zip.name}")

    if not dry_run:
        try:
            with zipfile.ZipFile(backup_zip, "w", zipfile.ZIP_DEFLATED) as zipf:
                for filename in existing_files:
                    filepath = metadata_dir / filename
                    if filepath.exists():
                        zipf.write(filepath, filename)

            if verbose:
                print(f"  Backed up {len(existing_files)} files")
            return True

        except Exception as e:
            if verbose:
                print(f"  Error creating backup: {e}")
            return False
    else:
        if verbose:
            print(f"  Would backup {len(existing_files)} files")
        return True


def write_all_manifests(
    manifests: dict[str, Any],
    config: Config,
    dry_run: bool = False,
    verbose: bool = True,
    check_changes: bool = True,
) -> bool:
    """Write all manifest files to metadata directory.

    Args:
        manifests: Dict containing all manifest data
        config: Configuration instance
        dry_run: If True, don't actually write
        verbose: If True, print progress
        check_changes: If True, check for changes and backup before writing

    Returns:
        True if all writes successful
    """
    # Check for changes if requested
    if check_changes:
        has_changes, existing_files = check_manifest_changes(manifests, config, verbose)

        if not has_changes:
            if verbose:
                print("\n✓ No changes detected, skipping metadata generation")
            return True

        # Backup existing files if changes detected
        if (
            existing_files
            and not backup_existing_manifests(existing_files, config, dry_run, verbose)
            and verbose
        ):
            print("Warning: Backup failed, but continuing with write")

    if verbose:
        print("\nWriting manifest files...")

    metadata_dir = config.metadata_dir

    # Write data files first (albums, tracks, tracker, unreleased)
    data_files = {
        "albums.json": manifests["albums"],
        "tracks.json": manifests["tracks"],
        "tracker.json": manifests["trackers"],
        "unreleased.json": manifests["unreleased"],
    }

    success = True

    for filename, data in data_files.items():
        output_path = metadata_dir / filename
        if not write_manifest_file(data, output_path, dry_run=dry_run, verbose=verbose):
            success = False

    # Compute checksums for integrity verification (after writing data files)
    if not dry_run and success:
        checksums = compute_file_checksums(metadata_dir)
        if checksums and verbose:
            print(f"  Computed {len(checksums)} file checksums for integrity verification")

        # Add integrity section to manifest
        manifest_data = manifests["manifest"].copy()
        manifest_data["integrity"] = {
            "hash_type": "sha256",
            "checksums": checksums,
        }
    else:
        manifest_data = manifests["manifest"]

    # Write manifest.json last (with integrity checksums)
    manifest_path = metadata_dir / "manifest.json"
    if not write_manifest_file(manifest_data, manifest_path, dry_run=dry_run, verbose=verbose):
        success = False

    return success
