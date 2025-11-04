#!/usr/bin/env python3
"""Music Service Sync Tool - Interactive REPL.

Interactive command-line interface for the music sync tool.
Run this to get an interactive shell where you can execute commands
without the "python scripts/music_sync.py" prefix.

Usage:
  python scripts/music_sync_cli.py

Then in the interactive shell:
  sanitize --dry-run
  extract-covers --with-thumbs
  build-manifest
  publish --dry-run
  quit
"""

import cmd
import os
import subprocess  # nosec B404 - subprocess is used safely for terminal commands
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from docopt import DocoptExit, docopt

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

import music_sync
from utils.config import load_config
from utils.secrets_manager import get_aws_credentials


def docopt_cmd(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to simplify docopt parsing and error handling.

    Passes the result of the docopt parsing to the called action.
    """
    import shlex

    def fn(self: Any, arg: str) -> Any:
        try:
            # cmd.Cmd passes arguments as a string, but docopt expects a list
            # Use shlex.split() to properly handle quoted arguments
            argv = shlex.split(arg) if arg else []
            opt = docopt(fn.__doc__, argv)
        except DocoptExit as e:
            # The DocoptExit is thrown when the args do not match
            print("Invalid Command!")
            print(e)
            return None
        except SystemExit:
            # The SystemExit exception prints the usage for --help
            return None

        return func(self, opt)

    fn.__name__ = func.__name__
    fn.__doc__ = func.__doc__
    fn.__dict__.update(func.__dict__)
    return fn


class MusicSyncCLI(cmd.Cmd):
    """Interactive Music Sync CLI."""

    intro = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                      🎵 Music Service Sync Tool 🎵                           ║
║                                                                              ║
║                           Interactive REPL Mode                              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

Available Commands:
  sanitize              - Clean filenames and remove system files
  extract_covers        - Extract embedded covers and generate thumbnails
  build_metadata        - Build all JSON metadata files
  upload_albums         - Upload MP3 files to S3
  upload_covers         - Upload cover art and thumbnails to S3
  upload_trackers       - Upload tracker files to S3
  upload_metadata       - Upload metadata JSON files to S3
  publish               - Run full pipeline (sanitize → extract → upload)
  validate              - Validate directory structure
  status                - Show configuration, credentials & acceleration status

Type "help <command>" for detailed syntax or "quit" to exit.

"""

    prompt = "\n🎵 music-sync> "

    def __init__(self):
        """Initialize the CLI with default config."""
        super().__init__()
        self.config = load_config(base_path="./Music")

    def preloop(self):
        """Clear screen and show intro on startup."""
        subprocess.run(
            ["cls"] if os.name == "nt" else ["clear"], check=False
        )  # nosec B603 - hardcoded terminal command

    @docopt_cmd
    def do_sanitize(self, arg: dict[str, Any]) -> None:
        """Usage: sanitize [--dry-run] [--path=<dir>]

        Sanitize filenames and remove system files.

        Options:
          --dry-run     Preview changes without executing
          --path=<dir>  Base music directory [default: ./Music]

        Examples:
          sanitize --dry-run
          sanitize
          sanitize --path=./Music
        """
        dry_run = arg.get("--dry-run", False)
        path = arg.get("--path", "./Music")

        # Update config if path changed
        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_sanitize(self.config, dry_run=dry_run)

    @docopt_cmd
    def do_extract_covers(self, arg: dict[str, Any]) -> None:
        """Usage: extract_covers [--dry-run] [--with-thumbs] [--thumb-format=<fmt>] [--path=<dir>]

        Extract embedded covers from MP3s and generate thumbnails.

        Options:
          --dry-run              Preview operations
          --with-thumbs          Generate thumbnails
          --thumb-format=<fmt>   Thumbnail format: png or jpg [default: png]
          --path=<dir>           Base music directory [default: ./Music]

        Examples:
          extract_covers --dry-run
          extract_covers --with-thumbs
          extract_covers --with-thumbs --thumb-format=jpg
        """
        dry_run = arg.get("--dry-run", False)
        with_thumbs = arg.get("--with-thumbs", False)
        thumb_format = arg.get("--thumb-format", "png") or "png"
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        self.config.config["thumbnail_format"] = thumb_format

        music_sync.cmd_extract_covers(
            self.config, dry_run=dry_run, with_thumbs=with_thumbs, thumb_format=thumb_format
        )

    @docopt_cmd
    def do_build_metadata(self, arg: dict[str, Any]) -> None:
        """Usage: build_metadata [--dry-run] [--output=<dir>] [--path=<dir>]

        Build all JSON metadata files.

        Options:
          --dry-run       Preview operations
          --output=<dir>  Output directory for metadata
          --path=<dir>    Base music directory [default: ./Music]

        Examples:
          build_metadata --dry-run
          build_metadata
          build_metadata --output=./custom/metadata
        """
        dry_run = arg.get("--dry-run", False)
        output_dir = arg.get("--output")
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_build_metadata(self.config, dry_run=dry_run, output_dir=output_dir)

    @docopt_cmd
    def do_upload_albums(self, arg: dict[str, Any]) -> None:
        """Usage: upload_albums [--dry-run] [--region=<region>] [--path=<dir>]

        Upload MP3 files and album-level tracker files.

        Options:
          --dry-run         Preview operations
          --region=<region> AWS region [default: us-east-1]
          --path=<dir>      Base music directory [default: ./Music]

        Examples:
          upload_albums --dry-run
          upload_albums
          upload_albums --region=us-west-2
        """
        dry_run = arg.get("--dry-run", False)
        region = arg.get("--region", "us-east-1")
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_upload_albums(self.config, dry_run=dry_run, region=region)

    @docopt_cmd
    def do_upload_covers(self, arg: dict[str, Any]) -> None:
        """Usage: upload_covers [--dry-run] [--with-thumbs] [--region=<region>] [--path=<dir>]

        Upload cover art and thumbnails to S3.

        Options:
          --dry-run         Preview operations
          --with-thumbs     Include thumbnails
          --region=<region> AWS region [default: us-east-1]
          --path=<dir>      Base music directory [default: ./Music]

        Examples:
          upload_covers --dry-run
          upload_covers --with-thumbs
        """
        dry_run = arg.get("--dry-run", False)
        with_thumbs = arg.get("--with-thumbs", False)
        region = arg.get("--region", "us-east-1")
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_upload_covers(
            self.config, dry_run=dry_run, with_thumbs=with_thumbs, region=region
        )

    @docopt_cmd
    def do_upload_trackers(self, arg: dict[str, Any]) -> None:
        """Usage: upload_trackers [--dry-run] [--region=<region>] [--path=<dir>]

        Upload all tracker files from trackers directory.

        Options:
          --dry-run         Preview operations
          --region=<region> AWS region [default: us-east-1]
          --path=<dir>      Base music directory [default: ./Music]

        Examples:
          upload_trackers --dry-run
          upload_trackers
        """
        dry_run = arg.get("--dry-run", False)
        region = arg.get("--region", "us-east-1")
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_upload_trackers(self.config, dry_run=dry_run, region=region)

    @docopt_cmd
    def do_upload_metadata(self, arg: dict[str, Any]) -> None:
        """Usage: upload_metadata [--dry-run] [--region=<region>] [--path=<dir>]

        Upload JSON metadata files to S3.

        Options:
          --dry-run         Preview operations
          --region=<region> AWS region [default: us-east-1]
          --path=<dir>      Base music directory [default: ./Music]

        Examples:
          upload_metadata --dry-run
          upload_metadata
        """
        dry_run = arg.get("--dry-run", False)
        region = arg.get("--region", "us-east-1")
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_upload_metadata(self.config, dry_run=dry_run, region=region)

    @docopt_cmd
    def do_publish(self, arg: dict[str, Any]) -> None:
        """Usage: publish [--dry-run] [--with-thumbs] [--thumb-format=<fmt>]
                          [--region=<region>] [--path=<dir>]

        Run full pipeline: sanitize → extract → build → upload.

        Options:
          --dry-run              Preview all operations
          --with-thumbs          Generate and upload thumbnails
          --thumb-format=<fmt>   Thumbnail format: png or jpg [default: png]
          --region=<region>      AWS region [default: us-east-1]
          --path=<dir>           Base music directory [default: ./Music]

        Examples:
          publish --dry-run
          publish --with-thumbs
          publish --with-thumbs --thumb-format=png
        """
        dry_run = arg.get("--dry-run", False)
        with_thumbs = arg.get("--with-thumbs", False)
        thumb_format = arg.get("--thumb-format", "png") or "png"
        region = arg.get("--region", "us-east-1")
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        self.config.config["thumbnail_format"] = thumb_format

        music_sync.cmd_publish(
            self.config,
            dry_run=dry_run,
            with_thumbs=with_thumbs,
            thumb_format=thumb_format,
            region=region,
        )

    @docopt_cmd
    def do_validate(self, arg: dict[str, Any]) -> None:
        """Usage: validate [--path=<dir>]

        Validate directory structure and file integrity.

        Options:
          --path=<dir>  Base music directory [default: ./Music]

        Examples:
          validate
          validate --path=./Music
        """
        path = arg.get("--path", "./Music")

        if path != str(self.config.base_path):
            self.config = load_config(base_path=path)

        music_sync.cmd_validate(self.config)

    def do_status(self, arg: str) -> None:
        """Show current configuration status.

        Usage: status
        """
        print("\n" + "=" * 70)
        print("CURRENT CONFIGURATION")
        print("=" * 70)

        # Basic configuration
        print(f"  Base path:        {self.config.base_path}")
        print(f"  S3 bucket:        {self.config.s3_bucket}")
        print(f"  S3 region:        {self.config.s3_region}")
        print(f"  CDN base:         {self.config.cdn_base}")
        print(f"  Thumbnail size:   {self.config.thumbnail_size}")
        print(f"  Thumbnail format: {self.config.thumbnail_format}")

        # AWS Credentials status
        print("\n" + "-" * 70)
        print("AWS CREDENTIALS & CONFIGURATION")
        print("-" * 70)

        # Try to fetch credentials from Secrets Manager
        try:
            creds = get_aws_credentials()
            access_key = creds.get("access_key_id", "")
            created_at = creds.get("created_at", "unknown")

            # Mask the key for security (show first 4 and last 4 chars)
            if access_key and len(access_key) > 8:
                masked_key = f"{access_key[:4]}...{access_key[-4:]}"
            else:
                masked_key = "****"

            print("  Credentials Source:    ✅ AWS Secrets Manager")
            print(f"  AWS_ACCESS_KEY_ID:     ✅ {masked_key}")
            print("  AWS_SECRET_ACCESS_KEY: ✅ Set (hidden)")
            print(f"  Created At:            {created_at}")
            credentials_available = True

        except (ValueError, PermissionError) as e:
            # Secrets Manager not available - check environment variables
            print("  Credentials Source:    ⚠️  Secrets Manager unavailable")
            print(f"  Error:                 {e}")

            aws_key = os.getenv("AWS_ACCESS_KEY_ID")
            aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")

            if aws_key:
                masked_key = f"{aws_key[:4]}...{aws_key[-4:]}" if len(aws_key) > 8 else "****"
                print(f"  AWS_ACCESS_KEY_ID:     ✅ Set from env ({masked_key})")
            else:
                print("  AWS_ACCESS_KEY_ID:     ⚠️  NOT SET")

            if aws_secret:
                print("  AWS_SECRET_ACCESS_KEY: ✅ Set from env (hidden)")
            else:
                print("  AWS_SECRET_ACCESS_KEY: ⚠️  NOT SET")

            credentials_available = bool(aws_key and aws_secret)

        # Check S3 acceleration
        acceleration = os.getenv("S3_USE_ACCELERATION", "true").lower() == "true"
        print(f"\n  S3 Transfer Acceleration: {'✅ ENABLED' if acceleration else '❌ DISABLED'}")

        if acceleration:
            accelerated_endpoint = f"{self.config.s3_bucket}.s3-accelerate.amazonaws.com"
            standard_endpoint = f"{self.config.s3_bucket}.s3.{self.config.s3_region}.amazonaws.com"
            print(f"    Standard endpoint:    {standard_endpoint}")
            print(f"    Accelerated endpoint: {accelerated_endpoint}")
            print("    Performance:          643% faster (Kenya → us-east-1)")
            print("    Cost:                 $0.04/GB (~4¢ for 944 MB)")
        else:
            print(f"    Endpoint: {self.config.s3_bucket}.s3.{self.config.s3_region}.amazonaws.com")
            print("    Tip: Set S3_USE_ACCELERATION=true in .env for faster uploads")

        # Directory paths
        print("\n" + "-" * 70)
        print("DIRECTORY PATHS")
        print("-" * 70)
        print(f"  Albums:    {self.config.albums_dir}")
        print(f"  Covers:    {self.config.covers_dir}")
        print(f"  Trackers:  {self.config.trackers_dir}")
        print(f"  Metadata:  {self.config.metadata_dir}")

        # Warnings section
        warnings = []
        if not credentials_available:
            warnings.append("AWS credentials not configured - uploads will fail")
            warnings.append(
                "Setup: Run infrastructure/terraform/scripts/setup_secrets.sh to store "
                "credentials in Secrets Manager"
            )

        if not self.config.base_path.exists():
            warnings.append(f"Base path does not exist: {self.config.base_path}")

        if warnings:
            print("\n" + "-" * 70)
            print("⚠️  WARNINGS")
            print("-" * 70)
            for warning in warnings:
                print(f"  • {warning}")

        print("=" * 70 + "\n")

    def do_clear(self, arg: str) -> None:
        """Clear the terminal screen.

        Usage: clear
        """
        subprocess.run(
            ["cls"] if os.name == "nt" else ["clear"], check=False
        )  # nosec B603 - hardcoded terminal command

    def do_quit(self, arg: str) -> bool:
        """Exit the interactive CLI.

        Usage: quit
        """
        print("\n👋 Goodbye! Thanks for using Music Sync Tool.\n")
        return True

    def do_exit(self, arg: str) -> bool:
        """Exit the interactive CLI (alias for quit).

        Usage: exit
        """
        return self.do_quit(arg)

    def do_EOF(self, arg: str) -> bool:
        """Handle Ctrl+D to exit."""
        print()  # New line after ^D
        return self.do_quit(arg)

    def emptyline(self) -> bool:
        """Do nothing on empty line (override default repeat behavior)."""
        return False

    def default(self, line: str) -> None:
        """Handle unknown commands."""
        print(f"\n❌ Unknown command: '{line}'")
        print("Type 'help' to see available commands.\n")


def main():
    """Entry point for the interactive CLI."""
    try:
        MusicSyncCLI().cmdloop()
    except KeyboardInterrupt:
        print("\n\n👋 Goodbye! Thanks for using Music Sync Tool.\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
