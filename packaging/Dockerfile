FROM nixos/nix

RUN nix-channel --update

RUN mkdir -p /app

COPY shell.nix /app

WORKDIR /app

RUN nix-build shell.nix

COPY . /app/

RUN nix-shell shell.nix --command ./packaging/install_dependencies.sh
RUN nix-shell shell.nix --command ./packaging/setup_backend.sh

EXPOSE 5173
EXPOSE 8000

ENTRYPOINT [ "nix-shell", "shell.nix", "--command" ]

CMD [ "overmind start -f packaging/Procfile" ]
