from fastapi import Request


class BaseUrl(str):
    pass


def get_base_url(
    request: Request,
) -> BaseUrl:
    return BaseUrl(request.base_url)
