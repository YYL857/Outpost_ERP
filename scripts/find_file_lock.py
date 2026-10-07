# -*- coding: utf-8 -*-
"""Find which process locks a file using Windows Restart Manager."""
import sys
import ctypes
from ctypes import wintypes

sys.stdout.reconfigure(encoding="utf-8")

path = sys.argv[1]

# Restart Manager APIs
rstrtmgr = ctypes.windll.rstrtmgr
kernel32 = ctypes.windll.kernel32

ULONG = ctypes.c_ulong
DWORD = wintypes.DWORD


class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", DWORD), ("dwHighDateTime", DWORD)]


class RM_UNIQUE_PROCESS(ctypes.Structure):
    _fields_ = [("dwProcessId", DWORD), ("ProcessStartTime", FILETIME)]


CCH_RM_MAX_APP_NAME = 255
CCH_RM_MAX_SVC_NAME = 63


class RM_PROCESS_INFO(ctypes.Structure):
    _fields_ = [
        ("Process", RM_UNIQUE_PROCESS),
        ("strAppName", ctypes.c_wchar * (CCH_RM_MAX_APP_NAME + 1)),
        ("strServiceShortName", ctypes.c_wchar * (CCH_RM_MAX_SVC_NAME + 1)),
        ("ApplicationType", ctypes.c_uint),
        ("AppStatus", ULONG),
        ("TSSessionId", DWORD),
        ("bRestartable", wintypes.BOOL),
    ]


session = DWORD(0)
key = ctypes.create_unicode_buffer(32)
rc = rstrtmgr.RmStartSession(ctypes.byref(session), 0, key)
if rc != 0:
    raise SystemExit(f"RmStartSession failed {rc}")

try:
    files = (ctypes.c_wchar_p * 1)(path)
    rc = rstrtmgr.RmRegisterResources(session, 1, files, 0, None, 0, None)
    if rc != 0:
        raise SystemExit(f"RmRegisterResources failed {rc}")

    needed = DWORD(0)
    count = DWORD(0)
    reboot = DWORD(0)
    rc = rstrtmgr.RmGetList(
        session, ctypes.byref(needed), ctypes.byref(count), None, ctypes.byref(reboot)
    )
    if rc not in (0, 234):  # ERROR_MORE_DATA
        raise SystemExit(f"RmGetList failed {rc}")

    if needed.value == 0:
        print("NO_LOCKERS")
    else:
        arr = (RM_PROCESS_INFO * needed.value)()
        count = DWORD(needed.value)
        rc = rstrtmgr.RmGetList(
            session, ctypes.byref(needed), ctypes.byref(count), arr, ctypes.byref(reboot)
        )
        if rc != 0:
            raise SystemExit(f"RmGetList2 failed {rc}")
        for i in range(count.value):
            info = arr[i]
            print(
                f"PID={info.Process.dwProcessId} APP={info.strAppName} SVC={info.strServiceShortName}"
            )
finally:
    rstrtmgr.RmEndSession(session)
