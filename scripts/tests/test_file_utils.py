"""
Tests for file_utils module.
"""

from scripts.utils.file_utils import (
    normalize_stem,
    url_safe_name,
)


class TestUrlSafeName:
    """Test url_safe_name function."""

    def test_basic_filename(self):
        """Test basic filename sanitization."""
        assert url_safe_name("The Day They Landed.mp3") == "The-Day-They-Landed.mp3"

    def test_special_characters(self):
        """Test removal of special characters."""
        assert url_safe_name("It's Alright!.mp3") == "Its-Alright.mp3"

    def test_multiple_spaces(self):
        """Test collapsing multiple spaces."""
        assert url_safe_name("Track   Name.mp3") == "Track-Name.mp3"

    def test_parentheses_removed(self):
        """Test that parentheses are removed."""
        assert url_safe_name("Love. (Demo).mod") == "Love-Demo.mod"

    def test_parentheses_with_track_number(self):
        """Test parentheses removal with track number."""
        assert url_safe_name("09.Timtris. (Looped).mp3") == "09.Timtris-Looped.mp3"

    def test_slashes_converted(self):
        """Test that slashes are converted to dashes."""
        assert url_safe_name("Track/Name.mp3") == "Track-Name.mp3"

    def test_empty_string(self):
        """Test empty string handling."""
        assert url_safe_name("") == "unnamed"

    def test_track_number_preserved(self):
        """Test that track numbers with dots are preserved."""
        assert url_safe_name("01.Track Name.mp3") == "01.Track-Name.mp3"

    def test_mid_name_dots_removed(self):
        """Test that mid-name dots are removed."""
        assert url_safe_name("Que Sera, Sera..mp3") == "Que-Sera-Sera.mp3"

    def test_ampersand_conversion(self):
        """Test that & is converted to -and-."""
        assert url_safe_name("Godom & Sodorrah") == "Godom-and-Sodorrah"
        assert url_safe_name("Godom & Sodorrah.mp3") == "Godom-and-Sodorrah.mp3"

    def test_brackets_removed(self):
        """Test that brackets are removed."""
        assert url_safe_name("Track [Bonus].mp3") == "Track-Bonus.mp3"

    def test_multiple_special_chars(self):
        """Test removal of multiple special characters."""
        assert url_safe_name("What!? [Really].mp3") == "What-Really.mp3"

    def test_case_preserved(self):
        """Test that original case is preserved."""
        assert url_safe_name("8Bit Seduction") == "8Bit-Seduction"
        assert url_safe_name("LOUD SONG.mp3") == "LOUD-SONG.mp3"

    def test_commas_removed(self):
        """Test that commas are removed."""
        assert url_safe_name("One, Two, Three.mp3") == "One-Two-Three.mp3"

    def test_quotes_removed(self):
        """Test that quotes are removed."""
        assert url_safe_name('"Song Name".mp3') == "Song-Name.mp3"
        assert url_safe_name("Don't Stop.mp3") == "Dont-Stop.mp3"


class TestNormalizeStem:
    """Test normalize_stem function."""

    def test_removes_track_number(self):
        """Test removal of leading track numbers."""
        assert normalize_stem("01.The Day They Landed.mp3") == "the-day-they-landed"

    def test_lowercase_conversion(self):
        """Test lowercase conversion."""
        assert normalize_stem("The Day They Landed.xm") == "the-day-they-landed"

    def test_matching_stems(self):
        """Test that MP3 and tracker files match."""
        mp3_stem = normalize_stem("01.Track Name.mp3")
        tracker_stem = normalize_stem("01.Track Name.it")
        assert mp3_stem == tracker_stem

    def test_without_extension(self):
        """Test normalization without extension."""
        assert normalize_stem("Track Name") == "track-name"

    def test_special_characters_removed(self):
        """Test removal of special characters."""
        assert normalize_stem("Track! Name?.mp3") == "track-name"
