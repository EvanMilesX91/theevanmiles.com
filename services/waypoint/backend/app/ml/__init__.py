"""Optional, point-in-time ML evidence for Waypoint.

The package intentionally uses only the standard library and NumPy. No model is
required at runtime; the deterministic engine remains the source of decisions.
"""

from .engine import MLEngine

__all__ = ["MLEngine"]
