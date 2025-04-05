#!/usr/bin/env python
import os
import sys
import unittest

import xmlrunner

if __name__ == "__main__":
    # Create the test results directory if it doesn't exist
    if not os.path.exists("test-results"):
        os.makedirs("test-results")

    # Discover and run the tests
    test_suite = unittest.defaultTestLoader.discover("billing.tests")

    # Run the tests with XMLTestRunner
    result = xmlrunner.XMLTestRunner(output="test-results").run(test_suite)

    # Exit with non-zero status if there were failures
    sys.exit(not result.wasSuccessful())
