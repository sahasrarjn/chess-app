"""Tests for deprecated coordinate remap helpers (move pipeline uses native client coords)."""

import unittest

from fen_transform import (
    client_col_to_engine_col,
    engine_col_to_client_col,
    engine_square_to_client_square,
)


class FenTransformTests(unittest.TestCase):
    def test_left_border_maps_to_engine_j_file(self) -> None:
        self.assertEqual(client_col_to_engine_col(0), 9)
        self.assertEqual(engine_col_to_client_col(9), 0)
        self.assertEqual(engine_square_to_client_square("j10"), "a10")

    def test_inner_board_cols_shift_by_one(self) -> None:
        self.assertEqual(client_col_to_engine_col(3), 2)
        self.assertEqual(engine_col_to_client_col(2), 3)


if __name__ == "__main__":
    unittest.main()
