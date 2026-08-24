# Development Setup

This document should get you up to speed and give you a working development environment for
transcribee (web and desktop). The instructions in this document may not be used for production installations!

The transcribee project uses a development-setup managed by `nix`. This allows us to all use the
same software & versions conviniently. Thus, the easiest way to start is to have
[a working nix installation on your system](https://nix.dev/tutorials/install-nix).
Alternatively you can install the dependencies listed in the [`shell.nix`](../shell.nix) file by
hand (but that might be more inconvenient).

## Minimal setup (nix)

Our recomended way of getting a developent setup is through nix. For this you need to
[Install `nix` on your system](https://nix.dev/tutorials/install-nix) & run `nix develop` to get
a shell with all dependencies of transcribee installed. Alternatively you can install the
dependencies listed in [`flake.nix`](../flake.nix) file by hand (but that might be more inconvenient).

## Minimal setup (Dev Containers)

[Dev Containers](https://containers.dev/) allow you to use a container as a full-featured development
environment. This might be convenient but probably does not work for developing transcribee desktop.

If your IDE (such as VS Code) supports it, it should offer you an option to build the
dev container and reopen the project within the container. You need to have Docker or another compatible
container runtime installed.

The transcribee dev container gives you an ubuntu container with nix installed, where you then
can continue with step 2 of "Minimal setup (nix)".

On first run, the dev container will automatically build the nix environment and install dev
dependencies, which may take a while. Subsequent runs or rebuilds will preserve the nix cache and
should be much faster.

## Minimal setup (Docker)

If you do not want use dev containers, you can also use the docker dev container by itself.
Again, tihs does not work for dev work on transcribee desktop.

Running `./packaging/docker-dev-env.sh` will build the docker container and launch into the nix dev
shell. After that you can continue with step 2 of "Minimal setup (nix)".

On first run, the dev container will automatically build the nix environment and install dev
dependencies, which may take a while. Subsequent runs or rebuilds will preserve the nix cache and
should be much faster.

## Extended setup

If you do more development on transcribee, you may wish to do the following things:

- Install [`direnv`](https://direnv.net/) for automatically loading the nix-shell when you are in
  the transcribee directory.
- Install the [`pre-commit`](https://pre-commit.com/) hook so that your changes are automatically
  linted before you commit them. Run: `pre-commit install`
