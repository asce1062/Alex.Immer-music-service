"""Utility modules for music sync operations."""

from .config import Config
from .file_utils import (
    get_album_directories,
    get_tracker_files,
    remove_system_files,
    sanitize_directory,
    url_safe_name,
)
from .image_utils import (
    extract_embedded_cover,
    find_cover_for_album,
    generate_thumbnail,
)
from .manifest_utils import (
    build_albums_manifest,
    build_master_manifest,
    build_tracker_manifest,
    build_tracks_manifest,
    build_unreleased_manifest,
)
from .metadata_utils import (
    extract_mp3_metadata,
    extract_tracker_metadata,
    format_duration,
    human_filesize,
)
from .upload_utils import (
    get_s3_client,
    upload_album,
    upload_covers,
    upload_file,
    upload_metadata,
)

__all__ = [
    "Config",
    "build_albums_manifest",
    "build_master_manifest",
    "build_tracker_manifest",
    "build_tracks_manifest",
    "build_unreleased_manifest",
    "extract_embedded_cover",
    "extract_mp3_metadata",
    "extract_tracker_metadata",
    "find_cover_for_album",
    "format_duration",
    "generate_thumbnail",
    "get_album_directories",
    "get_s3_client",
    "get_tracker_files",
    "human_filesize",
    "remove_system_files",
    "sanitize_directory",
    "upload_album",
    "upload_covers",
    "upload_file",
    "upload_metadata",
    "url_safe_name",
]
