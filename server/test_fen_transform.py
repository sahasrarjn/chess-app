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

    def test_midgame_fen_expands_run_length_ranks(self) -> None:
        midgame = (
            "........../1rn2kb2r/2p3pp2/1p1p1p2p1/........../q3PP4/2B1N1N1P1/"
            "1PPP2PP1b/4QK3R/9R b q - 5 14"
        )
        engine_fen = client_fen_to_engine_fen(midgame)
        for rank in engine_fen.split()[0].split("/"):
            self.assertEqual(len(rank), 10, msg=rank)


if __name__ == "__main__":
    unittest.main()
