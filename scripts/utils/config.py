"""Configuration module for music sync tool.

Handles configuration from multiple sources with precedence:
CLI arguments > config file > environment variables > defaults
"""

import os
from pathlib import Path
from typing import Any, ClassVar

import yaml

# Try to load python-dotenv for .env file support
try:
    from dotenv import load_dotenv

    load_dotenv()  # Load .env file from current directory
except ImportError:
    pass  # python-dotenv not installed, will use system env vars only


class Config:
    """Configuration manager for music sync operations."""

    # Default configuration values
    DEFAULTS: ClassVar[dict[str, Any]] = {
        "base_path": "./Music",
        "s3_bucket": "alexmbugua-music",
        "s3_region": "us-east-1",
        "cdn_base_url": "https://cdn.alexmbugua.me",  # CDN base URL
        "s3_base_url": None,  # Will be computed from bucket if not provided
        "default_artist": "Alex.Immer",
        "default_composer": "Alex.Immer",
        "thumbnail_size": (400, 400),
        "thumbnail_format": "png",
        "thumbnail_quality": 85,
    }

    # Directory structure (relative to base_path)
    DIR_STRUCTURE: ClassVar[dict[str, str]] = {
        "albums": "albums",
        "covers": "covers",
        "trackers": "tracker",  # Changed from "trackers" to "tracker" (singular)
        "metadata": "metadata",
        "thumbs": "thumbs",  # subdirectory under covers
    }

    # File extensions
    TRACKER_EXTS: ClassVar[set[str]] = {
        ".it",  # Impulse Tracker
        ".xm",  # Extended Module (FastTracker II)
        ".mod",  # ProTracker Module
        ".s3m",  # ScreamTracker 3
        ".ftm",  # FamiTracker Module
        ".nsf",  # NES Sound Format
        ".mptm",  # OpenMPT Module
        ".umx",  # Unreal Music Package
        ".mt2",  # MadTracker 2
        ".mdz",  # Compressed MOD
        ".s3z",  # Compressed S3M
        ".xmz",  # Compressed XM
        ".itz",  # Compressed IT
    }
    AUDIO_EXTS: ClassVar[set[str]] = {".mp3"}
    IMAGE_EXTS: ClassVar[set[str]] = {".png", ".jpg", ".jpeg"}

    # System files and patterns to remove
    IGNORE_FILES: ClassVar[set[str]] = {
        ".DS_Store",
        "Thumbs.db",
        ".gitkeep",
        ".gitignore",
        "desktop.ini",
        "Folder.jpg",
        "AlbumArtSmall.jpg",
    }

    # Patterns for system files (glob-style)
    IGNORE_PATTERNS: ClassVar[list[str]] = [
        "AlbumArt_*_Large.jpg",
        "AlbumArt_*_Small.jpg",
    ]

    def __init__(
        self,
        base_path: str | None = None,
        config_file: str | None = None,
        **overrides: Any,
    ) -> None:
        """Initialize configuration.

        Args:
            base_path: Base directory for music files
            config_file: Path to YAML config file
            **overrides: Direct configuration overrides
        """
        self.config = self.DEFAULTS.copy()

        # Load from config file if provided
        if config_file:
            self._load_config_file(config_file)

        # Load from environment variables
        self._load_env_vars()

        # Apply CLI overrides
        if base_path:
            self.config["base_path"] = base_path
        self.config.update(overrides)

        # Resolve paths
        self.base_path = Path(str(self.config["base_path"])).resolve()

        # Compute S3 base URL if not set
        if not self.config.get("s3_base_url"):
            self.config["s3_base_url"] = f"https://{self.config['s3_bucket']}.s3.amazonaws.com"

    def _load_config_file(self, config_file: str) -> None:
        """Load configuration from YAML file."""
        try:
            with Path(config_file).open() as f:
                file_config: dict[str, Any] = yaml.safe_load(f) or {}
                self.config.update(file_config)
        except FileNotFoundError:
            print(f"Warning: Config file '{config_file}' not found, using defaults")
        except yaml.YAMLError as e:
            print(f"Warning: Error parsing config file: {e}")

    def _load_env_vars(self) -> None:
        """Load configuration from environment variables."""
        env_mapping = {
            "MUSIC_BASE_PATH": "base_path",
            "MUSIC_S3_BUCKET": "s3_bucket",
            "MUSIC_S3_REGION": "s3_region",
            "MUSIC_CDN_BASE": "cdn_base",
            "CLOUDFRONT_DISTRIBUTION_ID": "cloudfront_distribution_id",
        }

        for env_var, config_key in env_mapping.items():
            value = os.getenv(env_var)
            if value:
                self.config[config_key] = value

    @property
    def albums_dir(self) -> Path:
        """Path to albums directory."""
        return self.base_path / self.DIR_STRUCTURE["albums"]

    @property
    def covers_dir(self) -> Path:
        """Path to covers directory."""
        return self.base_path / self.DIR_STRUCTURE["covers"]

    @property
    def trackers_dir(self) -> Path:
        """Path to trackers directory."""
        return self.base_path / self.DIR_STRUCTURE["trackers"]

    @property
    def metadata_dir(self) -> Path:
        """Path to metadata directory."""
        return self.base_path / self.DIR_STRUCTURE["metadata"]

    @property
    def thumbs_dir(self) -> Path:
        """Path to thumbnails directory (under covers)."""
        return self.covers_dir / self.DIR_STRUCTURE["thumbs"]

    @property
    def s3_bucket(self) -> str:
        """S3 bucket name."""
        return str(self.config["s3_bucket"])

    @property
    def s3_region(self) -> str:
        """S3 region."""
        return str(self.config["s3_region"])

    @property
    def cdn_base(self) -> str:
        """CDN base URL (legacy compatibility - returns cdn_base_url)."""
        return self.cdn_base_url

    @property
    def cdn_base_url(self) -> str:
        """CDN base URL for serving assets."""
        cdn = self.config.get("cdn_base_url")
        if cdn:
            return str(cdn).rstrip("/")
        # Fallback to S3 base if no CDN configured
        return self.s3_base_url

    @property
    def s3_base_url(self) -> str:
        """S3 base URL for direct S3 access."""
        s3_base = self.config.get("s3_base_url")
        if s3_base:
            return str(s3_base).rstrip("/")
        # Auto-compute from bucket
        bucket = self.s3_bucket
        return f"https://{bucket}.s3.amazonaws.com"

    @property
    def default_artist(self) -> str:
        """Default artist name."""
        return str(self.config.get("default_artist", "Alex.Immer"))

    @property
    def default_composer(self) -> str:
        """Default composer name."""
        return str(self.config.get("default_composer", "Alex.Immer"))

    @property
    def thumbnail_size(self) -> tuple[int, int]:
        """Thumbnail dimensions (width, height)."""
        size = self.config["thumbnail_size"]
        if isinstance(size, (list, tuple)) and len(size) == 2:
            return (int(size[0]), int(size[1]))
        return (400, 400)

    @property
    def thumbnail_format(self) -> str:
        """Thumbnail image format (png or jpg)."""
        return str(self.config["thumbnail_format"]).lower()

    @property
    def thumbnail_quality(self) -> int:
        """JPEG thumbnail quality (1-100)."""
        return int(str(self.config["thumbnail_quality"]))

    @property
    def cloudfront_distribution_id(self) -> str | None:
        """CloudFront distribution ID for cache invalidation."""
        return self.config.get("cloudfront_distribution_id")

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value by key."""
        return self.config.get(key, default)

    def load_album_metadata(self) -> dict[str, Any]:
        """Load album metadata overrides from YAML file.

        Looks for album_metadata.yaml in the base_path directory.

        Returns:
            Dict with album metadata overrides, or empty dict if file doesn't exist.
            Format: {"album-id": {"genre": "...", "description": "...", "tags": [...]}}
        """
        metadata_file = self.base_path / "album_metadata.yaml"

        if not metadata_file.exists():
            return {}

        try:
            with metadata_file.open("r", encoding="utf-8") as f:
                data: Any = yaml.safe_load(f)

            if not data or "albums" not in data:
                return {}

            albums_data: dict[str, Any] = data["albums"]
            return albums_data

        except Exception as e:
            print(f"Warning: Failed to load album metadata from {metadata_file}: {e}")
            return {}

    def __repr__(self) -> str:
        """String representation of config."""
        return f"Config(base_path={self.base_path}, bucket={self.s3_bucket})"


def load_config(
    base_path: str | None = None,
    config_file: str | None = None,
    **kwargs: Any,
) -> Config:
    """Load configuration with auto-detection of config file.

    Args:
        base_path: Base directory for music files
        config_file: Explicit path to config file (optional)
        **kwargs: Additional configuration overrides

    Returns:
        Config instance
    """
    # Auto-detect config file if not provided
    if not config_file:
        for candidate in [".music_sync.yaml", ".music_sync.yml", "music_sync.yaml"]:
            if Path(candidate).exists():
                config_file = candidate
                break

    return Config(base_path=base_path, config_file=config_file, **kwargs)
