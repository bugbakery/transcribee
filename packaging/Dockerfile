FROM nixos/nix

RUN nix-channel --update

RUN mkdir /app

COPY shell.nix /app/

WORKDIR /app

RUN nix-build shell.nix

COPY . /app/

RUN nix-shell shell.nix --command ./packaging/install_dependencies.sh

EXPOSE 5173
EXPOSE 8000

ENTRYPOINT [ "nix-shell", "shell.nix", "--command", "/app/dev.sh" ]
