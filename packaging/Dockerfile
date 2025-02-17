FROM nixos/nix

RUN nix-channel --update

RUN mkdir -p /app

COPY flake.nix /app

WORKDIR /app

COPY . /app/

ENV MEDIA_URL_BASE=http://localhost:5173/

RUN nix --extra-experimental-features 'nix-command flakes' develop --command ./packaging/install_dependencies.sh

EXPOSE 5173

ARG DATABASE_URL
ENV TRANSCRIBEE_BACKEND_DATABASE_URL=$DATABASE_URL

RUN mkdir -p /app/backend/db
RUN mkdir -p /app/backend/storage

ENTRYPOINT ["nix", "--extra-experimental-features", "nix-command flakes", "develop", "path:.", "--command" ]

CMD ./packaging/install_dependencies.sh; overmind start -f packaging/Procfile -l backend,frontend,redis,worker
