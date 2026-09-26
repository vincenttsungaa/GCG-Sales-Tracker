"""One-at-a-time background job with progress, shared by the card and product catalog syncs."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Callable


class SyncJob:
    def __init__(self, run: Callable[..., dict[str, Any]]):
        self._run = run
        self._lock = threading.Lock()
        self.state: dict[str, Any] = {
            "running": False,
            "stage": None,
            "done": 0,
            "total": 0,
            "error": None,
            "started_at": None,
            "finished_at": None,
            "result": None,
        }

    def _progress(self, stage: str, done: int, total: int) -> None:
        self.state.update(stage=stage, done=done, total=total)

    def _worker(self, kwargs: dict[str, Any]) -> None:
        try:
            self.state["result"] = self._run(progress=self._progress, **kwargs)
            self.state["error"] = None
        except Exception as exc:  # surfaced to the UI through the status endpoint
            self.state["error"] = str(exc)
        finally:
            self.state.update(running=False, finished_at=datetime.now(timezone.utc).isoformat())

    def start(self, **kwargs: Any) -> bool:
        """Start the job unless one is already running. Returns True when a new run started."""
        with self._lock:
            if self.state["running"]:
                return False
            self.state.update(
                running=True, stage="starting", done=0, total=0, error=None, result=None,
                started_at=datetime.now(timezone.utc).isoformat(), finished_at=None,
            )
        threading.Thread(target=self._worker, args=(kwargs,), daemon=True).start()
        return True
