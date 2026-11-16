import unittest
import numpy as np
from run_experiment import alignment_estimate, shift_without_resampling, matched_pair, RATE

class ExperimentTests(unittest.TestCase):
    def test_alignment_and_shift(self):
        x = np.random.default_rng(42).normal(0, .1, (RATE, 1)).astype('float32')
        delayed = np.pad(x, ((137, 0), (0, 0)))[:len(x)]
        measured = alignment_estimate(x, delayed)
        self.assertTrue(measured['reliable'])
        self.assertEqual(measured['estimated_restored_delay_samples'], 137)
        aligned = shift_without_resampling(delayed, 137)
        self.assertEqual(aligned.shape, x.shape)
        np.testing.assert_array_equal(aligned[:-137], x[:-137])
        self.assertFalse(alignment_estimate(x*0, x*0)['reliable'])

    def test_loudness_and_immutability(self):
        t = np.arange(RATE) / RATE
        x = (.1 * np.sin(2*np.pi*440*t)).astype('float32')[:,None]
        copy = x.copy()
        (a,b), report = matched_pair(x, x*2)
        self.assertLess(abs(report['output_lufs'][0]-report['output_lufs'][1]), .01)
        self.assertLessEqual(max(report['gains']), 1)
        np.testing.assert_array_equal(x, copy)
        self.assertEqual(a.shape,b.shape)

if __name__ == '__main__':
    unittest.main()
