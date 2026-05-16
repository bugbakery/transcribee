from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException


class StaticFilesWithIndexFallback(StaticFiles):
    def __init__(
        self,
        *args,
        no_cache_paths: list[str],
        assets_prefix: str,
        assets_cache_header: str | None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.no_cache_paths = no_cache_paths
        self.assets_prefix = assets_prefix
        self.assets_cache_header = assets_cache_header

    async def get_response(self, path: str, scope):
        try:
            res = await super().get_response(path, scope)
            if path in self.no_cache_paths:
                res.headers["cache-control"] = "no-cache"
            elif self.assets_cache_header is not None and path.startswith(
                self.assets_prefix
            ):
                res.headers["cache-control"] = self.assets_cache_header
            return res
        except (HTTPException, StarletteHTTPException) as ex:
            if ex.status_code == 404:
                if path.startswith(self.assets_prefix):
                    # Return 404 for missing assets
                    raise ex
                else:
                    res = await super().get_response("index.html", scope)
                    if "index.html" in self.no_cache_paths:
                        res.headers["cache-control"] = "no-cache"
                    return res
            else:
                raise ex
