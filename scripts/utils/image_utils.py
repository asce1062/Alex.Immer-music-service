"""Image utility functions for cover art and thumbnail processing.

Handles cover art extraction from MP3 files and thumbnail generation.
"""

from pathlib import Path
from typing import Any, Protocol

from mutagen.id3 import ID3
from mutagen.id3._frames import APIC
from PIL import Image

from .config import Config
from .file_utils import url_safe_name


class APICLike(Protocol):
    """Protocol for APIC frame attributes (mutagen type stub workaround)."""

    data: bytes
    mime: str
    desc: str


def find_cover_for_album(
    album_name: str,
    config: Config,
) -> Path | None:
    """Find cover image for an album.

    Searches for cover files in the following order:
    1. {album_name}.png
    2. {album_name}.jpg
    3. {album_name}.jpeg

    Falls back to case-insensitive search if exact match not found.

    Args:
        album_name: URL-safe album name
        config: Configuration instance

    Returns:
        Path to cover file if found, None otherwise
    """
    covers_dir = config.covers_dir

    if not covers_dir.exists():
        return None

    # First try exact match (Prefer PNG, then JPG)
    for ext in [".png", ".jpg", ".jpeg"]:
        cover_path = covers_dir / f"{album_name}{ext}"
        if cover_path.exists():
            return cover_path

    # Fall back to case-insensitive search
    album_name_lower = album_name.lower()
    for file_path in covers_dir.iterdir():
        if (
            file_path.is_file()
            and file_path.stem.lower() == album_name_lower
            and file_path.suffix.lower() in [".png", ".jpg", ".jpeg"]
        ):
            return file_path

    return None


def find_thumbnail_for_album(
    album_name: str,
    config: Config,
) -> Path | None:
    """Find thumbnail image for an album.

    Searches for thumbnail files in the thumbs directory with case-insensitive matching.

    Args:
        album_name: URL-safe album name
        config: Configuration instance

    Returns:
        Path to thumbnail file if found, None otherwise
    """
    thumbs_dir = config.thumbs_dir

    if not thumbs_dir.exists():
        return None

    # First try exact match
    for ext in [".png", ".jpg", ".jpeg"]:
        thumb_path = thumbs_dir / f"{album_name}{ext}"
        if thumb_path.exists():
            return thumb_path

    # Fall back to case-insensitive search
    album_name_lower = album_name.lower()
    for file_path in thumbs_dir.iterdir():
        if (
            file_path.is_file()
            and file_path.stem.lower() == album_name_lower
            and file_path.suffix.lower() in [".png", ".jpg", ".jpeg"]
        ):
            return file_path

    return None


def extract_embedded_cover(
    mp3_path: Path,
    output_path: Path,
    dry_run: bool = False,
    verbose: bool = True,
) -> Path | None:
    """Extract embedded cover art from MP3 file and save to disk.

    Only extracts if output_path doesn't already exist.

    Args:
        mp3_path: Path to MP3 file
        output_path: Where to save extracted cover
        dry_run: If True, only simulate extraction
        verbose: If True, print progress messages

    Returns:
        Path to extracted/existing cover if successful, None otherwise
    """
    if output_path.exists():
        return output_path

    try:
        tags = ID3(mp3_path)
    except Exception as e:
        if verbose:
            print(f"    Warning: Could not read ID3 tags from {mp3_path.name}: {e}")
        return None

    # Find APIC frames (embedded pictures)
    apic_frames = [v for _k, v in tags.items() if isinstance(v, APIC)]

    if not apic_frames:
        return None

    # Type cast for better type checking (mutagen stubs incomplete)
    apic: APICLike = apic_frames[0]  # type: ignore[assignment]

    if verbose:
        mime = apic.mime
        size_kb = len(apic.data) / 1024
        print(f"    Extracting cover from {mp3_path.name} ({mime}, {size_kb:.1f} KB)")

    if not dry_run:
        try:
            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)

            with output_path.open("wb") as f:
                f.write(apic.data)

            if verbose:
                print(f"    Saved to {output_path.name}")

            return output_path
        except Exception as e:
            if verbose:
                print(f"    Error writing cover to {output_path}: {e}")
            return None
    else:
        if verbose:
            print(f"    Would save to {output_path.name}")
        return output_path


def generate_thumbnail(
    source_image: Path,
    output_path: Path,
    size: tuple[int, int] = (400, 400),
    format: str = "png",
    quality: int = 85,
    dry_run: bool = False,
    verbose: bool = True,
) -> Path | None:
    """Generate a thumbnail from a source image.

    Args:
        source_image: Path to source image
        output_path: Where to save thumbnail
        size: Thumbnail dimensions (width, height)
        format: Output format ('png' or 'jpg')
        quality: JPEG quality (1-100, only for JPG format)
        dry_run: If True, only simulate generation
        verbose: If True, print progress messages

    Returns:
        Path to generated thumbnail if successful, None otherwise
    """
    if not source_image.exists():
        if verbose:
            print(f"    Warning: Source image {source_image} does not exist")
        return None

    if output_path.exists():
        return output_path

    if verbose:
        fmt_str = format.upper()
        print(f"    Generating {size[0]}x{size[1]} {fmt_str} thumbnail: {output_path.name}")

    if not dry_run:
        try:
            # Ensure output directory exists
            output_path.parent.mkdir(parents=True, exist_ok=True)

            with Image.open(source_image) as img:
                # Convert to RGB if needed (handles RGBA, P, etc.)
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")

                # Create thumbnail (preserves aspect ratio)
                img.thumbnail(size, Image.Resampling.LANCZOS)

                # Save based on format
                if format.lower() == "png":
                    img.save(
                        output_path,
                        "PNG",
                        optimize=True,
                    )
                else:  # jpg/jpeg
                    img.save(
                        output_path,
                        "JPEG",
                        quality=quality,
                        optimize=True,
                        progressive=True,
                    )

            if verbose:
                size_kb = output_path.stat().st_size / 1024
                print(f"    Created ({size_kb:.1f} KB)")

            return output_path

        except Exception as e:
            if verbose:
                print(f"    Error generating thumbnail: {e}")
            return None
    else:
        if verbose:
            print(f"    Would create {output_path.name}")
        return output_path


def extract_or_find_cover(
    album_name: str,
    album_dir: Path,
    config: Config,
    dry_run: bool = False,
    verbose: bool = True,
) -> Path | None:
    """Find existing cover or extract from first MP3 with embedded art.

    Process:
    1. Sanitize album name to match url_safe_name format
    2. Check if cover already exists in covers directory
    3. If not, scan MP3s in album directory for embedded art
    4. Extract first found embedded art to covers directory with sanitized name

    Args:
        album_name: Original album name (will be sanitized)
        album_dir: Path to album directory
        config: Configuration instance
        dry_run: If True, only simulate operations
        verbose: If True, print progress messages

    Returns:
        Path to cover file if found/extracted, None otherwise
    """
    # Sanitize album name to match file naming convention
    # e.g., "Godom & Sodorrah" -> "Godom-and-Sodorrah"
    safe_album_name = url_safe_name(album_name)

    # First check if cover already exists
    existing_cover = find_cover_for_album(safe_album_name, config)
    if existing_cover:
        if verbose:
            print(f"    Using existing cover: {existing_cover.name}")
        return existing_cover

    # Try to extract from MP3s in album directory
    mp3_files = sorted(album_dir.glob("*.mp3"))

    for mp3_file in mp3_files:
        # Determine output format based on embedded image
        try:
            tags = ID3(mp3_file)
            apic_frames = [v for _k, v in tags.items() if isinstance(v, APIC)]

            if apic_frames:
                apic = apic_frames[0]
                mime = getattr(apic, "mime", "image/jpeg")

                # Determine extension from MIME type
                ext = ".png" if "png" in mime.lower() else ".jpg"

                # Use sanitized album name for output
                output_path = config.covers_dir / f"{safe_album_name}{ext}"

                result = extract_embedded_cover(
                    mp3_file,
                    output_path,
                    dry_run=dry_run,
                    verbose=verbose,
                )

                if result:
                    return result
        except Exception:  # nosec B112 - intentionally continue on failure to try next pattern
            continue

    return None


def process_album_covers(
    album_name: str,
    album_dir: Path,
    config: Config,
    with_thumbs: bool = False,
    thumb_format: str = "png",
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, Any]:
    """Process cover art for an album: find/extract cover and generate thumbnail.

    Args:
        album_name: Original album name (will be sanitized)
        album_dir: Path to album directory
        config: Configuration instance
        with_thumbs: If True, generate thumbnails
        thumb_format: Thumbnail format ('png' or 'jpg')
        dry_run: If True, only simulate operations
        verbose: If True, print progress messages

    Returns:
        Dict with paths: {"cover": Path|None, "thumbnail": Path|None}
    """
    result: dict[str, Path | None] = {"cover": None, "thumbnail": None}

    # Sanitize album name for consistent file naming
    safe_album_name = url_safe_name(album_name)

    # Find or extract cover
    cover_path = extract_or_find_cover(
        album_name,
        album_dir,
        config,
        dry_run=dry_run,
        verbose=verbose,
    )

    if cover_path:
        result["cover"] = cover_path

        # Generate thumbnail if requested
        if with_thumbs:
            # Use sanitized name for thumbnail filename
            # e.g., "Godom & Sodorrah" -> "Godom-and-Sodorrah.png"
            thumb_name = f"{safe_album_name}.{thumb_format}"
            thumb_path = config.thumbs_dir / thumb_name

            thumbnail = generate_thumbnail(
                cover_path,
                thumb_path,
                size=config.thumbnail_size,
                format=thumb_format,
                quality=config.thumbnail_quality,
                dry_run=dry_run,
                verbose=verbose,
            )

            if thumbnail:
                result["thumbnail"] = thumbnail

    return result
