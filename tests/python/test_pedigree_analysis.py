from __future__ import annotations
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pedigree_analysis", ROOT / "tools" / "analyze_pedigree.py")
assert spec and spec.loader
analysis = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = analysis
spec.loader.exec_module(analysis)


class PedigreeAnalysisTests(unittest.TestCase):
    def test_cycle_detection_and_descendant_contamination(self):
        graph = analysis.PedigreeGraph(
            parents={
                1: analysis.HorseEdge(2, None),
                2: analysis.HorseEdge(1, None),
                3: analysis.HorseEdge(1, None),
                4: analysis.HorseEdge(None, None),
            },
            children={1: [2, 3], 2: [1]},
        )
        cycles = analysis.find_cycle_nodes(graph)
        self.assertEqual(cycles, {1, 2})
        self.assertEqual(analysis.descendants_of(graph, cycles), {1, 2, 3})

    def test_repeated_ancestors_keep_separate_pedigree_positions(self):
        graph = analysis.PedigreeGraph(
            parents={
                1: analysis.HorseEdge(2, 3),
                2: analysis.HorseEdge(4, None),
                3: analysis.HorseEdge(4, None),
                4: analysis.HorseEdge(None, None),
            },
            children={2: [1], 3: [1], 4: [2, 3]},
        )
        result = analysis.repeated_ancestor_stats(graph, [1], 2)
        self.assertEqual(result["average_known_positions"], 4)
        self.assertEqual(result["average_unique_ancestors"], 3)
        self.assertEqual(result["average_repeated_positions"], 1)


if __name__ == "__main__":
    unittest.main()
