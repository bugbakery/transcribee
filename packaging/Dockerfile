FROM nixos/nix

RUN nix-channel --update

RUN mkdir -p /app

COPY flake.nix /app

WORKDIR /app

COPY . /app/

RUN nix --extra-experimental-features 'nix-command flakes' develop --command ./packaging/install_dependencies.sh

EXPOSE 5173

ENV MEDIA_URL_BASE=http://localhost:5173/

ENTRYPOINT [ "nix", "--extra-experimental-features", "'nix-command flakes'", "develop" ]

CMD [ "overmind start -f packaging/Procfile" ]
