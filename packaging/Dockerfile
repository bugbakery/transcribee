FROM nixos/nix

RUN nix-channel --update

RUN mkdir -p /app/packaging

COPY packaging/shell.nix /app/packaging

WORKDIR /app

RUN nix-build packaging/shell.nix

COPY . /app/

RUN nix-shell packaging/shell.nix --command ./packaging/install_dependencies.sh
RUN nix-shell packaging/shell.nix --command ./packaging/setup_backend.sh

EXPOSE 5173
EXPOSE 8000

ENTRYPOINT [ "nix-shell", "packaging/shell.nix", "--command" ]

CMD [ "overmind start -f packaging/Procfile" ]
