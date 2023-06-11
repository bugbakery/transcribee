# Development Setup

This document should get you up to speed and give you a working development environment for
`transcribee`. The instructions in this document may not be used for production installations!

The transcribee project uses a development-setup managed by `nix`. This allows us to all use the
same software & versions conviniently. Thus, the easiest way to start is to have
[a working nix installation on your system](https://nix.dev/tutorials/install-nix).
Alternatively you can install the dependencies listed in the [`shell.nix`](../packaging/shell.nix) file by
hand (but that might be more inconvenient).

## Minimal setup (nix)

If you just want to try out `transcribee`, you need to go through the following steps:

1. [Install `nix` on your system](https://nix.dev/tutorials/install-nix) & run `nix-shell packaging/shell.nix` to get
   a shell with all dependencies of `transcribee` installed. Alternatively you can install the
   dependencies listed in the [`shell.nix`](../packaging/shell.nix) file by hand
   (but that might be more inconvenient).
2. Run the dev script (this might take a long time as it downloads / compiles all the dependencies):
   execute `./packaging/dev.sh` in the root folder of the `transcribee` repo.
3. Profit! You can now point your browser to [http://localhost:5173/](http://localhost:5173/) and
   interact with the running transcribee instance. An admin user with the username "test" and the
   password "test" is created for you.

## Minimal setup (Docker)

If you just want to try out `transcribee` and **not** install nix, you need to go through
the following steps:

1. [Install `Docker` on your system](https://docs.docker.com/get-docker/).
2. Build the docker container: `docker build -f packaging/Dockerfile -t transcribee:latest .`
3. Run the docker container: `docker run -it -p 5173:5173 transcribee:latest`
4. Profit! You can now point your browser to [http://localhost:5173/](http://localhost:5173/) and
   interact with the running transcribee instance. An admin user with the username "test" and the
   password "test" is created for you.

> **Note**
> To use this setup for development, you can use the following command to bind-mount your code
> into the container. This way, the application will auto-reload if you change the code, and you
> do not need to restart the container:
>
> ```shell
> docker run -it -p 5173:5173 --mount type=bind,source="$(pwd)",target=/app transcribee:latest
> ```

## Debug Mode

Some features are only available in debug mode.
To enable this mode, set the `DEBUG_MODE` environment variable to `true`.

```
DEBUG_MODE=true ./packaging/dev.sh
```

or

```
docker run -it -p 5173:5173 -e DEBUG_MODE=true --mount type=bind,source="$(pwd)",target=/app transcribee:latest
```

## Extended setup

If you do more development on transcribee, you may wish to do the following things:

- Install [`direnv`](https://direnv.net/) for automatically loading the nix-shell when you are in
  the transcribee directory.
- Install the [`pre-commit`](https://pre-commit.com/) hook so that your changes are automatically
  linted before you commit them. Run: `pre-commit install`

## More!

There are more specific instructions in the respective readme files of the
[`backend/`](../backend/README.md), [`frontend/`](../frontend/README.md)
and [`worker/`](../worker/README.md) directories.
