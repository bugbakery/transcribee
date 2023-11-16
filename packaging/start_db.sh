#!/usr/bin/env sh

if [ ! -e ../backend/db/data ]; then
    initdb -D ../backend/db/data
fi

if [ ! -e ../backend/db/sockets ]; then
    mkdir ../backend/db/sockets
fi

trap "pg_ctl -D ../backend/db/data -o \"-h '' -k '$(pwd)/../backend/db/sockets/'\" stop" INT
pg_ctl -D ../backend/db/data -o "-h '' -k '$(pwd)/../backend/db/sockets/'" start

createdb -h"$(pwd)/../backend/db/sockets/" transcribee || true

sleep infinity
