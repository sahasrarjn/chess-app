import unittest
from unittest.mock import patch

from client_move_check import client_accepts_move


class ClientMoveCheckTests(unittest.TestCase):
    @patch("client_move_check.VALIDATOR_JS")
    def test_skips_when_bundle_missing(self, mock_path):
        mock_path.is_file.return_value = False
        self.assertTrue(client_accepts_move("fen", "e2e4"))

    @patch("client_move_check.subprocess.run")
    @patch("client_move_check.VALIDATOR_JS")
    def test_rejects_nonzero_exit(self, mock_path, mock_run):
        mock_path.is_file.return_value = True
        mock_run.return_value.returncode = 1
        mock_run.return_value.stderr = "illegal"
        mock_run.return_value.stdout = ""
        self.assertFalse(client_accepts_move("fen", "bad"))


if __name__ == "__main__":
    unittest.main()
