"""
Tests for metadata_utils module.
"""

from scripts.utils.metadata_utils import (
    format_duration,
    human_filesize,
)


class TestFormatDuration:
    """Test format_duration function."""

    def test_basic_duration(self):
        """Test basic duration formatting."""
        assert format_duration(145.5) == "2 min 25"

    def test_zero_minutes(self):
        """Test duration less than a minute."""
        assert format_duration(59) == "0 min 59"

    def test_exact_minutes(self):
        """Test exact minute duration."""
        assert format_duration(120) == "2 min 00"

    def test_long_duration(self):
        """Test longer duration."""
        assert format_duration(3661) == "61 min 01"


class TestHumanFilesize:
    """Test human_filesize function."""

    def test_basic_filesize(self):
        """Test basic filesize formatting."""
        result = human_filesize(6123520)
        assert result == "5.84 MiB"

    def test_small_file(self):
        """Test small file size."""
        result = human_filesize(1024)  # 1 KB
        assert "0.00" in result

    def test_large_file(self):
        """Test large file size."""
        result = human_filesize(10 * 1024 * 1024)  # 10 MB
        assert result == "10.00 MiB"

    def test_zero_size(self):
        """Test zero file size."""
        assert human_filesize(0) == "0.00 MiB"
