#!/usr/bin/env python3

from typing import Any, Optional, Protocol


class ProgressCallbackType(Protocol):
    def __call__(
        self,
        *,
        progress: float,
        step: Optional[str] = "",
        extra_data: Optional[Any] = None
    ):
        ...
