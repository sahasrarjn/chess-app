import unittest

from fen_transform import client_fen_to_engine_fen, engine_uci_to_client_uci

START_CLIENT = (
    "........../.rnbqkbnr./.pppppppp./......../......../"
    "......../......../.PPPPPPPP./.RNBQKBNR./.......... w KQkq - 0 1"
)
START_ENGINE = (
    "........../rnbqkbnr../pppppppp../........../........../"
    "........../........../PPPPPPPP../RNBQKBNR../.......... w KQkq - 0 1"
)


class FenTransformTests(unittest.TestCase):
    def test_start_fen_maps_to_fairy_stockfish_layout(self) -> None:
        self.assertEqual(client_fen_to_engine_fen(START_CLIENT), START_ENGINE)

    def test_engine_uci_shifts_right_one_file(self) -> None:
        self.assertEqual(engine_uci_to_client_uci("a3a4"), "b3b4")
        self.assertEqual(engine_uci_to_client_uci("e3e4"), "f3f4")
        self.assertEqual(engine_uci_to_client_uci("d7d5"), "e7e5")

    def test_round_trip_starting_pawn_move(self) -> None:
        engine_move = "a3a4"
        client_move = engine_uci_to_client_uci(engine_move)
        self.assertEqual(client_move, "b3b4")


if __name__ == "__main__":
    unittest.main()
