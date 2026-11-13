"""Test setup.

Windows workaround: gltest's direct loader deletes a temp file while it is
still open as stdin, which Windows refuses. Ignore that one error; the OS
cleans the temp folder later. No effect on Linux/macOS.
"""
import os
import sys

if sys.platform == "win32":
    _unlink = os.unlink

    def _tolerant_unlink(path, *args, **kwargs):
        try:
            _unlink(path, *args, **kwargs)
        except PermissionError:
            pass

    os.unlink = _tolerant_unlink


# The direct-mode VM refreshes sender/value before each call but not the
# transaction datetime in gl.message_raw. Contracts read the datetime from
# there (as on a real node), so mirror vm.warp() into it for the tests.
from gltest.direct import vm as _vm_module  # noqa: E402

_orig_refresh = _vm_module.VMContext._refresh_gl_message


def _refresh_with_datetime(self):
    _orig_refresh(self)
    gl = sys.modules.get("genlayer.gl")
    if gl is not None and getattr(gl, "message_raw", None) is not None:
        gl.message_raw["datetime"] = self._datetime


_vm_module.VMContext._refresh_gl_message = _refresh_with_datetime
