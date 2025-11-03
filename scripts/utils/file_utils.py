"""File utility functions for music sync operations.

Handles filename sanitization, system file removal, and directory traversal.
"""

import fnmatch
import re
from pathlib import Path
from typing import Any

from .config import Config


def url_safe_name(name: str) -> str:
    """Convert a filename to a URL-safe format.

    Rules:
    - Keep track number prefix with dot (e.g., "01.", "02.")
    - Remove all special characters: ()[]{}!?,'"`
    - Convert & to "-and-"
    - Remove all mid-name dots (except after track numbers and before extension)
    - Convert spaces to dashes
    - Remove multiple consecutive dashes
    - Keep original case (no lowercasing)
    - Strip leading/trailing dashes and dots

    Args:
        name: Original filename or directory name

    Returns:
        URL-safe name

    Examples:
        >>> url_safe_name("09.Timtris. (Looped).mp3")
        '09.Timtris-Looped.mp3'
        >>> url_safe_name("It's Alright!.mp3")
        'Its-Alright.mp3'
        >>> url_safe_name("Que Sera, Sera..mp3")
        'Que-Sera-Sera.mp3'
        >>> url_safe_name("Godom & Sodorrah")
        'Godom-and-Sodorrah'
        >>> url_safe_name("Love. (Demo).mod")
        'Love-Demo.mod'
    """
    if not name:
        return "unnamed"

    name = name.strip()

    # Separate filename and extension
    if "." in name:
        parts = name.rsplit(".", 1)
        if len(parts) == 2 and len(parts[1]) <= 5:  # Likely an extension
            base_name = parts[0]
            extension = parts[1]
        else:
            base_name = name
            extension = ""
    else:
        base_name = name
        extension = ""

    # Check if it starts with a track number (e.g., "01.", "02.", "123.")
    track_number = ""
    track_match = re.match(r"^(\d+)\.", base_name)
    if track_match:
        track_number = track_match.group(1) + "."
        base_name = base_name[len(track_number) :]

    # Convert & to "-and-"
    base_name = re.sub(r"\s*&\s*", "-and-", base_name)

    # Replace slashes with dashes
    base_name = re.sub(r"[\/\\]+", "-", base_name)

    # Remove all special characters and parentheses/brackets
    # Keep only: alphanumeric, spaces, dots, dashes, underscores
    base_name = re.sub(r"[^\w\s.\-]", "", base_name)

    # Remove all dots (they'll be re-added only for extension)
    base_name = base_name.replace(".", "")

    # Replace whitespace runs with single dash
    base_name = re.sub(r"\s+", "-", base_name)

    # Collapse multiple dashes into one
    base_name = re.sub(r"-{2,}", "-", base_name)

    # Remove leading/trailing dashes
    base_name = base_name.strip("-")

    # Reconstruct the filename
    if not base_name:
        base_name = "unnamed"

    result = track_number + base_name

    if extension:
        result += "." + extension

    return result


def sanitize_directory(
    root: Path,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    """Recursively sanitize filenames and directory names to URL-safe format.

    Processes directories bottom-up to avoid path confusion.

    Args:
        root: Root directory to sanitize
        dry_run: If True, only preview changes without executing
        verbose: If True, print progress messages

    Returns:
        Dict with statistics: {"renamed": count, "skipped": count, "errors": count}
    """
    stats = {"renamed": 0, "skipped": 0, "errors": 0}

    if not root.exists():
        if verbose:
            print(f"Warning: Directory {root} does not exist")
        return stats

    # Collect all paths, sorted by depth (deepest first)
    all_paths = sorted(root.rglob("*"), key=lambda x: len(x.parts), reverse=True)

    for path in all_paths:
        # Skip system files
        if path.name.startswith(".") or path.name in Config.IGNORE_FILES:
            continue

        safe_name = url_safe_name(path.name)

        if safe_name != path.name:
            new_path = path.with_name(safe_name)

            if verbose:
                rel_old = path.relative_to(root)
                rel_new = new_path.relative_to(root)
                print(f"  Rename: {rel_old} -> {rel_new}")

            if not dry_run:
                try:
                    # Handle name collisions
                    if new_path.exists():
                        base = new_path.stem
                        suffix = new_path.suffix
                        counter = 1
                        while new_path.exists():
                            new_path = new_path.with_name(f"{base}-{counter}{suffix}")
                            counter += 1

                    path.rename(new_path)
                    stats["renamed"] += 1
                except Exception as e:
                    if verbose:
                        print(f"    Error renaming {path}: {e}")
                    stats["errors"] += 1
            else:
                stats["renamed"] += 1
        else:
            stats["skipped"] += 1

    return stats


def remove_system_files(
    root: Path,
    dry_run: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    """Remove system files and unwanted album art files.

    Removes:
    - .DS_Store, Thumbs.db, desktop.ini
    - Folder.jpg, AlbumArtSmall.jpg
    - AlbumArt_*_Large.jpg, AlbumArt_*_Small.jpg (pattern matching)

    Args:
        root: Root directory to clean
        dry_run: If True, only preview deletions
        verbose: If True, print progress messages

    Returns:
        Dict with statistics: {"removed": count, "errors": count}
    """
    stats = {"removed": 0, "errors": 0}

    if not root.exists():
        if verbose:
            print(f"Warning: Directory {root} does not exist")
        return stats

    for path in root.rglob("*"):
        if not path.is_file():
            continue

        should_remove = False

        # Check exact matches
        if path.name in Config.IGNORE_FILES:
            should_remove = True

        # Check pattern matches
        for pattern in Config.IGNORE_PATTERNS:
            if fnmatch.fnmatch(path.name, pattern):
                should_remove = True
                break

        if should_remove:
            if verbose:
                print(f"  Remove: {path.relative_to(root)}")

            if not dry_run:
                try:
                    path.unlink()
                    stats["removed"] += 1
                except Exception as e:
                    if verbose:
                        print(f"    Error removing {path}: {e}")
                    stats["errors"] += 1
            else:
                stats["removed"] += 1

    return stats


def get_album_directories(config: Config) -> list[Path]:
    """Get list of album directories.

    Args:
        config: Configuration instance

    Returns:
        List of album directory paths, sorted alphabetically
    """
    albums_dir = config.albums_dir

    if not albums_dir.exists():
        return []

    return sorted([d for d in albums_dir.iterdir() if d.is_dir()])


def get_tracker_files(
    trackers_dir: Path,
    config: Config,
) -> dict[str, list[dict[str, Any]]]:
    """Scan trackers directory and categorize files.

    Categories:
    - linked: Tracker files that correspond to released MP3s
    - unreleased_album: Files in unreleased/{album}/ directories
    - unreleased_standalone: Files directly in unreleased/

    Args:
        trackers_dir: Path to trackers root directory
        config: Configuration instance

    Returns:
        Dict with categorized tracker files:
        {
            "linked": [{path, album, is_extra}, ...],
            "unreleased_album": [{path, album, is_extra}, ...],
            "unreleased_standalone": [{path}, ...],
        }
    """
    result: dict[str, list[dict[str, Any]]] = {
        "linked": [],
        "unreleased_album": [],
        "unreleased_standalone": [],
    }

    if not trackers_dir.exists():
        return result

    for item in trackers_dir.rglob("*"):
        if not item.is_file():
            continue

        if item.suffix.lower() not in config.TRACKER_EXTS:
            continue

        # Get relative path from trackers root
        rel_path = item.relative_to(trackers_dir)
        parts = rel_path.parts

        if len(parts) < 2:
            continue

        # Check if in unreleased directory
        if parts[0] == "unreleased":
            if len(parts) == 2:
                # Direct file in unreleased/
                result["unreleased_standalone"].append({"path": item})
            else:
                # File in unreleased/{album}/ or unreleased/{album}/Extras/
                album = parts[1]
                is_extra = "Extras" in parts
                result["unreleased_album"].append(
                    {
                        "path": item,
                        "album": album,
                        "is_extra": is_extra,
                    }
                )
        else:
            # Regular album tracker (linked)
            album = parts[0]
            is_extra = "Extras" in parts
            result["linked"].append(
                {
                    "path": item,
                    "album": album,
                    "is_extra": is_extra,
                }
            )

    return result


def ensure_directory(path: Path, dry_run: bool = False) -> bool:
    """Ensure a directory exists, creating it if necessary.

    Args:
        path: Directory path to ensure
        dry_run: If True, don't actually create

    Returns:
        True if directory exists or was created successfully
    """
    if path.exists():
        return path.is_dir()

    if not dry_run:
        try:
            path.mkdir(parents=True, exist_ok=True)
            return True
        except Exception as e:
            print(f"Error creating directory {path}: {e}")
            return False
    else:
        print(f"  Would create directory: {path}")
        return True


def get_file_list(
    directory: Path,
    extensions: set[str] | None = None,
    recursive: bool = True,
) -> list[Path]:
    """Get list of files in directory, optionally filtered by extension.

    Args:
        directory: Directory to search
        extensions: Set of extensions to include (e.g., {'.mp3', '.png'})
        recursive: If True, search recursively

    Returns:
        List of matching file paths, sorted
    """
    if not directory.exists():
        return []

    file_iter = directory.rglob("*") if recursive else directory.glob("*")

    files = [f for f in file_iter if f.is_file()]

    if extensions:
        extensions_lower = {ext.lower() for ext in extensions}
        files = [f for f in files if f.suffix.lower() in extensions_lower]

    return sorted(files)


def normalize_stem(filename: str) -> str:
    """Normalize a filename stem for matching purposes.

    Removes track numbers, special characters, and normalizes whitespace.

    Args:
        filename: Original filename (with or without extension)

    Returns:
        Normalized stem for comparison

    Examples:
        >>> normalize_stem("01.The Day They Landed.mp3")
        'the-day-they-landed'
        >>> normalize_stem("The Day They Landed.xm")
        'the-day-they-landed'
    """
    # Remove extension if present
    stem = Path(filename).stem if "." in filename else filename

    # Remove leading track numbers (01., 02., etc.)
    stem = re.sub(r"^\d+\.\s*", "", stem)

    # Convert to lowercase
    stem = stem.lower()

    # Remove special characters and normalize whitespace
    stem = re.sub(r"[^\w\s-]", "", stem)
    stem = re.sub(r"\s+", "-", stem)
    stem = re.sub(r"-{2,}", "-", stem)
    stem = stem.strip("-")

    return stem
