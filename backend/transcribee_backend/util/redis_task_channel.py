from redis.asyncio import Redis


class RedisTaskChannel:
    redis: Redis
    prefix: str

    def __init__(self, redis, prefix="task-channel:"):
        self.redis = redis
        self.prefix = prefix

    async def put_result(self, id: str, value: str):
        # https://github.com/redis/redis-py/issues/2897
        return await self.redis.rpush(self._redis_key(id), value)  # type: ignore

    async def wait_for_result(self, id) -> str:
        # https://github.com/redis/redis-py/issues/2897
        return (await self.redis.blpop(self._redis_key(id)))[1]  # type: ignore

    def _redis_key(self, id):
        return self.prefix + id
