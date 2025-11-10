r"""Tracker file format parser for metadata extraction.

Extracts format-specific metadata from tracker modules for v3 manifest generation:
- XM (Extended Module / FastTracker II)
- IT (Impulse Tracker)
- MOD (ProTracker Module)
- S3M (ScreamTracker 3)
- MPTM (OpenMPT Module)
- FTM (FamiTracker)
- NSF (NES Sound Format)

Metadata v3 Schema Fields:
- source_format_version: Detected tracker format version
- tracker_tools: List of tracker software used (e.g., FastTracker II, OpenMPT)
- channels: Number of audio channels
- patterns: Number of patterns in module
- instruments/samples: Number of instruments or samples
- song_name: Original module song name
- checksum: SHA256 integrity verification
- content_length: File size for HTTP range requests
- last_modified: ISO 8601 timestamp
- accept_ranges: HTTP range support ("bytes")
- etag: MD5-based cache validation
- explicit: Content rating boolean

Format References:
- XM format: http://www.celersms.com/doc/xm_format.html
- IT format: http://www.textfiles.com/programming/FORMATS/it-form.txt
- MOD format: http://www.aes.id.au/modformat.html
- S3M format: http://www.textfiles.com/programming/FORMATS/s3m-form.txt
- MPTM format: https://wiki.openmpt.org/Manual:_Module_formats
  * OpenMPT Module format (IT-compatible extension)
  * Uses IMPM signature with OpenMPT-specific extensions
- FTM format: http://famitracker.com/wiki/index.php?title=Famitracker_file_format
  * FamiTracker module format for NES/Famicom audio
  * Text-based format with binary data sections
- NSF format: https://wiki.nesdev.com/w/index.php/NSF
  * NES Sound Format (NESM\x1a signature)
  * Contains NES audio data and metadata (song name, artist, copyright)

Signature-Based Detection:
This module implements signature-based format detection by reading file headers,
which is more reliable than extension-based detection. This handles cases where
files have incorrect extensions (e.g., .xm files that are actually S3M format).
"""

import struct
from pathlib import Path
from typing import Any


def parse_xm_header(file_path: Path) -> dict[str, Any] | None:
    """Parse XM (Extended Module) file header.

    Args:
        file_path: Path to .xm file

    Returns:
        Dict with XM metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # Read header
            header = f.read(80)

            # Check signature
            if not header.startswith(b"Extended Module: "):
                return None

            # Extract module name (17-37 bytes, null-terminated)
            module_name = header[17:37].split(b"\x00")[0].decode("ascii", errors="ignore").strip()

            # Skip to version info (38 bytes)
            f.seek(38)
            version_bytes = f.read(2)
            version = struct.unpack("<H", version_bytes)[0]
            version_str = f"{(version >> 8)}.{(version & 0xFF):02d}"

            # Read header size (skip, not needed for metadata extraction)
            f.read(4)

            # Read pattern data
            f.seek(60)
            pattern_data = f.read(8)

            song_length = struct.unpack("<H", pattern_data[0:2])[0]
            # restart_position not used in metadata
            num_channels = struct.unpack("<H", pattern_data[4:6])[0]
            num_patterns = struct.unpack("<H", pattern_data[6:8])[0]

            # Read instrument count
            num_instruments_bytes = f.read(2)
            num_instruments = struct.unpack("<H", num_instruments_bytes)[0]

            # Read flags
            flags_bytes = f.read(2)
            flags = struct.unpack("<H", flags_bytes)[0]
            linear_frequency = bool(flags & 1)

            # Read tempo/BPM
            tempo_bytes = f.read(2)
            bpm_bytes = f.read(2)
            default_tempo = struct.unpack("<H", tempo_bytes)[0]
            default_bpm = struct.unpack("<H", bpm_bytes)[0]

            # Detect tracker tool from module name or default to FastTracker II
            tracker_tool = "FastTracker II"
            if "openmpt" in module_name.lower():
                tracker_tool = "OpenMPT"
            elif "milkytracker" in module_name.lower():
                tracker_tool = "MilkyTracker"
            elif "modplug" in module_name.lower():
                tracker_tool = "ModPlug Tracker"

            return {
                "format": "xm",
                "format_long": "Extended Module",
                "source_format_version": version_str,
                "tracker_tools": [tracker_tool],
                "module_name": module_name if module_name else None,
                "channels": num_channels,
                "patterns": num_patterns,
                "instruments": num_instruments,
                "song_length": song_length,
                "default_tempo": default_tempo,
                "default_bpm": default_bpm,
                "linear_frequency": linear_frequency,
            }

    except Exception as e:
        print(f"    Warning: Failed to parse XM header for {file_path}: {e}")
        return None


def parse_it_header(file_path: Path) -> dict[str, Any] | None:
    """Parse IT (Impulse Tracker) file header.

    Args:
        file_path: Path to .it file

    Returns:
        Dict with IT metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # Read header
            header = f.read(192)

            # Check signature (IMPM)
            if not header.startswith(b"IMPM"):
                return None

            # Song name (4-30 bytes, null-terminated)
            song_name = header[4:30].split(b"\x00")[0].decode("ascii", errors="ignore").strip()

            # Pattern highlight (skip, not used)

            # Order count, instrument count, sample count, pattern count
            ord_num = struct.unpack("<H", header[32:34])[0]
            ins_num = struct.unpack("<H", header[34:36])[0]
            smp_num = struct.unpack("<H", header[36:38])[0]
            pat_num = struct.unpack("<H", header[38:40])[0]

            # Tracker version (40-42)
            version = struct.unpack("<H", header[40:42])[0]
            version_str = f"{(version >> 8)}.{(version & 0xFF):02x}"

            # Compatible version (skip, not used)

            # Flags (skip, not used in metadata)

            # Special flags (skip, not used)

            # Global volume, mix volume, initial speed, initial tempo
            global_volume = header[48]
            # mix_volume not used in metadata
            initial_speed = header[50]
            initial_tempo = header[51]

            # Channel count (embedded in flags or explicit)
            # IT doesn't explicitly store channel count, we estimate from pattern data
            # For now, use a default or parse pattern data (complex)
            channels = 64  # IT supports up to 64 channels

            return {
                "format": "it",
                "format_long": "Impulse Tracker",
                "source_format_version": version_str,
                "tracker_tools": ["Impulse Tracker"],
                "song_name": song_name if song_name else None,
                "channels": channels,
                "patterns": pat_num,
                "instruments": ins_num,
                "samples": smp_num,
                "orders": ord_num,
                "initial_speed": initial_speed,
                "initial_tempo": initial_tempo,
                "global_volume": global_volume,
            }

    except Exception as e:
        print(f"    Warning: Failed to parse IT header for {file_path}: {e}")
        return None


def parse_mod_header(file_path: Path) -> dict[str, Any] | None:
    """Parse MOD (ProTracker Module) file header.

    Args:
        file_path: Path to .mod file

    Returns:
        Dict with MOD metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # Read header
            header = f.read(1084)

            # Song name (0-19 bytes, null-terminated)
            song_name = header[0:20].split(b"\x00")[0].decode("ascii", errors="ignore").strip()

            # Read format tag (1080-1083)
            format_tag = header[1080:1084].decode("ascii", errors="ignore")

            # Determine channel count and tracker type from format tag
            channels = 4  # Default ProTracker
            tracker_tool = "ProTracker"

            if format_tag in ["M.K.", "M!K!", "FLT4"]:
                channels = 4
            elif format_tag == "6CHN":
                channels = 6
            elif format_tag == "8CHN":
                channels = 8
            elif format_tag.endswith("CHN"):
                try:
                    channels = int(format_tag[0])
                except ValueError:
                    channels = 4

            # Count patterns (952 bytes offset, song length)
            song_length = header[950]

            # Count samples (31 samples in standard MOD)
            num_samples = 31

            # Read pattern order list (952-1079)
            pattern_order = list(header[952:1080])
            max_pattern = max(pattern_order[:song_length]) if song_length > 0 else 0
            num_patterns = max_pattern + 1

            return {
                "format": "mod",
                "format_long": "ProTracker Module",
                "source_format_version": "1.0",
                "tracker_tools": [tracker_tool],
                "song_name": song_name if song_name else None,
                "channels": channels,
                "patterns": num_patterns,
                "samples": num_samples,
                "song_length": song_length,
                "format_tag": format_tag,
            }

    except Exception as e:
        print(f"    Warning: Failed to parse MOD header for {file_path}: {e}")
        return None


def parse_s3m_header(file_path: Path) -> dict[str, Any] | None:
    """Parse S3M (ScreamTracker 3) file header.

    Args:
        file_path: Path to .s3m file

    Returns:
        Dict with S3M metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # Read header
            header = f.read(96)

            # Song name (0-27 bytes, null-terminated)
            song_name = header[0:28].split(b"\x00")[0].decode("ascii", errors="ignore").strip()

            # Check signature (0x1A at offset 28)
            if header[28] != 0x1A:
                return None

            # Type (skip, not used)

            # Order count
            ord_num = struct.unpack("<H", header[32:34])[0]

            # Instrument count
            ins_num = struct.unpack("<H", header[34:36])[0]

            # Pattern count
            pat_num = struct.unpack("<H", header[36:38])[0]

            # Flags (skip, not used)

            # Tracker version
            version = struct.unpack("<H", header[40:42])[0]
            version_str = f"{(version >> 12)}.{(version & 0xFFF):02x}"

            # Sample type (skip, not used)

            # Check SCRM signature (44-47)
            scrm_sig = header[44:48]
            if scrm_sig != b"SCRM":
                return None

            # Global volume, initial speed, initial tempo
            global_volume = header[48]
            initial_speed = header[49]
            initial_tempo = header[50]

            # Master volume (skip, not used in metadata)

            # Channel settings (64-95) - determine active channels
            channel_settings = header[64:96]
            channels = sum(1 for c in channel_settings if c != 0xFF and c < 32)

            return {
                "format": "s3m",
                "format_long": "ScreamTracker 3",
                "source_format_version": version_str,
                "tracker_tools": ["ScreamTracker 3"],
                "song_name": song_name if song_name else None,
                "channels": channels,
                "patterns": pat_num,
                "instruments": ins_num,
                "orders": ord_num,
                "initial_speed": initial_speed,
                "initial_tempo": initial_tempo,
                "global_volume": global_volume,
            }

    except Exception as e:
        print(f"    Warning: Failed to parse S3M header for {file_path}: {e}")
        return None


def parse_mptm_header(file_path: Path) -> dict[str, Any] | None:
    """Parse MPTM (OpenMPT Module) file header.

    MPTM is OpenMPT's native format, based on IT format with extensions.

    Args:
        file_path: Path to .mptm file

    Returns:
        Dict with MPTM metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # Read header (MPTM uses IT-like header structure)
            header = f.read(192)

            # Check for MPTM or IT signature
            if not (header.startswith(b"IMPM") or header.startswith(b"mptm")):
                return None

            # Song name (4-30 bytes for IT-compatible, varies for MPTM)
            song_name_end = 30
            if header.startswith(b"mptm"):
                song_name_end = 32

            song_name = (
                header[4:song_name_end].split(b"\x00")[0].decode("ascii", errors="ignore").strip()
            )

            # Try to extract version info
            # MPTM stores OpenMPT version differently than IT
            version_str = "1.28+"  # Default for MPTM files (introduced in 1.28)

            # For IT-compatible MPTM files, read version from header
            if header.startswith(b"IMPM"):
                version = struct.unpack("<H", header[40:42])[0]
                # Check if it's actually an MPTM file (IT version 0x0220+ with MPTM extensions)
                if version >= 0x0220:
                    version_str = "1.28+ (IT compatible)"

            # Order count, instrument count, sample count, pattern count
            ord_num = struct.unpack("<H", header[32:34])[0]
            ins_num = struct.unpack("<H", header[34:36])[0]
            smp_num = struct.unpack("<H", header[36:38])[0]
            pat_num = struct.unpack("<H", header[38:40])[0]

            # Initial speed, initial tempo
            initial_speed = header[50] if len(header) > 50 else 6
            initial_tempo = header[51] if len(header) > 51 else 125

            # Global volume
            global_volume = header[48] if len(header) > 48 else 64

            # Channel settings - MPTM supports up to 127 channels
            channel_settings = header[64:96] if len(header) >= 96 else []
            channels = sum(1 for c in channel_settings if c != 0xFF and c < 128)

            return {
                "format": "mptm",
                "format_long": "OpenMPT Module",
                "source_format_version": version_str,
                "tracker_tools": ["OpenMPT"],
                "song_name": song_name if song_name else None,
                "channels": channels if channels > 0 else 64,  # Default to 64 if detection fails
                "patterns": pat_num,
                "instruments": ins_num,
                "samples": smp_num,
                "orders": ord_num,
                "initial_speed": initial_speed,
                "initial_tempo": initial_tempo,
                "global_volume": global_volume,
            }

    except Exception as e:
        print(f"    Warning: Failed to parse MPTM header for {file_path}: {e}")
        return None


def parse_ftm_header(file_path: Path) -> dict[str, Any] | None:
    """Parse FTM (FamiTracker) file header.

    Args:
        file_path: Path to .ftm file

    Returns:
        Dict with FTM metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # FTM files are text-based with binary data
            # Check for FamiTracker signature
            header = f.read(100)

            if b"FamiTracker" not in header and b"FTM" not in header:
                return None

            # Try to extract version from header
            version_str = "unknown"
            if b"FamiTracker Module" in header:
                # Format: "FamiTracker Module\r\n"
                version_str = "0.4.x+"

            return {
                "format": "ftm",
                "format_long": "FamiTracker Module",
                "source_format_version": version_str,
                "tracker_tools": ["FamiTracker"],
            }

    except Exception as e:
        print(f"    Warning: Failed to parse FTM header for {file_path}: {e}")
        return None


def parse_nsf_header(file_path: Path) -> dict[str, Any] | None:
    """Parse NSF (NES Sound Format) file header.

    Args:
        file_path: Path to .nsf file

    Returns:
        Dict with NSF metadata or None if parsing fails
    """
    try:
        with file_path.open("rb") as f:
            # Read NSF header (128 bytes)
            header = f.read(128)

            # Check signature (NESM\x1A or NSFE)
            if not (header.startswith(b"NESM\x1a") or header.startswith(b"NSFE")):
                return None

            # Version
            version = header[5]

            # Song count
            total_songs = header[6]

            # Starting song
            starting_song = header[7]

            # Song name (32 bytes at offset 14)
            song_name = header[14:46].split(b"\x00")[0].decode("ascii", errors="ignore").strip()

            # Artist (32 bytes at offset 46)
            artist = header[46:78].split(b"\x00")[0].decode("ascii", errors="ignore").strip()

            # Copyright (32 bytes at offset 78)
            copyright_text = (
                header[78:110].split(b"\x00")[0].decode("ascii", errors="ignore").strip()
            )

            return {
                "format": "nsf",
                "format_long": "NES Sound Format",
                "source_format_version": f"v{version}",
                "tracker_tools": ["Various NES composers"],
                "song_name": song_name if song_name else None,
                "artist": artist if artist else None,
                "copyright": copyright_text if copyright_text else None,
                "total_songs": total_songs,
                "starting_song": starting_song,
            }

    except Exception as e:
        print(f"    Warning: Failed to parse NSF header for {file_path}: {e}")
        return None


def detect_format_by_signature(tracker_path: Path) -> str | None:
    """Detect tracker format by reading file signature.

    This is more reliable than extension-based detection, especially for
    misnamed files.

    Args:
        tracker_path: Path to tracker file

    Returns:
        Detected format string or None if unknown
    """
    try:
        with tracker_path.open("rb") as f:
            # Read first 1084 bytes for signature detection (MOD needs 1080-1084)
            header = f.read(1084)

            # Check signatures (order matters - check most specific first)
            if header.startswith(b"Extended Module: "):
                return "xm"
            elif header.startswith(b"IMPM"):
                # Could be IT or MPTM
                # MPTM uses IT-compatible header
                return "it"  # Will be handled by parse_it/parse_mptm
            elif len(header) >= 48 and header[44:48] == b"SCRM" and header[28] == 0x1A:
                # S3M signature at specific offset
                return "s3m"
            elif len(header) >= 1084 and header[1080:1084] in [
                b"M.K.",
                b"M!K.",
                b"FLT4",
                b"6CHN",
                b"8CHN",
            ]:
                return "mod"
            elif b"FamiTracker" in header or b"FTM" in header:
                return "ftm"
            elif header.startswith(b"NESM\x1a") or header.startswith(b"NSFE"):
                return "nsf"

    except Exception:  # nosec B110
        # Intentionally suppress all exceptions for graceful format detection failure
        # (file not found, permission denied, corrupted binary, etc.)
        pass

    return None


def extract_tracker_format_metadata(tracker_path: Path) -> dict[str, Any]:
    """Extract format-specific metadata from a tracker file.

    Detects format by file signature first, then falls back to extension.

    Args:
        tracker_path: Path to tracker file

    Returns:
        Dict with tracker format metadata, or minimal dict if parsing fails
    """
    ext = tracker_path.suffix.lower().lstrip(".")

    # Map of format parsers
    parsers = {
        "xm": parse_xm_header,
        "it": parse_it_header,
        "mod": parse_mod_header,
        "s3m": parse_s3m_header,
        "mptm": parse_mptm_header,
        "ftm": parse_ftm_header,
        "nsf": parse_nsf_header,
    }

    # Try to detect format by signature first (more reliable)
    detected_format = detect_format_by_signature(tracker_path)
    if detected_format and detected_format in parsers:
        metadata = parsers[detected_format](tracker_path)
        if metadata:
            # Add note if extension doesn't match actual format
            if detected_format != ext:
                metadata["_note"] = (
                    f"File has .{ext} extension but is actually {detected_format.upper()} format"
                )
            return metadata

    # Fall back to extension-based detection
    if ext in parsers:
        metadata = parsers[ext](tracker_path)
        if metadata:
            return metadata

    # Fallback - return minimal metadata based on extension
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

    return {
        "format": ext,
        "format_long": format_names.get(ext, "Tracker Module"),
        "source_format_version": "unknown",
        "tracker_tools": ["Unknown"],
    }


def get_tracker_playback_info(format_metadata: dict[str, Any]) -> dict[str, Any]:
    """Get playback-specific information for tracker files.

    Args:
        format_metadata: Metadata from extract_tracker_format_metadata()

    Returns:
        Dict with playback information
    """
    playback_info = {
        "requires_player": True,
        "browser_playback": False,
        "recommended_players": [],
    }

    fmt = format_metadata.get("format", "")

    # Recommended players by format
    player_map = {
        "xm": ["OpenMPT", "MilkyTracker", "libopenmpt (web)"],
        "it": ["OpenMPT", "Schism Tracker", "libopenmpt (web)"],
        "mod": ["OpenMPT", "MilkyTracker", "ProTracker", "libopenmpt (web)"],
        "s3m": ["OpenMPT", "libopenmpt (web)"],
        "ftm": ["FamiTracker", "0CC-FamiTracker"],
        "nsf": ["NSFPlay", "VLC (with plugin)"],
    }

    playback_info["recommended_players"] = player_map.get(fmt, ["OpenMPT", "VLC"])

    # Check if browser playback available (libopenmpt.js supports XM, IT, MOD, S3M)
    if fmt in ["xm", "it", "mod", "s3m", "mptm"]:
        playback_info["browser_playback"] = True

    return playback_info
