import unittest

from validation import validate_fen

START_FEN = (
    "........../.rnbqkbnr./.pppppppp./......../......../"
    "......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1"
)


class FenValidationTests(unittest.TestCase):
    def test_accepts_starting_position(self) -> None:
        self.assertEqual(validate_fen(START_FEN), START_FEN)

    def test_rejects_newlines(self) -> None:
        with self.assertRaises(ValueError):
            validate_fen("startpos\nquit")

    def test_rejects_invalid_board_shape(self) -> None:
        with self.assertRaises(ValueError):
            validate_fen("........../.rnbqkbnr./.pppppppp./......../......../......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0")

    def test_normalizes_whitespace(self) -> None:
        doubled = START_FEN.replace(" ", "   ")
        self.assertEqual(validate_fen(doubled), START_FEN)


if __name__ == "__main__":
    unittest.main()
