#!/usr/bin/env python3
"""Music Service Sync Tool.

Usage:
  music_sync.py sanitize [--dry-run] [--path=<dir>]
  music_sync.py extract-covers [--dry-run] [--with-thumbs] [--thumb-format=<fmt>] [--path=<dir>]
  music_sync.py extract-metadata [--output=<dir>] [--path=<dir>]
  music_sync.py build-metadata [--dry-run] [--output=<dir>] [--path=<dir>]
  music_sync.py prepare [--dry-run] [--with-thumbs] [--thumb-format=<fmt>] [--path=<dir>]
  music_sync.py upload albums [--dry-run] [--region=<region>] [--path=<dir>]
  music_sync.py upload covers [--dry-run] [--with-thumbs] [--region=<region>] [--path=<dir>]
  music_sync.py upload trackers [--dry-run] [--region=<region>] [--path=<dir>]
  music_sync.py upload metadata [--dry-run] [--region=<region>] [--path=<dir>]
  music_sync.py upload-all [--dry-run] [--with-thumbs] [--region=<region>]
                           [--path=<dir>]
  music_sync.py publish [--dry-run] [--with-thumbs] [--thumb-format=<fmt>]
                        [--region=<region>] [--path=<dir>]
  music_sync.py validate [--path=<dir>]
  music_sync.py (-h | --help)
  music_sync.py --version

Commands:
  sanitize           Sanitize filenames and remove system files
  extract-covers     Extract embedded covers and generate thumbnails
  extract-metadata   Extract MP3 metadata locally (no upload)
  build-metadata     Build all manifest JSON files
  prepare            Run all pre-upload steps: sanitize → extract → build metadata
  upload albums      Upload MP3 files to S3
  upload covers      Upload cover art and thumbnails to S3
  upload trackers    Upload tracker files to S3
  upload metadata    Upload metadata JSON files to S3
  upload-all         Upload everything: albums → covers → trackers → metadata
  publish            Run full pipeline: prepare → upload-all
  validate           Validate directory structure and file integrity

Options:
  --dry-run               Preview changes without executing
  --with-thumbs           Generate and include thumbnails
  --thumb-format=<fmt>    Thumbnail format: png or jpg [default: png]
  --region=<region>       AWS region for S3 [default: us-east-1]
  --path=<dir>            Base music directory [default: ./Music]
  --output=<dir>          Output directory for metadata (defaults to <path>/metadata)
  -h --help               Show this screen
  --version               Show version

Examples:
  # Sanitize filenames (dry-run first to preview)
  music_sync.py sanitize --dry-run
  music_sync.py sanitize

  # Extract covers and generate PNG thumbnails
  music_sync.py extract-covers --with-thumbs

  # Build metadata files locally (no S3)
  music_sync.py build-metadata

  # Prepare everything for upload (no actual upload)
  music_sync.py prepare --dry-run --with-thumbs
  music_sync.py prepare --with-thumbs

  # Upload only covers with thumbnails
  music_sync.py upload covers --with-thumbs

  # Upload everything to S3
  music_sync.py upload-all --dry-run
  music_sync.py upload-all

  # Full publish workflow (prepare + upload)
  music_sync.py publish --with-thumbs --dry-run
  music_sync.py publish --with-thumbs

  # Validate directory structure
  music_sync.py validate
"""

import sys
from pathlib import Path

from docopt import docopt

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils.config import Config, load_config
from utils.file_utils import (
    get_album_directories,
    remove_system_files,
    sanitize_directory,
)
from utils.image_utils import process_album_covers
from utils.manifest_utils import (
    scan_and_build_manifests,
    write_all_manifests,
)
from utils.upload_utils import (
    get_s3_client,
    upload_album,
    upload_all,
    upload_covers,
    upload_metadata,
    upload_trackers,
)

__version__ = "3.0.0"


def cmd_sanitize(config: Config, dry_run: bool = False) -> None:
    """Sanitize filenames and remove system files."""
    print("=" * 60)
    print("SANITIZING FILES AND DIRECTORIES")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print()

    print("Step 1: Removing system files...")
    stats = remove_system_files(config.base_path, dry_run=dry_run, verbose=True)
    print(f"  Removed: {stats['removed']}, Errors: {stats['errors']}")

    print("\nStep 2: Sanitizing filenames...")
    stats = sanitize_directory(config.base_path, dry_run=dry_run, verbose=True)
    print(f"  Renamed: {stats['renamed']}, Skipped: {stats['skipped']}, Errors: {stats['errors']}")

    print("\n" + "=" * 60)
    print("SANITIZATION COMPLETE")
    print("=" * 60)


def cmd_extract_covers(
    config: Config, dry_run: bool = False, with_thumbs: bool = False, thumb_format: str = "png"
) -> None:
    """Extract embedded covers and generate thumbnails."""
    print("=" * 60)
    print("EXTRACTING COVER ART")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print(f"Thumbnails: {'Yes' if with_thumbs else 'No'}")
    if with_thumbs:
        print(f"Thumbnail format: {thumb_format.upper()}")
    print()

    album_dirs = get_album_directories(config)
    total_covers = 0
    total_thumbs = 0

    for album_dir in album_dirs:
        album_name = album_dir.name
        print(f"Processing: {album_name}")

        result = process_album_covers(
            album_name,
            album_dir,
            config,
            with_thumbs=with_thumbs,
            thumb_format=thumb_format,
            dry_run=dry_run,
            verbose=True,
        )

        if result.get("cover"):
            total_covers += 1
        if result.get("thumbnail"):
            total_thumbs += 1

    print("\n" + "=" * 60)
    print("COVER EXTRACTION COMPLETE")
    print("=" * 60)
    print(f"  Covers: {total_covers}")
    print(f"  Thumbnails: {total_thumbs}")


def cmd_extract_metadata(config: Config, output_dir: str | None = None) -> None:
    """Extract MP3 metadata locally (no upload)."""
    print("=" * 60)
    print("EXTRACTING METADATA")
    print("=" * 60)
    print(f"Base path: {config.base_path}")

    if output_dir:
        print(f"Output directory: {output_dir}")
    else:
        print(f"Output directory: {config.metadata_dir}")

    print()

    # This extracts metadata but doesn't write files
    # For writing, use build-metadata command
    print("Use 'build-metadata' command to generate metadata files.")


def cmd_build_metadata(
    config: Config, dry_run: bool = False, output_dir: str | None = None
) -> None:
    """Build all manifest JSON files."""
    print("=" * 60)
    print("BUILDING MANIFEST FILES")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")

    if output_dir:
        # Override config metadata directory
        config.config["metadata"] = output_dir
        print(f"Output directory: {output_dir}")
    else:
        print(f"Output directory: {config.metadata_dir}")

    print()

    # Scan and build manifests
    manifests = scan_and_build_manifests(config, dry_run=dry_run, verbose=True)

    # Write manifest files (with change detection and backup)
    success = write_all_manifests(
        manifests,
        config,
        dry_run=dry_run,
        verbose=True,
        check_changes=True,
    )

    print("\n" + "=" * 60)
    print("MANIFEST BUILD COMPLETE")
    print("=" * 60)
    print(f"  Albums: {len(manifests['albums'])}")
    print(f"  Tracks: {len(manifests['tracks'])}")
    print(f"  Trackers: {len(manifests['trackers'])}")
    print(f"  Unreleased: {len(manifests['unreleased'])}")

    if not success:
        print("\nWarning: Some files failed to write")
        sys.exit(1)


def cmd_upload_albums(config: Config, dry_run: bool = False, region: str | None = None) -> None:
    """Upload album MP3s and trackers to S3."""
    print("=" * 60)
    print("UPLOADING ALBUMS TO S3")
    print("=" * 60)
    print(f"Bucket: {config.s3_bucket}")
    print(f"Region: {region or config.s3_region}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print()

    s3_client = get_s3_client(region or config.s3_region)
    album_dirs = get_album_directories(config)

    total_mp3s = 0
    total_trackers = 0
    total_errors = 0

    for album_dir in album_dirs:
        album_name = album_dir.name
        print(f"\nAlbum: {album_name}")

        stats = upload_album(
            album_dir,
            album_name,
            config,
            s3_client,
            dry_run=dry_run,
            verbose=True,
        )

        total_mp3s += stats["mp3s"]
        total_trackers += stats["trackers"]
        total_errors += stats["errors"]

    print("\n" + "=" * 60)
    print("ALBUM UPLOAD COMPLETE")
    print("=" * 60)
    print(f"  MP3s: {total_mp3s}")
    print(f"  Trackers: {total_trackers}")
    print(f"  Errors: {total_errors}")


def cmd_upload_covers(
    config: Config,
    dry_run: bool = False,
    with_thumbs: bool = False,
    region: str | None = None,
) -> None:
    """Upload covers and thumbnails to S3."""
    print("=" * 60)
    print("UPLOADING COVERS TO S3")
    print("=" * 60)
    print(f"Bucket: {config.s3_bucket}")
    print(f"Region: {region or config.s3_region}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print(f"Thumbnails: {'Yes' if with_thumbs else 'No'}")
    print()

    s3_client = get_s3_client(region or config.s3_region)

    stats = upload_covers(
        config,
        s3_client,
        with_thumbs=with_thumbs,
        dry_run=dry_run,
        verbose=True,
    )

    print("\n" + "=" * 60)
    print("COVER UPLOAD COMPLETE")
    print("=" * 60)
    print(f"  Covers: {stats['covers']}")
    print(f"  Thumbnails: {stats['thumbs']}")
    print(f"  Errors: {stats['errors']}")


def cmd_upload_trackers(config: Config, dry_run: bool = False, region: str | None = None) -> None:
    """Upload tracker files to S3."""
    print("=" * 60)
    print("UPLOADING TRACKERS TO S3")
    print("=" * 60)
    print(f"Bucket: {config.s3_bucket}")
    print(f"Region: {region or config.s3_region}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print()

    s3_client = get_s3_client(region or config.s3_region)

    stats = upload_trackers(
        config,
        s3_client,
        dry_run=dry_run,
        verbose=True,
    )

    print("\n" + "=" * 60)
    print("TRACKER UPLOAD COMPLETE")
    print("=" * 60)
    print(f"  Trackers: {stats['trackers']}")
    print(f"  Errors: {stats['errors']}")


def cmd_upload_metadata(config: Config, dry_run: bool = False, region: str | None = None) -> None:
    """Upload metadata JSON files to S3."""
    print("=" * 60)
    print("UPLOADING METADATA TO S3")
    print("=" * 60)
    print(f"Bucket: {config.s3_bucket}")
    print(f"Region: {region or config.s3_region}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print()

    s3_client = get_s3_client(region or config.s3_region)

    stats = upload_metadata(
        config,
        s3_client,
        dry_run=dry_run,
        verbose=True,
    )

    print("\n" + "=" * 60)
    print("METADATA UPLOAD COMPLETE")
    print("=" * 60)
    print(f"  Files: {stats['files']}")
    print(f"  Errors: {stats['errors']}")


def cmd_prepare(
    config: Config,
    dry_run: bool = False,
    with_thumbs: bool = False,
    thumb_format: str = "png",
) -> None:
    """Run all pre-upload steps: sanitize → extract → build manifests."""
    print("\n" + "=" * 60)
    print("PREPARE FOR UPLOAD")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print(f"Thumbnails: {'Yes' if with_thumbs else 'No'}")
    if with_thumbs:
        print(f"Thumbnail format: {thumb_format.upper()}")
    print()

    # Step 1: Sanitize
    print("\n" + "-" * 60)
    print("STEP 1: SANITIZING FILES")
    print("-" * 60)
    cmd_sanitize(config, dry_run=dry_run)

    # Step 2: Extract covers
    print("\n" + "-" * 60)
    print("STEP 2: EXTRACTING COVERS")
    print("-" * 60)
    cmd_extract_covers(config, dry_run=dry_run, with_thumbs=with_thumbs, thumb_format=thumb_format)

    # Step 3: Build manifests
    print("\n" + "-" * 60)
    print("STEP 3: BUILDING MANIFESTS")
    print("-" * 60)
    cmd_build_metadata(config, dry_run=dry_run)

    print("\n" + "=" * 60)
    print("PREPARATION COMPLETE!")
    print("=" * 60)
    print("\nYour files are ready for upload.")
    print(f"Run 'music_sync.py upload-all{' --dry-run' if dry_run else ''}' to upload to S3.")


def cmd_upload_all(
    config: Config,
    dry_run: bool = False,
    with_thumbs: bool = False,
    region: str | None = None,
) -> None:
    """Upload everything to S3: albums → covers → trackers → metadata."""
    print("\n" + "=" * 60)
    print("UPLOAD ALL TO S3")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print(f"Bucket: {config.s3_bucket}")
    print(f"Region: {region or config.s3_region}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print(f"Thumbnails: {'Yes' if with_thumbs else 'No'}")
    print()

    upload_all(
        config,
        with_thumbs=with_thumbs,
        dry_run=dry_run,
        verbose=True,
    )

    print("\n" + "=" * 60)
    print("UPLOAD COMPLETE!")
    print("=" * 60)


def cmd_publish(
    config: Config,
    dry_run: bool = False,
    with_thumbs: bool = False,
    thumb_format: str = "png",
    region: str | None = None,
) -> None:
    """Run full pipeline: prepare → upload-all."""
    print("\n" + "=" * 60)
    print("FULL PUBLISH PIPELINE")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print(f"Bucket: {config.s3_bucket}")
    print(f"Region: {region or config.s3_region}")
    print(f"Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print(f"Thumbnails: {'Yes' if with_thumbs else 'No'}")
    if with_thumbs:
        print(f"Thumbnail format: {thumb_format.upper()}")
    print()

    # Phase 1: Prepare
    cmd_prepare(config, dry_run=dry_run, with_thumbs=with_thumbs, thumb_format=thumb_format)

    # Phase 2: Upload
    print("\n" + "=" * 60)
    print("PHASE 2: UPLOADING TO S3")
    print("=" * 60)
    cmd_upload_all(config, dry_run=dry_run, with_thumbs=with_thumbs, region=region)

    print("\n" + "=" * 60)
    print("FULL PUBLISH COMPLETE!")
    print("=" * 60)


def cmd_validate(config: Config) -> None:
    """Validate directory structure and file integrity."""
    print("=" * 60)
    print("VALIDATING MUSIC DIRECTORY")
    print("=" * 60)
    print(f"Base path: {config.base_path}")
    print()

    issues: list[str] = []

    # Check base directories exist
    print("Checking directory structure...")
    for name, path in [
        ("Albums", config.albums_dir),
        ("Covers", config.covers_dir),
        ("Trackers", config.trackers_dir),
    ]:
        if not path.exists():
            issues.append(f"Missing directory: {path}")
            print(f"  ❌ {name}: {path}")
        else:
            print(f"  ✓ {name}: {path}")

    # Check for albums without covers
    print("\nChecking album covers...")
    album_dirs = get_album_directories(config)
    missing_covers: list[str] = []

    for album_dir in album_dirs:
        from utils.image_utils import find_cover_for_album

        cover = find_cover_for_album(album_dir.name, config)
        if not cover:
            missing_covers.append(album_dir.name)
            print(f"  ⚠️  No cover found for: {album_dir.name}")
        else:
            print(f"  ✓ {album_dir.name}")

    # Check for MP3s without metadata
    print("\nChecking MP3 files...")
    from utils.file_utils import get_file_list

    total_mp3s = 0
    for album_dir in album_dirs:
        mp3s = get_file_list(album_dir, extensions={".mp3"}, recursive=True)
        total_mp3s += len(mp3s)

    print(f"  Found {total_mp3s} MP3 files")

    # Summary
    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)
    print(f"  Albums: {len(album_dirs)}")
    print(f"  MP3s: {total_mp3s}")
    print(f"  Missing covers: {len(missing_covers)}")
    print(f"  Issues: {len(issues)}")

    if issues:
        print("\nIssues found:")
        for issue in issues:
            print(f"  - {issue}")
        sys.exit(1)
    else:
        print("\n✓ All checks passed!")


def main() -> None:
    """Main CLI entry point."""
    args = docopt(__doc__, version=f"Music Sync Tool v{__version__}")

    # Load configuration
    base_path: str = str(args.get("--path", "./Music"))
    region: str = str(args.get("--region", "us-east-1"))
    config = load_config(base_path=base_path, s3_region=region)

    # Set thumbnail format if provided
    thumb_format: str = str(args.get("--thumb-format", "png"))
    if thumb_format not in ["png", "jpg"]:
        print(f"Error: Invalid thumbnail format '{thumb_format}'. Use 'png' or 'jpg'.")
        sys.exit(1)

    config.config["thumbnail_format"] = thumb_format

    # Extract common flags
    dry_run: bool = bool(args.get("--dry-run", False))
    with_thumbs: bool = bool(args.get("--with-thumbs", False))
    output_dir: str | None = args.get("--output")

    # Route to appropriate command
    try:
        if args.get("sanitize"):
            cmd_sanitize(config, dry_run=dry_run)

        elif args.get("extract-covers"):
            cmd_extract_covers(
                config, dry_run=dry_run, with_thumbs=with_thumbs, thumb_format=thumb_format
            )

        elif args.get("extract-metadata"):
            cmd_extract_metadata(config, output_dir=output_dir)

        elif args.get("build-metadata"):
            cmd_build_metadata(config, dry_run=dry_run, output_dir=output_dir)

        elif args.get("prepare"):
            cmd_prepare(
                config,
                dry_run=dry_run,
                with_thumbs=with_thumbs,
                thumb_format=thumb_format,
            )

        elif args.get("upload-all"):
            cmd_upload_all(
                config,
                dry_run=dry_run,
                with_thumbs=with_thumbs,
                region=region,
            )

        elif args.get("upload"):
            if args.get("albums"):
                cmd_upload_albums(config, dry_run=dry_run, region=region)
            elif args.get("covers"):
                cmd_upload_covers(config, dry_run=dry_run, with_thumbs=with_thumbs, region=region)
            elif args.get("trackers"):
                cmd_upload_trackers(config, dry_run=dry_run, region=region)
            elif args.get("metadata"):
                cmd_upload_metadata(config, dry_run=dry_run, region=region)

        elif args.get("publish"):
            cmd_publish(
                config,
                dry_run=dry_run,
                with_thumbs=with_thumbs,
                thumb_format=thumb_format,
                region=region,
            )

        elif args.get("validate"):
            cmd_validate(config)

    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
