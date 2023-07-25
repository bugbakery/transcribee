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

ENV MEDIA_URL_BASE=http://localhost:5173/

ENTRYPOINT [ "nix-shell", "shell.nix", "--command" ]

CMD [ "overmind start -f packaging/Procfile" ]
